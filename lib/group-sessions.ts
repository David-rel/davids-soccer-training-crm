/**
 * Shared bits of the group-session model that both the API routes and the
 * group-sessions page need. Deliberately free of any `lib/db` import so the
 * client bundle can use the title/image helpers to preview what the server
 * will store.
 */
import { ARIZONA_TIMEZONE } from '@/lib/timezone';

/**
 * What a group session gets for an image when none is uploaded. Kept as a
 * root-relative path on purpose: the CRM and the public signup app each serve
 * their own logo at this path, so one stored value renders correctly in both.
 * Override with an absolute URL if that ever stops being true.
 */
export const DEFAULT_GROUP_SESSION_IMAGE_URL =
  process.env.NEXT_PUBLIC_DEFAULT_GROUP_SESSION_IMAGE_URL?.trim() || '/logo.jpeg';

/** How many players a new group session holds unless told otherwise. */
export const DEFAULT_GROUP_SESSION_MAX_PLAYERS = 6;

function getOrdinal(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  const mod = day % 10;
  if (mod === 1) return 'st';
  if (mod === 2) return 'nd';
  if (mod === 3) return 'rd';
  return 'th';
}

/**
 * "Friday September 5th" for a session date.
 *
 * Accepts both what the browser's datetime-local input produces
 * ("2026-09-05T16:30", no zone) and what the database stores (UTC ISO). A
 * zoneless value is read literally — it is already the calendar day the coach
 * typed — while anything with a zone is converted to Arizona first.
 */
export function formatGroupSessionDateLabel(value: string | Date): string {
  let year: number;
  let month: number;
  let day: number;

  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  const zoneless = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+)?$/.exec(raw);

  if (zoneless) {
    year = Number(zoneless[1]);
    month = Number(zoneless[2]);
    day = Number(zoneless[3]);
  } else {
    const parsed = value instanceof Date ? value : new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ARIZONA_TIMEZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(parsed);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    year = get('year');
    month = get('month');
    day = get('day');
  }

  if (!year || !month || !day) return '';

  // Noon UTC keeps the weekday/month lookup on the intended calendar day.
  const safeDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    safeDate
  );
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    safeDate
  );

  return `${weekday} ${monthLabel} ${day}${getOrdinal(day)}`;
}

/**
 * The title a group session gets when the coach leaves the field blank:
 * "Group Training Friday September 5th at Scottsdale Sports Complex".
 */
export function buildDefaultGroupSessionTitle(
  sessionDate: string | Date,
  location?: string | null
): string {
  const dateLabel = formatGroupSessionDateLabel(sessionDate);
  const place = location?.trim();

  const base = dateLabel ? `Group Training ${dateLabel}` : 'Group Training';
  return place ? `${base} at ${place}` : base;
}
