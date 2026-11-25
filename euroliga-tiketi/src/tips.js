// Tipovi sa tiketa. Isto pravilo je u api/schedule.php (parseTip, lineVerdict).
//   +  −        poeni prema Maxbet granici (jedini vezani za Formu i uvoz sa Maxbeta)
//   <+ <−       poeni prema manjoj granici;  >+ >−  prema većoj granici
//   PS+ PS−     poeni + skokovi;  PA+ PA−  poeni + asistencije;  PAS+ PAS−  sva tri
// Granicu za manju / veću i PS / PA / PAS upisuje admin ručno.

export const TIP_GROUPS = [
  {
    label: 'Druga granica poena',
    options: [
      { code: '<+', name: 'manja plus' },
      { code: '<-', name: 'manja minus' },
      { code: '>+', name: 'veća plus' },
      { code: '>-', name: 'veća minus' },
    ],
  },
  {
    label: 'Kombinacije',
    options: [
      { code: 'PS+', name: 'poeni + skokovi' },
      { code: 'PS-', name: 'poeni + skokovi' },
      { code: 'PA+', name: 'poeni + asist.' },
      { code: 'PA-', name: 'poeni + asist.' },
      { code: 'PAS+', name: 'p + as. + sk.' },
      { code: 'PAS-', name: 'p + as. + sk.' },
    ],
  },
]

const STAT_NAMES = { ps: 'poeni + skokovi', pa: 'poeni + asistencije', pas: 'poeni + as. + sk.' }
// Kratko ime zbira uz broj: "PAS 33".
export const STAT_SHORT = { pts: 'poena', ps: 'PS', pa: 'PA', pas: 'PAS' }

// stat: pts | ps | pa | pas; alt: '<' | '>' | null; plain: obični + / −.
export function parseTip(text) {
  const m = /^\s*(PAS|PS|PA|<|>)?\s*([+\-−–])/iu.exec(text ?? '')
  if (!m) return { stat: 'pts', alt: null, under: false, plain: true, code: null }
  const kind = (m[1] ?? '').toUpperCase()
  const stat = ['PAS', 'PS', 'PA'].includes(kind) ? kind.toLowerCase() : 'pts'
  const alt = kind === '<' || kind === '>' ? kind : null
  const under = m[2] !== '+'
  return { stat, alt, under, plain: stat === 'pts' && !alt, code: `${kind}${under ? '-' : '+'}` }
}

// Za prikaz: "PAS−", "<+", "−"; prazan tip je "+".
export function tipSign(text) {
  const tip = parseTip(text)
  if (!tip.code) return (text ?? '').trim() || '+'
  return tip.code.replace('-', '−')
}

// Opis uz znak: "manja plus", "poeni + skokovi"; za obični + / − prazno.
export function tipName(text) {
  const tip = parseTip(text)
  if (tip.alt) return `${tip.alt === '<' ? 'manja' : 'veća'} ${tip.under ? 'minus' : 'plus'}`
  return STAT_NAMES[tip.stat] ?? ''
}

// Broj koji se poredi sa granicom: poeni ili zbir (null dok zapisnik nema skokove / asistencije).
export function tipValue(pick) {
  if (pick.points === null || pick.points === undefined) return null
  const { stat } = parseTip(pick.tip)
  const parts = { pts: [], ps: [pick.rebounds], pa: [pick.assists], pas: [pick.assists, pick.rebounds] }[stat]
  if (parts.some((v) => v === null || v === undefined)) return null
  return pick.points + parts.reduce((sum, v) => sum + v, 0)
}

// Isto kao na serveru: prvi poeni = poeni „+“ je prošao; nije igrao = prošao; inače poredi sa granicom.
export function lineVerdict(pick) {
  const tip = parseTip(pick.tip)
  if (pick.firstPoints && tip.stat === 'pts' && !tip.under) return true
  if (pick.didPlay === null) return null
  if (!pick.didPlay) return true
  const value = tipValue(pick)
  if (pick.line === null || value === null) return null
  return tip.under ? value < pick.line : value > pick.line
}
