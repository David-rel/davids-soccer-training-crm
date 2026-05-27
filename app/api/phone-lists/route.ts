import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS phone_lists (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS phone_list_members (
      id SERIAL PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES phone_lists(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      UNIQUE(list_id, phone)
    )
  `);
}

export async function GET() {
  try {
    await ensureTables();
    const result = await query(`
      SELECT pl.id, pl.name, pl.created_at, COUNT(plm.id)::int AS member_count
      FROM phone_lists pl
      LEFT JOIN phone_list_members plm ON plm.list_id = pl.id
      GROUP BY pl.id, pl.name, pl.created_at
      ORDER BY pl.name ASC
    `);
    return jsonResponse(result.rows);
  } catch (error) {
    console.error('Error fetching phone lists:', error);
    return errorResponse('Failed to fetch phone lists');
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTables();
    const body = await request.json();
    const { name, members } = body as { name: string; members?: { phone: string; name: string }[] };

    if (!name?.trim()) {
      return errorResponse('List name is required', 400);
    }

    const listResult = await query(
      'INSERT INTO phone_lists (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()]
    );
    const list = listResult.rows[0];

    const validMembers = (members ?? []).filter((m) => m.phone?.replace(/\D/g, '').length >= 10);
    for (const { phone, name: memberName } of validMembers) {
      await query(
        'INSERT INTO phone_list_members (list_id, phone, name) VALUES ($1, $2, $3) ON CONFLICT (list_id, phone) DO NOTHING',
        [list.id, phone.trim(), (memberName ?? '').trim()]
      );
    }

    return jsonResponse({ ...list, member_count: validMembers.length });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      return errorResponse('A list with that name already exists', 409);
    }
    console.error('Error creating phone list:', error);
    return errorResponse('Failed to create phone list');
  }
}
