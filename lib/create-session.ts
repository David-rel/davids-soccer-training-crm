/**
 * Session creation, extracted from the POST handlers in
 * `app/api/sessions/route.ts` and `app/api/first-sessions/route.ts` so that a
 * second caller — the /api/integrations/booking-request bridge used by the
 * booking app — runs the *same* code rather than a second implementation of it.
 *
 * These are the route bodies moved verbatim. The only change is the shape of
 * the return value: a result object instead of a `Response`, so callers that
 * aren't HTTP routes can act on the outcome.
 */
import { query } from '@/lib/db';
import { createSessionReminders } from '@/lib/reminders';
import { notifyCoachOfAssignment } from '@/lib/coach-notifications';
import { parseDatetimeLocalAsArizona } from '@/lib/timezone';
import {
  syncSessionToGoogleCalendarsSafe,
  syncFirstSessionToGoogleCalendarsSafe,
} from '@/lib/google-calendar';
import {
  defaultSessionEndFromStart,
  ensureParentEmailInGuestList,
  ensureSessionCalendarColumns,
  isEndAfterStart,
  normalizeSessionTitle,
  parseGuestEmails,
} from '@/lib/session-calendar-fields';
import {
  defaultFirstSessionEndFromStart,
  ensureFirstSessionCalendarColumns,
} from '@/lib/first-session-calendar-fields';
import { ensureStaffTables } from '@/app/api/staff/route';

