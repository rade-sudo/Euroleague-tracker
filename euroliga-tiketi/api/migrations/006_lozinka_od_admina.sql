-- Pamti ko još koristi lozinku koju mu je dao admin (podsjetnik "Postavi svoju lozinku").
-- Pokreće se jednom, nad izabranom bazom. Drugari su dobili lozinke od admina; admin nije.
ALTER TABLE users ADD COLUMN password_set_by_admin BOOLEAN NOT NULL DEFAULT TRUE AFTER password_hash;
UPDATE users SET password_set_by_admin = 0 WHERE role = 'admin';
