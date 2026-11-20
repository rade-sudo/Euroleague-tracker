<?php

declare(strict_types=1);

// Forma igrača za izbor na tiket: poeni, asistencije i skokovi sa zapisnika Eurolige
// (tekuća i dvije prethodne sezone), istorija protiv protivnika i granice sa Maxbeta.
// Projekciju i šansu računa src/forma.js, da se odmah preračunaju kad admin promijeni granicu.
const FORMA_SEASONS_BACK = 2;
const FORMA_LAST_GAMES = 10;
const FORMA_H2H_GAMES = 8;
const FORMA_SYNC_MINUTES = 4.5;
// Zapisnika po prolazu: cron popuni prošle sezone za par sati, a stranica ne čeka mrežu.
const FORMA_BOX_PER_RUN_CLI = 20;
const FORMA_BOX_PER_RUN_WEB = 3;
const FORMA_MISSING_AFTER_HOURS = 48;
// Druga utakmica tima tri dana prije ili poslije = dvostruko kolo te sedmice.
const FORMA_DOUBLE_DAYS = 3;
// Odbrana protivnika: sa malo utakmica faktor ostaje bliže prosjeku lige.
const FORMA_DEFENSE_PRIOR_GAMES = 3;
// Najviše ±15%: jedna pozicija sa par slabih utakmica ne smije pomjeriti projekciju previše.
const FORMA_DEFENSE_MAX = 0.15;

// Tekuća sezona prva, pa prethodne: E2026, E2025, E2024.
function formaSeasons(string $current): array
{
    $year = (int) substr($current, 1);
    return array_map(fn (int $back) => 'E' . ($year - $back), range(0, FORMA_SEASONS_BACK));
}

function formaSeasonLabel(string $season): string
{
    $year = (int) substr($season, 1);
    return $year . '/' . substr((string) ($year + 1), 2);
}

function formaPlaceholders(array $values): string
{
    return implode(', ', array_fill(0, count($values), '?'));
}

/* ---------- Uvoz zapisnika ---------- */

// Sve utakmice sezone, i doigravanje (za istoriju protiv protivnika).
function formaUpsertGames(PDO $db, string $season, array $games): void
{
    $zone = new DateTimeZone(date_default_timezone_get());
    $upsert = $db->prepare(
        'INSERT INTO box_games (season, game_code, round, starts_at, home_code, away_code, played)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE round = VALUES(round), starts_at = VALUES(starts_at),
             home_code = VALUES(home_code), away_code = VALUES(away_code), played = VALUES(played)'
    );
    $db->beginTransaction();
    foreach ($games as $game) {
        $home = mb_substr((string) ($game['local']['club']['code'] ?? ''), 0, 10);
        $away = mb_substr((string) ($game['road']['club']['code'] ?? ''), 0, 10);
        if (!isset($game['gameCode'], $game['round'], $game['utcDate']) || $home === '' || $away === '') {
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
            $home,
            $away,
            (int) (bool) ($game['played'] ?? false),
        ]);
    }
    $db->commit();
}

// Utakmica tekuće sezone koja je trebala da se završi, a raspored je još vodi kao neodigranu.
function formaGameDue(PDO $db, string $season): bool
{
    $stmt = $db->prepare('SELECT 1 FROM box_games WHERE season = ? AND played = 0 AND starts_at BETWEEN ? AND ? LIMIT 1');
    $stmt->execute([
        $season,
        date('Y-m-d H:i:s', time() - FORMA_MISSING_AFTER_HOURS * 3600),
        date('Y-m-d H:i:s', time() - GAME_LENGTH_MINUTES * 60),
    ]);
    return (bool) $stmt->fetchColumn();
}

