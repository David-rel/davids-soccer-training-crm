import { query } from "@/lib/db";
import { ARIZONA_TIMEZONE } from "@/lib/timezone";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

function normalizeToUtcDate(dateValue: string | Date): Date {
  if (dateValue instanceof Date) {
    // `timestamp without time zone` values from pg are parsed into Date using the
    // runtime's local timezone. Rebuild using local date parts as UTC so behavior
    // is stable across local dev and Vercel (UTC).
    return new Date(
      Date.UTC(
        dateValue.getFullYear(),
        dateValue.getMonth(),
        dateValue.getDate(),
        dateValue.getHours(),
        dateValue.getMinutes(),
        dateValue.getSeconds(),
        dateValue.getMilliseconds()
      )
    );
  }

  // DB timestamp strings may not include timezone info. Treat those as UTC.
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateValue);
  const normalized = hasTimezone
    ? dateValue
    : `${dateValue.replace(" ", "T")}Z`;

  return new Date(normalized);
}

function normalizeToArizonaLocalUtcDate(dateValue: string | Date): Date {
  if (dateValue instanceof Date) {
    return fromZonedTime(dateValue, ARIZONA_TIMEZONE);
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateValue);
  if (hasTimezone) {
    return new Date(dateValue);
  }

  const arizonaLocal = dateValue.replace(" ", "T");
  return fromZonedTime(arizonaLocal, ARIZONA_TIMEZONE);
}

export async function createSessionReminders(
  parentId: number,
  sessionDate: string | Date,
  opts: { firstSessionId?: number; sessionId?: number }
) {
  // Session times are stored as UTC-coded values. Keep reminder offsets in UTC math
  // so 48h/24h/6h always align with the actual session instant in production.
  const sessionDateUtc = normalizeToUtcDate(sessionDate);
  const intervals = [
    { type: "session_48h", hours: 48 },
    { type: "session_24h", hours: 24 },
    { type: "session_6h", hours: 6 },
  ];

  for (const interval of intervals) {
    const dueAtUtc = new Date(
      sessionDateUtc.getTime() - interval.hours * 60 * 60 * 1000
    );
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
        dueAtUtc.toISOString(),
      ]
    );
  }
}

export async function createFollowUpReminders(
  parentId: number,
  category: string,
  opts?: {
    anchorDate?: string | Date;
    skipPastIntervals?: boolean;
    anchorTimezone?: "utc" | "arizona_local";
  }
) {
  // Follow-ups are always due at 12:00 PM Arizona and can be anchored to a source date
  // (for example, first session date or last completed session date).
  const nowArizona = toZonedTime(new Date(), ARIZONA_TIMEZONE);
  const todayArizona = new Date(nowArizona);
  todayArizona.setHours(0, 0, 0, 0);
  const anchorSource = opts?.anchorDate ?? new Date();
  const anchorUtc =
    opts?.anchorTimezone === "arizona_local"
      ? normalizeToArizonaLocalUtcDate(anchorSource)
      : normalizeToUtcDate(anchorSource);
  const anchorArizona = toZonedTime(anchorUtc, ARIZONA_TIMEZONE);
  const allIntervals = [
    { type: "follow_up_1d", days: 1 },
    { type: "follow_up_3d", days: 3 },
    { type: "follow_up_7d", days: 7 },
    { type: "follow_up_14d", days: 14 },
  ];
  const intervals = allIntervals;
  let createdCount = 0;

  for (const interval of intervals) {
    const dueAtArizona = new Date(anchorArizona);
    dueAtArizona.setDate(anchorArizona.getDate() + interval.days);
    dueAtArizona.setHours(12, 0, 0, 0);
    const dueAtUtc = fromZonedTime(dueAtArizona, ARIZONA_TIMEZONE);

    const shouldSkipPast = opts?.skipPastIntervals !== false;
    if (shouldSkipPast && dueAtArizona < todayArizona) {
      continue;
    }

    // Avoid duplicate unsent reminders for the same parent/category/type/date.
    const insertResult = await query(
      `INSERT INTO crm_reminders (parent_id, reminder_type, reminder_category, due_at)
       SELECT $1::int, $2::text, $3::text, ($4::timestamptz AT TIME ZONE 'UTC')
       WHERE NOT EXISTS (
         SELECT 1 FROM crm_reminders
         WHERE parent_id = $1::int
           AND reminder_type = $2::text
           AND reminder_category = $3::text
           AND due_at = ($4::timestamptz AT TIME ZONE 'UTC')
           AND sent = false
       )`,
      [parentId, interval.type, category, dueAtUtc.toISOString()]
    );
    createdCount += insertResult.rowCount || 0;
  }

  return createdCount;
}
