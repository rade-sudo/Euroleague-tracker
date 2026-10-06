<?php

declare(strict_types=1);

const SESSION_COOKIE = 'et_session';
const SESSION_SHORT_SECONDS = 12 * 3600;
const SESSION_REMEMBER_SECONDS = 30 * 86400;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 10;

// Provjerava se i kad korisnik ne postoji, da se po brzini odgovora ne vidi koja imena postoje.
const DUMMY_PASSWORD_HASH = '$2y$10$Vd6JlRS3WbJMuzj.5drB6.Hb4owN0CHeNlqRRmE0jXNL280h1v5Ma';

function isHttps(): bool
{
    return ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function setSessionCookie(string $token, int $expires): void
{
    setcookie(SESSION_COOKIE, $token, [
        'expires' => $expires,
        'path' => '/',
        'secure' => isHttps(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function sessionToken(): ?string
{
    $token = $_COOKIE[SESSION_COOKIE] ?? null;
    return is_string($token) && preg_match('/^[a-f0-9]{64}$/', $token) ? $token : null;
}

function publicUser(array $user): array
{
    return ['username' => $user['username'], 'role' => $user['role'], 'friendId' => $user['friend_id']];
}

// Bez "Zapamti me" kolačić nestaje kad se zatvori pregledač (expires 0).
function startSession(PDO $db, int $userId, bool $remember): void
{
    $token = bin2hex(random_bytes(32));
    $expires = time() + ($remember ? SESSION_REMEMBER_SECONDS : SESSION_SHORT_SECONDS);
    $db->prepare('INSERT INTO sessions (token_hash, user_id, remember, expires_at) VALUES (?, ?, ?, FROM_UNIXTIME(?))')
        ->execute([hash('sha256', $token), $userId, (int) $remember, $expires]);
    setSessionCookie($token, $remember ? $expires : 0);
}

function currentUser(PDO $db): ?array
{
    $token = sessionToken();
    if ($token === null) {
        return null;
    }
    $tokenHash = hash('sha256', $token);
    $stmt = $db->prepare(
        'SELECT u.id, u.username, u.role, u.friend_id, s.remember, UNIX_TIMESTAMP(s.expires_at) AS expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > NOW()'
    );
    $stmt->execute([$tokenHash]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }

    // "Zapamti me" sesija se produžava dok god se korisnik vraća.
    if ($row['remember'] && $row['expires_at'] - time() < SESSION_REMEMBER_SECONDS / 2) {
        $expires = time() + SESSION_REMEMBER_SECONDS;
        $db->prepare('UPDATE sessions SET expires_at = FROM_UNIXTIME(?) WHERE token_hash = ?')
            ->execute([$expires, $tokenHash]);
        setSessionCookie($token, $expires);
    }

    return ['id' => (int) $row['id'], 'username' => $row['username'], 'role' => $row['role'], 'friend_id' => $row['friend_id']];
}

function endSession(PDO $db): void
{
    $token = sessionToken();
    if ($token !== null) {
        $db->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
    setSessionCookie('', 1);
}

// Vraća korisnika ili null; baca TooManyAttempts kad je IP blokiran.
function attemptLogin(PDO $db, string $username, string $password, string $ip): ?array
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > NOW() - INTERVAL ' . LOGIN_WINDOW_MINUTES . ' MINUTE'
    );
    $stmt->execute([$ip]);
    if ((int) $stmt->fetchColumn() >= LOGIN_MAX_FAILURES) {
        throw new TooManyAttempts();
    }

    $stmt = $db->prepare('SELECT id, username, role, friend_id, password_hash FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch() ?: null;

    if (!password_verify($password, $user['password_hash'] ?? DUMMY_PASSWORD_HASH) || $user === null) {
        $db->prepare('INSERT INTO login_attempts (ip, username) VALUES (?, ?)')
            ->execute([$ip, mb_substr($username, 0, 24)]);
        return null;
    }

    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }
    $db->prepare('DELETE FROM login_attempts WHERE ip = ? OR attempted_at < NOW() - INTERVAL 1 DAY')->execute([$ip]);
    $db->exec('DELETE FROM sessions WHERE expires_at < NOW()');
    $db->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')->execute([$user['id']]);

    return ['id' => (int) $user['id'], 'username' => $user['username'], 'role' => $user['role'], 'friend_id' => $user['friend_id']];
}

final class TooManyAttempts extends RuntimeException
{
}
