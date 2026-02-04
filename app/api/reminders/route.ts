import { query } from "@/lib/db";
import { jsonResponse, errorResponse } from "@/lib/api-helpers";

export async function GET() {
  try {
    const result = await query(`
      SELECT r.*, p.name as parent_name
      FROM crm_reminders r
      JOIN crm_parents p ON p.id = r.parent_id
      WHERE r.sent = false
      ORDER BY r.due_at ASC
    `);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error("Error fetching reminders:", error);
    return errorResponse("Failed to fetch reminders");
  }
}
