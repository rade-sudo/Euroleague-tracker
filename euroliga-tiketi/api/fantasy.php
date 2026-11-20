<?php

declare(strict_types=1);

// Fantasy liga: draft za cijelu sezonu, ekipa od 8 igrača (3 G, 3 F, 2 C), svako kolo petorka
// 2 G + 2 F + 1 C. Bodovi su PIR sa Euroleague zapisnika: kapiten ×2, vicekapiten ×1,5.
// Nema veze sa tiketima: isti igrač može biti i na tiketu i u nečijoj ekipi.
const FANTASY_NEED = ['G' => 3, 'F' => 3, 'C' => 2];
const FANTASY_STARTERS = ['G' => 2, 'F' => 2, 'C' => 1];
const FANTASY_ROSTER = 8;
const FANTASY_POSITION_NAMES = ['Guard' => 'G', 'Forward' => 'F', 'Center' => 'C'];
const FANTASY_PICK_SECONDS = [60, 90, 120];
const FANTASY_START_ROUNDS = [6, 7];
const FANTASY_SPLITS = ['100' => [100], '70/30' => [70, 30], '60/30/10' => [60, 30, 10]];
// Zahtjevi za izmjene se obrađuju 3 sata prije roka kola, po redu prednosti.
const FANTASY_TRANSFER_HOURS = 3;
const FANTASY_STATS_MINUTES = 2;
const FANTASY_POSITIONS_MINUTES = 24 * 60;
const FANTASY_FORM_ROUNDS = 4;
const FANTASY_DEFAULTS = [
    'fantasy_start_round' => '7',
    'fantasy_mode' => 'trial',
    'fantasy_draft_at' => '',
    'fantasy_pick_seconds' => '90',
    'fantasy_fund_per_round' => '5',
    'fantasy_split' => '60/30/10',
    'fantasy_triple' => '1',
    'fantasy_trades' => '1',
    // Do kraja regularnog dijela.
    'fantasy_last_round' => '38',
    'fantasy_draft_status' => 'waiting',
    'fantasy_draft_order' => '',
    'fantasy_draft_started_at' => '',
    'fantasy_draft_done_at' => '',
    'fantasy_pick_started_at' => '',
    'fantasy_pick_remaining' => '',
];
const FANTASY_DRAFT_STATUSES = ['waiting', 'live', 'paused', 'done'];

function fantasySettings(PDO $db): array
{
    $raw = FANTASY_DEFAULTS;
    foreach ($db->query("SELECT name, value FROM settings WHERE name LIKE 'fantasy\\_%'") as $row) {
        if (array_key_exists($row['name'], $raw)) {
            $raw[$row['name']] = $row['value'];
        }
    }
    return [
        'startRound' => (int) $raw['fantasy_start_round'],
        'mode' => $raw['fantasy_mode'] === 'live' ? 'live' : 'trial',
        'draftAt' => $raw['fantasy_draft_at'] === '' ? null : $raw['fantasy_draft_at'],
        'pickSeconds' => (int) $raw['fantasy_pick_seconds'] ?: 90,
        'fundPerRound' => (float) $raw['fantasy_fund_per_round'],
        'split' => isset(FANTASY_SPLITS[$raw['fantasy_split']]) ? $raw['fantasy_split'] : '60/30/10',
        'triple' => $raw['fantasy_triple'] === '1',
        'trades' => $raw['fantasy_trades'] === '1',
        'lastRound' => (int) $raw['fantasy_last_round'],
        'draftStatus' => in_array($raw['fantasy_draft_status'], FANTASY_DRAFT_STATUSES, true) ? $raw['fantasy_draft_status'] : 'waiting',
        'order' => $raw['fantasy_draft_order'] === '' ? [] : array_map('intval', explode(',', $raw['fantasy_draft_order'])),
        'draftStartedAt' => $raw['fantasy_draft_started_at'],
        'draftDoneAt' => $raw['fantasy_draft_done_at'],
        'pickStartedAt' => (float) $raw['fantasy_pick_started_at'],
        'pickRemaining' => (int) $raw['fantasy_pick_remaining'],
    ];
}

function fantasyFriends(PDO $db): array
{
    return array_map(fn (array $row) => ['id' => (int) $row['id'], 'name' => $row['name']], $db->query('SELECT id, name FROM friends ORDER BY id')->fetchAll());
}

// Redoslijed iz bubnja; dok nije izvučen (ili se spisak drugara promijenio), drugari redom.
function fantasyOrder(PDO $db, array $s): array
{
    $ids = array_column(fantasyFriends($db), 'id');
    $order = $s['order'];
    $sorted = $order;
    sort($sorted);
    return $sorted === $ids ? $order : $ids;
}

// Zmija: 1. krug 1→6, 2. krug 6→1, i tako redom. $no počinje od 1.
function fantasyDraftOwner(array $order, int $no): int
{
    $n = count($order);
    $round = intdiv($no - 1, $n);
    $k = ($no - 1) % $n;
    return $order[$round % 2 === 0 ? $k : $n - 1 - $k];
}

function fantasyCounts(array $s, int $round): bool
{
    return $round <= $s['lastRound'] && ($s['mode'] === 'trial' || $round >= $s['startRound']);
}

function fantasyIsDuplicate(PDOException $e): bool
{
    return ($e->errorInfo[1] ?? null) === 1062;
}

// Kola sezone: prva utakmica, rok (30 minuta prije prve, kao tiketi) i da li je PIR konačan.
function fantasyRoundTimes(PDO $db, string $season): array
{
    $stmt = $db->prepare(
        'SELECT round, MIN(starts_at) AS first, MAX(starts_at) AS last, MIN(stats_final) AS final
         FROM games WHERE season = ? GROUP BY round ORDER BY round'
    );
    $stmt->execute([$season]);
    $times = [];
    foreach ($stmt as $row) {
        $first = strtotime($row['first']);
        $times[(int) $row['round']] = [
            'first' => $first,
            'deadline' => $first - LOCK_MINUTES_BEFORE_GAME * 60,
            'last' => strtotime($row['last']),
            'final' => (bool) $row['final'],
        ];
    }
    return $times;
}

// Prvo kolo lige kojem rok još nije prošao: za njega se pravi postava i rade izmjene.
function fantasyNextRound(array $s, array $times): ?int
{
    $now = time();
    foreach ($times as $round => $t) {
        if (fantasyCounts($s, $round) && $t['deadline'] > $now) {
            return $round;
        }
    }
    return null;
}

/* ---------- Igrači ---------- */

// Igrači sa pozicijom, sa prosjekom PIR-a iz završenih utakmica i formom (PIR u posljednja 4 kola).
function fantasyPlayerPool(PDO $db, string $season): array
{
    $stmt = $db->prepare(
        'SELECT round FROM games WHERE season = ? GROUP BY round HAVING MIN(stats_final) = 1 ORDER BY round DESC LIMIT ' . FANTASY_FORM_ROUNDS
    );
    $stmt->execute([$season]);
    $formRounds = array_reverse(array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN)));

    $stmt = $db->prepare(
        'SELECT s.player_code, g.round, SUM(s.pir) AS pir, SUM(s.seconds) AS seconds
         FROM fantasy_stats s JOIN games g ON g.id = s.game_id
         WHERE g.season = ? AND g.stats_final = 1 GROUP BY s.player_code, g.round'
    );
    $stmt->execute([$season]);
    $played = [];
    foreach ($stmt as $row) {
        if ((int) $row['seconds'] > 0) {
            $played[$row['player_code']][(int) $row['round']] = (int) $row['pir'];
        }
    }

    $owners = $db->query('SELECT player_id, friend_id FROM fantasy_roster')->fetchAll(PDO::FETCH_KEY_PAIR);
    $pool = [];
    foreach ($db->query('SELECT id, code, name, club_code, club_name, position, active FROM players WHERE position IS NOT NULL') as $row) {
        $id = (int) $row['id'];
        if (!$row['active'] && !isset($owners[$id])) {
            continue;
        }
        $rounds = $played[$row['code']] ?? [];
        $pool[$id] = [
            'id' => $id,
            'code' => $row['code'],
            'name' => $row['name'],
            'club' => $row['club_name'],
            'clubCode' => $row['club_code'],
            'pos' => $row['position'],
            'games' => count($rounds),
            'avg' => $rounds ? round(array_sum($rounds) / count($rounds), 1) : 0.0,
            'form' => array_map(fn (int $round) => $rounds[$round] ?? null, $formRounds),
            'owner' => isset($owners[$id]) ? (int) $owners[$id] : null,
        ];
    }
    uasort($pool, fn (array $a, array $b) => ($b['avg'] <=> $a['avg']) ?: ($b['games'] <=> $a['games']) ?: strcmp($a['name'], $b['name']));
    return ['players' => $pool, 'formRounds' => $formRounds];
}

