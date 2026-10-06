<?php

declare(strict_types=1);

// Greške idu u log servera, ne u odgovor (pokvarile bi JSON i otkrile putanje).
ini_set('display_errors', '0');

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/tickets.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const MAX_NAME_LENGTH = 24;
const MAX_PLAYED = 99;

function respond(int $status, mixed $body = null): never
{
    http_response_code($status);
    if ($body !== null) {
        echo json_encode($body, JSON_UNESCAPED_UNICODE);
    }
    exit;
}

function fail(int $status, string $message): never
{
    respond($status, ['error' => $message]);
}

set_exception_handler(function (Throwable $e): void {
    error_log((string) $e);
    fail(500, 'Greška na serveru.');
});

function readJson(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($data)) {
        fail(400, 'Neispravan JSON.');
    }
    return $data;
}

function normalizeName(mixed $name): string
{
    return trim(preg_replace('/\s+/u', ' ', (string) $name));
}

// "pogođeni/odigrani" -> [hits, played]; null ako vrijednost nije ispravna.
function parseResult(mixed $value): ?array
{
    if (!is_string($value) || !preg_match('#^(\d{1,2})/(\d{1,2})$#', $value, $m)) {
        return null;
    }
    $hits = (int) $m[1];
    $played = (int) $m[2];
    if ($played === 0 || $played > MAX_PLAYED || $hits > $played) {
        return null;
    }
    return [$hits, $played];
}

function isDuplicateKey(PDOException $e): bool
{
    return ($e->errorInfo[1] ?? null) === 1062;
}

function loadState(PDO $db): array
{
    $friends = $db->query('SELECT id, name FROM friends ORDER BY id')->fetchAll();
    $rounds = $db->query('SELECT ' . ROUND_COLUMNS . ' FROM rounds ORDER BY number')->fetchAll();

    $results = [];
    foreach ($db->query('SELECT friend_id, round_id, hits, played FROM results') as $row) {
        $results[$row['friend_id']][$row['round_id']] = "{$row['hits']}/{$row['played']}";
    }

    return [
        'friends' => $friends,
        'rounds' => $rounds,
        // Objekti, ne nizovi, da JSON uvijek bude {friendId: {roundId: "1/2"}}.
        'results' => (object) array_map(fn (array $byRound) => (object) $byRound, $results),
    ];
}

// Sve poslije "/api", da radi i kad je aplikacija u podfolderu na hostingu.
$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$route = rtrim(preg_replace('#^.*?/api(?=/|$)#', '', $path), '/') ?: '/';

// Zaštita od CSRF-a: tuđi sajt ne može poslati JSON zahtjev sa našim kolačićem bez CORS dozvole.
if ($method !== 'GET' && !str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
    fail(415, 'Zahtjev mora biti JSON.');
}

try {
    $db = connect();
} catch (PDOException $e) {
    error_log($e->getMessage());
    fail(503, 'Baza nije dostupna. Provjeri da li je MySQL u Laragonu pokrenut.');
}

if ($route === '/login' && $method === 'POST') {
    $body = readJson();
    $username = normalizeName($body['username'] ?? '');
    $password = (string) ($body['password'] ?? '');
    if ($username === '' || $password === '') {
        fail(422, 'Upiši korisničko ime i lozinku.');
    }
    try {
        $user = attemptLogin($db, $username, $password, $_SERVER['REMOTE_ADDR'] ?? '');
    } catch (TooManyAttempts) {
        fail(429, 'Previše neuspjelih pokušaja. Sačekaj ' . LOGIN_WINDOW_MINUTES . ' minuta pa pokušaj ponovo.');
    }
    if ($user === null) {
        fail(401, 'Pogrešno korisničko ime ili lozinka. Provjeri velika i mala slova i pokušaj ponovo.');
    }
    startSession($db, $user['id'], (bool) ($body['remember'] ?? false));
    respond(200, ['user' => publicUser($user)]);
}

if ($route === '/logout' && $method === 'POST') {
    endSession($db);
    respond(204);
}

$user = currentUser($db);
if ($user === null) {
    fail(401, 'Prijavi se da nastaviš.');
}

if ($route === '/me' && $method === 'GET') {
    respond(200, ['user' => publicUser($user)]);
}

// Svako smije mijenjati svoj tiket; sve ostale izmjene radi samo admin.
$isTicketEdit = ($method === 'POST' && preg_match('#^/rounds/\d+/picks$#', $route))
    || ($method === 'DELETE' && preg_match('#^/picks/\d+$#', $route));
if ($method !== 'GET' && !$isTicketEdit && $user['role'] !== 'admin') {
    fail(403, 'Samo admin može mijenjati tabelu.');
}

if ($route === '/state' && $method === 'GET') {
    respond(200, loadState($db));
}

if (preg_match('#^/rounds/(\d+)/tickets$#', $route, $m) && $method === 'GET') {
    $round = findRound($db, (int) $m[1]);
    $reveal = $user['role'] === 'admin' ? (filter_var($_GET['reveal'] ?? null, FILTER_VALIDATE_INT) ?: null) : null;
    respond(200, ['tickets' => loadTickets($db, $round, $user, $reveal)]);
}

