import { useEffect, useState } from 'react'
import { Cable, Keyboard, Smartphone, Volume2 } from 'lucide-react'
import { audio } from '../lib/audio'
import { connectMidi, onMidiState, type MidiState } from '../lib/input'
import type { Settings } from '../lib/storage'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  canInstall: boolean
  onInstall: () => void
}

export function SettingsScreen({ settings, onChange, canInstall, onInstall }: Props) {
  const [midi, setMidi] = useState<MidiState>({ supported: false, devices: [] })
  const [status, setStatus] = useState(audio.status)
  useEffect(() => onMidiState(setMidi), [])
  useEffect(() => audio.onStatus(setStatus), [])
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v })
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches

  return (
    <div className="screen settings">
      <section className="hero compact">
        <h1>Settings</h1>
      </section>

      <div className="card glass group">
        <h3>
          <Volume2 size={18} /> Sound
        </h3>
        <label className="field-label">
          Volume <b>{Math.round(settings.volume * 100)}%</b>
        </label>
        <input type="range" min={0} max={1} step={0.01} value={settings.volume} onChange={(e) => set('volume', parseFloat(e.target.value))} />
        <label className="field-label">Piano sound</label>
        <div className="seg wide">
          <button className={settings.sound === 'grand' ? 'on' : ''} onClick={() => set('sound', 'grand')}>
            Grand piano
          </button>
          <button className={settings.sound === 'synth' ? 'on' : ''} onClick={() => set('sound', 'synth')}>
            Light (no download)
          </button>
        </div>
        <p className="field-help">
          {status === 'loading' ? 'Downloading piano samples… they get saved for offline use.' : status === 'ready' ? 'Grand piano ready.' : status === 'synth' ? 'Using the light built-in sound.' : 'Sound starts after your first tap.'}
        </p>
      </div>

      <div className="card glass group">
        <h3>
          <Keyboard size={18} /> Notes & labels
        </h3>
        <label className="field-label">Note names</label>
        <div className="seg wide">
          <button className={settings.naming === 'letters' ? 'on' : ''} onClick={() => set('naming', 'letters')}>
            C D E F G
          </button>
          <button className={settings.naming === 'solfege' ? 'on' : ''} onClick={() => set('naming', 'solfege')}>
            Do Re Mi
          </button>
        </div>
        <div className="toggles">
          <label className="toggle">
            <input type="checkbox" checked={settings.keyLabels} onChange={(e) => set('keyLabels', e.target.checked)} />
            <span>Letters on every white key</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.noteLabels} onChange={(e) => set('noteLabels', e.target.checked)} />
            <span>Letters on falling notes</span>
          </label>
        </div>
        <p className="field-help">On a computer, play with your keyboard: A W S E D F T G Y H U J K. Z / X change octave.</p>
      </div>

      <div className="card glass group">
        <h3>
          <Cable size={18} /> MIDI keyboard
        </h3>
        {midi.supported ? (
          <>
            <p className="field-help">
              Plug a USB / Bluetooth MIDI keyboard in and ezpiano listens to it, so “Wait for me” mode checks your real playing.
            </p>
            {midi.devices.length ? (
              <p className="ok-line">Connected: {midi.devices.join(', ')}</p>
            ) : (
              <button className="btn" onClick={() => connectMidi()}>
                Connect MIDI keyboard
              </button>
            )}
            {midi.error && <p className="err-line">{midi.error}</p>}
          </>
        ) : (
          <p className="field-help">
            {isIOS
              ? 'Safari on iPhone/iPad doesn’t support MIDI keyboards in web apps. Use the on-screen keys, or Chrome on Android / desktop.'
              : 'This browser doesn’t support MIDI keyboards. Chrome or Edge do.'}
          </p>
        )}
      </div>

      <div className="card glass group">
        <h3>
          <Smartphone size={18} /> Install the app
        </h3>
        {standalone ? (
          <p className="ok-line">You’re using the installed app.</p>
        ) : canInstall ? (
          <button className="btn" onClick={onInstall}>
            Install ezpiano
          </button>
        ) : isIOS ? (
          <p className="field-help">
            On iPhone/iPad: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.
          </p>
        ) : (
          <p className="field-help">
            On Android: open the browser menu (⋮) and tap <b>Install app</b> or <b>Add to Home screen</b>.
          </p>
        )}
        <p className="field-help">Songs you open are saved on this device and work offline.</p>
      </div>

      <p className="credits muted">
        Song search powered by the free BitMIDI library. Piano samples by smplr. Made for learning, not for distribution: respect the
        copyright of the songs you play.
      </p>
    </div>
  )
}
