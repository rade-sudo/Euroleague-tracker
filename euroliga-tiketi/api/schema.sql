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
  role          ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
  -- Red u tabeli koji pripada ovom nalogu (njegov tiket).
  friend_id     INT UNSIGNED NULL,
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

-- Igrači na tiketu. hit: NULL dok admin ne ocijeni, zatim 1 (pogođen) ili 0.
CREATE TABLE IF NOT EXISTS picks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id   INT UNSIGNED NOT NULL,
  friend_id  INT UNSIGNED NOT NULL,
  player     VARCHAR(40) NOT NULL,
  tip        VARCHAR(30) NOT NULL DEFAULT '',
  hit        BOOLEAN NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_picks_ticket (round_id, friend_id),
  CONSTRAINT fk_picks_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT fk_picks_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
);
