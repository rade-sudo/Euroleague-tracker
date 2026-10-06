-- Za bazu napravljenu prije unosa igrača po kolu (6. 10. 2026). Pokreće se jednom.
USE euroliga_tiketi;

ALTER TABLE rounds
  ADD COLUMN status ENUM('open', 'locked', 'done') NOT NULL DEFAULT 'open' AFTER number,
  ADD COLUMN deadline_at DATETIME NULL AFTER status;

-- Postojeća kola već imaju ručno upisane rezultate.
UPDATE rounds SET status = 'done';

ALTER TABLE users
  ADD COLUMN friend_id INT UNSIGNED NULL AFTER role,
  ADD UNIQUE KEY uq_users_friend (friend_id),
  ADD CONSTRAINT fk_users_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE SET NULL;

UPDATE users u JOIN friends f ON f.name = CASE u.username
    WHEN 'rade'    THEN 'Rade Marković'
    WHEN 'milan'   THEN 'Milan Kapetina'
    WHEN 'milje'   THEN 'Milan Stanišić'
    WHEN 'marko'   THEN 'Marko Kapetina'
    WHEN 'mladen'  THEN 'Mladen Stanišić'
    WHEN 'radovan' THEN 'Radovan Stakić'
  END
SET u.friend_id = f.id;

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
