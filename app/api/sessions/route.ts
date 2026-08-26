import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createSession } from '@/lib/create-session';
import { ensureSessionCalendarColumns } from '@/lib/session-calendar-fields';
import { ensureSessionExtrasTables } from '@/lib/session-extras';
import { ensureStaffTables } from '@/app/api/staff/route';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureSessionCalendarColumns();
    await ensureStaffTables();
    await ensureSessionExtrasTables();

    const searchParams = request.nextUrl.searchParams;
    const parentId = searchParams.get('parent_id');
    const upcoming = searchParams.get('upcoming');

    let sql = `
      SELECT s.*, p.name as parent_name, p.email as parent_email, st.name as coach_name,
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
          FROM crm_session_extras x
          JOIN crm_players xpl ON xpl.id = x.player_id
          JOIN crm_parents xpar ON xpar.id = xpl.parent_id
          WHERE x.session_id = s.id
        ), '[]'::json) AS extras
      FROM crm_sessions s
      JOIN crm_parents p ON p.id = s.parent_id
      LEFT JOIN crm_staff st ON st.id = s.coach_id
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

    sql += ' GROUP BY s.id, p.name, p.email, st.name ORDER BY s.session_date DESC';

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
    const result = await createSession(body);
    if (!result.ok) return errorResponse(result.error, result.status);
    return jsonResponse(result.session, 201);
  } catch (error) {
    console.error('Error creating session:', error);
    return errorResponse('Failed to create session');
  }
}
