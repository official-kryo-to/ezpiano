import { CacheStorage, SplendidGrandPiano } from 'smplr'

type Status = 'idle' | 'loading' | 'ready' | 'synth'
type StopFn = (time?: number) => void

const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA=='

/**
 * Piano audio. Uses sampled grand piano (smplr) when available and a small
 * built-in synth as an instant fallback while samples load or when offline.
 */
class AudioEngine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private piano: ReturnType<typeof SplendidGrandPiano> | null = null
  private live = new Map<number, StopFn>()
  private synthVoices = new Set<{ osc: OscillatorNode[]; gain: GainNode }>()
  private listeners = new Set<(s: Status) => void>()
  status: Status = 'idle'
  preferSynth = false
  private volume = 0.85

  onStatus(fn: (s: Status) => void) {
    this.listeners.add(fn)
    fn(this.status)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private setStatus(s: Status) {
    this.status = s
    this.listeners.forEach((l) => l(s))
  }

  /** Must be called from a user gesture (tap/click/keypress). */
  unlock(): AudioContext {
    if (!this.ctx) {
      // iOS: route Web Audio through the media channel so the silent switch doesn't mute it
      try {
        const nav = navigator as Navigator & { audioSession?: { type: string } }
        if (nav.audioSession) nav.audioSession.type = 'playback'
      } catch {
        /* ignore */
      }
      try {
        const a = new Audio(SILENT_WAV)
        a.setAttribute('playsinline', '')
        void a.play().catch(() => {})
      } catch {
        /* ignore */
      }
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx({ latencyHint: 'interactive' })
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
      this.loadPiano()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private loadPiano() {
    if (!this.ctx || !this.master || this.piano || this.preferSynth) {
      if (this.preferSynth) this.setStatus('synth')
      return
    }
    this.setStatus('loading')
    try {
      const storage = 'caches' in window ? new CacheStorage('ezpiano-samples') : undefined
      this.piano = SplendidGrandPiano(this.ctx, { destination: this.master, volume: 110, ...(storage ? { storage } : {}) })
      this.piano.ready.then(
        () => this.setStatus(this.preferSynth ? 'synth' : 'ready'),
        () => {
          this.piano = null
          this.setStatus('synth')
        },
      )
    } catch {
      this.piano = null
      this.setStatus('synth')
    }
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  setPreferSynth(v: boolean) {
    this.preferSynth = v
    if (!this.ctx) return
    if (v) this.setStatus('synth')
    else if (this.piano) this.setStatus('ready')
    else this.loadPiano()
  }

  get now() {
    return this.ctx?.currentTime ?? 0
  }

  private usePiano() {
    return !this.preferSynth && this.status === 'ready' && this.piano
  }

  /** Schedule a note at an absolute AudioContext time. */
  play(midi: number, time: number, duration: number, velocity = 0.75) {
    if (!this.ctx) return
    if (this.usePiano()) {
      this.piano!.start({ note: midi, velocity: Math.round(20 + velocity * 100), time, duration })
    } else {
      this.synth(midi, time, duration, velocity)
    }
  }

  /** Live key press: sounds until noteOff. */
  noteOn(midi: number, velocity = 0.8) {
    const ctx = this.unlock()
    this.noteOff(midi)
    if (this.usePiano()) {
      const stop = this.piano!.start({ note: midi, velocity: Math.round(20 + velocity * 100) })
      this.live.set(midi, stop)
    } else {
      const v = this.synth(midi, ctx.currentTime, null, velocity)
      this.live.set(midi, (t) => v.release(t ?? ctx.currentTime))
    }
  }

  noteOff(midi: number) {
    const stop = this.live.get(midi)
    if (stop) {
      stop()
      this.live.delete(midi)
    }
  }

  /** Short metronome click at an AudioContext time. */
  click(time: number, accent = false) {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = accent ? 1760 : 1320
    g.gain.setValueAtTime(0, time)
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.2, time + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    osc.connect(g).connect(this.master)
    osc.start(time)
    osc.stop(time + 0.08)
  }

  stopAll() {
    this.piano?.stop()
    this.live.clear()
    for (const v of this.synthVoices) {
      try {
        v.gain.gain.cancelScheduledValues(0)
        v.gain.gain.value = 0
        v.osc.forEach((o) => o.stop())
      } catch {
        /* already stopped */
      }
    }
    this.synthVoices.clear()
  }

  /** Lightweight piano-ish synth: two detuned partials through a lowpass with a plucked envelope. */
  private synth(midi: number, time: number, duration: number | null, velocity: number) {
    const ctx = this.ctx!
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(9000, freq * 6)
    filter.Q.value = 0.5
    const peak = 0.18 * (0.35 + velocity * 0.65)
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(peak, time + 0.006)
    gain.gain.setTargetAtTime(peak * 0.35, time + 0.01, 0.35)
    const o1 = ctx.createOscillator()
    o1.type = 'triangle'
    o1.frequency.value = freq
    const o2 = ctx.createOscillator()
    o2.type = 'sine'
    o2.frequency.value = freq * 2
    o2.detune.value = 3
    const g2 = ctx.createGain()
    g2.gain.value = 0.25
    o1.connect(filter)
    o2.connect(g2).connect(filter)
    filter.connect(gain).connect(this.master!)
    o1.start(time)
    o2.start(time)
    const voice = { osc: [o1, o2], gain }
    this.synthVoices.add(voice)
    let released = false
    const release = (t: number) => {
      if (released) return
      released = true
      const g = gain.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t)
      else g.cancelScheduledValues(t)
      g.setTargetAtTime(0, t, 0.08)
      for (const o of [o1, o2]) {
        try {
          o.stop(t + 0.6)
        } catch {
          /* already scheduled */
        }
      }
    }
    o1.onended = () => this.synthVoices.delete(voice)
    if (duration != null) release(time + Math.max(0.08, duration))
    else {
      // safety fade for held notes
      gain.gain.setTargetAtTime(0, time + 8, 0.5)
    }
    return { release }
  }
}

export const audio = new AudioEngine()
