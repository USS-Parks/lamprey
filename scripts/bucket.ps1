# Bucket — one-command ship pipeline for Lamprey.
#
# What it does (in order):
#   1. Reads version from package.json.
#   2. If dist/latest.yml's version doesn't match, runs `npm run build:win`.
#   3. Tags + pushes vX.Y.Z if the tag doesn't already exist on origin.
#   4. In parallel:
#        - Uploads Lamprey-x64.exe + Lamprey-x64.zip to R2 (overwrites).
#        - Creates/updates the GitHub release with all four artifacts.
#   5. Purges Cloudflare cache for the two CDN URLs (if .cf/token exists).
#
# Setup once: `pwsh scripts/bucket-setup.ps1`. After that this script is the
# entire ship-arc — no env vars to remember, no credential dance.
#
# Run from repo root (or anywhere; the script resolves $repoRoot itself):
#   pwsh scripts/bucket.ps1
#
# Optional flags:
#   -NoBuild        Skip the build step (use whatever's in dist/ now).
#   -NoTag          Skip git tag creation/push (use existing tag).
#   -DryRun         Print what would happen; don't actually upload.

[CmdletBinding()]
param(
  [switch]$NoBuild,
  [switch]$NoTag,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# === Resolve paths ===
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir

$configPath  = Join-Path $repoRoot ".bucket.json"
$awsCreds    = Join-Path $repoRoot ".aws\credentials"
$awsConf     = Join-Path $repoRoot ".aws\config"
$cfTokenPath = Join-Path $repoRoot ".cf\token"
$dist        = Join-Path $repoRoot "dist"

# === Preflight ===
if (-not (Test-Path $configPath)) {
  Write-Host "ERROR: $configPath not found." -ForegroundColor Red
  Write-Host "Run: pwsh scripts\bucket-setup.ps1" -ForegroundColor Yellow
  exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json

# AWS creds resolution: prefer project-local `.aws/credentials` if present;
# else fall back to the user-global `~/.aws/credentials`. The profile name
# comes from .bucket.json (`aws.profile`, default = "default").
$awsProfile = if ($config.aws -and $config.aws.profile) { $config.aws.profile } else { "default" }

if (Test-Path $awsCreds) {
  $env:AWS_SHARED_CREDENTIALS_FILE = $awsCreds
  if (Test-Path $awsConf) { $env:AWS_CONFIG_FILE = $awsConf }
  Write-Host "  Using project-local AWS creds (.aws\credentials) profile [$awsProfile]" -ForegroundColor Green
} else {
  Write-Host "  Using user-global AWS creds (~/.aws/credentials) profile [$awsProfile]" -ForegroundColor Green
}

# Locate aws.exe — it's installed but often not on PATH in non-PS shells.
$awsExe = (Get-Command aws.exe -ErrorAction SilentlyContinue)?.Source
if (-not $awsExe) { $awsExe = "C:\Program Files\Amazon\AWSCLIV2\aws.exe" }
if (-not (Test-Path $awsExe)) {
  Write-Host "ERROR: aws.exe not found. Install AWS CLI v2." -ForegroundColor Red
  exit 1
}

# === Read version ===
$pkg = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version
$tag = "v$version"

Write-Host ""
Write-Host "=== Bucket: ship v$version ===" -ForegroundColor Cyan
Write-Host ""

# === Build (if needed) ===
$needsBuild = $true
$latestYml = Join-Path $dist "latest.yml"
if (Test-Path $latestYml) {
  $latestContent = Get-Content $latestYml -Raw
  if ($latestContent -match "version:\s*$([regex]::Escape($version))\b") {
    $needsBuild = $false
    Write-Host "  dist/ already at v$version — skipping build" -ForegroundColor Green
  }
}
if ($NoBuild) {
  Write-Host "  -NoBuild flag set — skipping build" -ForegroundColor Yellow
  $needsBuild = $false
}
if ($needsBuild) {
  Write-Host "  Building (npm run build:win)..." -ForegroundColor White
  if (-not $DryRun) {
    Push-Location $repoRoot
    try {
      npm run build:win
      if ($LASTEXITCODE -ne 0) { throw "npm run build:win failed (exit $LASTEXITCODE)" }
    } finally {
      Pop-Location
    }
  }
}

# === Verify dist/ artifacts ===
$artifacts = @("Lamprey-x64.exe", "Lamprey-x64.exe.blockmap", "Lamprey-x64.zip", "latest.yml")
foreach ($f in $artifacts) {
  $p = Join-Path $dist $f
  if (-not (Test-Path $p)) {
    Write-Host "ERROR: missing artifact: $p" -ForegroundColor Red
    exit 1
  }
}
Write-Host "  dist/ artifacts verified" -ForegroundColor Green

# === Tag (if needed) ===
if (-not $NoTag) {
  Push-Location $repoRoot
  try {
    $tagExists = $false
    git rev-parse "refs/tags/$tag" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $tagExists = $true }

    if (-not $tagExists) {
      Write-Host "  Creating + pushing tag $tag" -ForegroundColor White
      if (-not $DryRun) {
        git tag -a $tag -m $tag
        if ($LASTEXITCODE -ne 0) { throw "git tag failed" }
        git push origin $tag
        if ($LASTEXITCODE -ne 0) { throw "git push tag failed" }
      }
    } else {
      Write-Host "  Tag $tag already exists — skipping" -ForegroundColor Green
    }
  } finally {
    Pop-Location
  }
}

# === Parallel: R2 upload + GH release ===
$artifactPaths = $artifacts | ForEach-Object { Join-Path $dist $_ }

if ($DryRun) {
  Write-Host ""
  Write-Host "[DRY-RUN] Would upload to R2:" -ForegroundColor Yellow
  Write-Host "  s3://$($config.r2.bucket)/Lamprey-x64.exe"
  Write-Host "  s3://$($config.r2.bucket)/Lamprey-x64.zip"
  Write-Host "[DRY-RUN] Would create/update GH release: $tag" -ForegroundColor Yellow
  Write-Host "[DRY-RUN] Would purge CF cache for cdn.islandmountain.io URLs" -ForegroundColor Yellow
  exit 0
}

# Kick off R2 upload in a background job (multipart for the big zip)
$endpoint = "https://$($config.r2.accountId).r2.cloudflarestorage.com"
Write-Host ""
Write-Host "  Starting R2 upload (background)..." -ForegroundColor White
$useProjectCreds = (Test-Path $awsCreds)
$r2Job = Start-Job -Name "bucket-r2" -ScriptBlock {
  param($bucket, $endpoint, $dist, $awsCreds, $awsConf, $useProjectCreds, $awsProfile, $awsExe)
  if ($useProjectCreds) {
    $env:AWS_SHARED_CREDENTIALS_FILE = $awsCreds
    if (Test-Path $awsConf) { $env:AWS_CONFIG_FILE = $awsConf }
  }
  foreach ($f in "Lamprey-x64.exe", "Lamprey-x64.zip") {
    $src = Join-Path $dist $f
    & $awsExe s3 cp $src "s3://$bucket/$f" `
      --endpoint-url $endpoint --profile $awsProfile --checksum-algorithm CRC32
    if ($LASTEXITCODE -ne 0) { throw "aws s3 cp $f failed (exit $LASTEXITCODE)" }
  }
} -ArgumentList $config.r2.bucket, $endpoint, $dist, $awsCreds, $awsConf, $useProjectCreds, $awsProfile, $awsExe

# GitHub release in the foreground (also takes a few minutes for the zip)
Write-Host "  Creating/updating GH release $tag..." -ForegroundColor White
Push-Location $repoRoot
try {
  $releaseExists = $false
  gh release view $tag --repo $config.github.repo 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $releaseExists = $true }

  if (-not $releaseExists) {
    gh release create $tag --repo $config.github.repo `
      --title $tag `
      --notes "Release $tag" `
      @artifactPaths
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)" }
  } else {
    gh release upload $tag --repo $config.github.repo --clobber @artifactPaths
    if ($LASTEXITCODE -ne 0) { throw "gh release upload failed (exit $LASTEXITCODE)" }
  }
  Write-Host "  GH release done" -ForegroundColor Green
} finally {
  Pop-Location
}

