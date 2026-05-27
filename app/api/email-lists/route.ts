import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS email_lists (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS email_list_members (
      id SERIAL PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES email_lists(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      UNIQUE(list_id, email)
    )
  `);
}

export async function GET() {
  try {
    await ensureTables();
    const result = await query(`
      SELECT el.id, el.name, el.created_at, COUNT(elm.id)::int AS member_count
      FROM email_lists el
      LEFT JOIN email_list_members elm ON elm.list_id = el.id
      GROUP BY el.id, el.name, el.created_at
      ORDER BY el.name ASC
    `);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching email lists:', error);
    return errorResponse('Failed to fetch email lists');
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTables();
    const body = await request.json();
    const { name, members } = body as { name: string; members?: { email: string; name: string }[] };

    if (!name?.trim()) {
      return errorResponse('List name is required', 400);
    }

    const listResult = await query(
      'INSERT INTO email_lists (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()]
    );
    const list = listResult.rows[0];

    const validMembers = (members ?? []).filter((m) => m.email?.includes('@'));
    for (const { email, name: memberName } of validMembers) {
      await query(
        'INSERT INTO email_list_members (list_id, email, name) VALUES ($1, $2, $3) ON CONFLICT (list_id, email) DO NOTHING',
        [list.id, email.trim().toLowerCase(), (memberName ?? '').trim()]
      );
    }

    return jsonResponse({ ...list, member_count: validMembers.length });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return errorResponse('A list with that name already exists', 409);
    }
    console.error('Error creating email list:', error);
    return errorResponse('Failed to create email list');
  }
}
