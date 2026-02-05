import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createFollowUpReminders } from '@/lib/reminders';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { showed_up, cancelled, was_paid, payment_method } = body;

    const result = await query(
      `UPDATE crm_first_sessions SET showed_up = $1, cancelled = $2, was_paid = $3, payment_method = $4, status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [showed_up, cancelled || false, was_paid || false, payment_method || null, id]
    );

    if (result.rows.length === 0) return errorResponse('First session not found', 404);

    const session = result.rows[0];

    // If showed up but no upcoming regular sessions, create follow-up reminders (post-first-session ghost scenario)
    if (showed_up && !cancelled) {
      const upcomingSessions = await query(
        `SELECT id FROM crm_sessions WHERE parent_id = $1 AND session_date > NOW() LIMIT 1`,
        [session.parent_id]
      );
      if (upcomingSessions.rows.length === 0) {
        await createFollowUpReminders(session.parent_id, 'post_first_session_follow_up', {
          anchorDate: session.session_date,
        });
      }
    }

    return jsonResponse(session);
  } catch (error) {
    console.error('Error completing first session:', error);
    return errorResponse('Failed to complete first session');
  }
}
