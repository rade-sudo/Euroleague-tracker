<?php

declare(strict_types=1);

// Raspored, poeni igrača i automatske ocjene, sa istog javnog API-ja kao spisak igrača.
const EUROLEAGUE_GAMES_URL = 'https://api-live.euroleague.net/v2/competitions/E/seasons/%s/games';
const EUROLEAGUE_BOXSCORE_URL = 'https://api-live.euroleague.net/v3/competitions/E/seasons/%s/games/%d/stats';
const SCHEDULE_REFRESH_MINUTES = 360;
// Malo manje od 5 minuta, da cron na 5 minuta ne preskoči svaku drugu provjeru.
const RESULTS_CHECK_MINUTES = 4.5;
// Prije ovoga utakmica sigurno nije gotova, pa nema smisla pitati za rezultat.
const GAME_LENGTH_MINUTES = 105;
const LOCK_MINUTES_BEFORE_GAME = 30;
const MIN_GAMES_PER_TICKET_DAY = 2;
// Tok utakmice (play-by-play), za prve poene na meču. Radi i dok utakmica traje.
const EUROLEAGUE_PLAY_BY_PLAY_URL = 'https://live.euroleague.net/api/PlayByPlay?gamecode=%d&seasoncode=%s';
const SCORING_PLAYS = ['2FGM', '3FGM', 'FTM'];
const QUARTERS = ['FirstQuarter', 'SecondQuarter', 'ThirdQuarter', 'ForthQuarter', 'ExtraTime'];
const FIRST_SCORER_CHECK_MINUTES = 2;
const FIRST_SCORER_GAMES_PER_RUN = 10;
const DAY_ACCUSATIVE = ['nedjelju', 'ponedjeljak', 'utorak', 'srijedu', 'četvrtak', 'petak', 'subotu'];

function minutesSince(PDO $db, string $setting): float
{
    $at = getSetting($db, $setting, '');
    return $at === '' ? INF : (time() - strtotime($at)) / 60;
}

function dayAccusative(string $date): string
{
    return DAY_ACCUSATIVE[(int) date('w', strtotime($date))];
}

// Upisuje utakmice regularne sezone. Pomjerena utakmica dobija novo vrijeme,
// a igrači na tiketima idu sa njom jer su vezani za utakmicu, ne za dan.
function importSchedule(PDO $db, string $season): bool
{
    $games = fetchJson(sprintf(EUROLEAGUE_GAMES_URL, $season), 15)['data'] ?? null;
    if (!is_array($games)) {
        return false;
    }

    $zone = new DateTimeZone(date_default_timezone_get());
    $now = date('Y-m-d H:i:s');
    $upsert = $db->prepare(
        'INSERT INTO games (season, game_code, round, starts_at, home_code, home_name, away_code, away_name, played, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE round = VALUES(round), starts_at = VALUES(starts_at),
             home_code = VALUES(home_code), home_name = VALUES(home_name),
             away_code = VALUES(away_code), away_name = VALUES(away_name),
             played = VALUES(played), updated_at = VALUES(updated_at)'
    );
    $club = fn (array $side, string $key) => mb_substr((string) ($side['club'][$key] ?? ''), 0, $key === 'code' ? 10 : 60);

    $db->beginTransaction();
    foreach ($games as $game) {
        if (($game['phaseType']['code'] ?? '') !== 'RS' || !isset($game['gameCode'], $game['round'], $game['utcDate'])) {
            continue;
        }
        try {
            $start = (new DateTimeImmutable((string) $game['utcDate']))->setTimezone($zone);
        } catch (Exception) {
            continue;
        }
        $upsert->execute([
            $season,
            (int) $game['gameCode'],
            (int) $game['round'],
            $start->format('Y-m-d H:i:s'),
            $club($game['local'] ?? [], 'code'),
            $club($game['local'] ?? [], 'abbreviatedName'),
            $club($game['road'] ?? [], 'code'),
            $club($game['road'] ?? [], 'abbreviatedName'),
            (int) (bool) ($game['played'] ?? false),
            $now,
        ]);
    }
    linkPicksToGames($db, $season);
    $db->commit();
    return true;
}

