import { useState } from 'react'
import type { ConvertSettings, Difficulty, EngineKind, OutputMode } from '../engine/types'
import { Segmented, Toggle, fmtTime } from './controls'
import { IconBack, IconMusic } from './icons'

interface Props {
  fileName: string
  duration?: number
  initial: ConvertSettings
  /** re-arranging a converted song: the model does not run again */
  instant: boolean
  onBack: () => void
  onConvert: (s: ConvertSettings) => void
}

const DIFFICULTY_HELP: Record<Difficulty, string> = {
  easy: 'One right-hand note at a time. Left hand plays the chord root or a two-note shape on beat 1. Rhythm snapped to eighths.',
  medium: 'Up to three notes per hand. Rhythm snapped to sixteenths.',
  original: 'Close to what was played, with only light cleanup. Up to four notes per hand.',
}

const OUTPUT_HELP: Record<OutputMode, string> = {
  melody: 'Just the tune, in the right hand.',
  chords: 'The tune in the right hand, simple chords in the left.',
  full: 'Everything the model heard, split between your hands.',
}

export function SettingsCard({ fileName, duration, initial, instant, onBack, onConvert }: Props) {
  const [s, setS] = useState<ConvertSettings>(initial)
  const set = <K extends keyof ConvertSettings>(k: K, v: ConvertSettings[K]) => setS((p) => ({ ...p, [k]: v }))

  return (
    <main className="page">
      <section className="card glass">
        <div className="card-head">
          <h2>{instant ? 'Change the arrangement' : 'Conversion settings'}</h2>
          <button className="btn btn-ghost" onClick={onBack}>
            <IconBack /> Back
          </button>
        </div>
        <div className="file-chip">
          <IconMusic />
          <span>{fileName}</span>
          {duration != null && <span className="faint num">{fmtTime(duration)}</span>}
        </div>

        <div className="field">
          <span className="field-label" id="f-out">Output</span>
          <div>
            <Segmented<OutputMode>
              label="Output"
              value={s.output}
              onChange={(v) => set('output', v)}
              options={[
                { value: 'melody', label: 'Melody only' },
                { value: 'chords', label: 'Melody + simple chords' },
                { value: 'full', label: 'Full transcription' },
              ]}
            />
            <p className="field-help">{OUTPUT_HELP[s.output]}</p>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Difficulty</span>
          <div>
            <Segmented<Difficulty>
              label="Difficulty"
              value={s.difficulty}
              onChange={(v) => set('difficulty', v)}
              options={[
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'original', label: 'Original' },
              ]}
            />
            <p className="field-help">{DIFFICULTY_HELP[s.difficulty]}</p>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Transpose</span>
          <div>
            <div className="stepper">
              <button className="icon-btn sm" aria-label="Transpose down" disabled={s.autoTranspose || s.transpose <= -12} onClick={() => set('transpose', s.transpose - 1)}>
                −
              </button>
              <output className="num" aria-live="polite">
                {s.autoTranspose ? 'Auto' : `${s.transpose > 0 ? '+' : ''}${s.transpose}`}
              </output>
              <button className="icon-btn sm" aria-label="Transpose up" disabled={s.autoTranspose || s.transpose >= 12} onClick={() => set('transpose', s.transpose + 1)}>
                +
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <Toggle label="Auto-transpose to the easiest key (C major / A minor)" checked={s.autoTranspose} onChange={(v) => set('autoTranspose', v)} />
            </div>
            <p className="field-help">Semitones. Notes outside the 61 keys are moved by octaves, never dropped.</p>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Rhythm</span>
          <div>
            <Toggle label="Quantize to the beat" checked={s.quantize} onChange={(v) => set('quantize', v)} />
            <p className="field-help">Snaps notes to the detected beat so the file reads cleanly. Turn off to keep the player's exact timing.</p>
          </div>
        </div>

        {!instant && (
          <div className="field">
            <span className="field-label">Recording</span>
            <div>
              <Segmented<EngineKind>
                label="Recording type"
                value={s.engine}
                onChange={(v) => set('engine', v)}
                options={[
                  { value: 'piano', label: 'Piano' },
                  { value: 'basic-pitch', label: 'Other instruments' },
                ]}
              />
              <p className="field-help">
                {s.engine === 'piano'
                  ? 'Piano model (ByteDance, Kong et al.). Most accurate for piano.'
                  : 'Basic Pitch (Spotify). For guitar, voice or band recordings. Less accurate on piano.'}
              </p>
            </div>
          </div>
        )}

        <div className="actions">
          <button className="btn btn-primary btn-lg" onClick={() => onConvert(s)}>
            {instant ? 'Apply' : 'Convert'}
          </button>
        </div>
      </section>
    </main>
  )
}
