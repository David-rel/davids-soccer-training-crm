-- Links a public-signup row back to the CRM player it represents, so a coach
-- can add a family straight from the CRM without risking the same kid being
-- signed up twice. Nullable on purpose: rows created by the public signup form
-- have no CRM player behind them and must keep working exactly as before.

ALTER TABLE player_signups
  ADD COLUMN IF NOT EXISTS crm_player_id INTEGER REFERENCES crm_players(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_signups_session_crm_player
  ON player_signups(group_session_id, crm_player_id)
  WHERE crm_player_id IS NOT NULL;
