-- Forma igrača: zapisnici tekuće i dvije prethodne sezone, i granice sa Maxbeta po kolu.
-- Pokreće se jednom, nad izabranom bazom, poslije 013_fantasy.sql.

-- Sve utakmice sezone (i doigravanje), za formu i istoriju protiv protivnika.
-- stats: waiting = zapisnik još nije upisan, done = upisan, missing = nema ga ni dva dana posle utakmice.
CREATE TABLE IF NOT EXISTS box_games (
  season     VARCHAR(8) NOT NULL,
  game_code  INT UNSIGNED NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  starts_at  DATETIME NOT NULL,
  home_code  VARCHAR(10) NOT NULL,
  away_code  VARCHAR(10) NOT NULL,
  played     BOOLEAN NOT NULL DEFAULT FALSE,
  stats      ENUM('waiting', 'done', 'missing') NOT NULL DEFAULT 'waiting',
  checked_at DATETIME NULL,
  PRIMARY KEY (season, game_code),
  KEY idx_box_games_todo (stats, played),
  KEY idx_box_games_start (season, starts_at)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Poeni, asistencije i skokovi igrača po utakmici. seconds = 0: bio u zapisniku, nije ulazio u igru.
-- position je sa Euroleague zapisnika (G, F, C), za odbranu protivnika po poziciji.
CREATE TABLE IF NOT EXISTS box_stats (
  season      VARCHAR(8) NOT NULL,
  game_code   INT UNSIGNED NOT NULL,
  player_code VARCHAR(20) NOT NULL,
  team_code   VARCHAR(10) NOT NULL,
  position    CHAR(1) NULL,
  seconds     SMALLINT UNSIGNED NOT NULL,
  points      TINYINT UNSIGNED NOT NULL,
  assists     TINYINT UNSIGNED NOT NULL,
  rebounds    TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (season, game_code, player_code),
  KEY idx_box_stats_player (player_code)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Granica sa Maxbeta koju je admin upisao u Formi ili na tiketu. Ista granica važi
-- za igrača na svim tiketima tog kola, pa se upisuje samo jednom.
CREATE TABLE IF NOT EXISTS forma_lines (
  season     VARCHAR(8) NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  player_id  INT UNSIGNED NOT NULL,
  line       DECIMAL(3, 1) NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (season, round, player_id),
  CONSTRAINT fk_forma_lines_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
