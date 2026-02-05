/**
 * Centralized timezone handling for Arizona time.
 *
 * IMPORTANT: Arizona does NOT observe Daylight Saving Time (except Navajo Nation).
 * Arizona is always on Mountain Standard Time (MST), which is UTC-7.
 *
 * This module ensures all dates are handled consistently whether running on:
 * - Local development machine
 * - Vercel servers (UTC)
 * - Any other deployment environment
 */

import { format, parse } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

// Arizona timezone - no DST, always MST (UTC-7)
export const ARIZONA_TIMEZONE = 'America/Phoenix';

/**
 * Get the current date/time in Arizona timezone.
 * Use this instead of `new Date()` when you need "now" in Arizona.
 */
export function nowInArizona(): Date {
  return toZonedTime(new Date(), ARIZONA_TIMEZONE);
}

/**
 * Convert a UTC date to Arizona time for display purposes.
 * Use this when retrieving dates from the database to display to the user.
 */
export function toArizonaTime(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return toZonedTime(d, ARIZONA_TIMEZONE);
}

/**
 * Convert a local Arizona time to UTC for storage.
 * Use this when storing dates in the database.
 *
 * @param date - A date that represents Arizona local time
 */
export function fromArizonaTime(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return fromZonedTime(d, ARIZONA_TIMEZONE);
}

/**
 * Parse a datetime-local input value (e.g., "2026-02-06T15:45") as Arizona time
 * and convert to ISO string for database storage.
 *
 * CRITICAL: datetime-local inputs don't include timezone info.
 * We must interpret them as Arizona time, then convert to UTC for storage.
 */
export function parseDatetimeLocalAsArizona(datetimeLocal: string): string {
  // datetime-local format: "2026-02-06T15:45"
  // Parse this as if it's Arizona time, then convert to UTC ISO string
  const date = fromZonedTime(datetimeLocal, ARIZONA_TIMEZONE);
  return date.toISOString();
}

/**
 * Convert an ISO date string from the database to datetime-local format
 * for editing in a form (displayed in Arizona time).
 */
