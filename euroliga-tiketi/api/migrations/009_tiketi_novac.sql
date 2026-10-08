-- Tiketi kola (tiket 1 i 2), ulog, kvota i isplata, i uplate u kasu.
-- Pokreće se jednom, nad izabranom bazom, poslije 008_obavjestenja.sql.

-- Tiket uplaćen na Maxbetu. Ulog je 2 KM po igraču na tiketu; kvotu i isplatu upisuje admin.
-- day je dan tiketa (NULL za kolo bez rasporeda).
CREATE TABLE IF NOT EXISTS slips (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id   INT UNSIGNED NOT NULL,
  day        DATE NULL,
  number     TINYINT UNSIGNED NOT NULL,
  odds       DECIMAL(9, 2) NULL,
  payout     DECIMAL(9, 2) NULL,
  created_at DATETIME NOT NULL,
  KEY idx_slips_round (round_id),
  CONSTRAINT fk_slips_round FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE picks
  ADD COLUMN slip_id INT UNSIGNED NULL AFTER game_id,
  ADD KEY idx_picks_slip (slip_id),
  ADD CONSTRAINT fk_picks_slip FOREIGN KEY (slip_id) REFERENCES slips (id) ON DELETE SET NULL;

-- Uplate u kasu (Rade upisuje i svoj novac kojim je platio tikete). Podizanje je sa minusom.
CREATE TABLE IF NOT EXISTS cash_payments (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  friend_id  INT UNSIGNED NOT NULL,
  amount     DECIMAL(9, 2) NOT NULL,
  note       VARCHAR(80) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  KEY idx_cash_friend (friend_id),
  CONSTRAINT fk_cash_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Tiketi se prave sami od kola 4; za kola 1–3 admin ih može napraviti ručno.
INSERT IGNORE INTO settings (name, value) VALUES ('slips_from_round', '4');
