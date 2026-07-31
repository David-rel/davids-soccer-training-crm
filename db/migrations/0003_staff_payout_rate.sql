-- Coach payout splits used to be a hard-coded 50% for every non-owner coach.
-- The split is per-coach now, so it lives on the staff row (0.5 = 50%).

ALTER TABLE crm_staff ADD COLUMN IF NOT EXISTS payout_rate NUMERIC(5,4) DEFAULT 0.5;
UPDATE crm_staff SET payout_rate = 0.5 WHERE payout_rate IS NULL;

-- Coach Simon's contracts pay 40%, not the 50% everyone else gets.
UPDATE crm_staff SET payout_rate = 0.4, updated_at = NOW()
WHERE (name ILIKE 'simon' OR name ILIKE 'simon %') AND COALESCE(is_owner, false) = false;
