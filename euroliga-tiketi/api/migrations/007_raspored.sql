-- Raspored utakmica sa Euroleague sajta, granice i poeni igrača, automatske ocjene.
-- Pokreće se jednom, nad izabranom bazom, poslije 006_lozinka_od_admina.sql.
-- Raspored se puni sam, pri prvom otvaranju aplikacije poslije ove migracije.

-- Utakmice regularne sezone. starts_at je po našoj zoni.
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

-- Uz igrača na tiketu: njegova utakmica, granica (upisuje admin), poeni posle utakmice
-- (did_play: NULL dok utakmica nije gotova, 0 nije igrao) i ko je dao ocjenu.
ALTER TABLE picks
  ADD COLUMN game_id INT UNSIGNED NULL AFTER player_id,
  ADD COLUMN line DECIMAL(3, 1) NULL AFTER tip,
  ADD COLUMN points TINYINT UNSIGNED NULL AFTER line,
  ADD COLUMN did_play BOOLEAN NULL AFTER points,
  ADD COLUMN graded_by ENUM('auto', 'admin') NULL AFTER hit,
  ADD KEY idx_picks_game (game_id),
  ADD CONSTRAINT fk_picks_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE SET NULL;

-- Dosadašnje ocjene je dao admin; automatske ih nikad ne mijenjaju.
UPDATE picks SET graded_by = 'admin' WHERE hit IS NOT NULL;

-- Automatske ocjene važe od kola 4; za kola 1–3 ostaju ručne.
INSERT IGNORE INTO settings (name, value) VALUES ('auto_grade_from_round', '4');
