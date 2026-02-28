#!/usr/bin/env tsx
import { config } from 'dotenv';
import { JWT, OAuth2Client } from 'google-auth-library';

config({ path: '.env.local' });
config({ path: '.env' });

interface CalendarDetails {
  id: string;
  summary?: string;
  timeZone?: string;
}

interface CalendarEventList {
  items?: Array<{
    summary?: string;
    status?: string;
    start?: { dateTime?: string; date?: string };
  }>;
}

function getCalendarIds(): string[] {
  const ids: string[] = [];

  const privateId = (process.env.GOOGLE_PRIVATE_CALENDAR_ID || '').trim();
  const packageId = (process.env.GOOGLE_PACKAGE_CALENDAR_ID || '').trim();
  if (privateId) ids.push(privateId);
  if (packageId) ids.push(packageId);

  const fromSingle = (process.env.GOOGLE_CALENDAR_ID || '').trim();
  if (fromSingle) ids.push(fromSingle);

  const fromMany = (process.env.GOOGLE_CALENDAR_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  ids.push(...fromMany);

  return [...new Set(ids)];
}

function requireEnv(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env.local/.env`);
  }
  return value;
}

async function getAccessToken(): Promise<{ token: string; mode: string }> {
  const oauthClientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const oauthClientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const oauthRefreshToken = (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();

  if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
    const redirectUri =
      (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim() || 'http://localhost:5055/oauth2callback';

    const oauth = new OAuth2Client({
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      redirectUri,
    });
    oauth.setCredentials({ refresh_token: oauthRefreshToken });

    const tokenResponse = await oauth.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token || null;
    if (!token) {
      throw new Error('Could not get Google access token via OAuth refresh token.');
    }

    return { token, mode: 'oauth_user' };
  }

  const clientEmail = requireEnv('GOOGLE_CLIENT_EMAIL');
  const privateKey = requireEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');

  const jwt = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  const tokenResponse = await jwt.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token || null;
  if (!token) {
    throw new Error('Could not get Google access token from service account.');
  }

  return { token, mode: 'service_account' };
}

async function googleGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const pretty = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`GET ${path} failed (${response.status}): ${pretty}`);
  }

  return payload as T;
}

function formatStart(event: { start?: { dateTime?: string; date?: string } }): string {
  const value = event.start?.dateTime || event.start?.date;
  if (!value) return 'No start time';
  return value;
}

async function main() {
  const calendarIds = getCalendarIds();

  if (!calendarIds.length) {
    throw new Error('Set GOOGLE_PRIVATE_CALENDAR_ID/GOOGLE_PACKAGE_CALENDAR_ID or GOOGLE_CALENDAR_ID(S)');
  }

  const { token, mode } = await getAccessToken();

  console.log(`Auth mode: ${mode}`);
  console.log(`Found ${calendarIds.length} calendar(s)\n`);

  for (const calendarId of calendarIds) {
    try {
      const details = await googleGet<CalendarDetails>(
        token,
        `/calendars/${encodeURIComponent(calendarId)}`
      );

      const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '5',
        timeMin: new Date().toISOString(),
      });

      const events = await googleGet<CalendarEventList>(
        token,
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
      );

      console.log(`Calendar: ${details.summary || '(no title)'}`);
      console.log(`ID: ${details.id}`);
      console.log(`Timezone: ${details.timeZone || 'unknown'}`);
      console.log('Upcoming events:');

      if (!events.items || events.items.length === 0) {
        console.log('  - none');
      } else {
        for (const item of events.items) {
          console.log(
            `  - ${formatStart(item)} | ${item.summary || '(no title)'} | ${item.status || 'unknown'}`
          );
        }
      }

      console.log('');
    } catch (error) {
      console.error(`Calendar failed: ${calendarId}`);
      console.error(error instanceof Error ? error.message : String(error));
      console.log('');
    }
  }
}

main().catch((error) => {
  console.error('test-google-calendars failed:', error);
  process.exit(1);
});
