<?php

declare(strict_types=1);

// Javni API koji koristi i euroleaguebasketball.net; personType=J vraća samo igrače.
const EUROLEAGUE_PLAYERS_URL = 'https://api-live.euroleague.net/v2/competitions/E/seasons/%s/people?personType=J';
const MAX_PICK_NAME_LENGTH = 40;

// Sezona počinje u julu: oktobar 2026 je sezona 2026/27, kod E2026.
function currentSeasonCode(): string
{
    $year = (int) date('Y');
    return 'E' . ((int) date('n') >= 7 ? $year : $year - 1);
}

// Za poređenje imena: bez kvačica, velikih slova i znakova, pa su "Horton-Tucker",
// "horton tucker" i "Mirotić" / "Mirotic" isti. Isto pravilo je u src/players.js.
function normalizePlayerName(string $text): string
{
    $text = strtr(mb_strtolower($text), ['đ' => 'dj', 'ð' => 'd', 'ł' => 'l', 'ø' => 'o', 'ß' => 'ss', 'æ' => 'ae', 'œ' => 'oe', 'ı' => 'i']);
    if (class_exists('Normalizer')) {
        $text = preg_replace('/\p{Mn}+/u', '', Normalizer::normalize($text, Normalizer::FORM_D));
    } else {
        $text = strtr($text, [
            'č' => 'c', 'ć' => 'c', 'š' => 's', 'ž' => 'z', 'á' => 'a', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a',
            'å' => 'a', 'ā' => 'a', 'ą' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'ē' => 'e', 'ė' => 'e',
            'ę' => 'e', 'ě' => 'e', 'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ī' => 'i', 'į' => 'i', 'ó' => 'o',
            'ò' => 'o', 'ô' => 'o', 'ö' => 'o', 'õ' => 'o', 'ő' => 'o', 'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'ū' => 'u', 'ů' => 'u', 'ű' => 'u', 'ų' => 'u', 'ý' => 'y', 'ñ' => 'n', 'ń' => 'n', 'ň' => 'n', 'ņ' => 'n',
            'ç' => 'c', 'ğ' => 'g', 'ģ' => 'g', 'ş' => 's', 'ś' => 's', 'ź' => 'z', 'ż' => 'z', 'ř' => 'r', 'ť' => 't',
            'ď' => 'd', 'ķ' => 'k', 'ļ' => 'l',
        ]);
    }
    return trim(preg_replace('/[^a-z0-9]+/', ' ', $text));
}

// "TJ" i "DJ" ostaju velikim slovima, "Jr." ne; "MCINTYRE" postaje "McIntyre".
function titleCaseName(string $part): string
{
    $pieces = preg_split("/([\\s\\-']+)/u", mb_strtolower(trim($part)), -1, PREG_SPLIT_DELIM_CAPTURE);
    foreach ($pieces as &$piece) {
        if ($piece === '' || preg_match("/^[\\s\\-']+$/u", $piece)) {
            continue;
        }
        if (in_array($piece, ['ii', 'iii', 'iv'], true)
            || preg_match('/^([a-z]\.)+[a-z]?$/', $piece)
            || (strlen($piece) === 2 && !preg_match('/[aeiouy]/', $piece) && !in_array($piece, ['jr', 'sr'], true))) {
            $piece = strtoupper($piece);
        } elseif (str_starts_with($piece, 'mc') && mb_strlen($piece) > 2) {
            $piece = 'Mc' . mb_strtoupper(mb_substr($piece, 2, 1)) . mb_substr($piece, 3);
        } else {
            $piece = mb_strtoupper(mb_substr($piece, 0, 1)) . mb_substr($piece, 1);
        }
    }
    return implode('', $pieces);
}

// API daje "HORTON TUCKER, TALEN"; crtica se uzima sa dresa ("HORTON-TUCKER") → "Talen Horton-Tucker".
function formatPlayerName(string $apiName, string $jerseyName): string
{
    [$last, $first] = array_pad(array_map('trim', explode(',', $apiName, 2)), 2, '');
    $letters = fn (string $s) => preg_replace('/[^A-Z]/', '', strtoupper($s));
    if (str_contains($jerseyName, '-') && $letters($jerseyName) === $letters($last)) {
        $last = $jerseyName;
    }
    return trim(titleCaseName($first) . ' ' . titleCaseName($last));
}

// JSON sa Euroleague API-ja; null ako sajt ne odgovara (greška ide u log servera).
function fetchJson(string $url, int $timeout = 25): ?array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $body = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);

    if ($body === false || $status !== 200) {
        error_log("Euroleague API {$url}: HTTP {$status} {$error}");
        return null;
    }
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

function fetchEuroleaguePlayers(string $season): array
{
    $response = fetchJson(sprintf(EUROLEAGUE_PLAYERS_URL, $season));
    if ($response === null) {
        fail(502, 'Euroleague sajt trenutno ne odgovara. Pokušaj ponovo za koji minut.');
    }
    $data = $response['data'] ?? null;
    if (!is_array($data)) {
        fail(502, 'Euroleague sajt je vratio neočekivan odgovor.');
    }
    return $data;
}

