/** A note as it comes out of transcription, before any arranging. Times in seconds. */
export interface RawNote {
  pitch: number // MIDI note number
  start: number
  end: number
  velocity: number // 1..127
}

export type Hand = 'R' | 'L'

/** A note after arranging. Times in seconds (for playback) and beats (for the MIDI file). */
export interface ArrangedNote {
  pitch: number
  start: number
  end: number
  startBeat: number
  endBeat: number
  velocity: number
  hand: Hand
}

export type OutputMode = 'melody' | 'chords' | 'full'
export type Difficulty = 'easy' | 'medium' | 'original'
export type EngineKind = 'piano' | 'basic-pitch'

export interface ArrangeSettings {
  output: OutputMode
  difficulty: Difficulty
  transpose: number // -12..12, ignored when autoTranspose is on
  autoTranspose: boolean
  quantize: boolean
}

export interface ConvertSettings extends ArrangeSettings {
  engine: EngineKind
}

export const DEFAULT_SETTINGS: ConvertSettings = {
  output: 'chords',
  difficulty: 'medium',
  transpose: 0,
  autoTranspose: false,
  quantize: true,
  engine: 'piano',
}

/** Beat grid found by tempo analysis. */
export interface BeatGrid {
  bpm: number
  /** time (s) of every beat, ascending, starting at the first downbeat */
  beats: number[]
  /** true if the performance was steady enough for a single tempo */
  steady: boolean
}

export interface KeyInfo {
  tonic: number // pitch class 0..11
  mode: 'major' | 'minor'
}

export interface Arrangement {
  notes: ArrangedNote[] // sorted by start
  grid: BeatGrid
  key: KeyInfo
  /** semitones applied (manual or auto) */
  transpose: number
  duration: number
}

/** Hard limits for the EZ-220 (61 keys, C2..C7). */
export const KEY_LOW = 36
export const KEY_HIGH = 96

export const MAX_POLY: Record<Difficulty, { R: number; L: number }> = {
  easy: { R: 1, L: 2 },
  medium: { R: 3, L: 3 },
  original: { R: 4, L: 4 },
}
