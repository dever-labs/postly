import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import png2icons from 'png2icons'

const __dirname = dirname(fileURLToPath(import.meta.url))
const resourcesDir = join(__dirname, '..', 'resources')

const size = 1024

const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1f2e"/>
      <stop offset="100%" style="stop-color:#0f1623"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="200" ry="200" fill="url(#bg)"/>
  <text x="50%" y="56%" font-family="Georgia, serif" font-weight="bold" font-size="620"
        fill="white" text-anchor="middle" dominant-baseline="middle">P</text>
  <rect x="300" y="820" width="424" height="24" rx="12" fill="url(#accent)" opacity="0.85"/>
</svg>`

// 1. Write master 1024x1024 PNG (also used as Linux icon)
const pngPath = join(resourcesDir, 'icon.png')
await sharp(Buffer.from(svg)).png().toFile(pngPath)
console.log('✓ icon.png (1024x1024)')

// 2. Generate Windows .ico (multi-size: 16, 24, 32, 48, 64, 128, 256)
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoBuffers = await Promise.all(
  icoSizes.map((s) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer())
)

// Write .ico using png2icons
const largeBuffer = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer()
const icoBuffer = png2icons.createICO(largeBuffer, png2icons.BILINEAR, 0, true)
writeFileSync(join(resourcesDir, 'icon.ico'), icoBuffer)
console.log('✓ icon.ico (multi-size up to 256x256)')

// 3. Generate macOS .icns
const icnsBuffer = png2icons.createICNS(largeBuffer, png2icons.BILINEAR, 0)
writeFileSync(join(resourcesDir, 'icon.icns'), icnsBuffer)
console.log('✓ icon.icns (macOS)')

console.log('\nAll icons generated successfully.')
