/**
 * Telling a family they're in a group training.
 *
 * Fires when a coach adds players from the CRM: one text and one email per
 * FAMILY (not per kid, so a household with two players gets one message
 * naming both), with a calendar invite attached to the email.
 *
 * Every send is best-effort and reported back rather than thrown: a bad phone
 * number must not cost the family their email, and neither must undo a signup
 * that is already in the database.
 */
import { query } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { sendSmsViaTwilio } from '@/lib/twilio';
import { formatGroupSessionDateLabel } from '@/lib/group-sessions';
import { ARIZONA_TIMEZONE } from '@/lib/timezone';

interface GroupSessionDetails {
  id: number;
  title: string;
  session_date: string | Date;
  session_date_end: string | Date | null;
  location: string | null;
  price: string | number | null;
}

/** One family's slice of a bulk add: their kids, and how to reach them. */
export interface NotifyRecipient {
  parentId: number;
  parentName: string;
  email: string | null;
  phone: string | null;
  playerNames: string[];
}

export interface NotifyOutcome {
  emailed: number;
  texted: number;
  /** Human-readable reasons a family got less than the full treatment. */
  problems: string[];
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatArizonaClock(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ARIZONA_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "Sunday September 13th, 5:00 PM - 6:00 PM" */
export function formatSessionWhen(session: GroupSessionDetails): string {
  const dateLabel = formatGroupSessionDateLabel(session.session_date);
  const start = formatArizonaClock(session.session_date);
  const end = session.session_date_end ? formatArizonaClock(session.session_date_end) : '';

  const time = end ? `${start} - ${end}` : start;
  return [dateLabel, time].filter(Boolean).join(', ');
}

function formatPrice(price: string | number | null): string | null {
  if (price == null || String(price).trim() === '') return null;
  const parsed = Number(price);
  return Number.isFinite(parsed) ? money.format(parsed) : null;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return 'Your player';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** "is" for one player, "are" for a household of several. */
function isAre(names: string[]): string {
  return names.length === 1 ? 'is' : 'are';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ICS wants UTC basic format: 20260914T000000Z */
function toIcsUtc(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * A calendar invite for the session. Sent as an attachment rather than by
 * adding the family as a Google Calendar guest with notifications on: that
 * would make Google re-email every family already on the event each time a new
 * one is added.
 */
export function buildGroupSessionIcs(session: GroupSessionDetails, organizerEmail: string): string {
  const end = session.session_date_end
    ? session.session_date_end
    : new Date(new Date(session.session_date).getTime() + 60 * 60 * 1000);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//David's Soccer Training//Group Training//EN",
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:group-session-${session.id}@davidssoccertraining.com`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(session.session_date)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(session.title)}`,
    session.location ? `LOCATION:${escapeIcsText(session.location)}` : '',
    `ORGANIZER;CN=David's Soccer Training:mailto:${organizerEmail}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

export function buildSignupSms(session: GroupSessionDetails, recipient: NotifyRecipient): string {
  const price = formatPrice(session.price);
  const lines = [
    `${joinNames(recipient.playerNames)} ${isAre(recipient.playerNames)} signed up for ${
      session.title
    }.`,
    formatSessionWhen(session),
  ];
  if (session.location) lines.push(session.location);
  if (price) lines.push(`Cost: ${price}`);
  lines.push("- David's Soccer Training");

  return lines.join('\n');
}

export function buildSignupEmailHtml(
  session: GroupSessionDetails,
  recipient: NotifyRecipient
): string {
  const price = formatPrice(session.price);
  const rows: Array<[string, string]> = [['When', formatSessionWhen(session)]];
  if (session.location) rows.push(['Where', session.location]);
  if (price) rows.push(['Cost', price]);
  rows.push(['Players', joinNames(recipient.playerNames)]);

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;line-height:1.5;">
      <p>Hi ${escapeHtml(recipient.parentName)},</p>
      <p>${escapeHtml(joinNames(recipient.playerNames))} ${isAre(
        recipient.playerNames
      )} signed up for <strong>${escapeHtml(session.title)}</strong>.</p>
      <table style="border-collapse:collapse;margin:16px 0;">${rowsHtml}</table>
      <p>The calendar invite is attached. Reply to this email with any questions.</p>
      <p style="margin-top:24px;">See you out there,<br/>David's Soccer Training</p>
    </div>
  `.trim();
}

export function buildSignupEmailText(
  session: GroupSessionDetails,
  recipient: NotifyRecipient
): string {
  const price = formatPrice(session.price);
  const lines = [
    `Hi ${recipient.parentName},`,
    '',
    `${joinNames(recipient.playerNames)} ${isAre(recipient.playerNames)} signed up for ${
      session.title
    }.`,
    '',
    `When: ${formatSessionWhen(session)}`,
  ];
  if (session.location) lines.push(`Where: ${session.location}`);
  if (price) lines.push(`Cost: ${price}`);
  lines.push('', 'The calendar invite is attached. Reply with any questions.', '', "David's Soccer Training");

  return lines.join('\n');
}

export async function getGroupSessionDetails(
  groupSessionId: string | number
): Promise<GroupSessionDetails | null> {
  const result = await query(
    `SELECT id, title, session_date, session_date_end, location, price
     FROM group_sessions
     WHERE id = $1`,
    [groupSessionId]
  );
  return (result.rows[0] as GroupSessionDetails | undefined) ?? null;
}

/**
 * Texts and emails each family about their signup. Never throws — a failed
 * send is recorded in `problems` so the caller can show it without the whole
 * add appearing to have failed.
 */
export async function notifyGroupSessionSignups(
  groupSessionId: string | number,
  recipients: NotifyRecipient[]
): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { emailed: 0, texted: 0, problems: [] };
  if (recipients.length === 0) return outcome;

  const session = await getGroupSessionDetails(groupSessionId);
  if (!session) {
    outcome.problems.push('Group session not found — nobody was notified.');
    return outcome;
  }

  const organizerEmail = process.env.GMAIL_USER_GROUPS || 'noreply@davidssoccertraining.com';
  const ics = buildGroupSessionIcs(session, organizerEmail);

  for (const recipient of recipients) {
    if (recipient.email) {
      try {
        await sendEmail({
          to: recipient.email,
          subject: `You're signed up: ${session.title}`,
          html: buildSignupEmailHtml(session, recipient),
          text: buildSignupEmailText(session, recipient),
          icalEvent: {
            filename: 'group-training.ics',
            method: 'REQUEST',
            content: ics,
          },
        });
        outcome.emailed += 1;
      } catch (error) {
        console.error('Group signup email failed', { parentId: recipient.parentId, error });
        outcome.problems.push(`Email to ${recipient.parentName} failed`);
      }
    } else {
      outcome.problems.push(`${recipient.parentName} has no email on file`);
    }

    if (recipient.phone) {
      try {
        const result = await sendSmsViaTwilio(recipient.phone, buildSignupSms(session, recipient));
        if (result.ok) {
          outcome.texted += 1;
        } else {
          outcome.problems.push(`Text to ${recipient.parentName} failed: ${result.error}`);
        }
      } catch (error) {
        console.error('Group signup SMS failed', { parentId: recipient.parentId, error });
        outcome.problems.push(`Text to ${recipient.parentName} failed`);
      }
    } else {
      outcome.problems.push(`${recipient.parentName} has no phone on file`);
    }
  }

  return outcome;
}