// Igrač sa spiska dobija utakmicu svog kluba u tom kolu (i za kola upisana ranije).
function linkPicksToGames(PDO $db, string $season): void
{
    $db->prepare(
        'UPDATE picks p
         JOIN rounds r ON r.id = p.round_id
         JOIN players pl ON pl.id = p.player_id
         JOIN games g ON g.season = ? AND g.round = r.number AND pl.club_code IN (g.home_code, g.away_code)
         SET p.game_id = g.id
         WHERE p.game_id IS NULL'
    )->execute([$season]);
}

// Dani kola po našoj zoni. Dan sa bar dvije utakmice je dan tiketa i zaključava se
// pola sata prije svoje prve utakmice. Kolo bez rasporeda vraća prazan niz.
function roundSchedule(PDO $db, int $number): array
{
    $stmt = $db->prepare(
        'SELECT id, starts_at, home_code, home_name, away_code, away_name, played
         FROM games WHERE season = ? AND round = ? ORDER BY starts_at, id'
    );
    $stmt->execute([currentSeasonCode(), $number]);

    $days = [];
    foreach ($stmt as $row) {
        $date = substr($row['starts_at'], 0, 10);
        $days[$date] ??= ['date' => $date, 'games' => []];
        $days[$date]['games'][] = [
            'id' => (int) $row['id'],
            'startsAt' => str_replace(' ', 'T', substr($row['starts_at'], 0, 16)),
            'home' => $row['home_name'],
            'homeCode' => $row['home_code'],
            'away' => $row['away_name'],
            'awayCode' => $row['away_code'],
            'played' => (bool) $row['played'],
        ];
    }

    // Admin može zaključati dan prije roka ili ga otključati posle roka (day_locks).
    $stmt = $db->prepare(
        "SELECT DATE_FORMAT(dl.day, '%Y-%m-%d') AS day, dl.locked FROM day_locks dl
         JOIN rounds r ON r.id = dl.round_id WHERE r.number = ?"
    );
    $stmt->execute([$number]);
    $overrides = array_map(fn ($locked) => (bool) $locked, $stmt->fetchAll(PDO::FETCH_KEY_PAIR));

    $now = time();
    foreach ($days as &$day) {
        $deadline = strtotime($day['games'][0]['startsAt']) - LOCK_MINUTES_BEFORE_GAME * 60;
        $override = $overrides[$day['date']] ?? null;
        $day['ticket'] = count($day['games']) >= MIN_GAMES_PER_TICKET_DAY;
        $day['deadline'] = $day['ticket'] ? date('Y-m-d\TH:i', $deadline) : null;
        $day['locked'] = $day['ticket'] && ($override ?? $now >= $deadline);
        // true: zaključao admin, false: otključao admin, null: automatski po roku.
        $day['manual'] = $day['ticket'] ? $override : null;
    }
    return array_values($days);
}

// "Tiket za četvrtak je zaključan u 17:30, …"; kad ga je admin zaključao ranije, bez vremena.
function dayLockedMessage(array $day): string
{
    $when = $day['manual'] ? '' : ' u ' . substr($day['deadline'], 11);
    return 'Tiket za ' . dayAccusative($day['date']) . " je zaključan{$when}, igrači za taj dan se više ne mogu mijenjati.";
}

function scheduleDayOfGame(array $schedule, ?int $gameId): ?array
{
    foreach ($schedule as $day) {
        foreach ($day['games'] as $game) {
            if ($game['id'] === $gameId) {
                return $day;
            }
        }
    }
    return null;
}

// Utakmica igrača u kolu, uz provjeru da se za taj dan još bira. Admin smije i posle roka.
function gameForPick(PDO $db, array $schedule, array $player, int $roundNumber, bool $isAdmin): int
{
    $stmt = $db->prepare('SELECT club_code, club_name FROM players WHERE id = ?');
    $stmt->execute([$player['id']]);
    $club = $stmt->fetch() ?: ['club_code' => null, 'club_name' => null];

    foreach ($schedule as $day) {
        foreach ($day['games'] as $game) {
            if (!in_array($club['club_code'], [$game['homeCode'], $game['awayCode']], true)) {
                continue;
            }
            if (!$day['ticket']) {
                fail(422, "{$player['name']} igra u " . dayAccusative($day['date'])
                    . " ({$game['home']} – {$game['away']}), a tog dana nema tiketa jer je samo jedna utakmica.");
            }
            if ($day['locked'] && !$isAdmin) {
                fail(409, dayLockedMessage($day));
            }
            return $game['id'];
        }
    }
    $clubName = $club['club_name'] ? " ({$club['club_name']})" : '';
    fail(422, "{$player['name']}{$clubName} nema utakmicu u kolu {$roundNumber}.");
}

