// Tačnost Forme: za odigrano kolo Forma se izračuna kakva je bila prije utakmica (server šalje samo podatke
// od prije), pa se uporedi sa zapisnikom. Računa se ovdje, istom formulom kao Forma, pa svaka promjena
// formule odmah pokazuje kako bi prošla na cijeloj sezoni.
import { bestPicks, chance, enrichRound } from './forma.js'

// Grupe šanse; zadnja ide do 80% (više Forma ne daje).
export const BUCKETS = [
  { label: '50–55%', from: 50, to: 55 },
  { label: '55–60%', from: 55, to: 60 },
  { label: '60–65%', from: 60, to: 65 },
  { label: '65–70%', from: 65, to: 70 },
  { label: '70–80%', from: 70, to: 81 },
]
// Ispod ovoliko igrača sa Maxbet granicom zaključak nije pouzdan.
export const MIN_SAMPLE = 60
const BUCKET_MIN = 15
// "Nije igrao" se broji samo za igrače iz rotacije (bar toliko minuta u sezoni), ne za juniore.
const MISSES = 6
const ROTATION_MINUTES = 10

// Tip sa tiketa: "+", "-", "−" (i "+ 15.5" i slično); ostalo (npr. prvi poeni) se ne broji.
function tipOf(text) {
  const t = (text ?? '').trim()
  if (t.startsWith('+')) return '+'
  if (/^[-−–]/.test(t)) return '−'
  return null
}
const passes = (tip, pts, line) => (tip === '+' ? pts > line : pts < line)

// Jedno kolo: igrači koji su igrali, oni koji nisu (DNP), najbolje šanse i tipovi sa tiketa.
export function roundAccuracy(data) {
  const players = enrichRound(data)
  const done = new Set(data.doneTeams)
  const gameOfTeam = new Map()
  for (const game of data.games) {
    gameOfTeam.set(game.home, game)
    gameOfTeam.set(game.away, game)
  }
  const result = (p) => (done.has(p.team) ? (data.results[p.id] ?? { min: 0, pts: 0 }) : null)

  const rows = []
  const dnp = []
  for (const p of players) {
    const r = result(p)
    if (!r) continue
    if (r.min === 0) {
      if (p.season.min < ROTATION_MINUTES) continue
      // Da li ga je Forma najavila: ne igra / upitan, nije u ponudi Maxbeta, ili "Nije igrao x/5".
      dnp.push({ p, flagged: p.out || p.offer === false || p.flags.some((f) => f.label.startsWith('Nije igrao')) })
      continue
    }
    const maxbet = p.lineSrc === 'maxbet'
    rows.push({ p, round: data.round, pts: r.pts, min: r.min, err: Math.abs(p.proj.pts.value - r.pts), maxbet, hit: maxbet ? passes(p.chance.tip, r.pts, p.line) : null })
  }

  const best = []
  for (const p of bestPicks(players, data.games, gameOfTeam, Infinity)) {
    const r = result(p)
    if (p.lineSrc === 'maxbet' && r && r.min > 0) best.push(passes(p.chance.tip, r.pts, p.line))
  }

  const byId = new Map(players.map((p) => [p.id, p]))
  const picks = []
  for (const pick of data.picks) {
    const tip = tipOf(pick.tip)
    const p = byId.get(pick.playerId)
    const r = p && result(p)
    if (!tip || pick.line === null || !r || r.min === 0) continue
    const forma = chance(pick.line, p.proj.pts.value, p.chance.sd).tip
    picks.push({ agree: tip === forma, hit: passes(tip, r.pts, pick.line) })
  }

  return { round: data.round, rows, dnp, best, picks }
}

const share = (list) => ({ n: list.length, hits: list.filter(Boolean).length, pct: list.length ? Math.round((list.filter(Boolean).length / list.length) * 100) : null })
const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null)

// Zašto je promašio: minute, i oznake koje je Forma imala.
function missReason(row) {
  const reasons = []
  const usual = row.p.season.min
  if (row.min < usual * 0.7) reasons.push(`${row.min} min (obično ${Math.round(usual)})`)
  else if (row.min > usual + 6) reasons.push(`${row.min} min, više nego obično`)
  return reasons.join(', ')
}

