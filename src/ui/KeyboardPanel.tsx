import { useEffect, useState } from 'react'
import { midi, midiSupported, type MidiStatus } from '../lib/midi'
import { Toggle } from './controls'

export function useMidiStatus() {
  const [s, setS] = useState<MidiStatus>(midi.status)
  useEffect(() => midi.subscribe((x) => setS({ ...x })), [])
  return s
}

/** Connect panel for the keyboard lights (Web MIDI). Hidden where Web MIDI does not exist (iOS). */
export function KeyboardPanel({ onChange }: { onChange?: () => void }) {
  const s = useMidiStatus()
  const prefs = midi.prefs

  if (!midiSupported()) {
    return <p className="kb-note">Keyboard lights need Chrome or Edge on a computer or Android. Converting and downloading work here.</p>
  }

  const connected = !!s.output
  return (
    <section className="panel glass" aria-labelledby="kb-h">
      <h3 id="kb-h">Keyboard lights</h3>
      <p className="kb-note" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className={`dot ${connected ? 'ok' : s.state === 'denied' ? 'warn' : ''}`} />
        <span aria-live="polite">
          {connected ? `Connected to ${s.output!.name}` : s.state === 'asking' ? 'Waiting for permission…' : s.state === 'denied' ? 'MIDI access was blocked' : s.state === 'ready' ? 'No keyboard found' : 'Not connected'}
        </span>
      </p>

      {s.state !== 'ready' ? (
        <>
          <button className="btn btn-secondary" onClick={() => midi.connect()} disabled={s.state === 'asking'}>
            Connect keyboard
          </button>
          <p className="kb-note" style={{ marginTop: 8 }}>
            Plug the EZ-220 in with a USB cable, then connect. Your browser asks for permission once.
          </p>
        </>
      ) : (
        <div className="devices">
          <label>
            Lights go to
            <select value={s.output?.id ?? ''} onChange={(e) => { midi.selectOutput(e.target.value); onChange?.() }}>
              {s.outputs.length === 0 && <option value="">No MIDI outputs</option>}
              {s.outputs.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label>
            Listen for key presses from
            <select value={s.input?.id ?? ''} onChange={(e) => midi.selectInput(e.target.value)}>
              {s.inputs.length === 0 && <option value="">No MIDI inputs</option>}
              {s.inputs.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {connected && (
        <div className="ctl" style={{ marginTop: 16 }}>
          <Toggle
            label="Keyboard plays the guide notes"
            checked={prefs.guideSound}
            onChange={(v) => {
              midi.setPrefs({ guideSound: v })
              midi.applyGuideVolume()
              onChange?.()
            }}
          />
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
              <option value="volume">Channel 1 volume 0 (CC 7)</option>
              <option value="velocity">Velocity 1</option>
            </select>
          </label>
          <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => midi.testLights()}>
            Test lights
          </button>
        </div>
      )}
    </section>
  )
}
