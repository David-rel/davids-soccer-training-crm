import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createSessionReminders } from '@/lib/reminders';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const parentId = searchParams.get('parent_id');
    const upcoming = searchParams.get('upcoming');

    let sql = `
      SELECT s.*, p.name as parent_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids
      FROM crm_sessions s
      JOIN crm_parents p ON p.id = s.parent_id
      LEFT JOIN crm_session_players sp ON sp.session_id = s.id
      LEFT JOIN crm_players pl ON pl.id = sp.player_id
    `;
    const params: string[] = [];

    if (parentId) {
      params.push(parentId);
      sql += ` WHERE s.parent_id = $${params.length}`;
    }

    if (upcoming === 'true') {
      sql += params.length ? ' AND' : ' WHERE';
      sql += ' s.session_date >= NOW() AND s.cancelled = false';
    }

    sql += ' GROUP BY s.id, p.name ORDER BY s.session_date DESC';

    const result = await query(sql, params);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return errorResponse('Failed to fetch sessions');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parent_id, player_ids, session_date, location, price, package_id, notes } = body;

    if (!parent_id || !session_date) {
      return errorResponse('Parent and session date are required', 400);
    }

    const result = await query(
      `INSERT INTO crm_sessions (parent_id, session_date, location, price, package_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [parent_id, session_date, location || null, price || null, package_id || null, notes || null]
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

    // Create 48h, 24h, 6h reminders
    await createSessionReminders(parent_id, session_date, { sessionId: session.id });

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

    return jsonResponse(session, 201);
  } catch (error) {
    console.error('Error creating session:', error);
    return errorResponse('Failed to create session');
  }
}
