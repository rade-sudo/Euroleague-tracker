// Tiketi uživo: stanje igrača sa tiketa prema granici dok utakmica traje.
// Plus je prošao čim pređe granicu; minus je pao čim pređe granicu, a prolazi tek na kraju.
// Nije ušao do kraja = prošao (isto pravilo kao ocjena). Konačnu ocjenu daje zapisnik poslije utakmice.
import { parseTip, STAT_SHORT } from './tips.js'

// Plus kome u 4. četvrtini fali ovoliko, ili minus kome fali ovoliko do pada, je "opasno".
const RISK_PLUS = 6
const RISK_MINUS = 2

export function quarterLabel(game) {
  if (!game) return ''
  if (game.finished) return 'kraj'
  if (!game.live) return ''
  const q = Number(game.quarter)
  return `${q > 4 ? 'prod.' : `${q}. č.`}${game.clock ? ` · ${game.clock}` : ''}`
}

export function gameStateLabel(game) {
  if (game.finished) return 'Kraj'
  if (!game.live) return 'Uskoro'
  const q = Number(game.quarter)
  return `${q > 4 ? 'Produžetak' : `${q}. četvrtina`}${game.clock ? ` · ${game.clock}` : ''}`
}

// Koliki dio utakmice je odigran (0–1), iz četvrtine i preostalog vremena; produžetak = cijela.
function playedShare(game) {
  const q = Number(game.quarter)
  if (!q) return null
  if (q > 4) return 1
  const [m, s] = (game.clock || '10:00').split(':').map(Number)
  return Math.min(1, ((q - 1) * 10 + (10 - (m + (s || 0) / 60))) / 40)
}

// Tempo: koliko bi dao ako nastavi ovako. Očekivane minute = pola po dosadašnjem tempu minuta,
// pola po minutama u sezoni (a ne manje od već odigranih).
function tempoOf(value, stats, game) {
  const share = playedShare(game)
  if (game.finished || !share || stats.min < 4) return null
  const byPace = Math.min(40, stats.min / share)
  const expected = Math.max(stats.min, stats.seasonMin ? 0.5 * byPace + 0.5 * stats.seasonMin : byPace)
  return Math.round((value / stats.min) * expected)
}

// status: ok | bad | live | risk | wait. value: poeni ili zbir; need: tekst koliko fali.
export function liveState(pick, stats, game) {
  if (!stats || !game || !(game.live || game.finished)) return null
  const tip = parseTip(pick.tip)
  const keys = { pts: ['pts'], ps: ['pts', 'reb'], pa: ['pts', 'ast'], pas: ['pts', 'ast', 'reb'] }[tip.stat]
  const value = keys.reduce((sum, key) => sum + stats[key], 0)
  const parts = tip.stat === 'pts' ? '' : [`${stats.pts} p`, keys.includes('ast') && `${stats.ast} as`, keys.includes('reb') && `${stats.reb} sk`].filter(Boolean).join(' · ')
  const base = { value, parts, stat: tip.stat === 'pts' ? null : STAT_SHORT[tip.stat], line: pick.line, quarter: quarterLabel(game), stats }

  if (stats.min === 0 && !stats.onCourt) {
    return game.finished
      ? { ...base, status: 'ok', label: 'Nije igrao', note: 'računa se kao prošao' }
      : { ...base, status: 'wait', label: 'Nije ušao', note: 'još može ući' }
  }
  const tempo = tempoOf(value, stats, game)
  if (pick.line === null) return { ...base, tempo, status: game.finished ? 'wait' : 'live', label: game.finished ? 'Kraj' : 'U igri', note: 'čeka granicu' }

  const over = value > pick.line
  const missing = Math.floor(pick.line) + 1 - value
  if (!tip.under) {
    if (over) return { ...base, status: 'ok', label: '✓ Prošao', note: game.finished ? '' : 'prešao granicu' }
    if (game.finished) return { ...base, status: 'bad', label: '✗ Pao', note: '' }
    const risk = Number(game.quarter) >= 4 && missing >= RISK_PLUS
    return { ...base, tempo, status: risk ? 'risk' : 'live', label: risk ? 'Opasno' : 'U igri', need: `treba još ${missing}` }
  }
  if (over) return { ...base, status: 'bad', label: '✗ Pao', note: game.finished ? '' : 'prešao granicu' }
  if (game.finished) return { ...base, status: 'ok', label: '✓ Prošao', note: '' }
  const risk = missing <= RISK_MINUS
  return { ...base, tempo, status: risk ? 'risk' : 'live', label: risk ? 'Opasno' : 'U igri', need: `još ${missing} i pada` }
}
