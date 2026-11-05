/**
 * Decode any browser-supported audio file to mono float32 at the rate a model needs, using
 * Web Audio only. Decoding straight into an OfflineAudioContext at the target rate lets the
 * browser resample; if that is not supported, we decode at a normal rate and resample in
 * 30 s chunks so very long files never need one huge render.
 */
export const ACCEPTED = '.mp3,.wav,.m4a,.flac,.aac,.ogg,audio/*'

const CHUNK_SECONDS = 30

function toMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i]
  }
  const k = 1 / buf.numberOfChannels
  for (let i = 0; i < out.length; i++) out[i] *= k
  return out
}

async function resampleChunked(buf: AudioBuffer, rate: number): Promise<Float32Array> {
  const total = Math.ceil(buf.duration * rate)
  const out = new Float32Array(total)
  const pad = 0.05
  for (let t0 = 0; t0 < buf.duration; t0 += CHUNK_SECONDS) {
    const from = Math.max(0, t0 - pad)
    const len = Math.min(CHUNK_SECONDS, buf.duration - t0)
    const frames = Math.ceil((len + (t0 - from)) * rate)
    const ctx = new OfflineAudioContext(1, frames, rate)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination) // multi-channel sources are down-mixed to the 1-channel context
    src.start(0, from, len + (t0 - from))
    const rendered = (await ctx.startRendering()).getChannelData(0)
    const skip = Math.round((t0 - from) * rate)
    const dst = Math.round(t0 * rate)
    out.set(rendered.subarray(skip, Math.min(rendered.length, skip + total - dst)), dst)
  }
  return out
}

export async function decodeAudio(file: Blob, rate: number): Promise<{ audio: Float32Array; duration: number }> {
  const bytes = await file.arrayBuffer()
  try {
    const ctx = new OfflineAudioContext(1, 1, rate)
    const buf = await ctx.decodeAudioData(bytes.slice(0))
    if (buf.sampleRate === rate) return { audio: toMono(buf), duration: buf.duration }
    return { audio: await resampleChunked(buf, rate), duration: buf.duration }
  } catch {
    // some browsers refuse very low context rates: decode at 44.1 kHz and resample ourselves
    let buf: AudioBuffer
    try {
      buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.slice(0))
    } catch {
      throw new Error('This file could not be decoded. Try MP3, WAV, M4A or FLAC.')
    }
    return { audio: await resampleChunked(buf, rate), duration: buf.duration }
  }
}
