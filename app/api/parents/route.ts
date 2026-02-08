import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createFollowUpReminders } from '@/lib/reminders';
import { parseDateAsArizona, parseDatetimeLocalAsArizona } from '@/lib/timezone';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function normalizeCallDateTimeInput(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim().length === 0) return value;

  const normalized = value.trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);

  // Date-only: interpret as Arizona midnight
  if (normalized.length === 10) {
    return parseDateAsArizona(normalized);
  }

  // Datetime without timezone: interpret as Arizona local datetime
  if (!hasTimezone) {
    return parseDatetimeLocalAsArizona(normalized.replace(' ', 'T'));
  }

  return normalized;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'recent';
    const filter = searchParams.get('filter');

    let sql = `
      SELECT p.*,
        (SELECT COUNT(*) FROM crm_players WHERE parent_id = p.id) as player_count,
        (SELECT COUNT(*)
         FROM crm_first_sessions
         WHERE parent_id = p.id
           AND COALESCE(cancelled, false) = false
           AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as first_sessions_count,
        (SELECT COUNT(*)
         FROM crm_sessions
         WHERE parent_id = p.id
           AND COALESCE(cancelled, false) = false
           AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as sessions_count,
        (SELECT COALESCE(SUM(price), 0)
         FROM crm_first_sessions
         WHERE parent_id = p.id
           AND price IS NOT NULL
           AND COALESCE(cancelled, false) = false
           AND (status IS NULL OR status NOT IN ('cancelled', 'no_show')))
        + (SELECT COALESCE(SUM(price), 0)
           FROM crm_sessions
           WHERE parent_id = p.id
             AND price IS NOT NULL
             AND COALESCE(cancelled, false) = false
             AND (status IS NULL OR status NOT IN ('cancelled', 'no_show')))
        + (SELECT COALESCE(SUM(amount_received), 0)
           FROM crm_packages
           WHERE parent_id = p.id) as total_paid,
        (SELECT package_type FROM crm_packages WHERE parent_id = p.id AND is_active = true LIMIT 1) as active_package_type,
        (SELECT ARRAY_AGG(name ORDER BY created_at) FROM crm_players WHERE parent_id = p.id) as player_names
      FROM crm_parents p
    `;
    const params: string[] = [];
    const conditions: string[] = [];

    if (filter === 'customers') {
      conditions.push(`p.is_customer = true`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.email ILIKE $${params.length} OR p.phone ILIKE $${params.length} OR p.instagram_link ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    switch (sort) {
      case 'most_paid':
        sql += ' ORDER BY total_paid DESC';
        break;
      case 'most_sessions':
        sql += ' ORDER BY (first_sessions_count + sessions_count) DESC';
        break;
      case 'name':
        sql += ' ORDER BY p.name ASC';
        break;
      default:
        sql += ' ORDER BY p.created_at DESC';
    }

    const result = await query(sql, params);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching parents:', error);
    return errorResponse('Failed to fetch contacts');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      phone,
      instagram_link,
      secondary_parent_name,
      dm_status,
      phone_call_booked,
      call_date_time,
      call_outcome,
      notes,
      players
    } = body;

    if (!name) {
      return errorResponse('Name is required', 400);
    }

    let normalizedCallDateTime = call_date_time || null;
    normalizedCallDateTime = normalizeCallDateTimeInput(normalizedCallDateTime);

    const result = await query(
      `INSERT INTO crm_parents (name, email, phone, instagram_link, secondary_parent_name, dm_status, phone_call_booked, call_date_time, call_outcome, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ($8::timestamptz AT TIME ZONE 'UTC'), $9, $10)
       RETURNING *`,
      [
        name,
        email || null,
        phone || null,
        instagram_link || null,
        secondary_parent_name || null,
        dm_status || null,
        phone_call_booked === true,
        normalizedCallDateTime,
        call_outcome || null,
        notes || null
      ]
    );

    const parent = result.rows[0];

    // Insert players if provided
    if (players && players.length > 0) {
      for (const player of players) {
        await query(
          `INSERT INTO crm_players (parent_id, name, age, team, gender, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [parent.id, player.name, player.age || null, player.team || null, player.gender || null, player.notes || null]
        );
      }
    }

    // Create DM follow-ups for all active DM stages.
    if (dm_status === 'first_message' || dm_status === 'started_talking' || dm_status === 'request_phone_call') {
      await createFollowUpReminders(parent.id, 'dm_follow_up');
    }

    // Once a call is booked, they are past DM stage.
    if (phone_call_booked === true) {
      await query(
        `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category = 'dm_follow_up' AND sent = false`,
        [parent.id]
      );
    }

    // Post-call follow-ups start when outcome is "thinking_about_it" or "went_cold".
    if (call_outcome === 'thinking_about_it' || call_outcome === 'went_cold') {
      await createFollowUpReminders(parent.id, 'post_call_follow_up', {
        anchorDate: normalizedCallDateTime || new Date(),
        anchorTimezone: 'arizona_local',
      });
    }

    // Fetch the complete parent with players
    const fullResult = await query(
      `SELECT * FROM crm_parents WHERE id = $1`,
      [parent.id]
    );
    const playersResult = await query(
      `SELECT * FROM crm_players WHERE parent_id = $1 ORDER BY created_at`,
      [parent.id]
    );

    return jsonResponse({ ...fullResult.rows[0], players: playersResult.rows }, 201);
  } catch (error) {
    console.error('Error creating parent:', error);
    return errorResponse('Failed to create contact');
  }
}
