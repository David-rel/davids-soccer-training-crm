import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import { ensureAutoRemindersSchema } from "@/lib/auto-reminders";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAutoRemindersSchema();
    const { id } = await params;
    const templateId = Number(id);
    if (!Number.isFinite(templateId)) {
      return errorResponse("Invalid template id", 400);
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (typeof body?.name === "string") {
      const name = body.name.trim();
      if (!name) return errorResponse("Template name cannot be empty", 400);
      updates.push(`name = $${index}`);
      values.push(name);
      index += 1;
    }

    if (typeof body?.message_template === "string") {
      const messageTemplate = body.message_template.trim();
      if (!messageTemplate) return errorResponse("message_template cannot be empty", 400);
      updates.push(`message_template = $${index}`);
      values.push(messageTemplate);
      index += 1;
    }

    if (updates.length === 0) {
      return errorResponse("No fields to update", 400);
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(templateId);

    const result = await query(
      `
        UPDATE crm_custom_message_templates
        SET ${updates.join(", ")}
        WHERE id = $${index}
        RETURNING id, name, message_template, created_at, updated_at
      `,
      values
    );

    if (result.rows.length === 0) {
      return errorResponse("Template not found", 404);
    }

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error("Error updating custom template:", error);
    return errorResponse("Failed to update custom template");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureAutoRemindersSchema();
    const { id } = await params;
    const templateId = Number(id);
    if (!Number.isFinite(templateId)) {
      return errorResponse("Invalid template id", 400);
    }

    const result = await query(
      `DELETE FROM crm_custom_message_templates WHERE id = $1 RETURNING id`,
      [templateId]
    );

    if (result.rows.length === 0) {
      return errorResponse("Template not found", 404);
    }

    return jsonResponse({ deleted: true, id: templateId });
  } catch (error) {
    console.error("Error deleting custom template:", error);
    return errorResponse("Failed to delete custom template");
  }
}

