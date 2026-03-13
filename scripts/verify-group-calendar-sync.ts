import 'dotenv/config';
import { OAuth2Client } from 'google-auth-library';
import { query } from '@/lib/db';
import {
  removeGroupSessionFromGoogleCalendars,
  syncGroupSessionToGoogleCalendars,
} from '@/lib/google-calendar';

interface GroupCalendarMappingRow {
  google_event_id: string;
}

interface GoogleEventResponse {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    timeZone?: string;
  };
}

function buildLongLinks(prefix: string, count: number): string {
  const links: string[] = [];
  for (let i = 0; i < count; i += 1) {
    links.push(`https://example.com/${prefix}/${i}?a=1&b=2&c=3`);
  }
  return links.join('\n');
}

async function getOauthToken(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '';
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:5055/oauth2callback';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing OAuth env vars required for verification.');
  }

  const client = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  });
  client.setCredentials({ refresh_token: refreshToken });

  const accessToken = await client.getAccessToken();
  const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;
  if (!token) throw new Error('Failed to obtain Google OAuth token.');
  return token;
}

async function fetchGoogleEvent(
  calendarId: string,
  eventId: string,
  token: string
): Promise<{ status: number; payload: GoogleEventResponse }> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  const payload = (await response.json()) as GoogleEventResponse;
  return { status: response.status, payload };
}

async function main(): Promise<void> {
  const calendarId = (process.env.GOOGLE_GROUP_CALENDAR_ID || '').trim();
  if (!calendarId) throw new Error('GOOGLE_GROUP_CALENDAR_ID is not configured.');

  const longDescriptionA = buildLongLinks('verify-a', 500);
  const longDescriptionB = buildLongLinks('verify-b', 600);

  const insertResult = await query(
    `INSERT INTO group_sessions (
      title,
      description,
      image_url,
      session_date,
      session_date_end,
      location,
      price,
      curriculum,
      max_players
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      'Calendar Verify 7-10',
      longDescriptionA,
      'https://example.com/verify-image.png',
      '2026-03-20T23:30:00.000Z',
      '2026-03-21T00:45:00.000Z',
      'Verification Field',
      50,
      'Verification Curriculum',
      12,
    ]
  );

  const groupSessionId = Number(insertResult.rows[0]?.id);
  if (!Number.isFinite(groupSessionId)) throw new Error('Failed to create verification group session.');

  const token = await getOauthToken();
  try {
    await syncGroupSessionToGoogleCalendars(groupSessionId);

    const mappingAfterCreate = await query(
      `SELECT google_event_id
       FROM crm_group_session_google_events
       WHERE group_session_id = $1
       LIMIT 1`,
      [groupSessionId]
    );
    const googleEventId = (mappingAfterCreate.rows[0] as GroupCalendarMappingRow | undefined)?.google_event_id;
    if (!googleEventId) throw new Error('No Google mapping found after create sync.');

    const createdEvent = await fetchGoogleEvent(calendarId, googleEventId, token);
    if (createdEvent.status !== 200) {
      throw new Error(`Failed to fetch created Google event (status ${createdEvent.status}).`);
    }
    console.log('Create sync verified:', {
      groupSessionId,
      googleEventId,
      summary: createdEvent.payload.summary,
      start: createdEvent.payload.start?.dateTime,
      descriptionLength: createdEvent.payload.description?.length ?? 0,
    });

    await query(
      `UPDATE group_sessions
       SET title = $1, description = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      ['Calendar Verify 7-10 Updated', longDescriptionB, groupSessionId]
    );

    await syncGroupSessionToGoogleCalendars(groupSessionId);
    const updatedEvent = await fetchGoogleEvent(calendarId, googleEventId, token);
    if (updatedEvent.status !== 200) {
      throw new Error(`Failed to fetch updated Google event (status ${updatedEvent.status}).`);
    }
    console.log('Edit sync verified:', {
      summary: updatedEvent.payload.summary,
      descriptionLength: updatedEvent.payload.description?.length ?? 0,
    });

    await removeGroupSessionFromGoogleCalendars(groupSessionId);
    const deletedEvent = await fetchGoogleEvent(calendarId, googleEventId, token);
    const deletedSuccessfully =
      deletedEvent.status === 404 || deletedEvent.payload.status === 'cancelled';
    if (!deletedSuccessfully) {
      throw new Error(
        `Expected deleted Google event to return 404 or cancelled status, got HTTP ${deletedEvent.status} and event status "${deletedEvent.payload.status}".`
      );
    }
    console.log('Delete sync verified:', {
      status: deletedEvent.status,
      eventStatus: deletedEvent.payload.status,
    });
  } finally {
    await query('DELETE FROM crm_group_session_google_events WHERE group_session_id = $1', [groupSessionId]);
    await query('DELETE FROM group_sessions WHERE id = $1', [groupSessionId]);
  }
}

main().catch((error) => {
  console.error('verify-group-calendar-sync failed:', error);
  process.exit(1);
});
