<?php

declare(strict_types=1);

// Web Push bez dodatnih biblioteka: šifrovanje poruke (RFC 8291) i VAPID potpis (RFC 8292).
// Ključ za potpisivanje se pravi sam pri prvoj upotrebi i čuva u tabeli settings.
const PUSH_TTL_SECONDS = 86400;
const PUSH_TIMEOUT_SECONDS = 10;
// Prefiks DER zapisa javnog P-256 ključa; iza njega ide tačka od 65 bajtova.
const P256_PUBLIC_DER_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

function base64UrlEncode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string
{
    return (string) base64_decode(strtr($data, '-_', '+/'), true);
}

// Na Windowsu (Laragon) OpenSSL ne nalazi svoj openssl.cnf sam; na Linux serveru ne treba.
function opensslConfig(): array
{
    $config = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . 'extras' . DIRECTORY_SEPARATOR . 'ssl' . DIRECTORY_SEPARATOR . 'openssl.cnf';
    return PHP_OS_FAMILY === 'Windows' && is_file($config) ? ['config' => $config] : [];
}

function newEcKey(): OpenSSLAsymmetricKey
{
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC] + opensslConfig());
    if ($key === false) {
        throw new RuntimeException('OpenSSL ne može napraviti EC ključ: ' . openssl_error_string());
    }
    return $key;
}

// Javni ključ kao nekomprimovana tačka: 0x04 || x || y.
function ecPublicPoint(OpenSSLAsymmetricKey $key): string
{
    $ec = openssl_pkey_get_details($key)['ec'];
    return "\x04" . str_pad($ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ec['y'], 32, "\0", STR_PAD_LEFT);
}

function ecPublicKeyFromPoint(string $point): OpenSSLAsymmetricKey
{
    $pem = "-----BEGIN PUBLIC KEY-----\n"
        . chunk_split(base64_encode(hex2bin(P256_PUBLIC_DER_PREFIX) . $point), 64, "\n")
        . "-----END PUBLIC KEY-----\n";
    $key = openssl_pkey_get_public($pem);
    if ($key === false) {
        throw new InvalidArgumentException('Neispravan ključ uređaja.');
    }
    return $key;
}

// [privatni ključ, javni ključ (65 bajtova)]
function vapidKeys(PDO $db): array
{
    $pem = getSetting($db, 'vapid_private_key', '');
    if ($pem === '') {
        openssl_pkey_export(newEcKey(), $pem, null, opensslConfig());
        setSetting($db, 'vapid_private_key', $pem);
    }
    $key = openssl_pkey_get_private($pem);
    return [$key, ecPublicPoint($key)];
}

function vapidPublicKey(PDO $db): string
{
    return base64UrlEncode(vapidKeys($db)[1]);
}

// ECDSA potpis iz OpenSSL-a je DER (SEQUENCE od r i s); JWT traži r || s, po 32 bajta.
function derSignatureToRaw(string $der): string
{
    $offset = 2;
    $parts = '';
    for ($i = 0; $i < 2; $i++) {
        $length = ord($der[$offset + 1]);
        $value = ltrim(substr($der, $offset + 2, $length), "\0");
        $parts .= str_pad($value, 32, "\0", STR_PAD_LEFT);
        $offset += 2 + $length;
    }
    return $parts;
}

function vapidAuthorization(PDO $db, string $endpoint): string
{
    [$private, $public] = vapidKeys($db);
    $url = parse_url($endpoint);
    $header = base64UrlEncode(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = base64UrlEncode(json_encode([
        'aud' => "{$url['scheme']}://{$url['host']}",
        'exp' => time() + 12 * 3600,
        'sub' => getSetting($db, 'app_origin', 'https://localhost'),
    ], JSON_UNESCAPED_SLASHES));
    openssl_sign("{$header}.{$claims}", $signature, $private, OPENSSL_ALGO_SHA256);
    return "vapid t={$header}.{$claims}." . base64UrlEncode(derSignatureToRaw($signature)) . ', k=' . base64UrlEncode($public);
}

// Šifrovana poruka za jedan uređaj (aes128gcm, jedan zapis).
function encryptPushPayload(string $payload, string $devicePublic, string $authSecret): string
{
    $local = newEcKey();
    $localPublic = ecPublicPoint($local);
    $shared = openssl_pkey_derive(ecPublicKeyFromPoint($devicePublic), $local);
    if ($shared === false) {
        throw new RuntimeException('OpenSSL ne može izračunati zajednički ključ.');
    }
    $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $devicePublic . $localPublic, $authSecret);
    $salt = random_bytes(16);
    $contentKey = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $contentKey, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(strlen($localPublic)) . $localPublic . $cipher . $tag;
}