// Zapisnici odigranih utakmica, najnovije prve (prvo se popuni forma, pa stare sezone).
function formaFetchBoxScores(PDO $db): void
{
    $limit = PHP_SAPI === 'cli' ? FORMA_BOX_PER_RUN_CLI : FORMA_BOX_PER_RUN_WEB;
    $games = $db->query(
        "SELECT season, game_code, starts_at, home_code, away_code FROM box_games
         WHERE stats = 'waiting' AND played = 1
         ORDER BY checked_at IS NOT NULL, checked_at, starts_at DESC LIMIT {$limit}"
    )->fetchAll();
    $insert = $db->prepare(
        'INSERT INTO box_stats (season, game_code, player_code, team_code, position, seconds, points, assists, rebounds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE team_code = VALUES(team_code), position = VALUES(position), seconds = VALUES(seconds),
             points = VALUES(points), assists = VALUES(assists), rebounds = VALUES(rebounds)'
    );
    $mark = $db->prepare('UPDATE box_games SET stats = ?, checked_at = ? WHERE season = ? AND game_code = ?');
    $byte = fn (mixed $value) => max(0, min(255, (int) $value));

    foreach ($games as $game) {
        $box = fetchJson(sprintf(EUROLEAGUE_BOXSCORE_URL, $game['season'], (int) $game['game_code']), 15);
        $rows = [];
        foreach (['local' => $game['home_code'], 'road' => $game['away_code']] as $side => $team) {
            foreach ((array) ($box[$side]['players'] ?? []) as $entry) {
                $code = mb_substr((string) ($entry['player']['person']['code'] ?? ''), 0, 20);
                if ($code === '') {
                    continue;
                }
                $stats = (array) ($entry['stats'] ?? []);
                $rows[] = [
                    $game['season'],
                    (int) $game['game_code'],
                    $code,
                    $team,
                    PLAYER_POSITION_NAMES[$entry['player']['positionName'] ?? ''] ?? null,
                    max(0, min(65535, (int) ($stats['timePlayed'] ?? 0))),
                    $byte($stats['points'] ?? 0),
                    $byte($stats['assistances'] ?? 0),
                    $byte($stats['totalRebounds'] ?? 0),
                ];
            }
        }
        // Prazan zapisnik znači da podaci još nisu objavljeni; posle dva dana se odustaje.
        $hasStats = (bool) array_filter($rows, fn (array $row) => $row[5] > 0);
        $old = strtotime($game['starts_at']) < time() - FORMA_MISSING_AFTER_HOURS * 3600;
        $status = $hasStats ? 'done' : ($old ? 'missing' : 'waiting');
        $db->beginTransaction();
        foreach ($hasStats ? $rows : [] as $row) {
            $insert->execute($row);
        }
        $mark->execute([$status, date('Y-m-d H:i:s'), $game['season'], $game['game_code']]);
        $db->commit();
    }
}

// Raspored: tekuća sezona na 6 sati (i posle utakmica), prošle sezone jednom. Jedan spisak po prolazu.
function syncForma(PDO $db, string $season): void
{
    if (minutesSince($db, 'forma_synced_at') < FORMA_SYNC_MINUTES) {
        return;
    }
    setSetting($db, 'forma_synced_at', date('Y-m-d H:i:s'));
    foreach (formaSeasons($season) as $index => $code) {
        $setting = "forma_games_{$code}";
        $due = $index === 0
            ? minutesSince($db, $setting) >= SCHEDULE_REFRESH_MINUTES || formaGameDue($db, $code)
            : getSetting($db, $setting, '') === '';
        if (!$due) {
            continue;
        }
        $games = fetchJson(sprintf(EUROLEAGUE_GAMES_URL, $code), 25)['data'] ?? null;
        if (is_array($games)) {
            formaUpsertGames($db, $code, $games);
            setSetting($db, $setting, date('Y-m-d H:i:s'));
        }
        break;
    }
    formaFetchBoxScores($db);
}

/* ---------- Stranica ---------- */

// Kola tekuće sezone; podrazumijevano je prvo koje još nije odigrano do kraja.
// Kolo čija je zadnja utakmica počela prije pola dana je gotovo i kad raspored još nije osvježen.
function formaRounds(PDO $db, string $season): array
{
    $stmt = $db->prepare(
        'SELECT round, MIN(starts_at) AS first, MAX(starts_at) AS last, SUM(played) AS played, COUNT(*) AS games
         FROM games WHERE season = ? GROUP BY round ORDER BY round'
    );
    $stmt->execute([$season]);
    $past = date('Y-m-d H:i:s', time() - 12 * 3600);
    return array_map(fn (array $row) => [
        'number' => (int) $row['round'],
        'from' => substr($row['first'], 0, 10),
        'to' => substr($row['last'], 0, 10),
        'done' => (int) $row['played'] === (int) $row['games'] || $row['last'] < $past,
    ], $stmt->fetchAll());
}

// Koliko protivnik prima poena od pozicije u odnosu na prosjek lige: {MAD: {G: 0.94, F: 0.98, C: 0.91}}.
function formaDefense(PDO $db, string $season, string $before): array
{
    $stmt = $db->prepare(
        "SELECT s.team_code, s.position, SUM(s.points) AS points, g.home_code, g.away_code
         FROM box_stats s JOIN box_games g ON g.season = s.season AND g.game_code = s.game_code
         WHERE s.season = ? AND g.stats = 'done' AND g.starts_at < ? AND s.position IS NOT NULL
         GROUP BY s.game_code, s.team_code, s.position, g.home_code, g.away_code"
    );
    $stmt->execute([$season, $before]);
    $allowed = [];
    $league = [];
    foreach ($stmt as $row) {
        $defender = $row['team_code'] === $row['home_code'] ? $row['away_code'] : $row['home_code'];
        $allowed[$defender][$row['position']][] = (int) $row['points'];
        $league[$row['position']][] = (int) $row['points'];
    }
    $mean = fn (array $values) => array_sum($values) / count($values);
    $factors = [];
    foreach ($allowed as $team => $byPosition) {
        foreach ($byPosition as $position => $values) {
            $n = count($values);
            $raw = $mean($values) / max(1, $mean($league[$position]));
            $factor = 1 + ($raw - 1) * $n / ($n + FORMA_DEFENSE_PRIOR_GAMES);
            $factors[$team][$position] = round(max(1 - FORMA_DEFENSE_MAX, min(1 + FORMA_DEFENSE_MAX, $factor)), 3);
        }
    }
    return $factors;
}

