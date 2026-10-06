<?php

// Upravljanje nalozima iz komandne linije. Preko weba se ne može pokrenuti.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/db.php';

const USAGE = <<<TXT
Upotreba (iz foldera euroliga-tiketi):
  php api/users.php list                       spisak naloga
  php api/users.php add <korisnik> [--admin]   novi nalog (bez --admin samo gleda tabelu)
  php api/users.php reset <korisnik>           nova lozinka, odjavljuje ga sa svih uređaja
  php api/users.php remove <korisnik>          briše nalog
  php api/users.php link <korisnik> "<ime>"    povezuje nalog sa njegovim redom u tabeli (tiket)

Kod "add" i "reset" možeš upisati lozinku (najmanje 8 znakova) ili pritisnuti Enter da se generiše.

TXT;

function abort(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(1);
}

function generatePassword(): string
{
    $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $groups = [];
    for ($g = 0; $g < 3; $g++) {
        $group = '';
        for ($i = 0; $i < 4; $i++) {
            $group .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $groups[] = $group;
    }
    return implode('-', $groups);
}

// Lozinka se može i proslijediti: echo lozinka123 | php api/users.php add korisnik
function askPassword(): array
{
    if (stream_isatty(STDIN)) {
        echo 'Lozinka (Enter = generiši): ';
    }
    $input = trim((string) fgets(STDIN));
    if ($input === '') {
        return [generatePassword(), true];
    }
    if (mb_strlen($input) < 8) {
        abort('Lozinka mora imati najmanje 8 znakova.');
    }
    return [$input, false];
}

function normalizeUsername(string $username): string
{
    $username = mb_strtolower(trim($username));
    if (!preg_match('/^[\p{L}0-9._-]{2,24}$/u', $username)) {
        abort('Korisničko ime: 2 do 24 znaka, samo slova, brojevi, tačka, crtica i donja crta.');
    }
    return $username;
}

function findUser(PDO $db, string $username): array
{
    $stmt = $db->prepare('SELECT id, username, role FROM users WHERE username = ?');
    $stmt->execute([$username]);
    return $stmt->fetch() ?: abort("Nalog „{$username}“ ne postoji.");
}

function printPassword(string $username, string $password, bool $generated): void
{
    if ($generated) {
        echo "Lozinka za {$username}: {$password}\n";
        echo "Zapiši je i proslijedi korisniku, u bazi se čuva samo hash.\n";
    } else {
        echo "Lozinka za {$username} je postavljena.\n";
    }
}

$command = $argv[1] ?? '';
$db = connect();

switch ($command) {
    case 'list':
        $rows = $db->query(
            'SELECT u.username, u.role, f.name AS friend, u.last_login_at
             FROM users u LEFT JOIN friends f ON f.id = u.friend_id ORDER BY u.role, u.username'
        )->fetchAll();
        if (!$rows) {
            echo "Nema naloga. Dodaj admina: php api/users.php add <korisnik> --admin\n";
            break;
        }
        printf("%-12s %-7s %-24s %s\n", 'KORISNIK', 'ULOGA', 'RED U TABELI', 'POSLJEDNJA PRIJAVA');
        foreach ($rows as $row) {
            // printf broji bajtove, pa zbog slova kao što su š i ć dopunjavamo ručno.
            $friend = $row['friend'] ?? '-';
            $padded = $friend . str_repeat(' ', max(1, 25 - mb_strlen($friend)));
            printf("%-12s %-7s %s%s\n", $row['username'], $row['role'], $padded, $row['last_login_at'] ?? '-');
        }
        break;

    case 'link':
        $user = findUser($db, normalizeUsername($argv[2] ?? ''));
        $stmt = $db->prepare('SELECT id, name FROM friends WHERE name = ?');
        $stmt->execute([trim($argv[3] ?? '')]);
        $friend = $stmt->fetch() ?: abort('U tabeli nema reda sa tim imenom. Ime mora biti tačno kao u tabeli.');
        try {
            $db->prepare('UPDATE users SET friend_id = ? WHERE id = ?')->execute([$friend['id'], $user['id']]);
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                abort("Red „{$friend['name']}“ je već povezan sa drugim nalogom.");
            }
            throw $e;
        }
        echo "Nalog {$user['username']} je povezan sa redom „{$friend['name']}“.\n";
        break;

    case 'add':
        $username = normalizeUsername($argv[2] ?? '');
        $role = in_array('--admin', $argv, true) ? 'admin' : 'viewer';
        [$password, $generated] = askPassword();
        try {
            $db->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
                ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role]);
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                abort("Nalog „{$username}“ već postoji. Za novu lozinku: php api/users.php reset {$username}");
            }
            throw $e;
        }
        echo "Napravljen nalog {$username} ({$role}).\n";
        printPassword($username, $password, $generated);
        break;

    case 'reset':
        $user = findUser($db, normalizeUsername($argv[2] ?? ''));
        [$password, $generated] = askPassword();
        $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        $db->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$user['id']]);
        printPassword($user['username'], $password, $generated);
        echo "Odjavljen je sa svih uređaja.\n";
        break;

    case 'remove':
        $user = findUser($db, normalizeUsername($argv[2] ?? ''));
        if ($user['role'] === 'admin') {
            $admins = (int) $db->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
            if ($admins <= 1) {
                abort('Ovo je jedini admin, ne može se obrisati.');
            }
        }
        $db->prepare('DELETE FROM users WHERE id = ?')->execute([$user['id']]);
        echo "Obrisan nalog {$user['username']}.\n";
        break;

    default:
        echo USAGE;
        exit($command === '' ? 0 : 1);
}
