/**
 * Render ground-truth note lists (JSON {notes:[{pitch,start,end,velocity}]}) to WAV with the
 * Salamander Grand Piano samples (CC BY 3.0) through Tone.js in headless Chromium.
 *
 *   npm i --no-save tone@15
 *   node scripts/devset/render.cjs node_modules/tone/build/Tone.js <out-dir> <clip.json>...
 *
 * "Cover" versions (reverb, compression, limiting, MP3 128k) are made with ffmpeg, see README.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const [toneJs, outDir, ...inputs] = process.argv.slice(2)
;(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } })
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage()
  await page.goto('https://tonejs.github.io/', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ path: toneJs })
  for (const inp of inputs) {
    const clip = JSON.parse(fs.readFileSync(inp, 'utf8'))
    const notes = clip.notes
    const dur = Math.max(...notes.map((n) => n.end)) + 1.5
    const data = await page.evaluate(async ({ notes, dur }) => {
      const Tone = window.Tone
      const urls = {}
      for (const n of ['A0','C1','D#1','F#1','A1','C2','D#2','F#2','A2','C3','D#3','F#3','A3','C4','D#4','F#4','A4','C5','D#5','F#5','A5','C6','D#6','F#6','A6','C7','D#7','F#7','A7','C8']) urls[n] = n.replace('#', 's') + '.mp3'
      const buf = await Tone.Offline(async () => {
        const s = new Tone.Sampler({ urls, release: 0.8, baseUrl: 'https://tonejs.github.io/audio/salamander/' }).toDestination()
        await Tone.loaded()
        for (const n of notes) s.triggerAttackRelease(Tone.Frequency(n.pitch, 'midi').toNote(), Math.max(0.05, n.end - n.start), n.start, n.velocity / 127)
      }, dur, 1, 44100)
      return Array.from(buf.getChannelData(0))
    }, { notes, dur })
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v))
    const pcm = Buffer.alloc(44 + data.length * 2)
    pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + data.length * 2, 4); pcm.write('WAVEfmt ', 8)
    pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(44100, 24)
    pcm.writeUInt32LE(88200, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(data.length * 2, 40)
    // MAESTRO-like level: peak around -10 dBFS
    data.forEach((v, i) => pcm.writeInt16LE(Math.round((v / (peak || 1)) * 0.3 * 32767), 44 + i * 2))
    const name = path.basename(inp, '.json')
    fs.writeFileSync(path.join(outDir, name + '.wav'), pcm)
    console.log('rendered', name, dur.toFixed(1))
  }
  await browser.close()
})()
