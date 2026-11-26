// Statistika drugara: ko kako pogađa i u čemu je ko jak. Broje se ocijenjeni igrači ("nije igrao" = prošao).
import { parseTip } from './tips.js'

// Grupa sa manje igrača se prikazuje bez procenta ("2/4").
export const MIN_GROUP = 5
// Jaka / slaba strana i "najjači u" traže bar ovoliko igrača.
const MIN_STRONG = 8
const TREND_ROUNDS = 3
const RECENT_ROUNDS = 4

const kindOf = (pick) => {
  const tip = parseTip(pick.tip)
  if (tip.stat !== 'pts') return 'combo'
  if (tip.alt) return 'alt'
  return tip.under ? 'minus' : 'plus'
}
const bandOf = (pick) => {
  const tip = parseTip(pick.tip)
  if (tip.stat !== 'pts' || pick.line === null) return null
  return pick.line <= 8.5 ? 'low' : pick.line <= 14.5 ? 'mid' : 'high'
}
const venueOf = (pick) => (pick.home === null ? null : pick.home ? 'home' : 'away')

// Dimenzije: ključ grupe, naziv u tabeli i naziv za "najjači u".
export const DIMENSIONS = [
  {
    id: 'kind',
    title: 'Po tipu',
    of: kindOf,
    groups: [
      { key: 'plus', label: 'Plus', short: 'plusevi' },
      { key: 'minus', label: 'Minus', short: 'minusi' },
      { key: 'alt', label: 'Manja / veća', short: 'manja / veća granica' },
      { key: 'combo', label: 'PS / PA / PAS', short: 'PS / PA / PAS' },
    ],
  },
  {
    id: 'pos',
    title: 'Po poziciji',
    of: (pick) => pick.pos,
    groups: [
      { key: 'G', label: 'Bekovi', short: 'bekovi' },
      { key: 'F', label: 'Krila', short: 'krila' },
      { key: 'C', label: 'Centri', short: 'centri' },
    ],
  },
  {
    id: 'band',
    title: 'Po granici',
    of: bandOf,
    groups: [
      { key: 'low', label: 'do 8.5', short: 'granice do 8.5' },
      { key: 'mid', label: '9.5 – 14.5', short: 'granice 9.5 – 14.5' },
      { key: 'high', label: '15.5 i više', short: 'granice 15.5+' },
    ],
  },
  {
    id: 'venue',
    title: 'Kod kuće / u gostima',
    of: venueOf,
    groups: [
      { key: 'home', label: 'Kod kuće', short: 'kod kuće' },
      { key: 'away', label: 'U gostima', short: 'u gostima' },
    ],
  },
]

// Za jaku i slabu stranu: tip (plus / minus) × pozicija, i tip × granica.
const COMBOS = [
  { a: 'kind', b: 'pos', label: (x, y) => `${CAP[x]} na ${POS_ON[y]}` },
  { a: 'kind', b: 'band', label: (x, y) => `${CAP[x]} na granicama ${BAND_ON[y]}` },
]
const CAP = { plus: 'Plusevi', minus: 'Minusi', alt: 'Manja / veća', combo: 'PS / PA / PAS' }
const POS_ON = { G: 'bekovima', F: 'krilima', C: 'centrima' }
const BAND_ON = { low: 'do 8.5', mid: '9.5 – 14.5', high: '15.5+' }

export const share = (list) => {
  const hits = list.filter((p) => p.hit).length
  return { n: list.length, hits, pct: list.length ? Math.round((hits / list.length) * 100) : null }
}
const dimension = (id) => DIMENSIONS.find((d) => d.id === id)

// Najduži niz prolaza zaredom (po kolu, pa redu na tiketu) i od kojeg do kojeg kola.
function longestStreak(picks) {
  let best = { length: 0, from: null, to: null }
  let run = { length: 0, from: null }
  for (const pick of picks) {
    if (pick.hit) {
      run = { length: run.length + 1, from: run.length ? run.from : pick.round }
      if (run.length > best.length) best = { length: run.length, from: run.from, to: pick.round }
    } else {
      run = { length: 0, from: null }
    }
  }
  return best
}

