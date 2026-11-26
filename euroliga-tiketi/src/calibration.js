// Kalibracija šanse, naučena iz stvarnih rezultata igrača sa Maxbet granicom (samo utakmice sa uvozom,
// jer su granice sa tiketa vaši izbori, uglavnom plusevi). Projekcija i dalje bira smjer tipa, a uči se:
//   prag:  Forma kaže "+" tek kad je projekcija bar toliko poena iznad granice (minus češće prolazi);
//   k:     koliko su procenti moje formule pouzdani; šansa se stisne prema 50% (k = 1 bez promjene).
// Šansa za plus = 0.5 + k · (Φ((projekcija − granica − prag) / oscilacija) − 0.5).

// Uči se tek od ovoliko igrača (utakmice sa uvozom, sa rezultatom).
export const CALIBRATION_MIN = 150
// Provjera na najnovijem kolu traži bar ovoliko igrača.
const TEST_MIN = 40
const MARGINS = Array.from({ length: 13 }, (_, i) => -2 + i * 0.5) // −2 … +4 poena
const FACTORS = Array.from({ length: 17 }, (_, i) => 0.2 + i * 0.05) // 0.2 … 1
const MAX_CHANCE = 0.8

// Normalna raspodjela (aproksimacija Abramowitz–Stegun).
export function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - q : q
}

// Šansa za plus po kalibraciji (ograničena na 20–80%).
export function calibratedOver(model, projection, line, sd) {
  const q = phi((projection - line - model.margin) / sd)
  return Math.min(MAX_CHANCE, Math.max(1 - MAX_CHANCE, 0.5 + model.k * (q - 0.5)))
}
export const isCalibrated = (model) => Boolean(model?.active && typeof model.margin === 'number' && typeof model.k === 'number')

// Za učenje: razlika projekcije i granice i oscilacija igrača.
export const features = (player, line) => ({ d: player.proj.pts.value - line, sd: player.chance.sd })

// Kako tip prolazi i koliko su procenti tačni (Brier: manje je bolje) za dato pravilo šanse.
function score(rows, overOf) {
  let hits = 0
  let brier = 0
  let plus = 0
  for (const row of rows) {
    const over = overOf(row)
    if (over >= 0.5) plus++
    if (over >= 0.5 === row.y) hits++
    brier += (over - (row.y ? 1 : 0)) ** 2
  }
  const n = rows.length
  return { n, hit: n ? Math.round((100 * hits) / n) : null, brier: n ? brier / n : null, plus }
}

// Prag: koji najviše pogađa tipova (pri istom rezultatu bliži nuli); k: koji daje najtačnije procente.
export function fitCalibration(rows) {
  const at = (margin) => rows.filter((r) => r.x.d > margin === r.y).length
  let margin = 0
  for (const m of MARGINS) {
    if (at(m) > at(margin) || (at(m) === at(margin) && Math.abs(m) < Math.abs(margin))) margin = m
  }
  let k = 1
  let best = Infinity
  for (const f of FACTORS) {
    const b = score(rows, (r) => calibratedOver({ margin, k: f }, r.x.d, 0, r.x.sd)).brier
    if (b < best) [best, k] = [b, f]
  }
  return { margin, k: Number(k.toFixed(2)) }
}

// rows: [{round, x: {d, sd}, y (prošao plus), oldOver}] iz utakmica sa uvozom. Nauči na starijim kolima,
// provjeri na najnovijem (koje nije vidjela) prema staroj formuli i pravilu "uvijek minus", pa nauči na svima.
export function buildCalibration(rows) {
  if (rows.length < CALIBRATION_MIN) return { n: rows.length, min: CALIBRATION_MIN, active: false }
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b)
  const testRound = rounds.at(-1)
  const train = rows.filter((r) => r.round !== testRound)
  const test = rows.filter((r) => r.round === testRound)
  const overWith = (model) => (r) => calibratedOver(model, r.x.d, 0, r.x.sd)

  let check = null
  if (train.length >= CALIBRATION_MIN / 2 && test.length >= TEST_MIN) {
    const trial = fitCalibration(train)
    check = {
      round: testRound,
      old: score(test, (r) => r.oldOver),
      new: score(test, overWith(trial)),
      minus: score(test, () => 0.45),
    }
  }
  const model = fitCalibration(rows)
  // Uključuje se kad na kolu koje nije vidjela pogađa bar koliko stara formula, i procenti nisu lošiji.
  const active = check !== null && check.new.hit >= check.old.hit && check.new.brier <= check.old.brier
  return {
    ...model,
    n: rows.length,
    min: CALIBRATION_MIN,
    rounds: rounds.length,
    base: Math.round((100 * rows.filter((r) => r.y).length) / rows.length),
    check,
    all: { old: score(rows, (r) => r.oldOver), new: score(rows, overWith(model)) },
    active,
  }
}
