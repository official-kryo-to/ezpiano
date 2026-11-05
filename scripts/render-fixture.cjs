/**
 * Renders the test/benchmark clip: Beethoven's Ode to Joy (public domain), 8 bars with a left-hand
 * pattern, slightly humanised, played by the Salamander Grand Piano samples (CC BY 3.0,
 * Alexander Holm) through Tone.js in headless Chromium. Writes <out>.wav and <out>.notes.json
 * (the exact notes, used as ground truth).
 *
 *   npm i --no-save tone@15
 *   node scripts/render-fixture.cjs tests/fixtures/ode node_modules/tone/build/Tone.js
 *
 * tests/fixtures/ode-to-joy-8s.wav is the first 8 s of this, resampled to 16 kHz mono.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const out = process.argv[2]
const toneJs = process.argv[3]
const BPM = 100, BEAT = 60 / BPM
// Ode to Joy (Beethoven), 8 bars of RH + LH root/chord pattern
const rh = 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2'
const chords = ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'G7C']
const CH = { C: ['C3', 'E3', 'G3'], G: ['G2', 'D3', 'G3'], G7C: null }
const PCS = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
const midi = (n) => { const m = /^([A-G]#?)(\d)$/.exec(n); return (parseInt(m[2]) + 1) * 12 + PCS[m[1]] }
let rnd = 7; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647)
const notes = []
let t = 0.5
for (const tok of rh.split(' ')) {
  const [n, b] = tok.split(':'); const d = parseFloat(b) * BEAT
  notes.push({ pitch: midi(n), start: t + (rand() - 0.5) * 0.02, end: t + d * 0.92, velocity: Math.round(78 + rand() * 22) })
  t += d
}
chords.forEach((c, bar) => {
  const t0 = 0.5 + bar * 4 * BEAT
  const halves = c === 'G7C' ? [['G2', 'F3', 'B3'], ['C3', 'E3', 'G3']] : [CH[c], CH[c]]
  halves.forEach((ch, h) => {
    const ts = t0 + h * 2 * BEAT
    // bass on the beat, chord on the off-beat
    notes.push({ pitch: midi(ch[0]), start: ts + (rand() - 0.5) * 0.02, end: ts + 2 * BEAT * 0.95, velocity: Math.round(62 + rand() * 14) })
    for (const n of ch.slice(1)) notes.push({ pitch: midi(n), start: ts + BEAT + (rand() - 0.5) * 0.02, end: ts + 2 * BEAT * 0.9, velocity: Math.round(48 + rand() * 12) })
  })
})
notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
const dur = Math.max(...notes.map((n) => n.end)) + 1.2
;(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } })
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage()
  await page.goto('https://tonejs.github.io/', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ path: toneJs })
  const data = await page.evaluate(async ({ notes, dur }) => {
    const Tone = window.Tone
    const buf = await Tone.Offline(async () => {
      const s = new Tone.Sampler({
        urls: { A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3', A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3', C6: 'C6.mp3' },
        release: 0.6,
        baseUrl: 'https://tonejs.github.io/audio/salamander/',
      }).toDestination()
      await Tone.loaded()
      for (const n of notes) s.triggerAttackRelease(Tone.Frequency(n.pitch, 'midi').toNote(), n.end - n.start, n.start, n.velocity / 127)
    }, dur, 1, 44100)
    return Array.from(buf.getChannelData(0))
  }, { notes, dur })
  await browser.close()
  // 16-bit PCM WAV at 44.1 kHz
  const pcm = Buffer.alloc(44 + data.length * 2)
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + data.length * 2, 4); pcm.write('WAVEfmt ', 8)
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(44100, 24)
  pcm.writeUInt32LE(88200, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(data.length * 2, 40)
  let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v)); peak = peak || 1
  data.forEach((v, i) => pcm.writeInt16LE(Math.round((v / peak) * 0.89 * 32767), 44 + i * 2))
  fs.writeFileSync(out + '.wav', pcm)
  fs.writeFileSync(out + '.notes.json', JSON.stringify(notes))
  console.log('rendered', dur.toFixed(1), 's,', notes.length, 'notes, peak', peak.toFixed(3))
})()
