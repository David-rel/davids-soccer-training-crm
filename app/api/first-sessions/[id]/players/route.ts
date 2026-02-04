import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { player_ids } = body;

    if (!Array.isArray(player_ids)) {
      return errorResponse('player_ids must be an array', 400);
    }

    // Delete existing player associations
    await query(
      `DELETE FROM crm_first_session_players WHERE first_session_id = $1`,
      [id]
    );

    // Add new player associations
    if (player_ids.length > 0) {
      for (const playerId of player_ids) {
        await query(
          `INSERT INTO crm_first_session_players (first_session_id, player_id) VALUES ($1, $2)`,
          [id, playerId]
        );
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error updating first session players:', error);
    return errorResponse('Failed to update first session players');
  }
}
