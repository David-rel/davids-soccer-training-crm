import { JWT, OAuth2Client } from 'google-auth-library';
import { query } from '@/lib/db';
import { ensureFirstSessionCalendarColumns } from '@/lib/first-session-calendar-fields';
import { ensureSessionCalendarColumns, parseGuestEmails } from '@/lib/session-calendar-fields';

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const ARIZONA_TIMEZONE = 'America/Phoenix';

let jwtClient: JWT | null = null;
let oauthClient: OAuth2Client | null = null;
let ensureTablePromise: Promise<void> | null = null;
let hasLoggedMissingConfig = false;
let hasLoggedOauthFallback = false;
let forceServiceAccountFallback = false;

type GoogleAuthConfig =
  | {
      kind: 'oauth_user';
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      redirectUri: string;
    }
  | {
      kind: 'service_account';
      clientEmail: string;
      privateKey: string;
    };

interface GoogleCalendarConfig {
  privateCalendarId: string;
  packageCalendarId: string;
  managedCalendarIds: string[];
  auth: GoogleAuthConfig;
}

interface SessionSyncRow {
  id: number;
  session_date: string | Date;
  start_arizona_local: string;
  end_arizona_local: string;
  title: string | null;
  location: string | null;
  notes: string | null;
  status: string | null;
  cancelled: boolean | null;
  package_id: number | null;
  guest_emails: string[] | null;
  send_email_updates: boolean | null;
  parent_name: string;
  player_names: string[];
}

interface FirstSessionSyncRow {
  id: number;
  session_date: string | Date;
  start_arizona_local: string;
  end_arizona_local: string;
  title: string | null;
  location: string | null;
  notes: string | null;
  status: string | null;
  cancelled: boolean | null;
  parent_name: string;
  parent_email: string | null;
  guest_emails: string[] | null;
  send_email_updates: boolean | null;
  player_names: string[];
}

interface GoogleSessionEventMapping {
  calendar_id: string;
  google_event_id: string;
}

interface GoogleCalendarEventResponse {
  id?: string;
}

interface GoogleCalendarEventListResponse {
  items?: Array<{
    id?: string;
    status?: string;
  }>;
  nextPageToken?: string;
}

class GoogleCalendarApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.status = status;
  }
}

type GoogleSendUpdatesMode = 'all' | 'none';

interface GoogleSyncOptions {
  sendUpdates?: GoogleSendUpdatesMode;
}

interface AccessTokenOptions {
  disallowOauthFallback?: boolean;
}

