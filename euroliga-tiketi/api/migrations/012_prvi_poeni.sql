-- Maxbet akcija: igrač sa tipom "+" koji da prve poene na meču odmah je prošao (PPM).
-- Pokreće se jednom, nad izabranom bazom, poslije 011_rucno_zakljucavanje.sql.

-- Šifra igrača koji je dao prve poene utakmice ('' = utakmica nema podatke, ne traži se više).
ALTER TABLE games ADD COLUMN first_scorer_code VARCHAR(20) NULL AFTER played;

-- Igrač sa tiketa dao prve poene svoje utakmice.
ALTER TABLE picks ADD COLUMN first_points BOOLEAN NOT NULL DEFAULT FALSE AFTER did_play;
