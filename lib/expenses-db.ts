import { query } from '@/lib/db';

export const MIN_EXPENSE_YEAR = 2026;

let schemaReadyPromise: Promise<void> | null = null;

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

export function normalizeExpenseYear(value: string | null | undefined): number {
  const currentYear = getCurrentYear();
  const fallbackYear = Math.max(MIN_EXPENSE_YEAR, currentYear);
  if (!value) return fallbackYear;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallbackYear;
  if (parsed < MIN_EXPENSE_YEAR) return MIN_EXPENSE_YEAR;
  if (parsed > currentYear + 1) return currentYear + 1;
  return parsed;
}

export function getExpenseYearBounds(year: number): { start: string; end: string } {
  return {
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
  };
}

export async function ensureExpensesSchema() {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS crm_expenses (
        id BIGSERIAL PRIMARY KEY,
        expense_date DATE NOT NULL,
        vendor TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
        payment_method TEXT,
        receipt_url TEXT,
        receipt_blob_path TEXT,
        business_percentage NUMERIC(5, 2) NOT NULL DEFAULT 100 CHECK (business_percentage >= 0 AND business_percentage <= 100),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_crm_expenses_expense_date
      ON crm_expenses (expense_date DESC)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_crm_expenses_category
      ON crm_expenses (category)
    `);
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
}
