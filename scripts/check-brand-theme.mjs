import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { APP_ICON_DATA_URL } from '../src/assets/appIconData.js'
import { ICON_SIZES, crc32, decodeBrandPng, resizeBrandImage, encodeRgbaPng, buildBrandAssets, prepareBrandAssets } from './prepare-brand-assets.mjs'

const source = Buffer.from(APP_ICON_DATA_URL.split(',')[1], 'base64')
const css = await readFile(new URL('../src/styles/dark-theme.css', import.meta.url), 'utf8')
const declarations = css.match(/html\[data-theme="dark"\]\s*\{([^}]+)\}/)[1]
const tokens = Object.fromEntries([...declarations.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))
function value(name, depth = 0) {
  assert.ok(depth < 10, 'No cyclic color tokens')
  const token = tokens[name]
  assert.ok(token, 'Missing token: ' + name)
  return token.startsWith('var(') ? value(token.slice(6, -1), depth + 1) : token
}
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i)
  const [r, g, b] = hex.slice(1).match(/../g).map(channel => {
    const s = parseInt(channel, 16) / 255
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4
  })
  return r * .2126 + g * .7152 + b * .0722
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + .05) / (values[1] + .05)
}

for (const foreground of ['ink', 'ink-soft', 'ink-muted', 'clay']) {
  for (const background of ['paper', 'paper-deep', 'surface', 'surface-elevated', 'surface-hover', 'clay-light']) {
    test(`${foreground} on ${background} meets 4.5:1 without rounding`, () => {
      assert.ok(contrast(value(foreground), value(background)) >= 4.5)
    })
  }
}
for (const background of ['action-fill', 'action-hover']) {
  test(`primary button text on ${background} meets 4.5:1`, () => {
    assert.ok(contrast(value('on-accent'), value(background)) >= 4.5)
  })
}
for (const name of ['success', 'warning', 'danger']) {
  test(`${name} has a readable paired background`, () => {
    assert.ok(contrast(value(name), value(name + '-light')) >= 4.5)
  })
}
for (const background of ['paper-deep', 'surface', 'surface-elevated']) {
  test(`control boundaries on ${background} meet 3:1`, () => {
    assert.ok(contrast(value('control-border'), value(background)) >= 3)
  })
}
for (const [legacy, modern] of [['bg','paper'], ['fg','ink'], ['muted','ink-muted'], ['panel','surface'], ['accent','clay'], ['red','danger']]) {
  test(`legacy ${legacy} maps to ${modern}`, () => assert.equal(value(legacy), value(modern)))
}
test('dark surfaces use increasing luminance', () => {
  const levels = ['paper', 'paper-deep', 'surface', 'surface-elevated', 'surface-hover'].map(key => luminance(value(key)))
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1])
})
test('dark styles load after both existing presentation layers', async () => {
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
  assert.ok(main.indexOf("import './styles/dark-theme.css'") > main.indexOf("import './styles/editor-document.css'"))
  assert.ok(main.includes('initializeThemeFromStorage()'))
})
test('favicon is packaged locally without relaxing the CSP', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('href="/brand/icon.png"'))
  assert.ok(html.includes("script-src 'self';"))
  assert.ok(!html.includes("script-src 'self' 'unsafe-inline'"))
})
test('styles preserve transparent code input and avoid global inversion', () => {
  assert.ok(css.includes('-webkit-text-fill-color: transparent'))
  assert.ok(css.includes('caret-color: var(--ink) !important'))
  assert.ok(!/filter:\s*(invert|brightness)/.test(css))
})
test('master is valid indexed PNG with transparent margins and opaque artwork', () => {
  const image = decodeBrandPng(source)
  assert.equal(image.width, 256); assert.equal(image.height, 256)
  assert.equal(image.rgba[3], 0)
  assert.ok(image.rgba.some((n, i) => i % 4 === 3 && n === 255))
})
test('decoder rejects damaged or truncated sources', () => {
  assert.throws(() => decodeBrandPng(source.subarray(0, 32)))
  const damaged = Buffer.from(source); damaged[100] ^= 1
  assert.throws(() => decodeBrandPng(damaged), /CRC/)
  assert.throws(() => decodeBrandPng(Buffer.alloc(12)))
})
test('invalid data URLs cannot silently generate blank branding', () => {
  assert.throws(() => buildBrandAssets('data:image/png;base64,wrong'))
  assert.throws(() => buildBrandAssets('data:image/svg+xml,<svg/>'))
})
test('invalid output sizes are rejected', () => {
  const image = decodeBrandPng(source)
  for (const size of [0, -1, NaN, 1.5, 512]) assert.throws(() => resizeBrandImage(image, size))
})
function inspectRgbaPng(bytes, size) {
  assert.equal(bytes.readUInt32BE(16), size)
  assert.equal(bytes.readUInt32BE(20), size)
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6)
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    assert.equal(bytes.readUInt32BE(offset + length + 8), crc32(bytes.subarray(offset + 4, offset + length + 8)))
    offset += length + 12
  }
}
for (const size of ICON_SIZES) {
  test(`ICO contains a valid ${size}px 32-bit PNG frame`, () => {
    const { ico } = buildBrandAssets()
    const entry = 6 + ICON_SIZES.indexOf(size) * 16
    assert.equal(ico[entry] || 256, size)
    assert.equal(ico[entry + 1] || 256, size)
    assert.equal(ico.readUInt16LE(entry + 6), 32)
    const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12)
    inspectRgbaPng(ico.subarray(offset, offset + length), size)
  })
}
test('brand generation is deterministic and SVG embeds the exact source', () => {
  const a = buildBrandAssets(), b = buildBrandAssets()
  assert.deepEqual(a, b)
  assert.equal(a.png.compare(source), 0)
  assert.ok(a.svg.includes(APP_ICON_DATA_URL))
  assert.equal(a.ico.readUInt16LE(4), ICON_SIZES.length)
})
test('small icons preserve transparent outside pixels and visible content', () => {
  const image = resizeBrandImage(decodeBrandPng(source), 16)
  assert.equal(image.rgba[3], 0)
  assert.ok(image.rgba[(8 * 16 + 8) * 4 + 3] > 240)
  inspectRgbaPng(encodeRgbaPng(image), 16)
})
test('preparation creates identical packaging and favicon assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'notepad-brand-'))
  try {
    await prepareBrandAssets(root)
    for (const name of ['icon.png', 'icon.ico', 'icon.svg']) {
      assert.deepEqual(await readFile(path.join(root, 'build', name)), await readFile(path.join(root, 'src/public/brand', name)))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('every supported build and dev entry prepares fresh brand assets', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of ['prebuild', 'prebuild:renderer', 'prebuild:main', 'predev', 'predev:all']) {
    assert.equal(pkg.scripts[name], 'npm run prepare:brand')
  }
  assert.equal(pkg.build.win.icon, 'build/icon.ico')
  assert.ok(pkg.build.files.includes('build/icon.png'))
})
test('brand tests are added without removing the existing UI gates', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.scripts['test:ui'].startsWith('npm run test:brand && npm run test:installer && npm run test:entity-core && vitest run'))
  assert.ok(pkg.scripts['test:ui'].includes('src/components/ResearchTasksPanel.test.jsx'))
  assert.equal(pkg.scripts['test:editor'], 'vitest run --root=. src/components/Editor/')
})
