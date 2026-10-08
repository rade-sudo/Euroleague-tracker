CREATE DATABASE IF NOT EXISTS euroliga_tiketi
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE euroliga_tiketi;

CREATE TABLE IF NOT EXISTS friends (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- croatian_ci: "Marko" i "marko" su isto ime, ali "Čedo" i "Cedo" nisu.
  name       VARCHAR(24) COLLATE utf8mb4_croatian_ci NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friends_name (name)
);

-- open: drugari upisuju igrače; locked: mečevi u toku, svi vide sve tikete; done: admin ocjenjuje.
CREATE TABLE IF NOT EXISTS rounds (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  number      SMALLINT UNSIGNED NOT NULL,
  status      ENUM('open', 'locked', 'done') NOT NULL DEFAULT 'open',
  deadline_at DATETIME NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rounds_number (number)
);

-- Nema reda = prijatelj nije igrao to kolo.
CREATE TABLE IF NOT EXISTS results (
  friend_id  INT UNSIGNED NOT NULL,
  round_id   INT UNSIGNED NOT NULL,
  hits       TINYINT UNSIGNED NOT NULL,
  played     TINYINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (friend_id, round_id),
  CONSTRAINT fk_results_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_results_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT chk_results_valid CHECK (played > 0 AND hits <= played)
);

-- Nalozi se prave ručno (php api/users.php), registracije nema.
-- admin može sve; viewer samo gleda tabelu.
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(24) COLLATE utf8mb4_croatian_ci NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- Još koristi lozinku koju mu je dao admin (podsjetnik da postavi svoju).
  password_set_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
  role          ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
  -- Red u tabeli koji pripada ovom nalogu (njegov tiket).
  friend_id     INT UNSIGNED NULL,
  -- Obavještenja koja je isključio, npr. "graded,results".
  notifications_off VARCHAR(200) NOT NULL DEFAULT '',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_friend (friend_id),
  CONSTRAINT fk_users_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE SET NULL
);

-- U kolačiću je nasumičan token, u bazi samo njegov SHA-256 hash.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  remember   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Neuspjele prijave po IP adresi, za blokadu pogađanja lozinke.
CREATE TABLE IF NOT EXISTS login_attempts (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip           VARCHAR(45) NOT NULL,
  username     VARCHAR(24) NOT NULL,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_login_attempts_ip (ip, attempted_at)
);

CREATE TABLE IF NOT EXISTS players (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20) NOT NULL,
  name       VARCHAR(60) NOT NULL,
  club_code  VARCHAR(10) NULL,
  club_name  VARCHAR(60) NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_players_code (code)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Kako ko piše igrača ("Šengelija", "Kampaco"...). normalized je bez kvačica i velikih slova.
CREATE TABLE IF NOT EXISTS player_aliases (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id  INT UNSIGNED NOT NULL,
  alias      VARCHAR(60) NOT NULL,
  normalized VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_player_aliases_normalized (normalized),
  CONSTRAINT fk_player_aliases_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Utakmice regularne sezone sa Euroleague sajta. starts_at je po našoj zoni.
CREATE TABLE IF NOT EXISTS games (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  season     VARCHAR(8) NOT NULL,
  game_code  INT UNSIGNED NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  starts_at  DATETIME NOT NULL,
  home_code  VARCHAR(10) NOT NULL,
  home_name  VARCHAR(60) NOT NULL,
  away_code  VARCHAR(10) NOT NULL,
  away_name  VARCHAR(60) NOT NULL,
  played     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_games_code (season, game_code),
  KEY idx_games_round (season, round)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Igrači na tiketu. hit: NULL dok nije ocijenjen, zatim 1 (pogođen) ili 0.
CREATE TABLE IF NOT EXISTS picks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id   INT UNSIGNED NOT NULL,
  friend_id  INT UNSIGNED NOT NULL,
  -- Veza sa spiskom igrača; bez nje ostaje samo upisani tekst.
  player_id  INT UNSIGNED NULL,
  -- Utakmica igrača u tom kolu; po njoj se zna dan tiketa i rok.
  game_id    INT UNSIGNED NULL,
  player     VARCHAR(40) NOT NULL,
  tip        VARCHAR(30) NOT NULL DEFAULT '',
  -- Granica sa Maxbeta (upisuje admin) i poeni posle utakmice; did_play 0 = nije igrao.
  line       DECIMAL(3, 1) NULL,
  points     TINYINT UNSIGNED NULL,
  did_play   BOOLEAN NULL,
  hit        BOOLEAN NULL,
  graded_by  ENUM('auto', 'admin') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_picks_ticket (round_id, friend_id),
  KEY idx_picks_player (player_id),
  KEY idx_picks_game (game_id),
  CONSTRAINT fk_picks_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE SET NULL,
  CONSTRAINT fk_picks_game   FOREIGN KEY (game_id)   REFERENCES games (id)   ON DELETE SET NULL,
  CONSTRAINT fk_picks_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT fk_picks_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
);

-- Podešavanja aplikacije, npr. pravilo bubnja (all, pause, cycle).
CREATE TABLE IF NOT EXISTS settings (
  name  VARCHAR(40) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (name, value) VALUES ('draw_rule', 'pause'), ('auto_grade_from_round', '1');

-- Svako izvlačenje ostaje zapisano. Zamijenjeni dobijaju replaced_at,
-- a poništeno izvlačenje cancelled_at, pa se sve vidi u istoriji.
CREATE TABLE IF NOT EXISTS draws (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id     INT UNSIGNED NOT NULL,
  friend_id    INT UNSIGNED NOT NULL,
  slot         TINYINT UNSIGNED NOT NULL,
  drawn_by     INT UNSIGNED NULL,
  drawn_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  replaced_at  DATETIME NULL,
  cancelled_at DATETIME NULL,
  KEY idx_draws_round (round_id),
  CONSTRAINT fk_draws_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT fk_draws_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_draws_user   FOREIGN KEY (drawn_by)  REFERENCES users (id)   ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Uređaji koji primaju obavještenja (jedan nalog može imati više telefona).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  endpoint        TEXT NOT NULL,
  endpoint_hash   CHAR(64) NOT NULL,
  p256dh          VARCHAR(120) NOT NULL,
  auth            VARCHAR(60) NOT NULL,
  created_at      DATETIME NOT NULL,
  last_success_at DATETIME NULL,
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Svaki događaj (npr. „četvrtak kola 5 zaključan“) šalje se samo jednom.
CREATE TABLE IF NOT EXISTS notifications_sent (
  event_key VARCHAR(80) NOT NULL PRIMARY KEY,
  sent_at   DATETIME NOT NULL,
  KEY idx_notifications_sent_at (sent_at)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
