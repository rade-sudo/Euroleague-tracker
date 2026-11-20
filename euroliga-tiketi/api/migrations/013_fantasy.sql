-- Fantasy liga: draft, ekipe od 8 igrača, petorka po kolu, PIR, izmjene i razmjene.
-- Pokreće se jednom, nad izabranom bazom, poslije 012_prvi_poeni.sql.

-- Pozicija igrača sa Euroleague spiska (G, F, C). position_fixed = ispravio admin, uvoz je ne mijenja.
ALTER TABLE players
  ADD COLUMN position CHAR(1) NULL AFTER club_name,
  ADD COLUMN position_fixed BOOLEAN NOT NULL DEFAULT FALSE AFTER position;

-- Zapisnik utakmice za fantasy: stats_final = konačni PIR je upisan.
ALTER TABLE games
  ADD COLUMN stats_final BOOLEAN NOT NULL DEFAULT FALSE AFTER first_scorer_code,
  ADD COLUMN stats_checked_at DATETIME NULL AFTER stats_final;

-- PIR svakog igrača po utakmici. seconds = 0: bio u zapisniku, nije ulazio u igru.
CREATE TABLE IF NOT EXISTS fantasy_stats (
  game_id     INT UNSIGNED NOT NULL,
  player_code VARCHAR(20) NOT NULL,
  pir         SMALLINT NOT NULL,
  seconds     SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, player_code),
  KEY idx_fantasy_stats_player (player_code),
  CONSTRAINT fk_fantasy_stats_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Izbori na draftu, redom (1–48).
CREATE TABLE IF NOT EXISTS fantasy_draft_picks (
  pick_no   SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
  friend_id INT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  -- Izabrala aplikacija (isteklo vrijeme).
  auto      BOOLEAN NOT NULL DEFAULT FALSE,
  picked_at DATETIME NOT NULL,
  UNIQUE KEY uq_fantasy_draft_player (player_id),
  CONSTRAINT fk_fantasy_draft_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_draft_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Trenutne ekipe. Igrač pripada najviše jednom drugaru (primarni ključ je igrač).
-- starter = u petorci; role: kapiten ili vicekapiten.
CREATE TABLE IF NOT EXISTS fantasy_roster (
  player_id   INT UNSIGNED NOT NULL PRIMARY KEY,
  friend_id   INT UNSIGNED NOT NULL,
  starter     BOOLEAN NOT NULL DEFAULT FALSE,
  role        ENUM('', 'captain', 'vice') NOT NULL DEFAULT '',
  acquired_at DATETIME NOT NULL,
  KEY idx_fantasy_roster_friend (friend_id),
  CONSTRAINT fk_fantasy_roster_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_roster_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Postava zaključana u rok kola (kopija ekipe); po njoj se boduje kolo.
CREATE TABLE IF NOT EXISTS fantasy_lineups (
  round     SMALLINT UNSIGNED NOT NULL,
  friend_id INT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  pos       CHAR(1) NOT NULL,
  starter   BOOLEAN NOT NULL,
  role      ENUM('', 'captain', 'vice') NOT NULL DEFAULT '',
  PRIMARY KEY (round, friend_id, player_id),
  CONSTRAINT fk_fantasy_lineups_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_lineups_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Trostruki kapiten: jednom u sezoni, u izabranom kolu.
CREATE TABLE IF NOT EXISTS fantasy_triple (
  friend_id INT UNSIGNED NOT NULL PRIMARY KEY,
  round     SMALLINT UNSIGNED NOT NULL,
  CONSTRAINT fk_fantasy_triple_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Izmjene: pusti jednog, uzmi slobodnog. waiver = zahtjev koji čeka obradu po redu prednosti
-- (0 = uzet odmah, posle obrade). wishes su igrači redom želja, npr. "12,40,7".
CREATE TABLE IF NOT EXISTS fantasy_transfers (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  friend_id      INT UNSIGNED NOT NULL,
  round          SMALLINT UNSIGNED NOT NULL,
  drop_player_id INT UNSIGNED NOT NULL,
  wishes         VARCHAR(60) NOT NULL,
  waiver         BOOLEAN NOT NULL DEFAULT TRUE,
  status         ENUM('pending', 'done', 'failed') NOT NULL DEFAULT 'pending',
  got_player_id  INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL,
  processed_at   DATETIME NULL,
  KEY idx_fantasy_transfers_friend (friend_id, round),
  CONSTRAINT fk_fantasy_transfers_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_transfers_drop FOREIGN KEY (drop_player_id) REFERENCES players (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_transfers_got FOREIGN KEY (got_player_id) REFERENCES players (id) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Razmjene 1 za 1 između drugara (ista pozicija). give je igrač onoga ko nudi.
CREATE TABLE IF NOT EXISTS fantasy_trades (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_friend_id INT UNSIGNED NOT NULL,
  to_friend_id   INT UNSIGNED NOT NULL,
  give_player_id INT UNSIGNED NOT NULL,
  get_player_id  INT UNSIGNED NOT NULL,
  status         ENUM('pending', 'accepted', 'declined', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at     DATETIME NOT NULL,
  decided_at     DATETIME NULL,
  CONSTRAINT fk_fantasy_trades_from FOREIGN KEY (from_friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_trades_to   FOREIGN KEY (to_friend_id)   REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_trades_give FOREIGN KEY (give_player_id) REFERENCES players (id) ON DELETE CASCADE,
  CONSTRAINT fk_fantasy_trades_get  FOREIGN KEY (get_player_id)  REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Liga kreće od 7. kola u probnom radu; fond 5 KM po kolu po drugaru, podjela 60/30/10.
INSERT IGNORE INTO settings (name, value) VALUES
  ('fantasy_start_round', '7'), ('fantasy_mode', 'trial'), ('fantasy_fund_per_round', '5'), ('fantasy_split', '60/30/10');
