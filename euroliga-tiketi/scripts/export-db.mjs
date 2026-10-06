// Pravi deploy/baza.sql iz lokalne baze (Laragon), za uvoz na Hostinger kroz phpMyAdmin.
// Sesije i pokušaji prijave se ne prenose (samo prazne tabele); nalozi i lozinke se prenose.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATABASE = 'euroliga_tiketi'
const OUTPUT = 'deploy/baza.sql'

function findMysqldump() {
  const laragon = 'C:/laragon/bin/mysql'
  if (existsSync(laragon)) {
    for (const version of readdirSync(laragon).sort().reverse()) {
      const exe = join(laragon, version, 'bin', 'mysqldump.exe')
      if (existsSync(exe)) return exe
    }
  }
  return 'mysqldump'
}

const mysqldump = findMysqldump()
const common = [
  '--user=root',
  '--host=127.0.0.1',
  '--default-character-set=utf8mb4',
  '--single-transaction',
  '--skip-comments',
  '--no-tablespaces',
  '--set-gtid-purged=OFF',
]
const run = (args) => execFileSync(mysqldump, [...common, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const withData = run([
  `--ignore-table=${DATABASE}.sessions`,
  `--ignore-table=${DATABASE}.login_attempts`,
  DATABASE,
])
const structureOnly = run(['--no-data', DATABASE, 'sessions', 'login_attempts'])
const sql = `${withData}\n${structureOnly}`

// MariaDB na Hostingeru ne poznaje MySQL 8 kolacije (vidi api/migrations/002_kolacije_za_mariadb.sql).
if (/utf8mb4_0900_/.test(sql)) {
  console.error('Baza još koristi utf8mb4_0900_* kolacije. Prvo pokreni api/migrations/002_kolacije_za_mariadb.sql.')
  process.exit(1)
}

mkdirSync('deploy', { recursive: true })
writeFileSync(OUTPUT, sql)
console.log(`Napravljen ${OUTPUT} (${Math.round(sql.length / 1024)} KB). Uvezi ga na Hostingeru: phpMyAdmin → baza → Uvoz.`)
