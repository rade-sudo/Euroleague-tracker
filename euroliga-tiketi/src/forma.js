// Forma igrača: projekcija, procjena granice i šansa za tiket.
// Ista formula je opisana na dnu stranice Forma ("Kako se računa projekcija").

// Novija utakmica nosi više: zadnja 5, pa 4, 3, 2, 1.
const WEIGHTS = [5, 4, 3, 2, 1]
const W_FORM = 0.45
const W_SEASON = 0.35
const W_VS = 0.2
// Istorija protiv protivnika nosi punu težinu tek od 4 utakmice.
const VS_FULL_GAMES = 4
const HOME_FACTOR = 1.03
const AWAY_FACTOR = 0.97
const MIN_SD = 3
// Odsutni saigrači: 3/4 njihovih minuta ide igračima iste pozicije, po minutama u sezoni.
const SAME_POS_SHARE = 0.75
const MAX_MINUTES = 34
// Stvarni prosjek "bez njih" ulazi u projekciju tek od 3 takve utakmice.
const WITHOUT_MIN_GAMES = 3
// Nove minute nose nesigurnost: oscilacija +15%.
const BOOST_SD = 1.15
// "Maxbet zna nešto": Maxbet je granicu podigao iznad uobičajene (naša procjena granice, blizu njihovog računa)
// za bar 3 poena, ili 20% kod većih granica, a odsutni saigrači to ne objašnjavaju. Niža granica se ne označava.
const GUARD_GAP = 3
const GUARD_SHARE = 0.2
// Nijedna šansa preko 80%: formula ne zna sve.
const MAX_CHANCE = 0.8
const RATE_UNITS = { pts: 'poena', ast: 'asistencija', reb: 'skokova' }
const surname = (name) => name.split(' ').slice(-1)[0]

// Sigurno ne igra: Out na BasketNewsu, ili admin rekao "Ne igra". Samo takvi oslobađaju minute saigračima;
// "nema ga na Maxbetu", "nije igrao zadnju" i upitni su samo oznaka na njemu.
export const sureOut = (absence) => absence?.status === 'out' && (absence.source === 'basketnews' || absence.source === 'admin')

// Koliko minuta igrač dobija jer saigrači iste pozicije sigurno ne igraju.
// null ako nema odsutnih na njegovoj poziciji, ili ni sam ne igra.
export function absenceBoost(player, teammates) {
  if ((player.absence?.weight ?? 0) >= 0.5 || !(player.season.min > 0)) return null
  const receives = (t) => !((t.absence?.weight ?? 0) >= 0.5) && t.season.min > 0
  let minutes = 0
  const names = []
  for (const absent of teammates) {
    if (absent.id === player.id || !sureOut(absent.absence) || !(absent.absence.min > 0) || absent.pos !== player.pos) continue
    const group = teammates.filter((t) => t.pos === absent.pos && receives(t))
    const total = group.reduce((sum, t) => sum + t.season.min, 0)
    if (!total) continue
    minutes += (SAME_POS_SHARE * absent.absence.min * player.season.min) / total
    names.push(surname(absent.name))
  }
  minutes = Math.min(minutes, Math.max(0, MAX_MINUTES - player.season.min))
  return minutes >= 0.5 ? { minutes, names } : null
}

// Kolone reda igrača na širem ekranu (zaglavlje tima i red moraju biti iste).
export const FORMA_GRID = 'min-[861px]:grid-cols-[minmax(170px,1.35fr)_1.25fr_1fr_1fr_96px_132px]'
export const pctTone = (value) => (value >= 65 ? 'text-neon' : value >= 55 ? 'text-gold' : 'text-rose-400')

export const fix1 =(value) => (Math.round(value * 10) / 10).toFixed(1)

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

