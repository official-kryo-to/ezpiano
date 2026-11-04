// Renders public/icon.svg to the PNG sizes a PWA needs (Android + iOS).
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Playwright is not a project dependency; use whatever copy is installed on the machine.
const { chromium } = createRequire(import.meta.url)('playwright')

const svg = readFileSync(resolve('public/icon.svg'), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()

async function render(size, out, { pad = 0, bg = 'transparent' } = {}) {
  await page.setViewportSize({ width: size, height: size })
  const inner = size - pad * 2
  await page.setContent(
    `<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  )
  await page.screenshot({ path: resolve('public', out), omitBackground: bg === 'transparent' })
}

await render(192, 'pwa-192.png')
await render(512, 'pwa-512.png')
// maskable: keep art inside the safe zone on a solid background
await render(512, 'pwa-maskable-512.png', { pad: 56, bg: '#070812' })
// iOS ignores transparency, so fill it
await render(180, 'apple-touch-icon.png', { bg: '#070812' })
await browser.close()
console.log('icons written')