// Timovi koji tri dana prije ili poslije utakmice kola igraju još jednu (dvostruko kolo).
function formaDoubleTeams(PDO $db, string $season, array $games): array
{
    if (!$games) {
        return [];
    }
    $starts = array_map(fn (array $game) => strtotime($game['starts_at']), $games);
    $stmt = $db->prepare('SELECT id, starts_at, home_code, away_code FROM games WHERE season = ? AND starts_at BETWEEN ? AND ?');
    $stmt->execute([
        $season,
        date('Y-m-d H:i:s', min($starts) - FORMA_DOUBLE_DAYS * 86400),
        date('Y-m-d H:i:s', max($starts) + FORMA_DOUBLE_DAYS * 86400),
    ]);
    $nearby = $stmt->fetchAll();
    $double = [];
    foreach ($games as $game) {
        foreach ($nearby as $other) {
            if ((int) $other['id'] === (int) $game['id']
                || abs(strtotime($other['starts_at']) - strtotime($game['starts_at'])) > FORMA_DOUBLE_DAYS * 86400) {
                continue;
            }
            foreach ([$game['home_code'], $game['away_code']] as $team) {
                if (in_array($team, [$other['home_code'], $other['away_code']], true)) {
                    $double[$team] = true;
                }
            }
        }
    }
    return array_keys($double);
}

// Granice kola: upisane u Formi, a za starija kola i one upisane samo na tiketu.
function formaRoundLines(PDO $db, string $season, int $round): array
{
    $stmt = $db->prepare(
        'SELECT p.player_id, p.line FROM picks p JOIN rounds r ON r.id = p.round_id
         WHERE r.number = ? AND p.player_id IS NOT NULL AND p.line IS NOT NULL'
    );
    $stmt->execute([$round]);
    $lines = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    $stmt = $db->prepare('SELECT player_id, line FROM forma_lines WHERE season = ? AND round = ?');
    $stmt->execute([$season, $round]);
    foreach ($stmt->fetchAll(PDO::FETCH_KEY_PAIR) as $playerId => $line) {
        $lines[$playerId] = $line;
    }
    return array_map(fn (mixed $line) => (float) $line, $lines);
}

function formaGameLine(array $row): array
{
    return [
        'min' => (int) round((int) $row['seconds'] / 60),
        'pts' => (int) $row['points'],
        'ast' => (int) $row['assists'],
        'reb' => (int) $row['rebounds'],
    ];
}

