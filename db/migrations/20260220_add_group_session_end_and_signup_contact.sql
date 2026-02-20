ALTER TABLE group_sessions
ADD COLUMN IF NOT EXISTS session_date_end TIMESTAMPTZ;

ALTER TABLE player_signups
ADD COLUMN IF NOT EXISTS contact_phone TEXT;

ALTER TABLE player_signups
ADD COLUMN IF NOT EXISTS contact_email TEXT;

UPDATE player_signups
SET contact_email = ''
WHERE contact_email IS NULL;

ALTER TABLE player_signups
ALTER COLUMN contact_email SET NOT NULL;
