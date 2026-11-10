/**
 * Practice clock and routing. No React.
 *
 * Song time `t` follows the AudioContext clock scaled by `speed`. In "wait" mode the clock stops
 * at each chord of the practised hand(s) until the right keys are pressed.
 *
 * Who makes which sound:
 *  - the hand you are NOT practising is always played by the app
 *  - practised notes go to the keyboard as lights (on the profile's channels)
 *  - in Watch mode the app also plays the practised notes, unless the keyboard is set to play
 *    them ("Keyboard plays the guide notes"), so nothing ever sounds twice
 *  - in Wait mode practised notes are yours to play: the app stays quiet for them
 */
import { audio } from '../lib/audio'
import { midi } from '../lib/midi'
import type { ArrangedNote, Hand } from '../engine/types'

export type Mode = 'watch' | 'wait'
export type HandSel = Hand | 'both'

const LOOKAHEAD = 0.12 // s of song time scheduled ahead for audio
const MIDI_AHEAD = 0.025 // s: lights are scheduled with timestamps up to this far ahead
const CHORD_WINDOW = 0.08 // notes starting this close together are one chord
const FLASH_MS = 260

interface LightEvent {
  t: number
  on: boolean
  note: number
  vel: number
  hand: Hand
}

export interface Stats {
  hits: number
  wrong: number
}

export interface PassResult {
  a: number
  b: number
  hits: number
  wrong: number
  /** share of key presses that were right, 0..1 */
  accuracy: number
}

export class Player {
  all: ArrangedNote[] = []
  practiced: ArrangedNote[] = []
  chords: ArrangedNote[][] = []
  duration = 0
  mode: Mode = 'watch'
  hands: HandSel = 'both'
  speed = 1
  loop: { a: number; b: number } | null = null
  metronome = false
  /** beat times (s) and which are bar starts, for the metronome */
  beats: number[] = []
  beatsPerBar = 4
  private beatIdx = 0

  t = 0
  playing = false
  waiting = false
  finished = false
  chordIdx = 0
  stats: Stats = { hits: 0, wrong: 0 }
  /** recent key feedback for the on-screen keyboard */
  flashes = new Map<number, { kind: 'good' | 'bad'; until: number }>()

  private sound: ArrangedNote[] = []
  private lights: LightEvent[] = []
  private soundIdx = 0
  private lightIdx = 0
  private scheduledUntil = 0
  private ctxStart = 0
  private songStart = 0
  private chordHits = new Set<ArrangedNote>()
  private listeners = new Set<() => void>()

  /** the original recording, played in sync instead of the app's piano (Watch mode) */
  original: HTMLAudioElement | null = null
  /** song time 0 is this many seconds into the recording */
  originalOffset = 0
  useOriginal = false

  /** one run through the loop (or the whole song) in Wait for me, for progress tracking */
  private pass = { hits: 0, wrong: 0, from: 0 }
  onPass: ((p: PassResult) => void) | null = null

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  load(notes: ArrangedNote[], duration: number, beats: number[] = [], beatsPerBar = 4) {
    this.all = notes
    this.duration = duration
    this.beats = beats
    this.beatsPerBar = beatsPerBar
    this.finished = false
    this.reroute()
    this.seek(0)
  }

  /** Recompute what is practised, what the app plays and what lights up. */
  reroute() {
    const mine = (n: ArrangedNote) => this.hands === 'both' || n.hand === this.hands
    this.practiced = this.all.filter(mine)
    const others = this.all.filter((n) => !mine(n))
    const keyboardSings = midi.connected && midi.prefs.guideSound
    const appPlaysGuide = this.mode === 'watch' && !keyboardSings
    // with the original recording playing, the app's piano stays silent: the recording has every part
    this.sound = this.originalActive ? [] : (appPlaysGuide ? this.all : others).slice().sort((a, b) => a.start - b.start)
    this.lights = []
    if (this.mode === 'watch') {
      for (const n of this.practiced) {
        this.lights.push({ t: n.start, on: true, note: n.pitch, vel: n.velocity, hand: n.hand })
        this.lights.push({ t: Math.max(n.start + 0.02, n.end - 0.01), on: false, note: n.pitch, vel: 0, hand: n.hand })
      }
      // offs before ons at the same moment, so repeated notes re-light
      this.lights.sort((a, b) => a.t - b.t || Number(a.on) - Number(b.on))
    }
    this.chords = groupChords(this.practiced)
    if (midi.sendsGuide) midi.applyGuideVolume()
  }

  get originalActive() {
    return this.useOriginal && !!this.original && this.mode === 'watch'
  }

  setOriginal(el: HTMLAudioElement | null, offset = 0) {
    this.original?.pause()
    this.original = el
    this.originalOffset = offset
    if (!el) this.useOriginal = false
    this.reroute()
  }

