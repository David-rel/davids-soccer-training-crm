import { NextRequest } from 'next/server';
import { getClient } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { syncGroupSessionToGoogleCalendarsSafe } from '@/lib/google-calendar';
import { parseDatetimeLocalAsArizona } from '@/lib/timezone';
import {
  DEFAULT_GROUP_SESSION_IMAGE_URL,
  DEFAULT_GROUP_SESSION_MAX_PLAYERS,
  formatGroupSessionDateLabel,
} from '@/lib/group-sessions';

export const dynamic = 'force-dynamic';

interface SessionTemplate {
  ageTitle: string;
  ageDescription: string;
  startTime: string;
  endTime: string;
}

const FRIDAY_SESSION_TEMPLATES: SessionTemplate[] = [
  {
    ageTitle: '8 - 10 year olds',
    ageDescription: '8 year to 10 year old',
    startTime: '16:30',
    endTime: '17:45',
  },
  {
    ageTitle: '11 - 13 year olds',
    ageDescription: '11 year to 13 year old',
    startTime: '17:45',
    endTime: '19:00',
  },
];

const SUNDAY_SESSION_TEMPLATES: SessionTemplate[] = [
  {
    ageTitle: '8 - 10 year olds',
    ageDescription: '8 year to 10 year old',
    startTime: '15:00',
    endTime: '16:15',
  },
  {
    ageTitle: '11 - 13 year olds',
    ageDescription: '11 year to 13 year old',
    startTime: '16:15',
    endTime: '17:30',
  },
];

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized && normalized.length > 0 ? normalized : null;
}

function isValidDateInput(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function getArizonaWeekday(date: string): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const safeDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'America/Phoenix',
  }).format(safeDate);
}

export async function POST(request: NextRequest) {
  const client = await getClient();

  try {
    const body = await request.json();

    const fridayDate = normalizeRequiredText(body.friday_date);
    const sundayDate = normalizeRequiredText(body.sunday_date);
    const curriculum = normalizeRequiredText(body.curriculum);
    const location = normalizeRequiredText(body.location);
    // Optional: falls back to the default logo when nothing is uploaded.
    const imageUrl = normalizeOptionalText(body.image_url) ?? DEFAULT_GROUP_SESSION_IMAGE_URL;

    if (!fridayDate || !sundayDate || !curriculum || !location) {
      return errorResponse('Friday date, Sunday date, curriculum, and location are required', 400);
    }

    if (!isValidDateInput(fridayDate) || !isValidDateInput(sundayDate)) {
      return errorResponse('Dates must be in YYYY-MM-DD format', 400);
    }

    if (getArizonaWeekday(fridayDate) !== 'Friday') {
      return errorResponse('The Friday date must be a Friday', 400);
    }

    if (getArizonaWeekday(sundayDate) !== 'Sunday') {
      return errorResponse('The Sunday date must be a Sunday', 400);
    }

    const dayConfigs = [
      {
        date: fridayDate,
        label: formatGroupSessionDateLabel(fridayDate),
        templates: FRIDAY_SESSION_TEMPLATES,
      },
      {
        date: sundayDate,
        label: formatGroupSessionDateLabel(sundayDate),
        templates: SUNDAY_SESSION_TEMPLATES,
      },
    ];

    await client.query('BEGIN');

    const created: Array<{ id: number; title: string; session_date: string }> = [];

    for (const day of dayConfigs) {
      for (const template of day.templates) {
        const sessionDate = parseDatetimeLocalAsArizona(`${day.date}T${template.startTime}`);
        const sessionDateEnd = parseDatetimeLocalAsArizona(`${day.date}T${template.endTime}`);

        const title = `${day.label} ${template.ageTitle}`;
        const description = `${template.ageDescription} group session focusing on ${curriculum}.`;

        const result = await client.query(
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
          VALUES ($1, $2, $3, $4, $5, $6, 50, $7, $8)
          RETURNING id, title, session_date`,
          [
            title,
            description,
            imageUrl,
            sessionDate,
            sessionDateEnd,
            location,
            curriculum,
            DEFAULT_GROUP_SESSION_MAX_PLAYERS,
          ]
        );

        created.push(result.rows[0] as { id: number; title: string; session_date: string });
      }
    }

    await client.query('COMMIT');

    for (const session of created) {
      await syncGroupSessionToGoogleCalendarsSafe(session.id, 'group session quick add');
    }

    return jsonResponse({
      created_count: created.length,
      sessions: created,
    }, 201);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error quick-creating group sessions:', error);
    return errorResponse('Failed to quick-create group sessions');
  } finally {
    client.release();
  }
}
