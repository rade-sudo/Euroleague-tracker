<?php

declare(strict_types=1);

const MAX_PICKS_PER_TICKET = 12;
const MAX_PLAYER_LENGTH = 40;
const MAX_TIP_LENGTH = 30;
const ROUND_STATUSES = ['open', 'locked', 'done'];
const ROUND_COLUMNS = "id, number, status, DATE_FORMAT(deadline_at, '%Y-%m-%dT%H:%i') AS deadline";
const PICK_COLUMNS = 'id, friend_id, player_id, game_id, player, tip, line, points, did_play, hit, graded_by';

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

// Dok dan tiketa nije zaključan, svako vidi samo svoje igrače i broj igrača kod ostalih
// (važi i za admina). Admin može namjerno otvoriti tuđi tiket ($reveal) da upiše igrače umjesto drugara.
function loadTickets(PDO $db, array $round, array $schedule, array $user, ?int $reveal): array
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
        $ownOrRevealed = $friendId === ownFriendId($user) || $friendId === $reveal;
        $visible = array_values(array_filter(
            $picks,
            fn (array $pick) => $ownOrRevealed || pickLocked($round, $schedule, $pick['gameId']),
        ));
        $tickets[] = ['friendId' => $friendId, 'count' => count($picks), 'picks' => $visible];
    }
    return $tickets;
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
