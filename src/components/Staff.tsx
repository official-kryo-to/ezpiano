import { parseNote, whiteIndex } from '../lib/notes'

interface Props {
  clef: 'treble' | 'bass'
  notes: number[]
  width?: number
  state?: 'idle' | 'good' | 'bad'
}

const GAP = 14
const TOP = 34

/** Minimal music staff that places natural notes, with ledger lines when needed. */
export function Staff({ clef, notes, width = 240, state = 'idle' }: Props) {
  const bottomRef = whiteIndex(parseNote(clef === 'treble' ? 'E4' : 'G2'))
  const bottomY = TOP + GAP * 4
  const yOf = (step: number) => bottomY - (step * GAP) / 2
  const height = TOP * 2 + GAP * 4
  const color = state === 'good' ? '#34d399' : state === 'bad' ? '#f87171' : 'currentColor'
  return (
    <svg className="staff" viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width * 1.6 }} role="img" aria-label={`${clef} clef staff`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={8} x2={width - 8} y1={TOP + i * GAP} y2={TOP + i * GAP} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} />
      ))}
      {clef === 'treble' ? (
        <text x={14} y={TOP + GAP * 3} fontSize={GAP * 5.2} className="clef" fill="currentColor">
          𝄞
        </text>
      ) : (
        <text x={14} y={TOP + GAP * 1} fontSize={GAP * 4.1} className="clef" fill="currentColor">
          𝄢
        </text>
      )}
      {notes.map((midi, i) => {
        const step = whiteIndex(midi) - bottomRef
        const cx = width * 0.6 + i * 36
        const cy = yOf(step)
        const ledgers: number[] = []
        for (let s = -2; s >= step; s -= 2) ledgers.push(s)
        for (let s = 10; s <= step; s += 2) ledgers.push(s)
        return (
          <g key={i}>
            {ledgers.map((s) => (
              <line key={s} x1={cx - 15} x2={cx + 15} y1={yOf(s)} y2={yOf(s)} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.4} />
            ))}
            <ellipse cx={cx} cy={cy} rx={GAP * 0.68} ry={GAP * 0.5} transform={`rotate(-20 ${cx} ${cy})`} fill={color} />
            <line
              x1={step >= 4 ? cx - GAP * 0.62 : cx + GAP * 0.62}
              x2={step >= 4 ? cx - GAP * 0.62 : cx + GAP * 0.62}
              y1={cy}
              y2={step >= 4 ? cy + GAP * 3.4 : cy - GAP * 3.4}
              stroke={color}
              strokeWidth={1.6}
            />
          </g>
        )
      })}
    </svg>
  )
}
