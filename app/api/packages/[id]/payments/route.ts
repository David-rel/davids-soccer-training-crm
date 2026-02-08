import { getClient } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { parseDateAsArizona } from '@/lib/timezone';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let client: Awaited<ReturnType<typeof getClient>> | null = null;

  try {
    client = await getClient();
    const { id } = await params;
    const body = await request.json();

    const amount = Number(body.amount);
    const paidDate =
      typeof body.paid_date === 'string' && body.paid_date.trim()
        ? body.paid_date.trim()
        : null;
    const notes =
      typeof body.notes === 'string' && body.notes.trim().length > 0
        ? body.notes.trim()
        : 'package_payment';

    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse('Payment amount must be greater than 0', 400);
    }

    let paidAtIso = new Date().toISOString();
    if (paidDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
        return errorResponse('paid_date must be YYYY-MM-DD', 400);
      }
      paidAtIso = parseDateAsArizona(paidDate);
    }

    await client.query('BEGIN');

    const packageResult = await client.query(
      `SELECT id, price, amount_received
       FROM crm_packages
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (packageResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return errorResponse('Package not found', 404);
    }

    const pkg = packageResult.rows[0];
    const currentReceived = Number(pkg.amount_received ?? 0);
    const price = pkg.price == null ? null : Number(pkg.price);
    const nextReceived = Number((currentReceived + amount).toFixed(2));

    if (price != null && nextReceived > price) {
      await client.query('ROLLBACK');
      return errorResponse('Payment exceeds package price', 400);
    }

    const updatedPackageResult = await client.query(
      `UPDATE crm_packages
       SET amount_received = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [nextReceived, id]
    );

    const eventResult = await client.query(
      `INSERT INTO crm_package_payment_events (package_id, amount, notes, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, amount, notes, paidAtIso]
    );

    await client.query('COMMIT');

    return jsonResponse({
      package: updatedPackageResult.rows[0],
      payment_event: eventResult.rows[0],
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Error adding package payment:', error);
    return errorResponse('Failed to add package payment');
  } finally {
    if (client) client.release();
  }
}
