// One-off: dilate the Background tasks icon stroke + accent alpha so it
// matches peer density (~10–12% opaque). Reads ASSETS/Lamprey Background
// Tasks Icon.png, expands alpha by N pixels using nearest-opaque RGB for
// the newly-painted halo, writes back in place.
//
// Why: fix-background-tasks-icon.cjs (prior pass) recolored the artist's
// thin-line Dark-View structure into the navy+teal source palette. That
// preserved the structure but left the icon at 6.3% opaque vs Plan's 13%
// / Review's 10%, so it reads as "faded" next to its neighbors under the
// dark-mode brightness(0) invert(1) filter.

const sharp = require('sharp')
const path = require('path')

const FILE = path.resolve(__dirname, '..', 'ASSETS', 'Lamprey Background Tasks Icon.png')
const DILATE_RADIUS = 2

async function main() {
  const src = await sharp(FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = src.info
  const buf = Buffer.from(src.data)

  const origAlpha = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) origAlpha[i] = buf[i * C + 3]

  function nearestOpaqueIdx(cx, cy) {
    for (let r = 0; r <= DILATE_RADIUS + 1; r++) {
      const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r)
      const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r)
      let best = -1, bestA = 0
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue
          const a = origAlpha[y * W + x]
          if (a > bestA) { bestA = a; best = y * W + x }
        }
      }
      if (best >= 0) return best
    }
    return -1
  }

  let painted = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x
      if (origAlpha[idx]) continue
      const x0 = Math.max(0, x - DILATE_RADIUS), x1 = Math.min(W - 1, x + DILATE_RADIUS)
      const y0 = Math.max(0, y - DILATE_RADIUS), y1 = Math.min(H - 1, y + DILATE_RADIUS)
      let maxA = 0
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const a = origAlpha[yy * W + xx]
          if (a > maxA) maxA = a
          if (maxA === 255) break
        }
        if (maxA === 255) break
      }
      if (!maxA) continue
      const src = nearestOpaqueIdx(x, y)
      if (src < 0) continue
      const si = src * C
      const di = idx * C
      buf[di] = buf[si]
      buf[di + 1] = buf[si + 1]
      buf[di + 2] = buf[si + 2]
      buf[di + 3] = maxA
      painted++
    }
  }

  await sharp(buf, { raw: { width: W, height: H, channels: C } }).png().toFile(FILE)
  const total = W * H
  console.log(`Dilated ${path.basename(FILE)} by ${DILATE_RADIUS}px — painted ${painted} new opaque px (${(100 * painted / total).toFixed(1)}% of canvas).`)
}

main().catch((e) => { console.error(e); process.exit(1) })