// Projekcija za poene, asistencije ili skokove, sa koracima za prikaz.
export function project(player, key, defense, boost = null) {
  let played = player.last10
    .slice(0, 5)
    .map((game, i) => ({ game, w: WEIGHTS[i] }))
    .filter((x) => !x.game.dnp)
  // Nije igrao zadnjih 5: uzimaju se zadnje utakmice u kojima jeste.
  if (!played.length) {
    played = player.last10
      .filter((game) => !game.dnp)
      .slice(0, 5)
      .map((game, i) => ({ game, w: WEIGHTS[i] }))
  }
  const seasonAvg = player.season[key]
  const totalW = played.reduce((sum, x) => sum + x.w, 0)
  const form = played.length ? played.reduce((sum, x) => sum + x.game[key] * x.w, 0) / totalW : seasonAvg
  const min5 = played.length ? average(played.map((x) => x.game.min)) : player.season.min

  const n = player.h2h.length
  const vs = n ? average(player.h2h.map((game) => game[key])) : 0
  const wVs = (W_VS * Math.min(n, VS_FULL_GAMES)) / VS_FULL_GAMES
  const base = (W_FORM * form + W_SEASON * seasonAvg + wVs * vs) / (W_FORM + W_SEASON + wVs)

  const minF = player.season.min > 0 ? Math.max(0.9, Math.min(1.1, 1 + 0.5 * (min5 / player.season.min - 1))) : 1
  const haF = player.home ? HOME_FACTOR : AWAY_FACTOR
  const def = defense[player.opp]?.[player.pos] ?? 1
  // Odbrana najviše utiče na poene; na asistencije i skokove upola.
  const defF = key === 'pts' ? def : 1 + (def - 1) * 0.5
  const afterMin = base * minF
  const afterHa = afterMin * haF
  const afterDef = afterHa * defF
  const steps = [
    { label: 'Baza (forma, sezona, protiv njih)', value: base },
    { label: `Minute (${fix1(min5)} zadnjih 5 / ${fix1(player.season.min)} sezona)`, delta: afterMin - base },
    { label: player.home ? 'Domaćin' : 'Gost', delta: afterHa - afterMin },
    { label: `Odbrana ${player.opp} prema poziciji ${player.pos}`, delta: afterDef - afterHa },
  ]

  // Odsutni saigrači: nove minute × njegov učinak po minuti, pa (od 3 utakmice) i stvarni prosjek bez njih.
  let value = afterDef
  if (boost) {
    const rate = player.season[key] / player.season.min
    const afterBoost = afterDef + boost.minutes * rate
    const who = boost.names.join(' i ')
    steps.push({
      label: `${boost.names.length > 1 ? 'Ne igraju' : 'Ne igra'} ${who}: +${fix1(boost.minutes)} min × ${rate.toFixed(2)} ${RATE_UNITS[key]} po minuti`,
      delta: afterBoost - afterDef,
      absence: true,
    })
    value = afterBoost
    const without = player.without
    if (without && without.n >= WITHOUT_MIN_GAMES) {
      value = 0.5 * afterBoost + 0.5 * without[key]
      const games = without.n % 10 >= 2 && without.n % 10 <= 4 && (without.n % 100 < 12 || without.n % 100 > 14) ? 'utakmice' : 'utakmica'
      steps.push({ label: `Bez njih (${without.n} ${games}): ${fix1(without[key])} ${RATE_UNITS[key]}`, delta: value - afterBoost, absence: true })
    }
  }

  return { value, form, seasonAvg, vs, n, min5, steps }
}

// Okvirna granica dok admin ne upiše Maxbet: 60% sezona + 40% forma, zaokruženo na .5.
// lineModel: Maxbetovo pravilo naučeno iz uvezenih granica (api/forma.php, formaLineModel), kad ih ima dovoljno:
// a + b·sezona + c·forma, zaokruženo na najbližu .5 granicu. Inače stara procjena.
export function estimateLine(player, form, lineModel = null) {
  if (lineModel?.active) return Math.max(0.5, Math.round(lineModel.a + lineModel.b * player.season.pts + lineModel.c * form - 0.5) + 0.5)
  return Math.floor(0.6 * player.season.pts + 0.4 * form) + 0.5
}

// Koliko igrač oscilira u poenima (zadnjih 10 u kojima je igrao).
function pointsSd(player) {
  const values = player.last10.filter((game) => !game.dnp).map((game) => game.pts)
  if (values.length < 3) return Math.max(MIN_SD, player.season.pts * 0.35)
  const mean = average(values)
  return Math.max(MIN_SD, Math.sqrt(average(values.map((v) => (v - mean) ** 2))))
}

