# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Song search backed by the BitMIDI library with client-side re-ranking (title match, popularity, piano boost) and quick-pick chips.
- MIDI parsing with automatic melody/piano track detection and per-bar timing.
- Practice screen: canvas falling notes, multi-touch piano, Watch / Wait for me / Play along modes, accuracy and streak scoring, results card.
- Parts: Easy melody (skyline extraction + octave folding), Right hand, Left hand, Both hands, with the other hand auto-played.
- Letter-notes view (TikTok-tutorial style) with live highlighting and tap-to-seek.
- Speed control, A/B loop, scrubber, adjustable fall speed, track picker, backing-instrument toggle.
- MIDI file import (picker + drag and drop) and an on-device song library with favorites and best scores (IndexedDB).
- Seven built-in public-domain songs for offline use.
- Optional "Learn notes" section: 7 lessons with intro slides, drills, and star ratings (keyboard layout, white keys, sharps/flats, octaves, treble clef, bass clef, ear training).
- Input from on-screen keys, computer keyboard, and Web MIDI devices.
- Sampled grand piano (smplr) with cached samples and a synth fallback; iOS silent-switch workaround.
- Installable PWA for Android and iOS: manifest, icons, service worker with offline caching for the app shell, MIDI files, samples and fonts.
- GitHub Pages deploy workflow with configurable `BASE_PATH`.
