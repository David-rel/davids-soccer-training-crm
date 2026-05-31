import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { JWT, OAuth2Client } from 'google-auth-library';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const preferredRegion = 'iad1';

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const ARIZONA_TIMEZONE = 'America/Phoenix';

// Possible column name variants for the booking requests table
const NAME_COLUMN_CANDIDATES = ['name', 'contact_name', 'customer_name', 'client_name', 'full_name'];
const DATE_COLUMN_CANDIDATES = ['requested_date', 'session_date', 'requested_at', 'date', 'start_time', 'start_at', 'requested_start'];
const END_DATE_COLUMN_CANDIDATES = ['requested_end', 'end_time', 'end_at', 'requested_end_date'];
const STATUS_COLUMN_CANDIDATES = ['status', 'request_status', 'state'];

interface BookingRequestColumn {
  column_name: string;
}

interface BookingRequest {
  id: number;
  contact_name: string;
  session_date: string | Date | null;
  session_end_date: string | Date | null;
  status: string | null;
}

interface TableColumns {
  nameCol: string | null;
  dateCol: string | null;
  endDateCol: string | null;
  statusCol: string | null;
  allColumns: string[];
}

async function getTableColumns(): Promise<TableColumns> {
  const result = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'session_booking_requests'
    ORDER BY ordinal_position
  `);

  const allColumns: string[] = result.rows.map((r: BookingRequestColumn) => r.column_name);

  const nameCol = NAME_COLUMN_CANDIDATES.find((c) => allColumns.includes(c)) ?? null;
  const dateCol = DATE_COLUMN_CANDIDATES.find((c) => allColumns.includes(c)) ?? null;
  const endDateCol = END_DATE_COLUMN_CANDIDATES.find((c) => allColumns.includes(c)) ?? null;
  const statusCol = STATUS_COLUMN_CANDIDATES.find((c) => allColumns.includes(c)) ?? null;

  return { nameCol, dateCol, endDateCol, statusCol, allColumns };
}

async function ensureTrackingTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS crm_booking_request_calendar_events (
      id BIGSERIAL PRIMARY KEY,
      booking_request_id BIGINT NOT NULL UNIQUE,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getCalendarConfig() {
  const privateCalendarId = (process.env.GOOGLE_PRIVATE_CALENDAR_ID || '').trim();
  if (!privateCalendarId) return null;

  const oauthClientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const oauthClientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const oauthRefreshToken = (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  const serviceClientEmail = (process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const servicePrivateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || '';

  if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
    return {
      calendarId: privateCalendarId,
      auth: { kind: 'oauth' as const, oauthClientId, oauthClientSecret, oauthRefreshToken },
    };
  } else if (serviceClientEmail && servicePrivateKeyRaw) {
    return {
      calendarId: privateCalendarId,
      auth: {
        kind: 'service' as const,
        clientEmail: serviceClientEmail,
        privateKey: servicePrivateKeyRaw.replace(/\\n/g, '\n'),
      },
    };
  }

  return null;
}

async function getAccessToken(config: Awaited<ReturnType<typeof getCalendarConfig>>): Promise<string | null> {
  if (!config) return null;
  try {
    if (config.auth.kind === 'oauth') {
      const client = new OAuth2Client({
        clientId: config.auth.oauthClientId,
        clientSecret: config.auth.oauthClientSecret,
        redirectUri: 'http://localhost:5055/oauth2callback',
      });
      client.setCredentials({ refresh_token: config.auth.oauthRefreshToken });
      const { token } = await client.getAccessToken();
      return token ?? null;
    } else {
      const jwt = new JWT({
        email: config.auth.clientEmail,
        key: config.auth.privateKey,
        scopes: [GOOGLE_CALENDAR_SCOPE],
      });
      const { token } = await jwt.getAccessToken();
      return token ?? null;
    }
  } catch (error) {
    console.error('Failed to get Google Calendar access token:', error);
    return null;
  }
}

async function createCalendarEvent(
  token: string,
  calendarId: string,
  summary: string,
  startIso: string,
  endIso: string,
  isAllDay: boolean
): Promise<string | null> {
  const eventBody = isAllDay
    ? {
        summary,
        start: { date: startIso },
        end: { date: endIso },
        description: 'Auto-created from pending booking request.',
      }
    : {
        summary,
        start: { dateTime: startIso, timeZone: ARIZONA_TIMEZONE },
        end: { dateTime: endIso, timeZone: ARIZONA_TIMEZONE },
        description: 'Auto-created from pending booking request.',
      };

  const response = await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(`Failed to create calendar event (${response.status}): ${text.slice(0, 300)}`);
    return null;
  }

  const data = (await response.json()) as { id?: string };
  return data.id ?? null;
}

async function deleteCalendarEvent(
  token: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await fetch(
    `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
}

function toDateTimeIso(value: string | Date | null, offsetHours = 0): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    if (offsetHours) d.setHours(d.getHours() + offsetHours);
    return d.toISOString();
  } catch {
    return null;
  }
}

function toDateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function tomorrowDateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const cronHeader = request.headers.get('x-vercel-cron');
    const authHeader = request.headers.get('authorization');
    const isVercelCron = cronHeader === '1';
    const isManualWithSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isVercelCron && !isManualWithSecret) {
      return new Response('Unauthorized', { status: 401 });
    }

    await ensureTrackingTable();

    // Discover table columns
    const cols = await getTableColumns();

    if (cols.allColumns.length === 0) {
      return jsonResponse({
        success: false,
        message: 'session_booking_requests table not found',
      });
    }

    if (!cols.nameCol || !cols.dateCol) {
      return jsonResponse({
        success: false,
        message: 'Could not identify name/date columns',
        discoveredColumns: cols.allColumns,
      });
    }

    const calendarConfig = await getCalendarConfig();
    const token = calendarConfig ? await getAccessToken(calendarConfig) : null;

    // Build pending query — fetch requests that aren't completed/cancelled and
    // don't already have a tracked calendar event.
    const statusFilter = cols.statusCol
      ? `AND LOWER(${cols.statusCol}::text) NOT IN ('completed', 'cancelled', 'rejected', 'done')`
      : '';

    const endDateSelect = cols.endDateCol
      ? `${cols.endDateCol} AS session_end_date`
      : 'NULL AS session_end_date';

    const statusSelect = cols.statusCol ? `${cols.statusCol} AS status` : 'NULL AS status';

    const pendingResult = await query(`
      SELECT
        r.id,
        r.${cols.nameCol} AS contact_name,
        r.${cols.dateCol} AS session_date,
        ${endDateSelect.replace('r.', 'r.')},
        ${statusSelect.replace('r.', 'r.')}
      FROM session_booking_requests r
      LEFT JOIN crm_booking_request_calendar_events t ON t.booking_request_id = r.id
      WHERE t.id IS NULL
        ${statusFilter}
    `);

    const pendingRequests: BookingRequest[] = pendingResult.rows;

    // Cleanup: delete calendar events for requests that are now completed/cancelled
    let cleanedUp = 0;
    if (token && calendarConfig && cols.statusCol) {
      const completedResult = await query(`
        SELECT t.booking_request_id, t.google_event_id, t.calendar_id
        FROM crm_booking_request_calendar_events t
        JOIN session_booking_requests r ON r.id = t.booking_request_id
        WHERE LOWER(r.${cols.statusCol}::text) IN ('completed', 'cancelled', 'rejected', 'done')
      `);

      for (const row of completedResult.rows) {
        await deleteCalendarEvent(token, row.calendar_id, row.google_event_id);
        await query(
          `DELETE FROM crm_booking_request_calendar_events WHERE booking_request_id = $1`,
          [row.booking_request_id]
        );
        cleanedUp++;
      }
    }

    // Create calendar events for pending requests
    let created = 0;
    let skipped = 0;
    const details: Array<{ id: number; name: string; result: string }> = [];

    for (const req of pendingRequests) {
      const name = (req.contact_name || 'Unknown').trim();
      const summary = `REQUESTED TIME SLOT FOR: ${name}`;

      if (!token || !calendarConfig) {
        details.push({ id: req.id, name, result: 'skipped_no_calendar_config' });
        skipped++;
        continue;
      }

      const startIso = toDateTimeIso(req.session_date);
      const isAllDay = !startIso;

      let eventStart: string;
      let eventEnd: string;

      if (isAllDay) {
        eventStart = toDateOnly(req.session_date) ?? new Date().toISOString().slice(0, 10);
        eventEnd = tomorrowDateOnly(req.session_date) ?? eventStart;
      } else {
        eventStart = startIso!;
        // End = provided end time, or start + 1 hour
        eventEnd = toDateTimeIso(req.session_end_date) ?? toDateTimeIso(req.session_date, 1)!;
      }

      const googleEventId = await createCalendarEvent(
        token,
        calendarConfig.calendarId,
        summary,
        eventStart,
        eventEnd,
        isAllDay
      );

      if (googleEventId) {
        await query(
          `INSERT INTO crm_booking_request_calendar_events (booking_request_id, google_event_id, calendar_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (booking_request_id) DO NOTHING`,
          [req.id, googleEventId, calendarConfig.calendarId]
        );
        created++;
        details.push({ id: req.id, name, result: 'created' });
      } else {
        skipped++;
        details.push({ id: req.id, name, result: 'failed_to_create_event' });
      }
    }

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      discoveredColumns: cols,
      results: {
        pendingFound: pendingRequests.length,
        calendarEventsCreated: created,
        calendarEventsCleanedUp: cleanedUp,
        skipped,
        details,
      },
    });
  } catch (error) {
    console.error('Error in booking-requests-calendar cron:', error);
    return errorResponse('Failed to run booking requests calendar sync');
  }
}

// Support GET for easy manual testing
export async function GET(request: Request) {
  const cronHeader = request.headers.get('x-vercel-cron');
  const authHeader = request.headers.get('authorization');
  const isManualWithSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (cronHeader === '1' || isManualWithSecret) {
    const headers = new Headers();
    if (cronHeader === '1') headers.set('x-vercel-cron', '1');
    if (isManualWithSecret && authHeader) headers.set('authorization', authHeader);
    return POST(new Request(request.url, { method: 'POST', headers }));
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized - add ?secret=YOUR_CRON_SECRET to test', { status: 401 });
  }

  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
  );
}
