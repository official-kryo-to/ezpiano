/**
 * Audio preprocessing before the piano model.
 *
 * The model was trained on MAESTRO (concert recordings at moderate level). Piano covers from
 * YouTube or a phone are usually mastered much louder (limited, -10 to -14 dBFS average), which
 * pushes the model's log-mel input outside what it saw in training. Bringing the loudness of the
 * playing parts back to a MAESTRO-like level fixes a large share of the errors on such files.
 */
export type PreprocessMode = 'none' | 'rms'

/**
 * MAESTRO recordings measure about -33 to -24 dBFS here (non-silent 100 ms frames); covers from
 * the web measure -18 to -12. Only audio louder than CEILING is turned down (to TARGET), and only
 * very quiet audio is turned up, so recordings already in the training range are left untouched.
 */
export const CEILING_DBFS = -20
export const TARGET_DBFS = -24
export const FLOOR_DBFS = -42
export const QUIET_TARGET_DBFS = -32

export function activeRmsDb(x: Float32Array, rate = 16000): number {
  const win = Math.round(rate * 0.1)
  const levels: number[] = []
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0
    for (let k = i; k < i + win; k++) s += x[k] * x[k]
    const db = 10 * Math.log10(s / win + 1e-12)
    if (db > -60) levels.push(db)
  }
  if (!levels.length) return -100
  levels.sort((a, b) => a - b)
  // mean power of the louder 80% of frames: ignores pauses and fade-outs
  const top = levels.slice(Math.floor(levels.length * 0.2))
  const p = top.reduce((s, db) => s + 10 ** (db / 10), 0) / top.length
  return 10 * Math.log10(p)
}

export function prepareAudio(x: Float32Array, mode: PreprocessMode = 'rms', rate = 16000): Float32Array {
  if (mode === 'none') return x
  const level = activeRmsDb(x, rate)
  if (level < -90) return x
  const targetDb = level > CEILING_DBFS ? TARGET_DBFS : level < FLOOR_DBFS ? QUIET_TARGET_DBFS : level
  if (targetDb === level) return x
  const gain = 10 ** ((targetDb - level) / 20)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] * gain
  return out
}
