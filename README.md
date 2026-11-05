# ezpiano

**Audio in, learnable MIDI out, practised with the keys lighting up on a Yamaha EZ-220.**

Drop a recording (piano covers work best). ezpiano transcribes it in your browser with a piano-specific
neural network, arranges it for two hands at the difficulty you pick, and gives you a `.mid` file built
for the EZ-220. Then practise it on the same page: notes fall onto a 61-key keyboard and the real keys
light up over USB, either in time ("Watch") or one chord at a time until you play it ("Wait for me").

Everything runs client-side. No upload, no server, no account. It is a static site (GitHub Pages) and an
installable PWA.

## How to use it

1. Open the site and drop an audio file (MP3, WAV, M4A or FLAC), or choose one.
2. Pick the settings and press **Convert**:
   - **Output**: Melody only / Melody + simple chords (default) / Full transcription
   - **Difficulty**:
     - *Easy*: one right-hand note at a time, left hand plays chord roots or two-note shapes on beat 1, quantized to 1/8
     - *Medium*: up to 3 notes per hand, quantized to 1/16
     - *Original*: light cleanup only
   - **Transpose**: -12 to +12 semitones, or **Auto-transpose** to C major / A minor
   - **Quantize to the beat**: on by default
   - **Recording**: Piano (default) or Other instruments (uses Basic Pitch)
3. Watch the progress (named stages and a time estimate).
4. On the result screen, preview with falling notes, change speed, loop a section, and press **Download .mid**.
   **Arrangement** lets you change output, difficulty and transpose afterwards. That takes milliseconds, because the
   raw transcription is kept.
5. Converted songs are saved on the device (IndexedDB) under **Recent**.

Your last settings are remembered.

## Using it with the Yamaha EZ-220

1. Connect the EZ-220's **USB TO HOST** port to your computer or Android phone with a USB cable (USB-B on the keyboard side).
2. Open ezpiano in **Chrome or Edge** (Web MIDI). Safari on iPhone and iPad has no Web MIDI, so the keyboard panel is
   hidden there; converting and downloading still work.
3. Open a song, then **Connect keyboard** in the "Keyboard lights" panel and allow MIDI access. The output and input
   devices are picked automatically and remembered.
4. Choose a mode and hands:
   - **Watch**: the song plays and the keys light up in time.
   - **Wait for me**: playback stops at every note or chord of the hand(s) you practise. The keys to press are lit;
     press them on the EZ-220 (ezpiano reads its MIDI output) and the song moves on. Play ahead and it follows you.
   - **Right / Left / Both**: the practised hand(s) light up on **channel 1**, the only channel the EZ-220 lights keys
     for. If you practise one hand, the other hand plays from the app.
5. **Speed** (25 to 150%) and **A/B loop** work in both modes.

### Sound routing (no double notes)

- Notes sent to the keyboard are never also played by the app.
- **"Keyboard plays the guide notes"** (off by default): when off, ezpiano sends **CC 7 = 0** (volume) on channel 1
  so the keys light silently; leaving the practice screen restores **CC 7 = 100**. In Watch mode the app then
  plays the lit notes itself, so you still hear the whole song. When on, the keyboard sounds them and the app stays
  quiet for those notes.
- Your own playing on the EZ-220 is never echoed through the app.
- On pause, stop, seek or leaving the page, ezpiano sends note-off for every lit key plus **CC 123 (All Notes Off)**.

> **Check this on real hardware.** Muting with CC 7 = 0 has not been verified on a physical EZ-220 yet. If the
> lights stop working at volume 0 (or your own playing goes quiet too), set **Silent lights method** to
> **Velocity 1** in the Keyboard lights panel: lit notes are then sent at velocity 1 and the volume is left alone.
> **Test lights** runs a C major scale so you can check quickly.

### The MIDI file

- Type 1, two tracks: **"Right Hand" on MIDI channel 1** and **"Left Hand" on channel 2**, both Acoustic Grand
  (program 0). If you play the file to the EZ-220 from a computer, the right hand lights up.
- Every note fits the 61 keys (MIDI 36 to 96, C2 to C7). Out-of-range notes are moved by octaves, never dropped.
- The detected BPM and 4/4 are written to the header. Notes sit on the detected beat grid, so bars line up in any
  DAW. Performances that drift get a tempo map that follows the player.
- File name: `<original name>_ez220.mid`.

## How it works

```
audio file
  -> Web Audio decode, resampled to 16 kHz mono (OfflineAudioContext; 30 s chunks if needed)
  -> Web Worker: onnxruntime-web (WebGPU if available, else multi-threaded WebAssembly)
       piano model on 10 s windows, 7.5 s apart, stitched -> onset/offset/frame/velocity rolls (100 fps)
       -> notes (port of the reference post-processing)
  -> cleanup: merge repeated fragments, drop notes < 60 ms, drop ghost notes (incl. octave ghosts)
  -> tempo: inter-onset-interval histogram + dynamic-programming beat tracker + downbeat (chord changes, bass)
  -> hands: skyline melody = right hand, the rest = left hand (Full keeps close inner voices in the right hand),
     difficulty rules, chord detection for the left-hand chords, quantize, transpose / auto key, octave-fit to
     C2..C7, polyphony caps (max 4 per hand)
  -> @tonejs/midi writer
```

The UI thread never runs the model. GitHub Pages can't send the COOP/COEP headers that WebAssembly threads need,
so the service worker adds them to the page it serves. After the first load the page is cross-origin isolated
and conversion uses several CPU cores.

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
