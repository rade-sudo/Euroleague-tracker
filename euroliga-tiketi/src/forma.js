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

// Kolone reda igrača na širem ekranu (zaglavlje tima i red moraju biti iste).
export const FORMA_GRID = 'min-[861px]:grid-cols-[minmax(170px,1.35fr)_1.25fr_1fr_1fr_96px_132px]'
export const pctTone = (value) => (value >= 65 ? 'text-neon' : value >= 55 ? 'text-gold' : 'text-rose-400')

export const fix1 =(value) => (Math.round(value * 10) / 10).toFixed(1)

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

// Projekcija za poene, asistencije ili skokove, sa koracima za prikaz.
export function project(player, key, defense) {
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
  const value = afterHa * defF

  return {
    value,
    form,
    seasonAvg,
    vs,
    n,
    min5,
    steps: [
      { label: 'Baza (forma, sezona, protiv njih)', value: base },
      { label: `Minute (${fix1(min5)} zadnjih 5 / ${fix1(player.season.min)} sezona)`, delta: afterMin - base },
      { label: player.home ? 'Domaćin' : 'Gost', delta: afterHa - afterMin },
      { label: `Odbrana ${player.opp} prema poziciji ${player.pos}`, delta: value - afterHa },
    ],
  }
}

// Okvirna granica dok admin ne upiše Maxbet: 60% sezona + 40% forma, zaokruženo na .5.
export const estimateLine = (player, form) => Math.floor(0.6 * player.season.pts + 0.4 * form) + 0.5

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
export function chance(line, projection, sd) {
  const over = 1 - phi((line - projection) / sd)
  const tip = over >= 0.5 ? '+' : '−'
  return { over, tip, pct: Math.round((tip === '+' ? over : 1 - over) * 100), sd }
}

export const hitsOver = (games, line) => games.filter((game) => !game.dnp && game.pts > line).length
export const hitsUnder = (games, line) => games.filter((game) => !game.dnp && game.pts < line).length
export const playedCount = (games) => games.filter((game) => !game.dnp).length

// Igrač sa projekcijama, granicom (Maxbet ili procjena), šansom i oznakama.
export function enrichPlayer(player, defense, doubleTeams) {
  const proj = {
    pts: project(player, 'pts', defense),
    ast: project(player, 'ast', defense),
    reb: project(player, 'reb', defense),
  }
  const est = estimateLine(player, proj.pts.form)
  const line = player.line ?? est
  const sd = pointsSd(player)
  const last5 = player.last10.slice(0, 5)
  const dnp5 = last5.filter((game) => game.dnp).length
  const def = defense[player.opp]?.[player.pos] ?? 1

  const flags = []
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
    lineSrc: player.line === null ? 'procjena' : 'maxbet',
    chance: chance(line, proj.pts.value, sd),
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
