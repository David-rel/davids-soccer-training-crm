#!/usr/bin/env tsx
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

function getFlagValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function toPositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function main() {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("CRON_SECRET is missing. Add it to .env.local or .env.");
  }

  const baseUrl =
    getFlagValue("--base-url") || process.env.TEST_BASE_URL || "http://localhost:3000";

  const to =
    getFlagValue("--to") || process.env.COACH_PHONE_NUMBER || "7206122979";

  const lookaheadMinutes = toPositiveInt(
    getFlagValue("--lookahead-minutes"),
    180,
    0,
    30 * 24 * 60
  );

  const batchSize = toPositiveInt(getFlagValue("--batch-size"), 25, 1, 200);
  const send = hasFlag("--send");
  const markSent = hasFlag("--mark-sent");
  const parentId = getFlagValue("--parent-id");
  const sessionId = getFlagValue("--session-id");
  const firstSessionId = getFlagValue("--first-session-id");
  const types = getFlagValue("--types");

  const params = new URLSearchParams();
  params.set("secret", cronSecret);
  params.set("test_mode", "1");
  params.set("test_to", to);
  params.set("lookahead_minutes", String(lookaheadMinutes));
  params.set("batch_size", String(batchSize));
  params.set("dry_run", send ? "0" : "1");

  if (markSent) {
    params.set("mark_sent", "1");
  }
  if (parentId) {
    params.set("parent_id", parentId);
  }
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  if (firstSessionId) {
    params.set("first_session_id", firstSessionId);
  }
  if (types) {
    params.set("types", types);
  }

  const normalizedBase = baseUrl.replace(/\/$/, "");
  const url = `${normalizedBase}/api/cron/send-reminders?${params.toString()}`;

  console.log("Running reminder test...");
  console.log(`URL: ${url}`);
  console.log(`Mode: ${send ? "SEND" : "DRY RUN"}`);
  console.log(`Target number: ${to}`);

  const response = await fetch(url, { method: "GET" });
  const text = await response.text();

  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!response.ok) {
    console.error("Request failed:", payload);
    process.exit(1);
  }

  console.log("Result:");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error("test-sms-reminders failed:", error);
  process.exit(1);
});
