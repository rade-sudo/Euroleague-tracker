// 72.96 → "72,96 KM"; whole: 8 → "8 KM" (ulozi su uvijek cijeli KM).
export function km(value, { whole = false } = {}) {
  const amount = Math.round(value * 100) / 100
  const text = whole && Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',')
  return `${text.replace('-', '−')} KM`
}

// "11,24" ili "11.24" → "11.24" za server; prazno ostaje prazno.
export const moneyInput = (raw) => raw.trim().replace(/\s/g, '').replace('−', '-').replace(',', '.')

// Stanje u kasi: minus duguje kasi, plus kasa duguje njemu.
export function balanceState(value) {
  if (Math.abs(value) < 0.005) return { tone: 'even', text: 'izmireno' }
  return value < 0
    ? { tone: 'owes', text: `duguje ${km(-value)}` }
    : { tone: 'credit', text: `kasa mu duguje ${km(value)}` }
}

export const BALANCE_TONES = {
  owes: 'bg-rose-500/10 text-rose-400 ring-rose-500/35',
  credit: 'bg-neon/10 text-neon ring-neon/30',
  even: 'text-zinc-400 ring-line',
}

export const BALANCE_TEXT = { owes: 'text-rose-400', credit: 'text-neon', even: 'text-zinc-400' }
