/**
 * Web MIDI: device lists, keyboard "lights" output and key presses from the keyboard.
 * Which channels light the keys depends on the keyboard profile (auto-detected from the
 * device name, see keyboards.ts): EZ-220 lights channel 1, EZ-300 channels 1 and 2,
 * Casio LK channels 4 and 3.
 */
import { DEFAULT_PROFILE, detectProfile, profileById, type KeyboardProfile } from './keyboards'
import { loadMidiPrefs, saveMidiPrefs, type MidiPrefs } from './storage'
import type { Hand } from '../engine/types'

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

export interface Device {
  id: string
  name: string
}

export interface MidiStatus {
  supported: boolean
  state: 'idle' | 'asking' | 'ready' | 'denied'
  outputs: Device[]
  inputs: Device[]
  output: Device | null
  input: Device | null
  /** profile in use (chosen, or detected from the device) */
  profile: KeyboardProfile
  /** what auto-detection would pick for the current device */
  detected: KeyboardProfile | null
  error?: string
}

type KeyListener = (e: { type: 'on' | 'off'; note: number; velocity: number }) => void

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CC = 0xb0

class MidiLink {
  private access: MIDIAccess | null = null
  private listeners = new Set<(s: MidiStatus) => void>()
  private keyListeners = new Set<KeyListener>()
  private lit = new Map<string, number>() // "channel:note" -> count of reasons it's lit
  private touched = new Set<number>() // channels we changed volume on or sent notes to
  private latest = 0 // latest timestamp handed to the device
  private floor = 0 // nothing may be scheduled before the last panic
  prefs: MidiPrefs = loadMidiPrefs()
  status: MidiStatus = {
    supported: midiSupported(),
    state: 'idle',
    outputs: [],
    inputs: [],
    output: null,
    input: null,
    profile: profileById(loadMidiPrefs().keyboardId) ?? DEFAULT_PROFILE,
    detected: null,
  }

  subscribe(fn: (s: MidiStatus) => void) {
    this.listeners.add(fn)
    fn(this.status)
    return () => {
      this.listeners.delete(fn)
    }
  }

  onKey(fn: KeyListener) {
    this.keyListeners.add(fn)
    return () => {
      this.keyListeners.delete(fn)
    }
  }

  private emit() {
    this.listeners.forEach((l) => l(this.status))
  }

  get profile() {
    return this.status.profile
  }

  /** Re-resolve the profile from the preference and the connected device. */
  private resolveProfile() {
    const name = this.status.output?.name ?? this.status.input?.name ?? ''
    const detected = name ? detectProfile(name) : null
    const chosen = this.prefs.keyboardId !== 'auto' ? profileById(this.prefs.keyboardId) : null
    this.status = { ...this.status, detected, profile: chosen ?? detected ?? DEFAULT_PROFILE }
  }

  setKeyboard(id: string) {
    this.allOff()
    this.restoreVolume()
    this.prefs = { ...this.prefs, keyboardId: id }
    saveMidiPrefs(this.prefs)
    this.resolveProfile()
    this.emit()
  }

