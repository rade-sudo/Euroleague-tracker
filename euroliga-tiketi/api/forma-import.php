<?php

// Jednom, posle migracije 014_forma.sql: skida raspored i zapisnike za Formu
// (tekuća i dvije prethodne sezone), da istorija ne čeka cron par sati:
//   php api/forma-import.php
// Može se prekinuti i ponovo pokrenuti; nastavlja gdje je stao. Preko weba se ne može pokrenuti.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

date_default_timezone_set('Europe/Belgrade');

require __DIR__ . '/db.php';
require __DIR__ . '/tickets.php';
require __DIR__ . '/draws.php';
require __DIR__ . '/players.php';
require __DIR__ . '/schedule.php';
require __DIR__ . '/forma.php';
require __DIR__ . '/injuries.php';

function fail(int $status, string $message): never
{
    throw new RuntimeException($message, $status);
}

try {
    $db = connect();
    foreach (formaSeasons(currentSeasonCode()) as $season) {
        $games = fetchJson(sprintf(EUROLEAGUE_GAMES_URL, $season), 25)['data'] ?? null;
        if (!is_array($games)) {
            fwrite(STDERR, "Raspored {$season} nije stigao, preskačem.\n");
            continue;
        }
        formaUpsertGames($db, $season, $games);
        setSetting($db, "forma_games_{$season}", date('Y-m-d H:i:s'));
        echo "Raspored {$season}: " . count($games) . " utakmica\n";
    }

    $waiting = fn () => (int) $db->query("SELECT COUNT(*) FROM box_games WHERE stats = 'waiting' AND played = 1")->fetchColumn();
    $left = $waiting();
    while ($left > 0) {
        formaFetchBoxScores($db);
        $now = $waiting();
        echo "Zapisnici: još {$now}\n";
        // Zapisnici koji još nisu objavljeni ostaju za cron.
        if ($now >= $left) {
            break;
        }
        $left = $now;
    }
    echo "Gotovo.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Greška: ' . $e->getMessage() . "\n");
    exit(1);
}