function formaPayload(PDO $db, array $user, ?int $roundNumber): array
{
    $season = currentSeasonCode();
    $rounds = formaRounds($db, $season);
    $pending = (int) $db->query("SELECT COUNT(*) FROM box_games WHERE stats = 'waiting' AND played = 1")->fetchColumn();
    $base = [
        'season' => formaSeasonLabel($season),
        'rounds' => $rounds,
        'isAdmin' => $user['role'] === 'admin',
        // Zapisnici koji se još skidaju sa Euroleague sajta; null = uvoz još nije počeo.
        'pending' => (int) $db->query('SELECT COUNT(*) FROM box_games')->fetchColumn() ? $pending : null,
    ];
    if (!$rounds) {
        return $base + ['round' => null, 'games' => [], 'players' => [], 'defense' => (object) [], 'double' => []];
    }
    $numbers = array_column($rounds, 'number');
    if (!in_array($roundNumber, $numbers, true)) {
        $next = array_values(array_filter($rounds, fn (array $round) => !$round['done']))[0] ?? end($rounds);
        $roundNumber = $next['number'];
    }

    $stmt = $db->prepare(
        'SELECT id, starts_at, home_code, home_name, away_code, away_name, played
         FROM games WHERE season = ? AND round = ? ORDER BY starts_at, id'
    );
    $stmt->execute([$season, $roundNumber]);
    $games = $stmt->fetchAll();
    $start = [];
    $opponent = [];
    $isHome = [];
    $teamGameId = [];
    foreach ($games as $game) {
        foreach ([[$game['home_code'], $game['away_code'], true], [$game['away_code'], $game['home_code'], false]] as [$team, $opp, $home]) {
            $start[$team] = $game['starts_at'];
            $opponent[$team] = $opp;
            $isHome[$team] = $home;
            $teamGameId[$team] = (int) $game['id'];
        }
    }
    $teams = array_keys($start);

    $players = [];
    if ($teams) {
        $stmt = $db->prepare(
            'SELECT id, code, name, club_code, position FROM players WHERE active = 1 AND club_code IN (' . formaPlaceholders($teams) . ')'
        );
        $stmt->execute($teams);
        $players = $stmt->fetchAll();
    }
    $seasons = formaSeasons($season);

    // Svi zapisnici ovih igrača u zadnje tri sezone, najnoviji prvi.
    $byPlayer = [];
    $codes = array_column($players, 'code');
    if ($codes) {
        $stmt = $db->prepare(
            'SELECT s.season, s.game_code, s.player_code, s.team_code, s.position, s.seconds, s.points, s.assists, s.rebounds,
                    g.round, g.starts_at, g.home_code, g.away_code
             FROM box_stats s JOIN box_games g ON g.season = s.season AND g.game_code = s.game_code
             WHERE s.player_code IN (' . formaPlaceholders($codes) . ') AND s.season IN (' . formaPlaceholders($seasons) . ')
             ORDER BY g.starts_at DESC'
        );
        $stmt->execute([...$codes, ...$seasons]);
        foreach ($stmt as $row) {
            $byPlayer[$row['player_code']][] = $row;
        }
    }

    // Utakmice timova u tekućoj sezoni sa zapisnikom: ko nije u zapisniku ili nije ušao, nije igrao.
    $teamGames = [];
    if ($teams) {
        $in = formaPlaceholders($teams);
        $stmt = $db->prepare(
            "SELECT game_code, round, starts_at, home_code, away_code FROM box_games
             WHERE season = ? AND stats = 'done' AND (home_code IN ({$in}) OR away_code IN ({$in}))
             ORDER BY starts_at DESC"
        );
        $stmt->execute([$season, ...$teams, ...$teams]);
        foreach ($stmt as $row) {
            $teamGames[$row['home_code']][] = $row + ['home' => true, 'opp' => $row['away_code']];
            $teamGames[$row['away_code']][] = $row + ['home' => false, 'opp' => $row['home_code']];
        }
    }

    $lines = formaRoundLines($db, $season, $roundNumber);
    // Utakmice sa uvezenim Maxbet granicama i koliko granica ima svaka.
    $offered = formaOfferedGames($db, $roundNumber);
    $offerLines = array_fill_keys(array_keys($offered), 0);
    foreach ($players as $player) {
        $gameId = $teamGameId[$player['club_code']];
        if (isset($offered[$gameId], $lines[(int) $player['id']])) {
            $offerLines[$gameId]++;
        }
    }
    $out = [];
    foreach ($players as $player) {
        $team = $player['club_code'];
        $cutoff = $start[$team];
        $rows = array_filter($byPlayer[$player['code']] ?? [], fn (array $row) => $row['starts_at'] < $cutoff);
        $current = array_filter($rows, fn (array $row) => $row['season'] === $season && (int) $row['seconds'] > 0);
        // Bez ijedne utakmice u sezoni nema forme ni projekcije.
        if (!$current) {
            continue;
        }
        $gp = count($current);
        $avg = fn (string $key) => round(array_sum(array_column($current, $key)) / $gp, 1);

        $currentByGame = [];
        foreach ($rows as $row) {
            if ($row['season'] === $season) {
                $currentByGame[(int) $row['game_code']] = $row;
            }
        }
        $last = [];
        foreach ($teamGames[$team] ?? [] as $game) {
            if ($game['starts_at'] >= $cutoff) {
                continue;
            }
            $row = $currentByGame[(int) $game['game_code']] ?? null;
            $dnp = $row === null || (int) $row['seconds'] === 0;
            $last[] = [
                'round' => (int) $game['round'],
                'opp' => $game['opp'],
                'home' => $game['home'],
                'dnp' => $dnp,
            ] + ($dnp ? ['min' => 0, 'pts' => 0, 'ast' => 0, 'reb' => 0] : formaGameLine($row));
            if (count($last) === FORMA_LAST_GAMES) {
                break;
            }
        }

        $h2h = [];
        foreach ($rows as $row) {
            $opp = $row['team_code'] === $row['home_code'] ? $row['away_code'] : $row['home_code'];
            if ($opp !== $opponent[$team] || (int) $row['seconds'] === 0) {
                continue;
            }
            $h2h[] = [
                'season' => formaSeasonLabel($row['season']),
                'date' => substr($row['starts_at'], 0, 10),
                'home' => $row['team_code'] === $row['home_code'],
            ] + formaGameLine($row);
            if (count($h2h) === FORMA_H2H_GAMES) {
                break;
            }
        }

        $out[] = [
            'id' => (int) $player['id'],
            'name' => $player['name'],
            'pos' => $player['position'] ?: (array_values($current)[0]['position'] ?? null) ?: 'F',
            'team' => $team,
            'opp' => $opponent[$team],
            'home' => $isHome[$team],
            'line' => $lines[(int) $player['id']] ?? null,
            // null: Maxbet još nije uvezen za utakmicu; false: utakmica jeste, igrač nije u ponudi.
            'offer' => isset($offered[$teamGameId[$team]]) ? isset($lines[(int) $player['id']]) : null,
            'season' => [
                'gp' => $gp,
                'pts' => $avg('points'),
                'ast' => $avg('assists'),
                'reb' => $avg('rebounds'),
                'min' => round(array_sum(array_column($current, 'seconds')) / $gp / 60, 1),
            ],
            'last10' => $last,
            'h2h' => $h2h,
        ];
    }

    return $base + [
        'round' => $roundNumber,
        'games' => array_map(fn (array $game) => [
            'id' => (int) $game['id'],
            'startsAt' => str_replace(' ', 'T', substr($game['starts_at'], 0, 16)),
            'home' => $game['home_code'],
            'homeName' => $game['home_name'],
            'away' => $game['away_code'],
            'awayName' => $game['away_name'],
            'played' => (bool) $game['played'],
            // Broj Maxbet granica; null dok uvoz ne donese nijednu za ovu utakmicu.
            'offer' => $offerLines[(int) $game['id']] ?? null,
        ], $games),
        'players' => $out,
        'defense' => (object) ($games ? formaDefense($db, $season, min(array_column($games, 'starts_at'))) : []),
        'double' => formaDoubleTeams($db, $season, $games),
    ];
}

