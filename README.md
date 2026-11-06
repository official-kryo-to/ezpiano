# ezpiano

**Audio in, learnable MIDI out, practised with the keys lighting up on your keyboard.**

Drop a recording (piano covers work best). ezpiano transcribes it in your browser with a piano-specific
neural network, arranges it for two hands at the difficulty you pick, and gives you a `.mid` file built
for your keyboard. Then practise it on the same page: notes fall onto the keyboard on screen and the real
keys light up over USB, either in time ("Watch") or one chord at a time until you play it ("Wait for me").

Built for the Yamaha EZ-220, and it also lights the keys on the Yamaha EZ-200, EZ-300 and EZ-310 and the
Casio LK series. Any USB MIDI keyboard or digital piano works for Wait for me.

Everything runs client-side. No upload, no server, no account. It is a static site (GitHub Pages) and an
installable PWA.

## How to use it

1. Open the site and drop an audio file (MP3, WAV, M4A, FLAC or a recording), or choose one. No file?
   - **Find a song and let ezpiano listen** (Chrome / Edge on a computer): search opens in a new tab; play
     the video there, press **Listen to a tab**, pick that tab and turn on "Also share tab audio".
   - **Record with the microphone**: play the song on a speaker nearby, or play it yourself.
   - **Share from another app** (Android, installed app): Share → ezpiano on any audio file. On a computer,
     the installed app can open audio files directly ("Open with").

   ezpiano does not download from YouTube or other sites: a static site can't, and their terms don't allow it.
   Listening to a tab records what plays, in real time, on your device only.
2. Pick the settings and press **Convert**:
   - **Output**: Melody only / Melody + simple chords (default) / Full transcription
   - **Difficulty** (default Easy):
     - *Easy*: one right-hand note at a time, left hand plays chord roots or two-note shapes on beat 1, quantized to 1/8
     - *Medium*: up to 3 notes per hand, quantized to 1/16
     - *Original*: light cleanup only
   - **Transpose**: -12 to +12 semitones, or **Auto-transpose** to C major / A minor
   - **Keyboard**: Auto (detected from the USB device) or a model; sets the key range and channels
   - **Quantize to the beat**: on by default
   - **Recording**: Piano (default) or Other instruments (uses Basic Pitch)
3. Watch the progress (named stages and a time estimate).
4. On the result screen, preview with falling notes, change speed, loop a section, turn on the metronome, and
   press **Download .mid**. Difficulty and output can be switched right there (and transpose under
   **Arrangement**). That takes milliseconds, because the raw transcription is kept.

   If a result feels like too much at once, use **Easy** with **Chords**: one tune note at a time and one chord per
   bar. **Full** keeps every note the model heard, which is useful as a reference but busy to learn from.
5. Converted songs are saved on the device (IndexedDB) under **Recent**. Click a song's title to rename it.

Your last settings and keyboard are remembered.

## Keyboards

ezpiano picks a profile from the USB device name; you can override it under **Keyboard model**.

| Keyboard | Keys | Keys light for | Exported file |
|---|---|---|---|
| Yamaha EZ-220 / EZ-200 (default) | 61 (C2 to C7) | channel 1 (practised hands share it) | Right Hand ch 1, Left Hand ch 2 |
| Yamaha EZ-300 / EZ-310 | 61 | channel 1 right hand, channel 2 left hand (Light Part 1 and 2) | ch 1 / ch 2 |
| Casio LK series (LK-S250, LK-S450, LK-280...) | 61 | channel 4 right hand, channel 3 left hand (Navigate channels) | ch 4 / ch 3 |
| 88 / 76 / 61 / 49 / 37 / 25-key keyboards and controllers | as named | no key lights | ch 1 / ch 2 |

- **Auto-detection** works from the port name: Yamaha keyboards show up as "Digital Keyboard", Casio as
  "CASIO USB-MIDI", controllers usually include their key count (for example "Keystation 88", "Launchkey 49").
- **The profile sets** the playable range: notes are moved by octaves to fit, never dropped. It also sets the
  channels for lights and for the exported file, and the file name (`<song>_ez220.mid`, `<song>_casio-lk.mid`,
  `<song>_88key.mid`...).
- **Casio keyboards** all report the same USB name, so a Casio without key lights is detected as LK. Pick its key
  count instead.

## Practising with your keyboard

