/**
 * Raster brand pipeline: trim padding, resize to standard icon sizes, optional maskable + OG.
 *
 * Source (first match): CLI path, brand/source/app-logo.png, ./unisloticon.png, ./App-logo.png
 * Output: public/brand/
 *
 * Run: npm run build:brand
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'brand')

/** Mark fill from brand/source/app-logo.png (periwinkle from unisloticon). */
const THEME_BG = { r: 117, g: 117, b: 248, alpha: 1 } // #7575F8
/** Inset so white strokes never meet the squircle clip (legacy mark-only sources). */
const SAFE_PAD_RATIO = 0.14

/**
 * Windows .ico containing embedded PNGs (Vista+). No extra npm deps.
 * @param {{ width: number; height: number; png: Buffer }[]} entries
 */
function encodeIcoWithPngImages(entries) {
  const headerSize = 6 + entries.length * 16
  let offset = headerSize
  const rows = entries.map((e) => {
    const row = { ...e, offset, len: e.png.length }
    offset += e.png.length
    return row
  })
  const buf = Buffer.alloc(offset)
  buf.writeUInt16LE(0, 0)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(entries.length, 4)
  let pos = 6
  for (const e of rows) {
    buf.writeUInt8(e.width >= 256 ? 0 : e.width, pos)
    buf.writeUInt8(e.height >= 256 ? 0 : e.height, pos + 1)
    buf.writeUInt8(0, pos + 2)
    buf.writeUInt8(0, pos + 3)
    buf.writeUInt16LE(0, pos + 4) // planes — 0 for PNG-in-ICO
    buf.writeUInt16LE(0, pos + 6) // bit count — 0 for PNG-in-ICO
    buf.writeUInt32LE(e.len, pos + 8)
    buf.writeUInt32LE(e.offset, pos + 12)
    pos += 16
  }
  for (const e of rows) {
    e.png.copy(buf, e.offset)
  }
  return buf
}

