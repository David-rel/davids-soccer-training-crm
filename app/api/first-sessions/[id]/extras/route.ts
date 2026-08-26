import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { syncFirstSessionToGoogleCalendarsSafe } from '@/lib/google-calendar';
import {
  ensureSessionExtrasTables,
  getSessionExtras,
  parseExtraPlayerIds,
  setSessionExtras,
} from '@/lib/session-extras';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSessionExtrasTables();
    const { id } = await params;
    return jsonResponse(await getSessionExtras('first', id));
  } catch (error) {
    console.error('Error fetching session extras:', error);
    return errorResponse('Failed to fetch session extras');
  }
}

/**
 * Replaces the whole extras list for this session. Mirrors the players
 * sub-route next door, which is also a full replace rather than a patch.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!Array.isArray(body.extra_player_ids)) {
      return errorResponse('extra_player_ids must be an array', 400);
    }

    const result = await setSessionExtras('first', id, parseExtraPlayerIds(body.extra_player_ids));
    if (!result.ok) return errorResponse(result.error, result.status);

    // Extra parents ride on the calendar invite, so the event needs a re-sync.
    await syncFirstSessionToGoogleCalendarsSafe(id, 'first session extras update');

    return jsonResponse({ success: true, extras: result.extras });
  } catch (error) {
    console.error('Error updating session extras:', error);
    return errorResponse('Failed to update session extras');
  }
}
