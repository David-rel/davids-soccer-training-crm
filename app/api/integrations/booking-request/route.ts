/**
 * Bridge endpoint for the booking app (davids-private-training-app).
 *
 * When a booking request from /book is confirmed over there, it posts here to
 * turn that request into a real CRM session. Creation itself goes through
 * `lib/create-session.ts` — the same functions /api/sessions and
 * /api/first-sessions call — so Google Calendar sync, the 48/24/6h reminders,
 * the coach SMS and the is_customer flip all happen exactly once, in the code
 * that owns them.
 *
 * Machine-to-machine, so it never carries the CRM session cookie; middleware
 * lets /api/integrations through and this route authenticates itself against
 * BRIDGE_SECRET instead.
 */
import { NextRequest } from 'next/server';

import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createSession, createFirstSession } from '@/lib/create-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Constant-time compare so the secret's contents don't leak via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = (process.env.BRIDGE_SECRET || '').trim();
  if (!secret) return false;
  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented) return false;
  return timingSafeEqual(presented, secret);
}

type ParentRef = { id?: unknown; create?: { name?: unknown; email?: unknown; phone?: unknown } };
type PlayerRef = { id?: unknown; create?: { name?: unknown } };

interface BridgeBody {
  kind?: unknown;
  parent?: ParentRef;
  players?: PlayerRef[];
  session_date?: unknown;
  session_end_date?: unknown;
  location?: unknown;
  price?: unknown;
  title?: unknown;
  notes?: unknown;
  package_id?: unknown;
  coach_slug?: unknown;
  send_email_updates?: unknown;
}

/** Resolve an existing parent id, or create the parent row. */
async function resolveParent(ref: ParentRef | undefined): Promise<
  { ok: true; id: number } | { ok: false; error: string; status: number }
> {
  if (ref?.id != null && ref.id !== '') {
    const id = Number(ref.id);
    if (!Number.isInteger(id)) return { ok: false, error: 'parent.id must be an integer', status: 400 };
    const found = await query(`SELECT id FROM crm_parents WHERE id = $1 LIMIT 1`, [id]);
    if (found.rows.length === 0) return { ok: false, error: 'Parent not found', status: 404 };
    return { ok: true, id };
  }

  const name = typeof ref?.create?.name === 'string' ? ref.create.name.trim() : '';
  if (!name) return { ok: false, error: 'parent.id or parent.create.name is required', status: 400 };

  const email = typeof ref?.create?.email === 'string' ? ref.create.email.trim() || null : null;
  const phone = typeof ref?.create?.phone === 'string' ? ref.create.phone.trim() || null : null;

  const created = await query(
    `INSERT INTO crm_parents (name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
    [name, email, phone]
  );
  return { ok: true, id: Number(created.rows[0].id) };
}

/** Resolve existing player ids, creating any that came through as {create}. */
async function resolvePlayers(
  refs: PlayerRef[] | undefined,
  parentId: number
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string; status: number }> {
  const ids: number[] = [];
  for (const ref of refs ?? []) {
    if (ref?.id != null && ref.id !== '') {
      const id = Number(ref.id);
      if (!Number.isInteger(id)) return { ok: false, error: 'players[].id must be an integer', status: 400 };
      // Scoped to the parent so a bad id can't attach someone else's kid.
      const found = await query(
        `SELECT id FROM crm_players WHERE id = $1 AND parent_id = $2 LIMIT 1`,
        [id, parentId]
      );
      if (found.rows.length === 0) {
        return { ok: false, error: `Player ${id} does not belong to parent ${parentId}`, status: 400 };
      }
      ids.push(id);
      continue;
    }

    const name = typeof ref?.create?.name === 'string' ? ref.create.name.trim() : '';
    if (!name) return { ok: false, error: 'players[].id or players[].create.name is required', status: 400 };

    const created = await query(
      `INSERT INTO crm_players (parent_id, name) VALUES ($1, $2) RETURNING id`,
      [parentId, name]
    );
    ids.push(Number(created.rows[0].id));
  }
  return { ok: true, ids };
}

/** Map a booking-app coach slug (david, simon, …) to a crm_staff id. */
async function resolveCoachId(slug: unknown): Promise<number | null> {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  const found = await query(`SELECT id FROM crm_staff WHERE slug = $1 LIMIT 1`, [slug.trim()]);
  return found.rows.length > 0 ? Number(found.rows[0].id) : null;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = (await request.json()) as BridgeBody;

    const kind = body.kind === 'first' ? 'first' : body.kind === 'session' ? 'session' : null;
    if (!kind) return errorResponse("kind must be 'first' or 'session'", 400);
    if (typeof body.session_date !== 'string' || !body.session_date) {
      return errorResponse('session_date is required', 400);
    }

    const parent = await resolveParent(body.parent);
    if (!parent.ok) return errorResponse(parent.error, parent.status);

    const players = await resolvePlayers(body.players, parent.id);
    if (!players.ok) return errorResponse(players.error, players.status);

    const coachId = await resolveCoachId(body.coach_slug);

    const input = {
      parent_id: parent.id,
      player_ids: players.ids,
      session_date: body.session_date,
      session_end_date: body.session_end_date,
      location: body.location,
      price: body.price,
      title: body.title,
      notes: body.notes,
      coach_id: coachId,
      send_email_updates: body.send_email_updates === true,
      // A package only ever applies to a regular session; a first session by
      // definition predates one.
      package_id: kind === 'session' ? body.package_id : null,
    };

    const result = kind === 'first' ? await createFirstSession(input) : await createSession(input);
    if (!result.ok) return errorResponse(result.error, result.status);

    return jsonResponse(
      { kind, parent_id: parent.id, player_ids: players.ids, session: result.session },
      201
    );
  } catch (error) {
    console.error('Error creating session from booking request:', error);
    return errorResponse('Failed to create session from booking request');
  }
}
