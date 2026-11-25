-- Tipovi PS / PA / PAS (poeni + skokovi / asistencije): tiket pamti i asistencije i skokove.
-- Pokreće se jednom, nad izabranom bazom, poslije 017_tacnost.sql, i PRIJE kopiranja novog dist-a.

ALTER TABLE picks
  ADD COLUMN assists  TINYINT UNSIGNED NULL AFTER points,
  ADD COLUMN rebounds TINYINT UNSIGNED NULL AFTER assists;

-- Stari tiketi: asistencije i skokovi iz zapisnika koje Forma već ima.
UPDATE picks p
  JOIN games g ON g.id = p.game_id
  JOIN players pl ON pl.id = p.player_id
  JOIN box_stats s ON s.season = g.season AND s.game_code = g.game_code AND s.player_code = pl.code
SET p.assists = s.assists, p.rebounds = s.rebounds
WHERE p.did_play = 1;
