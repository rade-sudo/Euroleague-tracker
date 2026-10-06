<?php

declare(strict_types=1);

const MAX_PICKS_PER_TICKET = 12;
const MAX_PLAYER_LENGTH = 40;
const MAX_TIP_LENGTH = 30;
const ROUND_STATUSES = ['open', 'locked', 'done'];
const ROUND_COLUMNS = "id, number, status, DATE_FORMAT(deadline_at, '%Y-%m-%dT%H:%i') AS deadline";

function findRound(PDO $db, int $id): array
{
    $stmt = $db->prepare('SELECT ' . ROUND_COLUMNS . ' FROM rounds WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: fail(404, 'Kolo ne postoji.');
}

function findPick(PDO $db, int $id): array
{
    $stmt = $db->prepare(
        'SELECT p.id, p.round_id, p.friend_id, r.status
         FROM picks p JOIN rounds r ON r.id = p.round_id WHERE p.id = ?'
    );
    $stmt->execute([$id]);
    return $stmt->fetch() ?: fail(404, 'Igrač više nije na tiketu.');
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

// Dok je kolo otvoreno, svako vidi samo svoj tiket i broj igrača kod ostalih (važi i za admina).
// Admin može namjerno otvoriti tuđi tiket ($reveal) da upiše igrače umjesto drugara.
function loadTickets(PDO $db, array $round, array $user, ?int $reveal): array
{
    $stmt = $db->prepare('SELECT id, friend_id, player, tip, hit FROM picks WHERE round_id = ? ORDER BY id');
    $stmt->execute([$round['id']]);
    $byFriend = [];
    foreach ($stmt as $row) {
        $byFriend[(int) $row['friend_id']][] = [
            'id' => (int) $row['id'],
            'player' => $row['player'],
            'tip' => $row['tip'],
            'hit' => $row['hit'] === null ? null : (bool) $row['hit'],
        ];
    }

    $tickets = [];
    foreach ($db->query('SELECT id FROM friends ORDER BY id') as $friend) {
        $friendId = (int) $friend['id'];
        $picks = $byFriend[$friendId] ?? [];
        $visible = $round['status'] !== 'open' || $friendId === ownFriendId($user) || $friendId === $reveal;
        $tickets[] = ['friendId' => $friendId, 'count' => count($picks), 'picks' => $visible ? $picks : null];
    }
    return $tickets;
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
