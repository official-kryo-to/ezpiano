import { Midi } from '@tonejs/midi'

export interface SongNote {
  midi: number
  time: number // seconds
  duration: number // seconds
  velocity: number // 0..1
  track: number
}

export interface SongTrack {
  index: number
  name: string
  instrument: string
  family: string
  isDrums: boolean
  noteCount: number
  avgPitch: number
}

export type SongSource = 'bitmidi' | 'builtin' | 'import' | 'url'

export interface Song {
  id: string
  title: string
  source: SongSource
  duration: number
  bpm: number
  timeSig: [number, number]
  tracks: SongTrack[]
  notes: SongNote[] // sorted by time
  /** suggested default learn tracks */
  learnTracks: number[]
  /** start time of every bar, in seconds */
  bars: number[]
}

const MELODY_HINT = /melod|vocal|voice|lead|sing|right|solo|main|flute|violin|sax|trumpet/i
const ACCOMP_HINT = /bass|drum|perc|pad|string|chord|left|back|rhythm|guitar/i

export function parseMidi(bytes: ArrayBuffer, id: string, title: string, source: SongSource): Song {
  const midi = new Midi(bytes)
  const tracks: SongTrack[] = []
  const notes: SongNote[] = []
  midi.tracks.forEach((t) => {
    if (!t.notes.length) return
    const index = tracks.length
    const isDrums = t.channel === 9 || t.instrument.percussion
    const avg = t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length
    tracks.push({
      index,
      name: (t.name || t.instrument.name || `Track ${index + 1}`).trim(),
      instrument: t.instrument.name,
      family: t.instrument.family,
      isDrums,
      noteCount: t.notes.length,
      avgPitch: avg,
    })
    for (const n of t.notes) {
      if (n.duration <= 0.005) continue
      notes.push({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity, track: index })
    }
  })
  if (!notes.length) throw new Error('This MIDI file has no notes.')
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi)
  // trim leading silence so the song starts quickly
  const lead = Math.max(0, notes[0].time - 1)
  if (lead > 0) for (const n of notes) n.time -= lead
  const duration = Math.max(...notes.map((n) => n.time + n.duration))
  const bpm = Math.round(midi.header.tempos[0]?.bpm ?? 120)
  const ts = midi.header.timeSignatures[0]?.timeSignature
  const sig: [number, number] = ts && ts.length === 2 ? [ts[0], ts[1]] : [4, 4]
  const bars: number[] = []
  const ppq = midi.header.ppq || 480
  const ticksPerBar = Math.max(1, Math.round((ppq * 4 * sig[0]) / sig[1]))
  for (let tick = 0; bars.length < 5000; tick += ticksPerBar) {
    const sec = midi.header.ticksToSeconds(tick) - lead
    if (sec > duration + 0.01) break
    if (sec >= -0.01) bars.push(Math.max(0, sec))
  }
  return {
    id,
    title,
    source,
    duration,
    bpm,
    timeSig: sig,
    tracks,
    notes,
    learnTracks: guessLearnTracks(tracks, notes),
    bars,
  }
}