if (preg_match('#^/rounds/(\d+)/picks$#', $route, $m) && $method === 'POST') {
    $round = findRound($db, (int) $m[1]);
    if ($round['status'] !== 'open') {
        fail(409, 'Kolo je zaključano, tiket se više ne može mijenjati.');
    }
    $body = readJson();
    $friendId = filter_var($body['friendId'] ?? null, FILTER_VALIDATE_INT);
    if ($friendId === false) {
        fail(422, 'Nedostaje čiji je tiket.');
    }
    assertCanEditTicket($user, $friendId);

    $player = normalizeName($body['player'] ?? '');
    $tip = normalizeName($body['tip'] ?? '');
    if ($player === '') {
        fail(422, 'Upiši ime igrača.');
    }
    if (mb_strlen($player) > MAX_PLAYER_LENGTH) {
        fail(422, 'Ime igrača može imati najviše ' . MAX_PLAYER_LENGTH . ' znakova.');
    }
    if (mb_strlen($tip) > MAX_TIP_LENGTH) {
        fail(422, 'Tip može imati najviše ' . MAX_TIP_LENGTH . ' znakova.');
    }
    $stmt = $db->prepare('SELECT COUNT(*) FROM picks WHERE round_id = ? AND friend_id = ?');
    $stmt->execute([$round['id'], $friendId]);
    if ((int) $stmt->fetchColumn() >= MAX_PICKS_PER_TICKET) {
        fail(422, 'Na tiketu može biti najviše ' . MAX_PICKS_PER_TICKET . ' igrača.');
    }
    try {
        $db->prepare('INSERT INTO picks (round_id, friend_id, player, tip) VALUES (?, ?, ?, ?)')
            ->execute([$round['id'], $friendId, $player, $tip]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1452) {
            fail(404, 'Prijatelj ne postoji.');
        }
        throw $e;
    }
    respond(201, ['id' => (int) $db->lastInsertId(), 'player' => $player, 'tip' => $tip, 'hit' => null]);
}

if (preg_match('#^/picks/(\d+)$#', $route, $m) && $method === 'DELETE') {
    $pick = findPick($db, (int) $m[1]);
    assertCanEditTicket($user, (int) $pick['friend_id']);
    if ($pick['status'] !== 'open') {
        fail(409, 'Kolo je zaključano, tiket se više ne može mijenjati.');
    }
    $db->prepare('DELETE FROM picks WHERE id = ?')->execute([$pick['id']]);
    respond(204);
}

// Ocjena igrača (samo admin, kad je kolo završeno): {"hit": true | false | null}.
if (preg_match('#^/picks/(\d+)$#', $route, $m) && $method === 'PUT') {
    $pick = findPick($db, (int) $m[1]);
    if ($pick['status'] !== 'done') {
        fail(409, 'Igrači se ocjenjuju tek kad je kolo završeno.');
    }
    $hit = readJson()['hit'] ?? null;
    if ($hit !== null && !is_bool($hit)) {
        fail(422, 'Ocjena mora biti pogođeno, promašeno ili prazno.');
    }
    $db->beginTransaction();
    $db->prepare('UPDATE picks SET hit = ? WHERE id = ?')->execute([$hit === null ? null : (int) $hit, $pick['id']]);
    $result = syncResultFromPicks($db, (int) $pick['round_id'], (int) $pick['friend_id']);
    $db->commit();
    respond(200, ['result' => $result]);
}

// Faza kola i rok za predaju: {"status": "open|locked|done", "deadline": "2026-10-09T18:45" | null}.
if (preg_match('#^/rounds/(\d+)$#', $route, $m) && $method === 'PUT') {
    $round = findRound($db, (int) $m[1]);
    $body = readJson();
    if (array_key_exists('status', $body)) {
        if (!in_array($body['status'], ROUND_STATUSES, true)) {
            fail(422, 'Nepoznata faza kola.');
        }
        $db->prepare('UPDATE rounds SET status = ? WHERE id = ?')->execute([$body['status'], $round['id']]);
    }
    if (array_key_exists('deadline', $body)) {
        $deadline = $body['deadline'];
        if ($deadline !== null && (!is_string($deadline) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $deadline))) {
            fail(422, 'Rok nije ispravan.');
        }
        $db->prepare('UPDATE rounds SET deadline_at = ? WHERE id = ?')
            ->execute([$deadline === null ? null : str_replace('T', ' ', $deadline) . ':00', $round['id']]);
    }
    respond(200, findRound($db, $round['id']));
}

if ($route === '/friends' && $method === 'POST') {
    $name = normalizeName(readJson()['name'] ?? '');
    if ($name === '') {
        fail(422, 'Upiši ime prijatelja.');
    }
    if (mb_strlen($name) > MAX_NAME_LENGTH) {
        fail(422, 'Ime može imati najviše ' . MAX_NAME_LENGTH . ' znaka.');
    }
    try {
        $db->prepare('INSERT INTO friends (name) VALUES (?)')->execute([$name]);
    } catch (PDOException $e) {
        if (isDuplicateKey($e)) {
            fail(409, "„{$name}“ je već na listi.");
        }
        throw $e;
    }
    respond(201, ['id' => (int) $db->lastInsertId(), 'name' => $name]);
}

