import { cleanTitle } from './song'

const API = 'https://bitmidi.com'

export interface SearchResult {
  id: string
  name: string
  title: string
  plays: number
  views: number
  downloadUrl: string
  pageUrl: string
}

interface RawResult {
  id: number
  name: string
  plays: number
  views: number
  url: string
  downloadUrl: string
}

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'to', 'and', 'from', 'for', 'on', 'by', 'ft', 'feat', 'midi', 'piano', 'mid'])

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))

async function fetchPage(q: string, page: number, signal?: AbortSignal): Promise<RawResult[]> {
  const url = `${API}/api/midi/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=50`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const json = await res.json()
  return json?.result?.results ?? []
}

/**
 * Search BitMIDI and re-rank: results containing all query words float to the top,
 * then by popularity. Piano versions get a small boost since they're easier to learn from.
 */
export async function searchMidi(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []
  const pages = await Promise.all([fetchPage(q, 0, signal), fetchPage(q, 1, signal).catch(() => [])])
  const seen = new Set<number>()
  const want = tokens(q)
  const scored = pages
    .flat()
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => {
      const have = new Set(tokens(r.name))
      const hits = want.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w) && w.length >= 3)).length
      const coverage = want.length ? hits / want.length : 0
      let score = coverage * 100 + Math.log10((r.plays || 0) + 10) * 6
      if (/piano/i.test(r.name)) score += 6
      if (/easy|simple/i.test(r.name)) score += 4
      return { r, score, coverage }
    })
    .filter((x) => x.coverage > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, 40).map(({ r }) => ({
    id: String(r.id),
    name: r.name,
    title: cleanTitle(r.name),
    plays: r.plays,
    views: r.views,
    downloadUrl: API + r.downloadUrl,
    pageUrl: API + r.url,
  }))
}

export async function downloadMidi(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.arrayBuffer()
}

export const formatPlays = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)

/** Songs known to exist on BitMIDI, used as quick picks. */
export const QUICK_PICKS: { label: string; q: string }[] = [
  { label: 'River Flows in You', q: 'River Flows in You' },
  { label: 'Comptine d’un autre été', q: 'Comptine' },
  { label: 'Super Mario Theme', q: 'Super Mario Bros Theme' },
  { label: 'Pirates of the Caribbean', q: 'Pirates of the Caribbean' },
  { label: 'Moonlight Sonata', q: 'Moonlight Sonata' },
  { label: 'Tetris', q: 'Tetris theme' },
  { label: 'Never Gonna Give You Up', q: 'Never Gonna Give You Up' },
  { label: 'Unravel', q: 'Unravel' },
  { label: 'My Heart Will Go On', q: 'My Heart Will Go On' },
  { label: 'Star Wars', q: 'Star Wars theme' },
  { label: 'Gymnopédie No.1', q: 'Gymnopedie' },
  { label: 'Zelda', q: 'Legend of Zelda' },
]
