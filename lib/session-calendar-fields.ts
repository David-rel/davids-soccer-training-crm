import { query } from '@/lib/db';

let ensureSessionCalendarColumnsPromise: Promise<void> | null = null;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SESSION_DURATION_MINUTES = 60;

export async function ensureSessionCalendarColumns(): Promise<void> {
  if (ensureSessionCalendarColumnsPromise) {
    await ensureSessionCalendarColumnsPromise;
    return;
  }

  ensureSessionCalendarColumnsPromise = (async () => {
    await query(`ALTER TABLE crm_sessions ADD COLUMN IF NOT EXISTS title TEXT`);
    await query(`ALTER TABLE crm_sessions ADD COLUMN IF NOT EXISTS session_end_date TIMESTAMP`);
    await query(`ALTER TABLE crm_sessions ADD COLUMN IF NOT EXISTS guest_emails TEXT[]`);
    await query(`ALTER TABLE crm_sessions ADD COLUMN IF NOT EXISTS send_email_updates BOOLEAN`);
    await query(`ALTER TABLE crm_sessions ALTER COLUMN guest_emails SET DEFAULT '{}'::text[]`);
    await query(`ALTER TABLE crm_sessions ALTER COLUMN send_email_updates SET DEFAULT false`);
    await query(`
      UPDATE crm_sessions
      SET session_end_date = session_date + INTERVAL '60 minutes'
      WHERE session_end_date IS NULL
    `);
    await query(`
      UPDATE crm_sessions
      SET guest_emails = '{}'::text[]
      WHERE guest_emails IS NULL
    `);
    await query(`
      UPDATE crm_sessions
      SET send_email_updates = false
      WHERE send_email_updates IS NULL
    `);
  })().catch((error) => {
    ensureSessionCalendarColumnsPromise = null;
    throw error;
  });

  await ensureSessionCalendarColumnsPromise;
}

export function normalizeSessionTitle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toEmailCandidates(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.filter((value): value is string => typeof value === 'string');
  }

  if (typeof input === 'string') {
    return input
      .split(/[,\n;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

export function parseGuestEmails(input: unknown): { emails: string[]; invalid: string[] } {
  const candidates = toEmailCandidates(input).map((value) => value.toLowerCase());
  const unique = [...new Set(candidates)];

  const emails: string[] = [];
  const invalid: string[] = [];

  for (const candidate of unique) {
    if (EMAIL_REGEX.test(candidate)) {
      emails.push(candidate);
    } else {
      invalid.push(candidate);
    }
  }

  return { emails, invalid };
}

export function ensureParentEmailInGuestList(
  guestEmails: string[],
  parentEmail: string | null | undefined
): string[] {
  if (!parentEmail) return guestEmails;

  const parentCandidate = parentEmail.trim().toLowerCase();
  if (!parentCandidate || !EMAIL_REGEX.test(parentCandidate)) {
    return guestEmails;
  }

  return [...new Set([...guestEmails, parentCandidate])];
}

export function defaultSessionEndFromStart(startIso: string): string {
  const startDate = new Date(startIso);
  return new Date(startDate.getTime() + DEFAULT_SESSION_DURATION_MINUTES * 60 * 1000).toISOString();
}

export function isEndAfterStart(startIso: string, endIso: string): boolean {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}
