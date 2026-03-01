import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { syncFirstSessionToGoogleCalendarsSafe } from '@/lib/google-calendar';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    const result = await query(
      `UPDATE crm_first_sessions SET status = 'no_show', showed_up = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) return errorResponse('First session not found', 404);
    await syncFirstSessionToGoogleCalendarsSafe(result.rows[0].id, 'first session no-show');

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error marking first session as no show:', error);
    return errorResponse('Failed to mark first session as no show');
  }
}
