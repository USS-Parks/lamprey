// One-off: convert a brand icon PNG with an opaque white interior into a
// true wireframe (transparent everywhere except the strokes and color
// accents). Picks a saturation+brightness threshold so dark strokes
// stay opaque, teal/green accents stay opaque, anti-aliased edges keep
// partial alpha, and the near-white page interior becomes transparent.

const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const FILES = [
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Project History Icon Light View.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Env Card Changes Icon.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Env Card Pipeline Icon.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Env Card main Icon.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Env Card Commit Icon Light View.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Chat Pill Stop Icon Light View.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Connect Apps Icon.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Skills Teacher Icon Light View.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Plug-Ins Icon 2.png'),
  path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Reasoning Trace Icon Light View.png')
]

// A pixel is "background fill" if it is bright AND unsaturated.
// brightness = max(r,g,b)/255; saturation ≈ (max-min)/max.
// Stroke pixels (dark navy) have low brightness — kept.
// Teal accent pixels have high saturation — kept.
// Pure white interior has brightness≈1, saturation≈0 — knocked out.
function shouldKnockOut(r, g, b, a) {
  if (a === 0) return false
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const brightness = max / 255
  const saturation = max === 0 ? 0 : (max - min) / max
  return brightness > 0.9 && saturation < 0.08
}

async function processFile(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  const out = Buffer.from(data)
  let knocked = 0
  for (let i = 0; i < out.length; i += channels) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const a = out[i + 3]
    if (shouldKnockOut(r, g, b, a)) {
      out[i + 3] = 0
      knocked++
    }
  }

  const total = (out.length / channels)
  await sharp(out, { raw: { width, height, channels } })
    .png()
    .toFile(filePath)
  console.log(`[${path.basename(filePath)}] knocked ${knocked}/${total} pixels transparent (${(100 * knocked / total).toFixed(1)}%)`)
}

;(async () => {
  for (const f of FILES) {
    if (!fs.existsSync(f)) {
      console.error('Missing:', f)
      process.exit(1)
    }
    await processFile(f)
  }
})()
