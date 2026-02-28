import { errorResponse, jsonResponse } from "@/lib/api-helpers";
import { ensureAutoRemindersSchema } from "@/lib/auto-reminders";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureAutoRemindersSchema();
    const result = await query(
      `
        SELECT id, name, message_template, created_at, updated_at
        FROM crm_custom_message_templates
        ORDER BY updated_at DESC, id DESC
      `
    );
    return jsonResponse(result.rows);
  } catch (error) {
    console.error("Error fetching custom templates:", error);
    return errorResponse("Failed to fetch custom templates");
  }
}

export async function POST(request: Request) {
  try {
    await ensureAutoRemindersSchema();
    const body = await request.json();
    const name = String(body?.name || "").trim();
    const messageTemplate = String(body?.message_template || "").trim();

    if (!name) return errorResponse("Template name is required", 400);
    if (!messageTemplate) return errorResponse("message_template is required", 400);

    const result = await query(
      `
        INSERT INTO crm_custom_message_templates (name, message_template)
        VALUES ($1, $2)
        RETURNING id, name, message_template, created_at, updated_at
      `,
      [name, messageTemplate]
    );

    return jsonResponse(result.rows[0], 201);
  } catch (error) {
    console.error("Error creating custom template:", error);
    return errorResponse("Failed to create custom template");
  }
}

