import { query } from "@/lib/db";
import { jsonResponse, errorResponse } from "@/lib/api-helpers";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await query(`
      SELECT r.*,
        CASE
          WHEN p.secondary_parent_name IS NOT NULL AND TRIM(COALESCE(p.secondary_parent_name, '')) != ''
          THEN p.name || ' and ' || p.secondary_parent_name
          ELSE p.name
        END as parent_name
      FROM crm_reminders r
      JOIN crm_parents p ON p.id = r.parent_id
      WHERE r.sent = false
        AND COALESCE(p.is_dead, false) = false
      ORDER BY r.due_at ASC
    `);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error("Error fetching reminders:", error);
    return errorResponse("Failed to fetch reminders");
  }
}
