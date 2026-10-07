<?php

declare(strict_types=1);

const BACKUP_KEEP = 8;
const BACKUP_NAME_PATTERN = '/^euroliga-tiketi-\d{4}-\d{2}-\d{2}-\d{4}\.sql$/';
// Prijave na uređajima se ne prenose; ove tabele idu u kopiju bez podataka.
const BACKUP_SKIP_DATA = ['sessions', 'login_attempts'];

// Kopije stoje van javnog foldera: pored public_html na Hostingeru,
// a lokalno u folderu projekta (backups/, nije u gitu). Može se zadati i u config.local.php.
function backupDir(): string
{
    $config = require __DIR__ . '/config.php';
    if (!empty($config['backup_dir'])) {
        return rtrim($config['backup_dir'], '/\\');
    }
    $dir = __DIR__;
    while (($parent = dirname($dir)) !== $dir) {
        if (basename($dir) === 'public_html') {
            return $parent . DIRECTORY_SEPARATOR . 'euroliga-backups';
        }
        $dir = $parent;
    }
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'backups';
}

// Cijela baza kao SQL: struktura svih tabela i podaci (osim prijava).
// Vraća se uvozom u praznu bazu, kao kod npm run export-db.
function createBackupSql(PDO $db): string
{
    $sql = [
        '-- Euroliga tiket tracker: rezervna kopija baze, ' . date('j. n. Y. \u H:i'),
        '-- Vraća se uvozom u praznu bazu (phpMyAdmin → baza → Uvoz).',
        '',
        'SET NAMES utf8mb4;',
        'SET FOREIGN_KEY_CHECKS = 0;',
        '',
    ];
    $value = fn (mixed $v) => match (true) {
        $v === null => 'NULL',
        is_int($v), is_float($v) => (string) $v,
        default => $db->quote((string) $v),
    };

    foreach ($db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
        $sql[] = $db->query("SHOW CREATE TABLE `{$table}`")->fetch(PDO::FETCH_NUM)[1] . ';';
        $sql[] = '';
        if (in_array($table, BACKUP_SKIP_DATA, true)) {
            continue;
        }
        $rows = $db->query("SELECT * FROM `{$table}`")->fetchAll(PDO::FETCH_ASSOC);
        foreach (array_chunk($rows, 100) as $chunk) {
            $columns = '`' . implode('`, `', array_keys($chunk[0])) . '`';
            $values = array_map(fn (array $row) => '(' . implode(', ', array_map($value, $row)) . ')', $chunk);
            $sql[] = "INSERT INTO `{$table}` ({$columns}) VALUES\n" . implode(",\n", $values) . ';';
        }
        $sql[] = '';
    }
    $sql[] = 'SET FOREIGN_KEY_CHECKS = 1;';
    return implode("\n", $sql) . "\n";
}

// Automatska kopija (Cron): snima fajl i briše starije od zadnjih BACKUP_KEEP.
function saveBackup(PDO $db): array
{
    $dir = backupDir();
    if (!is_dir($dir) && !mkdir($dir, 0750, true)) {
        throw new RuntimeException("Ne mogu napraviti folder za kopije: {$dir}");
    }
    // Za slučaj da je folder ipak dostupan preko weba.
    @file_put_contents($dir . DIRECTORY_SEPARATOR . '.htaccess', "Require all denied\n");

    $name = 'euroliga-tiketi-' . date('Y-m-d-Hi') . '.sql';
    $path = $dir . DIRECTORY_SEPARATOR . $name;
    if (file_put_contents($path, createBackupSql($db)) === false) {
        throw new RuntimeException("Ne mogu snimiti kopiju: {$path}");
    }
    foreach (array_slice(listBackups(), BACKUP_KEEP) as $old) {
        @unlink($dir . DIRECTORY_SEPARATOR . $old['name']);
    }
    return ['name' => $name, 'path' => $path, 'size' => filesize($path)];
}

// Automatske kopije, najnovija prva.
function listBackups(): array
{
    $dir = backupDir();
    $files = [];
    foreach (is_dir($dir) ? scandir($dir) : [] as $name) {
        if (!preg_match(BACKUP_NAME_PATTERN, $name)) {
            continue;
        }
        [, , $year, $month, $day, $time] = explode('-', basename($name, '.sql'));
        $files[] = [
            'name' => $name,
            'size' => filesize($dir . DIRECTORY_SEPARATOR . $name),
            'createdAt' => sprintf('%s-%s-%sT%s:%s', $year, $month, $day, substr($time, 0, 2), substr($time, 2)),
        ];
    }
    usort($files, fn (array $a, array $b) => strcmp($b['name'], $a['name']));
    return $files;
}

function sendSqlDownload(string $filename, string $content): never
{
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($content));
    echo $content;
    exit;
}
