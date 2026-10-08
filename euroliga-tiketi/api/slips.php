<?php

declare(strict_types=1);

// Tiketi kola (tiket 1 i 2 po danu tiketa) i kasa. Svako plaća 2 KM po svom igraču,
// a isplatu tiketa koji je prošao dijele igrači sa tog tiketa, po igraču.
const STAKE_PER_PLAYER = 2.0;
// 3–6 igrača igra se jedan tiket, 7 i više dva.
const MIN_PLAYERS_PER_SLIP = 3;
const MAX_PLAYERS_ONE_SLIP = 6;
const MAX_ODDS = 100000;
const MAX_MONEY = 1000000;
const MAX_PAYMENT_NOTE = 80;

function slipsFromRound(PDO $db): int
{
    return (int) getSetting($db, 'slips_from_round', '1');
}

// Igrači jednog dana tiketa (za kolo bez rasporeda: igrači bez utakmice, $day = null).
function picksForDay(PDO $db, int $roundId, ?string $day): array
{
    $stmt = $db->prepare(
        'SELECT p.id, p.friend_id, p.slip_id FROM picks p LEFT JOIN games g ON g.id = p.game_id
         WHERE p.round_id = ? AND DATE(g.starts_at) <=> ? ORDER BY p.id'
    );
    $stmt->execute([$roundId, $day]);
    return $stmt->fetchAll();
}

// Raspored po pravilu: 3–6 igrača jedan tiket, 7 i više dva (8 → 4 + 4, 7 → 4 + 3).
// Igrači istog drugara idu na različite tikete. Vraća [pickId => broj tiketa].
// $force: admin pravi tiket i kad su samo 1–2 igrača.
function splitIntoSlips(array $picks, bool $force): array
{
    $count = count($picks);
    if ($count === 0 || ($count < MIN_PLAYERS_PER_SLIP && !$force)) {
        return [];
    }
    if ($count <= MAX_PLAYERS_ONE_SLIP) {
        return array_fill_keys(array_map(fn (array $p) => (int) $p['id'], $picks), 1);
    }
    $byFriend = [];
    foreach ($picks as $pick) {
        $byFriend[(int) $pick['friend_id']][] = (int) $pick['id'];
    }
    // Prvo drugari sa više igrača, da im se igrači podijele; ostali idu na manji tiket.
    uasort($byFriend, fn (array $a, array $b) => count($b) <=> count($a));
    $sizes = [1 => 0, 2 => 0];
    $plan = [];
    foreach ($byFriend as $ids) {
        $order = $sizes[1] <= $sizes[2] ? [1, 2] : [2, 1];
        foreach ($ids as $i => $id) {
            $number = $order[$i % 2];
            $plan[$id] = $number;
            $sizes[$number]++;
        }
    }
    return $plan;
}

function slipsExist(PDO $db, int $roundId, ?string $day): bool
{
    $stmt = $db->prepare('SELECT 1 FROM slips WHERE round_id = ? AND day <=> ? LIMIT 1');
    $stmt->execute([$roundId, $day]);
    return (bool) $stmt->fetchColumn();
}

function createSlip(PDO $db, int $roundId, ?string $day, int $number): int
{
    $db->prepare('INSERT INTO slips (round_id, day, number, created_at) VALUES (?, ?, ?, ?)')
        ->execute([$roundId, $day, $number, date('Y-m-d H:i:s')]);
    return (int) $db->lastInsertId();
}

// Napravi tikete dana po pravilu. Vraća koliko je tiketa napravljeno (0 ako već postoje).
function createSlipsForDay(PDO $db, int $roundId, ?string $day, bool $force): int
{
    if (slipsExist($db, $roundId, $day)) {
        return 0;
    }
    $plan = splitIntoSlips(picksForDay($db, $roundId, $day), $force);
    if (!$plan) {
        return 0;
    }
    $slipIds = [];
    foreach (array_unique(array_values($plan)) as $number) {
        $slipIds[$number] = createSlip($db, $roundId, $day, $number);
    }
    $update = $db->prepare('UPDATE picks SET slip_id = ? WHERE id = ?');
    foreach ($plan as $pickId => $number) {
        $update->execute([$slipIds[$number], $pickId]);
    }
    return count($slipIds);
}

// Kad se dan tiketa zaključa, tiketi se naprave sami (od kola iz podešavanja, npr. 4).
function ensureSlips(PDO $db): void
{
    $stmt = $db->prepare('SELECT id, number FROM rounds WHERE number >= ?');
    $stmt->execute([slipsFromRound($db)]);
    foreach ($stmt->fetchAll() as $round) {
        foreach (roundSchedule($db, (int) $round['number']) as $day) {
            if (!$day['ticket'] || !$day['locked'] || slipsExist($db, (int) $round['id'], $day['date'])) {
                continue;
            }
            $db->beginTransaction();
            createSlipsForDay($db, (int) $round['id'], $day['date'], false);
            $db->commit();
        }
    }
}