// Pozicije sa spiska igrača (Guard / Forward / Center). Igrača kojeg je admin ispravio ne dira.
function fantasyUpdatePositions(PDO $db, array $entries): void
{
    $update = $db->prepare('UPDATE players SET position = ? WHERE code = ? AND position_fixed = 0');
    foreach ($entries as $entry) {
        $pos = FANTASY_POSITION_NAMES[$entry['positionName'] ?? ''] ?? null;
        $code = (string) ($entry['person']['code'] ?? '');
        if ($pos !== null && $code !== '' && ($entry['type'] ?? '') === 'J') {
            $update->execute([$pos, $code]);
        }
    }
}

function fantasyPositionOf(array $entry): ?string
{
    return FANTASY_POSITION_NAMES[$entry['positionName'] ?? ''] ?? null;
}

/* ---------- PIR sa zapisnika ---------- */

// Zapisnici utakmica koje su počele: tokom utakmice PIR uživo, posle kraja konačan.
// Najduže neprovjerene idu prve, pa se cijela sezona popuni za par prolaza crona.
function fantasyFetchStats(PDO $db, string $season): void
{
    $limit = PHP_SAPI === 'cli' ? 12 : 4;
    $stmt = $db->prepare(
        "SELECT id, game_code, played, starts_at FROM games
         WHERE season = ? AND stats_final = 0 AND starts_at <= ?
         ORDER BY COALESCE(stats_checked_at, '2000-01-01'), starts_at LIMIT {$limit}"
    );
    $stmt->execute([$season, date('Y-m-d H:i:s')]);
    $upsert = $db->prepare(
        'INSERT INTO fantasy_stats (game_id, player_code, pir, seconds) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE pir = VALUES(pir), seconds = VALUES(seconds)'
    );
    $mark = $db->prepare('UPDATE games SET stats_final = ?, stats_checked_at = ? WHERE id = ?');
    foreach ($stmt->fetchAll() as $game) {
        $box = fetchJson(sprintf(EUROLEAGUE_BOXSCORE_URL, $season, (int) $game['game_code']), 15);
        $lines = [];
        foreach (['local', 'road'] as $side) {
            foreach ((array) ($box[$side]['players'] ?? []) as $entry) {
                $code = (string) ($entry['player']['person']['code'] ?? '');
                if ($code !== '') {
                    $lines[$code] = [(int) ($entry['stats']['valuation'] ?? 0), max(0, min(65535, (int) ($entry['stats']['timePlayed'] ?? 0)))];
                }
            }
        }
        $anyPlayed = (bool) array_filter($lines, fn (array $line) => $line[1] > 0);
        foreach ($anyPlayed ? $lines : [] as $code => [$pir, $seconds]) {
            $upsert->execute([$game['id'], $code, max(-999, min(999, $pir)), $seconds]);
        }
        // Gotova utakmica bez zapisnika pola dana posle početka: ne traži se više.
        $final = $game['played'] && ($anyPlayed || strtotime($game['starts_at']) < time() - 12 * 3600);
        $mark->execute([(int) $final, date('Y-m-d H:i:s'), $game['id']]);
    }
}

// Utakmice i PIR jednog kola: ['games' => [id => game], 'byCode' => [code => [game, pir, seconds]], 'final'].
function fantasyRoundStats(PDO $db, string $season, int $round): array
{
    $stmt = $db->prepare('SELECT id, home_code, away_code, starts_at, stats_final FROM games WHERE season = ? AND round = ?');
    $stmt->execute([$season, $round]);
    $games = [];
    foreach ($stmt as $row) {
        $games[(int) $row['id']] = $row + ['start' => strtotime($row['starts_at'])];
    }
    $stmt = $db->prepare(
        'SELECT s.game_id, s.player_code, s.pir, s.seconds FROM fantasy_stats s JOIN games g ON g.id = s.game_id
         WHERE g.season = ? AND g.round = ?'
    );
    $stmt->execute([$season, $round]);
    $byCode = [];
    foreach ($stmt as $row) {
        $byCode[$row['player_code']] = ['game' => (int) $row['game_id'], 'pir' => (int) $row['pir'], 'seconds' => (int) $row['seconds']];
    }
    $final = $games && !array_filter($games, fn (array $g) => !$g['stats_final']);
    return ['games' => $games, 'byCode' => $byCode, 'final' => $final];
}

// Stanje igrača u kolu: pending (utakmica nije počela), live (igra se), played, dnp (nije igrao).
function fantasyPlayerState(array $player, array $rs, int $now): array
{
    $entry = $rs['byCode'][$player['code']] ?? null;
    $game = $entry ? ($rs['games'][$entry['game']] ?? null) : null;
    if ($game === null) {
        foreach ($rs['games'] as $g) {
            if (in_array($player['club_code'], [$g['home_code'], $g['away_code']], true)) {
                $game = $g;
            }
        }
    }
    if ($game === null) {
        return ['state' => $rs['final'] ? 'dnp' : 'pending', 'pir' => null];
    }
    if ($game['start'] > $now) {
        return ['state' => 'pending', 'pir' => null];
    }
    $playedNow = $entry !== null && $entry['seconds'] > 0;
    if ($game['stats_final']) {
        return $playedNow ? ['state' => 'played', 'pir' => $entry['pir']] : ['state' => 'dnp', 'pir' => null];
    }
    return ['state' => 'live', 'pir' => $playedNow ? $entry['pir'] : null];
}

// Bodovi postave u kolu. Ko iz petorke ne igra, mijenja ga prvi sa klupe iste pozicije (×1).
// Kapiten ×2 (trostruki ×3); vice ×1,5, a ×2 ako kapiten ne igra.
// $lineup: [['player_id', 'pos', 'starter', 'role', 'code', 'club_code']].
function fantasyScoreLineup(array $lineup, array $rs, bool $triple, int $now): array
{
    $states = [];
    foreach ($lineup as $p) {
        $states[(int) $p['player_id']] = fantasyPlayerState($p, $rs, $now);
    }
    $order = fn (array $a, array $b) => strpos('GFC', $a['pos']) <=> strpos('GFC', $b['pos']);
    $starters = array_values(array_filter($lineup, fn (array $p) => (bool) $p['starter']));
    $bench = array_values(array_filter($lineup, fn (array $p) => !$p['starter']));
    usort($starters, $order);
    usort($bench, $order);
    $captain = null;
    foreach ($starters as $p) {
        if ($p['role'] === 'captain') {
            $captain = (int) $p['player_id'];
        }
    }
    $captainOut = $captain !== null && $states[$captain]['state'] === 'dnp';

    $used = [];
    $rows = [];
    $total = 0.0;
    foreach ($starters as $p) {
        $id = (int) $p['player_id'];
        $sub = null;
        if ($states[$id]['state'] === 'dnp') {
            foreach ($bench as $b) {
                $bid = (int) $b['player_id'];
                if ($b['pos'] === $p['pos'] && !isset($used[$bid]) && $states[$bid]['state'] !== 'dnp') {
                    $sub = $bid;
                    $used[$bid] = true;
                    break;
                }
            }
        }
        $effective = $states[$sub ?? $id];
        $mult = 1.0;
        $role = '';
        if ($sub === null && $states[$id]['state'] !== 'dnp') {
            if ($p['role'] === 'captain') {
                $mult = $triple ? 3.0 : 2.0;
                $role = 'captain';
            } elseif ($p['role'] === 'vice') {
                $mult = $captainOut ? 2.0 : 1.5;
                $role = 'vice';
            }
        }
        $points = ($effective['pir'] ?? 0) * $mult;
        $total += $points;
        $rows[] = [
            'playerId' => $id,
            'pos' => $p['pos'],
            'state' => $states[$id]['state'],
            'pir' => $states[$id]['pir'],
            'sub' => $sub,
            'subState' => $sub === null ? null : $effective['state'],
            'subPir' => $sub === null ? null : $effective['pir'],
            'role' => $role,
            'captainRole' => $p['role'],
            'mult' => $mult,
            'points' => $points,
        ];
    }
    return ['rows' => $rows, 'bench' => array_map(fn (array $b) => (int) $b['player_id'], $bench), 'total' => $total];
}

function fantasyRosterLineup(PDO $db, int $friendId): array
{
    $stmt = $db->prepare(
        'SELECT r.player_id, p.position AS pos, r.starter, r.role, p.code, p.club_code
         FROM fantasy_roster r JOIN players p ON p.id = r.player_id WHERE r.friend_id = ?'
    );
    $stmt->execute([$friendId]);
    return $stmt->fetchAll();
}

