import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    const result = await query(
      `UPDATE crm_first_sessions SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) return errorResponse('First session not found', 404);

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error accepting first session:', error);
    return errorResponse('Failed to accept first session');
  }
}
