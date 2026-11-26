-- Statistika drugara ("Uz Formu"): šta je Forma rekla kad je igrač dodat na tiket.
-- Pokreće se jednom, nad izabranom bazom, poslije 018_tipovi.sql.

ALTER TABLE picks
  ADD COLUMN forma_tip CHAR(1) NULL AFTER tip,
  ADD COLUMN forma_pct TINYINT UNSIGNED NULL AFTER forma_tip;
