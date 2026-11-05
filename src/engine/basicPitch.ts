/**
 * Fallback transcriber for non-piano audio: Spotify's Basic Pitch (Apache-2.0), via its npm package.
 * Loaded lazily so tfjs is only downloaded when someone picks "Other instruments".
 */
import type { RawNote } from './types'

export const BASIC_PITCH_RATE = 22050

export async function transcribeBasicPitch(
  audio22k: Float32Array,
  model: string | Promise<unknown>, // URL of model.json, or an already loaded tf.GraphModel
  onProgress?: (fraction: number) => void,
): Promise<RawNote[]> {
  // TensorFlow.js expects `window` in a few places; in a worker the global scope stands in for it.
  const g = globalThis as unknown as { window?: unknown }
  if (typeof g.window === 'undefined') g.window = globalThis
  const tf = await import('@tensorflow/tfjs')
  try {
    if (!(await tf.setBackend('webgl'))) throw new Error('no webgl')
  } catch {
    await tf.setBackend('cpu')
  }
  await tf.ready()
  const bp = await import('@spotify/basic-pitch')
  const runner = new bp.BasicPitch(model as ConstructorParameters<typeof bp.BasicPitch>[0])
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await runner.evaluateModel(
    audio22k,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    (p: number) => onProgress?.(p),
  )
  // same defaults as the Python package: onset 0.5, frame 0.3, min note ~128 ms (11 frames)
  const events = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 11)))
  return events
    .map((e) => ({
      pitch: e.pitchMidi,
      start: e.startTimeSeconds,
      end: e.startTimeSeconds + e.durationSeconds,
      velocity: Math.max(1, Math.min(127, Math.round(e.amplitude * 127))),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}
