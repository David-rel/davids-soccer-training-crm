/**
 * "Extras" — players from other families attached to a one-off session so it
 * can be run as an informal mini-group without becoming a scheduled group
 * session.
 *
 * Extras are roster-only by design. They are kept out of `crm_session_players`
 * because the payments/payout queries treat that junction as "the host's
 * players" and derive session value and the coach split from it; putting other
 * families in there would silently change revenue math. What an extra *does*
 * carry is their parent's contact info, which rides along with the session:
 * the parent shows on the session card, gets added to the Google Calendar
 * invite, and gets the same parent-facing SMS reminders the host parent gets.
 */
import { query } from '@/lib/db';
import { createSessionReminders } from '@/lib/reminders';

export type SessionKind = 'session' | 'first';

/** Table/column names differ per session kind; everything else is identical. */
const TABLES = {
  session: { table: 'crm_session_extras', fk: 'session_id' },
  first: { table: 'crm_first_session_extras', fk: 'first_session_id' },
} as const;

export interface SessionExtra {
  player_id: number;
  player_name: string;
  player_age: number | null;
  player_team: string | null;
  parent_id: number;
  parent_name: string;
  parent_email: string | null;
  parent_phone: string | null;
  secondary_parent_name: string | null;
  notes: string | null;
}

let ensureSessionExtrasTablesPromise: Promise<void> | null = null;

/**
 * Mirrors the `ensure*` pattern used elsewhere in this codebase: the app
 * self-heals its schema on first touch so a deploy doesn't have to be gated on
 * running migrations by hand.
 */