// Poeni igrača sa tiketa iz zapisnika završenih utakmica. Ko nije u zapisniku ili nije
// ušao u igru dobija did_play = 0. Vraća kola u kojima se nešto upisalo.
function fillPickStats(PDO $db, string $season): array
{
    $stmt = $db->prepare(
        'SELECT p.id, p.round_id, g.game_code, pl.code AS player_code
         FROM picks p JOIN games g ON g.id = p.game_id JOIN players pl ON pl.id = p.player_id
         WHERE g.season = ? AND g.played = 1 AND p.did_play IS NULL'
    );
    $stmt->execute([$season]);
    $byGame = [];
    foreach ($stmt as $row) {
        $byGame[(int) $row['game_code']][] = $row;
    }

    // Skokovi i asistencije za tipove PS / PA / PAS (migracija 018).
    $update = $db->prepare('UPDATE picks SET points = ?, assists = ?, rebounds = ?, did_play = ? WHERE id = ?');
    $rounds = [];
    foreach ($byGame as $gameCode => $picks) {
        $box = fetchJson(sprintf(EUROLEAGUE_BOXSCORE_URL, $season, $gameCode), 15);
        $lines = [];
        $total = 0;
        foreach (['local', 'road'] as $side) {
            foreach ((array) ($box[$side]['players'] ?? []) as $entry) {
                $points = (int) ($entry['stats']['points'] ?? 0);
                $lines[(string) ($entry['player']['person']['code'] ?? '')] = [
                    'points' => $points,
                    'seconds' => (int) ($entry['stats']['timePlayed'] ?? 0),
                    'assists' => (int) ($entry['stats']['assistances'] ?? 0),
                    'rebounds' => (int) ($entry['stats']['totalRebounds'] ?? 0),
                ];
                $total += $points;
            }
        }
        // Prazan zapisnik znači da podaci još nisu objavljeni, a ne da niko nije igrao.
        if ($total === 0) {
            continue;
        }
        foreach ($picks as $pick) {
            $line = $lines[$pick['player_code']] ?? null;
            $played = $line !== null && $line['seconds'] > 0;
            $update->execute([
                $played ? min($line['points'], 255) : null,
                $played ? min($line['assists'], 255) : null,
                $played ? min($line['rebounds'], 255) : null,
                (int) $played,
                $pick['id'],
            ]);
            $rounds[(int) $pick['round_id']] = true;
        }
    }
    return array_keys($rounds);
}

// Šifra igrača koji je dao prve poene (iz igre ili sa linije); '' ako ih još nema, null ako sajt ne odgovara.
function fetchFirstScorer(string $season, int $gameCode): ?string
{
    $data = fetchJson(sprintf(EUROLEAGUE_PLAY_BY_PLAY_URL, $gameCode, $season), 15);
    if ($data === null) {
        return null;
    }
    foreach (QUARTERS as $quarter) {
        foreach ((array) ($data[$quarter] ?? []) as $play) {
            if (in_array(trim((string) ($play['PLAYTYPE'] ?? '')), SCORING_PLAYS, true)) {
                // "P013285" u toku utakmice je "013285" u spisku igrača.
                return ltrim(trim((string) ($play['PLAYER_ID'] ?? '')), 'P');
            }
        }
    }
    return '';
}

// Igrači sa tiketa dobiju PPM kad je poznat strijelac prvih poena njihove utakmice.
function markFirstPoints(PDO $db, int $gameId): void
{
    $db->prepare(
        "UPDATE picks p JOIN games g ON g.id = p.game_id LEFT JOIN players pl ON pl.id = p.player_id
         SET p.first_points = (pl.code IS NOT NULL AND g.first_scorer_code <> '' AND pl.code = g.first_scorer_code)
         WHERE p.game_id = ?"
    )->execute([$gameId]);
}

