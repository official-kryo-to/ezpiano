/**
 * Practice clock and routing. No React.
 *
 * Song time `t` follows the AudioContext clock scaled by `speed`. In "wait" mode the clock stops
 * at each chord of the practised hand(s) until the right keys are pressed.
 *
 * Who makes which sound:
 *  - the hand you are NOT practising is always played by the app
 *  - practised notes go to the keyboard as lights (channel 1)
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
const MIDI_AHEAD_MS = 25 // lights are scheduled with timestamps up to this far ahead

interface LightEvent {
  t: number
  on: boolean
  note: number
  vel: number
}

export interface Stats {
  hits: number
  wrong: number
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

  t = 0
  playing = false
  waiting = false
  finished = false
  chordIdx = 0
  stats: Stats = { hits: 0, wrong: 0 }

  private sound: ArrangedNote[] = []
  private lights: LightEvent[] = []
  private soundIdx = 0
  private lightIdx = 0
  private scheduledUntil = 0
  private ctxStart = 0
  private songStart = 0
  private chordHits = new Set<ArrangedNote>()
  private litChord: ArrangedNote[] = []
  private listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  load(notes: ArrangedNote[], duration: number) {
    this.all = notes
    this.duration = duration
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
    this.sound = (appPlaysGuide ? this.all : others).slice().sort((a, b) => a.start - b.start)
    this.lights = []
    if (this.mode === 'watch') {
      for (const n of this.practiced) {
        this.lights.push({ t: n.start, on: true, note: n.pitch, vel: n.velocity })
        this.lights.push({ t: Math.max(n.start + 0.02, n.end - 0.01), on: false, note: n.pitch, vel: 0 })
      }
      // offs before ons at the same moment, so repeated notes re-light
      this.lights.sort((a, b) => a.t - b.t || Number(a.on) - Number(b.on))
    }
    this.chords = groupChords(this.practiced)
    if (midi.connected) midi.applyGuideVolume()
  }

  setMode(m: Mode) {
    this.mode = m
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
    if (this.playing) this.seek(this.t)
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
    this.litChord = []
    this.waiting = false
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(t, this.duration))
    this.silence()
    this.soundIdx = lowerBound(this.sound, this.t)
    this.scheduledUntil = this.t
    this.lightIdx = this.lights.findIndex((e) => e.t >= this.t)
    if (this.lightIdx < 0) this.lightIdx = this.lights.length
    this.chordIdx = this.chords.findIndex((c) => c[0].start >= this.t - 0.001)
    if (this.chordIdx < 0) this.chordIdx = this.chords.length
    this.chordHits.clear()
    this.anchor()
    if (this.playing && midi.connected) {
      if (this.mode === 'watch') {
        // keys that should already be down at this point
        for (const n of this.practiced) if (n.start < this.t && n.end > this.t) midi.lightOn(n.pitch, n.velocity, this.midiTime(this.t))
      } else this.lightChord()
    }
    this.emit()
  }

  private anchor() {
    this.ctxStart = audio.now
    this.songStart = this.t
  }

  private midiTime(songT: number) {
    // performance.now() and AudioContext time run on different clocks: map through "now"
    return performance.now() + Math.max(0, ((songT - this.t) / this.speed) * 1000)
  }

  private lightChord() {
    const c = this.chords[this.chordIdx]
    if (!c || !midi.connected) return
    for (const n of c) midi.lightOn(n.pitch, n.velocity, this.midiTime(this.t))
    this.litChord = c
  }

  private unlightChord() {
    for (const n of this.litChord) midi.lightOff(n.pitch, this.midiTime(this.t))
    this.litChord = []
  }

  /** The chord the learner should play next (wait mode). */
  get targets(): ArrangedNote[] {
    return this.mode === 'wait' ? this.chords[this.chordIdx] ?? [] : []
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
      this.seek(this.loop.a)
      return this.t
    }
    this.t = t
    this.scheduleAudio(Math.min(t + LOOKAHEAD * this.speed, limit))
    if (this.mode === 'watch') this.scheduleLights(t + (MIDI_AHEAD_MS / 1000) * this.speed)
    if (!this.loop && t >= this.duration + 0.5) {
      this.playing = false
      this.finished = true
      this.silence()
      this.emit()
    }
    return this.t
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

  private scheduleLights(until: number) {
    if (!midi.connected) return
    while (this.lightIdx < this.lights.length && this.lights[this.lightIdx].t < until) {
      const e = this.lights[this.lightIdx++]
      const at = this.midiTime(e.t)
      if (e.on) midi.lightOn(e.note, e.vel, at)
      else midi.lightOff(e.note, at)
    }
  }

  /** A key pressed on the keyboard, the screen or the computer keyboard. */
  handleKey(note: number) {
    if (this.mode !== 'wait' || !this.playing) return
    const c = this.chords[this.chordIdx]
    if (!c) return
    const n = c.find((x) => x.pitch === note && !this.chordHits.has(x))
    if (!n) {
      this.stats.wrong++
      this.emit()
      return
    }
    this.chordHits.add(n)
    this.stats.hits++
    if (c.every((x) => this.chordHits.has(x))) {
      this.unlightChord()
      this.chordHits.clear()
      if (this.t < c[0].start - 0.02) {
        // played ahead of time: jump there (the song follows you)
        this.t = c[0].start
        audio.stopAll()
        this.soundIdx = lowerBound(this.sound, this.t)
        this.scheduledUntil = this.t
      }
      this.chordIdx++
      this.waiting = false
      this.anchor()
      this.lightChord()
    }
    this.emit()
  }

  dispose() {
    this.playing = false
    this.silence()
    midi.restoreVolume()
    this.listeners.clear()
  }
}

export function groupChords(ns: ArrangedNote[], window = 0.035): ArrangedNote[][] {
  const sorted = [...ns].sort((a, b) => a.start - b.start)
  const groups: ArrangedNote[][] = []
  for (const n of sorted) {
    const g = groups[groups.length - 1]
    if (g && n.start - g[0].start <= window) g.push(n)
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
