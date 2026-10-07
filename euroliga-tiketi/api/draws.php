<?php

declare(strict_types=1);

// all: svih 6 je uvijek u bubnju; pause: izvučeni iz prošlog kola pauziraju;
// cycle: niko ne bira drugi put dok svi ne dođu na red.
const DRAW_RULES = ['all', 'pause', 'cycle'];
const DRAW_SLOTS = [1, 2];

function getSetting(PDO $db, string $name, string $default): string
{
    $stmt = $db->prepare('SELECT value FROM settings WHERE name = ?');
    $stmt->execute([$name]);
    $value = $stmt->fetchColumn();
    return $value === false ? $default : $value;
}

function setSetting(PDO $db, string $name, string $value): void
{
    $db->prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
        ->execute([$name, $value]);
}

// Bubanj radi za najnovije kolo koje nije završeno, a ako su sva završena, za najnovije.
function drawRound(PDO $db): ?array
{
    $row = $db->query("SELECT id, number, status FROM rounds ORDER BY (status <> 'done') DESC, number DESC LIMIT 1")->fetch();
    return $row ?: null;
}

function lockRound(PDO $db, mixed $roundId): array
{
    $id = filter_var($roundId, FILTER_VALIDATE_INT);
    $stmt = $db->prepare('SELECT id, number, status FROM rounds WHERE id = ? FOR UPDATE');
    $stmt->execute([$id === false ? 0 : $id]);
    $round = $stmt->fetch() ?: fail(404, 'Kolo ne postoji.');
    if ($round['status'] === 'done') {
        fail(409, "Kolo {$round['number']} je završeno, izvlačenje više nije moguće.");
    }
    return $round;
}

function loadDraws(PDO $db): array
{
    return $db->query(
        "SELECT d.id, d.round_id, r.number AS round_number, d.friend_id, d.slot,
                DATE_FORMAT(d.drawn_at, '%Y-%m-%dT%H:%i') AS drawn_at,
                DATE_FORMAT(d.replaced_at, '%Y-%m-%dT%H:%i') AS replaced_at,
                DATE_FORMAT(d.cancelled_at, '%Y-%m-%dT%H:%i') AS cancelled_at,
                u.username AS drawn_by
         FROM draws d
         JOIN rounds r ON r.id = d.round_id
         LEFT JOIN users u ON u.id = d.drawn_by
         ORDER BY r.number DESC, d.id"
    )->fetchAll();
}

