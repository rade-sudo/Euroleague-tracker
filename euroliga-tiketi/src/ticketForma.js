// Forma na tiketu bez prikaza: oznaka igrača koji ne igra i oznaka na redu tiketa.
import { fix1, formaForTip, statProjection } from './forma.js'
import { parseTip, STAT_SHORT } from './tips.js'

// Oznaka igrača koji ne igra ili je upitan ("Ne igra · BasketNews").
export const absenceLabel = (p) => p.flags.find((f) => f.tone === 'down' || f.label.startsWith('Upitan'))?.label ?? 'Upitan'

// Oznaka Forme na redu tiketa: slaže se / kaže drugo / čeka granicu / ne igra. null kad nema šta reći.
export function formaChip(pick, player) {
  if (!player) return null
  if (player.out) return { tone: 'danger', text: `${absenceLabel(player)} · zamijeni ga do roka` }
  const tip = parseTip(pick.tip)
  const line = pick.line ?? (tip.plain && player.lineSrc === 'maxbet' ? player.line : null)
  if (line === null) {
    const proj = tip.stat === 'pts' ? `${fix1(player.proj.pts.value)} poena` : `${STAT_SHORT[tip.stat]} ${fix1(statProjection(player, tip.stat))}`
    return { tone: 'wait', text: `Čeka granicu${tip.plain ? '' : ' (upisuje admin)'} · Forma ${proj}` }
  }
  // Obični tip uz istu Maxbet granicu kao u Formi: ista šansa kao u Formi (sa "Maxbet zna nešto").
  const c = tip.plain && line === player.line && player.lineSrc === 'maxbet' ? player.chance : formaForTip(player, tip.stat, line)
  const mine = tip.under ? '−' : '+'
  const prefix = tip.plain ? 'Forma' : `Forma za ${line}`
  if (c.tip === mine) return { tone: 'agree', tip: c.tip, pct: c.pct, text: tip.plain ? 'Forma se slaže' : prefix }
  return { tone: 'against', tip: c.tip, pct: c.pct, text: `${prefix} kaže ${c.tip === '+' ? 'plus' : 'minus'}` }
}
