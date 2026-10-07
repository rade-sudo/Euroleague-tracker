-- Spisak igrača Eurolige i skraćenice. Pokreće se jednom, nad izabranom bazom
-- (lokalno: mysql euroliga_tiketi < ovaj fajl; na Hostingeru: phpMyAdmin → baza → SQL).
-- Spisak se puni dugmetom „Osvježi spisak igrača“ na stranici Igrači.

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

-- Igrač na tiketu dobija vezu sa spiskom; bez veze ostaje samo upisani tekst.
ALTER TABLE picks
  ADD COLUMN player_id INT UNSIGNED NULL AFTER friend_id,
  ADD KEY idx_picks_player (player_id),
  ADD CONSTRAINT fk_picks_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE SET NULL;