function parseCalendarIdList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getGoogleCalendarConfig(): GoogleCalendarConfig | null {
  const listIds = parseCalendarIdList(process.env.GOOGLE_CALENDAR_IDS);
  const fallbackSingleId = (process.env.GOOGLE_CALENDAR_ID || '').trim();

  const privateCalendarId =
    (process.env.GOOGLE_PRIVATE_CALENDAR_ID || '').trim() ||
    listIds[0] ||
    fallbackSingleId;

  const packageCalendarId =
    (process.env.GOOGLE_PACKAGE_CALENDAR_ID || '').trim() ||
    listIds[1] ||
    privateCalendarId ||
    fallbackSingleId;

  if (!privateCalendarId) {
    return null;
  }

  const managedCalendarIds = [...new Set([privateCalendarId, packageCalendarId].filter(Boolean))];

  const oauthClientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const oauthClientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const oauthRefreshToken = (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  const oauthRedirectUri =
    (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim() || 'http://localhost:5055/oauth2callback';

  const serviceClientEmail = (process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const servicePrivateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || '';

  let auth: GoogleAuthConfig | null = null;

  if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
    auth = {
      kind: 'oauth_user',
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      refreshToken: oauthRefreshToken,
      redirectUri: oauthRedirectUri,
    };
  } else if (serviceClientEmail && servicePrivateKeyRaw) {
    auth = {
      kind: 'service_account',
      clientEmail: serviceClientEmail,
      privateKey: servicePrivateKeyRaw.replace(/\\n/g, '\n'),
    };
  }

  if (!auth) {
    return null;
  }

  return {
    privateCalendarId,
    packageCalendarId,
    managedCalendarIds,
    auth,
  };
}

function getServiceAccountAuthFromEnv(): Extract<GoogleAuthConfig, { kind: 'service_account' }> | null {
  const serviceClientEmail = (process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const servicePrivateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || '';
  if (!serviceClientEmail || !servicePrivateKeyRaw) return null;
  return {
    kind: 'service_account',
    clientEmail: serviceClientEmail,
    privateKey: servicePrivateKeyRaw.replace(/\\n/g, '\n'),
  };
}

function isInvalidGrantError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  return message.toLowerCase().includes('invalid_grant');
}

function logMissingConfigOnce(): void {
  if (hasLoggedMissingConfig) return;

  console.log(
    'Google Calendar sync disabled: set GOOGLE_PRIVATE_CALENDAR_ID/GOOGLE_PACKAGE_CALENDAR_ID plus auth (preferred OAuth: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN; fallback service account: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY).'
  );
  hasLoggedMissingConfig = true;
}

function getJwtClient(auth: Extract<GoogleAuthConfig, { kind: 'service_account' }>): JWT {
  if (!jwtClient) {
    jwtClient = new JWT({
      email: auth.clientEmail,
      key: auth.privateKey,
      scopes: [GOOGLE_CALENDAR_SCOPE],
    });
  }
  return jwtClient;
}

function getOauthClient(auth: Extract<GoogleAuthConfig, { kind: 'oauth_user' }>): OAuth2Client {
  if (!oauthClient) {
    oauthClient = new OAuth2Client({
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      redirectUri: auth.redirectUri,
    });
  }
  oauthClient.setCredentials({ refresh_token: auth.refreshToken });
  return oauthClient;
}

async function getAccessToken(
  config: GoogleCalendarConfig,
  options: AccessTokenOptions = {}
): Promise<string> {
  let tokenResponse: string | { token?: string | null } | null;
  const disallowOauthFallback = options.disallowOauthFallback === true;

  if (config.auth.kind === 'oauth_user' && !forceServiceAccountFallback) {
    try {
      tokenResponse = await getOauthClient(config.auth).getAccessToken();
    } catch (error) {
      if (!isInvalidGrantError(error)) throw error;
      if (disallowOauthFallback) {
        throw new Error(
          'Google OAuth refresh token is invalid. Guest email updates require OAuth. Renew GOOGLE_OAUTH_REFRESH_TOKEN.'
        );
      }

      const serviceFallback = getServiceAccountAuthFromEnv();
      if (!serviceFallback) throw error;
      forceServiceAccountFallback = true;

      if (!hasLoggedOauthFallback) {
        console.warn(
          'Google OAuth refresh token returned invalid_grant; falling back to service account credentials.'
        );
        hasLoggedOauthFallback = true;
      }
      tokenResponse = await getJwtClient(serviceFallback).getAccessToken();
    }
  } else {
    if (config.auth.kind === 'service_account') {
      tokenResponse = await getJwtClient(config.auth).getAccessToken();
    } else {
      const serviceFallback = getServiceAccountAuthFromEnv();
      if (!serviceFallback) {
        throw new Error(
          'OAuth refresh token is invalid and no service account fallback is configured.'
        );
      }
      tokenResponse = await getJwtClient(serviceFallback).getAccessToken();
    }
  }

  const token =
    typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token || null;

  if (!token) {
    throw new Error('Failed to obtain Google Calendar access token.');
  }

  return token;
}

async function ensureGoogleEventsTable(): Promise<void> {
  if (ensureTablePromise) {
    await ensureTablePromise;
    return;
  }

  ensureTablePromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS crm_session_google_events (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES crm_sessions(id) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        google_event_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, calendar_id)
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_crm_session_google_events_session_id
      ON crm_session_google_events(session_id)
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS crm_first_session_google_events (
        id BIGSERIAL PRIMARY KEY,
        first_session_id BIGINT NOT NULL REFERENCES crm_first_sessions(id) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        google_event_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(first_session_id, calendar_id)
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_crm_first_session_google_events_first_session_id
      ON crm_first_session_google_events(first_session_id)
    `);
  })().catch((error) => {
    ensureTablePromise = null;
    throw error;
  });

  await ensureTablePromise;
}

async function getSessionForSync(sessionId: string | number): Promise<SessionSyncRow | null> {
  const result = await query(
    `SELECT
       s.id,
       s.session_date,
       to_char(((s.session_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Phoenix'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS start_arizona_local,
       to_char((((COALESCE(s.session_end_date, s.session_date + interval '60 minutes')) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Phoenix'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS end_arizona_local,
       s.title,
       s.location,
       s.notes,
       s.status,
       s.cancelled,
       s.package_id,
       s.guest_emails,
       s.send_email_updates,
       p.name AS parent_name,
       COALESCE(ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL), '{}') AS player_names
     FROM crm_sessions s
     JOIN crm_parents p ON p.id = s.parent_id
     LEFT JOIN crm_session_players sp ON sp.session_id = s.id
     LEFT JOIN crm_players pl ON pl.id = sp.player_id
     WHERE s.id = $1
     GROUP BY s.id, p.name`,
    [sessionId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as SessionSyncRow;
  row.player_names = Array.isArray(row.player_names) ? row.player_names.filter(Boolean) : [];
  row.guest_emails = Array.isArray(row.guest_emails) ? row.guest_emails : [];
  return row;
}

async function getFirstSessionForSync(
  firstSessionId: string | number
): Promise<FirstSessionSyncRow | null> {
  const result = await query(
    `SELECT
       fs.id,
       fs.session_date,
       to_char(((fs.session_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Phoenix'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS start_arizona_local,
       to_char((((COALESCE(fs.session_end_date, fs.session_date + interval '60 minutes')) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Phoenix'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS end_arizona_local,
       fs.title,
       fs.location,
       fs.notes,
       fs.status,
       fs.cancelled,
       p.name AS parent_name,
       p.email AS parent_email,
       fs.guest_emails,
       fs.send_email_updates,
       COALESCE(ARRAY_AGG(pl.name) FILTER (WHERE pl.name IS NOT NULL), '{}') AS player_names
     FROM crm_first_sessions fs
     JOIN crm_parents p ON p.id = fs.parent_id
     LEFT JOIN crm_first_session_players fsp ON fsp.first_session_id = fs.id
     LEFT JOIN crm_players pl ON pl.id = fsp.player_id
     WHERE fs.id = $1
     GROUP BY fs.id, p.name, p.email`,
    [firstSessionId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as FirstSessionSyncRow;
  row.player_names = Array.isArray(row.player_names) ? row.player_names.filter(Boolean) : [];
  row.guest_emails = Array.isArray(row.guest_emails) ? row.guest_emails : [];
  return row;
}

function shouldDeleteCalendarEvents(session: SessionSyncRow): boolean {
  const status = (session.status || '').toLowerCase();
  return session.cancelled === true || status === 'cancelled' || status === 'no_show';
}

function shouldDeleteFirstSessionCalendarEvents(firstSession: FirstSessionSyncRow): boolean {
  const status = (firstSession.status || '').toLowerCase();
  return firstSession.cancelled === true || status === 'cancelled' || status === 'no_show';
}

function getTargetCalendarId(session: SessionSyncRow, config: GoogleCalendarConfig): string {
  return session.package_id ? config.packageCalendarId : config.privateCalendarId;
}

function buildGoogleEventPayload(session: SessionSyncRow): Record<string, unknown> {
  if (!session.start_arizona_local || !session.end_arizona_local) {
    throw new Error(`Missing Arizona-local datetime fields for session ${session.id}`);
  }
  const sessionType = session.package_id ? 'Package Session' : 'Private Session';

  const details: string[] = [
    `Type: ${sessionType}`,
    `Parent: ${session.parent_name}`,
    `Session ID: ${session.id}`,
  ];
  if (session.player_names.length > 0) {
    details.push(`Players: ${session.player_names.join(', ')}`);
  }
  if (session.notes && session.notes.trim()) {
    details.push(`Notes: ${session.notes.trim()}`);
  }

  const attendeeEmails = parseGuestEmails(session.guest_emails || []).emails;
  const summary = session.title?.trim()
    ? session.title.trim()
    : `${sessionType}: ${session.parent_name}`;

  return {
    summary,
    description: details.join('\n'),
    location: session.location || undefined,
    start: {
      dateTime: session.start_arizona_local,
      timeZone: ARIZONA_TIMEZONE,
    },
    end: {
      dateTime: session.end_arizona_local,
      timeZone: ARIZONA_TIMEZONE,
    },
    attendees: attendeeEmails.length > 0 ? attendeeEmails.map((email) => ({ email })) : undefined,
  };
}

function buildFirstSessionGoogleEventPayload(firstSession: FirstSessionSyncRow): Record<string, unknown> {
  if (!firstSession.start_arizona_local || !firstSession.end_arizona_local) {
    throw new Error(`Missing Arizona-local datetime fields for first session ${firstSession.id}`);
  }

  const details: string[] = [
    'Type: First Session',
    `Parent: ${firstSession.parent_name}`,
    `First Session ID: ${firstSession.id}`,
  ];
  if (firstSession.player_names.length > 0) {
    details.push(`Players: ${firstSession.player_names.join(', ')}`);
  }
  if (firstSession.notes && firstSession.notes.trim()) {
    details.push(`Notes: ${firstSession.notes.trim()}`);
  }

  const attendeeCandidates = [
    ...(Array.isArray(firstSession.guest_emails) ? firstSession.guest_emails : []),
    ...(firstSession.parent_email ? [firstSession.parent_email] : []),
  ];
  const attendeeEmails = parseGuestEmails(attendeeCandidates).emails;
  const summary = firstSession.title?.trim()
    ? firstSession.title.trim()
    : `First Session: ${firstSession.parent_name}`;

  return {
    summary,
    description: details.join('\n'),
    location: firstSession.location || undefined,
    start: {
      dateTime: firstSession.start_arizona_local,
      timeZone: ARIZONA_TIMEZONE,
    },
    end: {
      dateTime: firstSession.end_arizona_local,
      timeZone: ARIZONA_TIMEZONE,
    },
    attendees: attendeeEmails.length > 0 ? attendeeEmails.map((email) => ({ email })) : undefined,
  };
}

async function googleCalendarRequest<T>(
  config: GoogleCalendarConfig,
  method: string,
  path: string,
  body?: unknown,
  accessTokenOptions: AccessTokenOptions = {}
): Promise<T> {
  const token = await getAccessToken(config, accessTokenOptions);
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const apiMessage =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error?: { message?: string } }).error?.message === 'string'
        ? (payload as { error: { message: string } }).error.message
        : rawText.slice(0, 300);

    throw new GoogleCalendarApiError(
      response.status,
      `Google Calendar API ${method} ${path} failed (${response.status}): ${apiMessage}`
    );
  }

  return payload as T;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof GoogleCalendarApiError && error.status === 404;
}

function isAttendeePermissionError(error: unknown): boolean {
  if (!(error instanceof GoogleCalendarApiError)) return false;
  const message = error.message.toLowerCase();
  return (
    error.status === 403 &&
    (message.includes('cannot invite attendees') ||
      message.includes('domain-wide delegation') ||
      message.includes('forbidden for this calendar'))
  );
}

function withoutAttendees(payload: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...payload };
  delete clone.attendees;
  return clone;
}

function withSendUpdates(path: string, sendUpdates: GoogleSendUpdatesMode): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}sendUpdates=${sendUpdates}`;
}

function getSessionSendUpdatesMode(
  session: Pick<SessionSyncRow, 'send_email_updates'>,
  requested?: GoogleSendUpdatesMode
): GoogleSendUpdatesMode {
  if (requested) return requested;
  return session.send_email_updates ? 'all' : 'none';
}

function getFirstSessionSendUpdatesMode(
  firstSession: Pick<FirstSessionSyncRow, 'send_email_updates'>,
  requested?: GoogleSendUpdatesMode
): GoogleSendUpdatesMode {
  if (requested) return requested;
  return firstSession.send_email_updates ? 'all' : 'none';
}

async function getStoredSessionSendUpdatesMode(
  sessionId: string | number,
  requested?: GoogleSendUpdatesMode
): Promise<GoogleSendUpdatesMode> {
  if (requested) return requested;

  const result = await query(
    `SELECT send_email_updates
     FROM crm_sessions
     WHERE id = $1
     LIMIT 1`,
    [sessionId]
  );
  const row = result.rows[0] as { send_email_updates?: boolean } | undefined;
  return row?.send_email_updates ? 'all' : 'none';
}

async function getStoredFirstSessionSendUpdatesMode(
  firstSessionId: string | number,
  requested?: GoogleSendUpdatesMode
): Promise<GoogleSendUpdatesMode> {
  if (requested) return requested;

  const result = await query(
    `SELECT send_email_updates
     FROM crm_first_sessions
     WHERE id = $1
     LIMIT 1`,
    [firstSessionId]
  );
  const row = result.rows[0] as { send_email_updates?: boolean } | undefined;
  return row?.send_email_updates ? 'all' : 'none';
}

async function getSessionMappings(sessionId: string | number): Promise<GoogleSessionEventMapping[]> {
  const result = await query(
    `SELECT calendar_id, google_event_id
     FROM crm_session_google_events
     WHERE session_id = $1`,
    [sessionId]
  );

  return result.rows as GoogleSessionEventMapping[];
}

async function getFirstSessionMappings(
  firstSessionId: string | number
): Promise<GoogleSessionEventMapping[]> {
  const result = await query(
    `SELECT calendar_id, google_event_id
     FROM crm_first_session_google_events
     WHERE first_session_id = $1`,
    [firstSessionId]
  );

  return result.rows as GoogleSessionEventMapping[];
}

async function getSessionMapping(
  sessionId: string | number,
  calendarId: string
): Promise<GoogleSessionEventMapping | null> {
  const result = await query(
    `SELECT calendar_id, google_event_id
     FROM crm_session_google_events
     WHERE session_id = $1 AND calendar_id = $2
     LIMIT 1`,
    [sessionId, calendarId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0] as GoogleSessionEventMapping;
}

async function getFirstSessionMapping(
  firstSessionId: string | number,
  calendarId: string
): Promise<GoogleSessionEventMapping | null> {
  const result = await query(
    `SELECT calendar_id, google_event_id
     FROM crm_first_session_google_events
     WHERE first_session_id = $1 AND calendar_id = $2
     LIMIT 1`,
    [firstSessionId, calendarId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0] as GoogleSessionEventMapping;
}

async function upsertMapping(
  sessionId: string | number,
  calendarId: string,
  googleEventId: string
): Promise<void> {
  await query(
    `INSERT INTO crm_session_google_events (session_id, calendar_id, google_event_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, calendar_id)
     DO UPDATE SET google_event_id = EXCLUDED.google_event_id, updated_at = CURRENT_TIMESTAMP`,
    [sessionId, calendarId, googleEventId]
  );
}

async function upsertFirstSessionMapping(
  firstSessionId: string | number,
  calendarId: string,
  googleEventId: string
): Promise<void> {
  await query(
    `INSERT INTO crm_first_session_google_events (first_session_id, calendar_id, google_event_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (first_session_id, calendar_id)
     DO UPDATE SET google_event_id = EXCLUDED.google_event_id, updated_at = CURRENT_TIMESTAMP`,
    [firstSessionId, calendarId, googleEventId]
  );
}

async function deleteMapping(sessionId: string | number, calendarId?: string): Promise<void> {
  if (calendarId) {
    await query(
      `DELETE FROM crm_session_google_events
       WHERE session_id = $1 AND calendar_id = $2`,
      [sessionId, calendarId]
    );
    return;
  }

  await query(
    `DELETE FROM crm_session_google_events
     WHERE session_id = $1`,
    [sessionId]
  );
}

async function deleteFirstSessionMapping(
  firstSessionId: string | number,
  calendarId?: string
): Promise<void> {
  if (calendarId) {
    await query(
      `DELETE FROM crm_first_session_google_events
       WHERE first_session_id = $1 AND calendar_id = $2`,
      [firstSessionId, calendarId]
    );
    return;
  }

  await query(
    `DELETE FROM crm_first_session_google_events
     WHERE first_session_id = $1`,
    [firstSessionId]
  );
}

async function createEvent(
  config: GoogleCalendarConfig,
  calendarId: string,
  payload: Record<string, unknown>,
  sendUpdates: GoogleSendUpdatesMode
): Promise<string> {
  const response = await googleCalendarRequest<GoogleCalendarEventResponse>(
    config,
    'POST',
    withSendUpdates(`/calendars/${encodeURIComponent(calendarId)}/events`, sendUpdates),
    payload,
    { disallowOauthFallback: sendUpdates === 'all' }
  );

  if (!response.id) {
    throw new Error(`Google Calendar did not return event id for calendar ${calendarId}.`);
  }

  return response.id;
}

async function updateEvent(
  config: GoogleCalendarConfig,
  calendarId: string,
  eventId: string,
  payload: Record<string, unknown>,
  sendUpdates: GoogleSendUpdatesMode
): Promise<void> {
  await googleCalendarRequest<GoogleCalendarEventResponse>(
    config,
    'PATCH',
    withSendUpdates(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      sendUpdates
    ),
    payload,
    { disallowOauthFallback: sendUpdates === 'all' }
  );
}

async function deleteEvent(
  config: GoogleCalendarConfig,
  calendarId: string,
  eventId: string,
  sendUpdates: GoogleSendUpdatesMode
): Promise<void> {
  await googleCalendarRequest<unknown>(
    config,
    'DELETE',
    withSendUpdates(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      sendUpdates
    ),
    undefined,
    { disallowOauthFallback: sendUpdates === 'all' }
  );
}

async function syncEventOnCalendar(
  session: SessionSyncRow,
  config: GoogleCalendarConfig,
  calendarId: string,
  payload: Record<string, unknown>,
  sendUpdates: GoogleSendUpdatesMode
): Promise<void> {
  const mapping = await getSessionMapping(session.id, calendarId);

  if (!mapping) {
    try {
      const googleEventId = await createEvent(config, calendarId, payload, sendUpdates);
      await upsertMapping(session.id, calendarId, googleEventId);
    } catch (error) {
      if (!isAttendeePermissionError(error) || !('attendees' in payload)) throw error;
      if (sendUpdates === 'all') throw error;
      const fallbackEventId = await createEvent(
        config,
        calendarId,
        withoutAttendees(payload),
        sendUpdates
      );
      await upsertMapping(session.id, calendarId, fallbackEventId);
    }
    return;
  }

  try {
    await updateEvent(config, calendarId, mapping.google_event_id, payload, sendUpdates);
    await upsertMapping(session.id, calendarId, mapping.google_event_id);
  } catch (error) {
    if (isAttendeePermissionError(error) && 'attendees' in payload) {
      if (sendUpdates === 'all') throw error;
      await updateEvent(
        config,
        calendarId,
        mapping.google_event_id,
        withoutAttendees(payload),
        sendUpdates
      );
      await upsertMapping(session.id, calendarId, mapping.google_event_id);
      return;
    }
    if (!isNotFoundError(error)) throw error;

    try {
      const googleEventId = await createEvent(config, calendarId, payload, sendUpdates);
      await upsertMapping(session.id, calendarId, googleEventId);
    } catch (createError) {
      if (!isAttendeePermissionError(createError) || !('attendees' in payload)) throw createError;
      if (sendUpdates === 'all') throw createError;
      const fallbackEventId = await createEvent(
        config,
        calendarId,
        withoutAttendees(payload),
        sendUpdates
      );
      await upsertMapping(session.id, calendarId, fallbackEventId);
    }
  }
}

async function syncFirstSessionEventOnCalendar(
  firstSession: FirstSessionSyncRow,
  config: GoogleCalendarConfig,
  calendarId: string,
  payload: Record<string, unknown>,
  sendUpdates: GoogleSendUpdatesMode
): Promise<void> {
  const mapping = await getFirstSessionMapping(firstSession.id, calendarId);

  if (!mapping) {
    try {
      const googleEventId = await createEvent(config, calendarId, payload, sendUpdates);
      await upsertFirstSessionMapping(firstSession.id, calendarId, googleEventId);
    } catch (error) {
      if (!isAttendeePermissionError(error) || !('attendees' in payload)) throw error;
      if (sendUpdates === 'all') throw error;
      const fallbackEventId = await createEvent(
        config,
        calendarId,
        withoutAttendees(payload),
        sendUpdates
      );
      await upsertFirstSessionMapping(firstSession.id, calendarId, fallbackEventId);
    }
    return;
  }

  try {
    await updateEvent(config, calendarId, mapping.google_event_id, payload, sendUpdates);
    await upsertFirstSessionMapping(firstSession.id, calendarId, mapping.google_event_id);
  } catch (error) {
    if (isAttendeePermissionError(error) && 'attendees' in payload) {
      if (sendUpdates === 'all') throw error;
      await updateEvent(
        config,
        calendarId,
        mapping.google_event_id,
        withoutAttendees(payload),
        sendUpdates
      );
      await upsertFirstSessionMapping(firstSession.id, calendarId, mapping.google_event_id);
      return;
    }
    if (!isNotFoundError(error)) throw error;

    try {
      const googleEventId = await createEvent(config, calendarId, payload, sendUpdates);
      await upsertFirstSessionMapping(firstSession.id, calendarId, googleEventId);
    } catch (createError) {
      if (!isAttendeePermissionError(createError) || !('attendees' in payload)) throw createError;
      if (sendUpdates === 'all') throw createError;
      const fallbackEventId = await createEvent(
        config,
        calendarId,
        withoutAttendees(payload),
        sendUpdates
      );
      await upsertFirstSessionMapping(firstSession.id, calendarId, fallbackEventId);
    }
  }
}

async function removeMappingsFromOtherCalendars(
  sessionId: string | number,
  keepCalendarId: string,
  config: GoogleCalendarConfig,
  sendUpdates: GoogleSendUpdatesMode
): Promise<void> {
  const mappings = await getSessionMappings(sessionId);

  for (const mapping of mappings) {
    if (mapping.calendar_id === keepCalendarId) continue;

    try {
      await deleteEvent(config, mapping.calendar_id, mapping.google_event_id, sendUpdates);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    await deleteMapping(sessionId, mapping.calendar_id);
  }
}

async function removeFirstSessionMappingsFromOtherCalendars(
  firstSessionId: string | number,
  keepCalendarId: string,
  config: GoogleCalendarConfig,
  sendUpdates: GoogleSendUpdatesMode
): Promise<void> {
  const mappings = await getFirstSessionMappings(firstSessionId);

  for (const mapping of mappings) {
    if (mapping.calendar_id === keepCalendarId) continue;

    try {
      await deleteEvent(config, mapping.calendar_id, mapping.google_event_id, sendUpdates);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    await deleteFirstSessionMapping(firstSessionId, mapping.calendar_id);
  }
}

export async function syncSessionToGoogleCalendars(
  sessionId: string | number,
  options: GoogleSyncOptions = {}
): Promise<void> {
  const requestedSendUpdates = options.sendUpdates;
  const config = getGoogleCalendarConfig();
  if (!config) {
    logMissingConfigOnce();
    return;
  }

  await ensureSessionCalendarColumns();
  await ensureGoogleEventsTable();

  const session = await getSessionForSync(sessionId);
  if (!session) return;
  const sendUpdates = getSessionSendUpdatesMode(session, requestedSendUpdates);

  if (shouldDeleteCalendarEvents(session)) {
    await removeSessionFromGoogleCalendars(session.id, { sendUpdates });
    return;
  }

  const targetCalendarId = getTargetCalendarId(session, config);
  const payload = buildGoogleEventPayload(session);

  await syncEventOnCalendar(session, config, targetCalendarId, payload, sendUpdates);
  await removeMappingsFromOtherCalendars(session.id, targetCalendarId, config, sendUpdates);
}

export async function removeSessionFromGoogleCalendars(
  sessionId: string | number,
  options: GoogleSyncOptions = {}
): Promise<void> {
  await ensureSessionCalendarColumns();
  await ensureGoogleEventsTable();
  const sendUpdates = await getStoredSessionSendUpdatesMode(sessionId, options.sendUpdates);

  const mappings = await getSessionMappings(sessionId);
  if (mappings.length === 0) return;

  const config = getGoogleCalendarConfig();
  if (!config) {
    logMissingConfigOnce();
    return;
  }

  for (const mapping of mappings) {
    try {
      await deleteEvent(config, mapping.calendar_id, mapping.google_event_id, sendUpdates);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    await deleteMapping(sessionId, mapping.calendar_id);
  }
}

export async function syncSessionToGoogleCalendarsSafe(
  sessionId: string | number,
  context: string,
  options: GoogleSyncOptions = {}
): Promise<void> {
  try {
    await syncSessionToGoogleCalendars(sessionId, options);
  } catch (error) {
    console.error(`Google Calendar sync failed (${context})`, {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function removeSessionFromGoogleCalendarsSafe(
  sessionId: string | number,
  context: string,
  options: GoogleSyncOptions = {}
): Promise<void> {
  try {
    await removeSessionFromGoogleCalendars(sessionId, options);
  } catch (error) {
    console.error(`Google Calendar removal failed (${context})`, {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function syncFirstSessionToGoogleCalendars(
  firstSessionId: string | number,
  options: GoogleSyncOptions = {}
): Promise<void> {
  const requestedSendUpdates = options.sendUpdates;
  const config = getGoogleCalendarConfig();
  if (!config) {
    logMissingConfigOnce();
    return;
  }

  await ensureFirstSessionCalendarColumns();
  await ensureGoogleEventsTable();

  const firstSession = await getFirstSessionForSync(firstSessionId);
  if (!firstSession) return;
  const sendUpdates = getFirstSessionSendUpdatesMode(firstSession, requestedSendUpdates);

  if (shouldDeleteFirstSessionCalendarEvents(firstSession)) {
    await removeFirstSessionFromGoogleCalendars(firstSession.id, { sendUpdates });
    return;
  }

  const targetCalendarId = config.privateCalendarId;
  const payload = buildFirstSessionGoogleEventPayload(firstSession);

  await syncFirstSessionEventOnCalendar(firstSession, config, targetCalendarId, payload, sendUpdates);
  await removeFirstSessionMappingsFromOtherCalendars(
    firstSession.id,
    targetCalendarId,
    config,
    sendUpdates
  );
}

export async function removeFirstSessionFromGoogleCalendars(
  firstSessionId: string | number,
  options: GoogleSyncOptions = {}
): Promise<void> {
  await ensureFirstSessionCalendarColumns();
  await ensureGoogleEventsTable();
  const sendUpdates = await getStoredFirstSessionSendUpdatesMode(
    firstSessionId,
    options.sendUpdates
  );

  const mappings = await getFirstSessionMappings(firstSessionId);
  if (mappings.length === 0) return;

  const config = getGoogleCalendarConfig();
  if (!config) {
    logMissingConfigOnce();
    return;
  }

  for (const mapping of mappings) {
    try {
      await deleteEvent(config, mapping.calendar_id, mapping.google_event_id, sendUpdates);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    await deleteFirstSessionMapping(firstSessionId, mapping.calendar_id);
  }
}

export async function syncFirstSessionToGoogleCalendarsSafe(
  firstSessionId: string | number,
  context: string,
  options: GoogleSyncOptions = {}
): Promise<void> {
  try {
    await syncFirstSessionToGoogleCalendars(firstSessionId, options);
  } catch (error) {
    console.error(`Google Calendar first-session sync failed (${context})`, {
      firstSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function removeFirstSessionFromGoogleCalendarsSafe(
  firstSessionId: string | number,
  context: string,
  options: GoogleSyncOptions = {}
): Promise<void> {
  try {
    await removeFirstSessionFromGoogleCalendars(firstSessionId, options);
  } catch (error) {
    console.error(`Google Calendar first-session removal failed (${context})`, {
      firstSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function syncUpcomingFirstSessionsToGoogleCalendars(daysAhead = 120): Promise<{
  total: number;
  synced: number;
  failed: number;
}> {
  await ensureFirstSessionCalendarColumns();
  await ensureGoogleEventsTable();

  const result = await query(
    `SELECT id
     FROM crm_first_sessions
     WHERE session_date >= NOW() - INTERVAL '1 day'
       AND session_date <= NOW() + ($1::text || ' days')::interval
       AND (status IS NULL OR status NOT IN ('cancelled', 'completed', 'no_show'))
       AND cancelled = false
     ORDER BY session_date ASC`,
    [String(daysAhead)]
  );

  let synced = 0;
  let failed = 0;

  for (const row of result.rows as Array<{ id: number }>) {
    try {
      await syncFirstSessionToGoogleCalendars(row.id, { sendUpdates: 'none' });
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error('Failed to sync first session during bulk sync', {
        firstSessionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: result.rows.length,
    synced,
    failed,
  };
}

export async function syncUpcomingSessionsToGoogleCalendars(daysAhead = 120): Promise<{
  total: number;
  synced: number;
  failed: number;
}> {
  await ensureGoogleEventsTable();

  const result = await query(
    `SELECT id
     FROM crm_sessions
     WHERE session_date >= NOW() - INTERVAL '1 day'
       AND session_date <= NOW() + ($1::text || ' days')::interval
       AND (status IS NULL OR status NOT IN ('cancelled', 'completed', 'no_show'))
       AND cancelled = false
     ORDER BY session_date ASC`,
    [String(daysAhead)]
  );

  let synced = 0;
  let failed = 0;

  for (const row of result.rows as Array<{ id: number }>) {
    try {
      await syncSessionToGoogleCalendars(row.id, { sendUpdates: 'none' });
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error('Failed to sync session during bulk sync', {
        sessionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: result.rows.length,
    synced,
    failed,
  };
}

export async function clearFutureEventsFromManagedCalendars(
  fromDateISO?: string,
  daysAhead = 365
): Promise<{
  deleted: number;
}> {
  const config = getGoogleCalendarConfig();
  if (!config) {
    logMissingConfigOnce();
    return { deleted: 0 };
  }
  await ensureGoogleEventsTable();

  const fromDate = fromDateISO ? new Date(fromDateISO) : new Date();
  if (Number.isNaN(fromDate.getTime())) {
    throw new Error(`Invalid fromDateISO: ${fromDateISO}`);
  }
  const boundedDaysAhead = Math.max(1, Math.min(3650, Math.trunc(daysAhead)));
  const toDate = new Date(fromDate.getTime() + boundedDaysAhead * 24 * 60 * 60 * 1000);

  let deleted = 0;

  for (const calendarId of config.managedCalendarIds) {
    let pageToken: string | undefined;

    while (true) {
      const params = new URLSearchParams({
        singleEvents: 'true',
        timeMin: fromDate.toISOString(),
        timeMax: toDate.toISOString(),
        maxResults: '2500',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const list = await googleCalendarRequest<GoogleCalendarEventListResponse>(
        config,
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
      );

      const items = list.items || [];
      for (const item of items) {
        if (!item.id || item.status === 'cancelled') continue;
        await deleteEvent(config, calendarId, item.id, 'none');
        deleted += 1;
      }

      if (!list.nextPageToken) break;
      pageToken = list.nextPageToken;
    }
  }

  await query('DELETE FROM crm_session_google_events');
  await query('DELETE FROM crm_first_session_google_events');
  return { deleted };
}