1. Connect the keyboard's USB port (on the EZ-220: **USB TO HOST**) to your computer or Android phone.
2. Open ezpiano in **Chrome or Edge** (Web MIDI). Safari on iPhone and iPad has no Web MIDI, so the keyboard panel
   is replaced by a short note there; converting and downloading still work.
3. Press **Connect keyboard** (in the header or the Keyboard panel) and allow MIDI access once. Next time ezpiano
   reconnects by itself.
4. Choose a mode and hands:
   - **Watch**: the song plays and the keys light up in time.
   - **Wait for me**: the song stops at every note or chord of the hand(s) you practise until you play it.
     - The next chord is highlighted on screen with its note names and lit on the keyboard, even while paused.
     - Pressing it starts the song, so there's no need to hit play first.
     - Playing up to about a beat early counts, and the song simply carries on.
     - Notes of both hands that land together count as one chord.
     - Wrong keys flash red on screen, right ones green.
   - **Right / Left / Both**: if you practise one hand, the other hand plays from the app.
5. **Speed** (25 to 150%), **A/B loop**, **Metronome** and **App volume** work in both modes.

Without a MIDI keyboard you can still practise: play on the on-screen keys or with the computer keyboard
(A W S E D F T G Y H U J K, Z / X change octave).

### Sound routing (no double notes)

- Notes sent to the keyboard are never also played by the app.
- **"Keyboard plays the guide notes"** (off by default): when off, ezpiano sends **CC 7 = 0** (volume) on the light
  channels so the keys light silently; leaving the practice screen restores **CC 7 = 100**. In Watch mode the app
  then plays the lit notes itself, so you still hear the whole song. When on, the keyboard sounds them and the app
  stays quiet for those notes.
- Your own playing on the keyboard is never echoed through the app.
- On pause, stop, seek or leaving the page, ezpiano sends note-off for every lit key plus **CC 123 (All Notes Off)**.

> **Check this on real hardware.** Muting with CC 7 = 0 has not been verified on a physical keyboard yet. If the
> lights stop working at volume 0 (or your own playing goes quiet too), set **Silent lights method** to
> **Velocity 1** in the Keyboard panel: lit notes are then sent at velocity 1 and the volume is left alone.
> **Test lights** runs a scale for each hand so you can check quickly.

### The MIDI file

- Type 1, two tracks: **"Right Hand"** and **"Left Hand"**, both Acoustic Grand (program 0), on the channels of your
  keyboard profile (EZ-220: right hand on channel 1, which lights up if you play the file to the keyboard from a
  computer).
- Every note fits the keyboard's range (EZ-220: MIDI 36 to 96, C2 to C7), moved by octaves, never dropped.
- The detected BPM and 4/4 are written to the header. Notes sit on the detected beat grid, so bars line up in any
  DAW. Performances that drift get a tempo map that follows the player.

## How it works

```
audio file
  -> Web Audio decode, resampled to 16 kHz mono (OfflineAudioContext; 30 s chunks if needed)
  -> loudness check: mastered covers louder than -20 dBFS are turned down to the level the model was trained on
  -> Web Worker: onnxruntime-web (WebGPU if available, else multi-threaded WebAssembly)
       piano model on 10 s windows, 7.5 s apart, stitched -> onset/offset/frame/velocity rolls (100 fps)
       -> notes (port of the reference post-processing)
  -> cleanup: merge repeated fragments and delay-effect echoes, drop ghost and octave-ghost notes,
     give short staccato notes a playable length
  -> tempo: inter-onset-interval histogram + dynamic-programming beat tracker, on-beat check, downbeat (bass, accents, harmony)
  -> key: Temperley profiles for the key signature, Albrecht-Shanahan for major vs minor
  -> hands: melody by dynamic programming (loudness, contour, top of chord) = right hand, the rest = left hand,
     difficulty rules, chord detection for the left-hand chords, quantize, transpose / auto key,
     octave-fit to the keyboard, polyphony caps (max 4 per hand)
  -> @tonejs/midi writer
```

The UI thread never runs the model. GitHub Pages can't send the COOP/COEP headers that WebAssembly threads need,
so the service worker adds them to the page it serves. After the first load the page is cross-origin isolated
and conversion uses several CPU cores.

## Quality on pop piano covers

Clean classical recordings (the benchmark below) are the easy case. To tune ezpiano for what people actually
drop in, there's a dev set built from [POP909](https://github.com/music-x-lab/POP909-Dataset) (MIT): pop songs
arranged for piano with separate melody tracks plus beat, chord and key annotations.

