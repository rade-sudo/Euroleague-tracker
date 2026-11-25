-- Odsutni igrači: spisak povreda sa BasketNewsa i adminove oznake po kolu.
-- Pokreće se jednom, nad izabranom bazom, poslije 015_maxbet_ponuda.sql.

-- Zadnji pročitani spisak povreda (BasketNews, ažuriraju ga svaki dan). Svako čitanje zamijeni cijeli spisak.
-- status: out, doubtful, uncertain (i questionable, game-time), expected (i ready).
CREATE TABLE IF NOT EXISTS injury_reports (
  player_id  INT UNSIGNED NOT NULL PRIMARY KEY,
  status     ENUM('out', 'doubtful', 'uncertain', 'expected') NOT NULL,
  comment    VARCHAR(300) NOT NULL DEFAULT '',
  fetched_at DATETIME NOT NULL,
  CONSTRAINT fk_injury_reports_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Admin: igra, upitan ili ne igra, za igrača u kolu. Važi preko svih ostalih izvora.
CREATE TABLE IF NOT EXISTS forma_absences (
  season     VARCHAR(8) NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  player_id  INT UNSIGNED NOT NULL,
  status     ENUM('in', 'maybe', 'out') NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (season, round, player_id),
  CONSTRAINT fk_forma_absences_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
