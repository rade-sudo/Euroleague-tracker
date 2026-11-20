<?php

declare(strict_types=1);

// all: svih 6 je uvijek u bubnju; pause: izvučeni u prošlom izvlačenju pauziraju jedno;
// cycle: niko ne bira drugi put dok svi ne dođu na red.
// Kad se kolo igra dva dana, svaki dan tiketa ima svoje izvlačenje (draws.day).
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

// Dani izvlačenja u kolu: dani tiketa iz rasporeda. Kolo bez rasporeda ima jedno izvlačenje (dan null).
function drawDays(PDO $db, array $round): array
{
    $days = [];
    foreach (roundSchedule($db, (int) $round['number']) as $day) {
        if ($day['ticket']) {
            $days[] = ['date' => $day['date'], 'deadline' => $day['deadline'], 'locked' => $day['locked']];
        }
    }
    return $days ?: [['date' => null, 'deadline' => null, 'locked' => false]];
}

// Dan iz zahtjeva mora biti dan tiketa tog kola.
function drawDayFor(PDO $db, array $round, mixed $day): ?string
{
    $dates = array_column(drawDays($db, $round), 'date');
    if ($dates === [null]) {
        return null;
    }
    if (!is_string($day) || !in_array($day, $dates, true)) {
        fail(422, 'Taj dan nije dan tiketa ovog kola.');
    }
    return $day;
}

// "za petak (kolo 4)" ili "u kolu 3"
function drawWhen(int $roundNumber, ?string $day): string
{
    return $day === null ? "u kolu {$roundNumber}" : 'za ' . dayAccusative($day) . " (kolo {$roundNumber})";
}

// Izvlačenja od prije bubnja po danima dobiju dan: u tekućem kolu prvi dan tiketa,
// a u ranijim dan kad je izvučeni imao dva igrača (inače prvi dan tiketa).
function assignDrawDays(PDO $db): void
{
    $rows = $db->query(
        "SELECT d.id, d.round_id, d.friend_id, r.number, r.status FROM draws d JOIN rounds r ON r.id = d.round_id WHERE d.day IS NULL"
    )->fetchAll();
    if (!$rows) {
        return;
    }
    $current = drawRound($db);
    $twoPicksDay = $db->prepare(
        'SELECT DATE_FORMAT(g.starts_at, \'%Y-%m-%d\') AS day FROM picks p JOIN games g ON g.id = p.game_id
         WHERE p.round_id = ? AND p.friend_id = ? GROUP BY day HAVING COUNT(*) >= 2 ORDER BY day LIMIT 1'
    );
    $update = $db->prepare('UPDATE draws SET day = ? WHERE id = ?');
    $daysByRound = [];
    foreach ($rows as $row) {
        $daysByRound[$row['round_id']] ??= array_column(drawDays($db, $row), 'date');
        $dates = $daysByRound[$row['round_id']];
        if ($dates === [null]) {
            continue;
        }
        $day = $dates[0];
        if ($current === null || (int) $current['id'] !== (int) $row['round_id']) {
            $twoPicksDay->execute([$row['round_id'], $row['friend_id']]);
            $found = $twoPicksDay->fetchColumn();
            if ($found !== false && in_array($found, $dates, true)) {
                $day = $found;
            }
        }
        $update->execute([$day, $row['id']]);
    }
}

function loadDraws(PDO $db): array
{
    return $db->query(
        "SELECT d.id, d.round_id, r.number AS round_number, DATE_FORMAT(d.day, '%Y-%m-%d') AS day, d.friend_id, d.slot,
                DATE_FORMAT(d.drawn_at, '%Y-%m-%dT%H:%i') AS drawn_at,
                DATE_FORMAT(d.replaced_at, '%Y-%m-%dT%H:%i') AS replaced_at,
                DATE_FORMAT(d.cancelled_at, '%Y-%m-%dT%H:%i') AS cancelled_at,
                u.username AS drawn_by
         FROM draws d
         JOIN rounds r ON r.id = d.round_id
         LEFT JOIN users u ON u.id = d.drawn_by
         ORDER BY r.number DESC, d.day DESC, d.id"
    )->fetchAll();
}

