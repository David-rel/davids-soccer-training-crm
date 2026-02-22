#!/usr/bin/env ts-node
import { config } from "dotenv";
config({ path: ".env.local" });

import { getPool, query } from "../lib/db.js";
import {
  createSessionReminders,
  createFollowUpReminders,
  SESSION_REMINDER_TYPES,
} from "../lib/reminders.js";

async function backfillReminders() {
  try {
    console.log("🔄 Backfilling missing reminders...\n");

    // 1. Find scheduled first sessions with no session reminders
    const firstSessions = await query(`
      SELECT fs.id, fs.parent_id, fs.session_date, p.name
      FROM crm_first_sessions fs
      JOIN crm_parents p ON p.id = fs.parent_id
      WHERE fs.status = 'scheduled'
        AND COALESCE(p.is_dead, false) = false
        AND fs.cancelled = false
        AND fs.session_date > NOW()
        AND EXISTS (
          SELECT 1
          FROM UNNEST($1::text[]) AS expected(reminder_type)
          WHERE NOT EXISTS (
            SELECT 1 FROM crm_reminders r
            WHERE r.first_session_id = fs.id
              AND r.reminder_category = 'session_reminder'
              AND r.reminder_type = expected.reminder_type
          )
        )
      ORDER BY fs.session_date
    `, [SESSION_REMINDER_TYPES]);

    console.log(
      `Found ${firstSessions.rows.length} first sessions missing reminders`
    );
    for (const fs of firstSessions.rows) {
      await createSessionReminders(fs.parent_id, fs.session_date, {
        firstSessionId: fs.id,
      });
      console.log(
        `  ✅ ${fs.name} — first session on ${new Date(fs.session_date).toLocaleDateString()}`
      );
    }

    // 2. Find scheduled regular sessions with no session reminders
    const sessions = await query(`
      SELECT s.id, s.parent_id, s.session_date, p.name
      FROM crm_sessions s
      JOIN crm_parents p ON p.id = s.parent_id
      WHERE s.status = 'scheduled'
        AND COALESCE(p.is_dead, false) = false
        AND s.cancelled = false
        AND s.session_date > NOW()
        AND EXISTS (
          SELECT 1
          FROM UNNEST($1::text[]) AS expected(reminder_type)
          WHERE NOT EXISTS (
            SELECT 1 FROM crm_reminders r
            WHERE r.session_id = s.id
              AND r.reminder_category = 'session_reminder'
              AND r.reminder_type = expected.reminder_type
          )
        )
      ORDER BY s.session_date
    `, [SESSION_REMINDER_TYPES]);

    console.log(
      `Found ${sessions.rows.length} regular sessions missing reminders`
    );
    for (const s of sessions.rows) {
      await createSessionReminders(s.parent_id, s.session_date, {
        sessionId: s.id,
      });
      console.log(
        `  ✅ ${s.name} — session on ${new Date(s.session_date).toLocaleDateString()}`
      );
    }

    // 3. Find contacts in DM stages with no follow-up reminders
    const dmContacts = await query(`
      SELECT p.id, p.name, p.dm_status
      FROM crm_parents p
      WHERE p.dm_status IN ('first_message', 'started_talking', 'request_phone_call')
        AND COALESCE(p.is_dead, false) = false
        AND p.phone_call_booked = false
        AND NOT EXISTS (
          SELECT 1 FROM crm_reminders r
          WHERE r.parent_id = p.id
            AND r.reminder_category = 'dm_follow_up'
            AND r.sent = false
        )
      ORDER BY p.name
    `);

    console.log(
      `Found ${dmContacts.rows.length} DM contacts missing follow-up reminders`
    );
    for (const c of dmContacts.rows) {
      await createFollowUpReminders(c.id, "dm_follow_up");
      console.log(`  ✅ ${c.name} — ${c.dm_status}`);
    }

    // 4. Find post-call contacts (thinking/went_cold) with no follow-up reminders
    const postCallContacts = await query(`
      SELECT p.id, p.name, p.call_outcome
      FROM crm_parents p
      WHERE p.call_outcome IN ('thinking_about_it', 'went_cold')
        AND COALESCE(p.is_dead, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM crm_reminders r
          WHERE r.parent_id = p.id
            AND r.reminder_category = 'post_call_follow_up'
            AND r.sent = false
        )
      ORDER BY p.name
    `);

    console.log(
      `Found ${postCallContacts.rows.length} post-call contacts missing follow-up reminders`
    );
    for (const c of postCallContacts.rows) {
      await createFollowUpReminders(c.id, "post_call_follow_up");
      console.log(`  ✅ ${c.name} — ${c.call_outcome}`);
    }

    console.log("\n✅ Backfill complete!");
    await getPool().end();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error backfilling reminders:", error);
    await getPool().end();
    process.exit(1);
  }
}

backfillReminders();
