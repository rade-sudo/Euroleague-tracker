<?php

declare(strict_types=1);

// Greške idu u log servera, ne u odgovor (pokvarile bi JSON i otkrile putanje).
ini_set('display_errors', '0');
// Vrijeme izvlačenja se upisuje po našoj zoni, bez obzira na zonu servera.
date_default_timezone_set('Europe/Belgrade');

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/tickets.php';
require __DIR__ . '/draws.php';
require __DIR__ . '/players.php';
require __DIR__ . '/schedule.php';
require __DIR__ . '/slips.php';
require __DIR__ . '/overview.php';
require __DIR__ . '/push.php';
require __DIR__ . '/notifications.php';
require __DIR__ . '/stats.php';
require __DIR__ . '/account.php';
require __DIR__ . '/backups.php';

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

// Raspored i poeni sa Euroleague sajta. Greška tu ne smije srušiti stranicu: ostaju stari podaci.
function syncSafely(PDO $db): void
{
    try {
        syncEuroleague($db);
        dispatchNotificationsThrottled($db);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log((string) $e);
    }
}

function notifySafely(PDO $db): void
{
    try {
        dispatchNotifications($db);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log((string) $e);
    }
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
        // Pobjednik svakog završenog kola: {roundId: {friendIds, hits, played, points, runnerUp}}.
        'winners' => (object) roundWinners($db),
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
$isOwnAccount = ($method === 'POST' && in_array($route, ['/account/password', '/push/subscribe', '/push/unsubscribe', '/push/test'], true))
    || ($method === 'PUT' && $route === '/notifications');
if ($method !== 'GET' && !$isTicketEdit && !$isOwnAccount && $user['role'] !== 'admin') {
    fail(403, 'Samo admin može mijenjati tabelu.');
}

if ($route === '/state' && $method === 'GET') {
    syncSafely($db);
    respond(200, loadState($db) + ['me' => mePayload($db, $user)]);
}

if (preg_match('#^/rounds/(\d+)/tickets$#', $route, $m) && $method === 'GET') {
    syncSafely($db);
    $round = findRound($db, (int) $m[1]);
    $schedule = roundSchedule($db, (int) $round['number']);
    $tickets = loadTickets($db, $round);
    respond(200, [
        'round' => $round,
        'tickets' => $tickets,
        'players' => playerCards($db, $tickets, (int) $round['id']),
        // Izvučeni iz bubnja: u ovom kolu biraju po 2 igrača.
        'twoPicks' => activeDrawFriendIds($db, (int) $round['id']),
        'schedule' => $schedule,
        // Tiket 1 i 2 po danu; drugari vide samo uplaćene.
        'slips' => roundSlips($db, (int) $round['id'], $user['role'] === 'admin'),
        'stakePerPlayer' => STAKE_PER_PLAYER,
        'winner' => roundWinners($db)[(int) $round['id']] ?? null,
        'autoGrade' => (int) $round['number'] >= autoGradeFromRound($db),
        'results' => roundResults($db, (int) $round['id']),
    ]);
}

if ($route === '/draw' && $method === 'GET') {
    respond(200, drawState($db));
}

if ($route === '/draw' && $method === 'POST') {
    $db->beginTransaction();
    $round = lockRound($db, readJson()['roundId'] ?? null);
    $taken = activeDrawSlots($db, (int) $round['id']);
    $free = array_values(array_diff(DRAW_SLOTS, $taken));
    if (!$free) {
        fail(409, 'Oba su već izvučena za ovo kolo.');
    }
    $friendId = drawIntoSlot($db, $round, $free[0], $user['id']);
    $db->commit();
    notifySafely($db);
    respond(200, ['drawnFriendId' => $friendId, 'state' => drawState($db)]);
}

// Zamjena: izvučeni ne igra ovo kolo, pa na njegovo mjesto izlazi novi iz bubnja.
if ($route === '/draw/replace' && $method === 'POST') {
    $body = readJson();
    $db->beginTransaction();
    $round = lockRound($db, $body['roundId'] ?? null);
    $slot = filter_var($body['slot'] ?? null, FILTER_VALIDATE_INT);
    $stmt = $db->prepare('UPDATE draws SET replaced_at = ? WHERE round_id = ? AND slot = ? AND replaced_at IS NULL AND cancelled_at IS NULL');
    $stmt->execute([date('Y-m-d H:i:s'), $round['id'], $slot === false ? 0 : $slot]);
    if ($stmt->rowCount() === 0) {
        fail(404, 'Na tom mjestu nema izvučenog.');
    }
    $friendId = drawIntoSlot($db, $round, $slot, $user['id']);
    $db->commit();
    notifySafely($db);
    respond(200, ['drawnFriendId' => $friendId, 'state' => drawState($db)]);
}

// Poništavanje ne briše ništa: izvlačenje ostaje u istoriji označeno kao poništeno.
if ($route === '/draw/cancel' && $method === 'POST') {
    $db->beginTransaction();
    $round = lockRound($db, readJson()['roundId'] ?? null);
    $stmt = $db->prepare('UPDATE draws SET cancelled_at = ? WHERE round_id = ? AND cancelled_at IS NULL');
    $stmt->execute([date('Y-m-d H:i:s'), $round['id']]);
    if ($stmt->rowCount() === 0) {
        fail(409, 'Za ovo kolo nema izvlačenja koje bi se poništilo.');
    }
    $db->commit();
    respond(200, drawState($db));
}

if ($route === '/draw/rule' && $method === 'PUT') {
    $rule = readJson()['rule'] ?? null;
    if (!in_array($rule, DRAW_RULES, true)) {
        fail(422, 'Nepoznato pravilo bubnja.');
    }
    setSetting($db, 'draw_rule', $rule);
    respond(200, drawState($db));
}

if (preg_match('#^/rounds/(\d+)/picks$#', $route, $m) && $method === 'POST') {
    $round = findRound($db, (int) $m[1]);
    $isAdmin = $user['role'] === 'admin';
    // Admin smije dopisati igrača i posle roka (kad ga drugar zamoli), dok kolo nije završeno.
    if ($round['status'] !== 'open' && !($isAdmin && $round['status'] === 'locked')) {
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
    // Igrač izabran sa spiska, ili prepoznat iz upisanog teksta; inače ostaje tekst kako je upisan.
    $catalogPlayer = isset($body['playerId'])
        ? findPlayerById($db, $body['playerId'])
        : matchPlayer(playerIndex($db), $player);
    if ($catalogPlayer !== null) {
        $player = mb_substr($catalogPlayer['name'], 0, MAX_PICK_NAME_LENGTH);
    }
    // Kad kolo ima raspored, igrač mora biti sa spiska: po klubu se zna utakmica, dan tiketa i rok.
    $schedule = roundSchedule($db, (int) $round['number']);
    $gameId = null;
    if ($schedule) {
        if ($catalogPlayer === null) {
            fail(422, "Ne prepoznajem igrača „{$player}“. Izaberi ga sa spiska ispod polja.");
        }
        $gameId = gameForPick($db, $schedule, $catalogPlayer, (int) $round['number'], $isAdmin);
    }
    $duplicate = duplicatePick($db, (int) $round['id'], $catalogPlayer['id'] ?? null, $player);
    if ($duplicate !== null) {
        $when = $duplicate['day'] ? 'za ' . dayAccusative($duplicate['day']) : 'u ovom kolu';
        fail(409, (int) $duplicate['friend_id'] === $friendId
            ? "{$player} je već na ovom tiketu."
            : "Igrača {$player} je već izabrao {$duplicate['name']} {$when}. Isti igrač se ne bira dvaput za isto veče.");
    }
    try {
        $db->prepare('INSERT INTO picks (round_id, friend_id, player_id, game_id, player, tip) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$round['id'], $friendId, $catalogPlayer['id'] ?? null, $gameId, $player, $tip]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1452) {
            fail(404, 'Prijatelj ne postoji.');
        }
        throw $e;
    }
    respond(201, loadPick($db, (int) $db->lastInsertId()));
}

if ($route === '/notifications' && $method === 'GET') {
    respond(200, notificationSettings($db, $user));
}

if ($route === '/notifications' && $method === 'PUT') {
    saveNotificationSettings($db, $user, readJson()['off'] ?? []);
    respond(200, notificationSettings($db, $user));
}

if ($route === '/push/subscribe' && $method === 'POST') {
    savePushSubscription($db, $user, readJson());
    respond(200, notificationSettings($db, $user));
}

if ($route === '/push/unsubscribe' && $method === 'POST') {
    deletePushSubscription($db, $user, readJson()['endpoint'] ?? '');
    respond(200, notificationSettings($db, $user));
}

if ($route === '/push/test' && $method === 'POST') {
    $sent = sendTestNotification($db, $user);
    if ($sent === 0) {
        fail(502, 'Probno obavještenje nije poslato. Isključi pa ponovo uključi obavještenja na ovom uređaju.');
    }
    respond(200, ['sent' => $sent]);
}

// Tiketi kola (samo admin): napravi po pravilu, prebaci igrača, kvota i isplata.
if (preg_match('#^/rounds/(\d+)/slips$#', $route, $m) && $method === 'POST') {
    $round = findRound($db, (int) $m[1]);
    $day = readJson()['day'] ?? null;
    if ($day !== null && (!is_string($day) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $day))) {
        fail(422, 'Dan nije ispravan.');
    }
    $db->beginTransaction();
    if (createSlipsForDay($db, (int) $round['id'], $day, true) === 0) {
        fail(409, 'Za taj dan tiketi već postoje ili nema igrača.');
    }
    $db->commit();
    respond(201, roundSlips($db, (int) $round['id'], true));
}

if (preg_match('#^/picks/(\d+)/slip$#', $route, $m) && $method === 'PUT') {
    $db->beginTransaction();
    movePickToSlip($db, (int) $m[1], readJson()['number'] ?? null);
    $db->commit();
    respond(204);
}

if (preg_match('#^/slips/(\d+)$#', $route, $m) && $method === 'PUT') {
    updateSlip($db, (int) $m[1], readJson());
    respond(204);
}

// Kasa: svi vide, uplate upisuje admin.
if ($route === '/cash' && $method === 'GET') {
    respond(200, cashPayload($db));
}

if ($route === '/cash/payments' && $method === 'POST') {
    addCashPayment($db, readJson());
    respond(201, cashPayload($db));
}

if (preg_match('#^/cash/payments/(\d+)$#', $route, $m) && $method === 'DELETE') {
    $stmt = $db->prepare('DELETE FROM cash_payments WHERE id = ?');
    $stmt->execute([(int) $m[1]]);
    if ($stmt->rowCount() === 0) {
        fail(404, 'Uplata ne postoji.');
    }
    respond(200, cashPayload($db));
}

if ($route === '/account' && $method === 'GET') {
    respond(200, accountPayload($db, $user));
}

if ($route === '/account/password' && $method === 'POST') {
    $body = readJson();
    changePassword($db, $user, (string) ($body['current'] ?? ''), (string) ($body['next'] ?? ''), $_SERVER['REMOTE_ADDR'] ?? '');
    respond(200, accountPayload($db, $user));
}

// Rezervne kopije baze: samo admin.
if (str_starts_with($route, '/backup') && $method === 'GET' && $user['role'] !== 'admin') {
    fail(403, 'Rezervne kopije vidi samo admin.');
}

if ($route === '/backups' && $method === 'GET') {
    respond(200, ['files' => listBackups(), 'keep' => BACKUP_KEEP]);
}

if ($route === '/backup/download' && $method === 'GET') {
    sendSqlDownload('euroliga-tiketi-' . date('Y-m-d') . '.sql', createBackupSql($db));
}

if (preg_match('#^/backups/([^/]+)$#', $route, $m) && $method === 'GET') {
    $name = rawurldecode($m[1]);
    $path = backupDir() . DIRECTORY_SEPARATOR . $name;
    if (!preg_match(BACKUP_NAME_PATTERN, $name) || !is_file($path)) {
        fail(404, 'Ta kopija ne postoji.');
    }
    sendSqlDownload($name, (string) file_get_contents($path));
}

if ($route === '/stats' && $method === 'GET') {
    respond(200, statsPayload($db));
}

if ($route === '/players' && $method === 'GET') {
    respond(200, playersPayload($db, $user['role'] === 'admin'));
}

if ($route === '/players/refresh' && $method === 'POST') {
    $result = refreshPlayers($db);
    respond(200, ['result' => $result, 'catalog' => playersPayload($db, true)]);
}

// Skraćenica: kako neko piše igrača. Odmah povezuje i već upisane igrače sa tim imenom.
if ($route === '/players/aliases' && $method === 'POST') {
    $body = readJson();
    $alias = normalizeName($body['alias'] ?? '');
    $normalized = normalizePlayerName($alias);
    if ($normalized === '') {
        fail(422, 'Upiši skraćenicu.');
    }
    if (mb_strlen($alias) > 60) {
        fail(422, 'Skraćenica može imati najviše 60 znakova.');
    }
    $player = findPlayerById($db, $body['playerId'] ?? null);
    $stmt = $db->prepare('SELECT p.name FROM player_aliases a JOIN players p ON p.id = a.player_id WHERE a.normalized = ?');
    $stmt->execute([$normalized]);
    if (($existing = $stmt->fetchColumn()) !== false) {
        fail(409, "Skraćenica „{$alias}“ već postoji i vodi na igrača {$existing}.");
    }
    $db->beginTransaction();
    $db->prepare('INSERT INTO player_aliases (player_id, alias, normalized, created_at) VALUES (?, ?, ?, ?)')
        ->execute([$player['id'], $alias, $normalized, date('Y-m-d H:i:s')]);
    $linked = linkUnlinkedPicks($db);
    $db->commit();
    respond(201, ['linked' => $linked, 'catalog' => playersPayload($db, true)]);
}

if (preg_match('#^/players/aliases/(\d+)$#', $route, $m) && $method === 'DELETE') {
    $stmt = $db->prepare('DELETE FROM player_aliases WHERE id = ?');
    $stmt->execute([(int) $m[1]]);
    if ($stmt->rowCount() === 0) {
        fail(404, 'Skraćenica ne postoji.');
    }
    respond(200, ['catalog' => playersPayload($db, true)]);
}

if (preg_match('#^/picks/(\d+)$#', $route, $m) && $method === 'DELETE') {
    $pick = findPick($db, (int) $m[1]);
    assertCanEditTicket($user, (int) $pick['friend_id']);
    $isAdmin = $user['role'] === 'admin';
    if ($isAdmin ? $pick['status'] === 'done' : $pick['status'] !== 'open') {
        fail(409, 'Kolo je zaključano, tiket se više ne može mijenjati.');
    }
    $day = scheduleDayOfGame(roundSchedule($db, (int) $pick['number']), $pick['game_id'] === null ? null : (int) $pick['game_id']);
    if (!$isAdmin && ($day['locked'] ?? false)) {
        fail(409, 'Tiket za ' . dayAccusative($day['date']) . ' je zaključan u ' . substr($day['deadline'], 11)
            . ', igrači za taj dan se više ne mogu mijenjati.');
    }
    $db->prepare('DELETE FROM picks WHERE id = ?')->execute([$pick['id']]);
    respond(204);
}

// Granica sa Maxbeta (samo admin): {"line": "15.5" | null}. Ako je utakmica gotova, ocjena stiže odmah.
if (preg_match('#^/picks/(\d+)/line$#', $route, $m) && $method === 'PUT') {
    $pick = findPick($db, (int) $m[1]);
    $line = parseLine(readJson()['line'] ?? null);
    $db->beginTransaction();
    $db->prepare('UPDATE picks SET line = ? WHERE id = ?')->execute([$line, $pick['id']]);
    autoGradeRound($db, (int) $pick['round_id']);
    $db->commit();
    respond(200, ['pick' => loadPick($db, (int) $pick['id']), 'results' => roundResults($db, (int) $pick['round_id'])]);
}

// Ocjena igrača (samo admin, kad je njegov dan tiketa zaključan): {"hit": true | false | null}.
// Ocjenu koju da admin automatske ne mijenjaju; prazna vraća igrača automatskim ocjenama.
if (preg_match('#^/picks/(\d+)$#', $route, $m) && $method === 'PUT') {
    $pick = findPick($db, (int) $m[1]);
    $schedule = roundSchedule($db, (int) $pick['number']);
    if (!pickLocked($pick, $schedule, $pick['game_id'] === null ? null : (int) $pick['game_id'])) {
        fail(409, 'Igrači se ocjenjuju tek kad se njihov tiket zaključa.');
    }
    $hit = readJson()['hit'] ?? null;
    if ($hit !== null && !is_bool($hit)) {
        fail(422, 'Ocjena mora biti pogođeno, promašeno ili prazno.');
    }
    $db->beginTransaction();
    $db->prepare('UPDATE picks SET hit = ?, graded_by = ? WHERE id = ?')
        ->execute([$hit === null ? null : (int) $hit, $hit === null ? null : 'admin', $pick['id']]);
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
    notifySafely($db);
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
