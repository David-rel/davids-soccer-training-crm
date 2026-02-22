import { query } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import { formatArizonaDateTime, getDateBoundsArizona } from "@/lib/timezone";
import {
  getCoachPhoneNumber,
  normalizeUsPhoneNumber,
  sendSmsViaTwilio,
} from "@/lib/twilio";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const MESSAGE_PREFIX = "Davids Soccer Training. DO NOT REPLY";
const MESSAGE_SUFFIX =
  "For any questions reach out to Coach David: 7206122979";

interface DueReminderRow {
  id: number;
  parent_id: number;
  session_id: number | null;
  first_session_id: number | null;
  reminder_type: string;
  due_at: string | Date;
  parent_name: string;
  secondary_parent_name: string | null;
  parent_phone: string | null;
  session_date: string | Date | null;
  player_names: string[] | null;
  total_sessions_through_current: number | null;
}

interface PreparedMessage {
  to: string;
  body: string;
}

interface ReminderProcessingOptions {
  lowerBoundIso: string;
  upperBoundIso: string;
  dryRun: boolean;
  markSent: boolean;
  overrideTo: string | null;
  parentId: number | null;
  sessionId: number | null;
  firstSessionId: number | null;
  reminderTypes: string[];
}

interface ReminderStats {
  fetched: number;
  sent: number;
  skipped: number;
  failed: number;
  previewed: number;
  preview: Array<{
    id: number;
    reminderType: string;
    dueAt: string;
    to: string;
  }>;
}

