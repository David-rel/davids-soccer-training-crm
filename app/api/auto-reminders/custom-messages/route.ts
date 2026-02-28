import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import { ensureAutoRemindersSchema } from "@/lib/auto-reminders";
import { query } from "@/lib/db";
import {
  parseDateAsArizona,
  parseDatetimeLocalAsArizona,
} from "@/lib/timezone";

export const dynamic = "force-dynamic";

function normalizeScheduledForInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);

  if (normalized.length === 10) {
    return parseDateAsArizona(normalized);
  }

  if (!hasTimezone) {
    return parseDatetimeLocalAsArizona(normalized.replace(" ", "T"));
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function GET(request: Request) {
  try {
    await ensureAutoRemindersSchema();
    const url = new URL(request.url);
    const includeSent = url.searchParams.get("include_sent") === "1";
    const days = Math.max(
      1,
      Math.min(180, Math.trunc(Number(url.searchParams.get("days") || "45")))
    );

    const now = new Date();
    const lowerBound = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const upperBound = new Date(
      now.getTime() + days * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = await query(
      `
        SELECT
          m.id,
          m.parent_id,
          m.title,
          m.message_content,
          m.scheduled_for,
          m.sent,
          m.sent_at,
          m.notes,
          m.created_at,
          m.updated_at,
          CASE
            WHEN p.secondary_parent_name IS NOT NULL AND TRIM(COALESCE(p.secondary_parent_name, '')) <> ''
            THEN p.name || ' and ' || p.secondary_parent_name
            ELSE p.name
          END AS parent_name,
          p.phone as parent_phone
        FROM crm_custom_scheduled_messages m
        JOIN crm_parents p ON p.id = m.parent_id
        WHERE (
            $1::boolean = true
            OR m.sent = false
          )
          AND m.scheduled_for >= ($2::timestamptz AT TIME ZONE 'UTC')
          AND m.scheduled_for <= ($3::timestamptz AT TIME ZONE 'UTC')
          AND COALESCE(p.is_dead, false) = false
        ORDER BY m.scheduled_for ASC, m.id ASC
      `,
      [includeSent, lowerBound, upperBound]
    );

    return jsonResponse({
      includeSent,
      days,
      lowerBound,
      upperBound,
      messages: result.rows,
    });
  } catch (error) {
    console.error("Error fetching custom scheduled messages:", error);
    return errorResponse("Failed to fetch custom scheduled messages");
  }
}

export async function POST(request: Request) {
  try {
    await ensureAutoRemindersSchema();
    const body = await request.json();
    const recipientMode = String(body?.recipient_mode || "single");
    const parentId = Number(body?.parent_id);
    const scheduledFor = normalizeScheduledForInput(body?.scheduled_for);
    const titleRaw = String(body?.title || "").trim();
    const title = titleRaw.length > 0 ? titleRaw : null;
    const messageContent = String(body?.message_content || "").trim();

    if (!scheduledFor) {
      return errorResponse("scheduled_for is required", 400);
    }
    if (!messageContent) {
      return errorResponse("message_content is required", 400);
    }

    if (recipientMode === "single") {
      if (!Number.isFinite(parentId)) {
        return errorResponse("Valid parent_id is required for single recipient", 400);
      }

      const result = await query(
        `
          INSERT INTO crm_custom_scheduled_messages (parent_id, title, message_content, scheduled_for)
          VALUES ($1, $2, $3, ($4::timestamptz AT TIME ZONE 'UTC'))
          RETURNING id, parent_id, title, message_content, scheduled_for, sent, sent_at, notes, created_at, updated_at
        `,
        [parentId, title, messageContent, scheduledFor]
      );

      return jsonResponse({ created: 1, message: result.rows[0] }, 201);
    }

    if (recipientMode === "all_customers") {
      const result = await query(
        `
          INSERT INTO crm_custom_scheduled_messages (parent_id, title, message_content, scheduled_for)
          SELECT
            p.id,
            $1,
            $2,
            ($3::timestamptz AT TIME ZONE 'UTC')
          FROM crm_parents p
          WHERE p.is_customer = true
            AND COALESCE(p.is_dead, false) = false
            AND p.phone IS NOT NULL
            AND TRIM(p.phone) <> ''
          RETURNING id
        `,
        [title, messageContent, scheduledFor]
      );

      return jsonResponse({ created: result.rowCount || 0 }, 201);
    }

    return errorResponse("recipient_mode must be single or all_customers", 400);
  } catch (error) {
    console.error("Error creating custom scheduled messages:", error);
    return errorResponse("Failed to create custom scheduled messages");
  }
}

