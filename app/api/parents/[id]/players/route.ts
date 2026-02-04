import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query(
      'SELECT * FROM crm_players WHERE parent_id = $1 ORDER BY created_at',
      [id]
    );
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching players:', error);
    return errorResponse('Failed to fetch players');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Verify parent exists
    const parent = await query('SELECT id FROM crm_parents WHERE id = $1', [id]);
    if (parent.rows.length === 0) {
      return errorResponse('Contact not found', 404);
    }

    const body = await request.json();
    const { name, age, team, gender, notes } = body;

    if (!name) {
      return errorResponse('Player name is required', 400);
    }

    const result = await query(
      `INSERT INTO crm_players (parent_id, name, age, team, gender, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, name, age || null, team || null, gender || null, notes || null]
    );

    return jsonResponse(result.rows[0], 201);
  } catch (error) {
    console.error('Error creating player:', error);
    return errorResponse('Failed to add player');
  }
}