// Bodovi svih zaključanih kola lige: [round => ['final', 'live', 'points' => [fid => x], 'rows' => [fid => ...]]].
function fantasyScores(PDO $db, string $season, array $s, array $times): array
{
    $triples = array_map('intval', $db->query('SELECT friend_id, round FROM fantasy_triple')->fetchAll(PDO::FETCH_KEY_PAIR));
    $byRound = [];
    foreach ($db->query(
        'SELECT l.round, l.friend_id, l.player_id, l.pos, l.starter, l.role, p.code, p.club_code
         FROM fantasy_lineups l JOIN players p ON p.id = l.player_id ORDER BY l.round'
    ) as $row) {
        $byRound[(int) $row['round']][(int) $row['friend_id']][] = $row;
    }
    $now = time();
    $scores = [];
    foreach ($byRound as $round => $teams) {
        if (!fantasyCounts($s, $round)) {
            continue;
        }
        $rs = fantasyRoundStats($db, $season, $round);
        $entry = ['round' => $round, 'final' => $rs['final'], 'live' => !$rs['final'] && ($times[$round]['first'] ?? PHP_INT_MAX) <= $now, 'points' => [], 'rows' => [], 'bench' => []];
        foreach ($teams as $friendId => $lineup) {
            $score = fantasyScoreLineup($lineup, $rs, ($triples[$friendId] ?? null) === $round, $now);
            $entry['points'][$friendId] = $score['total'];
            $entry['rows'][$friendId] = $score['rows'];
            $entry['bench'][$friendId] = $score['bench'];
        }
        $entry['winners'] = [];
        if ($entry['final'] && $entry['points']) {
            $best = max($entry['points']);
            $entry['winners'] = array_keys(array_filter($entry['points'], fn (float $p) => $p === $best));
        }
        $scores[$round] = $entry;
    }
    return $scores;
}

// Tabela: zbir svih kola, pa broj osvojenih kola.
function fantasyStandings(array $friends, array $scores): array
{
    $rows = [];
    foreach ($friends as $friend) {
        $rows[$friend['id']] = ['friendId' => $friend['id'], 'total' => 0.0, 'wins' => 0, 'rounds' => []];
    }
    foreach ($scores as $round => $entry) {
        foreach ($entry['points'] as $friendId => $points) {
            if (!isset($rows[$friendId])) {
                continue;
            }
            $rows[$friendId]['total'] += $points;
            $rows[$friendId]['rounds'][$round] = $points;
            if (in_array($friendId, $entry['winners'], true)) {
                $rows[$friendId]['wins']++;
            }
        }
    }
    $rows = array_values($rows);
    usort($rows, fn (array $a, array $b) => ($b['total'] <=> $a['total']) ?: ($b['wins'] <=> $a['wins']));
    return array_map(fn (array $r) => $r + ['rounds' => (object) $r['rounds']], $rows);
}

// Red prednosti za izmjene: posljednji na tabeli prvi; isti broj bodova: kasniji na draftu prvi.
function fantasyPriority(array $order, array $standings): array
{
    $total = array_column($standings, 'total', 'friendId');
    $position = array_flip($order);
    $ids = $order;
    usort($ids, fn (int $a, int $b) => (($total[$a] ?? 0) <=> ($total[$b] ?? 0)) ?: ($position[$b] <=> $position[$a]));
    return $ids;
}

/* ---------- Draft ---------- */

function fantasyNeeds(PDO $db, int $friendId): array
{
    $need = FANTASY_NEED;
    $stmt = $db->prepare('SELECT p.position FROM fantasy_roster r JOIN players p ON p.id = r.player_id WHERE r.friend_id = ?');
    $stmt->execute([$friendId]);
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $pos) {
        if (isset($need[$pos])) {
            $need[$pos]--;
        }
    }
    return $need;
}

function fantasyBestAvailable(PDO $db, int $friendId): ?int
{
    $need = fantasyNeeds($db, $friendId);
    foreach (fantasyPlayerPool($db, currentSeasonCode())['players'] as $player) {
        if ($player['owner'] === null && ($need[$player['pos']] ?? 0) > 0) {
            return $player['id'];
        }
    }
    return null;
}

function fantasyDraftCount(PDO $db): int
{
    return (int) $db->query('SELECT COUNT(*) FROM fantasy_draft_picks')->fetchColumn();
}