/* ---------- Granice ---------- */

// Granica upisana u Formi za igrača u kolu; null ako je nema (ili baza još nema tabelu).
function formaLineFor(PDO $db, int $round, ?int $playerId): ?string
{
    if ($playerId === null) {
        return null;
    }
    try {
        $stmt = $db->prepare('SELECT line FROM forma_lines WHERE season = ? AND round = ? AND player_id = ?');
        $stmt->execute([currentSeasonCode(), $round, $playerId]);
        $line = $stmt->fetchColumn();
        return $line === false ? null : (string) $line;
    } catch (PDOException $e) {
        error_log($e->getMessage());
        return null;
    }
}

// Granica upisana na tiketu važi i u Formi (i obrnuto), da se kuca samo jednom.
function formaRememberLine(PDO $db, int $round, ?int $playerId, ?string $line): void
{
    if ($playerId === null) {
        return;
    }
    try {
        if ($line === null) {
            $db->prepare('DELETE FROM forma_lines WHERE season = ? AND round = ? AND player_id = ?')
                ->execute([currentSeasonCode(), $round, $playerId]);
            return;
        }
        $db->prepare(
            'INSERT INTO forma_lines (season, round, player_id, line, updated_at) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE line = VALUES(line), updated_at = VALUES(updated_at)'
        )->execute([currentSeasonCode(), $round, $playerId, $line, date('Y-m-d H:i:s')]);
    } catch (PDOException $e) {
        error_log($e->getMessage());
    }
}

function formaRoundNumber(mixed $value): int
{
    $round = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 999]]);
    return $round === false ? fail(422, 'Nedostaje kolo.') : $round;
}

// Šta bi nova granica uradila tiketima igrača u kolu: [pickId => nova granica].
// Tiket zaključanog dana zadržava granicu koja je odigrana; prazna granica se i tada popunjava.
// Brisanje (null) skida samo granicu jednaku staroj iz Forme.
function formaPickChanges(array $picks, array $schedule, ?string $line, ?string $old): array
{
    $changes = [];
    foreach ($picks as $pick) {
        $current = $pick['line'] === null ? null : (float) $pick['line'];
        $day = scheduleDayOfGame($schedule, $pick['game_id'] === null ? null : (int) $pick['game_id']);
        if ($current !== null && $day !== null && $day['locked']) {
            continue;
        }
        $target = $line !== null ? (float) $line : ($old !== null && $current === (float) $old ? null : $current);
        if ($target !== $current) {
            $changes[(int) $pick['id']] = ['line' => $line, 'round_id' => (int) $pick['round_id']];
        }
    }
    return $changes;
}

// Igrači na tiketima kola: [playerId => [pick, ...]].
function formaRoundPicks(PDO $db, int $round): array
{
    $stmt = $db->prepare(
        'SELECT p.id, p.round_id, p.player_id, p.game_id, p.line FROM picks p JOIN rounds r ON r.id = p.round_id
         WHERE r.number = ? AND p.player_id IS NOT NULL'
    );
    $stmt->execute([$round]);
    $byPlayer = [];
    foreach ($stmt as $pick) {
        $byPlayer[(int) $pick['player_id']][] = $pick;
    }
    return $byPlayer;
}

// Upisuje granicu u Formu i na tikete kola. Vraća koliko je tiketa dobilo novu granicu.
// Poziva se unutar transakcije; autoGradeRound ide poslije, po kolima iz $changedRounds.
function formaApplyLine(PDO $db, int $round, int $playerId, ?string $line, array $picks, array $schedule, array &$changedRounds): int
{
    $old = formaLineFor($db, $round, $playerId);
    formaRememberLine($db, $round, $playerId, $line);
    $update = $db->prepare('UPDATE picks SET line = ? WHERE id = ?');
    $changes = formaPickChanges($picks, $schedule, $line, $old);
    foreach ($changes as $pickId => $change) {
        $update->execute([$change['line'], $pickId]);
        $changedRounds[$change['round_id']] = true;
    }
    return count($changes);
}