- **Clips:** 32 excerpts of 40 s.
- **Audio:** rendered with a sampled grand, once clean and once as a typical "YouTube cover" (room reverb,
  compression and limiting to -13 dBFS, MP3 at 128 kbps).
- **Split:** weights were tuned on 16 songs; the table shows the other 16, never used for tuning.

| Held-out, cover-style audio | Before | After |
|---|---|---|
| Note F1 (onset 50 ms) | 0.885 | **0.921** |
| Melody F1 (right hand vs the real tune, 100 ms) | 0.504 | **0.675** |
| Beat F (70 ms) | 0.743 | **0.768** |
| Downbeat F | 0.608 | **0.632** |
| Chord root accuracy (left hand) | 0.892 | 0.894 |

**What made the difference**

- **Loudness check:** mastered covers are 10 to 15 dB louder than the model's training data. Turning them down
  to that level (-24 dBFS) removes many false notes:
  - note F1 on cover audio 0.895 to 0.926,
  - on a clean but loud copy 0.893 to 0.923.

  Recordings that are already at a normal level are left alone.
- **Melody by dynamic programming** instead of "always the top note": pop arrangements often have accompaniment
  above the tune.
- **Cleanup fix:** the old 60 ms minimum length deleted real notes in fast playing (a Scarlatti sonata went from
  F1 0.960 to 0.628 after cleanup). Now short notes are dropped only if they are also weak.
- **Tempo and key:**
  - a tempo prior around 80 BPM, downbeats weighted by accents and bass, and an on-beat check for syncopated
    songs (beat F on the tuning set 0.70 to 0.78),
  - key detection with Temperley + Albrecht-Shanahan profiles (exact key 90% to 97%).

Reproduce with `scripts/devset/` (prep, render, `eval.ts`).

## Model

**Primary: ByteDance "High-resolution Piano Transcription"** (Kong et al., 2021), the note model only (pedals unused).
`scripts/export_model.py` exports it to ONNX:

- It computes the STFT kernels in the graph instead of storing them (17 MB saved).
- It quantizes weights to int8 per output channel. This is weight-only: activations stay float32.
- It checks parity against PyTorch.

Result: **20.8 MB** (the original checkpoint is 172 MB), loaded lazily on the first conversion and cached by the
service worker (CacheFirst, not precached).

