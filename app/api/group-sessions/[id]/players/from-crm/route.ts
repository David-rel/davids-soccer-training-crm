import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { addCrmPlayersToGroupSession, parseCrmPlayerIds } from '@/lib/group-session-signups';
import { notifyGroupSessionSignups, NotifyOutcome } from '@/lib/group-session-notifications';
import { syncGroupSessionToGoogleCalendarsSafe } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Bulk-adds CRM players to a group session. The client sends player ids — a
 * whole family is just that parent's players expanded before the call — and
 * each one lands as an unpaid prospect priced at the session's price.
 *
 * With `notify` set, each new family also gets a text and an email carrying a
 * calendar invite. Notification runs after the signups are committed and its
 * failures are reported, never thrown: a dead phone number must not roll back
 * a roster change the coach can see on screen.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const playerIds = parseCrmPlayerIds(body.player_ids);
    if (playerIds.length === 0) {
      return errorResponse('Select at least one player to add', 400);
    }

    const result = await addCrmPlayersToGroupSession(id, playerIds);

    let notified: NotifyOutcome | null = null;
    if (body.notify === true && result.recipients.length > 0) {
      notified = await notifyGroupSessionSignups(id, result.recipients);
    }

    // Refreshes the event's headcount and guest list. Guests are added without
    // Google notifications, so this never re-emails existing families.
    if (result.added > 0) {
      await syncGroupSessionToGoogleCalendarsSafe(id, 'group session crm add');
    }

    return jsonResponse(
      {
        added: result.added,
        skipped: result.skipped,
        warnings: result.warnings,
        notified,
      },
      201
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Group session not found') {
      return errorResponse('Group session not found', 404);
    }
    console.error('Error adding CRM players to group session:', error);
    return errorResponse('Failed to add players from the CRM');
  }
}
