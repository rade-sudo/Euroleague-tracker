<?php

declare(strict_types=1);

// Obavještenja: šta se šalje, kome i kada. Server periodično pregleda stanje (cron na 5 minuta,
// uz to i pri otvaranju aplikacije) i šalje svaki događaj samo jednom (tabela notifications_sent).
const NOTIFICATION_TYPES = [
    'open' => ['name' => 'Novo kolo', 'when' => 'Kad admin otvori kolo'],
    'drum' => ['name' => 'Izvučen iz bubnja', 'when' => 'Kad te bubanj izvuče da biraš 2 igrača'],
    'deadline' => ['name' => 'Podsjetnik pred rok', 'when' => 'Sat prije roka, ako u kolu još nemaš nijednog igrača'],
    'locked' => ['name' => 'Dan tiketa zaključan', 'when' => 'Kad se dan tiketa zaključa i igrači se više ne mogu mijenjati'],
    'graded' => ['name' => 'Ocjena mog igrača', 'when' => 'Kad tvoj igrač dobije ✓ ili ✗'],
    'results' => ['name' => 'Rezultati kola', 'when' => 'Kad su svi igrači kola ocijenjeni'],
    'slip' => ['name' => 'Tiket prošao', 'when' => 'Kad tiket prođe, sa tvojim dijelom isplate'],
    'lines' => ['name' => 'Upiši granice', 'when' => 'Kad se dan tiketa zaključa', 'admin' => true],
    'waiting' => ['name' => 'Igrač čeka ocjenu', 'when' => 'Utakmica gotova, a granica nije upisana', 'admin' => true],
];
const NOTIFY_CHECK_SECONDS = 60;
// Zakašnjeli događaj (npr. cron nije radio) se ne šalje: zastarjelo obavještenje samo zbunjuje.
const NOTIFY_LATE_SECONDS = 2 * 3600;
const NOTIFY_RECENT_ROUNDS = 3;
const DAY_NOMINATIVE = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

function notificationTypesFor(array $user): array
{
    return array_filter(NOTIFICATION_TYPES, fn (array $type) => empty($type['admin']) || $user['role'] === 'admin');
}

function notificationsOff(string $value): array
{
    return array_values(array_filter(explode(',', $value), fn (string $id) => isset(NOTIFICATION_TYPES[$id])));
}

