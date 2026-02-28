import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import {
  ensureAutoRemindersSchema,
  getSessionReminderDefaults,
  SESSION_REMINDER_TYPE_LABELS,
  validateLockedPlaceholders,
} from "@/lib/auto-reminders";
import { query } from "@/lib/db";
import { SESSION_REMINDER_TYPES } from "@/lib/reminders";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureAutoRemindersSchema();
    const rows = await getSessionReminderDefaults();

    const ordered = SESSION_REMINDER_TYPES.map((reminderType) => {
      const row = rows.find((item) => item.reminder_type === reminderType);
      return {
        reminder_type: reminderType,
        label: SESSION_REMINDER_TYPE_LABELS[reminderType] || reminderType,
        message_template: row?.message_template || "",
        is_active: row?.is_active ?? true,
        updated_at: row?.updated_at ?? null,
      };
    });

    return jsonResponse(ordered);
  } catch (error) {
    console.error("Error fetching reminder defaults:", error);
    return errorResponse("Failed to fetch reminder defaults");
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureAutoRemindersSchema();
    const body = await request.json();
    const reminderType = String(body?.reminder_type || "").trim();
    const messageTemplate = String(body?.message_template || "").trim();
    const isActive =
      typeof body?.is_active === "boolean" ? body.is_active : undefined;

    if (!SESSION_REMINDER_TYPES.some((type) => type === reminderType)) {
      return errorResponse("Invalid reminder_type", 400);
    }

    if (!messageTemplate) {
      return errorResponse("message_template is required", 400);
    }

    const placeholderValidation = validateLockedPlaceholders(
      reminderType,
      messageTemplate
    );
    if (!placeholderValidation.ok) {
      return errorResponse(
        `Placeholders are locked for ${reminderType}. Missing: ${placeholderValidation.missing.join(", ") || "none"}. Extra/invalid: ${placeholderValidation.extra.join(", ") || "none"}. Expected: ${placeholderValidation.expected.join(", ") || "none"}.`,
        400
      );
    }

    const result = await query(
      `
        UPDATE crm_reminder_defaults
        SET message_template = $2,
            is_active = COALESCE($3::boolean, is_active),
            updated_at = CURRENT_TIMESTAMP
        WHERE reminder_type = $1
        RETURNING reminder_type, message_template, is_active, updated_at
      `,
      [reminderType, messageTemplate, isActive ?? null]
    );

    if (result.rows.length === 0) {
      return errorResponse("Reminder default not found", 404);
    }

    const row = result.rows[0] as {
      reminder_type: string;
      message_template: string;
      is_active: boolean;
      updated_at: string;
    };

    return jsonResponse({
      ...row,
      label: SESSION_REMINDER_TYPE_LABELS[row.reminder_type] || row.reminder_type,
    });
  } catch (error) {
    console.error("Error updating reminder default:", error);
    return errorResponse("Failed to update reminder default");
  }
}
