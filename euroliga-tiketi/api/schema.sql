CREATE DATABASE IF NOT EXISTS euroliga_tiketi
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE euroliga_tiketi;

CREATE TABLE IF NOT EXISTS friends (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- croatian_ci: "Marko" i "marko" su isto ime, ali "Čedo" i "Cedo" nisu.
  name       VARCHAR(24) COLLATE utf8mb4_croatian_ci NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friends_name (name)
);

-- open: drugari upisuju igrače; locked: mečevi u toku, svi vide sve tikete; done: admin ocjenjuje.
CREATE TABLE IF NOT EXISTS rounds (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  number      SMALLINT UNSIGNED NOT NULL,
  status      ENUM('open', 'locked', 'done') NOT NULL DEFAULT 'open',
  deadline_at DATETIME NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rounds_number (number)
);

-- Nema reda = prijatelj nije igrao to kolo.
CREATE TABLE IF NOT EXISTS results (
  friend_id  INT UNSIGNED NOT NULL,
  round_id   INT UNSIGNED NOT NULL,
  hits       TINYINT UNSIGNED NOT NULL,
  played     TINYINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (friend_id, round_id),
  CONSTRAINT fk_results_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_results_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT chk_results_valid CHECK (played > 0 AND hits <= played)
);

-- Nalozi se prave ručno (php api/users.php), registracije nema.
-- admin može sve; viewer samo gleda tabelu.
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(24) COLLATE utf8mb4_croatian_ci NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- Još koristi lozinku koju mu je dao admin (podsjetnik da postavi svoju).
  password_set_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
  role          ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
  -- Red u tabeli koji pripada ovom nalogu (njegov tiket).
  friend_id     INT UNSIGNED NULL,
  -- Obavještenja koja je isključio, npr. "graded,results".
  notifications_off VARCHAR(200) NOT NULL DEFAULT '',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_friend (friend_id),
  CONSTRAINT fk_users_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE SET NULL
);

-- U kolačiću je nasumičan token, u bazi samo njegov SHA-256 hash.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  remember   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Neuspjele prijave po IP adresi, za blokadu pogađanja lozinke.
CREATE TABLE IF NOT EXISTS login_attempts (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip           VARCHAR(45) NOT NULL,
  username     VARCHAR(24) NOT NULL,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_login_attempts_ip (ip, attempted_at)
);

CREATE TABLE IF NOT EXISTS players (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20) NOT NULL,
  name       VARCHAR(60) NOT NULL,
  club_code  VARCHAR(10) NULL,
  club_name  VARCHAR(60) NULL,
  -- Pozicija za fantasy (G, F, C); position_fixed = ispravio admin, uvoz je ne mijenja.
  position   CHAR(1) NULL,
  position_fixed BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_players_code (code)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Kako ko piše igrača ("Šengelija", "Kampaco"...). normalized je bez kvačica i velikih slova.
