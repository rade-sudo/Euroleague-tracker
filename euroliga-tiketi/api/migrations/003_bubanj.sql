-- Bubanj: ko u kolu bira 2 igrača. Pokreće se jednom, nad izabranom bazom
-- (lokalno: mysql euroliga_tiketi < ovaj fajl; na Hostingeru: phpMyAdmin → baza → SQL).

-- Podešavanja aplikacije, npr. pravilo bubnja (all, pause, cycle).
CREATE TABLE IF NOT EXISTS settings (
  name  VARCHAR(40) NOT NULL PRIMARY KEY,
  value VARCHAR(255) NOT NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (name, value) VALUES ('draw_rule', 'pause');

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
