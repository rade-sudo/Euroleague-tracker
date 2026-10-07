<?php

declare(strict_types=1);

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 100;

function accountPayload(PDO $db, array $user): array
{
    $stmt = $db->prepare(
        "SELECT u.username, u.role, f.name AS friend, u.password_set_by_admin,
                DATE_FORMAT(u.last_login_at, '%Y-%m-%dT%H:%i:%s') AS last_login_at
         FROM users u LEFT JOIN friends f ON f.id = u.friend_id WHERE u.id = ?"
    );
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();
    return [
        'username' => $row['username'],
        'role' => $row['role'],
        'friend' => $row['friend'],
        'passwordSetByAdmin' => (bool) $row['password_set_by_admin'],
        'lastLoginAt' => $row['last_login_at'],
    ];
}

// Posle promjene ovaj uređaj ostaje prijavljen, a svi ostali se odjavljuju.
function changePassword(PDO $db, array $user, string $current, string $next, string $ip): void
{
    try {
        assertNotBlocked($db, $ip);
    } catch (TooManyAttempts) {
        fail(429, 'Previše pogrešnih pokušaja. Sačekaj ' . LOGIN_WINDOW_MINUTES . ' minuta pa pokušaj ponovo.');
    }

    $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    if (!password_verify($current, (string) $stmt->fetchColumn())) {
        recordFailedAttempt($db, $ip, $user['username']);
        fail(422, 'Trenutna lozinka nije tačna.');
    }
    if (mb_strlen($next) < MIN_PASSWORD_LENGTH) {
        fail(422, 'Nova lozinka mora imati najmanje ' . MIN_PASSWORD_LENGTH . ' znakova.');
    }
    if (mb_strlen($next) > MAX_PASSWORD_LENGTH) {
        fail(422, 'Nova lozinka može imati najviše ' . MAX_PASSWORD_LENGTH . ' znakova.');
    }
    if ($next === $current) {
        fail(422, 'Nova lozinka mora biti drugačija od stare.');
    }

    $db->beginTransaction();
    $db->prepare('UPDATE users SET password_hash = ?, password_set_by_admin = 0 WHERE id = ?')
        ->execute([password_hash($next, PASSWORD_DEFAULT), $user['id']]);
    $db->prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
        ->execute([$user['id'], sessionTokenHash() ?? '']);
    $db->commit();
}
