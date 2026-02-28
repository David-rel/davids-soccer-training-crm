#!/usr/bin/env tsx
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

import {
  clearFutureEventsFromManagedCalendars,
  syncUpcomingSessionsToGoogleCalendars,
} from '@/lib/google-calendar';
import { getPool } from '@/lib/db';

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getFlagValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return null;
  return next;
}

function toPositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function main() {
  const wipeFuture = hasFlag('--wipe-future');
  const daysAhead = toPositiveInt(getFlagValue('--days'), 120, 1, 365);
  const wipeFrom = getFlagValue('--from');

  console.log('Google Calendar sync starting...');
  console.log(`daysAhead=${daysAhead} wipeFuture=${wipeFuture}`);

  if (wipeFuture) {
    console.log('Clearing future events from managed calendars...');
    const wipe = await clearFutureEventsFromManagedCalendars(wipeFrom || undefined, daysAhead);
    console.log(`Deleted ${wipe.deleted} event(s) from Google Calendar.`);
  }

  const result = await syncUpcomingSessionsToGoogleCalendars(daysAhead);
  console.log('Bulk sync complete:', result);

  await getPool().end();

  if (result.failed > 0) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('sync-google-calendars failed:', error);
  try {
    await getPool().end();
  } catch {
    // ignore close errors
  }
  process.exit(1);
});
