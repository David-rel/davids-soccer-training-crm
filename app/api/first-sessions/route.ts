import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createSessionReminders } from '@/lib/reminders';
import { parseDatetimeLocalAsArizona } from '@/lib/timezone';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await query(`
      SELECT fs.*, p.name as parent_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids
      FROM crm_first_sessions fs
      JOIN crm_parents p ON p.id = fs.parent_id
      LEFT JOIN crm_first_session_players fsp ON fsp.first_session_id = fs.id
      LEFT JOIN crm_players pl ON pl.id = fsp.player_id
      GROUP BY fs.id, p.name
      ORDER BY fs.session_date DESC
    `);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching first sessions:', error);
    return errorResponse('Failed to fetch first sessions');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parent_id, player_ids, session_date, location, price, deposit_paid, deposit_amount, notes } = body;

    if (!parent_id || !session_date) {
      return errorResponse('Parent and session date are required', 400);
    }

    // Convert datetime-local input (Arizona time) to UTC ISO string for storage
    const sessionDateUTC = parseDatetimeLocalAsArizona(session_date);

    const result = await query(
      `INSERT INTO crm_first_sessions (parent_id, session_date, location, price, deposit_paid, deposit_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [parent_id, sessionDateUTC, location || null, price || null, deposit_paid || false, deposit_amount || null, notes || null]
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

    // Update parent to be a customer and set call_outcome to session_booked
    await query(
      `UPDATE crm_parents SET is_customer = TRUE, call_outcome = 'session_booked', last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [parent_id]
    );

    // Create 48h, 24h, 6h reminders (use the UTC date)
    await createSessionReminders(parent_id, sessionDateUTC, { firstSessionId: session.id });

    return jsonResponse(session, 201);
  } catch (error) {
    console.error('Error creating first session:', error);
    return errorResponse('Failed to create first session');
  }
}