// Upisuje izbor i pokreće sat sljedećem. Vraća false ako je neko drugi već izabrao za taj broj.
function fantasyInsertPick(PDO $db, int $no, int $friendId, int $playerId, bool $auto, float $nextStart): bool
{
    $db->beginTransaction();
    try {
        $now = date('Y-m-d H:i:s');
        $db->prepare('INSERT INTO fantasy_draft_picks (pick_no, friend_id, player_id, auto, picked_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$no, $friendId, $playerId, (int) $auto, $now]);
        $db->prepare('INSERT INTO fantasy_roster (player_id, friend_id, acquired_at) VALUES (?, ?, ?)')
            ->execute([$playerId, $friendId, $now]);
        setSetting($db, 'fantasy_pick_started_at', sprintf('%.3f', $nextStart));
        $db->commit();
    } catch (PDOException $e) {
        $db->rollBack();
        if (fantasyIsDuplicate($e)) {
            return false;
        }
        throw $e;
    }
    $s = fantasySettings($db);
    if (fantasyDraftCount($db) >= count(fantasyOrder($db, $s)) * FANTASY_ROSTER) {
        fantasyFinishDraft($db);
    }
    return true;
}

// Kad istekne vrijeme, aplikacija bira najboljeg slobodnog igrača pozicije koja fali.
// Sat sljedećeg kreće od isteka prethodnog. Vraća broj izbora koje je napravila.
function fantasyDraftAdvance(PDO $db): int
{
    $made = 0;
    for ($guard = 0; $guard < 60; $guard++) {
        $s = fantasySettings($db);
        if ($s['draftStatus'] !== 'live') {
            break;
        }
        $order = fantasyOrder($db, $s);
        $count = fantasyDraftCount($db);
        if ($count >= count($order) * FANTASY_ROSTER) {
            fantasyFinishDraft($db);
            break;
        }
        $endsAt = $s['pickStartedAt'] + $s['pickSeconds'];
        if (microtime(true) < $endsAt) {
            break;
        }
        $friendId = fantasyDraftOwner($order, $count + 1);
        $playerId = fantasyBestAvailable($db, $friendId);
        if ($playerId === null || !fantasyInsertPick($db, $count + 1, $friendId, $playerId, true, $endsAt)) {
            break;
        }
        $made++;
    }
    return $made;
}

// Kraj drafta: svako dobija početnu petorku po prosjeku PIR-a, kapiten je najbolji.
function fantasyFinishDraft(PDO $db): void
{
    setSetting($db, 'fantasy_draft_status', 'done');
    setSetting($db, 'fantasy_draft_done_at', date('Y-m-d H:i:s'));
    $pool = fantasyPlayerPool($db, currentSeasonCode())['players'];
    foreach (fantasyFriends($db) as $friend) {
        fantasyDefaultLineup($db, $friend['id'], $pool);
    }
}

function fantasyDefaultLineup(PDO $db, int $friendId, array $pool): void
{
    $stmt = $db->prepare('SELECT player_id FROM fantasy_roster WHERE friend_id = ?');
    $stmt->execute([$friendId]);
    $players = array_values(array_filter(array_map(fn ($id) => $pool[(int) $id] ?? null, $stmt->fetchAll(PDO::FETCH_COLUMN))));
    usort($players, fn (array $a, array $b) => $b['avg'] <=> $a['avg']);
    $left = FANTASY_STARTERS;
    $starters = [];
    foreach ($players as $p) {
        if (($left[$p['pos']] ?? 0) > 0) {
            $left[$p['pos']]--;
            $starters[] = $p['id'];
        }
    }
    $update = $db->prepare('UPDATE fantasy_roster SET starter = ?, role = ? WHERE player_id = ?');
    foreach ($players as $p) {
        $index = array_search($p['id'], $starters, true);
        $update->execute([(int) ($index !== false), $index === 0 ? 'captain' : ($index === 1 ? 'vice' : ''), $p['id']]);
    }
}

/* ---------- Kolo po kolo ---------- */

// U rok kola ekipa se kopira u postavu kola; kasnije izmjene važe od sljedećeg kola.
function fantasySnapshots(PDO $db, array $s, array $times): void
{
    if ($s['draftStatus'] !== 'done' || $s['draftDoneAt'] === '') {
        return;
    }
    $doneAt = strtotime($s['draftDoneAt']);
    $have = array_flip(array_map('intval', $db->query('SELECT DISTINCT round FROM fantasy_lineups')->fetchAll(PDO::FETCH_COLUMN)));
    $now = time();
    foreach ($times as $round => $t) {
        if (!fantasyCounts($s, $round) || isset($have[$round]) || $t['deadline'] > $now || $t['deadline'] <= $doneAt) {
            continue;
        }
        try {
            $db->prepare(
                'INSERT INTO fantasy_lineups (round, friend_id, player_id, pos, starter, role)
                 SELECT ?, r.friend_id, r.player_id, p.position, r.starter, r.role FROM fantasy_roster r JOIN players p ON p.id = r.player_id'
            )->execute([$round]);
        } catch (PDOException $e) {
            if (!fantasyIsDuplicate($e)) {
                throw $e;
            }
        }
    }
}

// Zahtjevi za izmjene, kad dođe vrijeme obrade (3 sata prije roka), redom prednosti.
function fantasyProcessTransfers(PDO $db, string $season, array $s, array $times): void
{
    $now = time();
    $pending = $db->query("SELECT id, friend_id, round, drop_player_id, wishes FROM fantasy_transfers WHERE status = 'pending' ORDER BY id")->fetchAll();
    $due = array_values(array_filter($pending, fn (array $t) => $now >= fantasyProcessAt($times, (int) $t['round'])));
    if (!$due) {
        return;
    }
    $standings = fantasyStandings(fantasyFriends($db), fantasyScores($db, $season, $s, $times));
    $rank = array_flip(fantasyPriority(fantasyOrder($db, $s), $standings));
    usort($due, fn (array $a, array $b) => ($rank[(int) $a['friend_id']] ?? 99) <=> ($rank[(int) $b['friend_id']] ?? 99) ?: $a['id'] <=> $b['id']);

    $finish = $db->prepare('UPDATE fantasy_transfers SET status = ?, got_player_id = ?, processed_at = ? WHERE id = ? AND status = \'pending\'');
    foreach ($due as $transfer) {
        $got = null;
        foreach (array_map('intval', explode(',', $transfer['wishes'])) as $wish) {
            if (fantasyReplacePlayer($db, (int) $transfer['friend_id'], (int) $transfer['drop_player_id'], $wish)) {
                $got = $wish;
                break;
            }
        }
        $finish->execute([$got === null ? 'failed' : 'done', $got, date('Y-m-d H:i:s'), $transfer['id']]);
    }
}

function fantasyProcessAt(array $times, int $round): int
{
    return isset($times[$round]) ? $times[$round]['deadline'] - FANTASY_TRANSFER_HOURS * 3600 : 0;
}

// Pušta svog igrača i uzima slobodnog iste pozicije; novi preuzima mjesto u petorci i ulogu.
function fantasyReplacePlayer(PDO $db, int $friendId, int $dropId, int $newId): bool
{
    $stmt = $db->prepare(
        'SELECT (SELECT position FROM players WHERE id = ?) AS drop_pos, (SELECT position FROM players WHERE id = ?) AS new_pos,
                (SELECT active FROM players WHERE id = ?) AS new_active,
                EXISTS (SELECT 1 FROM fantasy_roster WHERE player_id = ? AND friend_id = ?) AS owns'
    );
    $stmt->execute([$dropId, $newId, $newId, $dropId, $friendId]);
    $row = $stmt->fetch();
    if (!$row['owns'] || $row['drop_pos'] === null || $row['drop_pos'] !== $row['new_pos'] || !$row['new_active']) {
        return false;
    }
    try {
        $db->prepare('UPDATE fantasy_roster SET player_id = ?, acquired_at = ? WHERE player_id = ? AND friend_id = ?')
            ->execute([$newId, date('Y-m-d H:i:s'), $dropId, $friendId]);
    } catch (PDOException $e) {
        if (fantasyIsDuplicate($e)) {
            return false;
        }
        throw $e;
    }
    // Razmjene sa puštenim igračem više ne važe.
    $db->prepare("UPDATE fantasy_trades SET status = 'cancelled', decided_at = ? WHERE status = 'pending' AND ? IN (give_player_id, get_player_id)")
        ->execute([date('Y-m-d H:i:s'), $dropId]);
    return true;
}

// Mreža (pozicije, zapisnici) rijetko; draft, postave kola i izmjene pri svakom pozivu.
function syncFantasy(PDO $db, string $season): void
{
    if (minutesSince($db, 'fantasy_positions_at') >= FANTASY_POSITIONS_MINUTES) {
        setSetting($db, 'fantasy_positions_at', date('Y-m-d H:i:s'));
        $data = fetchJson(sprintf(EUROLEAGUE_PLAYERS_URL, $season))['data'] ?? null;
        if (is_array($data)) {
            fantasyUpdatePositions($db, $data);
        }
    }
    if (minutesSince($db, 'fantasy_stats_checked_at') >= FANTASY_STATS_MINUTES) {
        setSetting($db, 'fantasy_stats_checked_at', date('Y-m-d H:i:s'));
        fantasyFetchStats($db, $season);
    }
    fantasyDraftAdvance($db);
    $s = fantasySettings($db);
    $times = fantasyRoundTimes($db, $season);
    fantasySnapshots($db, $s, $times);
    fantasyProcessTransfers($db, $season, $s, $times);
}

/* ---------- Stanje za stranicu ---------- */

function fantasyFriendOf(array $user): ?int
{
    return $user['friend_id'] === null ? null : (int) $user['friend_id'];
}

function fantasyTime(int $ts): string
{
    return date('Y-m-d\TH:i', $ts);
}

function fantasyState(PDO $db, array $user): array
{
    $season = currentSeasonCode();
    $s = fantasySettings($db);
    $friends = fantasyFriends($db);
    $order = fantasyOrder($db, $s);
    $me = fantasyFriendOf($user);
    $isAdmin = $user['role'] === 'admin';
    $times = fantasyRoundTimes($db, $season);
    $poolData = fantasyPlayerPool($db, $season);
    $pool = $poolData['players'];

    $picks = array_map(fn (array $row) => [
        'no' => (int) $row['pick_no'],
        'friendId' => (int) $row['friend_id'],
        'playerId' => (int) $row['player_id'],
        'auto' => (bool) $row['auto'],
    ], $db->query('SELECT pick_no, friend_id, player_id, auto FROM fantasy_draft_picks ORDER BY pick_no')->fetchAll());
    $total = count($order) * FANTASY_ROSTER;
    $current = null;
    if (in_array($s['draftStatus'], ['live', 'paused'], true) && count($picks) < $total) {
        $no = count($picks) + 1;
        $current = [
            'no' => $no,
            'friendId' => fantasyDraftOwner($order, $no),
            'endsAt' => $s['draftStatus'] === 'live' ? (int) round(($s['pickStartedAt'] + $s['pickSeconds']) * 1000) : null,
            'remaining' => $s['draftStatus'] === 'paused' ? $s['pickRemaining'] : null,
        ];
    }

    $rosters = [];
    foreach ($friends as $friend) {
        $rosters[$friend['id']] = [];
    }
    foreach ($db->query('SELECT player_id, friend_id, starter, role FROM fantasy_roster ORDER BY acquired_at, player_id') as $row) {
        $rosters[(int) $row['friend_id']][] = ['playerId' => (int) $row['player_id'], 'starter' => (bool) $row['starter'], 'role' => $row['role']];
    }

    $scores = fantasyScores($db, $season, $s, $times);
    $standings = fantasyStandings($friends, $scores);
    $next = fantasyNextRound($s, $times);
    $triples = array_map('intval', $db->query('SELECT friend_id, round FROM fantasy_triple')->fetchAll(PDO::FETCH_KEY_PAIR));

    // Primjer bodovanja: trenutna postava na PIR-u iz posljednjih završenih kola.
    $preview = [];
    if ($me !== null && count($rosters[$me] ?? []) === FANTASY_ROSTER) {
        $lineup = fantasyRosterLineup($db, $me);
        foreach ($poolData['formRounds'] as $round) {
            $score = fantasyScoreLineup($lineup, fantasyRoundStats($db, $season, $round), false, time());
            $preview[] = ['round' => $round, 'rows' => $score['rows'], 'bench' => $score['bench'], 'total' => $score['total']];
        }
    }

    $finalRounds = count(array_filter($scores, fn (array $e) => $e['final']));
    $friendCount = count($friends);
    $projectedRounds = max(0, $s['lastRound'] - $s['startRound'] + 1);
    $projected = $s['fundPerRound'] * $friendCount * $projectedRounds;

    $stmt = $db->prepare(
        'SELECT id, round, drop_player_id, wishes, waiver, status, got_player_id, created_at, processed_at
         FROM fantasy_transfers WHERE friend_id = ? ORDER BY id DESC LIMIT 10'
    );
    $stmt->execute([$me ?? 0]);
    $transfers = array_map(fn (array $t) => [
        'id' => (int) $t['id'],
        'round' => (int) $t['round'],
        'drop' => (int) $t['drop_player_id'],
        'wishes' => array_map('intval', explode(',', $t['wishes'])),
        'waiver' => (bool) $t['waiver'],
        'status' => $t['status'],
        'got' => $t['got_player_id'] === null ? null : (int) $t['got_player_id'],
        'createdAt' => str_replace(' ', 'T', substr($t['created_at'], 0, 16)),
    ], $stmt->fetchAll());

    $stmt = $db->prepare(
        "SELECT id, from_friend_id, to_friend_id, give_player_id, get_player_id, status, created_at FROM fantasy_trades
         WHERE ? IN (from_friend_id, to_friend_id) AND (status = 'pending' OR decided_at > DATE_SUB(NOW(), INTERVAL 7 DAY))
         ORDER BY id DESC LIMIT 20"
    );
    $stmt->execute([$me ?? 0]);
    $trades = array_map(fn (array $t) => [
        'id' => (int) $t['id'],
        'from' => (int) $t['from_friend_id'],
        'to' => (int) $t['to_friend_id'],
        'give' => (int) $t['give_player_id'],
        'get' => (int) $t['get_player_id'],
        'status' => $t['status'],
    ], $stmt->fetchAll());

    $usedThisRound = false;
    if ($me !== null && $next !== null) {
        $stmt = $db->prepare("SELECT COUNT(*) FROM fantasy_transfers WHERE friend_id = ? AND round = ? AND status IN ('pending', 'done')");
        $stmt->execute([$me, $next]);
        $usedThisRound = (int) $stmt->fetchColumn() > 0;
    }

    return [
        'serverNow' => (int) round(microtime(true) * 1000),
        'isAdmin' => $isAdmin,
        'meFriendId' => $me,
        'friends' => $friends,
        'settings' => [
            'startRound' => $s['startRound'],
            'mode' => $s['mode'],
            'draftAt' => $s['draftAt'],
            'pickSeconds' => $s['pickSeconds'],
            'fundPerRound' => $s['fundPerRound'],
            'split' => $s['split'],
            'triple' => $s['triple'],
            'trades' => $s['trades'],
            'lastRound' => $s['lastRound'],
            'startDeadlines' => (object) array_map(
                fn (int $round) => isset($times[$round]) ? fantasyTime($times[$round]['deadline']) : null,
                array_combine(FANTASY_START_ROUNDS, FANTASY_START_ROUNDS),
            ),
        ],
        'draft' => [
            'status' => $s['draftStatus'],
            'order' => $order,
            'picks' => $picks,
            'total' => $total,
            'current' => $current,
        ],
        'players' => array_values(array_map(fn (array $p) => array_diff_key($p, ['code' => true]), $pool)),
        'formRounds' => $poolData['formRounds'],
        'rosters' => (object) $rosters,
        'next' => $next === null ? null : [
            'round' => $next,
            'deadline' => fantasyTime($times[$next]['deadline']),
            'processAt' => fantasyTime(fantasyProcessAt($times, $next)),
            'processed' => time() >= fantasyProcessAt($times, $next),
        ],
        'triple' => (object) $triples,
        'rounds' => array_values(array_map(fn (array $e) => [
            'round' => $e['round'],
            'final' => $e['final'],
            'live' => $e['live'],
            'points' => (object) $e['points'],
            'winners' => $e['winners'],
            'rows' => (object) $e['rows'],
            'bench' => (object) $e['bench'],
        ], $scores)),
        'standings' => $standings,
        'priority' => fantasyPriority($order, $standings),
        'preview' => $preview,
        'fund' => [
            'perRound' => $s['fundPerRound'],
            'friends' => $friendCount,
            'rounds' => $s['mode'] === 'live' ? $finalRounds : 0,
            'current' => $s['mode'] === 'live' ? $s['fundPerRound'] * $friendCount * $finalRounds : 0,
            'projectedRounds' => $projectedRounds,
            'projected' => $projected,
            'split' => FANTASY_SPLITS[$s['split']],
        ],
        'transfers' => ['mine' => $transfers, 'usedThisRound' => $usedThisRound],
        'trades' => $trades,
    ];
}

/* ---------- Rute ---------- */

function fantasyRequireFriend(array $user): int
{
    return fantasyFriendOf($user) ?? fail(403, 'Tvoj nalog nije vezan za drugara iz tabele.');
}

function fantasyRequireAdmin(array $user): void
{
    if ($user['role'] !== 'admin') {
        fail(403, 'Ovo podešava samo admin.');
    }
}

function fantasyRequireTeams(array $s): void
{
    if ($s['draftStatus'] !== 'done') {
        fail(409, 'Ovo ide posle drafta, kad svako ima ekipu.');
    }
}

function fantasyPlayerName(PDO $db, int $id): string
{
    $stmt = $db->prepare('SELECT name FROM players WHERE id = ?');
    $stmt->execute([$id]);
    return (string) ($stmt->fetchColumn() ?: 'Igrač');
}

function fantasySaveSettings(PDO $db, array $body): void
{
    $s = fantasySettings($db);
    if (array_key_exists('startRound', $body)) {
        if (!in_array($body['startRound'], FANTASY_START_ROUNDS, true)) {
            fail(422, 'Liga može početi od 6. ili 7. kola.');
        }
        setSetting($db, 'fantasy_start_round', (string) $body['startRound']);
    }
    if (array_key_exists('mode', $body)) {
        if (!in_array($body['mode'], ['trial', 'live'], true)) {
            fail(422, 'Nepoznat režim.');
        }
        setSetting($db, 'fantasy_mode', $body['mode']);
    }
    if (array_key_exists('draftAt', $body)) {
        $at = $body['draftAt'];
        if ($at !== null && (!is_string($at) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $at))) {
            fail(422, 'Termin drafta nije ispravan.');
        }
        setSetting($db, 'fantasy_draft_at', $at ?? '');
    }
    if (array_key_exists('pickSeconds', $body)) {
        if (!in_array($body['pickSeconds'], FANTASY_PICK_SECONDS, true)) {
            fail(422, 'Vrijeme za izbor je 60, 90 ili 120 sekundi.');
        }
        if ($s['draftStatus'] === 'live') {
            fail(409, 'Vrijeme za izbor se ne mijenja dok draft traje. Pauziraj ga prvo.');
        }
        setSetting($db, 'fantasy_pick_seconds', (string) $body['pickSeconds']);
    }
    if (array_key_exists('fundPerRound', $body)) {
        $fund = filter_var($body['fundPerRound'], FILTER_VALIDATE_FLOAT);
        if ($fund === false || $fund < 0 || $fund > 1000) {
            fail(422, 'Uplata po kolu nije ispravna.');
        }
        setSetting($db, 'fantasy_fund_per_round', (string) $fund);
    }
    if (array_key_exists('split', $body)) {
        if (!is_string($body['split']) || !isset(FANTASY_SPLITS[$body['split']])) {
            fail(422, 'Nepoznata podjela nagrade.');
        }
        setSetting($db, 'fantasy_split', $body['split']);
    }
    foreach (['triple' => 'fantasy_triple', 'trades' => 'fantasy_trades'] as $key => $name) {
        if (array_key_exists($key, $body)) {
            setSetting($db, $name, $body[$key] ? '1' : '0');
        }
    }
}