export async function ensureSessionExtrasTables(): Promise<void> {
  if (ensureSessionExtrasTablesPromise) {
    await ensureSessionExtrasTablesPromise;
    return;
  }

  ensureSessionExtrasTablesPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS crm_session_extras (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES crm_sessions(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES crm_players(id) ON DELETE CASCADE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (session_id, player_id)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS crm_first_session_extras (
        id SERIAL PRIMARY KEY,
        first_session_id INTEGER NOT NULL REFERENCES crm_first_sessions(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES crm_players(id) ON DELETE CASCADE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (first_session_id, player_id)
      )
    `);
    await query(
      `CREATE INDEX IF NOT EXISTS idx_session_extras_session ON crm_session_extras(session_id)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_session_extras_player ON crm_session_extras(player_id)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_first_session_extras_session ON crm_first_session_extras(first_session_id)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_first_session_extras_player ON crm_first_session_extras(player_id)`
    );
  })().catch((error) => {
    ensureSessionExtrasTablesPromise = null;
    throw error;
  });

  await ensureSessionExtrasTablesPromise;
}

/** Normalizes whatever the client sent into a clean list of player ids. */
export function parseExtraPlayerIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids = input
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(ids)];
}

/** The extras on a session, with the contact info that rides along with them. */
export async function getSessionExtras(
  kind: SessionKind,
  sessionId: string | number
): Promise<SessionExtra[]> {
  const { table, fk } = TABLES[kind];
  const result = await query(
    `SELECT
       pl.id   AS player_id,
       pl.name AS player_name,
       pl.age  AS player_age,
       pl.team AS player_team,
       par.id    AS parent_id,
       par.name  AS parent_name,
       par.email AS parent_email,
       par.phone AS parent_phone,
       par.secondary_parent_name,
       x.notes
     FROM ${table} x
     JOIN crm_players pl ON pl.id = x.player_id
     JOIN crm_parents par ON par.id = pl.parent_id
     WHERE x.${fk} = $1
     ORDER BY par.name ASC, pl.name ASC`,
    [sessionId]
  );
  return result.rows as SessionExtra[];
}

/**
 * Replaces the extras on a session and re-syncs everything that hangs off them.
 *
 * Players belonging to the session's own parent are rejected rather than
 * silently stored: they belong in `crm_session_players` (the host roster), and
 * accepting them here would double-list the same kid on the session.
 */
export async function setSessionExtras(
  kind: SessionKind,
  sessionId: string | number,
  playerIds: number[]
): Promise<{ ok: true; extras: SessionExtra[] } | { ok: false; error: string; status: number }> {
  await ensureSessionExtrasTables();

  const { table, fk } = TABLES[kind];
  const sessionTable = kind === 'first' ? 'crm_first_sessions' : 'crm_sessions';

  const sessionResult = await query(
    `SELECT id, parent_id, session_date, session_end_date, status, cancelled
     FROM ${sessionTable} WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) {
    return { ok: false, error: 'Session not found', status: 404 };
  }
  const session = sessionResult.rows[0] as {
    id: number;
    parent_id: number;
    session_date: string | Date;
    session_end_date: string | Date | null;
    status: string | null;
    cancelled: boolean | null;
  };

  const uniqueIds = [...new Set(playerIds)];

  if (uniqueIds.length > 0) {
    const playersResult = await query(
      `SELECT id, parent_id FROM crm_players WHERE id = ANY($1::int[])`,
      [uniqueIds]
    );
    if (playersResult.rows.length !== uniqueIds.length) {
      return { ok: false, error: 'One or more extra players do not exist', status: 400 };
    }
    const hostOwned = playersResult.rows.filter(
      (row) => Number(row.parent_id) === Number(session.parent_id)
    );
    if (hostOwned.length > 0) {
      return {
        ok: false,
        error:
          "That player already belongs to this session's own contact — add them under Players, not Extras.",
        status: 400,
      };
    }
  }

  // Parents that were on the session as extras before this edit, so reminders
  // for anyone dropped can be cleaned up.
  const previousExtras = await getSessionExtras(kind, sessionId);
  const previousParentIds = new Set(previousExtras.map((extra) => extra.parent_id));

  await query(`DELETE FROM ${table} WHERE ${fk} = $1`, [sessionId]);
  for (const playerId of uniqueIds) {
    await query(
      `INSERT INTO ${table} (${fk}, player_id) VALUES ($1, $2)
       ON CONFLICT (${fk}, player_id) DO NOTHING`,
      [sessionId, playerId]
    );
  }

  const extras = await getSessionExtras(kind, sessionId);
  const currentParentIds = new Set(extras.map((extra) => extra.parent_id));

  // Drop unsent reminders for extra parents who are no longer on this session.
  // The host parent is never touched here.
  const droppedParentIds = [...previousParentIds].filter(
    (parentId) => !currentParentIds.has(parentId) && parentId !== Number(session.parent_id)
  );
  if (droppedParentIds.length > 0) {
    await query(
      `DELETE FROM crm_reminders
       WHERE ${kind === 'first' ? 'first_session_id' : 'session_id'} = $1
         AND reminder_category = 'session_reminder'
         AND sent = false
         AND parent_id = ANY($2::int[])`,
      [sessionId, droppedParentIds]
    );
  }

  await syncExtraParentReminders(kind, session, extras);

  return { ok: true, extras };
}

/**
 * Gives every extra parent the same parent-facing reminder set the host parent
 * gets for this session. `coach_session_start` is deliberately excluded — that
 * one texts the coach, and the coach should hear about the session once, not
 * once per family on it.
 */
export async function syncExtraParentReminders(
  kind: SessionKind,
  session: {
    id: number;
    parent_id: number;
    session_date: string | Date;
    session_end_date: string | Date | null;
    status: string | null;
    cancelled: boolean | null;
  },
  extras: SessionExtra[]
): Promise<void> {
  const isClosed =
    session.cancelled === true ||
    session.status === 'cancelled' ||
    session.status === 'completed' ||
    session.status === 'no_show';
  if (isClosed) return;

  const parentIds = [
    ...new Set(
      extras
        .map((extra) => extra.parent_id)
        .filter((parentId) => parentId !== Number(session.parent_id))
    ),
  ];

  for (const parentId of parentIds) {
    await createSessionReminders(parentId, session.session_date, {
      ...(kind === 'first' ? { firstSessionId: session.id } : { sessionId: session.id }),
      sessionEndDate: session.session_end_date,
      skipCoachReminders: true,
    });
  }
}

/**
 * Re-creates extra-parent reminders after a session's time changes. The PATCH
 * handlers wipe every unsent `session_reminder` row for the session and rebuild
 * the host parent's set; this rebuilds the extras' sets on the same new time.
 */
export async function refreshExtraParentReminders(
  kind: SessionKind,
  sessionId: string | number
): Promise<void> {
  await ensureSessionExtrasTables();
  const sessionTable = kind === 'first' ? 'crm_first_sessions' : 'crm_sessions';
  const sessionResult = await query(
    `SELECT id, parent_id, session_date, session_end_date, status, cancelled
     FROM ${sessionTable} WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  if (sessionResult.rows.length === 0) return;

  const extras = await getSessionExtras(kind, sessionId);
  if (extras.length === 0) return;

  await syncExtraParentReminders(kind, sessionResult.rows[0], extras);
}

/**
 * Extra parents' emails for a session's calendar invite.
 *
 * Derived at sync time rather than baked into the stored `guest_emails` column
 * so that removing an extra also removes their invite, and so a coach editing
 * the guest list by hand never has to think about them.
 */
export async function getExtraParentEmails(
  kind: SessionKind,
  sessionId: string | number
): Promise<string[]> {
  const extras = await getSessionExtras(kind, sessionId);
  const emails = extras
    .map((extra) => (extra.parent_email || '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

/** One-line "Kid (Parent · phone · email)" summaries for calendar descriptions. */
export function formatExtrasForDescription(extras: SessionExtra[]): string[] {
  return extras.map((extra) => {
    const contact = [extra.parent_name, extra.parent_phone, extra.parent_email]
      .map((value) => (value || '').trim())
      .filter(Boolean)
      .join(' · ');
    return contact ? `${extra.player_name} (${contact})` : extra.player_name;
  });
}
