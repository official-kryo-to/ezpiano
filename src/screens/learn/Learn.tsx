import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Star, Volume2 } from 'lucide-react'
import { Piano, type KeyMark } from '../../components/Piano'
import { Staff } from '../../components/Staff'
import { audio } from '../../lib/audio'
import { input } from '../../lib/input'
import { parseNote } from '../../lib/notes'
import { loadLessonProgress, storeLessonProgress, type LessonProgress, type Settings } from '../../lib/storage'
import { LESSONS, type Lesson, type Question } from './lessons'

export function Learn({ settings }: { settings: Settings }) {
  const [progress, setProgress] = useState<LessonProgress>(loadLessonProgress)
  const [active, setActive] = useState<Lesson | null>(null)

  if (active)
    return (
      <LessonRunner
        lesson={active}
        settings={settings}
        onExit={() => setActive(null)}
        onDone={(best) => {
          const prev = progress[active.id]
          const stars = best >= 90 ? 3 : best >= 70 ? 2 : 1
          const next = { ...progress, [active.id]: { stars: Math.max(prev?.stars ?? 0, stars), best: Math.max(prev?.best ?? 0, best) } }
          setProgress(next)
          storeLessonProgress(next)
        }}
      />
    )

  const total = LESSONS.reduce((s, l) => s + (progress[l.id]?.stars ?? 0), 0)
  return (
    <div className="screen learn">
      <section className="hero compact">
        <span className="eyebrow">Optional</span>
        <h1>
          Learn to <span className="grad">read notes</span>
        </h1>
        <p className="sub">
          Totally separate from songs. Short, game-like drills that make you faster at finding keys and reading sheet music.
        </p>
        <div className="stars-total glass">
          <Star size={16} fill="currentColor" /> {total} / {LESSONS.length * 3} stars
        </div>
      </section>
      <div className="lesson-list">
        {LESSONS.map((l, i) => {
          const p = progress[l.id]
          return (
            <button key={l.id} className="lesson glass" onClick={() => setActive(l)}>
              <span className={`lesson-num ${p ? 'done' : ''}`}>{p ? <Check size={16} /> : i + 1}</span>
              <div className="row-main">
                <strong>{l.title}</strong>
                <span className="muted">{l.blurb}</span>
              </div>
              <span className="lesson-stars">
                {[1, 2, 3].map((s) => (
                  <Star key={s} size={14} fill={(p?.stars ?? 0) >= s ? 'currentColor' : 'none'} className={(p?.stars ?? 0) >= s ? 'lit' : ''} />
                ))}
              </span>
              <ChevronRight size={18} className="muted" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LessonRunner({ lesson, settings, onExit, onDone }: { lesson: Lesson; settings: Settings; onExit: () => void; onDone: (score: number) => void }) {
  const [slide, setSlide] = useState(0)
  const [phase, setPhase] = useState<'intro' | 'drill' | 'done'>('intro')
  const [q, setQ] = useState<Question>(() => lesson.make(settings.naming))
  const [n, setN] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [feedback, setFeedback] = useState<null | { ok: boolean; text: string }>(null)
  const [marks, setMarks] = useState<Map<number, KeyMark>>(new Map())
  const firstTry = useRef(true)
  const correctRef = useRef(0)
  const nRef = useRef(0)
  const lo = parseNote(lesson.range[0])
  const hi = parseNote(lesson.range[1])

  const next = () => {
    if (nRef.current + 1 >= lesson.questions) {
      const score = Math.round((correctRef.current / lesson.questions) * 100)
      onDone(score)
      setPhase('done')
      return
    }
    nRef.current += 1
    setN(nRef.current)
    let nq = lesson.make(settings.naming)
    // avoid asking the same thing twice in a row
    for (let i = 0; i < 4 && nq.prompt === q.prompt && nq.staff?.midi === q.staff?.midi && nq.reveal[0] === q.reveal[0]; i++) nq = lesson.make(settings.naming)
    setQ(nq)
    setFeedback(null)
    setMarks(new Map())
    firstTry.current = true
  }

  const answer = (value: number, midi?: number) => {
    if (feedback?.ok) return
    const ok = q.check(value)
    if (ok) {
      if (firstTry.current) {
        correctRef.current += 1
        setCorrect(correctRef.current)
      }
      setFeedback({ ok: true, text: firstTry.current ? pickPraise() : 'Got it.' })
      if (midi != null) setMarks(new Map([[midi, 'good']]))
      setTimeout(next, 750)
    } else {
      firstTry.current = false
      setFeedback({ ok: false, text: q.explain })
      const m = new Map<number, KeyMark>()
      q.reveal.forEach((r) => m.set(r, 'hint'))
      if (midi != null) m.set(midi, 'bad')
      setMarks(m)
    }
  }

  // answer by playing any key (touch, computer keys or MIDI keyboard)
  const answerRef = useRef(answer)
  answerRef.current = answer
  useEffect(
    () =>
      input.subscribe((ev) => {
        if (ev.type === 'on' && phase === 'drill' && q.kind === 'key') answerRef.current(ev.midi, ev.midi)
      }),
    [phase, q.kind],
  )

  const playPair = () => {
    if (!q.pair) return
    const ctx = audio.unlock()
    const t = ctx.currentTime + 0.05
    audio.play(q.pair[0], t, 0.6, 0.8)
    audio.play(q.pair[1], t + 0.75, 0.8, 0.8)
  }
  useEffect(() => {
    if (phase === 'drill' && q.kind === 'ear') {
      const id = setTimeout(playPair, 300)
      return () => clearTimeout(id)
    }
  }, [q, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const s = lesson.slides[slide]
  const demoMarks = useMemo(() => new Map<number, KeyMark>((s?.keys ?? []).map((k) => [parseNote(k), 'R'])), [s])
  const score = Math.round((correct / lesson.questions) * 100)

  return (
    <div className="screen lesson-run">
      <div className="lesson-top">
        <button className="icon-btn" onClick={onExit} aria-label="Back to lessons">
          <ArrowLeft size={20} />
        </button>
        <strong>{lesson.title}</strong>
        {phase === 'drill' && (
          <div className="bar">
            <div style={{ width: `${(n / lesson.questions) * 100}%` }} />
          </div>
        )}
      </div>

      {phase === 'intro' && s && (
        <div className="lesson-body">
          <div className="card glass slide">
            <span className="eyebrow">
              {slide + 1} / {lesson.slides.length}
            </span>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            {s.staff && <Staff clef={s.staff.clef} notes={s.staff.notes.map(parseNote)} width={260} />}
          </div>
          {s.keys && <Piano lo={lo} hi={hi} marks={demoMarks} labels={lesson.id === 'keyboard' ? 'c' : 'all'} naming={settings.naming} height={150} />}
          <div className="row end">
            {slide > 0 && (
              <button className="btn ghost" onClick={() => setSlide(slide - 1)}>
                Back
              </button>
            )}
            <button className="btn" onClick={() => (slide + 1 < lesson.slides.length ? setSlide(slide + 1) : setPhase('drill'))}>
              {slide + 1 < lesson.slides.length ? 'Next' : 'Start practice'}
            </button>
          </div>
        </div>
      )}

      {phase === 'drill' && (
        <div className="lesson-body">
          <div className={`card glass question ${feedback ? (feedback.ok ? 'ok' : 'nope') : ''}`}>
            <h2>{q.prompt}</h2>
            {q.staff && <Staff clef={q.staff.clef} notes={[q.staff.midi]} state={feedback ? (feedback.ok ? 'good' : 'bad') : 'idle'} />}
            <p className={`feedback ${feedback ? (feedback.ok ? 'ok' : 'nope') : ''}`}>{feedback?.text ?? ' '}</p>
          </div>
          {q.kind === 'key' ? (
            <Piano lo={lo} hi={hi} marks={marks} labels={lesson.labels ? 'all' : 'none'} naming={settings.naming} height={170} />
          ) : (
            <div className="ear-row">
              <button className="btn ghost" onClick={playPair}>
                <Volume2 size={18} /> Hear again
              </button>
              <button className="btn big" onClick={() => answer(-1)}>
                <ArrowDown size={20} /> Lower
              </button>
              <button className="btn big" onClick={() => answer(1)}>
                <ArrowUp size={20} /> Higher
              </button>
            </div>
          )}
          {feedback && !feedback.ok && (
            <div className="row end">
              <button className="btn ghost" onClick={next}>
                Skip
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="lesson-body center">
          <div className="card glass result">
            <div className="big-stars">
              {[1, 2, 3].map((i) => (
                <Star key={i} size={36} fill={(score >= 90 ? 3 : score >= 70 ? 2 : 1) >= i ? 'currentColor' : 'none'} />
              ))}
            </div>
            <div className="acc">{score}%</div>
            <p>
              {correct} of {lesson.questions} on the first try.
            </p>
            <div className="row">
              <button
                className="btn ghost"
                onClick={() => {
                  setN(0)
                  setCorrect(0)
                  nRef.current = 0
                  correctRef.current = 0
                  setFeedback(null)
                  setMarks(new Map())
                  setQ(lesson.make(settings.naming))
                  firstTry.current = true
                  setPhase('drill')
                }}
              >
                Try again
              </button>
              <button className="btn" onClick={onExit}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PRAISE = ['Nice!', 'Yes!', 'Spot on.', 'Easy.', 'Perfect.', 'Nailed it.']
const pickPraise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)]
