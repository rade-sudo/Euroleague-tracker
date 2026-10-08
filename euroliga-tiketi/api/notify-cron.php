<?php

// Rokovi, poeni, ocjene i obavještenja i kad niko nema otvorenu aplikaciju.
// Pokreće se iz Crona u hPanelu svakih 5 minuta:
//   php /putanja/do/api/notify-cron.php
// Preko weba se ne može pokrenuti.

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
require __DIR__ . '/slips.php';
require __DIR__ . '/overview.php';
require __DIR__ . '/push.php';
require __DIR__ . '/notifications.php';

// U API-ju fail() vraća grešku pregledaču; ovdje je samo prekid sa porukom.
function fail(int $status, string $message): never
{
    throw new RuntimeException($message, $status);
}

try {
    $db = connect();
    syncEuroleague($db);
    $sent = dispatchNotifications($db);
    echo date('Y-m-d H:i') . " poslato obavještenja: {$sent}\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Greška: ' . $e->getMessage() . "\n");
    exit(1);
}
