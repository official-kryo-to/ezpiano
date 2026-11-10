# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Audio to MIDI converter: drop or pick an MP3, WAV, M4A or FLAC file and get a two-hand `.mid` built for the Yamaha EZ-220.
- In-browser piano transcription with the ByteDance high-resolution piano model (Kong et al.), exported to a 20.8 MB int8 ONNX file by `scripts/export_model.py`, run with onnxruntime-web in a Web Worker (WebGPU when available, multi-threaded WebAssembly otherwise).
- Spotify Basic Pitch as a lazily loaded fallback for non-piano recordings.
- Web Audio decoding and resampling to the model rate, with chunked processing for long files.
- Note cleanup: merges repeated fragments, drops notes under 60 ms, ghost notes and octave ghosts, trims leading silence, clamps velocity to 40 to 110.
- Tempo and beat detection from transcribed onsets (inter-onset histogram, beat tracking, downbeat), with a tempo map for performances that drift.
- Arranging: skyline melody for the right hand, the rest for the left, chord detection for simple left-hand chords, polyphony caps per hand.
- Settings: Output (Melody only, Melody + simple chords, Full transcription), Difficulty (Easy, Medium, Original), Transpose -12 to +12 with auto-transpose to C major / A minor, Quantize to beat, Recording type. The last choice is remembered.
- EZ-220 MIDI output: Type 1, "Right Hand" on channel 1 and "Left Hand" on channel 2, Acoustic Grand, every note within C2 to C7 (octave-shifted, never dropped), detected BPM and 4/4 in the header, `<name>_ez220.mid` file name.
- Progress screen with named stages, overall progress and a time estimate; conversions can be cancelled.
- Result and practice screen: falling notes over a 61-key keyboard (C2 to C7), play/pause, scrubber, speed 25 to 150%, A/B loop, Download .mid, and instant re-arranging without re-running the model.
- Keyboard lights over Web MIDI: device picker with remembered choice and clear status, Watch and Wait for me modes, Right / Left / Both hands on channel 1 with the other hand played by the app, "Keyboard plays the guide notes" toggle (CC 7 = 0 for silent lights, restored to 100 on exit, with a velocity 1 alternative), note-offs plus CC 123 on pause, stop, seek and leave, and a Test lights button.
- Reads key presses from the keyboard's MIDI output for Wait for me mode; on-screen and computer keys work too.
- Recent list of converted songs stored in IndexedDB, with reopen, download and remove.
- Service worker (Workbox injectManifest) that adds COOP/COEP headers on GitHub Pages so WebAssembly can use several threads, and caches the model and runtime on first use (CacheFirst, not precached).
- New dark, glass-panel design with Inter (self-hosted), design tokens in plain CSS, visible focus states, keyboard navigation and reduced-motion support. New app icon.
- Vitest suite that converts a bundled 8 s piano clip with the real model and checks tracks, channels, key range, polyphony, tempo and quantization.
- Benchmark scripts (`scripts/benchmark.ts`, `scripts/benchmark_eval.py`) comparing the piano model with Basic Pitch using mir_eval.
- Keyboard profiles with auto-detection from the USB device name: Yamaha EZ-220 / EZ-200 (lights on channel 1), Yamaha EZ-300 / EZ-310 (channels 1 and 2), Casio LK series (channels 4 and 3), and 88, 76, 61, 49, 37 and 25-key keyboards without lights. The profile sets the key range, the light and file channels and the file name suffix; it can be overridden in settings.
- Metronome (accented on beat 1) and an app volume slider on the practice screen.
- Note names on falling notes and on the keys to press, red and green key feedback in Wait for me.
- Automatic reconnect to a keyboard that was allowed before.
- Loudness check before transcription: mastered covers louder than -20 dBFS are turned down to the training level of the model.
- Echo removal in cleanup: delay effects (common in ambient and lo-fi covers) made every echo a new key press; evenly spaced, fading repeats of a key are now merged into the note that was played.
- Arrangement controls (difficulty and output) on the practice screen that re-arrange instantly, with a hint when an arrangement is busy.
- Listen to a browser tab (search for a song, play it in another tab, ezpiano records the tab's sound) and record from the microphone, both straight into the converter.
- Android share target ("Share to ezpiano") and desktop file handling for the installed app.
- Rename songs by clicking the title; downloads use the new name.
- Faster start: the model and runtime load and the audio decodes while the settings are open; silent windows skip the model; up to 8 threads on machines with more cores.
- The app checks for updates every 30 minutes while open.
- Play the original recording in sync with the falling notes and key lights (Watch mode, any speed); the recording is stored with the song.
- Parts: the song is split into parts of a few bars that loop with one click; Wait for me scores each run, saves the best score per part and can move on to the next part at 90%.
- "Rhythm looks off?" controls: count the beat at half or double speed, 3 or 4 beats in a bar (written to the MIDI file), move the bar line.
- Triplet-feel detection (shuffle, 12/8) with a triplet quantize grid.
- Live preview of the notes while a song converts; the screen stays on while converting or playing.
- WebGPU safety: software GPU adapters are skipped, a slow GPU is raced against the CPU on the second window and the faster one is kept, a GPU whose output differs from the CPU's is dropped; `?gpu=off` override.
- Dev-set tooling in `scripts/devset/` (POP909 excerpts rendered as piano covers) and tests for keyboard profiles, ranges, channels and melody quality.

### Changed
- Melody (right hand) is now found by dynamic programming over loudness, contour and chord position instead of always taking the top note: melody F1 0.51 to 0.67 on held-out pop songs.
- Key detection uses Temperley profiles for the key signature and Albrecht-Shanahan profiles for major vs minor: 97% of keys right on the dev set (was 90%).
- Tempo prior moved to 80 BPM, downbeats weighted towards accented and bass notes, and a half-beat check keeps syncopated songs on the beat.
- Wait for me: notes of both hands that land together are one chord, playing a little early counts without the song jumping ahead, the next chord stays lit while paused and pressing it starts the song, wrong keys only count while the song is waiting.
- The quantize grid follows the tempo: slow songs get sixteenths on Easy (thirty-seconds on Medium), which keeps notes where they are played. Easy right hand vs the real lead on held-out songs: 0.689 to 0.799.
- Melody weights re-tuned against both lead lines (vocal melody and instrumental lead).
- Re-arranging on the practice screen keeps your place in the song.
- New app icon.
- Easy is now the default difficulty, and Full transcription is described as a busy reference rather than something to learn from.
- Settings: the Convert button stays visible while scrolling; the header shows the detected keyboard and connects on click.

### Fixed
- Cleanup no longer deletes short notes in fast or staccato playing (it removed half the notes of a Scarlatti sonata); weak short notes are still dropped, the rest get a playable length.
- Re-arranging a song now updates its note count and tempo in Recent.

### Removed
- BitMIDI song search and quick picks.
- Built-in public-domain songs.
- "Learn notes" lessons and drills.
- Previous practice screen (letter-notes view, play-along scoring, track picker) and the old song library.
- Google Fonts dependency (Inter is now bundled).