// Upisuje spisak igrača za sezonu. Igrač koji je promijenio klub ima više unosa:
// važi aktivni, a među njima najnoviji. Ko nije u spisku, ostaje u bazi kao neaktivan.
function refreshPlayers(PDO $db): array
{
    $best = [];
    foreach (fetchEuroleaguePlayers(currentSeasonCode()) as $entry) {
        $code = (string) ($entry['person']['code'] ?? '');
        if ($code === '' || ($entry['type'] ?? '') !== 'J') {
            continue;
        }
        $previous = $best[$code] ?? null;
        $active = (bool) ($entry['active'] ?? false);
        if ($previous === null
            || ($active && !$previous['active'])
            || ($active === (bool) $previous['active'] && ($entry['startDate'] ?? '') > ($previous['startDate'] ?? ''))) {
            $best[$code] = $entry;
        }
    }
    if (!$best) {
        fail(502, 'Euroleague sajt nije vratio nijednog igrača za ovu sezonu.');
    }

    $now = date('Y-m-d H:i:s');
    $db->beginTransaction();
    $db->exec('UPDATE players SET active = 0');
    $upsert = $db->prepare(
        'INSERT INTO players (code, name, club_code, club_name, active, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), club_code = VALUES(club_code), club_name = VALUES(club_name),
                                 active = VALUES(active), updated_at = VALUES(updated_at)'
    );
    foreach ($best as $code => $entry) {
        $upsert->execute([
            $code,
            mb_substr(formatPlayerName((string) $entry['person']['name'], (string) ($entry['person']['jerseyName'] ?? '')), 0, 60),
            $entry['club']['code'] ?? null,
            mb_substr((string) ($entry['club']['abbreviatedName'] ?? $entry['club']['name'] ?? ''), 0, 60) ?: null,
            (int) (bool) ($entry['active'] ?? false),
            $now,
        ]);
    }
    $linked = linkUnlinkedPicks($db);
    setSetting($db, 'players_updated_at', $now);
    $db->commit();

    return ['count' => count($best), 'linked' => $linked];
}

// Sve što treba za prepoznavanje imena, učitano jednom.
function playerIndex(PDO $db): array
{
    $aliases = [];
    foreach ($db->query('SELECT a.normalized, p.id, p.name FROM player_aliases a JOIN players p ON p.id = a.player_id') as $row) {
        $aliases[$row['normalized']] = ['id' => (int) $row['id'], 'name' => $row['name']];
    }
    $players = [];
    foreach ($db->query('SELECT id, name, active FROM players') as $row) {
        $players[] = [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'active' => (bool) $row['active'],
            'tokens' => explode(' ', normalizePlayerName($row['name'])),
        ];
    }
    return ['aliases' => $aliases, 'players' => $players];
}

// Prepoznaje igrača iz upisanog teksta: prvo skraćenice, pa ime u kojem se nalazi svaka
// upisana riječ ("Vezenkov", "TJ Shorts"). Ako odgovara više igrača, ne pogađa.
function matchPlayer(array $index, string $text): ?array
{
    $normalized = normalizePlayerName($text);
    if ($normalized === '') {
        return null;
    }
    if (isset($index['aliases'][$normalized])) {
        return $index['aliases'][$normalized];
    }
    $words = explode(' ', $normalized);
    $all = array_values(array_filter($index['players'], fn (array $p) => !array_diff($words, $p['tokens'])));
    $active = array_values(array_filter($all, fn (array $p) => $p['active']));
    foreach ([$active, $all] as $candidates) {
        if (count($candidates) === 1) {
            return ['id' => $candidates[0]['id'], 'name' => $candidates[0]['name']];
        }
    }
    return null;
}

// Povezuje upisane igrače koji još nisu sa spiska (npr. poslije nove skraćenice).
function linkUnlinkedPicks(PDO $db): int
{
    $index = playerIndex($db);
    $update = $db->prepare('UPDATE picks SET player_id = ?, player = ? WHERE id = ?');
    $linked = 0;
    foreach ($db->query('SELECT id, player FROM picks WHERE player_id IS NULL')->fetchAll() as $pick) {
        $player = matchPlayer($index, $pick['player']);
        if ($player !== null) {
            $update->execute([$player['id'], mb_substr($player['name'], 0, MAX_PICK_NAME_LENGTH), $pick['id']]);
            $linked++;
        }
    }
    linkPicksToGames($db, currentSeasonCode());
    return $linked;
}

function playersPayload(PDO $db, bool $isAdmin): array
{
    $payload = [
        'season' => currentSeasonCode(),
        'updatedAt' => ($at = getSetting($db, 'players_updated_at', '')) === '' ? null : str_replace(' ', 'T', substr($at, 0, 16)),
        'players' => array_map(fn (array $row) => [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'club' => $row['club_name'],
            'active' => (bool) $row['active'],
        ], $db->query('SELECT id, name, club_name, active FROM players ORDER BY name')->fetchAll()),
        'aliases' => array_map(fn (array $row) => [
            'id' => (int) $row['id'],
            'alias' => $row['alias'],
            'playerId' => (int) $row['player_id'],
        ], $db->query('SELECT id, alias, player_id FROM player_aliases ORDER BY alias')->fetchAll()),
    ];

    if ($isAdmin) {
        // Upisana imena koja nisu prepoznata, grupisana po tome kako su napisana.
        $groups = [];
        foreach ($db->query('SELECT player FROM picks WHERE player_id IS NULL ORDER BY id')->fetchAll() as $pick) {
            $key = normalizePlayerName($pick['player']);
            $groups[$key] ??= ['text' => $pick['player'], 'count' => 0];
            $groups[$key]['count']++;
        }
        $payload['unlinked'] = array_values($groups);
    }
    return $payload;
}

function findPlayerById(PDO $db, mixed $id): array
{
    $stmt = $db->prepare('SELECT id, name FROM players WHERE id = ?');
    $stmt->execute([filter_var($id, FILTER_VALIDATE_INT) ?: 0]);
    $row = $stmt->fetch() ?: fail(404, 'Igrač nije na spisku.');
    return ['id' => (int) $row['id'], 'name' => $row['name']];
}
