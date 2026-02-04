import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query('SELECT * FROM crm_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) return errorResponse('Session not found', 404);
    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error fetching session:', error);
    return errorResponse('Failed to fetch session');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const allowedFields = ['session_date', 'location', 'price', 'package_id', 'notes', 'status'];
    for (const field of allowedFields) {
      if (field in body) {
        fields.push(`${field} = $${paramIndex}`);
        values.push(body[field]);
        paramIndex++;
      }
    }

    if (fields.length === 0) return errorResponse('No fields to update', 400);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await query(
      `UPDATE crm_sessions SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return errorResponse('Session not found', 404);
    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error updating session:', error);
    return errorResponse('Failed to update session');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query('DELETE FROM crm_sessions WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return errorResponse('Session not found', 404);
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    return errorResponse('Failed to delete session');
  }
}
