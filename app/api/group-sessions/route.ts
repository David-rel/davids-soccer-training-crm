import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { parseDatetimeLocalAsArizona } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

interface GroupSessionRow {
  id: number;
  title: string;
  description: string | null;
  image_url: string | null;
  session_date: string;
  session_date_end: string | null;
  location: string | null;
  price: string | number | null;
  curriculum: string | null;
  max_players: number;
  player_count: number;
  created_at: string;
  updated_at: string;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapGroupSession(row: GroupSessionRow) {
  return {
    ...row,
    price: row.price == null ? null : round2(asNumber(row.price)),
    max_players: asNumber(row.max_players),
    player_count: asNumber(row.player_count),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSessionDateInput(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const trimmed = value.trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed);

  if (!hasTimezone) {
    const localValue = trimmed.length === 10 ? `${trimmed}T00:00` : trimmed.replace(' ', 'T');
    return parseDatetimeLocalAsArizona(localValue);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function GET() {
  try {
    const result = await query(
      `SELECT
        gs.*,
        COUNT(ps.id)::int AS player_count
      FROM group_sessions gs
      LEFT JOIN player_signups ps ON ps.group_session_id = gs.id
      GROUP BY gs.id
      ORDER BY gs.session_date DESC`
    );

    return jsonResponse((result.rows as GroupSessionRow[]).map(mapGroupSession));
  } catch (error) {
    console.error('Error fetching group sessions:', error);
    return errorResponse('Failed to fetch group sessions');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const title = normalizeOptionalText(body.title);
    const description = normalizeOptionalText(body.description);
    const imageUrl = normalizeOptionalText(body.image_url);
    const sessionDate = normalizeSessionDateInput(body.session_date);
    const sessionDateEnd = normalizeSessionDateInput(body.session_date_end);
    const location = normalizeOptionalText(body.location);
    const curriculum = normalizeOptionalText(body.curriculum);

    const maxPlayers = Number(body.max_players);
    const price = body.price == null || String(body.price).trim() === '' ? null : Number(body.price);

    if (!title || !sessionDate || !Number.isInteger(maxPlayers) || maxPlayers < 1) {
      return errorResponse('Title, date, and max players are required', 400);
    }

    if (sessionDateEnd && new Date(sessionDateEnd) < new Date(sessionDate)) {
      return errorResponse('End date must be after start date', 400);
    }

    if (price != null && !Number.isFinite(price)) {
      return errorResponse('Price must be a valid number', 400);
    }

    const result = await query(
      `INSERT INTO group_sessions (
        title,
        description,
        image_url,
        session_date,
        session_date_end,
        location,
        price,
        curriculum,
        max_players
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        title,
        description,
        imageUrl,
        sessionDate,
        sessionDateEnd,
        location,
        price,
        curriculum,
        maxPlayers,
      ]
    );

    return jsonResponse(mapGroupSession({ ...(result.rows[0] as GroupSessionRow), player_count: 0 }), 201);
  } catch (error) {
    console.error('Error creating group session:', error);
    return errorResponse('Failed to create group session');
  }
}
