-- Igrači sa tiketa za kola 1–3, upisani naknadno (svi su igrani na „+“).
-- Rezultati u tabeli se ne mijenjaju: već odgovaraju ovim igračima.
-- Pokreće se jednom, nad izabranom bazom, poslije 004_igraci.sql. Drugo pokretanje ništa ne duplira.

-- Ovih 18 igrača sa spiska Eurolige; ako je spisak već osvježen, postojeći se ne diraju.
INSERT INTO players (code, name, club_code, club_name, active, updated_at) VALUES
  ('008829', 'Alec Peters', 'MIL', 'Milan', 1, NOW()),
  ('014108', 'Aliou Diarra', 'VIR', 'Virtus Bologna', 1, NOW()),
  ('008192', 'Azuolas Tubelis', 'ZAL', 'Zalgiris', 1, NOW()),
  ('013369', 'Carlik Jones', 'PAR', 'Partizan', 1, NOW()),
  ('010568', 'Chris Jones', 'RED', 'Crvena Zvezda', 1, NOW()),
  ('003112', 'Dario Saric', 'IST', 'Anadolu Efes', 1, NOW()),
  ('013285', 'Devon Dotson', 'BES', 'Besiktas', 1, NOW()),
  ('011205', 'Devon Hall', 'MIL', 'Milan', 1, NOW()),
  ('013370', 'Duane Washington', 'MUN', 'Bayern Munich', 1, NOW()),
  ('014163', 'Jared Butler', 'RED', 'Crvena Zvezda', 1, NOW()),
  ('014178', 'Jared Rhoden', 'PRS', 'Paris', 1, NOW()),
  ('009862', 'Kevin Punter', 'BAR', 'FC Barcelona', 1, NOW()),
  ('005985', 'Mike James', 'IST', 'Anadolu Efes', 1, NOW()),
  ('003469', 'Sasha Vezenkov', 'OLY', 'Olympiacos', 1, NOW()),
  ('007975', 'Sylvain Francisco', 'PAN', 'Panathinaikos', 1, NOW()),
  ('014124', 'Talen Horton-Tucker', 'ULK', 'Fenerbahce', 1, NOW()),
  ('012608', 'TJ Shorts', 'PAM', 'Valencia', 1, NOW()),
  ('008987', 'Zach Leday', 'HTA', 'Hapoel TLV', 1, NOW())
ON DUPLICATE KEY UPDATE code = code;

-- kolo, korisnik (čiji je tiket), šifra igrača, prošao (1) ili nije (0).
INSERT INTO picks (round_id, friend_id, player_id, player, tip, hit)
SELECT r.id, u.friend_id, p.id, p.name, '+', x.hit
FROM (
            SELECT 1 AS kolo, 'mladen' AS korisnik, '014124' AS code, 0 AS hit
  UNION ALL SELECT 1, 'rade',    '008829', 1
  UNION ALL SELECT 1, 'milan',   '013285', 1
  UNION ALL SELECT 1, 'marko',   '013369', 1
  UNION ALL SELECT 1, 'milje',   '012608', 1

  UNION ALL SELECT 2, 'milan',   '003112', 0
  UNION ALL SELECT 2, 'milje',   '003469', 1
  UNION ALL SELECT 2, 'radovan', '010568', 0
  UNION ALL SELECT 2, 'rade',    '008829', 0
  UNION ALL SELECT 2, 'mladen',  '012608', 0
  UNION ALL SELECT 2, 'marko',   '013369', 1

  UNION ALL SELECT 3, 'rade',    '014178', 0
  UNION ALL SELECT 3, 'rade',    '007975', 0
  UNION ALL SELECT 3, 'rade',    '009862', 1
  UNION ALL SELECT 3, 'radovan', '014108', 1
  UNION ALL SELECT 3, 'radovan', '011205', 1
  UNION ALL SELECT 3, 'milje',   '005985', 0
  UNION ALL SELECT 3, 'milje',   '012608', 0
  UNION ALL SELECT 3, 'marko',   '014163', 0
  UNION ALL SELECT 3, 'marko',   '013369', 0
  UNION ALL SELECT 3, 'mladen',  '008192', 1
  UNION ALL SELECT 3, 'mladen',  '013370', 1
  UNION ALL SELECT 3, 'mladen',  '014124', 0
  UNION ALL SELECT 3, 'milan',   '008987', 1
  UNION ALL SELECT 3, 'milan',   '013285', 1
) AS x
JOIN rounds r ON r.number = x.kolo
JOIN users u ON u.username = x.korisnik COLLATE utf8mb4_croatian_ci
JOIN players p ON p.code = x.code COLLATE utf8mb4_unicode_ci
WHERE u.friend_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM picks q WHERE q.round_id = r.id AND q.friend_id = u.friend_id AND q.player_id = p.id
  );