// Admin upisuje granicu u Formi: {"round": 12, "playerId": 40, "line": "15.5" | null}.
function formaSaveLine(PDO $db, array $body): array
{
    $round = formaRoundNumber($body['round'] ?? null);
    $player = findPlayerById($db, $body['playerId'] ?? null);
    $line = parseLine($body['line'] ?? null);
    $picks = formaRoundPicks($db, $round)[$player['id']] ?? [];
    $schedule = roundSchedule($db, $round);

    $db->beginTransaction();
    $changedRounds = [];
    formaApplyLine($db, $round, $player['id'], $line, $picks, $schedule, $changedRounds);
    foreach (array_keys($changedRounds) as $roundId) {
        autoGradeRound($db, $roundId);
    }
    $db->commit();
    return ['playerId' => $player['id'], 'line' => $line === null ? null : (float) $line];
}

/* ---------- Ponuda Maxbeta ---------- */

// Utakmice kola za koje je uvoz sa Maxbeta donio granice: [gameId => true].
// Prazno i dok migracija 015 nije pokrenuta, pa sve radi kao prije.
function formaOfferedGames(PDO $db, int $round): array
{
    try {
        $stmt = $db->prepare('SELECT game_id FROM forma_offers WHERE season = ? AND round = ?');
        $stmt->execute([currentSeasonCode(), $round]);
        return array_fill_keys(array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN)), true);
    } catch (PDOException $e) {
        error_log($e->getMessage());
        return [];
    }
}

// Igrači koji nisu u ponudi: iz utakmice sa uvezenim granicama, a bez granice. [playerId => gameId].
function formaUnavailable(PDO $db, int $round): array
{
    $offered = formaOfferedGames($db, $round);
    if (!$offered) {
        return [];
    }
    $ids = array_keys($offered);
    $stmt = $db->prepare('SELECT id, home_code, away_code FROM games WHERE id IN (' . formaPlaceholders($ids) . ')');
    $stmt->execute($ids);
    $teamGame = [];
    foreach ($stmt as $game) {
        $teamGame[$game['home_code']] = (int) $game['id'];
        $teamGame[$game['away_code']] = (int) $game['id'];
    }
    if (!$teamGame) {
        return [];
    }
    $teams = array_keys($teamGame);
    $stmt = $db->prepare('SELECT id, club_code FROM players WHERE active = 1 AND club_code IN (' . formaPlaceholders($teams) . ')');
    $stmt->execute($teams);
    $lines = formaRoundLines($db, currentSeasonCode(), $round);
    $out = [];
    foreach ($stmt as $player) {
        if (!isset($lines[(int) $player['id']])) {
            $out[(int) $player['id']] = $teamGame[$player['club_code']];
        }
    }
    return $out;
}

// Da li se igrač može dodati na tiket: jeste dok Maxbet nije uvezen za njegovu utakmicu, ili ako ima granicu.
function formaIsOffered(PDO $db, int $round, int $playerId, ?int $gameId): bool
{
    if ($gameId === null || !isset(formaOfferedGames($db, $round)[$gameId])) {
        return true;
    }
    return isset(formaRoundLines($db, currentSeasonCode(), $round)[$playerId]);
}

/* ---------- Uvoz sa Maxbeta ---------- */

const FORMA_IMPORT_MAX_ROWS = 400;
const FORMA_NAME_SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

// Maxbet piše "E. Tavares", "Jimmy Clark III", "Dzanan Musa". Prvo isto pravilo kao kod upisa
// na tiket (i nadimci), pa bez sufiksa, pa inicijal + prezime među igračima kola.
// Vraća [player|null, prijedlozi].
function formaMatchMaxbetName(array $index, array $roundPlayers, string $name): array
{
    $found = matchPlayer($index, $name);
    if ($found !== null) {
        return [$found['id'], []];
    }
    $words = array_values(array_filter(
        explode(' ', normalizePlayerName($name)),
        fn (string $word) => $word !== '' && !in_array($word, FORMA_NAME_SUFFIXES, true)
    ));
    if (!$words) {
        return [null, []];
    }
    $found = matchPlayer($index, implode(' ', $words));
    if ($found !== null) {
        return [$found['id'], []];
    }
    $full = array_values(array_filter($words, fn (string $word) => strlen($word) > 1));
    $initials = array_values(array_filter($words, fn (string $word) => strlen($word) === 1));
    $fits = fn (array $p) => !array_diff($full, $p['tokens'])
        && !array_filter($initials, fn (string $i) => !array_filter($p['tokens'], fn (string $t) => str_starts_with($t, $i)));
    $candidates = array_values(array_filter($roundPlayers, $fits));
    if ($full && count($candidates) === 1) {
        return [$candidates[0]['id'], []];
    }
    // Prijedlozi: isto ili slično prezime (najduža riječ) među igračima kola.
    usort($full, fn (string $a, string $b) => strlen($b) - strlen($a));
    $surname = $full[0] ?? $words[0];
    $suggestions = array_filter($roundPlayers, fn (array $p) => (bool) array_filter(
        $p['tokens'],
        fn (string $t) => $t === $surname || (strlen($t) > 3 && levenshtein($t, $surname) <= 2)
    ));
    return [null, array_slice(array_column($suggestions, 'id'), 0, 5)];
}