  async connect() {
    if (!this.status.supported || this.status.state === 'asking') return
    this.status = { ...this.status, state: 'asking', error: undefined }
    this.emit()
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
      this.access.onstatechange = () => this.refresh()
      this.refresh()
    } catch (e) {
      this.status = { ...this.status, state: 'denied', error: e instanceof Error ? e.message : 'MIDI access was blocked.' }
      this.emit()
    }
  }

  /** Reconnect silently if permission was granted before (no prompt). */
  async reconnectIfAllowed() {
    if (!this.status.supported || this.access) return
    try {
      const perm = await navigator.permissions?.query({ name: 'midi' as PermissionName })
      if (perm?.state === 'granted') await this.connect()
    } catch {
      /* permissions API without "midi": wait for the user to press Connect */
    }
  }

  /** Re-read devices and re-select the remembered (or most likely) ones. */
  private refresh() {
    if (!this.access) return
    const outputs: Device[] = []
    const inputs: Device[] = []
    this.access.outputs.forEach((o) => outputs.push({ id: o.id, name: o.name || 'MIDI output' }))
    this.access.inputs.forEach((i) => inputs.push({ id: i.id, name: i.name || 'MIDI input' }))
    const likely = /digital keyboard|digital piano|yamaha|casio|ez-?\d|lk-|roland|kawai|korg|piano|keys?|key ?station|keylab|launchkey|mpk|oxygen/i
    const skip = /midi through|thru|virtual/i
    const pick = (list: Device[], id: string, name: string) =>
      list.find((d) => d.id === id) ??
      list.find((d) => name && d.name === name) ??
      list.find((d) => likely.test(d.name) && !skip.test(d.name)) ??
      list.find((d) => !skip.test(d.name)) ??
      null
    const output = pick(outputs, this.prefs.outputId, this.prefs.outputName)
    const input =
      (output ? inputs.find((i) => i.name === output.name) : undefined) ?? pick(inputs, this.prefs.inputId, this.prefs.inputName)
    this.status = { ...this.status, state: 'ready', outputs, inputs, output, input }
    this.resolveProfile()
    this.bindInput()
    this.emit()
  }

  selectOutput(id: string) {
    const d = this.status.outputs.find((o) => o.id === id) ?? null
    this.allOff()
    this.restoreVolume()
    this.status = { ...this.status, output: d }
    this.prefs = { ...this.prefs, outputId: d?.id ?? '', outputName: d?.name ?? '' }
    saveMidiPrefs(this.prefs)
    this.resolveProfile()
    this.emit()
  }

  selectInput(id: string) {
    const d = this.status.inputs.find((o) => o.id === id) ?? null
    this.status = { ...this.status, input: d }
    this.prefs = { ...this.prefs, inputId: d?.id ?? '', inputName: d?.name ?? '' }
    saveMidiPrefs(this.prefs)
    this.bindInput()
    this.resolveProfile()
    this.emit()
  }

  setPrefs(patch: Partial<MidiPrefs>) {
    this.prefs = { ...this.prefs, ...patch }
    saveMidiPrefs(this.prefs)
    this.emit()
  }

  private bindInput() {
    if (!this.access) return
    this.access.inputs.forEach((inp) => {
      inp.onmidimessage = inp.id === this.status.input?.id ? (ev) => this.handle(ev) : null
    })
  }

  private handle(ev: MIDIMessageEvent) {
    const d = ev.data
    if (!d || d.length < 2) return
    const cmd = d[0] & 0xf0
    const note = d[1]
    const vel = d[2] ?? 0
    if (cmd === NOTE_ON && vel > 0) this.keyListeners.forEach((l) => l({ type: 'on', note, velocity: vel }))
    else if (cmd === NOTE_OFF || (cmd === NOTE_ON && vel === 0)) this.keyListeners.forEach((l) => l({ type: 'off', note, velocity: 0 }))
  }

  private port(): MIDIOutput | null {
    const id = this.status.output?.id
    return (id && this.access?.outputs.get(id)) || null
  }

  get connected() {
    return !!this.port()
  }

  /** The keyboard shows lights (connected, and the profile has key lights). */
  get canLight() {
    return this.connected && !!this.profile.lights
  }

  /** Lit notes are sent at all: for lights, or so the keyboard can play the guide notes. */
  get sendsGuide() {
    return this.canLight || (this.connected && this.prefs.guideSound)
  }

  private channelFor(hand: Hand): number {
    const l = this.profile.lights
    if (!l) return 0
    return hand === 'L' ? l.lh : l.rh
  }

  private lightChannels(): number[] {
    const l = this.profile.lights
    return l ? [...new Set([l.rh, l.lh])] : this.prefs.guideSound ? [0] : []
  }

  /**
   * Send with an optional performance.now() timestamp. Messages never go out before the last
   * panic, so a pause followed by a seek can't have its new lights cancelled by the old panic.
   */
  send(bytes: number[], at?: number) {
    const p = this.port()
    if (!p) return
    const ts = Math.max(at ?? performance.now(), this.floor)
    this.latest = Math.max(this.latest, ts)
    try {
      p.send(bytes, ts)
    } catch {
      /* device went away */
    }
  }

  /**
   * Make guide notes silent (or audible) on the light channels. With the "volume" method this is
   * CC 7 = 0; with "velocity" the notes go out at velocity 1 instead.
   */
  applyGuideVolume() {
    const audible = this.prefs.guideSound || this.prefs.silentMethod === 'velocity'
    for (const ch of this.lightChannels()) {
      this.touched.add(ch)
      this.send([CC | ch, 7, audible ? 100 : 0])
    }
  }

  restoreVolume() {
    for (const ch of this.touched) this.send([CC | ch, 7, 100])
  }

  private velocity(v: number) {
    if (this.prefs.guideSound) return Math.max(1, Math.min(127, v))
    return this.prefs.silentMethod === 'velocity' ? 1 : Math.max(1, Math.min(127, v))
  }

  /** Light a key for a hand. Reference counted so overlapping reasons don't flicker. */
  lightOn(note: number, velocity: number, hand: Hand, at?: number) {
    if (!this.sendsGuide) return
    const ch = this.channelFor(hand)
    const key = `${ch}:${note}`
    const n = (this.lit.get(key) ?? 0) + 1
    this.lit.set(key, n)
    this.touched.add(ch)
    if (n === 1) this.send([NOTE_ON | ch, note, this.velocity(velocity)], at)
  }

  lightOff(note: number, hand: Hand, at?: number) {
    const ch = this.channelFor(hand)
    const key = `${ch}:${note}`
    const n = (this.lit.get(key) ?? 0) - 1
    if (n > 0) {
      this.lit.set(key, n)
      return
    }
    if (n < 0) return
    this.lit.delete(key)
    this.send([NOTE_OFF | ch, note, 0], at)
  }

  /**
   * Panic: note-off for everything we lit, then CC 123 (All Notes Off) on every channel we used.
   * Timed after anything already scheduled, so no scheduled light can survive it.
   */
  allOff() {
    if (!this.connected) {
      this.lit.clear()
      return
    }
    const ts = Math.max(performance.now(), this.latest) + 1
    for (const key of this.lit.keys()) {
      const [ch, note] = key.split(':').map(Number)
      this.send([NOTE_OFF | ch, note, 0], ts)
    }
    this.lit.clear()
    for (const ch of new Set([0, 1, ...this.touched])) this.send([CC | ch, 123, 0], ts)
    this.floor = ts + 1
  }

  /** Light a C major scale with the right hand, then one with the left: checks cable, channels and silence. */
  async testLights() {
    this.applyGuideVolume()
    const scale = [60, 62, 64, 65, 67, 69, 71, 72]
    const wait = () => new Promise((r) => setTimeout(r, 150))
    for (const n of scale) {
      this.lightOn(n, 80, 'R')
      await wait()
      this.lightOff(n, 'R')
    }
    for (const n of [...scale].reverse().map((x) => x - 12)) {
      this.lightOn(n, 80, 'L')
      await wait()
      this.lightOff(n, 'L')
    }
  }
}

export const midi = new MidiLink()

// never leave keys lit or the keyboard muted when the tab closes
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    midi.allOff()
    midi.restoreVolume()
  })
}
