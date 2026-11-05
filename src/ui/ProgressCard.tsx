import { STAGES, type Progress, type StageId } from '../engine/client'
import { IconCheck } from './icons'

interface Props {
  fileName: string
  progress: Progress | null
  engine: 'piano' | 'basic-pitch'
  error: string | null
  onCancel: () => void
}

// rough share of total time per stage, for the overall bar
const WEIGHT: Record<StageId, number> = { decode: 4, model: 8, transcribe: 80, cleanup: 2, tempo: 2, hands: 2, midi: 2 }

function fmtEta(s: number) {
  if (s < 10) return 'A few seconds left'
  if (s < 60) return `About ${Math.round(s / 5) * 5} s left`
  const m = Math.round(s / 60)
  return `About ${m} min left`
}

export function ProgressCard({ fileName, progress, engine, error, onCancel }: Props) {
  const stages = STAGES.filter((s) => engine === 'piano' || s.id !== 'model')
  const idx = progress ? stages.findIndex((s) => s.id === progress.stage) : 0
  const total = stages.reduce((s, x) => s + WEIGHT[x.id], 0)
  const done = stages.slice(0, Math.max(0, idx)).reduce((s, x) => s + WEIGHT[x.id], 0) + (progress ? WEIGHT[progress.stage] * progress.fraction : 0)
  const pct = Math.min(100, Math.round((done / total) * 100))

  return (
    <main className="page">
      <section className="card glass" aria-busy={!error}>
        <div className="card-head">
          <div>
            <h2>Converting</h2>
            <p className="muted" style={{ marginTop: 4, wordBreak: 'break-word' }}>{fileName}</p>
          </div>
          <button className="btn btn-secondary" onClick={onCancel}>
            {error ? 'Back' : 'Cancel'}
          </button>
        </div>

        <div className="progress-top num">
          <span>{pct}%</span>
          <span aria-live="polite">{progress?.eta != null && progress.stage === 'transcribe' ? fmtEta(progress.eta) : ''}</span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Overall progress">
          <div style={{ width: `${pct}%` }} />
        </div>

        <ol className="stages">
          {stages.map((s, i) => {
            const state = i < idx ? 'done' : i === idx ? 'active' : ''
            return (
              <li key={s.id} className={`stage ${error && i === idx ? '' : state}`}>
                <span className="mark">{state === 'done' && <IconCheck size={12} />}</span>
                <span>{s.label}</span>
                <span className="stage-detail num">{i === idx && progress?.detail}</span>
              </li>
            )
          })}
        </ol>

        {progress?.backend && !error && (
          <p className="faint" style={{ marginTop: 16, fontSize: 13 }}>
            Running on {progress.backend.startsWith('webgpu') ? 'your graphics card (WebGPU)' : progress.backend === 'basic-pitch' ? 'Basic Pitch' : `the CPU (${progress.backend.replace('wasm', 'WebAssembly')})`}. Everything stays on this device.
          </p>
        )}
        {error && (
          <p className="notice err" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
