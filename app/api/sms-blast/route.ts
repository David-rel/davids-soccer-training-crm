import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { sendSmsViaTwilio, normalizeUsPhoneNumber } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

export interface SmsContact {
  phone: string;
  name: string;
  source: 'crm' | 'signup';
  is_dead: boolean;
}

export async function GET() {
  try {
    // Pull from CRM and group signups, dedup by last-10-digits of phone
    const result = await query(`
      WITH crm AS (
        SELECT
          RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) AS phone_key,
          TRIM(phone) AS phone,
          name,
          COALESCE(is_dead, false) AS is_dead,
          'crm' AS source,
          1 AS priority
        FROM crm_parents
        WHERE phone IS NOT NULL
          AND TRIM(phone) <> ''
          AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
      ),
      signup_rows AS (
        SELECT
          RIGHT(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 10) AS phone_key,
          TRIM(contact_phone) AS phone,
          TRIM(first_name || ' ' || last_name) AS name,
          false AS is_dead,
          'signup' AS source,
          2 AS priority
        FROM player_signups
        WHERE contact_phone IS NOT NULL
          AND TRIM(contact_phone) <> ''
          AND length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) >= 10
      ),
      all_rows AS (
        SELECT * FROM crm
        UNION ALL
        SELECT * FROM signup_rows
      ),
      deduped AS (
        SELECT DISTINCT ON (phone_key)
          phone, name, is_dead, source
        FROM all_rows
        ORDER BY phone_key, priority ASC
      )
      SELECT phone, name, is_dead, source
      FROM deduped
      ORDER BY name ASC
    `);
    return jsonResponse(result.rows as SmsContact[]);
  } catch (error) {
    console.error('Error fetching contacts for SMS blast:', error);
    return errorResponse('Failed to fetch contacts');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phones, message } = body as { phones: string[]; message: string };

    if (!Array.isArray(phones) || phones.length === 0) {
      return errorResponse('At least one phone number must be provided', 400);
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return errorResponse('Message is required', 400);
    }

    const validPhones = phones
      .map((p) => (typeof p === 'string' ? normalizeUsPhoneNumber(p.trim()) : null))
      .filter((p): p is string => p !== null);

    if (validPhones.length === 0) {
      return errorResponse('No valid phone numbers provided', 400);
    }

    const sent: string[] = [];
    const failed: { phone: string; error: string }[] = [];

    for (const phone of validPhones) {
      const result = await sendSmsViaTwilio(phone, message.trim());
      if (result.ok) {
        sent.push(phone);
      } else {
        console.error(`Failed to send SMS to ${phone}:`, result.error);
        failed.push({ phone, error: result.error ?? 'Unknown error' });
      }
    }

    return jsonResponse({ sent_count: sent.length, failed_count: failed.length, sent, failed });
  } catch (error) {
    console.error('Error sending SMS blast:', error);
    return errorResponse('Failed to send SMS');
  }
}
