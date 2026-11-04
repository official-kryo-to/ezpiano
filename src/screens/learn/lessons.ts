import { isBlack, noteName, parseNote, pitchClass, type NoteNaming } from '../../lib/notes'

export type LessonId = 'keyboard' | 'white' | 'black' | 'octaves' | 'treble' | 'bass' | 'ear'

export interface Slide {
  title: string
  body: string
  /** keys to highlight on the demo piano */
  keys?: string[]
  staff?: { clef: 'treble' | 'bass'; notes: string[] }
}

export interface Question {
  kind: 'key' | 'ear'
  prompt: string
  /** for staff reading */
  staff?: { clef: 'treble' | 'bass'; midi: number }
  /** for ear questions: two notes to compare */
  pair?: [number, number]
  check: (answer: number) => boolean
  /** key(s) to reveal when wrong */
  reveal: number[]
  explain: string
}

export interface Lesson {
  id: LessonId
  title: string
  blurb: string
  range: [string, string]
  /** show letter labels on the answer keyboard */
  labels: boolean
  /** ask for exact octave? */
  questions: number
  slides: Slide[]
  make: (naming: NoteNaming) => Question
}

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
const range = (lo: string, hi: string) => {
  const out: number[] = []
  for (let m = parseNote(lo); m <= parseNote(hi); m++) out.push(m)
  return out
}
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const FLAT_NAMES: Record<number, string> = { 1: 'Db', 3: 'Eb', 6: 'Gb', 8: 'Ab', 10: 'Bb' }

const letterQuestion = (pool: number[], naming: NoteNaming, explain: (m: number) => string): Question => {
  const target = pick(pool)
  const pc = pitchClass(target)
  return {
    kind: 'key',
    prompt: `Find ${noteName(target, naming)}`,
    check: (m) => pitchClass(m) === pc,
    reveal: [target],
    explain: explain(target),
  }
}

