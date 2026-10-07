const SPECIAL = { đ: 'dj', ð: 'd', ł: 'l', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i' }

// Bez kvačica, velikih slova i znakova: "Horton-Tucker" = "horton tucker", "Mirotić" = "mirotic".
// Isto pravilo je u api/players.php (normalizePlayerName).
export function normalizePlayerName(text) {
  return text
    .toLowerCase()
    .replace(/[đðłøßæœı]/g, (char) => SPECIAL[char])
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function buildPlayerIndex(catalog) {
  return {
    players: catalog.players.map((player) => ({
      ...player,
      tokens: normalizePlayerName(player.name).split(' '),
    })),
    aliases: catalog.aliases.map((alias) => ({ ...alias, normalized: normalizePlayerName(alias.alias) })),
  }
}

// Prijedlozi dok se kuca: cijele riječi imena, pa početak riječi ("vez" → Vezenkov), pa skraćenice.
export function searchPlayers(index, query, limit = 6) {
  const normalized = normalizePlayerName(query)
  if (normalized.length < 2) return []
  const words = normalized.split(' ')
  const scores = new Map()
  const bump = (id, score) => scores.set(id, Math.max(scores.get(id) ?? 0, score))

  for (const player of index.players) {
    let score = 0
    if (words.every((word) => player.tokens.includes(word))) score = 3
    else if (words.every((word) => player.tokens.some((token) => token.startsWith(word)))) score = 2
    if (score) bump(player.id, score + (player.active ? 0.5 : 0))
  }
  for (const alias of index.aliases) {
    if (alias.normalized === normalized) bump(alias.playerId, 5)
    else if (alias.normalized.startsWith(normalized)) bump(alias.playerId, 1.5)
  }

  const byId = new Map(index.players.map((player) => [player.id, player]))
  return [...scores.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1] || byId.get(a[0]).name.localeCompare(byId.get(b[0]).name))
    .slice(0, limit)
    .map(([id]) => byId.get(id))
}
