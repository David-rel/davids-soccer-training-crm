import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createFirstSession } from '@/lib/create-session';
import { ensureFirstSessionCalendarColumns } from '@/lib/first-session-calendar-fields';
import { ensureSessionExtrasTables } from '@/lib/session-extras';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureFirstSessionCalendarColumns();
    await ensureSessionExtrasTables();

    const result = await query(`
      SELECT fs.*, p.name as parent_name, p.email as parent_email, st.name as coach_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids,
        COALESCE((
          SELECT json_agg(json_build_object(
                   'player_id', xpl.id,
                   'player_name', xpl.name,
                   'player_age', xpl.age,
                   'player_team', xpl.team,
                   'parent_id', xpar.id,
                   'parent_name', xpar.name,
                   'parent_email', xpar.email,
                   'parent_phone', xpar.phone,
                   'secondary_parent_name', xpar.secondary_parent_name
                 ) ORDER BY xpar.name, xpl.name)
          FROM crm_first_session_extras x
          JOIN crm_players xpl ON xpl.id = x.player_id
          JOIN crm_parents xpar ON xpar.id = xpl.parent_id
          WHERE x.first_session_id = fs.id
        ), '[]'::json) AS extras
      FROM crm_first_sessions fs
      JOIN crm_parents p ON p.id = fs.parent_id
      LEFT JOIN crm_staff st ON st.id = fs.coach_id
      LEFT JOIN crm_first_session_players fsp ON fsp.first_session_id = fs.id
      LEFT JOIN crm_players pl ON pl.id = fsp.player_id
      GROUP BY fs.id, p.name, p.email, st.name
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
    const result = await createFirstSession(body);
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonResponse(result.session, 201);
  } catch (error) {
    console.error('Error creating first session:', error);
    return errorResponse('Failed to create first session');
  }
}
