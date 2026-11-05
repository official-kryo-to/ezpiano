/**
 * Keyboard profiles: key range, which MIDI channels light the keys, and which channels the
 * exported MIDI file uses. Picked automatically from the USB device name, or chosen by hand.
 *
 * Light channels (from the makers' manuals):
 *  - Yamaha EZ-220 / EZ-200: notes received on channel 1 light the keys.
 *  - Yamaha EZ-300 / EZ-310: "Light Part" 1 and 2 default to channels 1 and 2.
 *  - Casio LK series: "Navigate" channels default to 4 (right hand) and 3 (left hand).
 */
export interface KeyboardProfile {
  id: string
  name: string
  /** used in the file name: <song>_<short>.mid */
  short: string
  low: number
  high: number
  /** 0-based MIDI channels that light keys; null when the instrument has no key lights */
  lights: { rh: number; lh: number } | null
  /** 0-based channels of the two tracks in the exported file */
  file: { rh: number; lh: number }
  hint: string
}

export const PROFILES: KeyboardProfile[] = [
  {
    id: 'yamaha-ez220',
    name: 'Yamaha EZ-220 / EZ-200',
    short: 'ez220',
    low: 36,
    high: 96,
    lights: { rh: 0, lh: 0 },
    file: { rh: 0, lh: 1 },
    hint: 'Lights keys for MIDI channel 1, so practised hands share it.',
  },
  {
    id: 'yamaha-ez300',
    name: 'Yamaha EZ-300 / EZ-310',
    short: 'ez300',
    low: 36,
    high: 96,
    lights: { rh: 0, lh: 1 },
    file: { rh: 0, lh: 1 },
    hint: 'Right hand lights on channel 1, left hand on channel 2 (Light Part 1 and 2).',
  },
  {
    id: 'casio-lk',
    name: 'Casio LK series (LK-S250, LK-S450, LK-280…)',
    short: 'casio-lk',
    low: 36,
    high: 96,
    lights: { rh: 3, lh: 2 },
    file: { rh: 3, lh: 2 },
    hint: 'Right hand on channel 4, left hand on channel 3 (the Navigate channel defaults).',
  },
  { id: 'keys-88', name: '88-key piano or controller', short: '88key', low: 21, high: 108, lights: null, file: { rh: 0, lh: 1 }, hint: 'No key lights. Wait for me listens to your playing.' },
  { id: 'keys-76', name: '76-key keyboard', short: '76key', low: 28, high: 103, lights: null, file: { rh: 0, lh: 1 }, hint: 'No key lights. Wait for me listens to your playing.' },
  { id: 'keys-61', name: '61-key keyboard', short: '61key', low: 36, high: 96, lights: null, file: { rh: 0, lh: 1 }, hint: 'No key lights. Wait for me listens to your playing.' },
  { id: 'keys-49', name: '49-key keyboard', short: '49key', low: 36, high: 84, lights: null, file: { rh: 0, lh: 1 }, hint: 'No key lights. Wait for me listens to your playing.' },
  { id: 'keys-37', name: '37-key keyboard', short: '37key', low: 48, high: 84, lights: null, file: { rh: 0, lh: 1 }, hint: 'No key lights. Wait for me listens to your playing.' },
  { id: 'keys-25', name: '25-key mini keyboard', short: '25key', low: 48, high: 72, lights: null, file: { rh: 0, lh: 1 }, hint: 'No key lights. Wait for me listens to your playing.' },
]

export const DEFAULT_PROFILE = PROFILES[0]

export const profileById = (id: string | undefined) => PROFILES.find((p) => p.id === id)

/** Best guess from a MIDI port name. */
export function detectProfile(portName: string): KeyboardProfile {
  const n = portName.toLowerCase()
  const by = (id: string) => profileById(id)!
  if (/ez-?3\d0/.test(n)) return by('yamaha-ez300')
  if (/ez-?2\d0/.test(n)) return by('yamaha-ez220')
  if (/casio/.test(n)) return by('casio-lk')
  if (/digital keyboard|portable keyboard|yamaha|psr/.test(n)) return by('yamaha-ez220')
  const count = /(?:^|\D)(25|32|37|49|61|73|76|88)(?:\D|$)/.exec(n)?.[1]
  if (count === '88' || count === '73') return by('keys-88')
  if (count === '76') return by('keys-76')
  if (count === '61') return by('keys-61')
  if (count === '49') return by('keys-49')
  if (count === '37' || count === '32') return by('keys-37')
  if (count === '25') return by('keys-25')
  if (/digital piano|clavinova|arius|privia|kawai|roland|fp-?\d|p-?\d{2,3}|nord|stage/.test(n)) return by('keys-88')
  if (/mpk ?mini|minilab|launchkey mini|microkey|nanokey/.test(n)) return by('keys-25')
  return by('keys-61')
}

/** Range shift by octaves so every note fits the keys. */
export function fitPitch(pitch: number, low: number, high: number): number {
  let p = pitch
  while (p < low) p += 12
  while (p > high) p -= 12
  // ranges narrower than an octave can't hold everything; clamp as a last resort
  return Math.max(low, Math.min(high, p))
}
