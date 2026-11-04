import { createStore, del, get, keys, set } from 'idb-keyval'
import type { SongSource } from './song'
import type { NoteNaming } from './notes'

const songStore = createStore('ezpiano', 'songs')

export interface SavedSong {
  id: string
  title: string
  source: SongSource
  bytes: ArrayBuffer
  addedAt: number
  lastPlayed: number
  favorite: boolean
  best?: number // best accuracy 0..100
}

export type SavedSongMeta = Omit<SavedSong, 'bytes'>

export async function saveSong(s: Omit<SavedSong, 'addedAt' | 'lastPlayed' | 'favorite'> & Partial<SavedSong>) {
  const prev = await get<SavedSong>(s.id, songStore)
  const now = Date.now()
  await set(s.id, { favorite: false, addedAt: now, ...prev, ...s, lastPlayed: now }, songStore)
}

export async function getSong(id: string) {
  return get<SavedSong>(id, songStore)
}

export async function updateSong(id: string, patch: Partial<SavedSong>) {
  const prev = await get<SavedSong>(id, songStore)
  if (prev) await set(id, { ...prev, ...patch }, songStore)
}

export async function deleteSong(id: string) {
  await del(id, songStore)
}

export async function listSongs(): Promise<SavedSongMeta[]> {
  const ks = await keys(songStore)
  const all = await Promise.all(ks.map((k) => get<SavedSong>(k, songStore)))
  return all
    .filter((s): s is SavedSong => !!s)
    .map(({ bytes: _b, ...meta }) => meta)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
}

/* ---------- settings + lesson progress (small, localStorage) ---------- */

export interface Settings {
  naming: NoteNaming
  keyLabels: boolean
  noteLabels: boolean
  volume: number // 0..1
  sound: 'grand' | 'synth'
  zoom: number // px per second of falling notes
  kbdOctave: number
}

export const DEFAULT_SETTINGS: Settings = {
  naming: 'letters',
  keyLabels: true,
  noteLabels: true,
  volume: 0.85,
  sound: 'grand',
  zoom: 160,
  kbdOctave: 4,
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode) */
  }
}

export const loadSettings = () => readJSON<Settings>('ezpiano:settings', DEFAULT_SETTINGS)
export const storeSettings = (s: Settings) => writeJSON('ezpiano:settings', s)

export type LessonProgress = Record<string, { stars: number; best: number }>
export const loadLessonProgress = () => readJSON<LessonProgress>('ezpiano:lessons', {})
export const storeLessonProgress = (p: LessonProgress) => writeJSON('ezpiano:lessons', p)
