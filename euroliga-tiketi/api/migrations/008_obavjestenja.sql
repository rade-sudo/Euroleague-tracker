-- Obavještenja na telefonu. Pokreće se jednom, nad izabranom bazom, poslije 007_raspored.sql.

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

-- Obavještenja koja je korisnik isključio, npr. "graded,results".
ALTER TABLE users ADD COLUMN notifications_off VARCHAR(200) NOT NULL DEFAULT '' AFTER friend_id;

-- Ključ za potpisivanje obavještenja je duži od 255 znakova.
ALTER TABLE settings MODIFY value TEXT NOT NULL;
