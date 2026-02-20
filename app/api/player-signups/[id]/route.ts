import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized && normalized.length > 0 ? normalized : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if ('first_name' in body) {
      const firstName = normalizeRequiredText(body.first_name);
      if (!firstName) return errorResponse('First name is required', 400);
      fields.push(`first_name = $${paramIndex++}`);
      values.push(firstName);
    }

    if ('last_name' in body) {
      const lastName = normalizeRequiredText(body.last_name);
      if (!lastName) return errorResponse('Last name is required', 400);
      fields.push(`last_name = $${paramIndex++}`);
      values.push(lastName);
    }

    if ('emergency_contact' in body) {
      const emergencyContact = normalizeRequiredText(body.emergency_contact);
      if (!emergencyContact) return errorResponse('Emergency contact is required', 400);
      fields.push(`emergency_contact = $${paramIndex++}`);
      values.push(emergencyContact);
    }

    if ('contact_email' in body) {
      const contactEmail = normalizeRequiredText(body.contact_email);
      if (!contactEmail) return errorResponse('Contact email is required', 400);
      fields.push(`contact_email = $${paramIndex++}`);
      values.push(contactEmail);
    }

    if ('contact_phone' in body) {
      fields.push(`contact_phone = $${paramIndex++}`);
      values.push(normalizeOptionalText(body.contact_phone));
    }

    const optionalTextFields = [
      'foot',
      'team',
      'notes',
      'stripe_payment_intent_id',
      'stripe_checkout_session_id',
      'stripe_charge_id',
      'stripe_receipt_url',
    ] as const;

    for (const field of optionalTextFields) {
      if (field in body) {
        fields.push(`${field} = $${paramIndex++}`);
        values.push(normalizeOptionalText(body[field]));
      }
    }

    if ('has_paid' in body) {
      fields.push(`has_paid = $${paramIndex++}`);
      values.push(body.has_paid === true);
    }

    if (fields.length === 0) {
      return errorResponse('No fields to update', 400);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await query(
      `UPDATE player_signups
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return errorResponse('Player signup not found', 404);
    }

    return jsonResponse(result.rows[0]);
  } catch (error) {
    console.error('Error updating player signup:', error);
    return errorResponse('Failed to update player signup');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query('DELETE FROM player_signups WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return errorResponse('Player signup not found', 404);
    }

    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error('Error deleting player signup:', error);
    return errorResponse('Failed to delete player signup');
  }
}
