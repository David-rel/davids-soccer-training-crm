import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { addCrmPlayersToGroupSession, parseCrmPlayerIds } from '@/lib/group-session-signups';

export const dynamic = 'force-dynamic';

/**
 * Bulk-adds CRM players to a group session. The client sends player ids — a
 * whole family is just that parent's players expanded before the call — and
 * each one lands as an unpaid prospect priced at the session's price.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const playerIds = parseCrmPlayerIds(body.player_ids);
    if (playerIds.length === 0) {
      return errorResponse('Select at least one player to add', 400);
    }

    const result = await addCrmPlayersToGroupSession(id, playerIds);
    return jsonResponse(result, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'Group session not found') {
      return errorResponse('Group session not found', 404);
    }
    console.error('Error adding CRM players to group session:', error);
    return errorResponse('Failed to add players from the CRM');
  }
}