/** Decide which tracks a learner most likely wants: piano parts for piano pieces, otherwise the melody line. */
export function guessLearnTracks(tracks: SongTrack[], notes: SongNote[]): number[] {
  const tonal = tracks.filter((t) => !t.isDrums)
  if (!tonal.length) return []
  const total = tonal.reduce((s, t) => s + t.noteCount, 0)
  const pianos = tonal.filter((t) => t.family === 'piano')
  const pianoNotes = pianos.reduce((s, t) => s + t.noteCount, 0)
  if (pianos.length && pianoNotes / total > 0.6) return pianos.map((t) => t.index)

  let best = tonal[0]
  let bestScore = -Infinity
  for (const t of tonal) {
    const own = notes.filter((n) => n.track === t.index)
    const poly = polyphony(own)
    let score = t.avgPitch // higher lines are usually melody
    score -= poly * 6 // chords are rarely the melody
    score += Math.min(20, Math.log2(t.noteCount + 1) * 3)
    if (MELODY_HINT.test(t.name)) score += 25
    if (ACCOMP_HINT.test(t.name) || t.family === 'bass') score -= 25
    if (t.noteCount < 16) score -= 40
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return [best.index]
}

function polyphony(ns: SongNote[]): number {
  if (ns.length < 2) return 1
  let together = 0
  for (let i = 1; i < ns.length; i++) if (Math.abs(ns[i].time - ns[i - 1].time) < 0.03) together++
  return 1 + together / ns.length
}

export type Part = 'easy' | 'right' | 'left' | 'both'

export const PART_LABEL: Record<Part, string> = {
  easy: 'Easy melody',
  right: 'Right hand',
  left: 'Left hand',
  both: 'Both hands',
}

/** Hand on which a note is played (used for coloring). */
export type Hand = 'R' | 'L'

export interface LearnNote extends SongNote {
  id: number
  hand: Hand
}

/**
 * Build the list of notes the learner plays.
 * - easy: single-line top melody, octave-folded into a comfortable range
 * - right / left: split around middle C
 * - both: everything in the chosen tracks
 */
export function buildLearnNotes(song: Song, learnTracks: number[], part: Part): LearnNote[] {
  const set = new Set(learnTracks)
  const src = song.notes.filter((n) => set.has(n.track))
  let out: SongNote[]
  if (part === 'easy') out = easyMelody(src)
  else if (part === 'right') out = src.filter((n) => n.midi >= 60)
  else if (part === 'left') out = src.filter((n) => n.midi < 60)
  else out = src
  // With exactly two chosen tracks (typical "piano RH / piano LH" files), the hands come from the tracks.
  const byTrack = learnTracks.length === 2 && part !== 'easy'
  const trackAvg = (i: number) => song.tracks.find((t) => t.index === i)?.avgPitch ?? 0
  const rightTrack = byTrack ? (trackAvg(learnTracks[0]) >= trackAvg(learnTracks[1]) ? learnTracks[0] : learnTracks[1]) : -1
  if (byTrack && (part === 'right' || part === 'left')) {
    out = src.filter((n) => (n.track === rightTrack) === (part === 'right'))
  }
  const handOf = (n: SongNote): Hand => {
    if (part === 'easy' || part === 'right') return 'R'
    if (part === 'left') return 'L'
    if (byTrack) return n.track === rightTrack ? 'R' : 'L'
    return n.midi < 60 ? 'L' : 'R'
  }
  return out.map((n, i) => ({ ...n, id: i, hand: handOf(n) }))
}

/** Skyline melody extraction + cleanup so beginners get one note at a time. */
export function easyMelody(src: SongNote[]): SongNote[] {
  const sorted = [...src].filter((n) => n.duration > 0.06).sort((a, b) => a.time - b.time || b.midi - a.midi)
  const line: SongNote[] = []
  for (const n of sorted) {
    const prev = line[line.length - 1]
    if (prev && n.time - prev.time < 0.06) {
      // same onset: keep the highest
      if (n.midi > prev.midi) line[line.length - 1] = { ...n }
      continue
    }
    if (prev && n.time < prev.time + prev.duration) {
      // overlapping: a lower note under a sustained top note is accompaniment
      if (n.midi < prev.midi - 2 && n.time < prev.time + prev.duration * 0.8) continue
      prev.duration = Math.max(0.05, n.time - prev.time)
    }
    line.push({ ...n })
  }
  if (!line.length) return line
  // shift whole melody by octaves so it sits around G4
  const sortedPitches = line.map((n) => n.midi).sort((a, b) => a - b)
  const median = sortedPitches[Math.floor(sortedPitches.length / 2)]
  const shift = Math.round((67 - median) / 12) * 12
  for (const n of line) {
    n.midi += shift
    while (n.midi < 57) n.midi += 12
    while (n.midi > 84) n.midi -= 12
  }
  return line
}

/** Group notes that start together into chords (for wait mode + letter sheet). */
export function groupChords<T extends SongNote>(ns: T[], window = 0.04): T[][] {
  const groups: T[][] = []
  for (const n of ns) {
    const g = groups[groups.length - 1]
    if (g && n.time - g[0].time <= window) g.push(n)
    else groups.push([n])
  }
  return groups
}

export function cleanTitle(name: string): string {
  return name
    .replace(/\.midi?$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/(?<=\w)-(?=\w)/g, ' ')
    .replace(/\s+\d$/, (m) => ` (v${m.trim()})`)
    .replace(/\s+/g, ' ')
    .trim()
}