// Admin prebacuje igrača na tiket 1 ili 2 njegovog dana. Prazan tiket se briše,
// a ako ostane samo tiket 2, postaje tiket 1.
function movePickToSlip(PDO $db, int $pickId, mixed $number): void
{
    if (!in_array($number, [1, 2], true)) {
        fail(422, 'Tiket može biti 1 ili 2.');
    }
    $stmt = $db->prepare(
        'SELECT p.round_id, DATE_FORMAT(g.starts_at, \'%Y-%m-%d\') AS day FROM picks p LEFT JOIN games g ON g.id = p.game_id WHERE p.id = ?'
    );
    $stmt->execute([$pickId]);
    $pick = $stmt->fetch() ?: fail(404, 'Igrač više nije na tiketu.');
    $roundId = (int) $pick['round_id'];
    $day = $pick['day'];

    $stmt = $db->prepare('SELECT id FROM slips WHERE round_id = ? AND day <=> ? AND number = ?');
    $stmt->execute([$roundId, $day, $number]);
    $slipId = $stmt->fetchColumn() ?: createSlip($db, $roundId, $day, $number);
    $db->prepare('UPDATE picks SET slip_id = ? WHERE id = ?')->execute([$slipId, $pickId]);

    $db->prepare(
        'DELETE s FROM slips s LEFT JOIN picks p ON p.slip_id = s.id WHERE s.round_id = ? AND s.day <=> ? AND p.id IS NULL'
    )->execute([$roundId, $day]);
    $stmt = $db->prepare('SELECT id, number FROM slips WHERE round_id = ? AND day <=> ?');
    $stmt->execute([$roundId, $day]);
    $left = $stmt->fetchAll();
    if (count($left) === 1 && (int) $left[0]['number'] === 2) {
        $db->prepare('UPDATE slips SET number = 1 WHERE id = ?')->execute([$left[0]['id']]);
    }
}

// "11,24" ili "11.24" → 11.24; prazno → null.
function parseMoney(mixed $value, float $min, float $max, string $error): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    $text = is_string($value) || is_int($value) || is_float($value) ? str_replace(',', '.', trim((string) $value)) : '';
    if (!preg_match('/^-?\d+(\.\d{1,2})?$/', $text) || (float) $text < $min || (float) $text > $max) {
        fail(422, $error);
    }
    return round((float) $text, 2);
}

function updateSlip(PDO $db, int $slipId, array $body): void
{
    $stmt = $db->prepare('SELECT id FROM slips WHERE id = ?');
    $stmt->execute([$slipId]);
    if (!$stmt->fetchColumn()) {
        fail(404, 'Tiket ne postoji.');
    }
    if (array_key_exists('odds', $body)) {
        $odds = parseMoney($body['odds'], 1.01, MAX_ODDS, 'Kvota je broj veći od 1, npr. 11,24.');
        $db->prepare('UPDATE slips SET odds = ? WHERE id = ?')->execute([$odds, $slipId]);
    }
    if (array_key_exists('payout', $body)) {
        $payout = parseMoney($body['payout'], 0, MAX_MONEY, 'Isplata je iznos u KM, npr. 72,96.');
        $db->prepare('UPDATE slips SET payout = ? WHERE id = ?')->execute([$payout, $slipId]);
    }
}

// Tiketi kola. Drugari vide samo uplaćene (sa kvotom); admin vidi i raspored prije uplate.
function roundSlips(PDO $db, int $roundId, bool $isAdmin): array
{
    $stmt = $db->prepare(
        "SELECT id, DATE_FORMAT(day, '%Y-%m-%d') AS day, number, odds, payout FROM slips
         WHERE round_id = ? " . ($isAdmin ? '' : 'AND odds IS NOT NULL ') . 'ORDER BY day, number'
    );
    $stmt->execute([$roundId]);
    return array_map(fn (array $row) => [
        'id' => (int) $row['id'],
        'day' => $row['day'],
        'number' => (int) $row['number'],
        'odds' => $row['odds'] === null ? null : (float) $row['odds'],
        'payout' => $row['payout'] === null ? null : (float) $row['payout'],
    ], $stmt->fetchAll());
}

