import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pkgResult = await query(`
      SELECT pkg.*, p.name as parent_name,
        (SELECT ARRAY_AGG(name ORDER BY created_at) FROM crm_players WHERE parent_id = p.id) as player_names
      FROM crm_packages pkg
      JOIN crm_parents p ON p.id = pkg.parent_id
      WHERE pkg.id = $1
    `, [id]);
    if (pkgResult.rows.length === 0) return errorResponse('Package not found', 404);

    // Get sessions tied to this package
    const sessionsResult = await query(
      `SELECT s.*, ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL) as player_names
       FROM crm_sessions s 
       LEFT JOIN crm_session_players sp ON sp.session_id = s.id
       LEFT JOIN crm_players pl ON pl.id = sp.player_id 
       WHERE s.package_id = $1 
       GROUP BY s.id
       ORDER BY s.session_date`,
      [id]
    );

    return jsonResponse({ ...pkgResult.rows[0], sessions: sessionsResult.rows });
  } catch (error) {
    console.error('Error fetching package:', error);
    return errorResponse('Failed to fetch package');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const allowedFields = ['price', 'start_date', 'is_active', 'sessions_completed'];
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
      `UPDATE crm_packages SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return errorResponse('Package not found', 404);
    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error updating package:', error);
    return errorResponse('Failed to update package');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query('DELETE FROM crm_packages WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return errorResponse('Package not found', 404);
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Error deleting package:', error);
    return errorResponse('Failed to delete package');
  }
}