- Weights: **CC BY 4.0**, Zenodo record [4034264](https://zenodo.org/records/4034264).
- Model code and the post-processing ported to `src/engine/kong.ts`: **MIT**, [piano_transcription_inference](https://github.com/qiuqiangkong/piano_transcription_inference).
- Paper: Q. Kong, B. Li, X. Song, Y. Wan, Y. Wang, *High-resolution Piano Transcription with Pedals by Regressing Onset and Offset Times*, IEEE/ACM TASLP 2021.

**Fallback for non-piano audio: Spotify [Basic Pitch](https://github.com/spotify/basic-pitch-ts)** (`@spotify/basic-pitch`,
Apache-2.0). Loaded only when you choose "Other instruments".

### Benchmark: piano model vs Basic Pitch

Run with `scripts/benchmark.ts` and scored with mir_eval (`scripts/benchmark_eval.py`): note onset F1 (50 ms) and
onset+offset F1 (reference offsets extended by the sustain pedal). Three 20 to 30 s clips:

- two excerpts from MAESTRO v3 **test-split** recordings (Scarlatti K. 525, Schubert Op. 90 No. 4),
- one sampled-piano rendering of Ode to Joy with exact ground truth.

| Clip | System | Onset P | Onset R | Onset F1 | Onset+offset F1 |
|---|---|---|---|---|---|
| Scarlatti K. 525 | **Piano model (shipped)** | 0.971 | 0.948 | **0.960** | 0.851 |
| Scarlatti K. 525 | Basic Pitch | 0.790 | 0.529 | 0.634 | 0.104 |
| Schubert Op. 90/4 | **Piano model (shipped)** | 1.000 | 0.987 | **0.994** | 0.897 |
| Schubert Op. 90/4 | Basic Pitch | 0.808 | 0.806 | 0.807 | 0.475 |
| Ode to Joy (sampled piano) | **Piano model (shipped)** | 0.788 | 1.000 | **0.881** | 0.780 |
| Ode to Joy (sampled piano) | Basic Pitch | 0.763 | 0.949 | 0.846 | 0.480 |
| **Mean** | **Piano model (shipped)** | | | **0.945** | **0.843** |
| **Mean** | Basic Pitch | | | 0.762 | 0.353 |

- **int8 vs fp32:** quantization costs nothing measurable (mean onset F1 0.945 int8 vs 0.946 fp32).
- **Window spacing:** windows 7.5 s apart give the same onset F1 as the reference 5 s (onset+offset 0.843 vs 0.850)
  for about 20% less compute.
- **Caveats:** the piano model was trained on MAESTRO's train split, so MAESTRO test pieces are in-domain for it
  and phone recordings will score lower. On the sampled piano its errors are mostly octave "ghost" notes; the
  cleanup and melody extraction filter those out.

**Speed tricks that don't cost accuracy:**
- **Warm-up:** the runtime and the model load, and the audio decodes, while you are still on the settings
  screen.
- **Silence skip:** silent stretches skip the model.
- **More threads:** machines with more than 4 cores use up to 8 threads.

Tried and rejected because they cost accuracy:
- **Full int8 activations:** 1.7x faster, but note F1 after cleanup on real recordings fell from 0.973 to 0.941.
- **Windows 8.5 s apart:** melody F1 on cover audio fell from 0.656 to 0.645.

Batching windows and parallel branch execution gave no speed-up in WebAssembly.

**Speed:** about 5 s of compute per 10 s window on 4 CPU threads (WebAssembly; measured in Node). That is roughly
2 to 3 minutes for a 3-minute song on a laptop. Without cross-origin isolation (first visit, Safari) it runs
single-threaded, about 3x slower. WebGPU is used when available; its speed was not measured here.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (dev server sends the isolation headers too)
npm test           # vitest: converts tests/fixtures/ode-to-joy-8s.wav with the real model and checks the MIDI
npm run build      # type-check + production build into dist/
npm run preview    # serve the build with the service worker
npm run icons      # re-render PWA icons from public/icon.svg (needs Playwright)
```

### Re-export the model

```bash
python -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install onnx onnxruntime torchlibrosa librosa numpy audioread
pip install --no-deps piano_transcription_inference
python scripts/export_model.py --out public/models/kong-piano-int8.onnx   # downloads the checkpoint (172 MB)
```

### Dev set (pop covers)

```bash
git clone --depth 1 https://github.com/music-x-lab/POP909-Dataset
python -I scripts/devset/prep_pop909.py POP909-Dataset/POP909 devset/gt 003,027,051,088,120,154   # pip install mido
npm i --no-save tone@15 && node scripts/devset/render.cjs node_modules/tone/build/Tone.js devset/dry devset/gt/*.json
npx tsx scripts/devset/eval.ts devset/gt devset/dry
```

Cover-style versions: `ffmpeg -i in.wav -i ir.wav -filter_complex "[0][1]afir=dry=10:wet=10,acompressor=threshold=0.08:ratio=4:makeup=6,alimiter=limit=0.95"`
then an MP3 round trip at 128 kbps.

### Re-run the benchmark

```bash
npx tsx scripts/benchmark.ts <clips-dir> <out-dir> [fp32-model.onnx]
pip install mir_eval && python scripts/benchmark_eval.py <clips-dir> <out-dir>
```

`<clips-dir>` holds `name.wav` + `name.notes.json` pairs (`[{pitch, start, end, end_pedal}]`).

## Deploy

- **GitHub Pages**: `.github/workflows/deploy.yml` builds on every push to `main` with
  `BASE_PATH=/<repo>/`. In *Settings → Pages* choose *GitHub Actions*. If deploys from `main` are rejected, add
  `main` under *Settings → Environments → github-pages → Deployment branches*.
- **Anywhere else** (Netlify, Vercel, Cloudflare Pages): build `npm run build`, output `dist`. `BASE_PATH`
  defaults to `/`.

No file in the repo is over 100 MB (the largest is the 20.8 MB model). The WebAssembly runtime (15 MB, or 29 MB for
the WebGPU build) is downloaded on the first conversion and cached.

## Install as an app

- **Android (Chrome)**: menu ⋮ → *Install app*.
- **iPhone/iPad (Safari)**: Share → *Add to Home Screen*. Keyboard lights are not available on iOS.
- **Desktop (Chrome/Edge)**: install icon in the address bar.

## Stack

React 19, TypeScript, Vite 8, vite-plugin-pwa (Workbox, injectManifest), onnxruntime-web, @tonejs/midi,
@spotify/basic-pitch, smplr (in-app piano sound), idb-keyval, Inter (self-hosted). Plain CSS with design tokens.