// Normalna raspodjela (aproksimacija Abramowitz–Stegun).
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - q : q
}

// Šansa da prođe tip: "+" ako je projekcija iznad granice, inače "−".
// shrink ("Maxbet zna nešto"): šansa se prepolovi prema 50%. Nikad preko 80%.
export function chance(line, projection, sd, shrink = false) {
  let over = 1 - phi((line - projection) / sd)
  if (shrink) over = 0.5 + (over - 0.5) / 2
  over = Math.min(MAX_CHANCE, Math.max(1 - MAX_CHANCE, over))
  const tip = over >= 0.5 ? '+' : '−'
  return { over, tip, pct: Math.round((tip === '+' ? over : 1 - over) * 100), sd }
}

export const hitsOver = (games, line) => games.filter((game) => !game.dnp && game.pts > line).length
export const hitsUnder = (games, line) => games.filter((game) => !game.dnp && game.pts < line).length
export const playedCount = (games) => games.filter((game) => !game.dnp).length

// Igrač sa projekcijama, granicom (Maxbet ili procjena), šansom i oznakama.
// Oznaka igrača koji ni sam ne igra (ili je upitan) i odakle se zna.
const ABSENCE_LABELS = { out: 'Ne igra', doubtful: 'Vjerovatno ne igra', uncertain: 'Upitan', maybe: 'Upitan' }
export const ABSENCE_SOURCES = {
  basketnews: 'BasketNews',
  maxbet: 'nema ga na Maxbetu',
  dnp: 'nije igrao zadnju',
  admin: 'admin',
}
function absenceFlag(absence) {
  if (!absence) return null
  const source = ABSENCE_SOURCES[absence.source]
  if (absence.weight >= 0.75) {
    // Bez službene potvrde (Maxbet, DNP) piše "vjerovatno".
    const label = absence.source === 'maxbet' || absence.source === 'dnp' ? 'Vjerovatno ne igra' : ABSENCE_LABELS[absence.status]
    return { tone: 'down', label: `${label} · ${source}` }
  }
  if (absence.weight > 0) return { tone: 'warn', label: `Upitan · ${source}` }
  return absence.status === 'expected' ? { tone: '', label: 'Bio povrijeđen · igra' } : null
}

// teammates: svi igrači njegovog tima u kolu (za odsutne saigrače).
export function enrichPlayer(player, defense, doubleTeams, teammates = [], lineModel = null) {
  const boost = absenceBoost(player, teammates)
  const proj = {
    pts: project(player, 'pts', defense, boost),
    ast: project(player, 'ast', defense, boost),
    reb: project(player, 'reb', defense, boost),
  }
  const est = estimateLine(player, proj.pts.form, lineModel)
  // offer === false: Maxbet je uvezen za utakmicu, a igrača nema u ponudi.
  // Tada se granica i šansa ne prikazuju (računaju se iz procjene samo za ekran uvoza).
  const offered = player.offer !== false
  const line = player.line ?? est
  const sd = pointsSd(player) * (boost ? BOOST_SD : 1)
  // Maxbet granica daleko od projekcije: kladionica zna nešto što mi ne znamo.
  const gap = player.line !== null ? player.line - est : 0
  const guard = !boost && gap >= Math.max(GUARD_GAP, GUARD_SHARE * est)
  const last5 = player.last10.slice(0, 5)
  const dnp5 = last5.filter((game) => game.dnp).length
  const def = defense[player.opp]?.[player.pos] ?? 1

  const flags = []
  const own = absenceFlag(player.absence)
  if (own) flags.push(own)
  if (boost) {
    flags.push({ tone: 'abs', label: `${boost.names.length > 1 ? 'Ne igraju' : 'Ne igra'}: ${boost.names.join(', ')}` })
    flags.push({ tone: 'up', label: `+${Math.round(boost.minutes)} min` })
  }
  if (guard) {
    // Kratko, da stane u kolonu igrača; puni opis je u title i u detalju igrača.
    flags.push({
      tone: 'warn',
      label: `Maxbet zna nešto · +${fix1(gap)}`,
      title: `Maxbet granica ${player.line} je ${fix1(gap)} poena iznad uobičajene (naša procjena ${est})`,
    })
  }
  if (proj.pts.min5 >= player.season.min + 3) flags.push({ tone: 'up', label: 'Minute ↑' })
  if (proj.pts.min5 <= player.season.min - 3) flags.push({ tone: 'down', label: 'Minute ↓' })
  if (dnp5) flags.push({ tone: 'warn', label: `Nije igrao ${dnp5}/${last5.length}` })
  if (doubleTeams.has(player.team)) flags.push({ tone: 'warn', label: 'Dvostruko kolo' })
  if (sd >= player.season.pts * 0.42 && player.season.pts >= 5) flags.push({ tone: '', label: 'Oscilira' })
  if (def >= 1.05) flags.push({ tone: 'up', label: `${player.opp} slab na ${player.pos}` })
  if (def <= 0.93) flags.push({ tone: 'down', label: `${player.opp} jak na ${player.pos}` })

  return {
    ...player,
    proj,
    est,
    line,
    offered,
    lineSrc: player.line !== null ? 'maxbet' : offered ? 'procjena' : 'nema',
    chance: chance(line, proj.pts.value, sd, guard),
    boost,
    guard,
    // Ne igra ili je upitan: ne nudi se u "Najbolje šanse kola".
    out: (player.absence?.weight ?? 0) >= 0.5,
    formPct: player.season.pts > 0 ? proj.pts.form / player.season.pts - 1 : 0,
    flags,
  }
}