function activeDrawSlots(PDO $db, int $roundId): array
{
    $stmt = $db->prepare('SELECT slot FROM draws WHERE round_id = ? AND replaced_at IS NULL AND cancelled_at IS NULL');
    $stmt->execute([$roundId]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

function activeDrawFriendIds(PDO $db, int $roundId): array
{
    $stmt = $db->prepare('SELECT friend_id FROM draws WHERE round_id = ? AND replaced_at IS NULL AND cancelled_at IS NULL ORDER BY slot');
    $stmt->execute([$roundId]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

// Za svakog prijatelja: u bubnju (in), izvučen u ovom kolu (drawn) ili van bubnja (out) uz razlog.
function drumStatus(array $friendIds, array $draws, ?array $round, string $rule): array
{
    $status = [];
    foreach ($friendIds as $id) {
        $status[$id] = ['status' => 'in', 'reason' => null];
    }
    if ($round === null) {
        return $status;
    }

    foreach ($draws as $draw) {
        $friendId = (int) $draw['friend_id'];
        if ((int) $draw['round_id'] !== (int) $round['id'] || $draw['cancelled_at'] !== null || !isset($status[$friendId])) {
            continue;
        }
        $status[$friendId] = $draw['replaced_at'] === null
            ? ['status' => 'drawn', 'reason' => null]
            : ['status' => 'out', 'reason' => "Zamijenjen u kolu {$round['number']}"];
    }

    // Važeća izvlačenja iz ranijih kola, od najstarijeg.
    $past = array_values(array_filter(
        $draws,
        fn (array $d) => (int) $d['round_number'] < (int) $round['number'] && $d['replaced_at'] === null && $d['cancelled_at'] === null
    ));
    usort($past, fn (array $a, array $b) => [(int) $a['round_number'], (int) $a['slot']] <=> [(int) $b['round_number'], (int) $b['slot']]);

    $excluded = [];
    if ($rule === 'pause' && $past) {
        $last = (int) end($past)['round_number'];
        foreach ($past as $draw) {
            if ((int) $draw['round_number'] === $last) {
                $excluded[(int) $draw['friend_id']] = "Pauzira, izvučen u kolu {$last}";
            }
        }
    }
    if ($rule === 'cycle') {
        $cycle = [];
        foreach ($past as $draw) {
            if (count($cycle) >= count($friendIds)) {
                $cycle = [];
            }
            $cycle[(int) $draw['friend_id']] = (int) $draw['round_number'];
        }
        if (count($cycle) >= count($friendIds)) {
            $cycle = [];
        }
        foreach ($cycle as $friendId => $number) {
            $excluded[$friendId] = "Već birao u ovom krugu, kolo {$number}";
        }
    }

    $byRule = [];
    foreach ($excluded as $friendId => $reason) {
        if (($status[$friendId]['status'] ?? null) === 'in') {
            $status[$friendId] = ['status' => 'out', 'reason' => $reason];
            $byRule[] = $friendId;
        }
    }
    // Fer krug: kad u bubnju ne ostane niko, počinje novi krug.
    if ($rule === 'cycle' && !in_array('in', array_column($status, 'status'), true)) {
        foreach ($byRule as $friendId) {
            $status[$friendId] = ['status' => 'in', 'reason' => null];
        }
    }
    return $status;
}

function friendRows(PDO $db): array
{
    return $db->query(
        'SELECT f.id, f.name, u.username FROM friends f LEFT JOIN users u ON u.friend_id = f.id ORDER BY f.id'
    )->fetchAll();
}

function drawState(PDO $db): array
{
    $rule = getSetting($db, 'draw_rule', 'pause');
    $round = drawRound($db);
    $friends = friendRows($db);
    $draws = loadDraws($db);
    $status = drumStatus(array_map(fn (array $f) => (int) $f['id'], $friends), $draws, $round, $rule);

    return [
        'rule' => $rule,
        'round' => $round === null ? null : [
            'id' => (int) $round['id'],
            'number' => (int) $round['number'],
            'status' => $round['status'],
        ],
        'people' => array_map(fn (array $f) => [
            'friendId' => (int) $f['id'],
            'name' => $f['name'],
            // Na lopti piše nadimak (korisničko ime), jer se inicijali i imena ponavljaju.
            'short' => $f['username'] !== null
                ? mb_convert_case($f['username'], MB_CASE_TITLE)
                : explode(' ', $f['name'])[0],
            'status' => $status[(int) $f['id']]['status'],
            'reason' => $status[(int) $f['id']]['reason'],
        ], $friends),
        'draws' => array_map(fn (array $d) => [
            'id' => (int) $d['id'],
            'roundNumber' => (int) $d['round_number'],
            'friendId' => (int) $d['friend_id'],
            'slot' => (int) $d['slot'],
            'drawnAt' => $d['drawn_at'],
            'replacedAt' => $d['replaced_at'],
            'cancelledAt' => $d['cancelled_at'],
            'drawnBy' => $d['drawn_by'],
        ], $draws),
    ];
}

// Server bira loptu (random_int je kriptografski siguran), ne pregledač.
function drawIntoSlot(PDO $db, array $round, int $slot, int $userId): int
{
    $friendIds = array_map(fn (array $f) => (int) $f['id'], friendRows($db));
    $status = drumStatus($friendIds, loadDraws($db), $round, getSetting($db, 'draw_rule', 'pause'));
    $candidates = array_keys(array_filter($status, fn (array $s) => $s['status'] === 'in'));
    if (!$candidates) {
        fail(409, 'U bubnju nema nikoga za izvlačenje.');
    }
    $friendId = $candidates[random_int(0, count($candidates) - 1)];
    $db->prepare('INSERT INTO draws (round_id, friend_id, slot, drawn_by, drawn_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$round['id'], $friendId, $slot, $userId, date('Y-m-d H:i:s')]);
    return $friendId;
}
