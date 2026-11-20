-- Ponuda Maxbeta: utakmice kola za koje je uvoz sa Maxbeta donio granice.
-- Igrači tih utakmica bez granice nisu u ponudi: u Formi piše "Nije u ponudi", a na tiket se ne mogu dodati.
-- Pokreće se jednom, nad izabranom bazom, poslije 014_forma.sql.
CREATE TABLE IF NOT EXISTS forma_offers (
  game_id     INT UNSIGNED NOT NULL PRIMARY KEY,
  season      VARCHAR(8) NOT NULL,
  round       SMALLINT UNSIGNED NOT NULL,
  imported_at DATETIME NOT NULL,
  KEY idx_forma_offers_round (season, round),
  CONSTRAINT fk_forma_offers_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
