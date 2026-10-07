<?php

declare(strict_types=1);

// Kratko ime za statistiku: nadimak (korisničko ime), a kad je to ime koje ima još neko
// u ekipi, dodaje se inicijal prezimena ("Milan K." pored "Milje").
function friendShortNames(array $friends): array
{
    $firstName = fn (array $f) => explode(' ', trim($f['name']))[0];
    $counts = array_count_values(array_map($firstName, $friends));
    $short = [];
    foreach ($friends as $friend) {
        $first = $firstName($friend);
        $nick = $friend['username'] !== null ? mb_convert_case($friend['username'], MB_CASE_TITLE) : $first;
        if ($nick === $first && $counts[$first] > 1) {
            $parts = explode(' ', trim($friend['name']));
            $nick .= ' ' . mb_substr(end($parts), 0, 1) . '.';
        }
        $short[(int) $friend['id']] = $nick;
    }
    return $short;
}

// Statistika je ista za sve: samo ocijenjeni igrači (✓ ili ✗), iz svih kola.
function statsPayload(PDO $db): array
{
    $friends = $db->query(
        'SELECT f.id, f.name, u.username FROM friends f LEFT JOIN users u ON u.friend_id = f.id ORDER BY f.id'
    )->fetchAll();
    $short = friendShortNames($friends);

    $picks = [];
    $rows = $db->query(
        'SELECT r.number, p.friend_id, p.player_id, p.player, pl.name AS player_name, pl.club_name, p.hit
         FROM picks p
         JOIN rounds r ON r.id = p.round_id
         LEFT JOIN players pl ON pl.id = p.player_id
         WHERE p.hit IS NOT NULL
         ORDER BY r.number, p.id'
    );
    foreach ($rows as $row) {
        $picks[] = [
            'round' => (int) $row['number'],
            'friendId' => (int) $row['friend_id'],
            // Isti igrač ima isti ključ, i kad nije povezan sa spiskom (po upisanom tekstu).
            'playerKey' => $row['player_id'] !== null ? 'p' . $row['player_id'] : 't' . normalizePlayerName($row['player']),
            'player' => $row['player_name'] ?? $row['player'],
            'club' => $row['club_name'],
            'hit' => (bool) $row['hit'],
        ];
    }

    return [
        'season' => currentSeasonCode(),
        'friends' => array_map(fn (array $f) => [
            'id' => (int) $f['id'],
            'name' => $f['name'],
            'short' => $short[(int) $f['id']],
        ], $friends),
        'picks' => $picks,
    ];
}
