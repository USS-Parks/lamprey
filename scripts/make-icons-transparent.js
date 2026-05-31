#!/usr/bin/env node
/**
 * Detect each ASSETS/*.png's background color from the four corners,
 * promote it to RGBA, and set near-matching pixels to alpha=0.
 *
 * Run: node scripts/make-icons-transparent.js
 */
const { PNG } = require('pngjs')
const { readFileSync, writeFileSync, readdirSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..', 'ASSETS')
const TOLERANCE = 18 // 0–255; how close a pixel must be to the BG color to be erased
const EDGE_FEATHER = 8 // alpha softens within this distance of the threshold for anti-alias edges

function decode(path) {
  const buf = readFileSync(path)
  return PNG.sync.read(buf)
}

function sampleBgColor(png) {
  // Sample the four corners and the four edge midpoints; take the median R/G/B.
  const w = png.width
  const h = png.height
  const idx = (x, y) => (y * w + x) << 2
  const samples = [
    idx(0, 0),
    idx(w - 1, 0),
    idx(0, h - 1),
    idx(w - 1, h - 1),
    idx(Math.floor(w / 2), 0),
    idx(Math.floor(w / 2), h - 1),
    idx(0, Math.floor(h / 2)),
    idx(w - 1, Math.floor(h / 2))
  ]
  const rs = samples.map((i) => png.data[i])
  const gs = samples.map((i) => png.data[i + 1])
  const bs = samples.map((i) => png.data[i + 2])
  const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)]
  return { r: median(rs), g: median(gs), b: median(bs) }
}

function colorDistance(r, g, b, target) {
  const dr = r - target.r
  const dg = g - target.g
  const db = b - target.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function processFile(path) {
  const name = path.split(/[\\/]/).pop()
  const png = decode(path)
  if (png.colorType === 6) {
    return { name, skipped: 'already RGBA' }
  }

  const bg = sampleBgColor(png)

  // Reuse the existing PNG buffer but with alpha channel populated.
  const out = new PNG({ width: png.width, height: png.height })
  const src = png.data
  const dst = out.data
  let cleared = 0
  let feathered = 0

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i]
    const g = src[i + 1]
    const b = src[i + 2]
    const d = colorDistance(r, g, b, bg)
    dst[i] = r
    dst[i + 1] = g
    dst[i + 2] = b
    if (d <= TOLERANCE) {
      dst[i + 3] = 0
      cleared++
    } else if (d <= TOLERANCE + EDGE_FEATHER) {
      // Soft edge: ramp alpha from 0 → 255 across the feather band.
      const t = (d - TOLERANCE) / EDGE_FEATHER
      dst[i + 3] = Math.round(t * 255)
      feathered++
    } else {
      dst[i + 3] = 255
    }
  }

  writeFileSync(path, PNG.sync.write(out))
  const total = src.length / 4
  return {
    name,
    bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
    clearedPct: ((cleared / total) * 100).toFixed(1),
    featheredPct: ((feathered / total) * 100).toFixed(1)
  }
}

const targets = readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.png'))
console.log(`Processing ${targets.length} PNGs in ${ROOT}\n`)
for (const f of targets) {
  try {
    const result = processFile(join(ROOT, f))
    if (result.skipped) {
      console.log(`  ${result.name} — ${result.skipped}`)
    } else {
      console.log(
        `  ${result.name} bg=${result.bg} cleared=${result.clearedPct}% feathered=${result.featheredPct}%`
      )
    }
  } catch (err) {
    console.error(`  ${f} FAILED:`, err.message)
  }
}
