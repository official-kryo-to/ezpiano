import { audio } from './audio'
import type { NoteInput } from './input'
import { groupChords, type LearnNote, type SongNote } from './song'

export type Mode = 'watch' | 'wait' | 'play'

export const MODE_LABEL: Record<Mode, string> = {
  watch: 'Watch & listen',
  wait: 'Wait for me',
  play: 'Play along',
}

export const NOTE_PENDING = 0
export const NOTE_HIT = 1
export const NOTE_MISS = 2

const LOOKAHEAD = 0.2 // seconds of song time scheduled ahead
const PLAY_WINDOW = 0.22 // seconds (song time) a press counts as on-time in play-along
const PREHIT = 0.3 // wait mode: pressing this early still counts

export interface Score {
  hits: number
  misses: number
  wrong: number
  streak: number
  bestStreak: number
}

/**
 * Song clock + scheduler + scoring. Pure logic, no React.
 * Song time `t` advances with the AudioContext clock scaled by `speed`;
 * in wait mode the clock freezes on each chord until it's played.
 */
export class PracticeEngine {
  learn: LearnNote[] = []
  chords: LearnNote[][] = []
  sound: SongNote[] = []
  state = new Uint8Array(0)
  mode: Mode = 'wait'
  speed = 1
  duration = 0
  loop: { a: number; b: number } | null = null

  t = 0
  playing = false
  finished = false
  waiting = false
  private ctxStart = 0
  private songStart = 0
  private soundIdx = 0
  private scheduledUntil = 0
  private missIdx = 0
  chordIdx = 0
  private chordHits = new Set<number>()
  score: Score = { hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0 }
  /** recent feedback flashes for key highlighting */
  flashes = new Map<number, { kind: 'good' | 'bad'; until: number }>()
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

  configure(opts: { learn: LearnNote[]; sound: SongNote[]; mode: Mode; duration: number }) {
    this.learn = opts.learn
    this.chords = groupChords(opts.learn)
    this.sound = opts.sound
    this.mode = opts.mode
    this.duration = opts.duration
    this.state = new Uint8Array(opts.learn.length)
    this.resetScore()
    this.seek(Math.min(this.t, this.duration))
  }

  resetScore() {
    this.score = { hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0 }
    this.state.fill(NOTE_PENDING)
    this.finished = false
  }

  get accuracy() {
    const { hits, misses, wrong } = this.score
    const total = hits + misses + wrong
    return total ? Math.round((hits / total) * 100) : 0
  }

  play() {
    audio.unlock()
    if (this.finished) {
      this.resetScore()
      this.seek(this.loop?.a ?? 0)
    }
    this.playing = true
    this.anchor()
    this.emit()
  }

  pause() {
    this.playing = false
    this.waiting = false
    audio.stopAll()
    this.scheduledUntil = this.t
    this.soundIdx = lowerBound(this.sound, this.t)
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  setSpeed(s: number) {
    this.speed = s
    if (this.playing) {
      audio.stopAll()
      this.scheduledUntil = this.t
      this.soundIdx = lowerBound(this.sound, this.t)
      this.anchor()
    }
  }

  setMode(m: Mode) {
    this.mode = m
    this.waiting = false
    this.resetScore()
    this.seek(this.t)
  }

  private anchor() {
    this.ctxStart = audio.now
    this.songStart = this.t
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(t, this.duration))
    audio.stopAll()
    this.soundIdx = lowerBound(this.sound, this.t)
    this.scheduledUntil = this.t
    this.chordIdx = lowerBoundChord(this.chords, this.t - 0.001)
    this.missIdx = lowerBound(this.learn, this.t - PLAY_WINDOW)
    this.chordHits.clear()
    this.waiting = false
    for (let i = 0; i < this.learn.length; i++) if (this.learn[i].time >= this.t - 0.001) this.state[i] = NOTE_PENDING
    if (this.playing) this.anchor()
    this.emit()
  }