// Sve rute /fantasy/…; svaka završava odgovorom.
function handleFantasyRoute(PDO $db, array $user, string $method, string $route): void
{
    $s = fantasySettings($db);
    $isAdmin = $user['role'] === 'admin';

    if ($route === '/fantasy' && $method === 'GET') {
        // Dok draft traje, svi osvježavaju svake 2–3 sekunde: Euroleague se ne pita tada.
        if ($s['draftStatus'] !== 'live') {
            syncSafely($db);
        }
        if (fantasyDraftAdvance($db) > 0) {
            notifySafely($db);
        }
        respond(200, fantasyState($db, $user));
    }

    if ($route === '/fantasy/settings' && $method === 'PUT') {
        fantasyRequireAdmin($user);
        fantasySaveSettings($db, readJson());
        respond(200, fantasyState($db, $user));
    }

    // Redoslijed drafta iz bubnja (dok draft nije počeo).
    if ($route === '/fantasy/order/draw' && $method === 'POST') {
        fantasyRequireAdmin($user);
        if ($s['draftStatus'] !== 'waiting') {
            fail(409, 'Redoslijed se ne mijenja kad je draft počeo.');
        }
        $ids = array_column(fantasyFriends($db), 'id');
        for ($i = count($ids) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        }
        setSetting($db, 'fantasy_draft_order', implode(',', $ids));
        respond(200, fantasyState($db, $user));
    }

    if ($route === '/fantasy/draft/start' && $method === 'POST') {
        fantasyRequireAdmin($user);
        if ($s['draftStatus'] !== 'waiting') {
            fail(409, 'Draft je već počeo. Za novi probni draft prvo obriši probu.');
        }
        if (count(fantasyFriends($db)) < 2) {
            fail(409, 'Za draft trebaju bar dva drugara.');
        }
        if (!$db->query('SELECT 1 FROM players WHERE position IS NOT NULL AND active = 1 LIMIT 1')->fetchColumn()) {
            fail(409, 'Igrači još nemaju pozicije. Osvježi spisak na stranici Igrači pa pokušaj ponovo.');
        }
        setSetting($db, 'fantasy_draft_order', implode(',', fantasyOrder($db, $s)));
        setSetting($db, 'fantasy_draft_status', 'live');
        setSetting($db, 'fantasy_draft_started_at', date('Y-m-d H:i:s'));
        setSetting($db, 'fantasy_pick_started_at', sprintf('%.3f', microtime(true)));
        notifySafely($db);
        respond(200, fantasyState($db, $user));
    }

    // Pauza čuva preostalo vrijeme trenutnog izbora; nastavak ga vraća.
    if ($route === '/fantasy/draft/pause' && $method === 'POST') {
        fantasyRequireAdmin($user);
        $pause = (bool) (readJson()['paused'] ?? true);
        if ($pause && $s['draftStatus'] === 'live') {
            $left = max(1, (int) ceil($s['pickStartedAt'] + $s['pickSeconds'] - microtime(true)));
            setSetting($db, 'fantasy_pick_remaining', (string) $left);
            setSetting($db, 'fantasy_draft_status', 'paused');
        } elseif (!$pause && $s['draftStatus'] === 'paused') {
            $left = $s['pickRemaining'] ?: $s['pickSeconds'];
            setSetting($db, 'fantasy_pick_started_at', sprintf('%.3f', microtime(true) - ($s['pickSeconds'] - $left)));
            setSetting($db, 'fantasy_draft_status', 'live');
        } else {
            fail(409, 'Draft nije u toku.');
        }
        respond(200, fantasyState($db, $user));
    }

    // Poništi posljednji izbor: igrač se vraća među slobodne, a isti drugar bira ponovo.
    if ($route === '/fantasy/draft/undo' && $method === 'POST') {
        fantasyRequireAdmin($user);
        if (!in_array($s['draftStatus'], ['live', 'paused', 'done'], true)) {
            fail(409, 'Draft nije počeo.');
        }
        if ($s['draftStatus'] === 'done' && $db->query('SELECT 1 FROM fantasy_lineups LIMIT 1')->fetchColumn()) {
            fail(409, 'Kolo je već bodovano sa ovim ekipama, draft se ne može vratiti.');
        }
        $last = $db->query('SELECT pick_no, player_id FROM fantasy_draft_picks ORDER BY pick_no DESC LIMIT 1')->fetch();
        if (!$last) {
            fail(409, 'Još nema izbora.');
        }
        $db->beginTransaction();
        $db->prepare('DELETE FROM fantasy_draft_picks WHERE pick_no = ?')->execute([$last['pick_no']]);
        $db->prepare('DELETE FROM fantasy_roster WHERE player_id = ?')->execute([$last['player_id']]);
        if ($s['draftStatus'] === 'done') {
            $db->exec('UPDATE fantasy_roster SET starter = 0, role = \'\'');
            setSetting($db, 'fantasy_draft_done_at', '');
            setSetting($db, 'fantasy_draft_status', 'live');
        }
        setSetting($db, 'fantasy_pick_started_at', sprintf('%.3f', microtime(true)));
        if ($s['draftStatus'] === 'paused') {
            setSetting($db, 'fantasy_pick_remaining', (string) $s['pickSeconds']);
        }
        $db->commit();
        respond(200, fantasyState($db, $user));
    }

    // Izbor na draftu: drugar kad je na redu, admin i umjesto drugara koji nije tu.
    if ($route === '/fantasy/draft/pick' && $method === 'POST') {
        fantasyDraftAdvance($db);
        $s = fantasySettings($db);
        if ($s['draftStatus'] !== 'live') {
            fail(409, $s['draftStatus'] === 'paused' ? 'Draft je pauziran.' : 'Draft nije u toku.');
        }
        $order = fantasyOrder($db, $s);
        $no = fantasyDraftCount($db) + 1;
        $friendId = fantasyDraftOwner($order, $no);
        if (!$isAdmin && fantasyRequireFriend($user) !== $friendId) {
            fail(409, 'Nisi na redu.');
        }
        $playerId = filter_var(readJson()['playerId'] ?? null, FILTER_VALIDATE_INT) ?: 0;
        $pool = fantasyPlayerPool($db, currentSeasonCode())['players'];
        $player = $pool[$playerId] ?? fail(404, 'Igrač nije na spisku.');
        if ($player['owner'] !== null) {
            fail(409, "{$player['name']} je već izabran.");
        }
        if ((fantasyNeeds($db, $friendId)[$player['pos']] ?? 0) <= 0) {
            fail(409, 'Ta pozicija je u ekipi već popunjena.');
        }
        if (!fantasyInsertPick($db, $no, $friendId, $playerId, false, microtime(true))) {
            fail(409, 'Neko je upravo izabrao. Pogledaj tablu pa pokušaj ponovo.');
        }
        notifySafely($db);
        respond(200, fantasyState($db, $user));
    }

    // Obriši probu: draft, ekipe, postave, izmjene i razmjene. PIR sa zapisnika ostaje.
    if ($route === '/fantasy/wipe' && $method === 'POST') {
        fantasyRequireAdmin($user);
        $db->beginTransaction();
        foreach (['fantasy_trades', 'fantasy_transfers', 'fantasy_triple', 'fantasy_lineups', 'fantasy_roster', 'fantasy_draft_picks'] as $table) {
            $db->exec("DELETE FROM {$table}");
        }
        foreach (['fantasy_draft_started_at', 'fantasy_draft_done_at', 'fantasy_pick_started_at', 'fantasy_pick_remaining'] as $name) {
            setSetting($db, $name, '');
        }
        setSetting($db, 'fantasy_draft_status', 'waiting');
        $db->commit();
        respond(200, fantasyState($db, $user));
    }

    // Postava za sljedeće kolo: {"friendId"?, "starters": [5 id], "captain", "vice"}.
    if ($route === '/fantasy/lineup' && $method === 'PUT') {
        fantasyRequireTeams($s);
        $body = readJson();
        $friendId = $isAdmin && isset($body['friendId']) ? (int) $body['friendId'] : fantasyRequireFriend($user);
        $lineup = fantasyRosterLineup($db, $friendId);
        $positions = array_column($lineup, 'pos', 'player_id');
        $starters = array_values(array_unique(array_map('intval', (array) ($body['starters'] ?? []))));
        $count = ['G' => 0, 'F' => 0, 'C' => 0];
        foreach ($starters as $id) {
            if (!isset($positions[$id])) {
                fail(422, 'U petorci može biti samo igrač iz tvoje ekipe.');
            }
            $count[$positions[$id]]++;
        }
        if ($count !== FANTASY_STARTERS) {
            fail(422, 'Petorka je 2 beka, 2 krila i 1 centar.');
        }
        $captain = (int) ($body['captain'] ?? 0);
        $vice = (int) ($body['vice'] ?? 0);
        if (!in_array($captain, $starters, true) || !in_array($vice, $starters, true) || $captain === $vice) {
            fail(422, 'Kapiten i vicekapiten su dva različita igrača iz petorke.');
        }
        $db->beginTransaction();
        $update = $db->prepare('UPDATE fantasy_roster SET starter = ?, role = ? WHERE player_id = ? AND friend_id = ?');
        foreach (array_keys($positions) as $id) {
            $update->execute([(int) in_array($id, $starters, true), $id === $captain ? 'captain' : ($id === $vice ? 'vice' : ''), $id, $friendId]);
        }
        $db->commit();
        respond(200, fantasyState($db, $user));
    }

    // Trostruki kapiten u sljedećem kolu: {"on": true | false}. Jednom u sezoni.
    if ($route === '/fantasy/triple' && $method === 'PUT') {
        fantasyRequireTeams($s);
        if (!$s['triple']) {
            fail(409, 'Trostruki kapiten nije uključen u ovoj ligi.');
        }
        $friendId = fantasyRequireFriend($user);
        $next = fantasyNextRound($s, fantasyRoundTimes($db, currentSeasonCode())) ?? fail(409, 'Nema kola za koje se pravi postava.');
        $stmt = $db->prepare('SELECT round FROM fantasy_triple WHERE friend_id = ?');
        $stmt->execute([$friendId]);
        $used = $stmt->fetchColumn();
        if ($used !== false && (int) $used !== $next) {
            fail(409, "Trostrukog kapitena si već iskoristio u kolu {$used}.");
        }
        if (readJson()['on'] ?? false) {
            $db->prepare('INSERT INTO fantasy_triple (friend_id, round) VALUES (?, ?) ON DUPLICATE KEY UPDATE round = VALUES(round)')
                ->execute([$friendId, $next]);
        } else {
            $db->prepare('DELETE FROM fantasy_triple WHERE friend_id = ? AND round = ?')->execute([$friendId, $next]);
        }
        respond(200, fantasyState($db, $user));
    }

    // Izmjena: {"drop": id, "wishes": [id, …]}. Prije obrade čeka red prednosti, posle ide odmah.
    if ($route === '/fantasy/transfers' && $method === 'POST') {
        fantasyRequireTeams($s);
        $friendId = fantasyRequireFriend($user);
        $times = fantasyRoundTimes($db, currentSeasonCode());
        $next = fantasyNextRound($s, $times) ?? fail(409, 'Nema kola za koje se rade izmjene.');
        $body = readJson();
        $drop = (int) ($body['drop'] ?? 0);
        $wishes = array_slice(array_values(array_unique(array_filter(array_map('intval', (array) ($body['wishes'] ?? []))))), 0, 3);
        if (!$wishes) {
            fail(422, 'Izaberi koga uzimaš.');
        }
        $stmt = $db->prepare("SELECT COUNT(*) FROM fantasy_transfers WHERE friend_id = ? AND round = ? AND status IN ('pending', 'done')");
        $stmt->execute([$friendId, $next]);
        if ((int) $stmt->fetchColumn() > 0) {
            fail(409, "Izmjenu za kolo {$next} si već iskoristio.");
        }
        $pool = fantasyPlayerPool($db, currentSeasonCode())['players'];
        if (($pool[$drop]['owner'] ?? null) !== $friendId) {
            fail(422, 'Puštaš samo igrača iz svoje ekipe.');
        }
        foreach ($wishes as $wish) {
            $player = $pool[$wish] ?? fail(404, 'Igrač nije na spisku.');
            if ($player['pos'] !== $pool[$drop]['pos']) {
                fail(422, "{$player['name']} nije iste pozicije kao {$pool[$drop]['name']}.");
            }
        }
        $now = date('Y-m-d H:i:s');
        $waiver = time() < fantasyProcessAt($times, $next);
        if ($waiver) {
            $db->prepare('INSERT INTO fantasy_transfers (friend_id, round, drop_player_id, wishes, waiver, created_at) VALUES (?, ?, ?, ?, 1, ?)')
                ->execute([$friendId, $next, $drop, implode(',', $wishes), $now]);
            respond(201, fantasyState($db, $user));
        }
        // Posle obrade: slobodni igrači idu „ko prvi“, odmah.
        $db->beginTransaction();
        if (!fantasyReplacePlayer($db, $friendId, $drop, $wishes[0])) {
            $db->rollBack();
            fail(409, "{$pool[$wishes[0]]['name']} više nije slobodan.");
        }
        $db->prepare("INSERT INTO fantasy_transfers (friend_id, round, drop_player_id, wishes, waiver, status, got_player_id, created_at, processed_at) VALUES (?, ?, ?, ?, 0, 'done', ?, ?, ?)")
            ->execute([$friendId, $next, $drop, (string) $wishes[0], $wishes[0], $now, $now]);
        $db->commit();
        respond(201, fantasyState($db, $user));
    }

    if (preg_match('#^/fantasy/transfers/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $friendId = fantasyRequireFriend($user);
        $stmt = $db->prepare("DELETE FROM fantasy_transfers WHERE id = ? AND friend_id = ? AND status = 'pending'");
        $stmt->execute([(int) $m[1], $friendId]);
        if ($stmt->rowCount() === 0) {
            fail(409, 'Zahtjev je već obrađen.');
        }
        respond(200, fantasyState($db, $user));
    }

    // Ponuda za razmjenu: {"give": moj igrač, "get": njegov igrač}, ista pozicija.
    if ($route === '/fantasy/trades' && $method === 'POST') {
        fantasyRequireTeams($s);
        if (!$s['trades']) {
            fail(409, 'Razmjene nisu uključene u ovoj ligi.');
        }
        $friendId = fantasyRequireFriend($user);
        $body = readJson();
        $pool = fantasyPlayerPool($db, currentSeasonCode())['players'];
        $give = $pool[(int) ($body['give'] ?? 0)] ?? fail(404, 'Igrač nije na spisku.');
        $get = $pool[(int) ($body['get'] ?? 0)] ?? fail(404, 'Igrač nije na spisku.');
        if ($give['owner'] !== $friendId) {
            fail(422, 'Nudiš samo igrača iz svoje ekipe.');
        }
        if ($get['owner'] === null || $get['owner'] === $friendId) {
            fail(422, 'Traži igrača iz tuđe ekipe.');
        }
        if ($give['pos'] !== $get['pos']) {
            fail(422, 'Razmjena je za igrača iste pozicije.');
        }
        $db->prepare('INSERT INTO fantasy_trades (from_friend_id, to_friend_id, give_player_id, get_player_id, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$friendId, $get['owner'], $give['id'], $get['id'], date('Y-m-d H:i:s')]);
        notifySafely($db);
        respond(201, fantasyState($db, $user));
    }

    // {"action": "accept" | "decline" (ko prima) | "cancel" (ko nudi)}
    if (preg_match('#^/fantasy/trades/(\d+)$#', $route, $m) && $method === 'PUT') {
        $friendId = fantasyRequireFriend($user);
        $action = readJson()['action'] ?? '';
        $stmt = $db->prepare("SELECT * FROM fantasy_trades WHERE id = ? AND status = 'pending'");
        $stmt->execute([(int) $m[1]]);
        $trade = $stmt->fetch() ?: fail(409, 'Ponuda više ne važi.');
        $receiver = (int) $trade['to_friend_id'] === $friendId;
        $sender = (int) $trade['from_friend_id'] === $friendId;
        $now = date('Y-m-d H:i:s');
        if ($action === 'cancel' && $sender || $action === 'decline' && $receiver) {
            $db->prepare('UPDATE fantasy_trades SET status = ?, decided_at = ? WHERE id = ?')
                ->execute([$action === 'cancel' ? 'cancelled' : 'declined', $now, $trade['id']]);
            notifySafely($db);
            respond(200, fantasyState($db, $user));
        }
        if ($action !== 'accept' || !$receiver) {
            fail(403, 'Ovu ponudu ne možeš tako mijenjati.');
        }
        $db->beginTransaction();
        $rows = $db->prepare('SELECT player_id, friend_id, starter, role FROM fantasy_roster WHERE player_id IN (?, ?) FOR UPDATE');
        $rows->execute([$trade['give_player_id'], $trade['get_player_id']]);
        $byPlayer = array_column($rows->fetchAll(), null, 'player_id');
        $give = $byPlayer[(int) $trade['give_player_id']] ?? null;
        $get = $byPlayer[(int) $trade['get_player_id']] ?? null;
        if (!$give || !$get || (int) $give['friend_id'] !== (int) $trade['from_friend_id'] || (int) $get['friend_id'] !== $friendId) {
            $db->prepare("UPDATE fantasy_trades SET status = 'cancelled', decided_at = ? WHERE id = ?")->execute([$now, $trade['id']]);
            $db->commit();
            fail(409, 'Ponuda više ne važi: jedan od igrača nije više u istoj ekipi.');
        }
        // Svako dobija igrača na mjesto onog koga je dao (petorka i uloga ostaju).
        $swap = $db->prepare('UPDATE fantasy_roster SET friend_id = ?, starter = ?, role = ?, acquired_at = ? WHERE player_id = ?');
        $swap->execute([$friendId, $get['starter'], $get['role'], $now, $give['player_id']]);
        $swap->execute([$trade['from_friend_id'], $give['starter'], $give['role'], $now, $get['player_id']]);
        $db->prepare("UPDATE fantasy_trades SET status = 'accepted', decided_at = ? WHERE id = ?")->execute([$now, $trade['id']]);
        $db->prepare(
            "UPDATE fantasy_trades SET status = 'cancelled', decided_at = ?
             WHERE status = 'pending' AND (give_player_id IN (?, ?) OR get_player_id IN (?, ?))"
        )->execute([$now, $give['player_id'], $get['player_id'], $give['player_id'], $get['player_id']]);
        $db->commit();
        notifySafely($db);
        respond(200, fantasyState($db, $user));
    }

    // Ispravka pozicije (admin), samo za igrača koji nije ni u jednoj ekipi.
    if (preg_match('#^/fantasy/players/(\d+)/position$#', $route, $m) && $method === 'PUT') {
        fantasyRequireAdmin($user);
        $position = readJson()['position'] ?? '';
        if (!in_array($position, ['G', 'F', 'C'], true)) {
            fail(422, 'Pozicija je G, F ili C.');
        }
        $stmt = $db->prepare('SELECT 1 FROM fantasy_roster WHERE player_id = ?');
        $stmt->execute([(int) $m[1]]);
        if ($stmt->fetchColumn()) {
            fail(409, 'Igrač je već u nečijoj ekipi, pozicija mu se ne mijenja.');
        }
        $stmt = $db->prepare('UPDATE players SET position = ?, position_fixed = 1 WHERE id = ?');
        $stmt->execute([$position, (int) $m[1]]);
        respond(200, fantasyState($db, $user));
    }

    fail(404, 'Nepoznata ruta.');
}

/* ---------- Obavještenja ---------- */

// Događaji fantasy lige za notifications.php (tip 'fantasy', vode na /fantasy).
function fantasyNotificationEvents(PDO $db, array $users, array $byFriend): array
{
    $season = currentSeasonCode();
    $s = fantasySettings($db);
    $now = time();
    $events = [];
    $withFriend = array_values($byFriend);
    $names = array_column(fantasyFriends($db), 'name', 'id');
    $message = fn (string $title, string $body, string $tag) => ['title' => $title, 'body' => $body, 'tag' => $tag, 'url' => '/fantasy'];
    $order = fantasyOrder($db, $s);

    // Draft: dan ranije i 15 minuta prije.
    if ($s['draftStatus'] === 'waiting' && $s['draftAt'] !== null) {
        $at = strtotime($s['draftAt']);
        $time = substr($s['draftAt'], 11, 5);
        if ($now >= $at - 24 * 3600 && $now < $at - 15 * 60) {
            $events[] = ['key' => "fantasy-draft-day:{$s['draftAt']}", 'type' => 'fantasy', 'recipients' => array_fill_keys($withFriend,
                $message('Fantasy draft je u ' . dayAccusative(date('Y-m-d', $at)) . " u {$time}", 'Svi biraju sa telefona, 8 krugova. Pripremi listu igrača.', 'fantasy-draft'))];
        }
        if ($now >= $at - 15 * 60 && $now < $at + 3600) {
            $recipients = [];
            foreach ($byFriend as $friendId => $userId) {
                $position = array_search($friendId, $order, true);
                $recipients[$userId] = $message('Draft počinje za 15 minuta', 'U ' . $time . ($position === false ? '.' : '. Biraš ' . ($position + 1) . '. u prvom krugu.') . ' Ako nisi tu, aplikacija bira umjesto tebe.', 'fantasy-draft');
            }
            $events[] = ['key' => "fantasy-draft-soon:{$s['draftAt']}", 'type' => 'fantasy', 'recipients' => $recipients];
        }
    }

    // Ti si na redu.
    if ($s['draftStatus'] === 'live') {
        $count = fantasyDraftCount($db);
        $total = count($order) * FANTASY_ROSTER;
        if ($count < $total) {
            $friendId = fantasyDraftOwner($order, $count + 1);
            $need = array_filter(fantasyNeeds($db, $friendId), fn (int $n) => $n > 0);
            $missing = implode(', ', array_map(fn (string $pos, int $n) => "{$n} {$pos}", array_keys($need), $need));
            if (isset($byFriend[$friendId])) {
                $events[] = ['key' => "fantasy-turn:{$s['draftStartedAt']}:" . ($count + 1), 'type' => 'fantasy', 'recipients' => [
                    $byFriend[$friendId] => $message('Ti si na redu u draftu', 'Izbor ' . ($count + 1) . " od {$total}. Imaš {$s['pickSeconds']} sekundi. Fale ti: {$missing}.", 'fantasy-turn'),
                ]];
            }
        }
    }

    if ($s['draftStatus'] !== 'done') {
        return $events;
    }
    $times = fantasyRoundTimes($db, $season);

    // Sat prije roka kola.
    $next = fantasyNextRound($s, $times);
    if ($next !== null && $now >= $times[$next]['deadline'] - 3600) {
        $deadline = date('Y-m-d H:i', $times[$next]['deadline']);
        $events[] = ['key' => "fantasy-deadline:{$s['mode']}:{$next}", 'type' => 'fantasy', 'recipients' => array_fill_keys($withFriend,
            $message('Fantasy rok za sat', "Kolo {$next}: postava se zaključava u " . substr($deadline, 11) . '. Provjeri petorku i kapitena.', "fantasy-deadline-{$next}"))];
    }

    // Obrađene izmjene (samo zahtjevi koji su čekali red prednosti).
    $stmt = $db->prepare("SELECT id, friend_id, drop_player_id, got_player_id, status FROM fantasy_transfers WHERE waiver = 1 AND status <> 'pending' AND processed_at > ?");
    $stmt->execute([date('Y-m-d H:i:s', $now - NOTIFY_LATE_SECONDS)]);
    foreach ($stmt as $t) {
        $userId = $byFriend[(int) $t['friend_id']] ?? null;
        if ($userId === null) {
            continue;
        }
        $events[] = ['key' => "fantasy-transfer:{$t['id']}", 'type' => 'fantasy', 'recipients' => [$userId => $t['status'] === 'done'
            ? $message('Izmjena prošla', 'Pustio si ' . fantasyPlayerName($db, (int) $t['drop_player_id']) . ', uzeo si ' . fantasyPlayerName($db, (int) $t['got_player_id']) . '.', "fantasy-transfer-{$t['id']}")
            : $message('Izmjena nije prošla', 'Igrače sa tvoje liste su uzeli drugi. Slobodne igrače sada uzimaš odmah, do roka kola.', "fantasy-transfer-{$t['id']}")]];
    }

    // Razmjene: ponuda onome kome je upućena, odgovor onome ko je ponudio.
    $stmt = $db->prepare("SELECT id, from_friend_id, to_friend_id, give_player_id, get_player_id, status FROM fantasy_trades WHERE created_at > ? OR decided_at > ?");
    $since = date('Y-m-d H:i:s', $now - NOTIFY_LATE_SECONDS);
    $stmt->execute([$since, $since]);
    foreach ($stmt as $t) {
        $from = (int) $t['from_friend_id'];
        $to = (int) $t['to_friend_id'];
        $give = fantasyPlayerName($db, (int) $t['give_player_id']);
        $get = fantasyPlayerName($db, (int) $t['get_player_id']);
        if ($t['status'] === 'pending' && isset($byFriend[$to])) {
            $events[] = ['key' => "fantasy-trade:{$t['id']}:offer", 'type' => 'fantasy', 'recipients' => [
                $byFriend[$to] => $message(($names[$from] ?? 'Drugar') . ' ti nudi razmjenu', "{$give} za tvog igrača {$get}. Odgovori u aplikaciji.", "fantasy-trade-{$t['id']}"),
            ]];
        }
        if (in_array($t['status'], ['accepted', 'declined'], true) && isset($byFriend[$from])) {
            $accepted = $t['status'] === 'accepted';
            $events[] = ['key' => "fantasy-trade:{$t['id']}:{$t['status']}", 'type' => 'fantasy', 'recipients' => [
                $byFriend[$from] => $message(($names[$to] ?? 'Drugar') . ($accepted ? ' je prihvatio razmjenu' : ' je odbio razmjenu'),
                    $accepted ? "{$get} je sada tvoj, {$give} je otišao." : "{$give} ostaje kod tebe.", "fantasy-trade-{$t['id']}"),
            ]];
        }
    }

    // Pobjednik kola, kad je PIR svih utakmica konačan.
    $scores = fantasyScores($db, $season, $s, $times);
    $standings = fantasyStandings(fantasyFriends($db), $scores);
    $rank = array_flip(array_column($standings, 'friendId'));
    foreach ($scores as $round => $entry) {
        if (!$entry['final'] || !$entry['winners'] || ($times[$round]['last'] ?? 0) < $now - 36 * 3600) {
            continue;
        }
        $points = $entry['points'];
        arsort($points);
        $winnerNames = implode(', ', array_map(fn (int $id) => $names[$id] ?? '', $entry['winners']));
        $best = fantasyNumber(max($points));
        $recipients = [];
        foreach ($byFriend as $friendId => $userId) {
            $mine = $points[$friendId] ?? null;
            $won = in_array($friendId, $entry['winners'], true);
            $place = isset($rank[$friendId]) ? ' U tabeli si ' . ($rank[$friendId] + 1) . '.' : '';
            $recipients[$userId] = $won
                ? $message("Osvojio si fantasy kolo {$round}!", "{$best} bodova.{$place}", "fantasy-round-{$round}")
                : $message("Fantasy kolo {$round}", "Pobjednik: {$winnerNames} ({$best})." . ($mine === null ? '' : ' Ti: ' . fantasyNumber($mine) . '.') . $place, "fantasy-round-{$round}");
        }
        $events[] = ['key' => "fantasy-round:{$s['mode']}:{$round}", 'type' => 'fantasy', 'recipients' => $recipients];
    }
    return $events;
}

// 168.5 → "168,5"
function fantasyNumber(float $value): string
{
    return floor($value) === $value ? (string) (int) $value : number_format($value, 1, ',', '');
}