export function toDatetimeLocal(isoString: string): string {
  return formatInTimeZone(isoString, ARIZONA_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Format a date for display in Arizona time.
 *
 * @param date - UTC date from database
 * @param formatStr - date-fns format string (e.g., "PPpp" for full date and time)
 */
export function formatArizona(date: Date | string, formatStr: string = 'PPpp'): string {
  return formatInTimeZone(date, ARIZONA_TIMEZONE, formatStr);
}

/**
 * Format just the date portion in Arizona time.
 */
export function formatArizonaDate(date: Date | string): string {
  return formatInTimeZone(date, ARIZONA_TIMEZONE, 'MM/dd/yyyy');
}

/**
 * Format just the time portion in Arizona time.
 */
export function formatArizonaTime(date: Date | string): string {
  return formatInTimeZone(date, ARIZONA_TIMEZONE, 'h:mm a');
}

/**
 * Format date and time in Arizona time.
 */
export function formatArizonaDateTime(date: Date | string): string {
  return formatInTimeZone(date, ARIZONA_TIMEZONE, 'MM/dd/yyyy h:mm a');
}

/**
 * Get today's date boundaries in Arizona time, returned as ISO strings.
 * Use this for database queries that need "today" in Arizona.
 */
export function getTodayBoundsArizona(): { start: string; end: string; dateStr: string } {
  const now = new Date();
  const arizonaNow = toZonedTime(now, ARIZONA_TIMEZONE);

  // Get the date parts in Arizona time
  const year = arizonaNow.getFullYear();
  const month = arizonaNow.getMonth();
  const day = arizonaNow.getDate();

  // Create start of day (00:00:00) and end of day (23:59:59) in Arizona
  const startOfDayArizona = new Date(year, month, day, 0, 0, 0, 0);
  const endOfDayArizona = new Date(year, month, day, 23, 59, 59, 999);

  // Convert to UTC for database comparison
  const startUTC = fromZonedTime(startOfDayArizona, ARIZONA_TIMEZONE);
  const endUTC = fromZonedTime(endOfDayArizona, ARIZONA_TIMEZONE);

  // Format for SQL queries
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;

  return {
    start: startUTC.toISOString(),
    end: endUTC.toISOString(),
    dateStr,
  };
}

/**
 * Get date boundaries for a specific date in Arizona time.
 * Useful for querying sessions/events on a specific calendar day.
 */
export function getDateBoundsArizona(date: Date | string): { start: string; end: string } {
  const d = typeof date === 'string' ? new Date(date) : date;
  const arizonaDate = toZonedTime(d, ARIZONA_TIMEZONE);

  const year = arizonaDate.getFullYear();
  const month = arizonaDate.getMonth();
  const day = arizonaDate.getDate();

  const startOfDayArizona = new Date(year, month, day, 0, 0, 0, 0);
  const endOfDayArizona = new Date(year, month, day, 23, 59, 59, 999);

  const startUTC = fromZonedTime(startOfDayArizona, ARIZONA_TIMEZONE);
  const endUTC = fromZonedTime(endOfDayArizona, ARIZONA_TIMEZONE);

  return {
    start: startUTC.toISOString(),
    end: endUTC.toISOString(),
  };
}

/**
 * Get the week start date (Sunday) in Arizona time.
 */
export function getWeekStartArizona(): string {
  const now = new Date();
  const arizonaNow = toZonedTime(now, ARIZONA_TIMEZONE);

  const dayOfWeek = arizonaNow.getDay();
  const weekStart = new Date(arizonaNow);
  weekStart.setDate(arizonaNow.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  return fromZonedTime(weekStart, ARIZONA_TIMEZONE).toISOString();
}

/**
 * Get the month start date in Arizona time.
 */
export function getMonthStartArizona(): string {
  const now = new Date();
  const arizonaNow = toZonedTime(now, ARIZONA_TIMEZONE);

  const monthStart = new Date(arizonaNow.getFullYear(), arizonaNow.getMonth(), 1, 0, 0, 0, 0);

  return fromZonedTime(monthStart, ARIZONA_TIMEZONE).toISOString();
}

/**
 * Get a future date in Arizona time (for queries like "next 90 days").
 */
export function getFutureDateArizona(days: number): string {
  const now = new Date();
  const arizonaNow = toZonedTime(now, ARIZONA_TIMEZONE);

  const futureDate = new Date(arizonaNow);
  futureDate.setDate(arizonaNow.getDate() + days);
  futureDate.setHours(23, 59, 59, 999);

  return fromZonedTime(futureDate, ARIZONA_TIMEZONE).toISOString();
}

/**
 * Create a Date object for display in calendar components.
 * Takes an ISO string from the database and returns a Date that,
 * when displayed, shows the correct Arizona time.
 */
export function toCalendarDate(isoString: string): Date {
  return toZonedTime(isoString, ARIZONA_TIMEZONE);
}

/**
 * Parse a date-only input (e.g., "2026-02-06") as Arizona time at midnight
 * and convert to ISO string for database storage.
 *
 * CRITICAL: When a user picks a date (no time), we need to store it as
 * midnight Arizona time, not midnight UTC. Otherwise "Feb 6" in Arizona
 * would show as "Feb 5" when the server is in UTC.
 */
export function parseDateAsArizona(dateString: string): string {
  // dateString format: "2026-02-06"
  // Interpret as midnight Arizona time, then convert to UTC
  const dateAtMidnightArizona = `${dateString}T00:00:00`;
  const date = fromZonedTime(dateAtMidnightArizona, ARIZONA_TIMEZONE);
  return date.toISOString();
}

/**
 * Convert an ISO date string from the database to date-only format (YYYY-MM-DD)
 * for editing in a date input (displayed in Arizona time).
 */
export function toDateInput(isoString: string): string {
  return formatInTimeZone(isoString, ARIZONA_TIMEZONE, 'yyyy-MM-dd');
}