// Uspješnost kroz sezonu: za svako kolo zadnja 3 kola zajedno (da ne skače).
function trend(picks, rounds) {
  return rounds.map((round) => {
    const window = picks.filter((p) => p.round > round - TREND_ROUNDS && p.round <= round)
    return { round, pct: share(window).pct }
  })
}

export function friendStats(stats) {
  const picks = stats.picks
  const rounds = [...new Set(picks.map((p) => p.round))].sort((a, b) => a - b)
  const team = share(picks)
  const teamGroup = (dim, key) => share(picks.filter((p) => dimension(dim).of(p) === key))
  const teamTrend = trend(picks, rounds)

  const friends = stats.friends.map((friend) => {
    const mine = picks.filter((p) => p.friendId === friend.id)
    const total = share(mine)
    const myRounds = [...new Set(mine.map((p) => p.round))].sort((a, b) => a - b)

    const splits = DIMENSIONS.map((dim) => ({
      ...dim,
      rows: dim.groups.map((g) => ({ ...g, ...share(mine.filter((p) => dim.of(p) === g.key)), team: teamGroup(dim.id, g.key) })),
    }))

    // Najjači u: najbolja pojedinačna grupa sa dovoljno igrača.
    const strongest = splits
      .flatMap((dim) => dim.rows.filter((r) => r.n >= MIN_STRONG).map((r) => ({ ...r, dim: dim.id })))
      .sort((x, y) => y.pct - x.pct)[0]

    // Jaka i slaba strana: kombinacija najviše iznad / ispod ekipe.
    const combos = COMBOS.flatMap((c) =>
      dimension(c.a).groups.flatMap((ga) =>
        dimension(c.b).groups.map((gb) => {
          const inGroup = (p) => dimension(c.a).of(p) === ga.key && dimension(c.b).of(p) === gb.key
          const own = share(mine.filter(inGroup))
          const all = share(picks.filter(inGroup))
          return { label: c.label(ga.key, gb.key), ...own, team: all.pct, diff: own.pct === null || all.pct === null ? 0 : own.pct - all.pct }
        }),
      ),
    ).filter((c) => c.n >= MIN_STRONG)
    const strong = [...combos].sort((x, y) => y.diff - x.diff)[0]
    const weak = [...combos].sort((x, y) => x.diff - y.diff)[0]

    const recentRounds = myRounds.slice(-RECENT_ROUNDS)
    const recent = share(mine.filter((p) => recentRounds.includes(p.round)))
    const formaPicks = mine.filter((p) => p.formaTip && parseTip(p.tip).plain)
    const agrees = (p) => (parseTip(p.tip).under ? '-' : '+') === p.formaTip

    return {
      ...friend,
      total,
      last5: myRounds.slice(-5).map((round) => ({ round, hits: mine.filter((p) => p.round === round && p.hit).length, n: mine.filter((p) => p.round === round).length })),
      strongest: strongest ? `${strongest.short} ${strongest.pct}%` : null,
      splits,
      strong: strong && strong.diff > 0 ? strong : null,
      weak: weak && weak.diff < 0 ? weak : null,
      recent: { ...recent, rounds: recentRounds.length },
      streak: longestStreak(mine),
      withForma: share(formaPicks.filter(agrees)),
      againstForma: share(formaPicks.filter((p) => !agrees(p))),
      trend: trend(mine, rounds),
      rounds: myRounds.length,
    }
  })

  // Poredak: po procentu; ko još nema ocijenjenih igrača ide na kraj.
  friends.sort((a, b) => (b.total.pct ?? -1) - (a.total.pct ?? -1) || b.total.n - a.total.n)
  return { team, teamTrend, friends, rounds }
}
