import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { createFollowUpReminders } from '@/lib/reminders';
import { parseDateAsArizona } from '@/lib/timezone';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parentResult = await query('SELECT * FROM crm_parents WHERE id = $1', [id]);
    if (parentResult.rows.length === 0) {
      return errorResponse('Contact not found', 404);
    }

    const playersResult = await query('SELECT * FROM crm_players WHERE parent_id = $1 ORDER BY created_at', [id]);
    const firstSessionResult = await query('SELECT * FROM crm_first_sessions WHERE parent_id = $1 ORDER BY session_date DESC', [id]);
    const sessionsResult = await query('SELECT * FROM crm_sessions WHERE parent_id = $1 ORDER BY session_date DESC', [id]);
    const packagesResult = await query('SELECT * FROM crm_packages WHERE parent_id = $1 AND is_active = true LIMIT 1', [id]);
    const remindersResult = await query(
      'SELECT * FROM crm_reminders WHERE parent_id = $1 AND sent = false ORDER BY due_at',
      [id]
    );

    return jsonResponse({
      ...parentResult.rows[0],
      players: playersResult.rows,
      first_session: firstSessionResult.rows[0] || null,
      first_sessions: firstSessionResult.rows,
      sessions: sessionsResult.rows,
      active_package: packagesResult.rows[0] || null,
      pending_reminders: remindersResult.rows,
    });
  } catch (error) {
    console.error('Error fetching parent:', error);
    return errorResponse('Failed to fetch contact');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Check if parent exists
    const existing = await query('SELECT * FROM crm_parents WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return errorResponse('Contact not found', 404);
    }

    const oldParent = existing.rows[0];

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Convert call_date_time from Arizona time to UTC if present
    // The frontend sends date-only strings like "2026-02-06" which should be
    // interpreted as midnight Arizona time, not midnight UTC
    if (body.call_date_time && typeof body.call_date_time === 'string' && body.call_date_time.length === 10) {
      // Date-only format (YYYY-MM-DD) - convert to UTC
      body.call_date_time = parseDateAsArizona(body.call_date_time);
    }

    const allowedFields = [
      'name', 'email', 'phone', 'instagram_link', 'secondary_parent_name',
      'dm_status', 'phone_call_booked', 'call_date_time', 'call_outcome',
      'interest_in_package', 'notes'
    ];

    for (const field of allowedFields) {
      if (field in body) {
        fields.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return errorResponse('No fields to update', 400);
    }

    // Track activity on any status change
    const activityFields = ['dm_status', 'phone_call_booked', 'call_outcome', 'interest_in_package'];
    const hasActivityChange = activityFields.some(field => field in body);
    
    if (hasActivityChange) {
      fields.push(`last_activity_at = CURRENT_TIMESTAMP`);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await query(
      `UPDATE crm_parents SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    // Auto-create/cancel follow-up reminders based on status changes
    const newParent = result.rows[0];

    // DM status changed — at ANY stage they could stop replying
    // So every DM status change: clear old follow-ups, create fresh ones
    if (body.dm_status && body.dm_status !== oldParent.dm_status) {
      // Clear any existing unsent DM follow-ups first (avoid duplicates)
      await query(
        `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category = 'dm_follow_up' AND sent = false`,
        [id]
      );
      // Create fresh 1/3/7/14 day follow-ups from now
      // (covers: first message no reply, started talking then ghosted, asked for call then ghosted, went cold)
      await createFollowUpReminders(parseInt(id), 'dm_follow_up');
    }

    // Phone call booked — they've moved past DMs, cancel DM follow-ups
    if (body.phone_call_booked === true && !oldParent.phone_call_booked) {
      await query(
        `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category = 'dm_follow_up' AND sent = false`,
        [id]
      );
    }

    // Post-call ghost scenario
    if ((body.call_outcome === 'thinking_about_it' || body.call_outcome === 'went_cold') &&
        oldParent.call_outcome !== body.call_outcome) {
      await query(
        `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category = 'post_call_follow_up' AND sent = false`,
        [id]
      );
      await createFollowUpReminders(parseInt(id), 'post_call_follow_up', {
        anchorDate: newParent.call_date_time || body.call_date_time || new Date(),
        anchorTimezone: 'arizona_local',
      });
    }
    // If they book a session after the call, cancel post-call follow-ups
    if (body.call_outcome === 'session_booked' && oldParent.call_outcome !== 'session_booked') {
      await query(
        `DELETE FROM crm_reminders WHERE parent_id = $1 AND reminder_category = 'post_call_follow_up' AND sent = false`,
        [id]
      );
    }

    return jsonResponse(newParent);
  } catch (error) {
    console.error('Error updating parent:', error);
    return errorResponse('Failed to update contact');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query('DELETE FROM crm_parents WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return errorResponse('Contact not found', 404);
    }
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Error deleting parent:', error);
    return errorResponse('Failed to delete contact');
  }
}
