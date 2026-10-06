<?php

// Podrazumijevane vrijednosti odgovaraju Laragonu (root bez lozinke).
// Na serveru se pristupni podaci upisuju u config.local.php (nije u gitu),
// po uzoru na config.local.example.php. Varijable okruženja DB_* imaju prednost.
$local = is_file(__DIR__ . '/config.local.php') ? require __DIR__ . '/config.local.php' : [];

return [
    'host' => getenv('DB_HOST') ?: ($local['host'] ?? '127.0.0.1'),
    'port' => getenv('DB_PORT') ?: ($local['port'] ?? '3306'),
    'name' => getenv('DB_NAME') ?: ($local['name'] ?? 'euroliga_tiketi'),
    'user' => getenv('DB_USER') ?: ($local['user'] ?? 'root'),
    'pass' => getenv('DB_PASS') ?: ($local['pass'] ?? ''),
];