  setUseOriginal(on: boolean) {
    this.useOriginal = on && !!this.original
    this.reroute()
    this.seek(this.t, true)
  }

  setMode(m: Mode) {
    this.mode = m
    this.stats = { hits: 0, wrong: 0 }
    this.reroute()
    this.seek(this.t)
  }

  setHands(h: HandSel) {
    this.hands = h
    this.reroute()
    this.seek(this.t)
  }

  setSpeed(s: number) {
    this.speed = Math.max(0.25, Math.min(1.5, s))
    if (this.playing) this.seek(this.t, true)
    this.emit()
  }

  setMetronome(on: boolean) {
    this.metronome = on
    this.beatIdx = this.beats.findIndex((b) => b >= this.t - 0.001)
    if (this.beatIdx < 0) this.beatIdx = this.beats.length
    this.emit()
  }

  setLoop(loop: { a: number; b: number } | null) {
    this.loop = loop && loop.b - loop.a > 0.3 ? loop : null
    if (this.loop && (this.t < this.loop.a || this.t > this.loop.b)) this.seek(this.loop.a)
    this.emit()
  }

  play() {
    audio.unlock()
    if (this.finished) {
      this.finished = false
      this.stats = { hits: 0, wrong: 0 }
      this.t = this.loop?.a ?? 0
    }
    this.playing = true
    this.seek(this.t)
  }