// Za utakmice sa našim igračima koje su počele: ko je dao prve poene. Utakmica bez podataka
// posle kraja dobije '' i ne traži se više. Vraća kola u kojima se nešto promijenilo.
function checkFirstScorers(PDO $db, string $season): array
{
    $stmt = $db->prepare(
        'SELECT DISTINCT g.id, g.game_code, g.played FROM games g JOIN picks p ON p.game_id = g.id
         WHERE g.season = ? AND g.first_scorer_code IS NULL AND g.starts_at <= ?
         ORDER BY g.id LIMIT ' . FIRST_SCORER_GAMES_PER_RUN
    );
    $stmt->execute([$season, date('Y-m-d H:i:s')]);
    $update = $db->prepare('UPDATE games SET first_scorer_code = ? WHERE id = ?');
    $rounds = $db->prepare('SELECT DISTINCT round_id FROM picks WHERE game_id = ?');
    $changed = [];
    foreach ($stmt->fetchAll() as $game) {
        $scorer = fetchFirstScorer($season, (int) $game['game_code']);
        if ($scorer === null || ($scorer === '' && !$game['played'])) {
            continue;
        }
        $update->execute([$scorer, $game['id']]);
        markFirstPoints($db, (int) $game['id']);
        $rounds->execute([$game['id']]);
        foreach ($rounds->fetchAll(PDO::FETCH_COLUMN) as $roundId) {
            $changed[(int) $roundId] = true;
        }
    }
    return array_keys($changed);
}

// Tipovi sa tiketa: "+" / "-" (poeni prema Maxbet granici), "<+" "<-" ">+" ">-" (poeni prema manjoj ili većoj
// granici), "PS+" "PS-" (poeni + skokovi), "PA+" "PA-" (poeni + asistencije), "PAS+" "PAS-" (sva tri).
// Isto pravilo je u src/tips.js. Nepoznat tekst (stari tiketi) = poeni, minus ako počinje minusom.
// plain: obični + / −, jedini vezani za granicu iz Forme i uvoz sa Maxbeta.
function parseTip(string $tip): array
{
    if (preg_match('/^\s*(PAS|PS|PA|<|>)?\s*([+\-−–])/iu', $tip, $m)) {
        $kind = strtoupper($m[1] ?? '');
        $stat = in_array($kind, ['PAS', 'PS', 'PA'], true) ? strtolower($kind) : 'pts';
        $alt = in_array($kind, ['<', '>'], true) ? $kind : null;
        $under = $m[2] !== '+';
        return ['stat' => $stat, 'alt' => $alt, 'under' => $under, 'plain' => $stat === 'pts' && $alt === null, 'code' => ($kind ?: '') . ($under ? '-' : '+')];
    }
    return ['stat' => 'pts', 'alt' => null, 'under' => false, 'plain' => true, 'code' => null];
}

function isUnderTip(string $tip): bool
{
    return parseTip($tip)['under'];
}

// Vrijednost koja se poredi sa granicom: poeni, ili zbir za PS / PA / PAS (null dok se ne zna).
function tipValue(array $tip, ?int $points, ?int $assists, ?int $rebounds): ?int
{
    if ($points === null) {
        return null;
    }
    $parts = ['pts' => [], 'ps' => [$rebounds], 'pa' => [$assists], 'pas' => [$assists, $rebounds]][$tip['stat']];
    if (in_array(null, $parts, true)) {
        return null;
    }
    return $points + array_sum($parts);
}

// Prvi poeni na meču (Maxbet akcija) = poeni „+“ (i manja / veća plus) je odmah prošao, i dok utakmica traje.
// Nije igrao = prošao. „+“ traži više od granice (15.5 → 16), „−“ manje; za PS / PA / PAS se gleda zbir.
// Bez granice nema ocjene; null znači da se još ne zna.
function lineVerdict(?string $line, ?int $points, ?bool $didPlay, string $tip, bool $firstPoints = false, ?int $assists = null, ?int $rebounds = null): ?bool
{
    $parsed = parseTip($tip);
    if ($firstPoints && $parsed['stat'] === 'pts' && !$parsed['under']) {
        return true;
    }
    if ($didPlay === null) {
        return null;
    }
    if (!$didPlay) {
        return true;
    }
    $value = tipValue($parsed, $points, $assists, $rebounds);
    if ($line === null || $value === null) {
        return null;
    }
    return $parsed['under'] ? $value < (float) $line : $value > (float) $line;
}

function autoGradeFromRound(PDO $db): int
{
    return (int) getSetting($db, 'auto_grade_from_round', '1');
}

