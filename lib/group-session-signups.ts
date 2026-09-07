/**
 * Turning CRM players into group-session signups.
 *
 * The public signup flow writes `player_signups` rows from a web form, so the
 * table stores loose contact text rather than CRM ids. When a coach adds a
 * family from the CRM instead, we still write an ordinary `player_signups`
 * row — everything downstream (capacity, revenue, the public roster) keeps
 * working untouched — but we stamp it with `crm_player_id` so the same kid
 * can't be added twice and the picker can grey out who is already in.
 */
import { query } from '@/lib/db';
import type { NotifyRecipient } from '@/lib/group-session-notifications';

export interface CrmSignupCandidate {
  player_id: number;
  player_name: string;
  age: number | null;
  birthday: string | null;
  team: string | null;
  notes: string | null;
  parent_id: number;
  parent_name: string;
  parent_email: string | null;
  parent_phone: string | null;
}

export interface AddCrmPlayersResult {
  added: number;
  /** Already signed up for this session; left alone. */
  skipped: string[];
  /** Added, but their CRM contact is missing an email/phone. */
  warnings: string[];
  /**
   * Who to tell, one entry per FAMILY rather than per player, so a household
   * with two kids gets a single message naming both.
   */
  recipients: NotifyRecipient[];
}

let ensureCrmLinkPromise: Promise<void> | null = null;

/**
 * Mirrors the `ensure*` pattern used elsewhere in this codebase: the app
 * self-heals its schema on first touch so a deploy isn't gated on running
 * migrations by hand.
 */
export async function ensurePlayerSignupCrmLink(): Promise<void> {
  if (ensureCrmLinkPromise) {
    await ensureCrmLinkPromise;
    return;
  }

  ensureCrmLinkPromise = (async () => {
    await query(
      `ALTER TABLE player_signups
       ADD COLUMN IF NOT EXISTS crm_player_id INTEGER
       REFERENCES crm_players(id) ON DELETE SET NULL`
    );
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_player_signups_session_crm_player
       ON player_signups(group_session_id, crm_player_id)
       WHERE crm_player_id IS NOT NULL`
    );
  })().catch((error) => {
    ensureCrmLinkPromise = null;
    throw error;
  });

  await ensureCrmLinkPromise;
}

/** Normalizes whatever the client sent into a clean list of CRM player ids. */
export function parseCrmPlayerIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids = input
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(ids)];
}

/**
 * Splits a CRM player's single `name` field into the first/last the signup
 * table wants. A one-word name borrows the family surname so the roster still
 * reads like a person rather than a first name floating on its own.
 */
export function splitPlayerName(
  playerName: string,
  parentName: string
): { firstName: string; lastName: string } {
  const parts = playerName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || playerName.trim() || 'Player';

  if (parts.length > 1) {
    return { firstName, lastName: parts.slice(1).join(' ') };
  }

  const parentParts = parentName.trim().split(/\s+/).filter(Boolean);
  return { firstName, lastName: parentParts.length > 1 ? parentParts[parentParts.length - 1] : '' };
}

/**
 * Adds CRM players to a group session as unpaid prospects priced at the
 * session's own price. They stay prospects until money actually comes in, so
 * the session's "collected" total and paid-capacity count stay honest.
 */
export async function addCrmPlayersToGroupSession(
  groupSessionId: string | number,
  playerIds: number[]
): Promise<AddCrmPlayersResult> {
  await ensurePlayerSignupCrmLink();

  const sessionResult = await query(
    'SELECT id, price FROM group_sessions WHERE id = $1',
    [groupSessionId]
  );
  if (sessionResult.rows.length === 0) {
    throw new Error('Group session not found');
  }

  const rawPrice = sessionResult.rows[0].price;
  const sessionPrice = rawPrice == null ? null : Number(rawPrice);
  const signupPrice = sessionPrice != null && Number.isFinite(sessionPrice) ? sessionPrice : null;

  const candidatesResult = await query(
    `SELECT
       pl.id   AS player_id,
       pl.name AS player_name,
       pl.age,
       pl.birthday,
       pl.team,
       pl.notes,
       par.id    AS parent_id,
       par.name  AS parent_name,
       par.email AS parent_email,
       par.phone AS parent_phone
     FROM crm_players pl
     JOIN crm_parents par ON par.id = pl.parent_id
     WHERE pl.id = ANY($1::int[])
     ORDER BY par.name ASC, pl.name ASC`,
    [playerIds]
  );

  const candidates = candidatesResult.rows as CrmSignupCandidate[];

  const existingResult = await query(
    `SELECT crm_player_id
     FROM player_signups
     WHERE group_session_id = $1 AND crm_player_id IS NOT NULL`,
    [groupSessionId]
  );
  const alreadyIn = new Set(
    (existingResult.rows as Array<{ crm_player_id: number }>).map((row) => Number(row.crm_player_id))
  );

  const result: AddCrmPlayersResult = { added: 0, skipped: [], warnings: [], recipients: [] };
  const recipientsByParent = new Map<number, NotifyRecipient>();

  for (const candidate of candidates) {
    if (alreadyIn.has(Number(candidate.player_id))) {
      result.skipped.push(candidate.player_name);
      continue;
    }

    const { firstName, lastName } = splitPlayerName(candidate.player_name, candidate.parent_name);

    if (!candidate.parent_email && !candidate.parent_phone) {
      result.warnings.push(`${candidate.player_name} — no email or phone on ${candidate.parent_name}`);
    }

    await query(
      `INSERT INTO player_signups (
         group_session_id,
         crm_player_id,
         first_name,
         last_name,
         age,
         birthday,
         emergency_contact,
         contact_phone,
         contact_email,
         team,
         notes,
         signup_price,
         amount_paid,
         has_paid
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, false)
       ON CONFLICT DO NOTHING`,
      [
        groupSessionId,
        candidate.player_id,
        firstName,
        lastName,
        candidate.age,
        candidate.birthday,
        candidate.parent_name,
        candidate.parent_phone,
        candidate.parent_email || '',
        candidate.team,
        candidate.notes,
        signupPrice,
      ]
    );

    alreadyIn.add(Number(candidate.player_id));
    result.added += 1;

    const parentId = Number(candidate.parent_id);
    const existing = recipientsByParent.get(parentId);
    if (existing) {
      existing.playerNames.push(candidate.player_name);
    } else {
      recipientsByParent.set(parentId, {
        parentId,
        parentName: candidate.parent_name,
        email: candidate.parent_email,
        phone: candidate.parent_phone,
        playerNames: [candidate.player_name],
      });
    }
  }

  result.recipients = [...recipientsByParent.values()];
  return result;
}