  pause() {
    this.playing = false
    this.silence()
    this.showNextChord()
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  /** Stop every sound and light (pause, seek, leave). */
  silence() {
    audio.stopAll()
    midi.allOff()
    this.original?.pause()
    this.waiting = false
  }

  /** Jump to a time. `keepPass` keeps the running Wait-for-me pass (speed or routing changes). */
  seek(t: number, keepPass = false) {
    this.t = Math.max(0, Math.min(t, this.duration))
    this.silence()
    if (!keepPass) this.pass = { hits: 0, wrong: 0, from: this.t }
    this.soundIdx = lowerBound(this.sound, this.t)
    this.scheduledUntil = this.t
    this.lightIdx = this.lights.findIndex((e) => e.t >= this.t)
    if (this.lightIdx < 0) this.lightIdx = this.lights.length
    this.chordIdx = this.chords.findIndex((c) => c[0].start >= this.t - 0.001)
    if (this.chordIdx < 0) this.chordIdx = this.chords.length
    this.chordHits.clear()
    this.beatIdx = this.beats.findIndex((b) => b >= this.t - 0.001)
    if (this.beatIdx < 0) this.beatIdx = this.beats.length
    this.anchor()
    if (this.playing && this.originalActive && this.original) {
      const el = this.original
      try {
        el.currentTime = Math.max(0, this.t + this.originalOffset)
        el.playbackRate = this.speed
        void el.play().catch(() => {})
      } catch {
        /* not ready yet: tick() re-syncs */
      }
    }
    if (this.mode === 'watch' && this.playing) {
      // keys that should already be down at this point
      for (const n of this.practiced) if (n.start < this.t && n.end > this.t) midi.lightOn(n.pitch, n.velocity, n.hand)
    }
    this.showNextChord()
    this.emit()
  }

  /** In wait mode the next chord stays lit, also while paused, so you can see where to start. */
  private showNextChord() {
    if (this.mode !== 'wait') return
    const c = this.chords[this.chordIdx]
    if (!c) return
    for (const n of c) midi.lightOn(n.pitch, n.velocity, n.hand)
  }

  private anchor() {
    this.ctxStart = audio.now
    this.songStart = this.t
  }

  private midiTime(songT: number) {
    // performance.now() and AudioContext time run on different clocks: map through "now"
    return performance.now() + Math.max(0, ((songT - this.t) / this.speed) * 1000)
  }

  /** The chord the learner should play next (wait mode). */
  get targets(): ArrangedNote[] {
    return this.mode === 'wait' ? (this.chords[this.chordIdx] ?? []) : []
  }

  /** How early (song seconds) a chord may be played and still count. About one beat. */
  private get earlyWindow() {
    const c = this.chords[this.chordIdx]
    const prev = this.chords[this.chordIdx - 1]
    const gap = c && prev ? c[0].start - prev[0].start : 0.6
    return Math.min(0.6, Math.max(0.2, gap * 0.75))
  }

  /** Advance the clock. Call every animation frame. */
  tick(): number {
    if (!this.playing) return this.t
    let t = this.songStart + (audio.now - this.ctxStart) * this.speed
    let limit = Infinity
    if (this.mode === 'wait') {
      const c = this.chords[this.chordIdx]
      if (c) {
        limit = c[0].start
        if (t >= limit) {
          t = limit
          if (!this.waiting) {
            this.waiting = true
            this.emit()
          }
          this.ctxStart = audio.now
          this.songStart = t
        }
      }
    }
    if (this.loop && t >= this.loop.b) {
      this.reportPass(this.loop.a, this.loop.b)
      if (this.loop) this.seek(this.loop.a) // onPass may have moved or cleared the loop
      return this.t
    }
    // the recording is the master clock while it plays: follow it instead of nudging the sound
    if (this.originalActive && this.original && !this.original.paused && this.original.readyState >= 2) {
      const drift = this.original.currentTime - this.originalOffset - t
      if (Math.abs(drift) > 0.045 && Math.abs(drift) < 5) {
        t += drift
        this.t = t
        this.anchor()
      }
    }
    this.t = t
    this.scheduleAudio(Math.min(t + LOOKAHEAD * this.speed, limit))
    this.scheduleClicks(Math.min(t + LOOKAHEAD * this.speed, limit))
    if (this.mode === 'watch') this.scheduleLights(t + MIDI_AHEAD * this.speed)
    if (!this.loop && t >= this.duration + 0.5) {
      this.playing = false
      this.finished = true
      this.silence()
      this.reportPass(0, this.duration)
      this.emit()
    }
    return this.t
  }

  private reportPass(a: number, b: number) {
    const { hits, wrong, from } = this.pass
    if (this.mode === 'wait' && hits > 0 && from <= a + 0.05) {
      this.onPass?.({ a, b, hits, wrong, accuracy: hits / (hits + wrong) })
    }
  }

  private scheduleAudio(until: number) {
    while (this.soundIdx < this.sound.length && this.sound[this.soundIdx].start < until) {
      const n = this.sound[this.soundIdx++]
      if (n.start < this.scheduledUntil - 0.001) continue
      const at = this.ctxStart + (n.start - this.songStart) / this.speed
      if (at < audio.now - 0.05) continue
      audio.play(n.pitch, Math.max(at, audio.now), (n.end - n.start) / this.speed, n.velocity / 127)
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, until)
  }

  private scheduleClicks(until: number) {
    while (this.beatIdx < this.beats.length && this.beats[this.beatIdx] < until) {
      const b = this.beats[this.beatIdx]
      const at = this.ctxStart + (b - this.songStart) / this.speed
      if (this.metronome && at >= audio.now - 0.02) audio.click(Math.max(at, audio.now), this.beatIdx % this.beatsPerBar === 0)
      this.beatIdx++
    }
  }

  private scheduleLights(until: number) {
    if (!midi.sendsGuide) return
    while (this.lightIdx < this.lights.length && this.lights[this.lightIdx].t < until) {
      const e = this.lights[this.lightIdx++]
      const at = this.midiTime(e.t)
      if (e.on) midi.lightOn(e.note, e.vel, e.hand, at)
      else midi.lightOff(e.note, e.hand, at)
    }
  }

  private flash(note: number, kind: 'good' | 'bad') {
    this.flashes.set(note, { kind, until: performance.now() + FLASH_MS })
  }

  /** A key pressed on the keyboard, the screen or the computer keyboard. */
  handleKey(note: number) {
    if (this.mode !== 'wait' || this.finished) return
    const c = this.chords[this.chordIdx]
    if (!c) return
    const n = c.find((x) => x.pitch === note && !this.chordHits.has(x))
    if (!n) {
      // a wrong key only counts while the song is actually waiting for you
      if (this.waiting && !c.some((x) => x.pitch === note)) {
        this.stats.wrong++
        this.pass.wrong++
        this.flash(note, 'bad')
        this.emit()
      }
      return
    }
    // too early: ignore quietly (it's not wrong, it just isn't time yet)
    if (this.playing && !this.waiting && c[0].start - this.t > this.earlyWindow) return
    if (!this.playing) this.play() // pressing the first highlighted key starts the song
    this.chordHits.add(n)
    this.stats.hits++
    this.pass.hits++
    this.flash(note, 'good')
    if (c.every((x) => this.chordHits.has(x))) {
      for (const x of c) midi.lightOff(x.pitch, x.hand)
      this.chordHits.clear()
      this.chordIdx++
      if (this.waiting) {
        this.waiting = false
        this.anchor()
      }
      this.showNextChord()
    }
    this.emit()
  }

  dispose() {
    this.playing = false
    this.silence()
    this.onPass = null
    midi.restoreVolume()
    this.listeners.clear()
  }
}

export function groupChords(ns: ArrangedNote[], window = CHORD_WINDOW): ArrangedNote[][] {
  const sorted = [...ns].sort((a, b) => a.start - b.start)
  const groups: ArrangedNote[][] = []
  for (const n of sorted) {
    const g = groups[groups.length - 1]
    if (g && n.start - g[0].start <= window && !g.some((x) => x.pitch === n.pitch)) g.push(n)
    else groups.push([n])
  }
  return groups
}

export function lowerBound(arr: { start: number }[], t: number) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].start < t) lo = mid + 1
    else hi = mid
  }
  return lo
}