export type CreateResult =
  | { ok: true; session: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/** Body accepted by both creators. Mirrors what the routes destructure today. */
export interface CreateSessionBody {
  parent_id?: unknown;
  player_ids?: unknown;
  session_date?: unknown;
  session_end_date?: unknown;
  location?: unknown;
  price?: unknown;
  package_id?: unknown;
  notes?: unknown;
  coach_id?: unknown;
  title?: unknown;
  guest_emails?: unknown;
  send_email_updates?: unknown;
  deposit_paid?: unknown;
  deposit_amount?: unknown;
}

export async function createSession(body: CreateSessionBody): Promise<CreateResult> {
  await ensureSessionCalendarColumns();
  await ensureStaffTables();

  const {
    parent_id,
    player_ids,
    session_date,
    session_end_date,
    location,
    price,
    package_id,
    notes,
    coach_id,
  } = body;

  if (!parent_id || !session_date) {
    return { ok: false, error: 'Parent and session date are required', status: 400 };
  }
  if ('send_email_updates' in body && typeof body.send_email_updates !== 'boolean') {
    return { ok: false, error: 'send_email_updates must be a boolean', status: 400 };
  }

  const normalizedTitle = normalizeSessionTitle(body.title);
  const sendEmailUpdates = body.send_email_updates === true;
  const parentResult = await query(`SELECT id, email FROM crm_parents WHERE id = $1 LIMIT 1`, [parent_id]);
  if (parentResult.rows.length === 0) {
    return { ok: false, error: 'Parent not found', status: 404 };
  }
  const parentEmail = parentResult.rows[0].email as string | null;

  const { emails: parsedGuestEmails, invalid: invalidGuestEmails } = parseGuestEmails(body.guest_emails);
  if (invalidGuestEmails.length > 0) {
    return { ok: false, error: `Invalid guest email(s): ${invalidGuestEmails.join(', ')}`, status: 400 };
  }
  const guestEmails = ensureParentEmailInGuestList(parsedGuestEmails, parentEmail);

  // Resolve the coach: an explicit coach_id wins; otherwise fall back to the
  // package's coach, then the coach the selected players are assigned to
  // (modal, tie-break by lowest staff id). This mirrors the inference used by
  // the payment tracker, so package-scheduled sessions get a real coach on
  // the row (and that coach gets texted) instead of coming through coach-less.
  let resolvedCoachId: number | null = coach_id ? Number(coach_id) : null;
  if (resolvedCoachId == null && package_id) {
    const pkgCoach = await query(
      `SELECT coach_id FROM crm_packages WHERE id = $1 LIMIT 1`,
      [package_id]
    );
    if (pkgCoach.rows[0]?.coach_id != null) resolvedCoachId = Number(pkgCoach.rows[0].coach_id);
  }
  if (resolvedCoachId == null && Array.isArray(player_ids) && player_ids.length > 0) {
    const playerCoach = await query(
      `SELECT coach_id FROM crm_players
       WHERE id = ANY($1::int[]) AND coach_id IS NOT NULL
       GROUP BY coach_id
       ORDER BY COUNT(*) DESC, coach_id ASC
       LIMIT 1`,
      [player_ids]
    );
    if (playerCoach.rows[0]?.coach_id != null) resolvedCoachId = Number(playerCoach.rows[0].coach_id);
  }

  const sessionDateUTC = parseDatetimeLocalAsArizona(session_date as string);
  const sessionEndDateUTC = session_end_date
    ? parseDatetimeLocalAsArizona(session_end_date as string)
    : defaultSessionEndFromStart(sessionDateUTC);

  if (!isEndAfterStart(sessionDateUTC, sessionEndDateUTC)) {
    return { ok: false, error: 'Session end time must be after start time', status: 400 };
  }

  const result = await query(
    `INSERT INTO crm_sessions (parent_id, title, session_date, session_end_date, location, price, package_id, notes, guest_emails, send_email_updates, coach_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      parent_id,
      normalizedTitle,
      sessionDateUTC,
      sessionEndDateUTC,
      location || null,
      price || null,
      package_id || null,
      notes || null,
      guestEmails,
      sendEmailUpdates,
      resolvedCoachId,
    ]
  );

  const session = result.rows[0];

  // Add players to junction table if provided
  if (player_ids && Array.isArray(player_ids) && player_ids.length > 0) {
    for (const playerId of player_ids) {
      await query(
        `INSERT INTO crm_session_players (session_id, player_id) VALUES ($1, $2)`,
        [session.id, playerId]
      );
    }
  }

  // Text the assigned coach that they have a new session (best-effort).
  if (resolvedCoachId != null) {
    await notifyCoachOfAssignment('session', session.id, resolvedCoachId);
  }

  // Create 48h, 24h, 6h reminders (use the UTC date)
  await createSessionReminders(parent_id as number, sessionDateUTC, {
    sessionId: session.id,
    sessionEndDate: sessionEndDateUTC,
  });

  // Update parent's last activity timestamp
  await query(
    `UPDATE crm_parents SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [parent_id]
  );

  // New session booked — cancel any pending drop-off follow-ups (they're back!)
  await query(
    `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category IN ('post_session_follow_up', 'post_first_session_follow_up') AND sent = false`,
    [parent_id]
  );

  await syncSessionToGoogleCalendarsSafe(session.id, 'session create');

  return { ok: true, session };
}

export async function createFirstSession(body: CreateSessionBody): Promise<CreateResult> {
  await ensureFirstSessionCalendarColumns();

  const {
    parent_id,
    player_ids,
    session_date,
    session_end_date,
    location,
    price,
    deposit_paid,
    deposit_amount,
    notes,
    coach_id,
  } = body;

  if (!parent_id || !session_date) {
    return { ok: false, error: 'Parent and session date are required', status: 400 };
  }
  if ('send_email_updates' in body && typeof body.send_email_updates !== 'boolean') {
    return { ok: false, error: 'send_email_updates must be a boolean', status: 400 };
  }

  const normalizedTitle = normalizeSessionTitle(body.title);
  const sendEmailUpdates = body.send_email_updates === true;

  const parentResult = await query(`SELECT id, email FROM crm_parents WHERE id = $1 LIMIT 1`, [parent_id]);
  if (parentResult.rows.length === 0) {
    return { ok: false, error: 'Parent not found', status: 404 };
  }
  const parentEmail = parentResult.rows[0].email as string | null;

  const { emails: parsedGuestEmails, invalid: invalidGuestEmails } = parseGuestEmails(body.guest_emails);
  if (invalidGuestEmails.length > 0) {
    return { ok: false, error: `Invalid guest email(s): ${invalidGuestEmails.join(', ')}`, status: 400 };
  }
  const guestEmails = ensureParentEmailInGuestList(parsedGuestEmails, parentEmail);

  // Convert datetime-local input (Arizona time) to UTC ISO string for storage
  const sessionDateUTC = parseDatetimeLocalAsArizona(session_date as string);
  const sessionEndDateUTC = session_end_date
    ? parseDatetimeLocalAsArizona(session_end_date as string)
    : defaultFirstSessionEndFromStart(sessionDateUTC);

  if (!isEndAfterStart(sessionDateUTC, sessionEndDateUTC)) {
    return { ok: false, error: 'Session end time must be after start time', status: 400 };
  }

  const result = await query(
    `INSERT INTO crm_first_sessions
       (parent_id, title, session_date, session_end_date, location, price, deposit_paid, deposit_amount, notes, guest_emails, send_email_updates, coach_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      parent_id,
      normalizedTitle,
      sessionDateUTC,
      sessionEndDateUTC,
      location || null,
      price || null,
      deposit_paid || false,
      deposit_amount || null,
      notes || null,
      guestEmails,
      sendEmailUpdates,
      coach_id != null && coach_id !== '' ? Number(coach_id) : null,
    ]
  );

  const session = result.rows[0];

  // Add players to junction table if provided
  if (player_ids && Array.isArray(player_ids) && player_ids.length > 0) {
    for (const playerId of player_ids) {
      await query(
        `INSERT INTO crm_first_session_players (first_session_id, player_id) VALUES ($1, $2)`,
        [session.id, playerId]
      );
    }
  }

  // Text the assigned coach that they have a new first session (best-effort).
  if (coach_id) {
    await notifyCoachOfAssignment('first', session.id, Number(coach_id));
  }

  // Update parent to be a customer and set call_outcome to session_booked
  await query(
    `UPDATE crm_parents SET is_customer = TRUE, call_outcome = 'session_booked', last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [parent_id]
  );

  // Create 48h, 24h, 6h reminders (use the UTC date)
  await createSessionReminders(parent_id as number, sessionDateUTC, {
    firstSessionId: session.id,
    sessionEndDate: sessionEndDateUTC,
  });

  await syncFirstSessionToGoogleCalendarsSafe(session.id, 'first session create');

  return { ok: true, session };
}
