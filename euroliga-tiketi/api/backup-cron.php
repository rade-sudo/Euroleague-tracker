<?php

// Automatska rezervna kopija baze. Pokreće se iz Crona u hPanelu, npr. svake nedjelje u 04:00:
//   php /putanja/do/api/backup-cron.php
// Preko weba se ne može pokrenuti.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

date_default_timezone_set('Europe/Belgrade');

require __DIR__ . '/db.php';
require __DIR__ . '/backups.php';

try {
    $backup = saveBackup(connect());
    echo "Sačuvana kopija: {$backup['path']} (" . round($backup['size'] / 1024) . " KB)\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Kopija nije napravljena: ' . $e->getMessage() . "\n");
    exit(1);
}
