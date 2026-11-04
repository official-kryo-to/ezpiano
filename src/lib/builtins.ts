import { parseNote } from './notes'
import { guessLearnTracks, type Song, type SongNote, type SongTrack } from './song'

/**
 * Public-domain tunes written as "NOTE:beats" tokens ("R" = rest).
 * Kept tiny so the app has something to play offline on first launch.
 */
interface Builtin {
  id: string
  title: string
  artist: string
  bpm: number
  level: 'Beginner' | 'Easy' | 'Intermediate'
  rh: string
  lh?: string
  timeSig?: [number, number]
  /** beats before the first full bar */
  pickup?: number
}

const BUILTINS: Builtin[] = [
  {
    id: 'twinkle',
    title: 'Twinkle Twinkle Little Star',
    artist: 'Traditional',
    bpm: 100,
    level: 'Beginner',
    rh: `C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2
         G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2
         C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2`,
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    artist: 'Beethoven',
    bpm: 110,
    level: 'Beginner',
    rh: `E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2
         E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2
         D4:1 D4:1 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 G3:2
         E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2`,
    lh: `C3:4 G2:4 C3:4 G2:2 C3:2 C3:4 G2:4 C3:4 G2:2 C3:2 G2:4 C3:4 G2:4 G2:4 C3:4 G2:4 C3:4 G2:2 C3:2`,
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    artist: 'James Lord Pierpont',
    bpm: 120,
    level: 'Beginner',
    rh: `E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4
         F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2
         E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4
         F4:1 F4:1 F4:1 F4:1 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 G4:1 G4:1 F4:1 D4:1 C4:4`,
  },
  {
    id: 'happy-birthday',
    title: 'Happy Birthday',
    artist: 'Traditional',
    bpm: 100,
    level: 'Beginner',
    timeSig: [3, 4],
    pickup: 1,
    rh: `G4:0.75 G4:0.25 A4:1 G4:1 C5:1 B4:2 G4:0.75 G4:0.25 A4:1 G4:1 D5:1 C5:2
         G4:0.75 G4:0.25 G5:1 E5:1 C5:1 B4:1 A4:2 F5:0.75 F5:0.25 E5:1 C5:1 D5:1 C5:3`,
  },
  {
    id: 'fur-elise',
    title: 'Für Elise (opening)',
    artist: 'Beethoven',
    bpm: 140,
    level: 'Easy',
    timeSig: [3, 8],
    rh: `E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 R:0.5 C4:0.5 E4:0.5 A4:0.5 B4:1 R:0.5 E4:0.5 G#4:0.5 B4:0.5 C5:1 R:0.5 E4:0.5
         E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 R:0.5 C4:0.5 E4:0.5 A4:0.5 B4:1 R:0.5 E4:0.5 C5:0.5 B4:0.5 A4:2`,
    lh: `R:4 A2:0.5 E3:0.5 A3:0.5 R:1.5 E2:0.5 E3:0.5 G#3:0.5 R:1.5 A2:0.5 E3:0.5 A3:0.5 R:4.5
         A2:0.5 E3:0.5 A3:0.5 R:1.5 E2:0.5 E3:0.5 G#3:0.5 R:1.5 A2:0.5 E3:0.5 A3:0.5`,
  },
  {
    id: 'minuet-g',
    title: 'Minuet in G',
    artist: 'Petzold',
    bpm: 110,
    level: 'Easy',
    timeSig: [3, 4],
    rh: `D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5:1 G4:1 G4:1 E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5:1 G4:1 G4:1
         C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 A4:3`,
    lh: `G3:2 A3:1 B3:3 C4:3 B3:3 A3:3 G3:3 D3:3 D3:3`,
  },
  {
    id: 'canon-d',
    title: 'Canon in D (theme)',
    artist: 'Pachelbel',
    bpm: 70,
    level: 'Easy',
    rh: `F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2 D5:2 C#5:2 B4:2 A4:2 G4:2 F#4:2 G4:2 E4:2`,
    lh: `D3:2 A2:2 B2:2 F#2:2 G2:2 D2:2 G2:2 A2:2 D3:2 A2:2 B2:2 F#2:2 G2:2 D2:2 G2:2 A2:2`,
  },
]

function parseLine(src: string, bpm: number, track: number): SongNote[] {
  const beat = 60 / bpm
  const out: SongNote[] = []
  let t = 0
  for (const tok of src.split(/\s+/).filter(Boolean)) {
    const [name, beats] = tok.split(':')
    const dur = parseFloat(beats) * beat
    if (name !== 'R') out.push({ midi: parseNote(name), time: t, duration: dur * 0.95, velocity: 0.7, track })
    t += dur
  }
  return out
}

export interface BuiltinInfo {
  id: string
  title: string
  artist: string
  level: string
}

export const builtinList: BuiltinInfo[] = BUILTINS.map(({ id, title, artist, level }) => ({ id, title, artist, level }))

export function loadBuiltin(id: string): Song {
  const b = BUILTINS.find((x) => x.id === id)
  if (!b) throw new Error('Unknown song')
  const notes = [...parseLine(b.rh, b.bpm, 0), ...(b.lh ? parseLine(b.lh, b.bpm, 1) : [])]
  notes.sort((a, c) => a.time - c.time || a.midi - c.midi)
  // tiny count-in so the first note doesn't hit instantly
  for (const n of notes) n.time += 1
  const tracks: SongTrack[] = [
    { index: 0, name: 'Right hand', instrument: 'acoustic grand piano', family: 'piano', isDrums: false, noteCount: 0, avgPitch: 0 },
  ]
  if (b.lh) tracks.push({ index: 1, name: 'Left hand', instrument: 'acoustic grand piano', family: 'piano', isDrums: false, noteCount: 0, avgPitch: 0 })
  for (const t of tracks) {
    const own = notes.filter((n) => n.track === t.index)
    t.noteCount = own.length
    t.avgPitch = own.reduce((s, n) => s + n.midi, 0) / own.length
  }
  const sig = b.timeSig ?? [4, 4]
  const barLen = ((60 / b.bpm) * 4 * sig[0]) / sig[1]
  const duration = Math.max(...notes.map((n) => n.time + n.duration))
  const bars: number[] = []
  const first = 1 + ((b.pickup ?? 0) * 60) / b.bpm
  if (b.pickup) bars.push(1)
  for (let t = first; t <= duration; t += barLen) bars.push(t)
  return {
    id: `builtin:${b.id}`,
    title: b.title,
    source: 'builtin',
    duration,
    bpm: b.bpm,
    timeSig: sig,
    tracks,
    notes,
    learnTracks: guessLearnTracks(tracks, notes),
    bars,
  }
}
