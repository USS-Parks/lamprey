// One-off: rebuild "Lamprey Background Tasks Icon.png" so it renders
// cleanly under the project's dark-mode invert filter
// (`filter: brightness(0) invert(1)` in src/styles/index.css).
//
// Problem: the original light-mode PNG uses dense solid teal fills for
// the long horizontal bars inside the two stacked panels. That makes
// the icon ~44% opaque pixels (vs ~13% for Plan, ~10% for Full Access).
// Inverting to solid white in dark mode then collapses the bars and
// outlines into a single white blob with no internal structure.
//
// Fix: the artist-made "Lamprey Background Tasks Icon Dark View.png"
// already has the correct *thin-line* structure (outlined bars instead
// of solid). We use it as the structural template and recolor each
// opaque pixel back to the original two-tone palette (navy stroke +
// teal accent) by nearest-opaque-pixel lookup in the current light PNG.
// Result: light mode keeps the navy+teal wireframe look, dark mode's
// invert filter now produces a clean white wireframe.

const sharp = require('sharp')
const path = require('path')

const ASSETS = path.resolve(__dirname, '..', 'ASSETS')
const STRUCTURE = path.join(ASSETS, 'Lamprey Background Tasks Icon Dark View.png')
const SOURCE = path.join(ASSETS, 'Lamprey Background Tasks Icon.png')
const OUT = SOURCE

// Project palette sampled from the original PNG.
const NAVY = [14, 31, 28]
const TEAL = [72, 168, 144]

function classify(r, g, b) {
  // "teal" pixels are green-dominant and reasonably saturated; everything
  // else opaque in the source is the navy stroke color.
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  if (g >= r && g >= b && sat > 0.2 && max > 80) return 'teal'
  return 'navy'
}

async function main() {
  const struct = await sharp(STRUCTURE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const src = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  if (struct.info.width !== src.info.width || struct.info.height !== src.info.height) {
    throw new Error(`size mismatch: struct ${struct.info.width}x${struct.info.height} vs src ${src.info.width}x${src.info.height}`)
  }
  const W = struct.info.width
  const H = struct.info.height
  const sCh = struct.info.channels
  const cCh = src.info.channels

  // Classify every opaque source pixel up front so we can nearest-search.
  const srcClass = new Uint8Array(W * H) // 0 = none, 1 = navy, 2 = teal
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * cCh
      const a = src.data[i + 3]
      if (a < 40) continue
      const cls = classify(src.data[i], src.data[i + 1], src.data[i + 2])
      srcClass[y * W + x] = cls === 'teal' ? 2 : 1
    }
  }

  const MAX_RADIUS = 32
  function nearestClass(cx, cy) {
    // Spiral outward from (cx, cy) and return the first opaque source class.
    if (srcClass[cy * W + cx]) return srcClass[cy * W + cx]
    for (let r = 1; r <= MAX_RADIUS; r++) {
      const x0 = Math.max(0, cx - r)
      const x1 = Math.min(W - 1, cx + r)
      const y0 = Math.max(0, cy - r)
      const y1 = Math.min(H - 1, cy + r)
      // Top + bottom edges of the ring
      for (let x = x0; x <= x1; x++) {
        if (cy - r >= 0) {
          const c = srcClass[(cy - r) * W + x]
          if (c) return c
        }
        if (cy + r < H) {
          const c = srcClass[(cy + r) * W + x]
          if (c) return c
        }
      }
      // Left + right edges (excluding corners already checked)
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        if (cx - r >= 0) {
          const c = srcClass[y * W + (cx - r)]
          if (c) return c
        }
        if (cx + r < W) {
          const c = srcClass[y * W + (cx + r)]
          if (c) return c
        }
      }
    }
    return 1 // default to navy
  }

  const out = Buffer.alloc(W * H * 4)
  let painted = 0
  let teal = 0
  let navy = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * sCh
      const a = struct.data[si + 3]
      const oi = (y * W + x) * 4
      if (a === 0) {
        out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; out[oi + 3] = 0
        continue
      }
      const cls = nearestClass(x, y)
      const pal = cls === 2 ? TEAL : NAVY
      out[oi] = pal[0]
      out[oi + 1] = pal[1]
      out[oi + 2] = pal[2]
      out[oi + 3] = a
      painted++
      if (cls === 2) teal++; else navy++
    }
  }

  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(OUT)

  console.log(`Wrote ${path.basename(OUT)}: ${painted} opaque px (${navy} navy, ${teal} teal)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
