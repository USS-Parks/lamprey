/**
 * Re-bake every ASSETS/*.png so it has a transparent background.
 *
 * Approach: for each image, sample the four corner pixels to estimate the
 * dominant background color. Walk every pixel and set its alpha based on
 * Euclidean distance from that background color:
 *
 *   distance <= INNER       -> fully transparent (alpha 0)
 *   INNER < distance < OUTER -> linearly feathered (smooth edge)
 *   distance >= OUTER       -> fully opaque (alpha preserved)
 *
 * This preserves anti-aliased icon edges instead of producing a jagged
 * cutout. Already-transparent corners short-circuit (file is left alone).
 *
 * Run with:  node scripts/transparentize-icons.js
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ASSETS_DIR = path.join(__dirname, '..', 'ASSETS')
const INNER = 28 // RGB distance treated as "definitely background"
const OUTER = 72 // RGB distance treated as "definitely foreground"
const CORNER_INSET = 4 // pixels in from each corner when sampling

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function averageCorners(data, width, height, channels) {
  const stride = width * channels
  const samples = [
    [CORNER_INSET, CORNER_INSET],
    [width - 1 - CORNER_INSET, CORNER_INSET],
    [CORNER_INSET, height - 1 - CORNER_INSET],
    [width - 1 - CORNER_INSET, height - 1 - CORNER_INSET]
  ]
  let r = 0, g = 0, b = 0, alphaTotal = 0, n = 0
  for (const [x, y] of samples) {
    const i = y * stride + x * channels
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    alphaTotal += channels === 4 ? data[i + 3] : 255
    n++
  }
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
    avgAlpha: alphaTotal / n
  }
}

async function processFile(filePath) {
  const buf = fs.readFileSync(filePath)
  const img = sharp(buf).ensureAlpha()
  const meta = await img.metadata()
  const { width, height } = meta
  if (!width || !height) {
    console.log(`  skip (no dims): ${path.basename(filePath)}`)
    return false
  }

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels // 4 after ensureAlpha

  const bg = averageCorners(data, width, height, channels)
  // If the corners are already transparent, nothing to do.
  if (bg.avgAlpha < 8) {
    return false
  }

  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    const d = colorDistance(r, g, b, bg.r, bg.g, bg.b)
    let alpha
    if (d <= INNER) alpha = 0
    else if (d >= OUTER) alpha = a
    else {
      // Feather: linear interp between transparent and opaque.
      const t = (d - INNER) / (OUTER - INNER)
      alpha = Math.round(t * a)
    }
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = alpha
  }

  await sharp(out, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(filePath + '.tmp')
  fs.renameSync(filePath + '.tmp', filePath)
  return true
}

;(async function main() {
  const files = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => path.join(ASSETS_DIR, f))

  console.log(`Scanning ${files.length} PNG(s) in ASSETS/`)
  let baked = 0
  for (const f of files) {
    process.stdout.write(`  ${path.basename(f)} ... `)
    try {
      const changed = await processFile(f)
      if (changed) {
        baked++
        console.log('baked')
      } else {
        console.log('already transparent')
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
  }
  console.log(`\nDone. ${baked} file(s) updated.`)
})()