function activeDrawSlots(PDO $db, int $roundId, ?string $day): array
{
    $stmt = $db->prepare('SELECT slot FROM draws WHERE round_id = ? AND day <=> ? AND replaced_at IS NULL AND cancelled_at IS NULL');
    $stmt->execute([$roundId, $day]);
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

// Ko u kolu bira 2 igrača i za koji dan: [['friendId' => 3, 'day' => '2026-10-09'], ...].
function roundTwoPicks(PDO $db, int $roundId): array
{
    $stmt = $db->prepare(
        "SELECT friend_id, DATE_FORMAT(day, '%Y-%m-%d') AS day FROM draws
         WHERE round_id = ? AND replaced_at IS NULL AND cancelled_at IS NULL ORDER BY day, slot"
    );
    $stmt->execute([$roundId]);
    return array_map(fn (array $r) => ['friendId' => (int) $r['friend_id'], 'day' => $r['day']], $stmt->fetchAll());
}

// Redoslijed izvlačenja: kolo, pa dan.
function drawKey(int $roundNumber, ?string $day): string
{
    return sprintf('%05d %s', $roundNumber, $day ?? '');
}

// Za svakog prijatelja u izvlačenju (kolo, dan): u bubnju (in), izvučen (drawn) ili van bubnja (out) uz razlog.
function drumStatus(array $friendIds, array $draws, ?array $round, ?string $day, string $rule): array
{
    $status = [];
    foreach ($friendIds as $id) {
        $status[$id] = ['status' => 'in', 'reason' => null];
    }
    if ($round === null) {
        return $status;
    }
    $currentKey = drawKey((int) $round['number'], $day);

    foreach ($draws as $draw) {
        $friendId = (int) $draw['friend_id'];
        if ((int) $draw['round_id'] !== (int) $round['id'] || $draw['day'] !== $day
            || $draw['cancelled_at'] !== null || !isset($status[$friendId])) {
            continue;
        }
        $status[$friendId] = $draw['replaced_at'] === null
            ? ['status' => 'drawn', 'reason' => null]
            : ['status' => 'out', 'reason' => 'Zamijenjen ' . drawWhen((int) $round['number'], $day)];
    }

    // Važeća ranija izvlačenja, od najstarijeg.
    $past = array_values(array_filter(
        $draws,
        fn (array $d) => drawKey((int) $d['round_number'], $d['day']) < $currentKey && $d['replaced_at'] === null && $d['cancelled_at'] === null
    ));
    usort($past, fn (array $a, array $b) => [drawKey((int) $a['round_number'], $a['day']), (int) $a['slot']]
        <=> [drawKey((int) $b['round_number'], $b['day']), (int) $b['slot']]);

    $excluded = [];
    if ($rule === 'pause' && $past) {
        $last = end($past);
        $lastKey = drawKey((int) $last['round_number'], $last['day']);
        foreach ($past as $draw) {
            if (drawKey((int) $draw['round_number'], $draw['day']) === $lastKey) {
                $excluded[(int) $draw['friend_id']] = 'Pauzira, izvučen ' . drawWhen((int) $draw['round_number'], $draw['day']);
            }
        }
    }
    if ($rule === 'cycle') {
        $cycle = [];
        foreach ($past as $draw) {
            if (count($cycle) >= count($friendIds)) {
                $cycle = [];
            }
            $cycle[(int) $draw['friend_id']] = drawWhen((int) $draw['round_number'], $draw['day']);
        }
        if (count($cycle) >= count($friendIds)) {
            $cycle = [];
        }
        foreach ($cycle as $friendId => $when) {
            $excluded[$friendId] = "Već birao u ovom krugu, {$when}";
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

function skippedDrawDays(PDO $db, int $roundId): array
{
    $stmt = $db->prepare("SELECT DATE_FORMAT(day, '%Y-%m-%d') FROM draw_skips WHERE round_id = ?");
    $stmt->execute([$roundId]);
    return $stmt->fetchAll(PDO::FETCH_COLUMN);
}

// Stanje bubnja za izabrani dan. Bez izbora: prvi dan koji još nije izvučen (ni preskočen).
function drawState(PDO $db, mixed $requestedDay = null): array
{
    assignDrawDays($db);
    $rule = getSetting($db, 'draw_rule', 'pause');
    $round = drawRound($db);
    $friends = friendRows($db);
    $draws = loadDraws($db);

    $days = [];
    $selected = null;
    if ($round !== null) {
        $skipped = skippedDrawDays($db, (int) $round['id']);
        foreach (drawDays($db, $round) as $day) {
            $drawn = array_values(array_map(fn (array $d) => (int) $d['friend_id'], array_filter(
                $draws,
                fn (array $d) => (int) $d['round_id'] === (int) $round['id'] && $d['day'] === $day['date']
                    && $d['replaced_at'] === null && $d['cancelled_at'] === null
            )));
            $days[] = $day + ['drawn' => $drawn, 'skipped' => in_array($day['date'], $skipped, true)];
        }
        $dates = array_column($days, 'date');
        if (in_array($requestedDay, $dates, true)) {
            $selected = $requestedDay;
        } else {
            $open = array_values(array_filter($days, fn (array $d) => count($d['drawn']) < 2 && !$d['skipped']));
            $selected = ($open[0] ?? end($days))['date'];
        }
    }
    $status = drumStatus(array_map(fn (array $f) => (int) $f['id'], $friends), $draws, $round, $selected, $rule);

    return [
        'rule' => $rule,
        'round' => $round === null ? null : [
            'id' => (int) $round['id'],
            'number' => (int) $round['number'],
            'status' => $round['status'],
        ],
        'days' => $days,
        'day' => $selected,
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
            'day' => $d['day'],
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
function drawIntoSlot(PDO $db, array $round, ?string $day, int $slot, int $userId): int
{
    $stmt = $db->prepare('SELECT 1 FROM draw_skips WHERE round_id = ? AND day <=> ?');
    $stmt->execute([$round['id'], $day]);
    if ($stmt->fetchColumn()) {
        fail(409, 'Za taj dan je izabrano da se ne izvlači.');
    }
    $friendIds = array_map(fn (array $f) => (int) $f['id'], friendRows($db));
    $status = drumStatus($friendIds, loadDraws($db), $round, $day, getSetting($db, 'draw_rule', 'pause'));
    $candidates = array_keys(array_filter($status, fn (array $s) => $s['status'] === 'in'));
    if (!$candidates) {
        fail(409, 'U bubnju nema nikoga za izvlačenje.');
    }
    $friendId = $candidates[random_int(0, count($candidates) - 1)];
    $db->prepare('INSERT INTO draws (round_id, day, friend_id, slot, drawn_by, drawn_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$round['id'], $day, $friendId, $slot, $userId, date('Y-m-d H:i:s')]);
    return $friendId;
}

// "Ne izvlačimo za ovaj dan" (jedan tiket) i povratak. Preskočen dan se ne broji za pauzu.
function setDrawSkip(PDO $db, array $round, ?string $day, bool $skip): void
{
    if ($day === null) {
        fail(422, 'Kolo bez rasporeda nema dane za preskakanje.');
    }
    if ($skip && activeDrawSlots($db, (int) $round['id'], $day)) {
        fail(409, 'Za taj dan je već izvlačeno. Prvo poništi izvlačenje.');
    }
    $db->prepare($skip
        ? 'INSERT IGNORE INTO draw_skips (round_id, day) VALUES (?, ?)'
        : 'DELETE FROM draw_skips WHERE round_id = ? AND day = ?')->execute([$round['id'], $day]);
}