function normalizeUtcDate(dateValue: string | Date): Date {
  if (dateValue instanceof Date) {
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

  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(dateValue);
  const normalized = hasTimezone
    ? dateValue
    : `${dateValue.replace(" ", "T")}Z`;

  return new Date(normalized);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function wrapMessage(coreMessage: string): string {
  return `${MESSAGE_PREFIX}\n${compactWhitespace(coreMessage)}\n${MESSAGE_SUFFIX}`;
}

function wrapCoachMessage(coreMessage: string): string {
  return compactWhitespace(coreMessage);
}

function toPlayerLabel(playerNames: string[] | null): string {
  const names = (playerNames || []).filter(Boolean);
  if (names.length === 0) return "your player";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function toParentDisplayName(row: DueReminderRow): string {
  if (row.secondary_parent_name && row.secondary_parent_name.trim()) {
    return `${row.parent_name} and ${row.secondary_parent_name.trim()}`;
  }
  return row.parent_name;
}

function templateUrl(
  template: string | undefined,
  vars: Record<string, string>
): string | null {
  if (!template) return null;

  const value = template.replace(/\{(\w+)\}/g, (full, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : full;
  });

  try {
    const parsed = new URL(value);
    return parsed.toString();
  } catch {
    return null;
  }
}

function parsePositiveInt(
  value: string | null,
  defaultValue: number,
  min: number,
  max: number
): number {
  const parsed = Number(value ?? defaultValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseOptionalInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function parseReminderTypes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getSameDayNotes(parentId: number, sessionDate: Date): Promise<string[]> {
  const { start, end } = getDateBoundsArizona(sessionDate);

  const result = await query(
    `SELECT notes
     FROM (
       SELECT notes, session_date
       FROM crm_first_sessions
       WHERE parent_id = $1
         AND session_date >= $2
         AND session_date <= $3
         AND COALESCE(cancelled, false) = false
         AND notes IS NOT NULL
         AND TRIM(notes) <> ''
       UNION ALL
       SELECT notes, session_date
       FROM crm_sessions
       WHERE parent_id = $1
         AND session_date >= $2
         AND session_date <= $3
         AND COALESCE(cancelled, false) = false
         AND notes IS NOT NULL
         AND TRIM(notes) <> ''
     ) combined
     ORDER BY session_date DESC`,
    [parentId, start, end]
  );

  return result.rows
    .map((row: { notes: unknown }) =>
      typeof row.notes === "string" ? compactWhitespace(row.notes) : ""
    )
    .filter(Boolean);
}

function formatReminderTime(dateValue: string | Date): string {
  const date = normalizeUtcDate(dateValue);
  return formatArizonaDateTime(date);
}

async function sendCoachDeliveryConfirmation(
  row: DueReminderRow,
  destination: string
): Promise<{ ok: boolean; detail: string }> {
  const coachPhone = getCoachPhoneNumber();
  const dueAtArizona = formatInTimeZone(
    normalizeUtcDate(row.due_at),
    "America/Phoenix",
    "yyyy-MM-dd h:mm a zzz"
  );
  const sentAtArizona = formatInTimeZone(
    new Date(),
    "America/Phoenix",
    "yyyy-MM-dd h:mm a zzz"
  );
  const recipientLabel = toParentDisplayName(row);
  const body = compactWhitespace(
    `Auto reminder sent: ${row.reminder_type} to ${destination} (${recipientLabel}) due ${dueAtArizona}. Sent at ${sentAtArizona}.`
  );

  const notifyResult = await sendSmsViaTwilio(coachPhone, body);
  if (!notifyResult.ok) {
    return {
      ok: false,
      detail: `coach-notify-failed:${clip(notifyResult.error || "unknown", 250)}`,
    };
  }

  return {
    ok: true,
    detail: `coach-notified:${notifyResult.sid || "ok"}`,
  };
}

async function buildMessage(row: DueReminderRow): Promise<PreparedMessage | null> {
  if (!row.session_date) {
    return null;
  }

  const sessionDate = normalizeUtcDate(row.session_date);
  const sessionTimeText = formatReminderTime(sessionDate);
  const parentDisplay = toParentDisplayName(row);
  const playerLabel = toPlayerLabel(row.player_names);
  const dateKey = formatInTimeZone(sessionDate, "America/Phoenix", "yyyy-MM-dd");

  const profileUrl = templateUrl(process.env.PARENT_PROFILE_URL_TEMPLATE, {
    parentId: String(row.parent_id),
    date: dateKey,
    sessionId: row.session_id ? String(row.session_id) : "",
    firstSessionId: row.first_session_id ? String(row.first_session_id) : "",
  });
  const feedbackUrl = templateUrl(process.env.PARENT_FEEDBACK_URL_TEMPLATE, {
    parentId: String(row.parent_id),
    date: dateKey,
    sessionId: row.session_id ? String(row.session_id) : "",
    firstSessionId: row.first_session_id ? String(row.first_session_id) : "",
  });
  const testsUrl = templateUrl(process.env.PARENT_TESTS_URL_TEMPLATE, {
    parentId: String(row.parent_id),
    date: dateKey,
    sessionId: row.session_id ? String(row.session_id) : "",
    firstSessionId: row.first_session_id ? String(row.first_session_id) : "",
  });

  switch (row.reminder_type) {
    case "session_48h":
    case "session_24h":
    case "session_6h": {
      const labelMap: Record<string, string> = {
        session_48h: "48-hour",
        session_24h: "24-hour",
        session_6h: "6-hour",
      };

      const parentPhone = normalizeUsPhoneNumber(row.parent_phone);
      if (!parentPhone) return null;

      return {
        to: parentPhone,
        body: wrapMessage(
          `${labelMap[row.reminder_type]} reminder for ${playerLabel}: session at ${sessionTimeText}.`
        ),
      };
    }
    case "session_start": {
      const parentPhone = normalizeUsPhoneNumber(row.parent_phone);
      if (!parentPhone) return null;

      const profileLine = profileUrl
        ? `View profile + session plan: ${profileUrl}.`
        : "Please check your player profile for session updates and plan.";

      return {
        to: parentPhone,
        body: wrapMessage(
          `Session time is now for ${playerLabel}. ${profileLine}`
        ),
      };
    }
    case "coach_session_start": {
      return {
        to: getCoachPhoneNumber(),
        body: wrapCoachMessage(
          `Coach reminder: ${playerLabel} with ${parentDisplay} starts now (${sessionTimeText}). Get photos, videos, and sports drink ready.`
        ),
      };
    }
    case "coach_session_plus_60m": {
      const reviewPrompt =
        row.total_sessions_through_current === 3
          ? " This is session #3, ask for a review and capture quick feedback."
          : "";

      return {
        to: getCoachPhoneNumber(),
        body: wrapCoachMessage(
          `60-minute follow-up: if not already done, get a photo with ${playerLabel}.${reviewPrompt}`
        ),
      };
    }
    case "parent_session_plus_120m": {
      const parentPhone = normalizeUsPhoneNumber(row.parent_phone);
      if (!parentPhone) return null;

      const notes = await getSameDayNotes(row.parent_id, sessionDate);
      const notesText = notes.length
        ? `Today's feedback: ${clip(notes.join(" | "), 220)}.`
        : "Today's feedback and test updates from this session are being posted to the profile.";

      const links: string[] = [];
      if (feedbackUrl) links.push(`Feedback: ${feedbackUrl}`);
      if (testsUrl) links.push(`Tests: ${testsUrl}`);
      if (!feedbackUrl && !testsUrl && profileUrl) {
        links.push(`Profile: ${profileUrl}`);
      }

      const linksText = links.length ? ` ${links.join(" ")}` : "";

      return {
        to: parentPhone,
        body: wrapMessage(
          `Thank you for training with David today, ${parentDisplay}. ${notesText}${linksText}`
        ),
      };
    }
    default:
      return null;
  }
}

async function markReminderSent(reminderId: number, note: string) {
  await query(
    `UPDATE crm_reminders
     SET sent = true,
         sent_at = CURRENT_TIMESTAMP,
         notes = CASE
           WHEN notes IS NULL OR notes = '' THEN $2
           ELSE notes || E'\n' || $2
         END
     WHERE id = $1`,
    [reminderId, note]
  );
}

async function appendReminderNote(reminderId: number, note: string) {
  await query(
    `UPDATE crm_reminders
     SET notes = CASE
       WHEN notes IS NULL OR notes = '' THEN $2
       ELSE notes || E'\n' || $2
     END
     WHERE id = $1`,
    [reminderId, note]
  );
}

async function processDueReminders(
  limit: number,
  options: ReminderProcessingOptions
): Promise<ReminderStats> {
  const dueReminders = await query(
    `SELECT
      r.id,
      r.parent_id,
      r.session_id,
      r.first_session_id,
      r.reminder_type,
      r.due_at,
      p.name as parent_name,
      p.secondary_parent_name,
      p.phone as parent_phone,
      COALESCE(s.session_date, fs.session_date) as session_date,
      CASE
        WHEN r.session_id IS NOT NULL THEN (
          SELECT ARRAY_AGG(pl.name ORDER BY pl.created_at)
          FROM crm_session_players sp
          JOIN crm_players pl ON pl.id = sp.player_id
          WHERE sp.session_id = r.session_id
        )
        WHEN r.first_session_id IS NOT NULL THEN (
          SELECT ARRAY_AGG(pl.name ORDER BY pl.created_at)
          FROM crm_first_session_players fsp
          JOIN crm_players pl ON pl.id = fsp.player_id
          WHERE fsp.first_session_id = r.first_session_id
        )
        ELSE NULL
      END as player_names,
      (
        SELECT COUNT(*)::int
        FROM (
          SELECT fs2.id
          FROM crm_first_sessions fs2
          WHERE fs2.parent_id = r.parent_id
            AND COALESCE(fs2.cancelled, false) = false
            AND (fs2.status IS NULL OR fs2.status NOT IN ('cancelled', 'no_show'))
            AND fs2.session_date <= COALESCE(s.session_date, fs.session_date)
          UNION ALL
          SELECT s2.id
          FROM crm_sessions s2
          WHERE s2.parent_id = r.parent_id
            AND COALESCE(s2.cancelled, false) = false
            AND (s2.status IS NULL OR s2.status NOT IN ('cancelled', 'no_show'))
            AND s2.session_date <= COALESCE(s.session_date, fs.session_date)
        ) session_counts
      ) as total_sessions_through_current
    FROM crm_reminders r
    JOIN crm_parents p ON p.id = r.parent_id
    LEFT JOIN crm_sessions s ON s.id = r.session_id
    LEFT JOIN crm_first_sessions fs ON fs.id = r.first_session_id
    WHERE r.sent = false
      AND r.reminder_category = 'session_reminder'
      AND r.due_at >= ($2::timestamptz AT TIME ZONE 'UTC')
      AND r.due_at <= ($3::timestamptz AT TIME ZONE 'UTC')
      AND ($4::int IS NULL OR r.parent_id = $4::int)
      AND ($5::int IS NULL OR r.session_id = $5::int)
      AND ($6::int IS NULL OR r.first_session_id = $6::int)
      AND (
        COALESCE(array_length($7::text[], 1), 0) = 0
        OR r.reminder_type = ANY($7::text[])
      )
      AND COALESCE(p.is_dead, false) = false
      AND (
        r.session_id IS NULL
        OR (
          COALESCE(s.cancelled, false) = false
          AND (s.status IS NULL OR s.status NOT IN ('cancelled', 'no_show'))
        )
      )
      AND (
        r.first_session_id IS NULL
        OR (
          COALESCE(fs.cancelled, false) = false
          AND (fs.status IS NULL OR fs.status NOT IN ('cancelled', 'no_show'))
        )
      )
    ORDER BY r.due_at ASC, r.id ASC
    LIMIT $1`,
    [
      limit,
      options.lowerBoundIso,
      options.upperBoundIso,
      options.parentId,
      options.sessionId,
      options.firstSessionId,
      options.reminderTypes,
    ]
  );

  const stats: ReminderStats = {
    fetched: dueReminders.rows.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    previewed: 0,
    preview: [],
  };

  for (const row of dueReminders.rows as DueReminderRow[]) {
    const prepared = await buildMessage(row);

    if (!prepared) {
      if (!options.dryRun && options.markSent) {
        await markReminderSent(
          row.id,
          "auto-skipped: missing recipient phone or unsupported type"
        );
      }
      stats.skipped += 1;
      continue;
    }

    const destination = options.overrideTo || prepared.to;

    if (options.dryRun) {
      stats.previewed += 1;
      if (stats.preview.length < 25) {
        stats.preview.push({
          id: row.id,
          reminderType: row.reminder_type,
          dueAt: normalizeUtcDate(row.due_at).toISOString(),
          to: destination,
        });
      }
      continue;
    }

    try {
      const smsResult = await sendSmsViaTwilio(destination, prepared.body);

      if (smsResult.ok) {
        const noteParts = [`sms-sent:${smsResult.sid || "ok"}:${smsResult.status || "queued"}`];
        try {
          const coachNotify = await sendCoachDeliveryConfirmation(row, destination);
          noteParts.push(coachNotify.detail);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown coach notify exception";
          noteParts.push(`coach-notify-exception:${clip(message, 250)}`);
        }

        if (options.markSent) {
          await markReminderSent(row.id, noteParts.join(" | "));
        }
        stats.sent += 1;
      } else {
        if (options.markSent) {
          await appendReminderNote(
            row.id,
            `sms-failed:${clip(smsResult.error || "unknown", 300)}`
          );
        }
        stats.failed += 1;
      }
    } catch (error) {
      if (options.markSent) {
        const message =
          error instanceof Error ? error.message : "Unknown SMS send exception";
        await appendReminderNote(row.id, `sms-exception:${clip(message, 300)}`);
      }
      stats.failed += 1;
    }
  }

  return stats;
}

export async function POST(request: Request) {
  try {
    const cronHeader = request.headers.get("x-vercel-cron");
    const authHeader = request.headers.get("authorization");
    const url = new URL(request.url);

    const isVercelCron = cronHeader === "1";
    const isManualWithSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isVercelCron && !isManualWithSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const testMode = url.searchParams.get("test_mode") === "1";
    if (testMode && !isManualWithSecret) {
      return new Response("Unauthorized test mode", { status: 401 });
    }

    const batchSize = parsePositiveInt(
      url.searchParams.get("batch_size"),
      parsePositiveInt(process.env.SMS_REMINDER_BATCH_SIZE ?? null, 60, 1, 200),
      1,
      200
    );

    const windowMinutes = parsePositiveInt(
      url.searchParams.get("window_minutes"),
      parsePositiveInt(process.env.SMS_REMINDER_WINDOW_MINUTES ?? null, 15, 1, 120),
      1,
      120
    );

    const lookaheadMinutes = parsePositiveInt(
      url.searchParams.get("lookahead_minutes"),
      testMode ? 180 : 0,
      0,
      30 * 24 * 60
    );

    const dryRunParam = url.searchParams.get("dry_run");
    const dryRun = dryRunParam === null ? testMode : dryRunParam === "1";

    const markSentParam = url.searchParams.get("mark_sent");
    const markSent = dryRun
      ? false
      : markSentParam === null
        ? !testMode
        : markSentParam === "1";

    const overrideTo = testMode
      ? normalizeUsPhoneNumber(
          url.searchParams.get("test_to") || process.env.COACH_PHONE_NUMBER || "7206122979"
        )
      : null;

    const parentId = parseOptionalInt(url.searchParams.get("parent_id"));
    const sessionId = parseOptionalInt(url.searchParams.get("session_id"));
    const firstSessionId = parseOptionalInt(url.searchParams.get("first_session_id"));
    const reminderTypes = parseReminderTypes(url.searchParams.get("types"));

    if (testMode && !overrideTo) {
      return errorResponse("Invalid test_to phone number", 400);
    }

    const now = new Date();
    const lowerBoundIso = testMode
      ? now.toISOString()
      : new Date(now.getTime() - windowMinutes * 60 * 1000).toISOString();
    const upperBoundIso = testMode
      ? new Date(now.getTime() + lookaheadMinutes * 60 * 1000).toISOString()
      : now.toISOString();

    const stats = await processDueReminders(batchSize, {
      lowerBoundIso,
      upperBoundIso,
      dryRun,
      markSent,
      overrideTo,
      parentId,
      sessionId,
      firstSessionId,
      reminderTypes,
    });

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      arizonaNow: formatInTimeZone(new Date(), "America/Phoenix", "yyyy-MM-dd HH:mm:ss zzz"),
      batchSize,
      windowMinutes,
      lookaheadMinutes,
      lowerBoundIso,
      upperBoundIso,
      testMode,
      dryRun,
      markSent,
      overrideTo,
      parentId,
      sessionId,
      firstSessionId,
      reminderTypes,
      stats,
    });
  } catch (error) {
    console.error("Error in send reminders cron:", error);
    return errorResponse("Failed to send reminders");
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized - add ?secret=YOUR_CRON_SECRET to test", {
      status: 401,
    });
  }

  const mockRequest = new Request(request.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  });

  return POST(mockRequest);
}
