# Bucket setup — run once to wire up the ship pipeline.
#
# Creates (all gitignored):
#   .bucket.json       — non-secret config (account ID, bucket name, zone ID, repo)
#   .aws/credentials   — R2 access key ID + secret access key
#   .aws/config        — `[profile r2]` with region = auto
#   .cf/token          — Cloudflare API token for cache purge (optional)
#
# Won't overwrite anything that already exists. Re-run any time to add a
# missing piece. Skips silently for things that are already in place.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir

# === Sanity: .gitignore must protect our secret paths ===
$gitignorePath = Join-Path $repoRoot ".gitignore"
$gitignore = if (Test-Path $gitignorePath) { Get-Content $gitignorePath -Raw } else { "" }
$missing = @()
foreach ($pattern in @(".aws/", ".cf/", ".bucket.json")) {
  if ($gitignore -notmatch [regex]::Escape($pattern)) {
    $missing += $pattern
  }
}
if ($missing.Count -gt 0) {
  Write-Host "Adding to .gitignore: $($missing -join ', ')" -ForegroundColor Yellow
  Add-Content $gitignorePath "`n# Bucket pipeline — project-scoped secrets (NEVER commit)`n$($missing -join "`n")`n"
}

Write-Host ""
Write-Host "=== Bucket setup ===" -ForegroundColor Cyan
Write-Host ""

# === .bucket.json ===
$configPath = Join-Path $repoRoot ".bucket.json"
if (Test-Path $configPath) {
  Write-Host ".bucket.json — exists (skipping; edit by hand to change)" -ForegroundColor Green
} else {
  Write-Host ".bucket.json — collecting config" -ForegroundColor White
  Write-Host "  Cloudflare Account ID = the 32-char hex string at the top of any R2 page."
  $accountId = Read-Host "    Account ID"
  Write-Host "  R2 bucket name = the bucket fronted by cdn.islandmountain.io."
  $bucketName = Read-Host "    Bucket name"
  Write-Host "  CDN hostname (default: cdn.islandmountain.io)"
  $cdnHost = Read-Host "    CDN host [cdn.islandmountain.io]"
  if (-not $cdnHost) { $cdnHost = "cdn.islandmountain.io" }
  Write-Host "  Cloudflare Zone ID = bottom-right of CF dashboard > islandmountain.io > Overview."
  $zoneId = Read-Host "    Zone ID (needed for cache purge; leave blank to skip)"
  $ghRepo = Read-Host "  GitHub repo [USS-Parks/lamprey]"
  if (-not $ghRepo) { $ghRepo = "USS-Parks/lamprey" }

  $json = [ordered]@{
    r2 = [ordered]@{
      accountId = $accountId
      bucket = $bucketName
    }
    cloudflare = [ordered]@{
      cdnHost = $cdnHost
      zoneId  = $zoneId
    }
    github = [ordered]@{
      repo = $ghRepo
    }
  } | ConvertTo-Json -Depth 10
  Set-Content -Path $configPath -Value $json -Encoding utf8
  Write-Host "  Wrote .bucket.json" -ForegroundColor Green
}

# === .aws/credentials + .aws/config ===
$awsDir = Join-Path $repoRoot ".aws"
$awsCredsPath = Join-Path $awsDir "credentials"
$awsConfPath  = Join-Path $awsDir "config"
if (Test-Path $awsCredsPath) {
  Write-Host ".aws\credentials — exists (skipping)" -ForegroundColor Green
} else {
  if (-not (Test-Path $awsDir)) { New-Item -ItemType Directory -Path $awsDir | Out-Null }
  Write-Host ""
  Write-Host ".aws\credentials — collecting R2 API token" -ForegroundColor White
  Write-Host "  Cloudflare dashboard > R2 > Manage R2 API Tokens > Create API Token"
  Write-Host "  Permissions: Object Read & Write. Scope: this bucket."
  $accessKey = Read-Host "    R2 Access Key ID"
  $secretSecure = Read-Host "    R2 Secret Access Key" -AsSecureString
  $secret = [System.Net.NetworkCredential]::new("", $secretSecure).Password

  Set-Content -Path $awsCredsPath -Encoding utf8 -Value @"
[r2]
aws_access_key_id = $accessKey
aws_secret_access_key = $secret
"@
  Set-Content -Path $awsConfPath -Encoding utf8 -Value @"
[profile r2]
region = auto
output = json
"@
  Write-Host "  Wrote .aws\credentials and .aws\config" -ForegroundColor Green
}

# === .cf/token (optional) ===
$cfDir = Join-Path $repoRoot ".cf"
$cfTokenPath = Join-Path $cfDir "token"
if (Test-Path $cfTokenPath) {
  Write-Host ".cf\token — exists (skipping)" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host ".cf\token — Cloudflare API token for auto cache purge" -ForegroundColor White
  Write-Host "  Create at https://dash.cloudflare.com/profile/api-tokens"
  Write-Host "  Use the 'Create Token > Get started > Edit zone' template,"
  Write-Host "  add the 'Zone > Cache Purge' permission, scope to islandmountain.io."
  Write-Host "  (Leave blank to skip — cache purge will be manual each ship.)"
  $cfTokenSecure = Read-Host "    CF API token" -AsSecureString
  $cfToken = [System.Net.NetworkCredential]::new("", $cfTokenSecure).Password
  if ($cfToken) {
    if (-not (Test-Path $cfDir)) { New-Item -ItemType Directory -Path $cfDir | Out-Null }
    Set-Content -Path $cfTokenPath -Value $cfToken -Encoding utf8 -NoNewline
    Write-Host "  Wrote .cf\token" -ForegroundColor Green
  } else {
    Write-Host "  (skipped — purge manually in CF dashboard after each ship)" -ForegroundColor Yellow
  }
}

# === Quick smoke test ===
Write-Host ""
Write-Host "Testing R2 connection..." -ForegroundColor White
$env:AWS_SHARED_CREDENTIALS_FILE = $awsCredsPath
$env:AWS_CONFIG_FILE             = $awsConfPath
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$endpoint = "https://$($config.r2.accountId).r2.cloudflarestorage.com"
$lsOutput = aws s3 ls --endpoint-url $endpoint --profile r2 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host "  R2 connection OK. Visible buckets:" -ForegroundColor Green
  $lsOutput | ForEach-Object { Write-Host "    $_" }
} else {
  Write-Host "  R2 connection FAILED. Output:" -ForegroundColor Red
  $lsOutput | Write-Host
  Write-Host "  Check keys + account ID, then re-run setup." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Cyan
Write-Host "Now ship with:  pwsh scripts\bucket.ps1"
Write-Host ""
