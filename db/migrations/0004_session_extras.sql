-- "Extras": players from OTHER families attached to a one-off session, so a
-- private session can be run as an informal mini-group without becoming a
-- scheduled group session.
--
-- Deliberately separate from crm_session_players: that junction holds the
-- players of the session's own parent (the host), and revenue/payout math in
-- app/api/staff/payments keys off it. Extras are roster-only and must not
-- change any of that math, so they get their own table.

CREATE TABLE IF NOT EXISTS crm_session_extras (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES crm_sessions(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES crm_players(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS crm_first_session_extras (
  id SERIAL PRIMARY KEY,
  first_session_id INTEGER NOT NULL REFERENCES crm_first_sessions(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES crm_players(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (first_session_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_session_extras_session ON crm_session_extras(session_id);
CREATE INDEX IF NOT EXISTS idx_session_extras_player ON crm_session_extras(player_id);
CREATE INDEX IF NOT EXISTS idx_first_session_extras_session ON crm_first_session_extras(first_session_id);
CREATE INDEX IF NOT EXISTS idx_first_session_extras_player ON crm_first_session_extras(player_id);
