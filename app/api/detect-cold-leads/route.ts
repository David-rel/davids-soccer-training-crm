import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { createFollowUpReminders } from '@/lib/reminders';

interface ColdLeadThreshold {
  stage: string;
  daysInactive: number;
  reminderCategory: string;
  description: string;
}

const THRESHOLDS: ColdLeadThreshold[] = [
  {
    stage: 'first_message_sent',
    daysInactive: 1,
    reminderCategory: 'dm_follow_up',
    description: 'Sent first DM, no response'
  },
  {
    stage: 'in_talks',
    daysInactive: 1,
    reminderCategory: 'dm_follow_up',
    description: 'Was talking, now silent'
  },
  {
    stage: 'call_booked',
    daysInactive: 1,
    reminderCategory: 'call_reminder',
    description: 'Call scheduled, approaching date'
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
    stage: 'active_customer',
    daysInactive: 1,
    reminderCategory: 'customer_retention',
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
    // Find parents with no recent activity
    const sql = `
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM crm_first_sessions WHERE parent_id = p.id AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as first_session_count,
        (SELECT MIN(session_date) FROM crm_first_sessions WHERE parent_id = p.id AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as first_session_anchor_at,
        (SELECT COUNT(*) FROM crm_sessions WHERE parent_id = p.id AND (status IS NULL OR status NOT IN ('cancelled', 'no_show'))) as session_count,
        (SELECT MAX(session_date) FROM crm_sessions WHERE parent_id = p.id AND status = 'completed' AND showed_up = true) as last_completed_session_at,
        (SELECT COUNT(*) FROM crm_reminders WHERE parent_id = p.id AND reminder_category LIKE '%follow_up%' AND sent = false) as pending_follow_ups,
        EXTRACT(DAY FROM NOW() - p.last_activity_at) as days_inactive
      FROM crm_parents p
      WHERE p.last_activity_at < NOW() - INTERVAL '1 day'
        AND COALESCE(p.is_dead, false) = false
      ORDER BY p.last_activity_at ASC
    `;

    const result = await query(sql);
    const coldLeads: Array<{
      id: number;
      name: string;
      stage: string;
      daysInactive: number;
      description: string;
    }> = [];

    for (const parent of result.rows) {
      const daysInactive = Math.floor(parent.days_inactive);
      
      // Determine current stage
      let stage: string;
      let threshold: ColdLeadThreshold | undefined;

      if (parent.is_customer && parent.last_completed_session_at) {
        stage = 'active_customer';
        threshold = THRESHOLDS.find(t => t.stage === 'active_customer');
      } else if (Number(parent.first_session_count) > 0 && Number(parent.session_count) === 0) {
        stage = 'post_first_session';
        threshold = THRESHOLDS.find(t => t.stage === 'post_first_session');
      } else if (parent.call_outcome === 'thinking_about_it' || parent.call_outcome === 'went_cold') {
        stage = 'post_call';
        threshold = THRESHOLDS.find(t => t.stage === 'post_call');
      } else if (parent.phone_call_booked && parent.call_date_time) {
        const callDate = new Date(parent.call_date_time);
        const now = new Date();
        if (callDate < now) {
          stage = 'post_call';
          threshold = THRESHOLDS.find(t => t.stage === 'post_call');
        } else {
          stage = 'call_booked';
          threshold = THRESHOLDS.find(t => t.stage === 'call_booked');
        }
      } else if (parent.dm_status === 'in_talks' || parent.dm_status === 'call_requested') {
        stage = 'in_talks';
        threshold = THRESHOLDS.find(t => t.stage === 'in_talks');
      } else if (parent.dm_status === 'first_message_sent' || parent.dm_status === 'replied') {
        stage = 'first_message_sent';
        threshold = THRESHOLDS.find(t => t.stage === 'first_message_sent');
      } else {
        continue;
      }

      if (!threshold) continue;

      const isSessionBasedStage = stage === 'post_first_session' || stage === 'active_customer';

      // Check if they've exceeded the inactivity threshold for their stage
      if (daysInactive >= threshold.daysInactive) {
        // Check if we already have pending follow-ups for this parent
        if (!isSessionBasedStage && parent.pending_follow_ups > 0) {
          continue;
        }

        // Create follow-up reminders
        const anchorDate =
          stage === 'post_first_session'
            ? parent.first_session_anchor_at
            : stage === 'active_customer'
              ? parent.last_completed_session_at
              : stage === 'post_call'
                ? parent.call_date_time
                : undefined;
        const anchorTimezone = stage === 'post_call' ? 'arizona_local' : 'utc';
        const created = await createFollowUpReminders(parent.id, threshold.reminderCategory, {
          anchorDate: anchorDate || undefined,
          anchorTimezone,
        });
        if (created === 0) {
          continue;
        }

        coldLeads.push({
          id: parent.id,
          name: parent.name,
          stage,
          daysInactive,
          description: threshold.description
        });
      }
    }

    return jsonResponse({
      success: true,
      coldLeadsDetected: coldLeads.length,
      remindersCreated: coldLeads.length * 4,
      coldLeads
    });

  } catch (error) {
    console.error('Error detecting cold leads:', error);
    return errorResponse('Failed to detect cold leads');
  }
}
