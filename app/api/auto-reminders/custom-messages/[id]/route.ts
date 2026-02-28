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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAutoRemindersSchema();
    const { id } = await params;
    const messageId = Number(id);
    if (!Number.isFinite(messageId)) return errorResponse("Invalid message id", 400);

    const existingResult = await query(
      `SELECT id, sent FROM crm_custom_scheduled_messages WHERE id = $1`,
      [messageId]
    );
    if (existingResult.rows.length === 0) return errorResponse("Message not found", 404);
    if ((existingResult.rows[0] as { sent: boolean }).sent) {
      return errorResponse("Cannot edit a message that is already sent", 400);
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (typeof body?.title === "string") {
      const title = body.title.trim();
      updates.push(`title = $${index}`);
      values.push(title.length > 0 ? title : null);
      index += 1;
    }

    if (typeof body?.message_content === "string") {
      const content = body.message_content.trim();
      if (!content) return errorResponse("message_content cannot be empty", 400);
      updates.push(`message_content = $${index}`);
      values.push(content);
      index += 1;
    }

    if (typeof body?.scheduled_for === "string") {
      const scheduledFor = normalizeScheduledForInput(body.scheduled_for);
      if (!scheduledFor) return errorResponse("Invalid scheduled_for", 400);
      updates.push(`scheduled_for = ($${index}::timestamptz AT TIME ZONE 'UTC')`);
      values.push(scheduledFor);
      index += 1;
    }

    if (updates.length === 0) return errorResponse("No fields to update", 400);

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(messageId);

    const result = await query(
      `
        UPDATE crm_custom_scheduled_messages
        SET ${updates.join(", ")}
        WHERE id = $${index}
        RETURNING id, parent_id, title, message_content, scheduled_for, sent, sent_at, notes, created_at, updated_at
      `,
      values
    );

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error("Error updating custom scheduled message:", error);
    return errorResponse("Failed to update custom scheduled message");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAutoRemindersSchema();
    const { id } = await params;
    const messageId = Number(id);
    if (!Number.isFinite(messageId)) return errorResponse("Invalid message id", 400);

    const result = await query(
      `
        DELETE FROM crm_custom_scheduled_messages
        WHERE id = $1
          AND sent = false
        RETURNING id
      `,
      [messageId]
    );

    if (result.rows.length === 0) {
      return errorResponse("Message not found or already sent", 404);
    }

    return jsonResponse({ deleted: true, id: messageId });
  } catch (error) {
    console.error("Error deleting custom scheduled message:", error);
    return errorResponse("Failed to delete custom scheduled message");
  }
}