// Šansa za drugu granicu (npr. sa Maxbeta, prije nego što se sačuva).
export const chanceFor = (player, line) => chance(line, player.proj.pts.value, player.chance.sd)

// Dugme za trake sa oznakama: na sportsbook.maxbet.ba skroluje listu Igrači do kraja,
// pokupi granice poena za Euroligu i otvori Formu sa pregledom uvoza (podaci idu u #maxbet=…).
// Čita samo ono što je na ekranu; Maxbet lista je u shadow DOM-u elementa ss-root.
export function maxbetBookmarklet(origin) {
  const code = `(async()=>{
const R=document.querySelector('ss-root'),root=(R&&R.shadowRoot)||document,vp=root.querySelector('cdk-virtual-scroll-viewport');
if(!vp){alert('Granice → Forma: otvori sportsbook.maxbet.ba → Igrači (direktno, ne kroz maxbet.ba), izaberi košarku i klikni ponovo.');return}
const box=document.createElement('div');box.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;background:#12141a;color:#fff;font:600 14px system-ui,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);border:1px solid #ff6a13;max-width:320px;line-height:1.4';document.body.appendChild(box);
const rows=new Map(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const read=()=>{root.querySelectorAll('sb-match-player-prop-item-atomic').forEach(el=>{const q=s=>el.querySelector(s);
const lg=(q('[data-cy-item="match-league-name"]')||{}).textContent||'';if(!/euroleague|evroliga|euroliga/i.test(lg))return;
const n=q('[data-cy-item="player-name"] [title]'),t=q('[data-cy-item="team-name"] [title]'),d=q('[data-cy-item="date-time"]'),m=q('sb-market-item-atomic[data-cy-id="1143"] [data-cy-item="market-specifier-value"]'),l=m?m.textContent.trim():'';
if(!n||!l)return;rows.set(el.getAttribute('data-scroll-id')||n.title+'|'+(t?t.title:''),{n:n.title.trim(),t:t?t.title.trim():'',d:d?d.textContent.trim():'',l})})};
vp.scrollTop=0;await wait(500);
for(let i=0;i<400;i++){read();box.textContent='Čitam granice sa Maxbeta… '+rows.size;if(vp.scrollTop+vp.clientHeight>=vp.scrollHeight-4)break;vp.scrollTop+=Math.max(200,vp.clientHeight*.7);await wait(350)}
await wait(400);read();const list=[...rows.values()];box.textContent='';
const p=document.createElement('div');p.textContent=list.length?'Pročitano '+list.length+' igrača sa granicom poena.':'Nisam našao granice poena za Euroligu. Otvori Igrači i izaberi košarku.';box.appendChild(p);
const bar=document.createElement('div');bar.style.cssText='display:flex;gap:8px;margin-top:10px';box.appendChild(bar);
if(list.length){const a=document.createElement('a');a.href=${JSON.stringify(origin)}+'/forma#maxbet='+encodeURIComponent(JSON.stringify(list));a.target='_blank';a.rel='noopener';a.textContent='Otvori u Formi ›';a.style.cssText='background:#ff6a13;color:#0a0b0f;padding:8px 12px;border-radius:8px;text-decoration:none;font-weight:800';a.onclick=()=>setTimeout(()=>box.remove(),300);bar.appendChild(a)}
const x=document.createElement('button');x.textContent='Zatvori';x.style.cssText='background:none;color:#a1a1aa;border:1px solid #3f3f46;padding:8px 12px;border-radius:8px;cursor:pointer;font:inherit';x.onclick=()=>box.remove();bar.appendChild(x)
})()`
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ''))}`
}

// Redovi iz #maxbet=… (podaci sa Maxbeta); null ako ih nema ili nisu ispravni.
export function readMaxbetHash(hash) {
  if (!hash.startsWith('#maxbet=')) return null
  try {
    const rows = JSON.parse(decodeURIComponent(hash.slice('#maxbet='.length)))
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row.n === 'string' && typeof row.l === 'string') : null
  } catch {
    return null
  }
}

const BEST_COUNT = 5

// "Najbolje šanse kola": samo utakmice koje još nisu počele (za odigrano kolo sve), bez igrača koji nisu
// u ponudi Maxbeta, ne igraju ili su upitni, nisu igrali zadnju utakmicu tima, ni kad "Maxbet zna nešto".
// Isti izbor koristi i Tačnost Forme.
export function bestPicks(players, games, gameOfTeam, now) {
  const upcoming = new Set(games.filter((g) => !g.played && new Date(g.startsAt).getTime() > now).map((g) => g.id))
  return (upcoming.size ? players.filter((p) => upcoming.has(gameOfTeam.get(p.team)?.id)) : players)
    .filter((p) => p.offered && !p.out && !p.guard && p.last10[0] && !p.last10[0].dnp)
    .sort((a, b) => b.chance.pct - a.chance.pct)
    .slice(0, BEST_COUNT)
}

// Svi igrači kola sa projekcijom: saigrači po timu (odsutni) i dvostruko kolo, kao na stranici Forma.
export function enrichRound(data) {
  const doubleTeams = new Set(data.double)
  const byTeam = new Map()
  for (const player of data.players) byTeam.set(player.team, [...(byTeam.get(player.team) ?? []), player])
  return data.players.map((player) => enrichPlayer(player, data.defense, doubleTeams, byTeam.get(player.team), data.lineModel))
}

// Tipovi PS / PA / PAS: projekcija zbira i koliko zbir oscilira (zadnjih 10 u kojima je igrao).
const STAT_KEYS = { pts: ['pts'], ps: ['pts', 'reb'], pa: ['pts', 'ast'], pas: ['pts', 'ast', 'reb'] }
export const statProjection = (player, stat) => STAT_KEYS[stat].reduce((sum, key) => sum + player.proj[key].value, 0)

function statSd(player, stat) {
  const values = player.last10.filter((game) => !game.dnp).map((game) => STAT_KEYS[stat].reduce((sum, key) => sum + game[key], 0))
  const base =
    values.length < 3
      ? Math.max(MIN_SD, statProjection(player, stat) * 0.35)
      : Math.max(MIN_SD, Math.sqrt(average(values.map((v) => (v - average(values)) ** 2))))
  return base * (player.boost ? BOOST_SD : 1)
}

// Šansa po Formi za tip sa tiketa: poeni (i manja / veća granica) ili zbir, prema datoj granici.
export function formaForTip(player, stat, line) {
  if (stat === 'pts') return chance(line, player.proj.pts.value, player.chance.sd)
  return chance(line, statProjection(player, stat), statSd(player, stat))
}
