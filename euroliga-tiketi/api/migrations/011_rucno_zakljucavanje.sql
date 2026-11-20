-- Ručno zaključavanje i otključavanje dana tiketa (admin). Bez reda važi automatski rok.
-- locked = 1: admin je zaključao prije roka; locked = 0: admin je otključao posle roka.
-- Pokreće se jednom, nad izabranom bazom, poslije 010_bubanj_po_danima.sql.
CREATE TABLE IF NOT EXISTS day_locks (
  round_id   INT UNSIGNED NOT NULL,
  day        DATE NOT NULL,
  locked     BOOLEAN NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (round_id, day),
  CONSTRAINT fk_day_locks_round FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