// Automatske ocjene u kolu. Ocjenu koju je dao admin ne dira; kad se promijeni nešto
// na tiketu, rezultat ide u tabelu (ili se briše dok neko čeka ocjenu).
function autoGradeRound(PDO $db, int $roundId): void
{
    $stmt = $db->prepare('SELECT number FROM rounds WHERE id = ?');
    $stmt->execute([$roundId]);
    if ((int) $stmt->fetchColumn() < autoGradeFromRound($db)) {
        return;
    }

    $stmt = $db->prepare(
        "SELECT id, friend_id, tip, line, points, assists, rebounds, did_play, first_points, hit FROM picks
         WHERE round_id = ? AND (graded_by IS NULL OR graded_by = 'auto')"
    );
    $stmt->execute([$roundId]);
    $update = $db->prepare('UPDATE picks SET hit = ?, graded_by = ? WHERE id = ?');
    $changed = [];
    foreach ($stmt->fetchAll() as $pick) {
        $verdict = lineVerdict(
            $pick['line'],
            $pick['points'] === null ? null : (int) $pick['points'],
            $pick['did_play'] === null ? null : (bool) $pick['did_play'],
            $pick['tip'],
            (bool) $pick['first_points'],
            $pick['assists'] === null ? null : (int) $pick['assists'],
            $pick['rebounds'] === null ? null : (int) $pick['rebounds'],
        );
        $current = $pick['hit'] === null ? null : (bool) $pick['hit'];
        if ($verdict === $current) {
            continue;
        }
        $update->execute([$verdict === null ? null : (int) $verdict, $verdict === null ? null : 'auto', $pick['id']]);
        $changed[(int) $pick['friend_id']] = true;
    }
    foreach (array_keys($changed) as $friendId) {
        syncResultFromPicks($db, $roundId, $friendId);
    }
}

// Kolo sa rasporedom ide dalje samo: zaključava se rokom posljednjeg dana tiketa,
// a završava kad su odigrane sve utakmice dana tiketa.
// Admin zaključava ili otključava dane tiketa ($day null = svi dani kola).
// Otključan dan se opet sam zaključa u rok; ako je rok prošao, ostaje otključan dok ga admin ne zaključa.
function setDayLocks(PDO $db, array $round, ?string $day, bool $locked): void
{
    if ($round['status'] === 'done') {
        fail(409, "Kolo {$round['number']} je završeno.");
    }
    $days = array_values(array_filter(roundSchedule($db, (int) $round['number']), fn (array $d) => $d['ticket']));
    if (!$days) {
        fail(422, 'Kolo nema raspored, zaključava se dugmetom za cijelo kolo.');
    }
    if ($day !== null) {
        $days = array_values(array_filter($days, fn (array $d) => $d['date'] === $day));
        if (!$days) {
            fail(422, 'Taj dan nije dan tiketa ovog kola.');
        }
    }
    $upsert = $db->prepare(
        'INSERT INTO day_locks (round_id, day, locked, created_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE locked = VALUES(locked), created_at = VALUES(created_at)'
    );
    $delete = $db->prepare('DELETE FROM day_locks WHERE round_id = ? AND day = ?');
    foreach ($days as $d) {
        $deadlinePassed = time() >= strtotime($d['deadline']);
        if ($locked || $deadlinePassed) {
            $upsert->execute([$round['id'], $d['date'], (int) $locked, date('Y-m-d H:i:s')]);
        } else {
            $delete->execute([$round['id'], $d['date']]);
        }
    }
}

function advanceRounds(PDO $db): void
{
    $update = $db->prepare('UPDATE rounds SET status = ? WHERE id = ?');
    foreach ($db->query("SELECT id, number, status FROM rounds WHERE status <> 'done'")->fetchAll() as $round) {
        $days = array_filter(roundSchedule($db, (int) $round['number']), fn (array $day) => $day['ticket']);
        if (!$days) {
            continue;
        }
        $status = $round['status'];
        $anyOpen = (bool) array_filter($days, fn (array $day) => !$day['locked']);
        if ($status === 'open' && !$anyOpen) {
            $status = 'locked';
        } elseif ($status === 'locked' && $anyOpen) {
            // Admin je otključao dan: kolo je opet otvoreno za unos.
            $status = 'open';
        }
        $games = array_merge(...array_map(fn (array $day) => $day['games'], array_values($days)));
        if ($status === 'locked' && !array_filter($games, fn (array $game) => !$game['played'])) {
            $status = 'done';
        }
        if ($status !== $round['status']) {
            $update->execute([$status, $round['id']]);
        }
    }
}

