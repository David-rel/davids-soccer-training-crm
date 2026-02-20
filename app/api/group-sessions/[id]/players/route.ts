import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface SignupRow {
  id: number;
  group_session_id: number;
  first_name: string;
  last_name: string;
  emergency_contact: string;
  contact_phone: string | null;
  contact_email: string;
  foot: string | null;
  team: string | null;
  notes: string | null;
  has_paid: boolean;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_charge_id: string | null;
  stripe_receipt_url: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized && normalized.length > 0 ? normalized : null;
}

async function getSessionCapacity(groupSessionId: string) {
  const result = await query(
    `SELECT
      gs.id,
      gs.max_players,
      COUNT(ps.id) FILTER (WHERE ps.has_paid = true)::int AS paid_player_count
    FROM group_sessions gs
    LEFT JOIN player_signups ps ON ps.group_session_id = gs.id
    WHERE gs.id = $1
    GROUP BY gs.id`,
    [groupSessionId]
  );

  if (result.rows.length === 0) return null;
  return {
    maxPlayers: Number(result.rows[0].max_players),
    paidPlayerCount: Number(result.rows[0].paid_player_count),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const sessionExists = await query('SELECT id FROM group_sessions WHERE id = $1', [id]);
    if (sessionExists.rows.length === 0) {
      return errorResponse('Group session not found', 404);
    }

    const result = await query(
      `SELECT *
       FROM player_signups
       WHERE group_session_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return jsonResponse(result.rows as SignupRow[]);
  } catch (error) {
    console.error('Error fetching player signups:', error);
    return errorResponse('Failed to fetch player signups');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const firstName = normalizeRequiredText(body.first_name);
    const lastName = normalizeRequiredText(body.last_name);
    const emergencyContact = normalizeRequiredText(body.emergency_contact);
    const contactEmail = normalizeRequiredText(body.contact_email);
    const contactPhone = normalizeOptionalText(body.contact_phone);

    if (!firstName || !lastName || !emergencyContact || !contactEmail) {
      return errorResponse(
        'First name, last name, emergency contact, and contact email are required',
        400
      );
    }

    const capacity = await getSessionCapacity(id);
    if (!capacity) {
      return errorResponse('Group session not found', 404);
    }

    const isPaidSignup = body.has_paid === true;
    if (isPaidSignup && capacity.paidPlayerCount >= capacity.maxPlayers) {
      return errorResponse('This group session is already full', 400);
    }

    const result = await query(
      `INSERT INTO player_signups (
        group_session_id,
        first_name,
        last_name,
        emergency_contact,
        contact_phone,
        contact_email,
        foot,
        team,
        notes,
        has_paid,
        stripe_payment_intent_id,
        stripe_checkout_session_id,
        stripe_charge_id,
        stripe_receipt_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        id,
        firstName,
        lastName,
        emergencyContact,
        contactPhone,
        contactEmail,
        normalizeOptionalText(body.foot),
        normalizeOptionalText(body.team),
        normalizeOptionalText(body.notes),
        isPaidSignup,
        normalizeOptionalText(body.stripe_payment_intent_id),
        normalizeOptionalText(body.stripe_checkout_session_id),
        normalizeOptionalText(body.stripe_charge_id),
        normalizeOptionalText(body.stripe_receipt_url),
      ]
    );

    return jsonResponse(result.rows[0] as SignupRow, 201);
  } catch (error) {
    console.error('Error creating player signup:', error);
    return errorResponse('Failed to create player signup');
  }
}
