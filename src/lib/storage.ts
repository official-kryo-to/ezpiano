import { createStore, del, get, keys, set } from 'idb-keyval'
import { DEFAULT_SETTINGS, type ConvertSettings, type EngineKind } from '../engine/types'

const store = createStore('ezpiano-v2', 'songs')

/** A converted song. We keep the raw transcription, so changing settings later is instant. */
export interface RecentSong {
  id: string
  title: string
  fileName: string
  createdAt: number
  duration: number
  engine: EngineKind
  settings: ConvertSettings
  notes: Float32Array // packed raw notes, see packNotes()
  bpm: number
  noteCount: number
}

export type RecentMeta = Omit<RecentSong, 'notes'>

export async function saveRecent(song: RecentSong) {
  await set(song.id, song, store)
  // keep the list small
  const all = await listRecent()
  for (const old of all.slice(12)) await del(old.id, store)
}

export const getRecent = (id: string) => get<RecentSong>(id, store)
export const deleteRecent = (id: string) => del(id, store)

export async function updateRecent(id: string, patch: Partial<RecentSong>) {
  const prev = await get<RecentSong>(id, store)
  if (prev) await set(id, { ...prev, ...patch }, store)
}

export async function listRecent(): Promise<RecentMeta[]> {
  const ks = await keys(store)
  const all = await Promise.all(ks.map((k) => get<RecentSong>(k, store)))
  return all
    .filter((s): s is RecentSong => !!s)
    .map(({ notes: _n, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/* ---- small preferences (localStorage) ---- */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode */
  }
}

export const loadSettings = () => read<ConvertSettings>('ezpiano:settings', DEFAULT_SETTINGS)
export const saveSettings = (s: ConvertSettings) => write('ezpiano:settings', s)

export interface MidiPrefs {
  outputId: string
  outputName: string
  inputId: string
  inputName: string
  guideSound: boolean
  silentMethod: 'volume' | 'velocity'
  /** 'auto' (detect from the device name) or a keyboard profile id */
  keyboardId: string
  /** app sound volume 0..1 */
  volume: number
}

export const DEFAULT_MIDI_PREFS: MidiPrefs = {
  outputId: '',
  outputName: '',
  inputId: '',
  inputName: '',
  guideSound: false,
  silentMethod: 'volume',
  keyboardId: 'auto',
  volume: 0.8,
}

export const loadMidiPrefs = () => read<MidiPrefs>('ezpiano:midi', DEFAULT_MIDI_PREFS)
export const saveMidiPrefs = (p: MidiPrefs) => write('ezpiano:midi', p)
