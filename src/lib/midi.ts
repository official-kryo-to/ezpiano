/**
 * Web MIDI: device lists, the keyboard "lights" output and key presses from the keyboard.
 * Lights are notes sent on channel 1, the only channel the EZ-220 lights keys for.
 */
import { loadMidiPrefs, saveMidiPrefs, type MidiPrefs } from './storage'

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
  error?: string
}

type KeyListener = (e: { type: 'on' | 'off'; note: number; velocity: number }) => void

const LIGHT_CH = 0 // channel 1
const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CC = 0xb0

class MidiLink {
  private access: MIDIAccess | null = null
  private listeners = new Set<(s: MidiStatus) => void>()
  private keyListeners = new Set<KeyListener>()
  private lit = new Map<number, number>() // note -> count of reasons it's lit
  private latest = 0 // latest timestamp handed to the device
  private floor = 0 // nothing may be scheduled before the last panic
  prefs: MidiPrefs = loadMidiPrefs()
  status: MidiStatus = { supported: midiSupported(), state: 'idle', outputs: [], inputs: [], output: null, input: null }

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

  /** Re-read devices and re-select the remembered (or most likely) ones. */
  private refresh() {
    if (!this.access) return
    const outputs: Device[] = []
    const inputs: Device[] = []
    this.access.outputs.forEach((o) => outputs.push({ id: o.id, name: o.name || 'MIDI output' }))
    this.access.inputs.forEach((i) => inputs.push({ id: i.id, name: i.name || 'MIDI input' }))
    const pick = (list: Device[], id: string, name: string) =>
      list.find((d) => d.id === id) ??
      list.find((d) => name && d.name === name) ??
      list.find((d) => /digital keyboard|yamaha|ez-?2\d\d|piano/i.test(d.name)) ??
      list[0] ??
      null
    const output = pick(outputs, this.prefs.outputId, this.prefs.outputName)
    const input = pick(inputs, this.prefs.inputId, this.prefs.inputName) ?? (output ? inputs.find((i) => i.name === output.name) ?? null : null)
    this.status = { ...this.status, state: 'ready', outputs, inputs, output, input }
    this.bindInput()
    this.emit()
  }

  selectOutput(id: string) {
    const d = this.status.outputs.find((o) => o.id === id) ?? null
    this.allOff()
    this.status = { ...this.status, output: d }
    this.prefs = { ...this.prefs, outputId: d?.id ?? '', outputName: d?.name ?? '' }
    saveMidiPrefs(this.prefs)
    this.emit()
  }

  selectInput(id: string) {
    const d = this.status.inputs.find((o) => o.id === id) ?? null
    this.status = { ...this.status, input: d }
    this.prefs = { ...this.prefs, inputId: d?.id ?? '', inputName: d?.name ?? '' }
    saveMidiPrefs(this.prefs)
    this.bindInput()
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
   * Make the guide notes silent (or audible) on channel 1. With the "volume" method this is
   * CC 7 = 0; with "velocity" the notes go out at velocity 1 instead.
   */
  applyGuideVolume() {
    const audible = this.prefs.guideSound || this.prefs.silentMethod === 'velocity'
    this.send([CC | LIGHT_CH, 7, audible ? 100 : 0])
  }

  restoreVolume() {
    this.send([CC | LIGHT_CH, 7, 100])
  }

  lightVelocity(v: number) {
    if (this.prefs.guideSound) return Math.max(1, Math.min(127, v))
    return this.prefs.silentMethod === 'velocity' ? 1 : Math.max(1, Math.min(127, v))
  }

  /** Light a key (note-on, channel 1). Reference counted so overlapping reasons don't flicker. */
  lightOn(note: number, velocity: number, at?: number) {
    const n = (this.lit.get(note) ?? 0) + 1
    this.lit.set(note, n)
    if (n === 1) this.send([NOTE_ON | LIGHT_CH, note, this.lightVelocity(velocity)], at)
  }

  lightOff(note: number, at?: number) {
    const n = (this.lit.get(note) ?? 0) - 1
    if (n > 0) {
      this.lit.set(note, n)
      return
    }
    this.lit.delete(note)
    this.send([NOTE_OFF | LIGHT_CH, note, 0], at)
  }

  /**
   * Panic: note-off for everything we lit, then CC 123 (All Notes Off) on channels 1 and 2.
   * Timed after anything already scheduled, so no scheduled light can survive it.
   */
  allOff() {
    const ts = Math.max(performance.now(), this.latest) + 1
    for (const note of this.lit.keys()) this.send([NOTE_OFF | LIGHT_CH, note, 0], ts)
    this.lit.clear()
    this.send([CC | LIGHT_CH, 123, 0], ts)
    this.send([CC | 1, 123, 0], ts)
    this.floor = ts + 1
  }

  /** Light C major scale up and down: lets you check the cable and the silent mode. */
  async testLights() {
    this.applyGuideVolume()
    const scale = [60, 62, 64, 65, 67, 69, 71, 72]
    for (const n of [...scale, ...scale.slice(0, -1).reverse()]) {
      this.lightOn(n, 80)
      await new Promise((r) => setTimeout(r, 160))
      this.lightOff(n)
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
