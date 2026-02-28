import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import {
  ensureAutoRemindersSchema,
  validateLockedPlaceholders,
} from "@/lib/auto-reminders";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAutoRemindersSchema();
    const { id } = await params;
    const reminderId = Number(id);
    if (!Number.isFinite(reminderId)) {
      return errorResponse("Invalid reminder id", 400);
    }

    const body = await request.json();
    const raw = typeof body?.custom_message === "string" ? body.custom_message : "";
    const trimmed = raw.trim();
    const customMessage = trimmed.length > 0 ? trimmed : null;

    if (customMessage) {
      const reminderResult = await query(
        `
          SELECT reminder_type
          FROM crm_reminders
          WHERE id = $1
            AND reminder_category = 'session_reminder'
          LIMIT 1
        `,
        [reminderId]
      );
      if (reminderResult.rows.length === 0) {
        return errorResponse("Session reminder not found", 404);
      }

      const reminderType = (reminderResult.rows[0] as { reminder_type: string })
        .reminder_type;
      const placeholderValidation = validateLockedPlaceholders(
        reminderType,
        customMessage
      );
      if (!placeholderValidation.ok) {
        return errorResponse(
          `Placeholders are locked for ${reminderType}. Missing: ${placeholderValidation.missing.join(", ") || "none"}. Extra/invalid: ${placeholderValidation.extra.join(", ") || "none"}. Expected: ${placeholderValidation.expected.join(", ") || "none"}.`,
          400
        );
      }
    }

    const result = await query(
      `
        UPDATE crm_reminders
        SET custom_message = $2
        WHERE id = $1
          AND reminder_category = 'session_reminder'
        RETURNING id, custom_message, reminder_type, due_at
      `,
      [reminderId, customMessage]
    );

    if (result.rows.length === 0) {
      return errorResponse("Session reminder not found", 404);
    }

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error("Error updating session reminder:", error);
    return errorResponse("Failed to update session reminder");
  }
}
