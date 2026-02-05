import { query } from "@/lib/db";
import { nowInArizona, ARIZONA_TIMEZONE } from "@/lib/timezone";
import { fromZonedTime } from "date-fns-tz";

export async function createSessionReminders(
  parentId: number,
  sessionDate: string,
  opts: { firstSessionId?: number; sessionId?: number }
) {
  // sessionDate is already stored as UTC ISO string, so we can use it directly
  const date = new Date(sessionDate);
  const intervals = [
    { type: "session_48h", hours: 48 },
    { type: "session_24h", hours: 24 },
    { type: "session_6h", hours: 6 },
  ];

  for (const interval of intervals) {
    const dueAt = new Date(date.getTime() - interval.hours * 60 * 60 * 1000);
    // ALWAYS create reminders, even if in the past
    // Use a unique constraint check to avoid duplicates
    await query(
      `INSERT INTO crm_reminders (parent_id, first_session_id, session_id, reminder_type, reminder_category, due_at)
       VALUES ($1, $2, $3, $4, 'session_reminder', $5)
       ON CONFLICT DO NOTHING`,
      [
        parentId,
        opts.firstSessionId || null,
        opts.sessionId || null,
        interval.type,
        dueAt.toISOString(),
      ]
    );
  }
}

export async function createFollowUpReminders(
  parentId: number,
  category: string
) {
  // Use current time in Arizona for calculating follow-up due dates
  const now = new Date(); // UTC time
  const intervals = [
    { type: "follow_up_1d", days: 1 },
    { type: "follow_up_3d", days: 3 },
    { type: "follow_up_7d", days: 7 },
    { type: "follow_up_14d", days: 14 },
  ];

  for (const interval of intervals) {
    const dueAt = new Date(now.getTime() + interval.days * 24 * 60 * 60 * 1000);
    // Use ON CONFLICT DO NOTHING to avoid duplicates
    await query(
      `INSERT INTO crm_reminders (parent_id, reminder_type, reminder_category, due_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [parentId, interval.type, category, dueAt.toISOString()]
    );
  }
}
