<?php

declare(strict_types=1);

// Pobjednik kola i lični pregled na vrhu Tabele.

// Pobjednik završenog kola (sve ocijenjeno): veći procenat, pa više pogođenih, pa više poena
// igrača sa tiketa; ako je i to isto, kolo dijele. runnerUp je drugi, kad su odlučili poeni.
// Vraća [roundId => ['round', 'friendIds', 'hits', 'played', 'points', 'runnerUp']].
function roundWinners(PDO $db): array
{
    $rounds = $db->query(
        "SELECT r.id, r.number FROM rounds r
         WHERE r.status = 'done'
           AND NOT EXISTS (SELECT 1 FROM picks p WHERE p.round_id = r.id AND p.hit IS NULL)
           AND EXISTS (SELECT 1 FROM results res WHERE res.round_id = r.id)
         ORDER BY r.number"
    )->fetchAll();

    $resultsStmt = $db->prepare('SELECT friend_id, hits, played FROM results WHERE round_id = ?');
    $pointsStmt = $db->prepare('SELECT friend_id, COALESCE(SUM(points), 0) AS points FROM picks WHERE round_id = ? GROUP BY friend_id');
    $winners = [];
    foreach ($rounds as $round) {
        $pointsStmt->execute([$round['id']]);
        $points = array_map('intval', $pointsStmt->fetchAll(PDO::FETCH_KEY_PAIR));
        $resultsStmt->execute([$round['id']]);
        $rows = array_map(fn (array $r) => [
            'friendId' => (int) $r['friend_id'],
            'hits' => (int) $r['hits'],
            'played' => (int) $r['played'],
            'points' => $points[(int) $r['friend_id']] ?? 0,
        ], $resultsStmt->fetchAll());

        // Procenti se porede bez zaokruživanja: a/b > c/d ⇔ a·d > c·b.
        usort($rows, fn (array $a, array $b) => ($b['hits'] * $a['played'] <=> $a['hits'] * $b['played'])
            ?: ($b['hits'] <=> $a['hits'])
            ?: ($b['points'] <=> $a['points']));
        $best = $rows[0];
        $sameTicket = fn (array $r) => $r['hits'] * $best['played'] === $best['hits'] * $r['played'] && $r['hits'] === $best['hits'];
        $top = array_values(array_filter($rows, fn (array $r) => $sameTicket($r) && $r['points'] === $best['points']));
        $runnerUp = null;
        foreach ($rows as $row) {
            if ($sameTicket($row) && $row['points'] !== $best['points']) {
                $runnerUp = ['friendId' => $row['friendId'], 'points' => $row['points']];
                break;
            }
        }
        $winners[(int) $round['id']] = [
            'round' => (int) $round['number'],
            'friendIds' => array_column($top, 'friendId'),
            'hits' => $best['hits'],
            'played' => $best['played'],
            'points' => $best['points'],
            'runnerUp' => $runnerUp,
        ];
    }
    return $winners;
}

// Za "Tvoj pregled": stanje u kasi i tekuće kolo (da li je predao i sljedeći rok).
function mePayload(PDO $db, array $user): ?array
{
    $friendId = ownFriendId($user);
    if ($friendId === null) {
        return null;
    }
    $cash = 0.0;
    foreach (cashPayload($db)['friends'] as $row) {
        if ($row['friendId'] === $friendId) {
            $cash = $row['state'];
        }
    }

    $current = null;
    $round = $db->query("SELECT id, number, DATE_FORMAT(deadline_at, '%Y-%m-%dT%H:%i') AS deadline FROM rounds WHERE status = 'open' ORDER BY number DESC LIMIT 1")->fetch();
    if ($round) {
        $stmt = $db->prepare('SELECT COUNT(*) FROM picks WHERE round_id = ? AND friend_id = ?');
        $stmt->execute([$round['id'], $friendId]);
        $deadline = $round['deadline'];
        foreach (roundSchedule($db, (int) $round['number']) as $day) {
            if ($day['ticket'] && !$day['locked']) {
                $deadline = $day['deadline'];
                break;
            }
        }
        $current = ['number' => (int) $round['number'], 'picks' => (int) $stmt->fetchColumn(), 'deadline' => $deadline];
    }
    return ['friendId' => $friendId, 'cash' => $cash, 'round' => $current];
}
