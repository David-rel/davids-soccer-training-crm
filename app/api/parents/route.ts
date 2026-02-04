import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createFollowUpReminders } from '@/lib/reminders';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'recent';
    const filter = searchParams.get('filter');

    let sql = `
      SELECT p.*,
        (SELECT COUNT(*) FROM crm_players WHERE parent_id = p.id) as player_count,
        (SELECT COUNT(*) FROM crm_first_sessions WHERE parent_id = p.id AND showed_up = true) as first_sessions_count,
        (SELECT COUNT(*) FROM crm_sessions WHERE parent_id = p.id AND showed_up = true) as sessions_count,
        (SELECT COALESCE(SUM(price), 0) FROM crm_first_sessions WHERE parent_id = p.id AND was_paid = true)
        + (SELECT COALESCE(SUM(price), 0) FROM crm_sessions WHERE parent_id = p.id AND was_paid = true) as total_paid,
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
    const { name, email, phone, instagram_link, secondary_parent_name, dm_status, notes, players } = body;

    if (!name) {
      return errorResponse('Name is required', 400);
    }

    const result = await query(
      `INSERT INTO crm_parents (name, email, phone, instagram_link, secondary_parent_name, dm_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, email || null, phone || null, instagram_link || null, secondary_parent_name || null, dm_status || null, notes || null]
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

    // If DM status is first_message, auto-create follow-up reminders
    // (so you remember to text again if they don't reply)
    if (dm_status === 'first_message') {
      await createFollowUpReminders(parent.id, 'dm_follow_up');
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
