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
      `UPDATE crm_sessions SET showed_up = $1, cancelled = $2, was_paid = $3, payment_method = $4, status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [showed_up, cancelled || false, was_paid || false, payment_method || null, id]
    );

    if (result.rows.length === 0) return errorResponse('Session not found', 404);

    const session = result.rows[0];

    // Update package sessions_completed if tied to a package
    if (session.package_id && showed_up && !cancelled) {
      await query(
        `UPDATE crm_packages SET sessions_completed = sessions_completed + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [session.package_id]
      );
    }

    // If showed up but no upcoming sessions booked, create follow-up reminders
    // Catches clients who drop off after any number of sessions
    if (showed_up && !cancelled) {
      const upcoming = await query(
        `SELECT id FROM crm_sessions WHERE parent_id = $1 AND session_date > NOW() AND cancelled = false LIMIT 1`,
        [session.parent_id]
      );
      if (upcoming.rows.length === 0) {
        // Clear any existing session drop-off follow-ups first
        await query(
          `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category = 'post_session_follow_up' AND sent = false`,
          [session.parent_id]
        );
        await createFollowUpReminders(session.parent_id, 'post_session_follow_up', {
          anchorDate: session.session_date,
        });
      }
    }

    return jsonResponse(session);
  } catch (error) {
    console.error('Error completing session:', error);
    return errorResponse('Failed to complete session');
  }
}
