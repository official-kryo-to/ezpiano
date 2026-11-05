import { useEffect, useState } from 'react'
import { PROFILES } from '../lib/keyboards'
import { midi, midiSupported, type MidiStatus } from '../lib/midi'
import { Toggle } from './controls'

export function useMidiStatus() {
  const [s, setS] = useState<MidiStatus>(midi.status)
  useEffect(() => midi.subscribe((x) => setS({ ...x })), [])
  return s
}

/** Keyboard model picker, shown on its own where Web MIDI is missing. */
export function KeyboardModelSelect({ onChange, label = true }: { onChange?: () => void; label?: boolean }) {
  const s = useMidiStatus()
  const auto = midi.prefs.keyboardId === 'auto'
  return (
    <label className="devices">
      {label ? <span className="kb-note">Keyboard model</span> : <span className="sr-only">Keyboard model</span>}
      <select
        value={midi.prefs.keyboardId}
        onChange={(e) => {
          midi.setKeyboard(e.target.value)
          onChange?.()
        }}
      >
        <option value="auto">Auto{s.detected ? `: ${s.detected.name}` : auto ? `: ${s.profile.name}` : ''}</option>
        {PROFILES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.high - p.low + 1} keys)
          </option>
        ))}
      </select>
      <span className="kb-note">{s.profile.hint}</span>
    </label>
  )
}

/** Connect panel for the keyboard (Web MIDI). On iOS, where Web MIDI does not exist, a one-line note. */
export function KeyboardPanel({ onChange }: { onChange?: () => void }) {
  const s = useMidiStatus()
  const prefs = midi.prefs

  useEffect(() => {
    void midi.reconnectIfAllowed()
  }, [])

  if (!midiSupported()) {
    return (
      <div className="devices">
        <p className="kb-note">Keyboard lights need Chrome or Edge on a computer or Android. Converting and downloading work here.</p>
        <KeyboardModelSelect onChange={onChange} />
      </div>
    )
  }

  const connected = !!s.output
  const lights = !!s.profile.lights
  return (
    <section className="panel glass" aria-labelledby="kb-h">
      <h3 id="kb-h">Keyboard</h3>
      <p className="kb-note status-line">
        <span className={`dot ${connected ? 'ok' : s.state === 'denied' ? 'warn' : ''}`} />
        <span aria-live="polite">
          {connected
            ? `Connected: ${s.output!.name}`
            : s.state === 'asking'
              ? 'Waiting for permission…'
              : s.state === 'denied'
                ? 'MIDI access was blocked in the browser'
                : s.state === 'ready'
                  ? 'No keyboard found. Check the USB cable.'
                  : 'Not connected'}
        </span>
      </p>

      {s.state !== 'ready' ? (
        <>
          <button className="btn btn-secondary" onClick={() => midi.connect()} disabled={s.state === 'asking'}>
            Connect keyboard
          </button>
          <p className="kb-note" style={{ marginTop: 8 }}>
            Plug the keyboard in with a USB cable, then connect. The browser asks for permission once.
          </p>
        </>
      ) : (
        <div className="devices">
          <label>
            Send to
            <select
              value={s.output?.id ?? ''}
              onChange={(e) => {
                midi.selectOutput(e.target.value)
                onChange?.()
              }}
            >
              {s.outputs.length === 0 && <option value="">No MIDI outputs</option>}
              {s.outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Listen to
            <select value={s.input?.id ?? ''} onChange={(e) => midi.selectInput(e.target.value)}>
              {s.inputs.length === 0 && <option value="">No MIDI inputs</option>}
              {s.inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <KeyboardModelSelect onChange={onChange} />
      </div>

      {connected && (
        <div className="ctl" style={{ marginTop: 16 }}>
          <Toggle
            label="Keyboard plays the guide notes"
            checked={prefs.guideSound}
            onChange={(v) => {
              midi.setPrefs({ guideSound: v })
              if (v || lights) midi.applyGuideVolume()
              onChange?.()
            }}
          />
          {lights && (
            <>
              <label className="devices" style={{ marginTop: 8 }}>
                <span className="kb-note">Silent lights method</span>
                <select
                  value={prefs.silentMethod}
                  disabled={prefs.guideSound}
                  onChange={(e) => {
                    midi.setPrefs({ silentMethod: e.target.value as 'volume' | 'velocity' })
                    midi.applyGuideVolume()
                    onChange?.()
                  }}
                >
                  <option value="volume">Light channel volume 0 (CC 7)</option>
                  <option value="velocity">Velocity 1</option>
                </select>
              </label>
              <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => midi.testLights()}>
                Test lights
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