// Šalje poruke na više uređaja odjednom: [[subscription, message], ...].
// Uređaj koji više ne postoji (404/410) briše se iz baze. Vraća broj uspješno poslatih.
function sendPushBatch(PDO $db, array $deliveries): int
{
    $multi = curl_multi_init();
    $handles = [];
    foreach ($deliveries as $index => [$subscription, $message]) {
        try {
            $body = encryptPushPayload(
                json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                base64UrlDecode($subscription['p256dh']),
                base64UrlDecode($subscription['auth']),
            );
            $headers = [
                'Authorization: ' . vapidAuthorization($db, $subscription['endpoint']),
                'TTL: ' . PUSH_TTL_SECONDS,
                'Urgency: high',
                'Content-Encoding: aes128gcm',
                'Content-Type: application/octet-stream',
            ];
        } catch (Throwable $e) {
            error_log('Push ' . $subscription['id'] . ': ' . $e->getMessage());
            continue;
        }
        $curl = curl_init($subscription['endpoint']);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => PUSH_TIMEOUT_SECONDS,
        ]);
        curl_multi_add_handle($multi, $curl);
        $handles[$index] = $curl;
    }

    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi);
        }
    } while ($running && $status === CURLM_OK);

    $sent = 0;
    $now = date('Y-m-d H:i:s');
    foreach ($handles as $index => $curl) {
        $subscription = $deliveries[$index][0];
        $code = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        if ($code >= 200 && $code < 300) {
            $sent++;
            $db->prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?')->execute([$now, $subscription['id']]);
        } elseif ($code === 404 || $code === 410) {
            $db->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([$subscription['id']]);
        } else {
            error_log("Push {$subscription['id']}: HTTP {$code} " . curl_error($curl) . ' ' . curl_multi_getcontent($curl));
        }
        curl_multi_remove_handle($multi, $curl);
    }
    return $sent;
}

// Uređaj sa kojeg je korisnik dozvolio obavještenja. Isti uređaj na drugom nalogu prelazi na taj nalog.
function savePushSubscription(PDO $db, array $user, mixed $body): void
{
    $endpoint = is_array($body) ? (string) ($body['endpoint'] ?? '') : '';
    $p256dh = (string) ($body['keys']['p256dh'] ?? '');
    $auth = (string) ($body['keys']['auth'] ?? '');
    if (!preg_match('#^https://#', $endpoint) || strlen($endpoint) > 1000
        || strlen(base64UrlDecode($p256dh)) !== 65 || strlen(base64UrlDecode($auth)) !== 16) {
        fail(422, 'Uređaj nije poslao ispravne podatke za obavještenja.');
    }
    $db->prepare(
        'INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)'
    )->execute([$user['id'], $endpoint, hash('sha256', $endpoint), $p256dh, $auth, date('Y-m-d H:i:s')]);

    // Adresa aplikacije ide u potpis obavještenja (kontakt za Apple i Google).
    $https = ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off';
    $host = preg_replace('/[^a-z0-9.\-:]/i', '', $_SERVER['HTTP_HOST'] ?? '');
    if ($https && $host !== '') {
        setSetting($db, 'app_origin', "https://{$host}");
    }
}

function deletePushSubscription(PDO $db, array $user, mixed $endpoint): void
{
    $db->prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?')
        ->execute([hash('sha256', (string) $endpoint), $user['id']]);
}
