<?php
declare(strict_types=1);

// Spisak povreda sa BasketNewsa ("EuroLeague injury report", ažuriraju ga svaki dan).
// Čita se par puta dnevno; greška ne dira stari spisak, a Forma pokaže kad je zadnji put pročitan.

// Članak je vezan za sezonu: za novu sezonu promijeni adresu ovdje (ili setting injury_report_url).
const INJURY_REPORT_URL = 'https://basketnews.com/news-212393-euroleague-injury-report-updated.html';
const INJURY_CHECK_MINUTES = 480;
// Poslije greške sljedeći pokušaj za sat, ne za 8 sati.
const INJURY_RETRY_MINUTES = 60;
const INJURY_STATUS_MAP = [
    'out' => 'out',
    'doubtful' => 'doubtful',
    'uncertain' => 'uncertain',
    'questionable' => 'uncertain',
    'game-time' => 'uncertain',
    'game time' => 'uncertain',
    'expected' => 'expected',
    'ready' => 'expected',
];

function injuryFetchHtml(string $url): ?string
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        CURLOPT_HTTPHEADER => ['Accept: text/html'],
    ]);
    $body = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    if ($body === false || $status !== 200) {
        error_log("Spisak povreda {$url}: HTTP {$status} " . curl_error($curl));
        return null;
    }
    return $body;
}

// Redovi tabele: [team, pos, name, status, comment]. Tim je red sa klasom injury_reports__team-row,
// ispod njega su igrači (pozicija, ime, status, kolo, komentar).
function injuryParse(string $html): array
{
    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="utf-8"?>' . $html);
    libxml_clear_errors();
    $xpath = new DOMXPath($doc);
    $text = fn (DOMNode $node) => trim(preg_replace('/\s+/u', ' ', $node->textContent));

    $rows = [];
    $team = null;
    foreach ($xpath->query('//tr') as $tr) {
        if (!$tr instanceof DOMElement) {
            continue;
        }
        if (str_contains(' ' . $tr->getAttribute('class') . ' ', ' injury_reports__team-row ')) {
            $link = $xpath->query('.//a', $tr)->item(0);
            $team = $link ? $text($link) : null;
            continue;
        }
        $cells = $xpath->query('./td', $tr);
        if ($team === null || $cells->length !== 5) {
            continue;
        }
        $rows[] = [
            'team' => $team,
            'pos' => $text($cells->item(0)),
            'name' => $text($cells->item(1)),
            'status' => mb_strtolower($text($cells->item(2))),
            'comment' => $text($cells->item(4)),
        ];
    }
    return $rows;
}

// Kod kluba po imenu: najviše zajedničkih riječi ("Hapoel TLV" ↔ "Hapoel IBI Tel Aviv"); null ako nije jasno.
function injuryTeamCode(array $clubs, string $team): ?string
{
    $words = explode(' ', normalizePlayerName($team));
    $best = null;
    $bestScore = 0;
    $tie = false;
    foreach ($clubs as $code => $name) {
        $score = count(array_intersect(explode(' ', normalizePlayerName($name)), $words));
        if ($score > $bestScore) {
            [$best, $bestScore, $tie] = [$code, $score, false];
        } elseif ($score === $bestScore && $score > 0) {
            $tie = true;
        }
    }
    return $tie ? null : $best;
}

