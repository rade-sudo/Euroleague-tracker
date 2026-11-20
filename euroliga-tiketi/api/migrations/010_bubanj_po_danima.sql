-- Bubanj po danima: kad se kolo igra dva dana, svaki dan tiketa ima svoje izvlačenje.
-- Pokreće se jednom, nad izabranom bazom, poslije 009_tiketi_novac.sql.
-- Dosadašnja izvlačenja dobiju dan sama, pri prvom otvaranju bubnja
-- (dan kad je izvučeni imao dva igrača, inače prvi dan tiketa kola).

ALTER TABLE draws
  ADD COLUMN day DATE NULL AFTER round_id,
  ADD KEY idx_draws_round_day (round_id, day);

-- Dani za koje se ne izvlači (npr. igra se jedan tiket od 3–6 igrača).
CREATE TABLE IF NOT EXISTS draw_skips (
  round_id INT UNSIGNED NOT NULL,
  day      DATE NOT NULL,
  PRIMARY KEY (round_id, day),
  CONSTRAINT fk_draw_skips_round FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
