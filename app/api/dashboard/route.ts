import { query } from "@/lib/db";
import { jsonResponse, errorResponse } from "@/lib/api-helpers";
import {
  getTodayBoundsArizona,
  getDateBoundsArizona,
  getWeekStartArizona,
  getMonthStartArizona,
  getFutureDateArizona,
  nowInArizona,
} from "@/lib/timezone";
import { NextRequest } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Use Arizona timezone for all date calculations.
    const { start: todayStart, end: todayEnd } = getTodayBoundsArizona();
    const dayOffsetRaw = Number(request.nextUrl.searchParams.get("dayOffset") ?? "0");
    const dayOffset = Number.isFinite(dayOffsetRaw)
      ? Math.max(0, Math.min(3, Math.trunc(dayOffsetRaw)))
      : 0;

    let selectedStart = todayStart;
    let selectedEnd = todayEnd;

    if (dayOffset > 0) {
      const targetArizonaDate = nowInArizona();
      targetArizonaDate.setDate(targetArizonaDate.getDate() + dayOffset);
      const selectedBounds = getDateBoundsArizona(targetArizonaDate);
      selectedStart = selectedBounds.start;
      selectedEnd = selectedBounds.end;
    }

    // Selected-day phone calls.
    // For today, keep undated calls visible; for future days, only show dated calls in that day window.
    const callsResult = dayOffset === 0
      ? await query(
          `SELECT * FROM crm_parents
           WHERE phone_call_booked = true
           AND (call_outcome IS NULL OR call_outcome NOT IN ('session_booked', 'uninterested'))
           AND (
             (call_date_time >= $1 AND call_date_time <= $2)
             OR call_date_time IS NULL
           )
           ORDER BY call_date_time NULLS LAST`,
          [selectedStart, selectedEnd]
        )
      : await query(
          `SELECT * FROM crm_parents
           WHERE phone_call_booked = true
           AND (call_outcome IS NULL OR call_outcome NOT IN ('session_booked', 'uninterested'))
           AND call_date_time >= $1
           AND call_date_time <= $2
           ORDER BY call_date_time NULLS LAST`,
          [selectedStart, selectedEnd]
        );

    // Selected-day first sessions (exclude cancelled and completed)
    const firstSessionsResult = await query(
      `SELECT fs.*, p.name as parent_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids
       FROM crm_first_sessions fs
       JOIN crm_parents p ON p.id = fs.parent_id
       LEFT JOIN crm_first_session_players fsp ON fsp.first_session_id = fs.id
       LEFT JOIN crm_players pl ON pl.id = fsp.player_id
       WHERE fs.session_date >= $1 AND fs.session_date <= $2
       AND (fs.status IS NULL OR fs.status NOT IN ('cancelled', 'completed'))
       GROUP BY fs.id, p.name
       ORDER BY fs.session_date`,
      [selectedStart, selectedEnd]
    );

    // Selected-day regular sessions (exclude cancelled and completed)
    const sessionsResult = await query(
      `SELECT s.*, p.name as parent_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids
       FROM crm_sessions s
       JOIN crm_parents p ON p.id = s.parent_id
       LEFT JOIN crm_session_players sp ON sp.session_id = s.id
       LEFT JOIN crm_players pl ON pl.id = sp.player_id
       WHERE s.session_date >= $1 AND s.session_date <= $2
       AND (s.status IS NULL OR s.status NOT IN ('cancelled', 'completed'))
       GROUP BY s.id, p.name
       ORDER BY s.session_date`,
      [selectedStart, selectedEnd]
    );

    // Selected-day pending reminders (for dashboard section) — include secondary parent in display name.
    // IMPORTANT: Use Arizona day boundaries, not due_at::date, because timestamps are stored
    // as UTC-coded values and date-only comparison can surface the wrong reminder type/day.
    const remindersResult = await query(
      `
      SELECT r.*,
        p.dm_status as parent_dm_status,
        CASE
          WHEN p.secondary_parent_name IS NOT NULL AND TRIM(COALESCE(p.secondary_parent_name, '')) != ''
          THEN p.name || ' and ' || p.secondary_parent_name
          ELSE p.name
        END as parent_name
      FROM crm_reminders r
      JOIN crm_parents p ON p.id = r.parent_id
      WHERE r.sent = false
        AND r.due_at >= $1
        AND r.due_at <= $2
      ORDER BY r.due_at ASC
    `,
      [selectedStart, selectedEnd]
    );

    // Stats - use Arizona time for week/month boundaries
    const weekStartStr = getWeekStartArizona();
    const monthStartStr = getMonthStartArizona();

    const statsResult = await query(
      `
      SELECT
        (SELECT COUNT(*) FROM crm_parents) as total_contacts,
        (SELECT COUNT(*) FROM crm_first_sessions WHERE session_date >= $1 AND session_date <= $3 AND (status IS NULL OR status NOT IN ('cancelled')))
        + (SELECT COUNT(*) FROM crm_sessions WHERE session_date >= $1 AND session_date <= $3 AND (status IS NULL OR status NOT IN ('cancelled'))) as sessions_this_week,
        (SELECT COALESCE(SUM(price), 0) FROM crm_first_sessions WHERE session_date >= $2 AND (status IS NULL OR status NOT IN ('cancelled')))
        + (SELECT COALESCE(SUM(price), 0) FROM crm_sessions WHERE session_date >= $2 AND (status IS NULL OR status NOT IN ('cancelled'))) as revenue_this_month
    `,
      [weekStartStr, monthStartStr, todayEnd]
    );

    // Upcoming calls (next 3 months) - use Arizona time
    const futureDateStr = getFutureDateArizona(90);

    const upcomingCallsResult = await query(
      `SELECT * FROM crm_parents
       WHERE phone_call_booked = true
       AND (call_outcome IS NULL OR call_outcome NOT IN ('session_booked', 'uninterested'))
       AND (
         (call_date_time >= $1 AND call_date_time <= $2)
         OR call_date_time IS NULL
       )
       ORDER BY call_date_time NULLS LAST`,
      [todayStart, futureDateStr]
    );

    // Upcoming first sessions (next 3 months, exclude cancelled and completed)
    const upcomingFirstSessionsResult = await query(
      `SELECT fs.*, p.name as parent_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids
       FROM crm_first_sessions fs
       JOIN crm_parents p ON p.id = fs.parent_id
       LEFT JOIN crm_first_session_players fsp ON fsp.first_session_id = fs.id
       LEFT JOIN crm_players pl ON pl.id = fsp.player_id
       WHERE fs.session_date >= $1 AND fs.session_date <= $2
       AND (fs.status IS NULL OR fs.status NOT IN ('cancelled', 'completed'))
       GROUP BY fs.id, p.name
       ORDER BY fs.session_date`,
      [todayStart, futureDateStr]
    );

    // Upcoming regular sessions (next 3 months, exclude cancelled and completed)
    const upcomingSessionsResult = await query(
      `SELECT s.*, p.name as parent_name,
        ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names,
        ARRAY_AGG(pl.id) FILTER (WHERE pl.id IS NOT NULL) as player_ids
       FROM crm_sessions s
       JOIN crm_parents p ON p.id = s.parent_id
       LEFT JOIN crm_session_players sp ON sp.session_id = s.id
       LEFT JOIN crm_players pl ON pl.id = sp.player_id
       WHERE s.session_date >= $1 AND s.session_date <= $2
       AND (s.status IS NULL OR s.status NOT IN ('cancelled', 'completed'))
       GROUP BY s.id, p.name
       ORDER BY s.session_date`,
      [todayStart, futureDateStr]
    );

    // ALL reminders for calendar (next 3 months) — include secondary parent in display name
    const allRemindersResult = await query(
      `
      SELECT r.*,
        p.dm_status as parent_dm_status,
        CASE
          WHEN p.secondary_parent_name IS NOT NULL AND TRIM(COALESCE(p.secondary_parent_name, '')) != ''
          THEN p.name || ' and ' || p.secondary_parent_name
          ELSE p.name
        END as parent_name
      FROM crm_reminders r
      JOIN crm_parents p ON p.id = r.parent_id
      WHERE r.sent = false AND r.due_at >= $1 AND r.due_at <= $2
      ORDER BY r.due_at ASC
    `,
      [todayStart, futureDateStr]
    );

    return jsonResponse({
      todays_calls: callsResult.rows,
      todays_first_sessions: firstSessionsResult.rows,
      todays_sessions: sessionsResult.rows,
      pending_reminders: remindersResult.rows,
      selected_day_offset: dayOffset,
      stats: statsResult.rows[0],
      // Calendar data
      upcomingCalls: upcomingCallsResult.rows,
      upcomingFirstSessions: upcomingFirstSessionsResult.rows,
      upcomingSessions: upcomingSessionsResult.rows,
      upcomingReminders: allRemindersResult.rows,
    });
  } catch (error) {
    console.error("Error fetching dashboard:", error);
    return errorResponse("Failed to fetch dashboard data");
  }
}