function notificationSettings(PDO $db, array $user): array
{
    $stmt = $db->prepare('SELECT notifications_off FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $off = notificationsOff((string) $stmt->fetchColumn());
    $stmt = $db->prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?');
    $stmt->execute([$user['id']]);

    $types = [];
    foreach (notificationTypesFor($user) as $id => $type) {
        $types[] = ['id' => $id, 'name' => $type['name'], 'when' => $type['when'], 'admin' => !empty($type['admin']), 'on' => !in_array($id, $off, true)];
    }
    return ['publicKey' => vapidPublicKey($db), 'types' => $types, 'devices' => (int) $stmt->fetchColumn()];
}

function saveNotificationSettings(PDO $db, array $user, mixed $off): void
{
    $off = is_array($off) ? notificationsOff(implode(',', array_filter($off, 'is_string'))) : [];
    $db->prepare('UPDATE users SET notifications_off = ? WHERE id = ?')->execute([implode(',', $off), $user['id']]);
}

// "četvrtak u 17:30"
function dayAndTime(string $deadline): string
{
    return DAY_NOMINATIVE[(int) date('w', strtotime($deadline))] . ' u ' . substr($deadline, 11, 5);
}

// 72.96 → "72,96 KM"
function money(float $value): string
{
    return number_format($value, 2, ',', '.') . ' KM';
}

function playersCount(int $n): string
{
    return $n . ($n % 10 === 1 && $n % 100 !== 11 ? ' igrač' : ' igrača');
}

// Prvi dan tiketa kola koji još nije zaključan.
function nextTicketDay(array $schedule): ?array
{
    foreach ($schedule as $day) {
        if ($day['ticket'] && !$day['locked']) {
            return $day;
        }
    }
    return null;
}

function pickVerdictText(array $pick): string
{
    $verdict = $pick['hit'] ? 'Prošao.' : 'Nije prošao.';
    if ($pick['did_play'] !== null && !$pick['did_play']) {
        return 'Nije igrao, računa se kao prošao.';
    }
    if ($pick['points'] === null) {
        return $verdict;
    }
    $line = $pick['line'] === null ? '' : ', granica ' . rtrim(rtrim($pick['line'], '0'), '.') . ' ' . ($pick['tip'] ?: '+');
    return "{$pick['points']} poena{$line}. {$verdict}";
}

// Svi događaji koji bi sada trebali biti poslati: ['key', 'type', 'recipients' => [userId => poruka]].
function collectNotificationEvents(PDO $db, array $users): array
{
    $now = time();
    $events = [];
    $viewers = array_keys(array_filter($users, fn (array $u) => $u['role'] !== 'admin'));
    $admins = array_keys(array_filter($users, fn (array $u) => $u['role'] === 'admin'));
    $byFriend = [];
    foreach ($users as $id => $u) {
        if ($u['friend_id'] !== null) {
            $byFriend[(int) $u['friend_id']] = $id;
        }
    }
    $toAll = fn (array $ids, array $message) => array_fill_keys($ids, $message);

    $rounds = $db->query('SELECT id, number, status FROM rounds ORDER BY number DESC LIMIT ' . NOTIFY_RECENT_ROUNDS)->fetchAll();
    $autoFrom = autoGradeFromRound($db);

    foreach ($rounds as $round) {
        $roundId = (int) $round['id'];
        $number = (int) $round['number'];
        $schedule = roundSchedule($db, $number);
        $ticketDays = array_values(array_filter($schedule, fn (array $day) => $day['ticket']));
        $next = nextTicketDay($schedule);

        $stmt = $db->prepare('SELECT id, friend_id, game_id, player, tip, line, points, did_play, hit FROM picks WHERE round_id = ? ORDER BY id');
        $stmt->execute([$roundId]);
        $picks = $stmt->fetchAll();
        $friendsWithPicks = array_unique(array_map(fn (array $p) => (int) $p['friend_id'], $picks));

        // Novo kolo: drugarima, dok se još bira.
        if ($round['status'] === 'open' && (!$ticketDays || $next !== null)) {
            $deadlines = array_map(fn (array $day) => dayAndTime($day['deadline']), array_filter($ticketDays, fn (array $day) => !$day['locked']));
            $body = match (count($deadlines)) {
                0 => 'Upiši svoje igrače.',
                1 => 'Rok: ' . $deadlines[array_key_first($deadlines)] . '.',
                default => 'Rokovi: ' . implode(' i ', $deadlines) . '.',
            };
            $events[] = ['key' => "open:{$roundId}", 'type' => 'open', 'recipients' => $toAll($viewers, [
                'title' => "Kolo {$number} je otvoreno", 'body' => $body, 'tag' => "open-{$roundId}",
            ])];
        }

        // Izvučeni iz bubnja.
        if ($round['status'] !== 'done') {
            $stmt = $db->prepare('SELECT id, friend_id FROM draws WHERE round_id = ? AND cancelled_at IS NULL AND replaced_at IS NULL');
            $stmt->execute([$roundId]);
            foreach ($stmt as $draw) {
                $userId = $byFriend[(int) $draw['friend_id']] ?? null;
                if ($userId === null) {
                    continue;
                }
                $body = "U kolu {$number} biraš 2 igrača." . ($next ? ' Prvi rok je u ' . dayAccusative($next['date']) . ' u ' . substr($next['deadline'], 11, 5) . '.' : '');
                $events[] = ['key' => "drum:{$draw['id']}", 'type' => 'drum', 'recipients' => [
                    $userId => ['title' => 'Izvučen si iz bubnja', 'body' => $body, 'tag' => "drum-{$roundId}"],
                ]];
            }
        }

        // Dani tiketa: podsjetnik sat prije roka, zaključavanje, granice za admina.
        foreach ($ticketDays as $day) {
            $deadline = strtotime($day['deadline']);
            $dayName = dayAccusative($day['date']);
            $time = substr($day['deadline'], 11, 5);
            $dayGameIds = array_map(fn (array $game) => $game['id'], $day['games']);
            $dayPicks = array_filter($picks, fn (array $p) => in_array((int) $p['game_id'], $dayGameIds, true));

            if ($round['status'] === 'open' && !$day['locked'] && $now >= $deadline - 3600) {
                $missing = array_diff(array_keys($byFriend), $friendsWithPicks);
                $events[] = ['key' => "deadline:{$roundId}:{$day['date']}", 'type' => 'deadline', 'recipients' => $toAll(
                    array_map(fn (int $friendId) => $byFriend[$friendId], $missing),
                    ['title' => 'Tiket se zaključava za sat', 'body' => "Još nisi upisao igrače za kolo {$number}. Tiket za {$dayName} se zaključava u {$time}.", 'tag' => "deadline-{$roundId}"],
                )];
            }
            if ($day['locked'] && $now < $deadline + NOTIFY_LATE_SECONDS && $dayPicks) {
                $events[] = ['key' => "locked:{$roundId}:{$day['date']}", 'type' => 'locked', 'recipients' => $toAll(array_keys($users), [
                    'title' => "Tiket za {$dayName} je zaključan", 'body' => "Igrači za {$dayName} se više ne mogu mijenjati. Srećno!", 'tag' => "locked-{$roundId}-{$day['date']}",
                ])];
                $withoutLine = count(array_filter($dayPicks, fn (array $p) => $p['line'] === null));
                if ($number >= $autoFrom && $withoutLine > 0) {
                    $events[] = ['key' => "lines:{$roundId}:{$day['date']}", 'type' => 'lines', 'recipients' => $toAll($admins, [
                        'title' => "Upiši granice za {$dayName}", 'body' => 'Granicu sa Maxbeta čeka ' . playersCount($withoutLine) . '.', 'tag' => "lines-{$roundId}-{$day['date']}",
                    ])];
                }
            }
        }

        // Igrači koji su odigrali, a nemaju granicu ni ocjenu (admin), grupisani po danu.
        if ($number >= $autoFrom) {
            $waiting = [];
            foreach ($picks as $pick) {
                if ((int) $pick['did_play'] === 1 && $pick['line'] === null && $pick['hit'] === null) {
                    $date = scheduleDayOfGame($schedule, $pick['game_id'] === null ? null : (int) $pick['game_id'])['date'] ?? 'bez-dana';
                    $waiting[$date][] = $pick;
                }
            }
            foreach ($waiting as $date => $list) {
                $names = array_map(fn (array $p) => $p['player'], $list);
                $message = count($list) === 1
                    ? ['title' => "{$names[0]} čeka granicu", 'body' => "Dao je {$list[0]['points']} poena, a granica nije upisana pa nema ocjene."]
                    : ['title' => playersCount(count($list)) . ' čeka granicu', 'body' => 'Utakmice su gotove, a granica nije upisana: ' . implode(', ', $names) . '.'];
                $events[] = ['key' => "waiting:{$roundId}:{$date}", 'type' => 'waiting', 'recipients' => $toAll($admins, $message + ['tag' => "waiting-{$roundId}-{$date}"])];
            }
        }

        // Ocjena svakog igrača, vlasniku tiketa.
        foreach ($picks as $pick) {
            $userId = $byFriend[(int) $pick['friend_id']] ?? null;
            if ($pick['hit'] === null || $userId === null) {
                continue;
            }
            $events[] = ['key' => "graded:{$pick['id']}", 'type' => 'graded', 'recipients' => [$userId => [
                'title' => $pick['player'] . ($pick['hit'] ? ' ✓' : ' ✗'), 'body' => pickVerdictText($pick), 'tag' => "graded-{$pick['id']}",
            ]]];
        }

        // Tiket prošao: svima, a onima čiji su igrači na tiketu i njihov dio isplate.
        foreach (playedSlips($db, [$roundId]) as $slip) {
            if ($slip['status'] !== 'won') {
                continue;
            }
            $when = $slip['day'] ? ', ' . DAY_NOMINATIVE[(int) date('w', strtotime($slip['day']))] : '';
            $base = "Kolo {$number}{$when}: isplata " . money($slip['value']) . '.';
            $recipients = [];
            foreach ($users as $id => $u) {
                $share = $u['friend_id'] === null ? 0 : ($slip['members'][(int) $u['friend_id']] ?? 0);
                $recipients[$id] = [
                    'title' => "Tiket {$slip['number']} je prošao!",
                    'body' => $base . ($share ? ' Tvoj dio: ' . money($slip['value'] * $share / $slip['players']) . '.' : ''),
                    'tag' => "slip-{$slip['id']}",
                ];
            }
            $events[] = ['key' => "slip:{$slip['id']}", 'type' => 'slip', 'recipients' => $recipients];
        }

        // Rezultati kola, kad je sve ocijenjeno.
        if ($round['status'] === 'done' && $picks && !array_filter($picks, fn (array $p) => $p['hit'] === null)) {
            $leader = tableLeader($db);
            $results = roundResults($db, $roundId);
            $winner = roundWinners($db)[$roundId] ?? null;
            $names = $db->query('SELECT id, name FROM friends')->fetchAll(PDO::FETCH_KEY_PAIR);
            $winnerText = $winner
                ? (count($winner['friendIds']) > 1 ? ' Pobjednici kola: ' : ' Pobjednik kola: ')
                    . implode(', ', array_map(fn (int $id) => $names[$id] ?? '', $winner['friendIds'])) . " ({$winner['hits']}/{$winner['played']})."
                : '';
            $recipients = [];
            foreach ($users as $id => $u) {
                $own = $u['friend_id'] === null ? null : ($results->{$u['friend_id']} ?? null);
                $won = $winner && $u['friend_id'] !== null && in_array((int) $u['friend_id'], $winner['friendIds'], true);
                $recipients[$id] = [
                    'title' => $won ? "Osvojio si kolo {$number}!" : "Rezultati kola {$number}",
                    'body' => ($own ? "Tvoj tiket: {$own}." : "Kolo {$number} je završeno.") . ($won ? '' : $winnerText) . ($leader ? " Na vrhu tabele: {$leader}." : ''),
                    'tag' => "results-{$roundId}",
                ];
            }
            $events[] = ['key' => "results:{$roundId}", 'type' => 'results', 'recipients' => $recipients];
        }
    }
    return $events;
}

// "Milan Kapetina, 67%": najveći procenat pogođenih u cijeloj tabeli.
function tableLeader(PDO $db): ?string
{
    $row = $db->query(
        'SELECT f.name, SUM(r.hits) / SUM(r.played) AS ratio FROM results r JOIN friends f ON f.id = r.friend_id
         GROUP BY f.id, f.name HAVING SUM(r.played) > 0 ORDER BY ratio DESC, SUM(r.hits) DESC LIMIT 1'
    )->fetch();
    return $row ? $row['name'] . ', ' . round((float) $row['ratio'] * 100) . '%' : null;
}

// Pregleda stanje i šalje sve što još nije poslato. Pri prvom pokretanju samo zapamti
// postojeće događaje, da drugari ne dobiju obavještenja za stara kola.
function dispatchNotifications(PDO $db): int
{
    $seeding = getSetting($db, 'notifications_seeded_at', '') === '';
    $users = [];
    foreach ($db->query('SELECT id, role, friend_id, notifications_off FROM users') as $row) {
        $users[(int) $row['id']] = $row + ['off' => notificationsOff($row['notifications_off'])];
    }
    $subscriptions = [];
    foreach ($db->query('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions') as $row) {
        $subscriptions[(int) $row['user_id']][] = $row;
    }
    $sentKeys = array_flip($db->query('SELECT event_key FROM notifications_sent WHERE sent_at > DATE_SUB(NOW(), INTERVAL 60 DAY)')->fetchAll(PDO::FETCH_COLUMN));
    $claim = $db->prepare('INSERT IGNORE INTO notifications_sent (event_key, sent_at) VALUES (?, ?)');

    $deliveries = [];
    foreach (collectNotificationEvents($db, $users) as $event) {
        if (isset($sentKeys[$event['key']])) {
            continue;
        }
        // Upis ključa je i brava: ako cron i stranica stignu u isto vrijeme, šalje samo jedan.
        $claim->execute([$event['key'], date('Y-m-d H:i:s')]);
        if ($claim->rowCount() === 0 || $seeding) {
            continue;
        }
        $adminOnly = !empty(NOTIFICATION_TYPES[$event['type']]['admin']);
        foreach ($event['recipients'] as $userId => $message) {
            $user = $users[$userId] ?? null;
            if ($user === null || in_array($event['type'], $user['off'], true) || ($adminOnly && $user['role'] !== 'admin')) {
                continue;
            }
            foreach ($subscriptions[$userId] ?? [] as $subscription) {
                $deliveries[] = [$subscription, $message + ['url' => '/']];
            }
        }
    }
    if ($seeding) {
        setSetting($db, 'notifications_seeded_at', date('Y-m-d H:i:s'));
    }
    return $deliveries ? sendPushBatch($db, $deliveries) : 0;
}

// Pri otvaranju aplikacije, najviše jednom u minuti; cron radi isto na 5 minuta.
function dispatchNotificationsThrottled(PDO $db): void
{
    $last = getSetting($db, 'notifications_checked_at', '');
    if ($last !== '' && time() - strtotime($last) < NOTIFY_CHECK_SECONDS) {
        return;
    }
    setSetting($db, 'notifications_checked_at', date('Y-m-d H:i:s'));
    dispatchNotifications($db);
}

function sendTestNotification(PDO $db, array $user): int
{
    $stmt = $db->prepare('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?');
    $stmt->execute([$user['id']]);
    $message = ['title' => 'Probno obavještenje', 'body' => 'Ovako će izgledati obavještenja iz Tiketa.', 'tag' => 'test', 'url' => '/nalog'];
    return sendPushBatch($db, array_map(fn (array $subscription) => [$subscription, $message], $stmt->fetchAll()));
}
