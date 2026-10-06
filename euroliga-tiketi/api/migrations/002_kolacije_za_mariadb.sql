-- MySQL 8 kolacije (utf8mb4_0900_*) ne postoje u MariaDB-u, koji koristi Hostinger.
-- Prelazimo na kolacije koje rade u oba: unicode_ci za sve, croatian_ci za imena
-- ("Marko" = "marko", ali "Čedo" ≠ "Cedo"). Pokreće se jednom.
USE euroliga_tiketi;

ALTER DATABASE euroliga_tiketi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE friends CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE friends MODIFY name VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_croatian_ci NOT NULL;

ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE users MODIFY username VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_croatian_ci NOT NULL;

ALTER TABLE rounds CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE results CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE picks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE sessions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE login_attempts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
