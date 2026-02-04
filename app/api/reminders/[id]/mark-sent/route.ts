import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query(
      `UPDATE crm_reminders SET sent = true, sent_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return errorResponse('Reminder not found', 404);
    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error marking reminder sent:', error);
    return errorResponse('Failed to mark reminder sent');
  }
}