// Cijela sezona iz kola: brojevi za ekran Tačnosti.
export function summarize(rounds) {
  const rows = rounds.flatMap((r) => r.rows)
  const tips = rows.filter((r) => r.maxbet)
  const picks = rounds.flatMap((r) => r.picks)
  const dnp = rounds.flatMap((r) => r.dnp)
  const tagged = (test) => share(tips.filter((r) => test(r.p)).map((r) => r.hit))

  const buckets = BUCKETS.map((b) => {
    const list = tips.filter((r) => r.p.chance.pct >= b.from && r.p.chance.pct < b.to)
    return { ...b, ...share(list.map((r) => r.hit)), promised: mean(list.map((r) => r.p.chance.pct)) }
  })

  return {
    tip: share(tips.map((r) => r.hit)),
    best: share(rounds.flatMap((r) => r.best)),
    err: mean(rows.map((r) => r.err)),
    errMaxbet: mean(tips.map((r) => r.err)),
    agree: share(picks.filter((x) => x.agree).map((x) => x.hit)),
    against: share(picks.filter((x) => !x.agree).map((x) => x.hit)),
    buckets,
    perRound: rounds.filter((r) => r.rows.length).map((r) => ({
      round: r.round,
      err: mean(r.rows.map((x) => x.err)),
      tip: share(r.rows.filter((x) => x.maxbet).map((x) => x.hit)),
    })),
    tags: [
      { label: 'Maxbet zna nešto', sub: 'tip Forme', tone: 'warn', ...tagged((p) => p.guard) },
      { label: 'Ne igraju saigrači', sub: 'projekcija sa više minuta', tone: 'abs', ...tagged((p) => p.boost) },
      { label: 'Minute ↑', sub: 'igra više nego u sezoni', tone: 'up', ...tagged((p) => p.flags.some((f) => f.label === 'Minute ↑')) },
      { label: 'Oscilira', sub: 'nestalan igrač', tone: '', ...tagged((p) => p.flags.some((f) => f.label === 'Oscilira')) },
    ],
    kinds: [
      { label: 'Tip +', sub: 'preko granice', ...tagged((p) => p.chance.tip === '+') },
      { label: 'Tip −', sub: 'ispod granice', ...tagged((p) => p.chance.tip !== '+') },
      { label: 'Bekovi (G)', sub: '', ...tagged((p) => p.pos === 'G') },
      { label: 'Krila i centri (F, C)', sub: '', ...tagged((p) => p.pos !== 'G') },
    ],
    misses: tips
      .filter((r) => !r.hit)
      .sort((a, b) => b.err - a.err)
      .slice(0, MISSES)
      .map((r) => ({ ...r, reason: missReason(r) })),
    dnp: { n: dnp.length, flagged: dnp.filter((x) => x.flagged).length },
    sample: tips.length,
  }
}

// Zaključak ispod grafikona "Kad Forma kaže X%".
export function calibrationVerdict(summary) {
  if (summary.sample < MIN_SAMPLE) {
    return {
      tone: 'muted',
      text: `Premalo podataka: ${summary.sample} igrača sa Maxbet granicom. Za pouzdan zaključak treba bar ${MIN_SAMPLE}, a najbolje 100 i više. Svako kolo sa uvozom sa Maxbeta dodaje 50–80.`,
    }
  }
  const solid = summary.buckets.filter((b) => b.n >= BUCKET_MIN && b.promised !== null)
  const over = solid.filter((b) => b.pct < b.promised - 5)
  const under = solid.filter((b) => b.pct > b.promised + 5)
  if (!over.length && !under.length) {
    return { tone: 'good', text: 'Forma govori istinu: u svakoj grupi stvarno prođe otprilike koliko kaže (±5%).' }
  }
  const parts = []
  if (over.length) {
    parts.push(`je previše sigurna kod ${over.map((b) => b.label).join(', ')}: obećava ${over.map((b) => Math.round(b.promised) + '%').join(' / ')}, a prođe ${over.map((b) => b.pct + '%').join(' / ')}`)
  }
  if (under.length) {
    parts.push(`je previše oprezna kod ${under.map((b) => b.label).join(', ')}: prođe ${under.map((b) => b.pct + '%').join(' / ')}`)
  }
  return { tone: 'warn', text: `Forma ${parts.join('; ')}.` }
}