CREATE TABLE IF NOT EXISTS player_aliases (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id  INT UNSIGNED NOT NULL,
  alias      VARCHAR(60) NOT NULL,
  normalized VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_player_aliases_normalized (normalized),
  CONSTRAINT fk_player_aliases_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Utakmice regularne sezone sa Euroleague sajta. starts_at je po našoj zoni.
CREATE TABLE IF NOT EXISTS games (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  season     VARCHAR(8) NOT NULL,
  game_code  INT UNSIGNED NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  starts_at  DATETIME NOT NULL,
  home_code  VARCHAR(10) NOT NULL,
  home_name  VARCHAR(60) NOT NULL,
  away_code  VARCHAR(10) NOT NULL,
  away_name  VARCHAR(60) NOT NULL,
  played     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Ko je dao prve poene ('' = nema podataka).
  first_scorer_code VARCHAR(20) NULL,
  -- Fantasy: konačni PIR sa zapisnika je upisan.
  stats_final BOOLEAN NOT NULL DEFAULT FALSE,
  stats_checked_at DATETIME NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_games_code (season, game_code),
  KEY idx_games_round (season, round)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

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

-- Igrači na tiketu. hit: NULL dok nije ocijenjen, zatim 1 (pogođen) ili 0.
CREATE TABLE IF NOT EXISTS picks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id   INT UNSIGNED NOT NULL,
  friend_id  INT UNSIGNED NOT NULL,
  -- Veza sa spiskom igrača; bez nje ostaje samo upisani tekst.
  player_id  INT UNSIGNED NULL,
  -- Utakmica igrača u tom kolu; po njoj se zna dan tiketa i rok.
  game_id    INT UNSIGNED NULL,
  -- Tiket 1 ili 2 tog dana, kad se dan zaključa.
  slip_id    INT UNSIGNED NULL,
  player     VARCHAR(40) NOT NULL,
  tip        VARCHAR(30) NOT NULL DEFAULT '',
  -- Granica sa Maxbeta (upisuje admin) i poeni posle utakmice; did_play 0 = nije igrao.
  line       DECIMAL(3, 1) NULL,
  points     TINYINT UNSIGNED NULL,
  did_play   BOOLEAN NULL,
  -- Dao prve poene na meču (Maxbet akcija: tip "+" je odmah prošao).
  first_points BOOLEAN NOT NULL DEFAULT FALSE,
  hit        BOOLEAN NULL,
  graded_by  ENUM('auto', 'admin') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_picks_ticket (round_id, friend_id),
  KEY idx_picks_player (player_id),
  KEY idx_picks_game (game_id),
  KEY idx_picks_slip (slip_id),
  CONSTRAINT fk_picks_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE SET NULL,
  CONSTRAINT fk_picks_game   FOREIGN KEY (game_id)   REFERENCES games (id)   ON DELETE SET NULL,
  CONSTRAINT fk_picks_slip   FOREIGN KEY (slip_id)   REFERENCES slips (id)   ON DELETE SET NULL,
  CONSTRAINT fk_picks_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT fk_picks_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
);

-- Podešavanja aplikacije, npr. pravilo bubnja (all, pause, cycle).
CREATE TABLE IF NOT EXISTS settings (
  name  VARCHAR(40) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (name, value) VALUES ('draw_rule', 'pause'), ('auto_grade_from_round', '1'), ('slips_from_round', '1');

-- Svako izvlačenje ostaje zapisano. Zamijenjeni dobijaju replaced_at,
-- a poništeno izvlačenje cancelled_at, pa se sve vidi u istoriji.
CREATE TABLE IF NOT EXISTS draws (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id     INT UNSIGNED NOT NULL,
  -- Dan tiketa (kolo koje se igra dva dana ima izvlačenje za svaki dan); NULL za kolo bez rasporeda.
  day          DATE NULL,
  friend_id    INT UNSIGNED NOT NULL,
  slot         TINYINT UNSIGNED NOT NULL,
  drawn_by     INT UNSIGNED NULL,
  drawn_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  replaced_at  DATETIME NULL,
  cancelled_at DATETIME NULL,
  KEY idx_draws_round (round_id),
  KEY idx_draws_round_day (round_id, day),
  CONSTRAINT fk_draws_round  FOREIGN KEY (round_id)  REFERENCES rounds (id)  ON DELETE CASCADE,
  CONSTRAINT fk_draws_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE,
  CONSTRAINT fk_draws_user   FOREIGN KEY (drawn_by)  REFERENCES users (id)   ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Dani za koje se ne izvlači (npr. igra se jedan tiket od 3–6 igrača).
CREATE TABLE IF NOT EXISTS draw_skips (
  round_id INT UNSIGNED NOT NULL,
  day      DATE NOT NULL,
  PRIMARY KEY (round_id, day),
  CONSTRAINT fk_draw_skips_round FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Uređaji koji primaju obavještenja (jedan nalog može imati više telefona).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  endpoint        TEXT NOT NULL,
  endpoint_hash   CHAR(64) NOT NULL,
  p256dh          VARCHAR(120) NOT NULL,
  auth            VARCHAR(60) NOT NULL,
  created_at      DATETIME NOT NULL,
  last_success_at DATETIME NULL,
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Svaki događaj (npr. „četvrtak kola 5 zaključan“) šalje se samo jednom.
CREATE TABLE IF NOT EXISTS notifications_sent (
  event_key VARCHAR(80) NOT NULL PRIMARY KEY,
  sent_at   DATETIME NOT NULL,
  KEY idx_notifications_sent_at (sent_at)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Uplate u kasu (admin upisuje i svoj novac kojim je platio tikete). Podizanje je sa minusom.
CREATE TABLE IF NOT EXISTS cash_payments (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  friend_id  INT UNSIGNED NOT NULL,
  amount     DECIMAL(9, 2) NOT NULL,
  note       VARCHAR(80) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  KEY idx_cash_friend (friend_id),
  CONSTRAINT fk_cash_friend FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ručno zaključavanje i otključavanje dana tiketa (admin). Bez reda važi automatski rok.
-- locked = 1: admin je zaključao prije roka; locked = 0: admin je otključao posle roka.
CREATE TABLE IF NOT EXISTS day_locks (
  round_id   INT UNSIGNED NOT NULL,
  day        DATE NOT NULL,
  locked     BOOLEAN NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (round_id, day),
  CONSTRAINT fk_day_locks_round FOREIGN KEY (round_id) REFERENCES rounds (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

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

-- Forma igrača: zapisnici tekuće i dvije prethodne sezone, i granice sa Maxbeta po kolu.
-- Sve utakmice sezone (i doigravanje), za formu i istoriju protiv protivnika.
-- stats: waiting = zapisnik još nije upisan, done = upisan, missing = nema ga ni dva dana posle utakmice.
CREATE TABLE IF NOT EXISTS box_games (
  season     VARCHAR(8) NOT NULL,
  game_code  INT UNSIGNED NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  starts_at  DATETIME NOT NULL,
  home_code  VARCHAR(10) NOT NULL,
  away_code  VARCHAR(10) NOT NULL,
  played     BOOLEAN NOT NULL DEFAULT FALSE,
  stats      ENUM('waiting', 'done', 'missing') NOT NULL DEFAULT 'waiting',
  checked_at DATETIME NULL,
  PRIMARY KEY (season, game_code),
  KEY idx_box_games_todo (stats, played),
  KEY idx_box_games_start (season, starts_at)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Poeni, asistencije i skokovi igrača po utakmici. seconds = 0: bio u zapisniku, nije ulazio u igru.
-- position je sa Euroleague zapisnika (G, F, C), za odbranu protivnika po poziciji.
CREATE TABLE IF NOT EXISTS box_stats (
  season      VARCHAR(8) NOT NULL,
  game_code   INT UNSIGNED NOT NULL,
  player_code VARCHAR(20) NOT NULL,
  team_code   VARCHAR(10) NOT NULL,
  position    CHAR(1) NULL,
  seconds     SMALLINT UNSIGNED NOT NULL,
  points      TINYINT UNSIGNED NOT NULL,
  assists     TINYINT UNSIGNED NOT NULL,
  rebounds    TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (season, game_code, player_code),
  KEY idx_box_stats_player (player_code)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Granica sa Maxbeta koju je admin upisao u Formi ili na tiketu. Ista granica važi
-- za igrača na svim tiketima tog kola, pa se upisuje samo jednom.
CREATE TABLE IF NOT EXISTS forma_lines (
  season     VARCHAR(8) NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  player_id  INT UNSIGNED NOT NULL,
  line       DECIMAL(3, 1) NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (season, round, player_id),
  CONSTRAINT fk_forma_lines_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Utakmice kola za koje je uvoz sa Maxbeta donio granice. Igrači tih utakmica bez granice
-- nisu u ponudi: u Formi piše "Nije u ponudi", a na tiket se ne mogu dodati.
CREATE TABLE IF NOT EXISTS forma_offers (
  game_id     INT UNSIGNED NOT NULL PRIMARY KEY,
  season      VARCHAR(8) NOT NULL,
  round       SMALLINT UNSIGNED NOT NULL,
  imported_at DATETIME NOT NULL,
  KEY idx_forma_offers_round (season, round),
  CONSTRAINT fk_forma_offers_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Zadnji pročitani spisak povreda (BasketNews, ažuriraju ga svaki dan). Svako čitanje zamijeni cijeli spisak.
-- status: out, doubtful, uncertain (i questionable, game-time), expected (i ready).
CREATE TABLE IF NOT EXISTS injury_reports (
  player_id  INT UNSIGNED NOT NULL PRIMARY KEY,
  status     ENUM('out', 'doubtful', 'uncertain', 'expected') NOT NULL,
  comment    VARCHAR(300) NOT NULL DEFAULT '',
  fetched_at DATETIME NOT NULL,
  CONSTRAINT fk_injury_reports_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Admin: igra, upitan ili ne igra, za igrača u kolu. Važi preko svih ostalih izvora.
CREATE TABLE IF NOT EXISTS forma_absences (
  season     VARCHAR(8) NOT NULL,
  round      SMALLINT UNSIGNED NOT NULL,
  player_id  INT UNSIGNED NOT NULL,
  status     ENUM('in', 'maybe', 'out') NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (season, round, player_id),
  CONSTRAINT fk_forma_absences_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Zadnji spisak povreda pročitan prije početka zadnje utakmice kola (poslije se ne mijenja).
CREATE TABLE IF NOT EXISTS injury_snapshots (
  season    VARCHAR(8) NOT NULL,
  round     SMALLINT UNSIGNED NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  status    ENUM('out', 'doubtful', 'uncertain', 'expected') NOT NULL,
  comment   VARCHAR(300) NOT NULL DEFAULT '',
  PRIMARY KEY (season, round, player_id),
  CONSTRAINT fk_injury_snapshots_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