  /** Call every animation frame. */
  tick() {
    if (!this.playing) return this.t
    const now = audio.now
    let t = this.songStart + (now - this.ctxStart) * this.speed
    let limit = Infinity

    if (this.mode === 'wait') {
      const chord = this.chords[this.chordIdx]
      if (chord) {
        limit = chord[0].time
        if (t >= limit) {
          t = limit
          if (!this.waiting) {
            this.waiting = true
            this.emit()
          }
          // freeze clock while waiting
          this.ctxStart = now
          this.songStart = t
        }
      }
    }

    if (this.loop && t >= this.loop.b) {
      this.seek(this.loop.a)
      return this.t
    }

    this.t = t
    this.schedule(Math.min(t + LOOKAHEAD * this.speed, limit))
    if (this.mode === 'play') this.collectMisses()

    const end = this.duration + 0.4
    if (!this.loop && t >= end) {
      this.t = this.duration
      this.playing = false
      this.finished = true
      this.emit()
    }
    return this.t
  }

  private schedule(until: number) {
    const s = this.sound
    while (this.soundIdx < s.length && s[this.soundIdx].time < until) {
      const n = s[this.soundIdx++]
      if (n.time < this.scheduledUntil - 0.001) continue
      const at = this.ctxStart + (n.time - this.songStart) / this.speed
      if (at < audio.now - 0.05) continue
      audio.play(n.midi, Math.max(at, audio.now), n.duration / this.speed, n.velocity)
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, until)
  }

  private collectMisses() {
    while (this.missIdx < this.learn.length && this.learn[this.missIdx].time < this.t - PLAY_WINDOW) {
      if (this.state[this.missIdx] === NOTE_PENDING) {
        this.state[this.missIdx] = NOTE_MISS
        this.score.misses++
        this.score.streak = 0
      }
      this.missIdx++
    }
  }

  private flash(midi: number, kind: 'good' | 'bad') {
    this.flashes.set(midi, { kind, until: performance.now() + 220 })
  }

  private good(idx: number) {
    this.state[idx] = NOTE_HIT
    this.score.hits++
    this.score.streak++
    this.score.bestStreak = Math.max(this.score.bestStreak, this.score.streak)
    this.flash(this.learn[idx].midi, 'good')
  }

  private bad(midi: number) {
    this.score.wrong++
    this.score.streak = 0
    this.flash(midi, 'bad')
  }

  /** Notes the learner should press right now (wait mode). */
  get targets(): LearnNote[] {
    if (this.mode !== 'wait') return []
    const c = this.chords[this.chordIdx]
    if (!c) return []
    return this.waiting || c[0].time - this.t < PREHIT ? c : []
  }

  handleInput(ev: NoteInput) {
    if (ev.type !== 'on' || this.mode === 'watch') return
    if (this.mode === 'wait') {
      const chord = this.chords[this.chordIdx]
      if (!chord) return
      const near = this.waiting || chord[0].time - this.t < PREHIT
      const idx = chord.findIndex((n) => n.midi === ev.midi && !this.chordHits.has(n.id))
      if (near && idx >= 0) {
        const n = chord[idx]
        this.chordHits.add(n.id)
        this.good(n.id)
        if (chord.every((c) => this.chordHits.has(c.id))) {
          this.chordIdx++
          this.chordHits.clear()
          if (this.waiting) {
            this.waiting = false
            this.anchor()
          }
        }
        this.emit()
      } else if (this.playing) {
        this.bad(ev.midi)
        this.emit()
      }
      return
    }
    // play-along
    if (!this.playing) return
    let best = -1
    let bestDist = Infinity
    const from = lowerBound(this.learn, this.t - PLAY_WINDOW)
    for (let i = from; i < this.learn.length && this.learn[i].time <= this.t + PLAY_WINDOW; i++) {
      const n = this.learn[i]
      if (n.midi !== ev.midi || this.state[i] !== NOTE_PENDING) continue
      const d = Math.abs(n.time - this.t)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    if (best >= 0) this.good(best)
    else this.bad(ev.midi)
    this.emit()
  }
}

function lowerBound(arr: { time: number }[], t: number) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function lowerBoundChord(chords: { time: number }[][], t: number) {
  let lo = 0
  let hi = chords.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (chords[mid][0].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export { lowerBound }
