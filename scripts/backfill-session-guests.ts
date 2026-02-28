#!/usr/bin/env tsx
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

import { query, getPool } from '@/lib/db';
import { ensureSessionCalendarColumns } from '@/lib/session-calendar-fields';

async function main() {
  await ensureSessionCalendarColumns();

  const result = await query(`
    WITH normalized AS (
      SELECT
        s.id,
        ARRAY(
          SELECT DISTINCT lower(trim(e))
          FROM unnest(
            COALESCE(s.guest_emails, '{}'::text[]) ||
            CASE WHEN p.email IS NOT NULL THEN ARRAY[p.email] ELSE '{}'::text[] END
          ) AS e
          WHERE e IS NOT NULL
            AND btrim(e) <> ''
            AND e ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
        ) AS emails
      FROM crm_sessions s
      JOIN crm_parents p ON p.id = s.parent_id
    )
    UPDATE crm_sessions s
    SET guest_emails = n.emails
    FROM normalized n
    WHERE s.id = n.id
  `);

  console.log(`Backfill complete. Updated ${result.rowCount ?? 0} session rows.`);
  await getPool().end();
}

main().catch(async (error) => {
  console.error('backfill-session-guests failed:', error);
  try {
    await getPool().end();
  } catch {
    // ignore
  }
  process.exit(1);
});
