import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  if (isNaN(id)) return errorResponse('Invalid ID', 400);

  try {
    const listResult = await query('SELECT id, name, created_at FROM email_lists WHERE id = $1', [id]);
    if (listResult.rows.length === 0) return errorResponse('List not found', 404);

    const membersResult = await query(
      'SELECT id, email, name FROM email_list_members WHERE list_id = $1 ORDER BY name ASC, email ASC',
      [id]
    );

    return jsonResponse({ ...listResult.rows[0], members: membersResult.rows });
  } catch (error) {
    console.error('Error fetching email list:', error);
    return errorResponse('Failed to fetch email list');
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
      members?: { email: string; name: string }[];
    };

    if (name !== undefined) {
      if (!name.trim()) return errorResponse('List name cannot be empty', 400);
      await query('UPDATE email_lists SET name = $1 WHERE id = $2', [name.trim(), id]);
    }

    if (members !== undefined) {
      await query('DELETE FROM email_list_members WHERE list_id = $1', [id]);
      for (const { email, name: memberName } of members) {
        if (email?.includes('@')) {
          await query(
            'INSERT INTO email_list_members (list_id, email, name) VALUES ($1, $2, $3) ON CONFLICT (list_id, email) DO NOTHING',
            [id, email.trim().toLowerCase(), (memberName ?? '').trim()]
          );
        }
      }
    }

    const result = await query(`
      SELECT el.id, el.name, el.created_at, COUNT(elm.id)::int AS member_count
      FROM email_lists el
      LEFT JOIN email_list_members elm ON elm.list_id = el.id
      WHERE el.id = $1
      GROUP BY el.id, el.name, el.created_at
    `, [id]);

    if (result.rows.length === 0) return errorResponse('List not found', 404);
    return jsonResponse(result.rows[0]);
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return errorResponse('A list with that name already exists', 409);
    }
    console.error('Error updating email list:', error);
    return errorResponse('Failed to update email list');
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);
  if (isNaN(id)) return errorResponse('Invalid ID', 400);

  try {
    const result = await query('DELETE FROM email_lists WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return errorResponse('List not found', 404);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error deleting email list:', error);
    return errorResponse('Failed to delete email list');
  }
}