// Pregled uvoza: {"round": 13, "rows": [{"n": "Bonzie Colson", "t": "Maccabi T.A.", "d": "19.11 18:15", "l": "9.5"}]}.
// Ništa ne upisuje; status svakog reda je new, chg, same, chk (nije prepoznat) ili out (ne igra u kolu).
function formaMaxbetPreview(PDO $db, array $body): array
{
    $round = formaRoundNumber($body['round'] ?? null);
    $rows = is_array($body['rows'] ?? null) ? array_slice($body['rows'], 0, FORMA_IMPORT_MAX_ROWS) : [];
    $season = currentSeasonCode();

    $stmt = $db->prepare('SELECT id, starts_at, home_code, away_code FROM games WHERE season = ? AND round = ?');
    $stmt->execute([$season, $round]);
    $teamGame = [];
    foreach ($stmt as $game) {
        $teamGame[$game['home_code']] = $game;
        $teamGame[$game['away_code']] = $game;
    }
    $players = [];
    $roundPlayers = [];
    foreach ($db->query('SELECT id, name, club_code, position, active FROM players') as $row) {
        $players[(int) $row['id']] = $row;
        if ($row['active'] && isset($teamGame[$row['club_code']])) {
            $roundPlayers[] = ['id' => (int) $row['id'], 'tokens' => explode(' ', normalizePlayerName($row['name']))];
        }
    }
    $publicPlayer = fn (int $id) => [
        'id' => $id,
        'name' => $players[$id]['name'],
        'pos' => $players[$id]['position'] ?: 'F',
        'team' => $players[$id]['club_code'],
    ];
    $index = playerIndex($db);
    $lines = formaRoundLines($db, $season, $round);
    $picks = formaRoundPicks($db, $round);
    $schedule = roundSchedule($db, $round);

    $out = [];
    $seen = [];
    foreach ($rows as $i => $row) {
        $name = mb_substr(trim((string) ($row['n'] ?? '')), 0, 60);
        $line = str_replace(',', '.', trim((string) ($row['l'] ?? '')));
        if ($name === '' || !preg_match('/^\d{1,2}\.5$/', $line)) {
            continue;
        }
        [$playerId, $suggestions] = formaMatchMaxbetName($index, $roundPlayers, $name);
        $entry = [
            'key' => $i,
            'name' => $name,
            'team' => mb_substr(trim((string) ($row['t'] ?? '')), 0, 60),
            'date' => mb_substr(trim((string) ($row['d'] ?? '')), 0, 20),
            'line' => (float) $line,
            'player' => $playerId === null ? null : $publicPlayer($playerId),
            'suggestions' => array_map($publicPlayer, $suggestions),
            'old' => null,
            'tickets' => 0,
            'out' => null,
            'gameId' => null,
        ];
        if ($playerId === null) {
            $entry['status'] = 'chk';
            $out[] = $entry;
            continue;
        }
        $game = $teamGame[$players[$playerId]['club_code']] ?? null;
        // Maxbet datum "19.11 18:15": utakmica iz drugog kola ima drugi dan.
        $maxbetDay = preg_match('/^(\d{1,2})\.(\d{1,2})/', $entry['date'], $m) ? (int) $m[1] . '.' . (int) $m[2] : null;
        $gameDay = $game ? date('j.n', strtotime($game['starts_at'])) : null;
        if ($game === null || isset($seen[$playerId]) || ($maxbetDay !== null && $maxbetDay !== $gameDay)) {
            $entry['status'] = 'out';
            $entry['out'] = $game === null ? "ne igra u kolu {$round}" : ($maxbetDay !== null && $maxbetDay !== $gameDay ? "igra {$maxbetDay}." : 'već je u listi');
            $out[] = $entry;
            continue;
        }
        $seen[$playerId] = true;
        $entry['gameId'] = (int) $game['id'];
        $entry['old'] = $lines[$playerId] ?? null;
        $entry['status'] = $entry['old'] === null ? 'new' : ($entry['old'] === $entry['line'] ? 'same' : 'chg');
        $entry['tickets'] = count(formaPickChanges($picks[$playerId] ?? [], $schedule, $line, null));
        $out[] = $entry;
    }
    return ['round' => $round, 'rows' => $out];
}

