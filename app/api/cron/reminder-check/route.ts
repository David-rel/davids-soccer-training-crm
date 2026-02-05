import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { createSessionReminders, createFollowUpReminders } from '@/lib/reminders';
import { nowInArizona } from '@/lib/timezone';

/**
 * Unified Reminder Checker Cron Job
 *
 * Runs daily at 9:00 AM Arizona time.
 * In UTC that is always 16:00 (Arizona is fixed at UTC-7).
 *
 * This job:
 * 1. Ensures all upcoming sessions have 48h, 24h, 6h reminders
 * 2. Detects cold leads at various stages and creates follow-ups
 * 3. Cleans up old/stale reminders
 */

// Cold lead thresholds - how many days of inactivity before we create follow-ups
const COLD_LEAD_THRESHOLDS = [
  {
    stage: 'first_message',
    daysInactive: 1,
    reminderCategory: 'dm_follow_up',
    description: 'Sent first DM, no response'
  },
  {
    stage: 'started_talking',
    daysInactive: 1,
    reminderCategory: 'dm_follow_up',
    description: 'Was talking, now silent'
  },
  {
    stage: 'request_phone_call',
    daysInactive: 1,
    reminderCategory: 'dm_follow_up',
    description: 'Requested call, waiting for booking'
  },
  {
    stage: 'post_call',
    daysInactive: 1,
    reminderCategory: 'post_call_follow_up',
    description: 'Had call, no booking yet'
  },
  {
    stage: 'post_first_session',
    daysInactive: 1,
    reminderCategory: 'post_first_session_follow_up',
    description: 'First session done, no package bought'
  },
  {
    stage: 'active_customer_dropped',
    daysInactive: 1,
    reminderCategory: 'post_session_follow_up',
    description: 'Regular customer, been quiet'
  }
];

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Verify the request is from Vercel Cron (or allow manual trigger with secret)
    const cronHeader = request.headers.get('x-vercel-cron');
    const authHeader = request.headers.get('authorization');

    const isVercelCron = cronHeader === '1';
    const isManualWithSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isVercelCron && !isManualWithSecret) {
      return new Response('Unauthorized', { status: 401 });
    }

    const results = {
      sessionRemindersCreated: 0,
      coldLeadRemindersCreated: 0,
      staleRemindersDeleted: 0,
      details: {
        firstSessionsChecked: 0,
        sessionsChecked: 0,
        coldLeadsDetected: [] as Array<{ name: string; stage: string; daysInactive: number }>
      }
    };

    // ============================================
    // 1. SESSION REMINDERS - Ensure all upcoming sessions have reminders
    // ============================================

    // First sessions missing reminders
    const firstSessionsMissingReminders = await query(`
      SELECT fs.id, fs.parent_id, fs.session_date, p.name
      FROM crm_first_sessions fs
      JOIN crm_parents p ON p.id = fs.parent_id
      WHERE (fs.status IS NULL OR fs.status NOT IN ('cancelled', 'completed', 'no_show'))
        AND fs.session_date > NOW()
        AND NOT EXISTS (
          SELECT 1 FROM crm_reminders r
          WHERE r.first_session_id = fs.id
            AND r.reminder_category = 'session_reminder'
            AND r.sent = false
        )
      ORDER BY fs.session_date
    `);

    results.details.firstSessionsChecked = firstSessionsMissingReminders.rows.length;

    for (const fs of firstSessionsMissingReminders.rows) {
      await createSessionReminders(fs.parent_id, fs.session_date, { firstSessionId: fs.id });
      results.sessionRemindersCreated += 3; // 48h, 24h, 6h
    }

    // Regular sessions missing reminders
    const sessionsMissingReminders = await query(`
      SELECT s.id, s.parent_id, s.session_date, p.name
      FROM crm_sessions s
      JOIN crm_parents p ON p.id = s.parent_id
      WHERE (s.status IS NULL OR s.status NOT IN ('cancelled', 'completed', 'no_show'))
        AND s.session_date > NOW()
        AND NOT EXISTS (
          SELECT 1 FROM crm_reminders r
          WHERE r.session_id = s.id
            AND r.reminder_category = 'session_reminder'
            AND r.sent = false
        )
      ORDER BY s.session_date
    `);

    results.details.sessionsChecked = sessionsMissingReminders.rows.length;

    for (const s of sessionsMissingReminders.rows) {
      await createSessionReminders(s.parent_id, s.session_date, { sessionId: s.id });
      results.sessionRemindersCreated += 3; // 48h, 24h, 6h
    }

    // ============================================
    // 2. COLD LEAD DETECTION - Create follow-ups for inactive contacts
    // ============================================

    const parentsResult = await query(`
      SELECT
        p.*,
        (SELECT COUNT(*) FROM crm_first_sessions WHERE parent_id = p.id AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as first_session_count,
        (SELECT MIN(session_date) FROM crm_first_sessions WHERE parent_id = p.id AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as first_session_anchor_at,
        (SELECT MAX(session_date) FROM crm_first_sessions WHERE parent_id = p.id AND status = 'completed' AND showed_up = true) as last_completed_first_session_at,
        (SELECT COUNT(*) FROM crm_sessions WHERE parent_id = p.id AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as session_count,
        (SELECT MAX(session_date) FROM crm_sessions WHERE parent_id = p.id AND status = 'completed' AND showed_up = true) as last_completed_session_at,
        (SELECT COUNT(*) FROM crm_reminders WHERE parent_id = p.id AND reminder_category LIKE '%follow_up%' AND sent = false) as pending_follow_ups,
        EXTRACT(DAY FROM NOW() - p.last_activity_at) as days_inactive
      FROM crm_parents p
      WHERE p.last_activity_at < NOW() - INTERVAL '1 day'
      ORDER BY p.last_activity_at ASC
    `);

    for (const parent of parentsResult.rows) {
      const daysInactive = Math.floor(parent.days_inactive || 0);

      // For DM/call stages we only create one active set at a time.
      // Session-based follow-ups are anchored to session dates and can safely be backfilled.
      const hasPendingFollowUps = Number(parent.pending_follow_ups) > 0;

      // Determine their current stage and applicable threshold
      let stage: string | null = null;
      let threshold = null;

      // Priority order matters here - check from most progressed to least

      // Active customer who dropped off
      if (parent.is_customer && parent.last_completed_session_at) {
        stage = 'active_customer_dropped';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'active_customer_dropped');
      }
      // Has first session track, no regular sessions yet
      else if (Number(parent.first_session_count) > 0 && Number(parent.session_count) === 0) {
        stage = 'post_first_session';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'post_first_session');
      }
      // Had a call with outcome thinking/went_cold
      else if (parent.call_outcome === 'thinking_about_it' || parent.call_outcome === 'went_cold') {
        stage = 'post_call';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'post_call');
      }
      // Had a call that's in the past (call happened, no outcome set)
      else if (parent.phone_call_booked && parent.call_date_time && new Date(parent.call_date_time) < new Date()) {
        stage = 'post_call';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'post_call');
      }
      // In DM stage - request_phone_call
      else if (parent.dm_status === 'request_phone_call') {
        stage = 'request_phone_call';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'request_phone_call');
      }
      // In DM stage - started_talking
      else if (parent.dm_status === 'started_talking') {
        stage = 'started_talking';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'started_talking');
      }
      // In DM stage - first_message
      else if (parent.dm_status === 'first_message') {
        stage = 'first_message';
        threshold = COLD_LEAD_THRESHOLDS.find(t => t.stage === 'first_message');
      }

      if (!stage || !threshold) continue;

      const isSessionBasedStage = stage === 'post_first_session' || stage === 'active_customer_dropped';
      if (!isSessionBasedStage && hasPendingFollowUps) {
        continue;
      }

      // Check if they've exceeded the inactivity threshold
      if (daysInactive >= threshold.daysInactive) {
        const anchorDate =
          stage === 'post_first_session'
            ? parent.first_session_anchor_at
            : stage === 'active_customer_dropped'
              ? parent.last_completed_session_at
              : stage === 'post_call'
                ? parent.call_date_time
                : undefined;
        const anchorTimezone = stage === 'post_call' ? 'arizona_local' : 'utc';

        const created = await createFollowUpReminders(parent.id, threshold.reminderCategory, {
          anchorDate: anchorDate || undefined,
          anchorTimezone,
        });

        if (created > 0) {
          results.coldLeadRemindersCreated += created;
          results.details.coldLeadsDetected.push({
            name: parent.name,
            stage,
            daysInactive
          });
        }
      }
    }

    // ============================================
    // 3. CLEANUP - Delete stale reminders
    // ============================================

    // Delete session reminders for cancelled/completed sessions
    const deletedCancelledSessionReminders = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category = 'session_reminder'
        AND r.sent = false
        AND (
          (r.first_session_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM crm_first_sessions fs
            WHERE fs.id = r.first_session_id
            AND fs.status IN ('cancelled', 'completed', 'no_show')
          ))
          OR
          (r.session_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM crm_sessions s
            WHERE s.id = r.session_id
            AND s.status IN ('cancelled', 'completed', 'no_show')
          ))
        )
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedCancelledSessionReminders.rowCount || 0;

    // Delete session reminders for past sessions (more than 1 day old)
    const deletedPastSessionReminders = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category = 'session_reminder'
        AND r.sent = false
        AND r.due_at < NOW() - INTERVAL '1 day'
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedPastSessionReminders.rowCount || 0;

    // Delete follow-up reminders for contacts who have progressed (e.g., booked a session)
    // DM follow-ups for people who now have a call booked
    const deletedDmFollowUpsWithCallBooked = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category = 'dm_follow_up'
        AND r.sent = false
        AND EXISTS (
          SELECT 1 FROM crm_parents p
          WHERE p.id = r.parent_id
          AND p.phone_call_booked = true
        )
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedDmFollowUpsWithCallBooked.rowCount || 0;

    // Post-call follow-ups for people who have booked a session
    const deletedPostCallWithSession = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category = 'post_call_follow_up'
        AND r.sent = false
        AND EXISTS (
          SELECT 1 FROM crm_parents p
          WHERE p.id = r.parent_id
          AND p.call_outcome = 'session_booked'
        )
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedPostCallWithSession.rowCount || 0;

    // Post-first-session follow-ups for people who have regular sessions
    const deletedPostFirstSessionWithSessions = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category = 'post_first_session_follow_up'
      AND r.sent = false
        AND EXISTS (
          SELECT 1 FROM crm_sessions s
          WHERE s.parent_id = r.parent_id
          AND (s.status IS NULL OR s.status NOT IN ('cancelled'))
        )
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedPostFirstSessionWithSessions.rowCount || 0;

    // Customer drop-off reminders for people who have a new session booked
    const deletedDropOffWithNewSession = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category = 'post_session_follow_up'
        AND r.sent = false
        AND EXISTS (
          SELECT 1 FROM crm_sessions s
          WHERE s.parent_id = r.parent_id
          AND s.session_date > NOW()
          AND (s.status IS NULL OR s.status NOT IN ('cancelled'))
        )
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedDropOffWithNewSession.rowCount || 0;

    // Delete very old unsent follow-up reminders (more than 30 days past due)
    const deletedOldFollowUps = await query(`
      DELETE FROM crm_reminders r
      WHERE r.reminder_category LIKE '%follow_up%'
        AND r.sent = false
        AND r.due_at < NOW() - INTERVAL '30 days'
      RETURNING id
    `);
    results.staleRemindersDeleted += deletedOldFollowUps.rowCount || 0;

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      arizonaTime: nowInArizona().toLocaleString('en-US', { timeZone: 'America/Phoenix' }),
      results
    });

  } catch (error) {
    console.error('Error in reminder check cron:', error);
    return errorResponse('Failed to run reminder check');
  }
}

// Also support GET for easy manual testing in browser
export async function GET(request: Request) {
  // For GET, require the secret in query params
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');

  if (secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized - add ?secret=YOUR_CRON_SECRET to test', { status: 401 });
  }

  // Create a mock request with the auth header
  const mockRequest = new Request(request.url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${process.env.CRON_SECRET}`
    }
  });

  return POST(mockRequest);
}
