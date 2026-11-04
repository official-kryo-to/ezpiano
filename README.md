# ezpiano

Learn any song on piano without digging through TikTok tutorials. Type a song, ezpiano finds a MIDI for it, and turns it into falling notes, letter notes, and a "wait for me" mode that pauses until you hit the right key.

Installable as an app on **Android** and **iPhone/iPad** (PWA), works offline for songs you've already opened.

## Features

### Songs
- **Search any song.** Queries the free [BitMIDI](https://bitmidi.com) library (CORS-enabled, no backend needed) and re-ranks results by title match + popularity, boosting piano versions.
- **Smart part picking.** Detects the melody track in full-band MIDIs, or the piano tracks in piano pieces.
- **Easy melody mode** (default for searched songs): strips chords and accompaniment down to a single top line and moves it to the middle of the keyboard.
- **Right hand / Left hand / Both hands**, with the other hand played for you.
- **Three practice modes:**
  - *Watch & listen*: auto-play with keys lighting up.
  - *Wait for me*: notes stop at the line until you press the glowing key.
  - *Play along*: real time, with accuracy % and streaks.
- **Letter view:** the song as `E4 D#4 E4 …`, bar by bar, the format TikTok tutorials use. Tap any letter to jump there.
- Speed 25 to 150%, A/B loop for hard bits, scrubbing, adjustable fall speed.
- Import any `.mid` file (tap or drag and drop). Every opened song is saved to the device.
- 7 built-in public-domain songs that work offline on first launch.

### Learn notes (optional, separate tab)
Seven short game-like lessons with stars: finding keys from the black-key pattern, white keys, sharps and flats, middle C and octaves, treble clef, bass clef, and ear training.

### Input
- Multi-touch on-screen keyboard with glissando.
- Computer keyboard: `A W S E D F T G Y H U J K O L P ; '`, `Z`/`X` to shift octave, `Space` to play/pause, arrows to seek.
- USB/Bluetooth **MIDI keyboards** via Web MIDI (Chrome/Edge on Android and desktop; not supported by Safari on iOS).

### Sound
Sampled Steinway grand via [smplr](https://github.com/danigb/smplr), cached for offline use, with an instant built-in synth fallback. iOS silent-switch workaround included.

## Develop

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build into dist/
npm run preview   # serve the build (service worker active)
npm run icons     # re-render PWA icons from public/icon.svg (needs Playwright)
```

## Deploy

- **GitHub Pages:** `.github/workflows/deploy.yml` builds on every push to `main`. Enable it once in *Settings → Pages → Source: GitHub Actions*. The app lands at `https://<user>.github.io/<repo>/`.
- **Vercel / Netlify / Cloudflare Pages:** framework preset *Vite*, build `npm run build`, output `dist`. No env vars needed.

`BASE_PATH` controls the sub-path (defaults to `/`).

## Install on a phone

- **Android (Chrome):** open the site, then ⋮ menu → *Install app* (or use the button in Settings).
- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.

## Stack

React 19, TypeScript, Vite 8, vite-plugin-pwa (Workbox), @tonejs/midi, smplr, idb-keyval, lucide-react. No backend.

## Notes

- BitMIDI's catalog skews older; very recent hits may be missing. The search screen links out to MuseScore and a web search, and the imported `.mid` works the same way.
- Respect the copyright of the songs you play. ezpiano doesn't host any song files.
