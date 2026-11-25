-- Tačnost Forme: spisak povreda zapamćen po kolu, da se odigrano kolo može izračunati
-- onako kako je izgledalo prije utakmica. Pokreće se jednom, poslije 016_odsutni.sql.

-- Zadnji spisak povreda pročitan prije početka zadnje utakmice kola (poslije se ne mijenja).
CREATE TABLE IF NOT EXISTS injury_snapshots (
  season    VARCHAR(8) NOT NULL,
  round     SMALLINT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  status    ENUM('out', 'doubtful', 'uncertain', 'expected') NOT NULL,
  comment   VARCHAR(300) NOT NULL DEFAULT '',
  PRIMARY KEY (season, round, player_id),
  CONSTRAINT fk_injury_snapshots_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