/** ~iOS icon corner proportion; clamp so tiny favicons stay readable */
function squircleMaskSvg(size) {
  const rx = Math.max(2, Math.min(Math.floor(size / 2) - 1, Math.round(size * 0.223)))
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="#ffffff"/>
    </svg>`,
  )
}

/** Clip square raster to a rounded squircle, then flatten corner alpha to `background` (no white square halos). */
async function squircleClipFlatten(rgbaBuffer, size, background = THEME_BG) {
  const mask = squircleMaskSvg(size)
  const clipped = await sharp(rgbaBuffer)
    .ensureAlpha()
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .toBuffer()

  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: clipped }])
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer()
}

function resolveSource() {
  const cli = process.argv[2]
  const candidates = [
    cli && path.resolve(process.cwd(), cli),
    path.join(root, 'brand', 'source', 'app-logo.png'),
    path.join(root, 'unisloticon.png'),
    path.join(root, 'App-logo.png'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(
    'No source PNG found. Add brand/source/app-logo.png, unisloticon.png, or App-logo.png at repo root, or pass a path:\n  node scripts/generate-brand-assets.mjs ./my-logo.png',
  )
}

async function prepareTrimmedBuffer(srcPath) {
  const meta = await sharp(srcPath).metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read image dimensions')
  return sharp(srcPath)
    .rotate()
    .ensureAlpha()
    .trim({ threshold: 14 })
    .toBuffer()
}

/** Mark-only sources (transparent bg) — inset padding before squircle clip. */
async function writeMarkIcon(buf, fileName, size, background = THEME_BG) {
  const pad = Math.max(2, Math.round(size * SAFE_PAD_RATIO))
  const inner = Math.max(1, size - pad * 2)
  const mark = await sharp(buf)
    .resize(inner, inner, {
      fit: 'contain',
      position: 'center',
      background,
    })
    .ensureAlpha()
    .png()
    .toBuffer()

  const square = await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer()

  const out = await squircleClipFlatten(square, size, background)
  await fs.promises.writeFile(path.join(outDir, fileName), out)
}

/** Clip square raster to a rounded squircle with transparent corners (for in-app UI). */
async function squircleClipTransparent(rgbaBuffer, size) {
  const mask = squircleMaskSvg(size)
  return sharp(rgbaBuffer)
    .ensureAlpha()
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer()
}

/** Full-bleed source already includes the squircle fill — resize only, no inset padding. */
async function prepareFullBleedSource(srcPath) {
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (r < 24 && g < 24 && b < 24) {
        data[i + 3] = 0
      }
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer()
}

async function resizeFullBleed(srcBuffer, size) {
  return sharp(srcBuffer)
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'center' })
    .ensureAlpha()
    .toBuffer()
}

async function writeUiLogo(srcBuffer, fileName, size) {
  const resized = await resizeFullBleed(srcBuffer, size)
  const out = await squircleClipTransparent(resized, size)
  await fs.promises.writeFile(path.join(outDir, fileName), out)
}

async function writeSquareIcon(srcBuffer, fileName, size, background = THEME_BG) {
  const resized = await resizeFullBleed(srcBuffer, size)
  const out = await squircleClipFlatten(resized, size, background)
  await fs.promises.writeFile(path.join(outDir, fileName), out)
}

async function writeMaskable512(srcBuffer) {
  const canvas = 512
  const inner = Math.round(canvas * 0.88)
  const innerBuf = await resizeFullBleed(srcBuffer, inner)
  const flat = await sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: THEME_BG,
    },
  })
    .composite([{ input: innerBuf, gravity: 'center' }])
    .png()
    .toBuffer()

  const out = await squircleClipFlatten(flat, canvas, THEME_BG)
  await fs.promises.writeFile(path.join(outDir, 'icon-maskable-512.png'), out)
}

async function writeOgImage(srcBuffer) {
  const W = 1200
  const H = 630
  const logoMax = 380
  const logoSquare = await resizeFullBleed(srcBuffer, logoMax)
  const logoBuf = await squircleClipFlatten(logoSquare, logoMax, THEME_BG)
  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 14, g: 14, b: 16 } },
  })
    .composite([{ input: logoBuf, gravity: 'center' }])
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(outDir, 'og-image.png'))
}

async function main() {
  const src = resolveSource()
  await fs.promises.mkdir(outDir, { recursive: true })

  const cleaned = await prepareFullBleedSource(src)

  // In-app UI logos — transparent outside squircle (no visible box on dark themes)
  await writeUiLogo(cleaned, 'logo-48.png', 48)
  await writeUiLogo(cleaned, 'logo-96.png', 96)
  await writeUiLogo(cleaned, 'logo-192.png', 192)

  // Favicons / PWA — solid squircle fill for tab icons
  await writeSquareIcon(cleaned, 'icon-16.png', 16)
  await writeSquareIcon(cleaned, 'icon-32.png', 32)
  await writeSquareIcon(cleaned, 'icon-48.png', 48)
  await writeSquareIcon(cleaned, 'icon-192.png', 192)
  await writeSquareIcon(cleaned, 'icon-512.png', 512)
  await writeSquareIcon(cleaned, 'apple-touch-icon.png', 180)

  const png16 = await fs.promises.readFile(path.join(outDir, 'icon-16.png'))
  const png32 = await fs.promises.readFile(path.join(outDir, 'icon-32.png'))
  const ico = encodeIcoWithPngImages([
    { width: 16, height: 16, png: png16 },
    { width: 32, height: 32, png: png32 },
  ])
  await fs.promises.writeFile(path.join(root, 'public', 'favicon.ico'), ico)

  await writeMaskable512(cleaned)
  await writeOgImage(cleaned)

  const manifest = {
    name: 'UniSlot',
    short_name: 'UniSlot',
    description: 'Evening course scheduling in your browser.',
    start_url: '/',
    display: 'standalone',
    background_color: '#7575F8',
    theme_color: '#7575F8',
    icons: [
      {
        src: '/brand/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
  await fs.promises.writeFile(
    path.join(root, 'public', 'site.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  console.log(`Brand assets written to public/brand/ + public/favicon.ico (source: ${path.relative(root, src)})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