# Wait for R2 job
Write-Host "  Waiting for R2 upload..." -ForegroundColor White
Wait-Job $r2Job | Out-Null
$r2Output = Receive-Job $r2Job 2>&1
$r2State = (Get-Job $r2Job).State
Remove-Job $r2Job
if ($r2State -ne "Completed") {
  Write-Host "ERROR: R2 upload failed. Output:" -ForegroundColor Red
  $r2Output | Write-Host
  exit 1
}
Write-Host "  R2 upload done" -ForegroundColor Green

# === Cloudflare cache purge ===
if (Test-Path $cfTokenPath) {
  Write-Host "  Purging Cloudflare cache..." -ForegroundColor White
  $token = (Get-Content $cfTokenPath -Raw).Trim()
  $purgeBody = @{
    files = @(
      "https://$($config.cloudflare.cdnHost)/Lamprey-x64.exe",
      "https://$($config.cloudflare.cdnHost)/Lamprey-x64.zip"
    )
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post `
      -Uri "https://api.cloudflare.com/client/v4/zones/$($config.cloudflare.zoneId)/purge_cache" `
      -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
      -Body $purgeBody | Out-Null
    Write-Host "  CF cache purged" -ForegroundColor Green
  } catch {
    Write-Host "  WARNING: CF cache purge failed: $_" -ForegroundColor Yellow
    Write-Host "  Purge manually: CF dashboard > Caching > Configuration > Purge Cache" -ForegroundColor Yellow
  }
} else {
  Write-Host "  (no .cf/token — skipping cache purge; do it manually in CF dashboard)" -ForegroundColor Yellow
}

# === Done ===
Write-Host ""
Write-Host "=== Ship complete: $tag ===" -ForegroundColor Cyan
Write-Host "  GitHub: https://github.com/$($config.github.repo)/releases/tag/$tag"
Write-Host "  CDN:    https://$($config.cloudflare.cdnHost)/Lamprey-x64.exe"
Write-Host "  CDN:    https://$($config.cloudflare.cdnHost)/Lamprey-x64.zip"
Write-Host ""
