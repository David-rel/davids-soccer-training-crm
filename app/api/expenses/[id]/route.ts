import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { MIN_EXPENSE_YEAR, ensureExpensesSchema } from '@/lib/expenses-db';

export const dynamic = 'force-dynamic';

interface ExpenseRow {
  id: number;
  expense_date: string;
  vendor: string;
  category: string;
  description: string | null;
  amount: string | number;
  payment_method: string | null;
  receipt_url: string | null;
  receipt_blob_path: string | null;
  business_percentage: string | number;
  notes: string | null;
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

function mapExpense(row: ExpenseRow) {
  return {
    ...row,
    amount: round2(asNumber(row.amount)),
    business_percentage: round2(asNumber(row.business_percentage)),
    expense_date: String(row.expense_date).slice(0, 10),
  };
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureExpensesSchema();

    const resolvedParams = await params;
    const id = parseId(resolvedParams.id);
    if (!id) return errorResponse('Invalid expense id', 400);

    const body = await request.json();
    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (body.expense_date !== undefined) {
      const expenseDate = body.expense_date == null ? '' : String(body.expense_date);
      if (!isValidDateString(expenseDate)) {
        return errorResponse('Invalid expense date', 400);
      }
      if (Number(expenseDate.slice(0, 4)) < MIN_EXPENSE_YEAR) {
        return errorResponse(`Expense year must be ${MIN_EXPENSE_YEAR} or later`, 400);
      }
      fields.push(`expense_date = $${index++}`);
      values.push(expenseDate);
    }

    if (body.vendor !== undefined) {
      const vendor = body.vendor == null ? '' : String(body.vendor).trim();
      if (!vendor) return errorResponse('Vendor cannot be empty', 400);
      fields.push(`vendor = $${index++}`);
      values.push(vendor);
    }

    if (body.category !== undefined) {
      const category = body.category == null ? '' : String(body.category).trim();
      if (!category) return errorResponse('Category cannot be empty', 400);
      fields.push(`category = $${index++}`);
      values.push(category);
    }

    if (body.description !== undefined) {
      const description = body.description == null ? null : String(body.description).trim() || null;
      fields.push(`description = $${index++}`);
      values.push(description);
    }

    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return errorResponse('Amount must be zero or greater', 400);
      }
      fields.push(`amount = $${index++}`);
      values.push(amount);
    }

    if (body.payment_method !== undefined) {
      const paymentMethod =
        body.payment_method == null ? null : String(body.payment_method).trim() || null;
      fields.push(`payment_method = $${index++}`);
      values.push(paymentMethod);
    }

    if (body.receipt_url !== undefined) {
      const receiptUrl = body.receipt_url == null ? null : String(body.receipt_url).trim() || null;
      fields.push(`receipt_url = $${index++}`);
      values.push(receiptUrl);
    }

    if (body.receipt_blob_path !== undefined) {
      const receiptBlobPath =
        body.receipt_blob_path == null ? null : String(body.receipt_blob_path).trim() || null;
      fields.push(`receipt_blob_path = $${index++}`);
      values.push(receiptBlobPath);
    }

    if (body.business_percentage !== undefined) {
      const businessPercentage = Number(body.business_percentage);
      if (!Number.isFinite(businessPercentage) || businessPercentage < 0 || businessPercentage > 100) {
        return errorResponse('Business percentage must be between 0 and 100', 400);
      }
      fields.push(`business_percentage = $${index++}`);
      values.push(businessPercentage);
    }

    if (body.notes !== undefined) {
      const notes = body.notes == null ? null : String(body.notes).trim() || null;
      fields.push(`notes = $${index++}`);
      values.push(notes);
    }

    if (fields.length === 0) {
      return errorResponse('No fields provided to update', 400);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await query(
      `
        UPDATE crm_expenses
        SET ${fields.join(', ')}
        WHERE id = $${index}
        RETURNING
          id,
          expense_date::text AS expense_date,
          vendor,
          category,
          description,
          amount::numeric AS amount,
          payment_method,
          receipt_url,
          receipt_blob_path,
          business_percentage::numeric AS business_percentage,
          notes,
          created_at,
          updated_at
      `,
      values
    );

    if (result.rowCount === 0) {
      return errorResponse('Expense not found', 404);
    }

    return jsonResponse(mapExpense(result.rows[0] as ExpenseRow));
  } catch (error) {
    console.error('Error updating expense:', error);
    return errorResponse('Failed to update expense');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureExpensesSchema();

    const resolvedParams = await params;
    const id = parseId(resolvedParams.id);
    if (!id) return errorResponse('Invalid expense id', 400);

    const result = await query('DELETE FROM crm_expenses WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return errorResponse('Expense not found', 404);

    return jsonResponse({ id });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return errorResponse('Failed to delete expense');
  }
}