// Čita spisak i zamijeni stari. $force: odmah, bez obzira kad je zadnji put čitan (CLI, test).
function syncInjuries(PDO $db, bool $force = false): void
{
    if (!$force && minutesSince($db, 'injuries_checked_at') < INJURY_CHECK_MINUTES) {
        return;
    }
    $now = date('Y-m-d H:i:s');
    // Ako ne uspije, ponovo za sat: zapiše se kao da je čitano prije (8 h − 1 h).
    setSetting($db, 'injuries_checked_at', date('Y-m-d H:i:s', time() - (INJURY_CHECK_MINUTES - INJURY_RETRY_MINUTES) * 60));

    $html = injuryFetchHtml(getSetting($db, 'injury_report_url', INJURY_REPORT_URL));
    $rows = $html === null ? [] : injuryParse($html);
    if (!$rows) {
        setSetting($db, 'injuries_error', $html === null ? 'BasketNews ne odgovara.' : 'Na stranici nema tabele povreda.');
        return;
    }

    $clubs = [];
    $teamPlayers = [];
    foreach ($db->query('SELECT id, name, club_code, club_name FROM players WHERE active = 1 AND club_code IS NOT NULL') as $player) {
        $clubs[$player['club_code']] = $player['club_name'] ?? $player['club_code'];
        $teamPlayers[$player['club_code']][] = ['id' => (int) $player['id'], 'tokens' => explode(' ', normalizePlayerName($player['name']))];
    }
    $clubOf = [];
    foreach ($teamPlayers as $code => $list) {
        foreach ($list as $player) {
            $clubOf[$player['id']] = $code;
        }
    }
    $index = playerIndex($db);

    $found = [];
    $missed = 0;
    foreach ($rows as $row) {
        $status = INJURY_STATUS_MAP[$row['status']] ?? null;
        $code = injuryTeamCode($clubs, $row['team']);
        if ($status === null || $code === null) {
            $missed++;
            continue;
        }
        // Isto prepoznavanje kao kod Maxbeta ("D. Karutasu"), a igrač mora biti iz tog tima.
        [$playerId] = formaMatchMaxbetName($index, $teamPlayers[$code] ?? [], $row['name']);
        if ($playerId === null || ($clubOf[$playerId] ?? null) !== $code) {
            $missed++;
            continue;
        }
        $found[$playerId] = [$status, mb_substr($row['comment'], 0, 300)];
    }

    $db->beginTransaction();
    $db->exec('DELETE FROM injury_reports');
    $insert = $db->prepare('INSERT INTO injury_reports (player_id, status, comment, fetched_at) VALUES (?, ?, ?, ?)');
    foreach ($found as $playerId => [$status, $comment]) {
        $insert->execute([$playerId, $status, $comment, $now]);
    }
    injurySnapshot($db, $found);
    setSetting($db, 'injuries_checked_at', $now);
    setSetting($db, 'injuries_ok_at', $now);
    setSetting($db, 'injuries_count', (string) count($found));
    setSetting($db, 'injuries_missed', (string) $missed);
    setSetting($db, 'injuries_error', '');
    $db->commit();
}

// Spisak se pamti i po kolu (za Tačnost Forme): za kolo koje je počelo ili počinje u narednih 7 dana,
// a još ima utakmica koje nisu počele. Kad počne zadnja utakmica kola, snimak se više ne mijenja.
function injurySnapshot(PDO $db, array $found): void
{
    try {
        $season = currentSeasonCode();
        $stmt = $db->prepare(
            'SELECT round FROM games WHERE season = ? GROUP BY round HAVING MAX(starts_at) > ? AND MIN(starts_at) <= ?'
        );
        $stmt->execute([$season, date('Y-m-d H:i:s'), date('Y-m-d H:i:s', time() + 7 * 86400)]);
        $insert = $db->prepare('INSERT INTO injury_snapshots (season, round, player_id, status, comment) VALUES (?, ?, ?, ?, ?)');
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $round) {
            $db->prepare('DELETE FROM injury_snapshots WHERE season = ? AND round = ?')->execute([$season, $round]);
            foreach ($found as $playerId => [$status, $comment]) {
                $insert->execute([$season, $round, $playerId, $status, $comment]);
            }
        }
    } catch (PDOException $e) {
        // Bez migracije 017 spisak povreda i dalje radi, samo se ne pamti po kolu.
        if ($e->getCode() !== '42S02') {
            throw $e;
        }
    }
}

// Spisak za Formu: [playerId => ['status' => ..., 'comment' => ...]]. Prazno dok migracija 016 nije pokrenuta.
// $round: kolo čije su sve utakmice počele čita se iz snimka (kako je bilo prije utakmica), inače današnji spisak.
function injuryReports(PDO $db, ?int $round = null): array
{
    try {
        if ($round !== null) {
            $stmt = $db->prepare('SELECT player_id, status, comment FROM injury_snapshots WHERE season = ? AND round = ?');
            $stmt->execute([currentSeasonCode(), $round]);
            $rows = $stmt->fetchAll();
        } else {
            $rows = $db->query('SELECT player_id, status, comment FROM injury_reports')->fetchAll();
        }
        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['player_id']] = ['status' => $row['status'], 'comment' => $row['comment']];
        }
        return $out;
    } catch (PDOException $e) {
        error_log($e->getMessage());
        return [];
    }
}

// Kad je spisak zadnji put pročitan, koliko igrača ima i da li je zadnje čitanje uspjelo.
function injuryHealth(PDO $db): array
{
    $ok = getSetting($db, 'injuries_ok_at', '');
    return [
        'okAt' => $ok === '' ? null : str_replace(' ', 'T', substr($ok, 0, 16)),
        'count' => (int) getSetting($db, 'injuries_count', '0'),
        'error' => getSetting($db, 'injuries_error', '') ?: null,
        'url' => getSetting($db, 'injury_report_url', INJURY_REPORT_URL),
    ];
}