// Uplaćeni tiketi (sa kvotom) sa stanjem: prošao samo ako su prošli svi igrači.
// $roundIds ograničava na ta kola. Vrijednost dobitka: upisana isplata, inače ulog × kvota.
function playedSlips(PDO $db, ?array $roundIds = null): array
{
    $where = $roundIds === null ? '' : ' AND s.round_id IN (' . (implode(',', array_map('intval', $roundIds)) ?: '0') . ')';
    $slips = [];
    foreach ($db->query(
        "SELECT s.id, s.round_id, r.number AS round, DATE_FORMAT(s.day, '%Y-%m-%d') AS day, s.number, s.odds, s.payout,
                COUNT(p.id) AS players, COALESCE(SUM(p.hit = 0), 0) AS misses, COALESCE(SUM(p.hit IS NULL), 0) AS pending
         FROM slips s JOIN rounds r ON r.id = s.round_id LEFT JOIN picks p ON p.slip_id = s.id
         WHERE s.odds IS NOT NULL{$where}
         GROUP BY s.id, s.round_id, r.number, s.day, s.number, s.odds, s.payout
         ORDER BY r.number, s.day, s.number"
    ) as $row) {
        $players = (int) $row['players'];
        $stake = $players * STAKE_PER_PLAYER;
        $status = (int) $row['misses'] > 0 ? 'lost' : ((int) $row['pending'] > 0 || $players === 0 ? 'pending' : 'won');
        $slips[(int) $row['id']] = [
            'id' => (int) $row['id'],
            'roundId' => (int) $row['round_id'],
            'round' => (int) $row['round'],
            'day' => $row['day'],
            'number' => (int) $row['number'],
            'players' => $players,
            'stake' => $stake,
            'odds' => (float) $row['odds'],
            'payout' => $row['payout'] === null ? null : (float) $row['payout'],
            'status' => $status,
            'value' => $status === 'won' ? ($row['payout'] === null ? round($stake * (float) $row['odds'], 2) : (float) $row['payout']) : 0.0,
            'members' => [],
        ];
    }
    if ($slips) {
        $ids = implode(',', array_keys($slips));
        foreach ($db->query("SELECT slip_id, friend_id, COUNT(*) AS c FROM picks WHERE slip_id IN ({$ids}) GROUP BY slip_id, friend_id") as $row) {
            $slips[(int) $row['slip_id']]['members'][(int) $row['friend_id']] = (int) $row['c'];
        }
    }
    return $slips;
}

// Kasa: ko je koliko uložio, dobio i uplatio. Stanje = uplate + dobici − ulozi:
// minus znači da drugar duguje kasi, plus da kasa duguje njemu.
function cashPayload(PDO $db): array
{
    $rows = [];
    foreach ($db->query('SELECT id, name FROM friends ORDER BY id') as $friend) {
        $rows[(int) $friend['id']] = ['friendId' => (int) $friend['id'], 'name' => $friend['name'], 'slots' => 0, 'stake' => 0.0, 'won' => 0.0, 'paid' => 0.0];
    }
    $slips = playedSlips($db);
    foreach ($slips as $slip) {
        foreach ($slip['members'] as $friendId => $count) {
            if (!isset($rows[$friendId])) {
                continue;
            }
            $rows[$friendId]['slots'] += $count;
            $rows[$friendId]['stake'] += $count * STAKE_PER_PLAYER;
            if ($slip['status'] === 'won' && $slip['players'] > 0) {
                $rows[$friendId]['won'] += $slip['value'] * $count / $slip['players'];
            }
        }
    }

    $payments = [];
    foreach ($db->query("SELECT id, friend_id, amount, note, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i') AS created_at FROM cash_payments ORDER BY created_at DESC, id DESC") as $row) {
        $payments[] = ['id' => (int) $row['id'], 'friendId' => (int) $row['friend_id'], 'amount' => (float) $row['amount'], 'note' => $row['note'], 'createdAt' => $row['created_at']];
        if (isset($rows[(int) $row['friend_id']])) {
            $rows[(int) $row['friend_id']]['paid'] += (float) $row['amount'];
        }
    }

    foreach ($rows as &$row) {
        $row['stake'] = round($row['stake'], 2);
        $row['won'] = round($row['won'], 2);
        $row['paid'] = round($row['paid'], 2);
        $row['state'] = round($row['paid'] + $row['won'] - $row['stake'], 2);
    }
    unset($row);

    $stake = array_sum(array_column($slips, 'stake'));
    $won = array_sum(array_column($slips, 'value'));
    $paid = array_sum(array_column($payments, 'amount'));
    return [
        'stakePerPlayer' => STAKE_PER_PLAYER,
        'friends' => array_values($rows),
        'totals' => [
            'stake' => round($stake, 2),
            'won' => round($won, 2),
            'paid' => round($paid, 2),
            'cash' => round($paid + $won - $stake, 2),
            'slips' => count($slips),
            'slipsWon' => count(array_filter($slips, fn (array $s) => $s['status'] === 'won')),
        ],
        'slips' => array_values(array_map(fn (array $s) => array_diff_key($s, ['members' => true, 'roundId' => true]), $slips)),
        'payments' => $payments,
    ];
}

function addCashPayment(PDO $db, array $body): void
{
    $friendId = filter_var($body['friendId'] ?? null, FILTER_VALIDATE_INT);
    $amount = parseMoney($body['amount'] ?? null, -MAX_MONEY, MAX_MONEY, 'Iznos je broj u KM, npr. 20 ili −20.');
    if ($friendId === false || $amount === null || $amount == 0) {
        fail(422, 'Izaberi drugara i upiši iznos.');
    }
    $note = mb_substr(normalizeName($body['note'] ?? ''), 0, MAX_PAYMENT_NOTE);
    try {
        $db->prepare('INSERT INTO cash_payments (friend_id, amount, note, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$friendId, $amount, $note, date('Y-m-d H:i:s')]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1452) {
            fail(404, 'Drugar ne postoji.');
        }
        throw $e;
    }
}
