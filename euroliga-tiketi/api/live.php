<?php
declare(strict_types=1);

// Tiketi uživo: stanje utakmica i igrača sa tiketa dok utakmica traje (Euroleague live API).
// Svaka utakmica se sa Eurolige čita najviše jednom u LIVE_CACHE_SECONDS, koliko god nas gledalo;
// zapamćeno stoji u settings (live_<gameId>), pa ne treba nova tabela.
// Konačnu ocjenu i dalje daje zapisnik poslije utakmice (fillPickStats).

const LIVE_HEADER_URL = 'https://live.euroleague.net/api/Header?gamecode=%d&seasoncode=%s';
const LIVE_BOXSCORE_URL = 'https://live.euroleague.net/api/Boxscore?gamecode=%d&seasoncode=%s';
const LIVE_CACHE_SECONDS = 30;
// Završena utakmica se ne čita ponovo; prati se do ovoliko sati poslije početka.
const LIVE_WINDOW_HOURS = 6;

// "18:19" → 18.3 minuta; "DNP" → 0.
function liveMinutes(string $value): float
{
    return preg_match('/^(\d+):(\d+)$/', trim($value), $m) ? round((int) $m[1] + (int) $m[2] / 60, 1) : 0.0;
}

// Jedna utakmica sa Eurolige: stanje i igrači po šifri ("006661"). null ako sajt ne odgovara.
function liveFetchGame(string $season, int $gameCode): ?array
{
    $header = fetchJson(sprintf(LIVE_HEADER_URL, $gameCode, $season), 10);
    $box = fetchJson(sprintf(LIVE_BOXSCORE_URL, $gameCode, $season), 10);
    if ($header === null || $box === null) {
        return null;
    }
    $players = [];
    foreach ((array) ($box['Stats'] ?? []) as $team) {
        foreach ((array) ($team['PlayersStats'] ?? []) as $row) {
            $code = ltrim(trim((string) ($row['Player_ID'] ?? '')), 'P');
            if ($code === '') {
                continue;
            }
            $players[$code] = [
                'pts' => (int) ($row['Points'] ?? 0),
                'ast' => (int) ($row['Assistances'] ?? 0),
                'reb' => (int) ($row['TotalRebounds'] ?? 0),
                'min' => liveMinutes((string) ($row['Minutes'] ?? '')),
                'fouls' => (int) ($row['FoulsCommited'] ?? 0),
                'onCourt' => (bool) ($row['IsPlaying'] ?? false),
            ];
        }
    }
    $scoreHome = (int) ($header['ScoreA'] ?? 0);
    $scoreAway = (int) ($header['ScoreB'] ?? 0);
    $live = (bool) ($header['Live'] ?? false);
    return [
        'live' => $live,
        // Bez "Live", a sa rezultatom: utakmica je gotova.
        'finished' => !$live && $scoreHome + $scoreAway > 0,
        'quarter' => trim((string) ($header['Quarter'] ?? '')),
        'clock' => trim((string) ($header['RemainingPartialTime'] ?? '')),
        'scoreHome' => $scoreHome,
        'scoreAway' => $scoreAway,
        'players' => $players,
    ];
}

// Utakmica iz zapamćenog, ili ponovo sa Eurolige kad je zapamćeno starije od 30 s (gotova se ne čita ponovo).
function liveGame(PDO $db, string $season, array $game): ?array
{
    $key = 'live_' . $game['id'];
    $cached = json_decode(getSetting($db, $key, ''), true);
    if (is_array($cached) && ($cached['data']['finished'] || time() - $cached['at'] < LIVE_CACHE_SECONDS)) {
        return $cached['data'];
    }
    $data = liveFetchGame($season, (int) $game['game_code']);
    if ($data === null) {
        return is_array($cached) ? $cached['data'] : null;
    }
    setSetting($db, $key, json_encode(['at' => time(), 'data' => $data]));
    return $data;
}

// Za kolo: utakmice sa našim igračima koje su počele u zadnjih 6 sati, i igrači sa tiketa u njima.
// games: [{id, home, away, scoreHome, scoreAway, live, finished, quarter, clock}];
// players: {playerId: {pts, ast, reb, min, fouls, onCourt, seasonMin}} (seasonMin za tempo).
function liveRound(PDO $db, int $roundId): array
{
    $season = currentSeasonCode();
    $now = date('Y-m-d H:i:s');
    $stmt = $db->prepare(
        'SELECT DISTINCT g.id, g.game_code, g.home_code, g.away_code, g.starts_at
         FROM picks p JOIN games g ON g.id = p.game_id
         WHERE p.round_id = ? AND g.starts_at <= ? AND g.starts_at >= ?
         ORDER BY g.starts_at'
    );
    $stmt->execute([$roundId, $now, date('Y-m-d H:i:s', time() - LIVE_WINDOW_HOURS * 3600)]);
    $games = [];
    $byGame = [];
    foreach ($stmt->fetchAll() as $game) {
        $data = liveGame($db, $season, $game);
        if ($data === null) {
            continue;
        }
        $byGame[(int) $game['id']] = $data['players'];
        $games[] = ['id' => (int) $game['id'], 'home' => $game['home_code'], 'away' => $game['away_code']]
            + array_diff_key($data, ['players' => true]);
    }
    if (!$games) {
        return ['games' => [], 'players' => (object) []];
    }

    $ids = array_keys($byGame);
    $stmt = $db->prepare(
        'SELECT DISTINCT p.player_id, p.game_id, pl.code FROM picks p JOIN players pl ON pl.id = p.player_id
         WHERE p.round_id = ? AND p.game_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'
    );
    $stmt->execute([$roundId, ...$ids]);
    $rows = $stmt->fetchAll();

    // Minute po utakmici u sezoni, za tempo ("koliko bi dao ako nastavi ovako").
    $seasonMin = [];
    if ($rows) {
        $codes = array_column($rows, 'code');
        $stmt = $db->prepare(
            'SELECT player_code, AVG(seconds) / 60 AS m FROM box_stats
             WHERE season = ? AND seconds > 0 AND player_code IN (' . implode(',', array_fill(0, count($codes), '?')) . ')
             GROUP BY player_code'
        );
        $stmt->execute([$season, ...$codes]);
        $seasonMin = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    }

    $players = [];
    foreach ($rows as $row) {
        $stats = $byGame[(int) $row['game_id']][$row['code']] ?? null;
        // Nije u zapisniku uživo (nije prijavljen za utakmicu): kao da nije ušao.
        $stats ??= ['pts' => 0, 'ast' => 0, 'reb' => 0, 'min' => 0.0, 'fouls' => 0, 'onCourt' => false];
        $players[(int) $row['player_id']] = $stats + ['seasonMin' => isset($seasonMin[$row['code']]) ? round((float) $seasonMin[$row['code']], 1) : null];
    }
    return ['games' => $games, 'players' => (object) $players];
}
