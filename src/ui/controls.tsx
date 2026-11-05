import type { ReactNode } from 'react'

interface SegOption<T extends string> {
  value: T
  label: ReactNode
}

/** Radio group styled as a segmented control (arrow keys move the selection). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  full,
}: {
  label: string
  value: T
  options: SegOption<T>[]
  onChange: (v: T) => void
  full?: boolean
}) {
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + dir + options.length) % options.length]
    onChange(next.value)
  }
  return (
    <div
      className={`seg ${full ? 'full' : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export const fmtTime = (s: number) => {
  const t = Math.max(0, s)
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}
