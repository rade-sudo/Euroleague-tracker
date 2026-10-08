<?php

declare(strict_types=1);

const MAX_PICKS_PER_TICKET = 12;
const MAX_PLAYER_LENGTH = 40;
const MAX_TIP_LENGTH = 30;
const ROUND_STATUSES = ['open', 'locked', 'done'];
const ROUND_COLUMNS = "id, number, status, DATE_FORMAT(deadline_at, '%Y-%m-%dT%H:%i') AS deadline";
const PICK_COLUMNS = 'id, friend_id, player_id, game_id, slip_id, player, tip, line, points, did_play, hit, graded_by';

function findRound(PDO $db, int $id): array
{
    $stmt = $db->prepare('SELECT ' . ROUND_COLUMNS . ' FROM rounds WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: fail(404, 'Kolo ne postoji.');
}

function findPick(PDO $db, int $id): array
{
    $stmt = $db->prepare(
        'SELECT p.id, p.round_id, p.friend_id, p.game_id, r.number, r.status
         FROM picks p JOIN rounds r ON r.id = p.round_id WHERE p.id = ?'
    );
    $stmt->execute([$id]);
    return $stmt->fetch() ?: fail(404, 'Igrač više nije na tiketu.');
}

function pickPayload(array $row): array
{
    $int = fn (mixed $value) => $value === null ? null : (int) $value;
    $bool = fn (mixed $value) => $value === null ? null : (bool) $value;
    return [
        'id' => (int) $row['id'],
        'playerId' => $int($row['player_id']),
        'gameId' => $int($row['game_id']),
        'slipId' => $int($row['slip_id']),
        'player' => $row['player'],
        'tip' => $row['tip'],
        'line' => $row['line'] === null ? null : (float) $row['line'],
        'points' => $int($row['points']),
        'didPlay' => $bool($row['did_play']),
        'hit' => $bool($row['hit']),
        'gradedBy' => $row['graded_by'],
    ];
}

function loadPick(PDO $db, int $id): array
{
    $stmt = $db->prepare('SELECT ' . PICK_COLUMNS . ' FROM picks WHERE id = ?');
    $stmt->execute([$id]);
    return pickPayload($stmt->fetch());
}

function ownFriendId(array $user): ?int
{
    return $user['friend_id'] === null ? null : (int) $user['friend_id'];
}

function assertCanEditTicket(array $user, int $friendId): void
{
    if ($user['role'] !== 'admin' && ownFriendId($user) !== $friendId) {
        fail(403, 'Možeš mijenjati samo svoj tiket.');
    }
}

// Da li je igrač zaključan: kolo nije otvoreno ili je prošao rok njegovog dana tiketa.
function pickLocked(array $round, array $schedule, ?int $gameId): bool
{
    return $round['status'] !== 'open' || (scheduleDayOfGame($schedule, $gameId)['locked'] ?? false);
}

// Svi vide sve igrače odmah, da niko ne izabere istog igrača za isto veče.
function loadTickets(PDO $db, array $round): array
{
    $stmt = $db->prepare('SELECT ' . PICK_COLUMNS . ' FROM picks WHERE round_id = ? ORDER BY id');
    $stmt->execute([$round['id']]);
    $byFriend = [];
    foreach ($stmt as $row) {
        $byFriend[(int) $row['friend_id']][] = pickPayload($row);
    }

    $tickets = [];
    foreach ($db->query('SELECT id FROM friends ORDER BY id') as $friend) {
        $friendId = (int) $friend['id'];
        $picks = $byFriend[$friendId] ?? [];
        $tickets[] = ['friendId' => $friendId, 'count' => count($picks), 'picks' => $picks];
    }
    return $tickets;
}

// Isti igrač se ne bira dvaput u istom kolu: igra samo jednu utakmicu, pa je to uvijek isto veče.
// Vraća ko ga je već izabrao i za koji dan, ili null.
function duplicatePick(PDO $db, int $roundId, ?int $playerId, string $player): ?array
{
    $stmt = $db->prepare(
        "SELECT p.friend_id, f.name, DATE_FORMAT(g.starts_at, '%Y-%m-%d') AS day
         FROM picks p JOIN friends f ON f.id = p.friend_id LEFT JOIN games g ON g.id = p.game_id
         WHERE p.round_id = ? AND " . ($playerId === null ? 'p.player_id IS NULL AND p.player = ?' : 'p.player_id = ?') . ' LIMIT 1'
    );
    $stmt->execute([$roundId, $playerId ?? $player]);
    return $stmt->fetch() ?: null;
}

// Za karticu igrača: klub i ranija kola u kojima je biran i ocijenjen.
function playerCards(PDO $db, array $tickets, int $roundId): object
{
    $ids = [];
    foreach ($tickets as $ticket) {
        foreach ($ticket['picks'] as $pick) {
            if ($pick['playerId'] !== null) {
                $ids[$pick['playerId']] = true;
            }
        }
    }
    $ids = array_keys($ids);
    if (!$ids) {
        return (object) [];
    }
    $in = implode(',', array_fill(0, count($ids), '?'));

    $cards = [];
    $stmt = $db->prepare("SELECT id, club_code, club_name FROM players WHERE id IN ({$in})");
    $stmt->execute($ids);
    foreach ($stmt as $row) {
        $cards[(int) $row['id']] = ['club' => $row['club_name'], 'clubCode' => $row['club_code'], 'history' => []];
    }
    $stmt = $db->prepare(
        "SELECT p.player_id, r.number, p.hit, p.points FROM picks p JOIN rounds r ON r.id = p.round_id
         WHERE p.player_id IN ({$in}) AND p.round_id <> ? AND p.hit IS NOT NULL ORDER BY r.number, p.id"
    );
    $stmt->execute([...$ids, $roundId]);
    foreach ($stmt as $row) {
        $cards[(int) $row['player_id']]['history'][] = [
            'round' => (int) $row['number'],
            'hit' => (bool) $row['hit'],
            'points' => $row['points'] === null ? null : (int) $row['points'],
        ];
    }
    return (object) $cards;
}

// Rezultati kola iz tabele: {friendId: "2/3"}.
function roundResults(PDO $db, int $roundId): object
{
    $stmt = $db->prepare('SELECT friend_id, hits, played FROM results WHERE round_id = ?');
    $stmt->execute([$roundId]);
    $results = [];
    foreach ($stmt as $row) {
        $results[$row['friend_id']] = "{$row['hits']}/{$row['played']}";
    }
    return (object) $results;
}

// Granica je uvijek sa .5 (15.5 + traži 16 poena). Prazno briše granicu.
function parseLine(mixed $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    $text = is_string($value) || is_int($value) || is_float($value) ? str_replace(',', '.', trim((string) $value)) : '';
    if (!preg_match('/^\d{1,2}\.5$/', $text)) {
        fail(422, 'Granica je broj sa .5, npr. 15.5.');
    }
    return $text;
}

// Kad su svi igrači sa tiketa ocijenjeni, rezultat (npr. 2/3) ide u tabelu.
// Dok neki čeka ocjenu, polje u tabeli je prazno. Bez igrača ne diramo ručno upisan rezultat.
function syncResultFromPicks(PDO $db, int $roundId, int $friendId): ?string
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) AS total, COALESCE(SUM(hit = 1), 0) AS hits, COALESCE(SUM(hit IS NULL), 0) AS pending
         FROM picks WHERE round_id = ? AND friend_id = ?'
    );
    $stmt->execute([$roundId, $friendId]);
    $row = $stmt->fetch();
    $total = (int) $row['total'];
    $hits = (int) $row['hits'];

    if ($total === 0) {
        return null;
    }
    if ((int) $row['pending'] > 0) {
        $db->prepare('DELETE FROM results WHERE friend_id = ? AND round_id = ?')->execute([$friendId, $roundId]);
        return null;
    }
    $db->prepare(
        'INSERT INTO results (friend_id, round_id, hits, played) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE hits = VALUES(hits), played = VALUES(played)'
    )->execute([$friendId, $roundId, $hits, $total]);
    return "{$hits}/{$total}";
}