export const LESSONS: Lesson[] = [
  {
    id: 'keyboard',
    title: 'Find your way around',
    blurb: 'Spot C and F instantly using the black keys.',
    range: ['C4', 'B5'],
    labels: false,
    questions: 8,
    slides: [
      {
        title: 'The pattern repeats',
        body: 'Black keys come in groups of 2 and 3. That pattern repeats across the whole piano, so once you learn one group you know them all.',
        keys: ['C#4', 'D#4', 'F#4', 'G#4', 'A#4'],
      },
      {
        title: 'C lives left of the two',
        body: 'The white key just left of every group of TWO black keys is C. It’s the home base for almost everything.',
        keys: ['C4', 'C5'],
      },
      {
        title: 'F lives left of the three',
        body: 'The white key just left of every group of THREE black keys is F.',
        keys: ['F4', 'F5'],
      },
    ],
    make: (naming) =>
      letterQuestion(
        range('C4', 'B5').filter((m) => [0, 5].includes(pitchClass(m))),
        naming,
        (m) => (pitchClass(m) === 0 ? 'C is just left of the 2 black keys.' : 'F is just left of the 3 black keys.'),
      ),
  },
  {
    id: 'white',
    title: 'The white keys',
    blurb: 'C D E F G A B, then it starts again.',
    range: ['C4', 'B5'],
    labels: false,
    questions: 10,
    slides: [
      {
        title: 'Only seven letters',
        body: 'White keys are named C D E F G A B, then the next C starts over. Count up from C to find any letter.',
        keys: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'],
      },
      {
        title: 'Anchor trick',
        body: 'D sits between the two black keys. G and A hug the middle of the group of three. Use C, D, F as landmarks and step from there.',
        keys: ['D4', 'G4', 'A4'],
      },
    ],
    make: (naming) =>
      letterQuestion(
        range('C4', 'B5').filter((m) => !isBlack(m)),
        naming,
        (m) => {
          const i = LETTERS.indexOf(noteName(m))
          return i <= 2 ? `Count up from C: ${LETTERS.slice(0, i + 1).join(' ')}` : `Count up from F: ${LETTERS.slice(3, i + 1).join(' ')}`
        },
      ),
  },
  {
    id: 'black',
    title: 'Sharps & flats',
    blurb: 'What the # and b mean, and why one key has two names.',
    range: ['C4', 'B5'],
    labels: true,
    questions: 8,
    slides: [
      {
        title: 'Sharp = one step up',
        body: 'A sharp (#) is the very next key to the RIGHT. C# is the black key right after C.',
        keys: ['C4', 'C#4'],
      },
      {
        title: 'Flat = one step down',
        body: 'A flat (b) is the very next key to the LEFT. Db is the black key just before D, which is the same key as C#.',
        keys: ['D4', 'C#4'],
      },
    ],
    make: (naming) => {
      const target = pick(range('C4', 'B4').filter(isBlack))
      const pc = pitchClass(target)
      const useFlat = Math.random() < 0.5 && naming === 'letters'
      const name = useFlat ? FLAT_NAMES[pc] : noteName(target, naming)
      const base = useFlat ? noteName(target + 1, naming) : noteName(target - 1, naming)
      return {
        kind: 'key',
        prompt: `Find ${name}`,
        check: (m) => pitchClass(m) === pc,
        reveal: [target],
        explain: useFlat ? `${name} is the black key just LEFT of ${base}.` : `${name} is the black key just RIGHT of ${base}.`,
      }
    },
  },
  {
    id: 'octaves',
    title: 'Middle C & octaves',
    blurb: 'Why songs say C4 or E5, and where they are.',
    range: ['C3', 'B5'],
    labels: false,
    questions: 8,
    slides: [
      {
        title: 'Middle C = C4',
        body: 'The C nearest the middle of a full piano is called C4 (middle C). The number is the octave, and it goes up by one at every C.',
        keys: ['C4'],
      },
      {
        title: 'Same letter, different height',
        body: 'C3, C4 and C5 sound like the same note, just lower or higher. In ezpiano’s letter view, the small number tells you which one.',
        keys: ['C3', 'C4', 'C5'],
      },
    ],
    make: (naming) => {
      const target = pick(range('C3', 'B5').filter((m) => !isBlack(m)))
      return {
        kind: 'key',
        prompt: `Find ${noteName(target, naming, true)}`,
        check: (m) => m === target,
        reveal: [target],
        explain: `${noteName(target, naming, true)} is in the ${target < 60 ? 'octave below' : target < 72 ? 'middle C octave' : 'octave above'} middle C.`,
      }
    },
  },
  {
    id: 'treble',
    title: 'Read the treble clef',
    blurb: 'The right-hand staff. Lines and spaces made easy.',
    range: ['C4', 'B5'],
    labels: false,
    questions: 10,
    slides: [
      {
        title: 'Lines: E G B D F',
        body: '“Every Good Boy Does Fine.” From the bottom line up, the five lines are E G B D F.',
        staff: { clef: 'treble', notes: ['E4', 'G4', 'B4', 'D5', 'F5'] },
      },
      {
        title: 'Spaces spell FACE',
        body: 'The four spaces, bottom to top, spell F A C E.',
        staff: { clef: 'treble', notes: ['F4', 'A4', 'C5', 'E5'] },
      },
      {
        title: 'Middle C hangs below',
        body: 'Middle C sits on its own little line (a ledger line) just under the staff.',
        staff: { clef: 'treble', notes: ['C4'] },
        keys: ['C4'],
      },
    ],
    make: (naming) => {
      const target = pick(range('C4', 'A5').filter((m) => !isBlack(m)))
      const pc = pitchClass(target)
      return {
        kind: 'key',
        prompt: 'Which note is this?',
        staff: { clef: 'treble', midi: target },
        check: (m) => pitchClass(m) === pc,
        reveal: [target],
        explain: `That’s ${noteName(target, naming, true)}.`,
      }
    },
  },
  {
    id: 'bass',
    title: 'Read the bass clef',
    blurb: 'The left-hand staff, with its own rhymes.',
    range: ['C2', 'B4'],
    labels: false,
    questions: 10,
    slides: [
      {
        title: 'Lines: G B D F A',
        body: '“Good Boys Do Fine Always.” From the bottom line up: G B D F A.',
        staff: { clef: 'bass', notes: ['G2', 'B2', 'D3', 'F3', 'A3'] },
      },
      {
        title: 'Spaces: A C E G',
        body: '“All Cows Eat Grass.” The four spaces are A C E G.',
        staff: { clef: 'bass', notes: ['A2', 'C3', 'E3', 'G3'] },
      },
      {
        title: 'Middle C hangs above',
        body: 'In bass clef, middle C sits on a ledger line just ABOVE the staff.',
        staff: { clef: 'bass', notes: ['C4'] },
        keys: ['C4'],
      },
    ],
    make: (naming) => {
      const target = pick(range('E2', 'C4').filter((m) => !isBlack(m)))
      const pc = pitchClass(target)
      return {
        kind: 'key',
        prompt: 'Which note is this?',
        staff: { clef: 'bass', midi: target },
        check: (m) => pitchClass(m) === pc,
        reveal: [target],
        explain: `That’s ${noteName(target, naming, true)}.`,
      }
    },
  },
  {
    id: 'ear',
    title: 'Ear: higher or lower?',
    blurb: 'Train your ear to hear where a melody goes.',
    range: ['C4', 'B5'],
    labels: false,
    questions: 8,
    slides: [
      {
        title: 'Listen for direction',
        body: 'You’ll hear two notes. Was the second one higher or lower? This is the skill that lets you pick up tunes by ear.',
      },
    ],
    make: () => {
      const a = parseNote('C4') + Math.floor(Math.random() * 16)
      let step = 1 + Math.floor(Math.random() * 7)
      if (Math.random() < 0.5) step = -step
      const b = a + step
      return {
        kind: 'ear',
        prompt: 'Is the second note higher or lower?',
        pair: [a, b],
        // answer: 1 = higher, -1 = lower
        check: (ans) => Math.sign(ans) === Math.sign(step),
        reveal: [],
        explain: step > 0 ? 'It went up.' : 'It went down.',
      }
    },
  },
]
