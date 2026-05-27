import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  if (isNaN(id)) return errorResponse('Invalid ID', 400);

  try {
    const listResult = await query('SELECT id, name, created_at FROM phone_lists WHERE id = $1', [id]);
    if (listResult.rows.length === 0) return errorResponse('List not found', 404);

    const membersResult = await query(
      'SELECT id, phone, name FROM phone_list_members WHERE list_id = $1 ORDER BY name ASC, phone ASC',
      [id]
    );

    return jsonResponse({ ...listResult.rows[0], members: membersResult.rows });
  } catch (error) {
    console.error('Error fetching phone list:', error);
    return errorResponse('Failed to fetch phone list');
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  if (isNaN(id)) return errorResponse('Invalid ID', 400);

  try {
    const body = await request.json();
    const { name, members } = body as {
      name?: string;
      members?: { phone: string; name: string }[];
    };

    if (name !== undefined) {
      if (!name.trim()) return errorResponse('List name cannot be empty', 400);
      await query('UPDATE phone_lists SET name = $1 WHERE id = $2', [name.trim(), id]);
    }

    if (members !== undefined) {
      await query('DELETE FROM phone_list_members WHERE list_id = $1', [id]);
      for (const { phone, name: memberName } of members) {
        if (phone?.replace(/\D/g, '').length >= 10) {
          await query(
            'INSERT INTO phone_list_members (list_id, phone, name) VALUES ($1, $2, $3) ON CONFLICT (list_id, phone) DO NOTHING',
            [id, phone.trim(), (memberName ?? '').trim()]
          );
        }
      }
    }

    const result = await query(`
      SELECT pl.id, pl.name, pl.created_at, COUNT(plm.id)::int AS member_count
      FROM phone_lists pl
      LEFT JOIN phone_list_members plm ON plm.list_id = pl.id
      WHERE pl.id = $1
      GROUP BY pl.id, pl.name, pl.created_at
    `, [id]);

    if (result.rows.length === 0) return errorResponse('List not found', 404);
    return jsonResponse(result.rows[0]);
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return errorResponse('A list with that name already exists', 409);
    }
    console.error('Error updating phone list:', error);
    return errorResponse('Failed to update phone list');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  if (isNaN(id)) return errorResponse('Invalid ID', 400);

  try {
    const result = await query('DELETE FROM phone_lists WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return errorResponse('List not found', 404);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error deleting phone list:', error);
    return errorResponse('Failed to delete phone list');
  }
}
