import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await query(`
      SELECT pkg.*, p.name as parent_name,
        (SELECT ARRAY_AGG(name ORDER BY created_at) FROM crm_players WHERE parent_id = p.id) as player_names
      FROM crm_packages pkg
      JOIN crm_parents p ON p.id = pkg.parent_id
      ORDER BY pkg.is_active DESC, pkg.created_at DESC
    `);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching packages:', error);
    return errorResponse('Failed to fetch packages');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parent_id, package_type, price, start_date } = body;

    if (!parent_id || !package_type) {
      return errorResponse('Parent and package type are required', 400);
    }

    const totalSessionsMap: Record<string, number> = {
      '12_week_1x': 12,
      '12_week_2x': 24,
      '6_week_1x': 6,
      '6_week_2x': 12,
    };

    const totalSessions = totalSessionsMap[package_type];
    if (!totalSessions) return errorResponse('Invalid package type', 400);

    const result = await query(
      `INSERT INTO crm_packages (parent_id, package_type, total_sessions, price, start_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [parent_id, package_type, totalSessions, price || null, start_date || null]
    );

    // Update parent interest_in_package
    await query(
      `UPDATE crm_parents SET interest_in_package = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [parent_id]
    );

    return jsonResponse(result.rows[0], 201);
  } catch (error) {
    console.error('Error creating package:', error);
    return errorResponse('Failed to create package');
  }
}