// Čuvanje uvoza: {"round": 13, "lines": [{"playerId": 40, "line": "9.5", "alias": "E. Tavares"}]}.
// alias: ime kako ga piše Maxbet, kad ga je admin sam povezao; sljedeći put se prepoznaje odmah.
function formaSaveImport(PDO $db, array $body): array
{
    $round = formaRoundNumber($body['round'] ?? null);
    $items = is_array($body['lines'] ?? null) ? array_slice($body['lines'], 0, FORMA_IMPORT_MAX_ROWS) : [];
    $picks = formaRoundPicks($db, $round);
    $schedule = roundSchedule($db, $round);
    $aliasExists = $db->prepare('SELECT 1 FROM player_aliases WHERE normalized = ?');
    $aliasInsert = $db->prepare('INSERT INTO player_aliases (player_id, alias, normalized, created_at) VALUES (?, ?, ?, ?)');
    $season = currentSeasonCode();
    $stmt = $db->prepare('SELECT id, home_code, away_code FROM games WHERE season = ? AND round = ?');
    $stmt->execute([$season, $round]);
    $teamGame = [];
    foreach ($stmt as $game) {
        $teamGame[$game['home_code']] = (int) $game['id'];
        $teamGame[$game['away_code']] = (int) $game['id'];
    }
    $clubOf = $db->prepare('SELECT club_code FROM players WHERE id = ?');

    $db->beginTransaction();
    $saved = 0;
    $tickets = 0;
    $changedRounds = [];
    $games = [];
    foreach ($items as $item) {
        $player = findPlayerById($db, $item['playerId'] ?? null);
        $line = parseLine($item['line'] ?? null);
        if ($line === null) {
            continue;
        }
        $tickets += formaApplyLine($db, $round, $player['id'], $line, $picks[$player['id']] ?? [], $schedule, $changedRounds);
        $saved++;
        $clubOf->execute([$player['id']]);
        $gameId = $teamGame[$clubOf->fetchColumn()] ?? null;
        if ($gameId !== null) {
            $games[$gameId] = true;
        }
        $alias = mb_substr(normalizeName($item['alias'] ?? ''), 0, 60);
        $normalized = normalizePlayerName($alias);
        if ($normalized !== '') {
            $aliasExists->execute([$normalized]);
            if (!$aliasExists->fetchColumn()) {
                $aliasInsert->execute([$player['id'], $alias, $normalized, date('Y-m-d H:i:s')]);
            }
        }
    }
    // Utakmice sa bar jednom granicom ulaze u ponudu: ostali igrači iz njih nisu u ponudi.
    try {
        $offer = $db->prepare(
            'INSERT INTO forma_offers (game_id, season, round, imported_at) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE imported_at = VALUES(imported_at)'
        );
        foreach (array_keys($games) as $gameId) {
            $offer->execute([$gameId, $season, $round, date('Y-m-d H:i:s')]);
        }
    } catch (PDOException $e) {
        $db->rollBack();
        if ($e->getCode() === '42S02') {
            fail(503, 'Pokreni api/migrations/015_maxbet_ponuda.sql nad bazom, pa sačuvaj ponovo.');
        }
        throw $e;
    }
    foreach (array_keys($changedRounds) as $roundId) {
        autoGradeRound($db, $roundId);
    }
    $db->commit();
    $out = array_filter(formaUnavailable($db, $round), fn (int $gameId) => isset($games[$gameId]));
    return ['saved' => $saved, 'tickets' => $tickets, 'games' => count($games), 'out' => count($out)];
}

function handleFormaRoute(PDO $db, array $user, string $method, string $route): void
{
    if ($route === '/forma' && $method === 'GET') {
        syncSafely($db);
        $round = filter_var($_GET['round'] ?? null, FILTER_VALIDATE_INT);
        try {
            respond(200, formaPayload($db, $user, $round === false ? null : $round));
        } catch (PDOException $e) {
            // 42S02: tabela ne postoji.
            if ($e->getCode() === '42S02') {
                fail(503, 'Forma još nije uključena: pokreni api/migrations/014_forma.sql nad bazom.');
            }
            throw $e;
        }
    }
    if ($route === '/forma/lines' && $method === 'PUT') {
        if ($user['role'] !== 'admin') {
            fail(403, 'Granice upisuje samo admin.');
        }
        respond(200, formaSaveLine($db, readJson()));
    }
    if ($route === '/forma/maxbet' && $method === 'POST') {
        if ($user['role'] !== 'admin') {
            fail(403, 'Granice uvozi samo admin.');
        }
        respond(200, formaMaxbetPreview($db, readJson()));
    }
    if ($route === '/forma/maxbet/save' && $method === 'POST') {
        if ($user['role'] !== 'admin') {
            fail(403, 'Granice uvozi samo admin.');
        }
        respond(200, formaSaveImport($db, readJson()));
    }
}
