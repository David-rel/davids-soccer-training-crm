import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const result = await query(
      `UPDATE crm_first_sessions SET status = 'cancelled', cancelled = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) return errorResponse('First session not found', 404);

    // Cancelled first session: immediately remove all reminders tied to this session.
    await query(
      `DELETE FROM crm_reminders
       WHERE first_session_id = $1`,
      [id]
    );

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error cancelling first session:', error);
    return errorResponse('Failed to cancel first session');
  }
}
