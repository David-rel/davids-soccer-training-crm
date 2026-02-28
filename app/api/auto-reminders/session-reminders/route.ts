import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import { ensureAutoRemindersSchema } from "@/lib/auto-reminders";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  try {
    await ensureAutoRemindersSchema();
    const url = new URL(request.url);
    const days = parsePositiveInt(url.searchParams.get("days"), 21, 1, 120);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 400, 1, 2000);

    const now = new Date();
    const lowerBound = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const upperBound = new Date(
      now.getTime() + days * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = await query(
      `
        SELECT
          r.id,
          r.parent_id,
          r.first_session_id,
          r.session_id,
          r.reminder_type,
          r.reminder_category,
          r.due_at,
          r.custom_message,
          r.notes,
          p.phone as parent_phone,
          CASE
            WHEN p.secondary_parent_name IS NOT NULL AND TRIM(COALESCE(p.secondary_parent_name, '')) <> ''
            THEN p.name || ' and ' || p.secondary_parent_name
            ELSE p.name
          END as parent_name,
          d.message_template as default_message_template,
          CASE
            WHEN NULLIF(TRIM(COALESCE(r.custom_message, '')), '') IS NOT NULL
            THEN r.custom_message
            ELSE d.message_template
          END as effective_message_template,
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
          END as player_names
        FROM crm_reminders r
        JOIN crm_parents p ON p.id = r.parent_id
        LEFT JOIN crm_reminder_defaults d ON d.reminder_type = r.reminder_type
        LEFT JOIN crm_sessions s ON s.id = r.session_id
        LEFT JOIN crm_first_sessions fs ON fs.id = r.first_session_id
        WHERE r.sent = false
          AND r.reminder_category = 'session_reminder'
          AND r.due_at >= ($1::timestamptz AT TIME ZONE 'UTC')
          AND r.due_at <= ($2::timestamptz AT TIME ZONE 'UTC')
          AND COALESCE(p.is_dead, false) = false
          AND (
            r.session_id IS NULL
            OR (
              COALESCE(s.cancelled, false) = false
              AND (s.status IS NULL OR s.status NOT IN ('cancelled', 'completed', 'no_show'))
            )
          )
          AND (
            r.first_session_id IS NULL
            OR (
              COALESCE(fs.cancelled, false) = false
              AND (fs.status IS NULL OR fs.status NOT IN ('cancelled', 'completed', 'no_show'))
            )
          )
        ORDER BY r.due_at ASC, r.id ASC
        LIMIT $3
      `,
      [lowerBound, upperBound, limit]
    );

    return jsonResponse({
      days,
      limit,
      lowerBound,
      upperBound,
      reminders: result.rows,
    });
  } catch (error) {
    console.error("Error fetching session reminders:", error);
    return errorResponse("Failed to fetch session reminders");
  }
}

