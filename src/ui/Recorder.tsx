import { useEffect, useRef, useState } from 'react'
import { fmtTime } from './controls'

export type RecordSource = 'tab' | 'mic'

export const canCaptureTab = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && !/android|iphone|ipad|ipod/i.test(navigator.userAgent)
export const canRecordMic = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

const MAX_SECONDS = 10 * 60

function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

/**
 * Records audio from another browser tab (play the song there) or from the microphone, then
 * hands the recording over like a dropped file. Nothing leaves the device.
 */
export function Recorder({ source, onDone, onCancel }: { source: RecordSource; onDone: (f: File) => void; onCancel: () => void }) {
  const [state, setState] = useState<'starting' | 'recording' | 'error'>('starting')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const cancelled = useRef(false)

  useEffect(() => {
    let raf = 0
    let timer = 0
    let ctx: AudioContext | null = null
    ;(async () => {
      try {
        let s: MediaStream
        if (source === 'tab') {
          s = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Chrome only offers tab audio together with video; the video is dropped right away
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            // @ts-expect-error Chrome-only hints
            systemAudio: 'include',
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude',
          })
          s.getVideoTracks().forEach((t) => t.stop())
          if (!s.getAudioTracks().length) throw new Error('No sound was shared. Pick a tab and turn on "Also share tab audio".')
        } else {
          s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        }
        const audioOnly = new MediaStream(s.getAudioTracks())
        stream.current = s
        const mime = pickMime()
        const r = new MediaRecorder(audioOnly, mime ? { mimeType: mime, audioBitsPerSecond: 160000 } : undefined)
        rec.current = r
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
        r.onstop = () => {
          stream.current?.getTracks().forEach((t) => t.stop())
          if (cancelled.current || !chunks.current.length) return
          const type = r.mimeType || 'audio/webm'
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
          const stamp = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          onDone(new File(chunks.current, `${source === 'tab' ? 'Tab recording' : 'Recording'} ${stamp}.${ext}`.replace(/[/:]/g, '-'), { type }))
        }
        // stops by itself when the shared tab is closed
        s.getAudioTracks()[0].addEventListener('ended', () => r.state === 'recording' && r.stop())
        r.start(1000)
        setState('recording')
        // level meter
        ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 512
        ctx.createMediaStreamSource(audioOnly).connect(an)
        const buf = new Float32Array(an.fftSize)
        const tick = () => {
          raf = requestAnimationFrame(tick)
          an.getFloatTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v))
          setLevel((l) => Math.max(peak, l * 0.9))
        }
        tick()
        const t0 = performance.now()
        timer = window.setInterval(() => {
          const sec = (performance.now() - t0) / 1000
          setSeconds(sec)
          if (sec > MAX_SECONDS && r.state === 'recording') r.stop()
        }, 250)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(/denied|NotAllowed/i.test(msg) ? 'Permission was not given.' : msg)
        setState('error')
      }
    })()
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
      void ctx?.close()
      if (rec.current?.state === 'recording') {
        cancelled.current = true
        rec.current.stop()
      }
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [source, onDone])

  const stop = () => rec.current?.state === 'recording' && rec.current.stop()

  return (
    <section className="card glass recorder" aria-live="polite">
      <div className="card-head">
        <h2>{source === 'tab' ? 'Listening to a tab' : 'Recording'}</h2>
        <button
          className="btn btn-ghost"
          onClick={() => {
            cancelled.current = true
            stop()
            onCancel()
          }}
        >
          Cancel
        </button>
      </div>
      {state === 'starting' && <p className="muted">{source === 'tab' ? 'Pick the tab that plays the song and turn on "Also share tab audio".' : 'Allow the microphone…'}</p>}
      {state === 'error' && <p className="notice err">{error}</p>}
      {state === 'recording' && (
        <>
          <div className="rec-row">
            <span className="rec-dot" aria-hidden />
            <span className="num rec-time">{fmtTime(seconds)}</span>
            <div className="meter" aria-label="Input level">
              <div style={{ width: `${Math.min(100, level * 140)}%` }} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            {source === 'tab'
              ? 'Play the song from the start in the other tab. Press Done when it ends (or close that tab).'
              : 'Play the song near the microphone, or play it yourself. Quiet rooms work best.'}
          </p>
          <div className="actions">
            <button className="btn btn-primary btn-lg" onClick={stop} disabled={seconds < 2}>
              Done, convert it
            </button>
          </div>
        </>
      )}
    </section>
  )
}