// Poziva se pri učitavanju stranice; mrežu dira rijetko. Raspored se osvježava svakih
// 6 sati, a posle utakmica na 5 minuta, dok rezultati i poeni sa tiketa ne stignu.
function syncEuroleague(PDO $db): void
{
    $season = currentSeasonCode();
    $sinceSchedule = minutesSince($db, 'schedule_synced_at');
    $due = $sinceSchedule >= SCHEDULE_REFRESH_MINUTES;
    if (!$due && $sinceSchedule >= RESULTS_CHECK_MINUTES) {
        $stmt = $db->prepare('SELECT 1 FROM games WHERE season = ? AND played = 0 AND starts_at <= ? LIMIT 1');
        $stmt->execute([$season, date('Y-m-d H:i:s', time() - GAME_LENGTH_MINUTES * 60)]);
        $due = (bool) $stmt->fetchColumn();
    }
    if ($due) {
        setSetting($db, 'schedule_synced_at', date('Y-m-d H:i:s'));
        importSchedule($db, $season);
    }

    if (minutesSince($db, 'stats_synced_at') >= RESULTS_CHECK_MINUTES) {
        $stmt = $db->prepare(
            'SELECT 1 FROM picks p JOIN games g ON g.id = p.game_id
             WHERE g.season = ? AND g.played = 1 AND p.did_play IS NULL AND p.player_id IS NOT NULL LIMIT 1'
        );
        $stmt->execute([$season]);
        if ($stmt->fetchColumn()) {
            setSetting($db, 'stats_synced_at', date('Y-m-d H:i:s'));
            foreach (fillPickStats($db, $season) as $roundId) {
                autoGradeRound($db, $roundId);
            }
        }
    }

    // Prvi poeni na meču: čim utakmica počne, na par minuta, dok se ne zna strijelac.
    if (minutesSince($db, 'first_scorers_checked_at') >= FIRST_SCORER_CHECK_MINUTES) {
        $stmt = $db->prepare(
            'SELECT 1 FROM games g JOIN picks p ON p.game_id = g.id
             WHERE g.season = ? AND g.first_scorer_code IS NULL AND g.starts_at <= ? LIMIT 1'
        );
        $stmt->execute([$season, date('Y-m-d H:i:s')]);
        if ($stmt->fetchColumn()) {
            setSetting($db, 'first_scorers_checked_at', date('Y-m-d H:i:s'));
            foreach (checkFirstScorers($db, $season) as $roundId) {
                autoGradeRound($db, $roundId);
            }
        }
    }

    advanceRounds($db);
    ensureSlips($db);

    // Fantasy liga ide posljednja i odvojeno: njena greška ne smije zaustaviti tikete.
    // FANTASY ISKLJUČEN dok ne ide live: ne skida PIR, ne vodi draft ni izmjene.
    // try {
    //     syncFantasy($db, $season);
    // } catch (Throwable $e) {
    //     if ($db->inTransaction()) {
    //         $db->rollBack();
    //     }
    //     error_log((string) $e);
    // }

    // Zapisnici za Formu, isto odvojeno.
    try {
        syncForma($db, $season);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log((string) $e);
    }

    // Jednom poslije migracije 018: automatske ocjene svih kola ponovo, jer je stara ocjena
    // <−, >−, PS−, PA−, PAS− čitala kao plus, a PS / PA / PAS samo po poenima. Ručne ocjene se ne diraju.
    if (getSetting($db, 'tips_regraded', '') === '') {
        try {
            $db->query('SELECT assists FROM picks LIMIT 1');
            foreach ($db->query('SELECT id FROM rounds')->fetchAll(PDO::FETCH_COLUMN) as $roundId) {
                autoGradeRound($db, (int) $roundId);
            }
            setSetting($db, 'tips_regraded', date('Y-m-d H:i:s'));
        } catch (PDOException $e) {
            // Migracija 018 još nije pokrenuta: pokušaće ponovo pri sljedećoj sinhronizaciji.
            error_log($e->getMessage());
        }
    }

    // Spisak povreda sa BasketNewsa (par puta dnevno), za odsutne saigrače u Formi.
    try {
        syncInjuries($db);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log((string) $e);
    }
}