if (preg_match('#^/friends/(\d+)$#', $route, $m) && $method === 'DELETE') {
    $stmt = $db->prepare('DELETE FROM friends WHERE id = ?');
    $stmt->execute([(int) $m[1]]);
    if ($stmt->rowCount() === 0) {
        fail(404, 'Prijatelj ne postoji.');
    }
    respond(204);
}

if ($route === '/rounds' && $method === 'POST') {
    $db->beginTransaction();
    $number = (int) $db->query('SELECT COALESCE(MAX(number), 0) + 1 FROM rounds FOR UPDATE')->fetchColumn();
    $db->prepare('INSERT INTO rounds (number) VALUES (?)')->execute([$number]);
    $id = (int) $db->lastInsertId();
    $db->commit();
    respond(201, findRound($db, $id));
}

if (preg_match('#^/rounds/(\d+)$#', $route, $m) && $method === 'DELETE') {
    $stmt = $db->prepare('DELETE FROM rounds WHERE id = ?');
    $stmt->execute([(int) $m[1]]);
    if ($stmt->rowCount() === 0) {
        fail(404, 'Kolo ne postoji.');
    }
    respond(204);
}

// Prazna vrijednost briše rezultat (prijatelj nije igrao to kolo).
if ($route === '/results' && $method === 'PUT') {
    $body = readJson();
    $friendId = filter_var($body['friendId'] ?? null, FILTER_VALIDATE_INT);
    $roundId = filter_var($body['roundId'] ?? null, FILTER_VALIDATE_INT);
    $value = $body['value'] ?? '';
    if ($friendId === false || $roundId === false) {
        fail(422, 'Nedostaje prijatelj ili kolo.');
    }

    if ($value === '') {
        $db->prepare('DELETE FROM results WHERE friend_id = ? AND round_id = ?')->execute([$friendId, $roundId]);
        respond(204);
    }

    $parsed = parseResult($value);
    if ($parsed === null) {
        fail(422, 'Format rezultata je pogođeni/odigrani, npr. 1/2.');
    }
    try {
        $db->prepare(
            'INSERT INTO results (friend_id, round_id, hits, played) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE hits = VALUES(hits), played = VALUES(played)'
        )->execute([$friendId, $roundId, ...$parsed]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1452) {
            fail(404, 'Prijatelj ili kolo više ne postoji.');
        }
        throw $e;
    }
    respond(204);
}

// Jednokratni uvoz podataka koji su ranije čuvani u localStorage-u pregledača.
if ($route === '/import' && $method === 'POST') {
    $body = readJson();
    $hasData = (int) $db->query('SELECT (SELECT COUNT(*) FROM friends) + (SELECT COUNT(*) FROM results)')->fetchColumn();
    if ($hasData > 0) {
        fail(409, 'Baza već ima podatke, uvoz je moguć samo u praznu bazu.');
    }

    $db->beginTransaction();
    $db->exec('DELETE FROM rounds');

    $friendIds = [];
    $insertFriend = $db->prepare('INSERT INTO friends (name) VALUES (?)');
    foreach ((array) ($body['friends'] ?? []) as $friend) {
        $name = normalizeName($friend['name'] ?? '');
        if ($name === '' || mb_strlen($name) > MAX_NAME_LENGTH) {
            continue;
        }
        try {
            $insertFriend->execute([$name]);
        } catch (PDOException $e) {
            if (isDuplicateKey($e)) {
                continue;
            }
            throw $e;
        }
        $friendIds[(string) ($friend['id'] ?? '')] = (int) $db->lastInsertId();
    }

    $roundIds = [];
    $insertRound = $db->prepare("INSERT INTO rounds (number, status) VALUES (?, 'done')");
    foreach ((array) ($body['rounds'] ?? []) as $round) {
        $number = filter_var($round['number'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($number === false) {
            continue;
        }
        try {
            $insertRound->execute([$number]);
        } catch (PDOException $e) {
            if (isDuplicateKey($e)) {
                continue;
            }
            throw $e;
        }
        $roundIds[(string) ($round['id'] ?? '')] = (int) $db->lastInsertId();
    }

    $insertResult = $db->prepare('INSERT INTO results (friend_id, round_id, hits, played) VALUES (?, ?, ?, ?)');
    foreach ((array) ($body['results'] ?? []) as $oldFriendId => $byRound) {
        foreach ((array) $byRound as $oldRoundId => $value) {
            $friendId = $friendIds[(string) $oldFriendId] ?? null;
            $roundId = $roundIds[(string) $oldRoundId] ?? null;
            $parsed = parseResult($value);
            if ($friendId && $roundId && $parsed) {
                $insertResult->execute([$friendId, $roundId, ...$parsed]);
            }
        }
    }

    $db->commit();
    respond(200, loadState($db));
}

fail(404, 'Nepoznata ruta.');
