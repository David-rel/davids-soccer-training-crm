import { query } from '@/lib/db';
import { jsonResponse, errorResponse } from '@/lib/api-helpers';
import { ARIZONA_TIMEZONE } from '@/lib/timezone';
import { formatInTimeZone } from 'date-fns-tz';

export const dynamic = 'force-dynamic';

type PlayerRow = {
  id: number;
  parent_id: number;
  name: string;
  age: number | null;
  gender: 'male' | 'female' | 'other' | null;
  team: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  parent_name: string;
  parent_email: string | null;
  parent_phone: string | null;
};

type SessionRow = {
  player_id: number;
  source: 'session' | 'first_session';
  session_id: number;
  session_date: string | Date | null;
  location: string | null;
  status: string | null;
};

type TableStatusRow = {
  has_app_players: boolean;
  has_player_tests: boolean;
  has_player_profiles: boolean;
  has_crm_player_id_column: boolean;
};

type AppLinkRow = {
  app_player_id: string;
  crm_player_id: number;
  profile_photo_url: string | null;
};

type PlayerTestRow = {
  id: string;
  crm_player_id: number;
  player_id: string;
  test_name: string;
  test_date: string;
  scores: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type PlayerProfileRow = {
  id: string;
  crm_player_id: number;
  name: string;
  computed_at: string;
  data: Record<string, unknown>;
};

type ScoreSummary = {
  numeric_count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
};

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const AGE_BUCKETS: Array<{
  key: string;
  label: string;
  min: number | null;
  max: number | null;
}> = [
  { key: 'u6', label: '6 and under', min: null, max: 6 },
  { key: 'u7_9', label: '7-9', min: 7, max: 9 },
  { key: 'u10_12', label: '10-12', min: 10, max: 12 },
  { key: 'u13_15', label: '13-15', min: 13, max: 15 },
  { key: 'u16_18', label: '16-18', min: 16, max: 18 },
  { key: 'adult', label: '19+', min: 19, max: null },
  { key: 'unknown', label: 'Unknown', min: null, max: null },
];

function addNumericValues(value: unknown, out: number[]) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value);
    return;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      out.push(asNumber);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) addNumericValues(item, out);
    return;
  }

  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      addNumericValues(child, out);
    }
  }
}

function summarizeScores(scores: Record<string, unknown>): ScoreSummary {
  const values: number[] = [];
  addNumericValues(scores, values);
  if (values.length === 0) {
    return {
      numeric_count: 0,
      min: null,
      max: null,
      avg: null,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    numeric_count: values.length,
    min,
    max,
    avg,
  };
}

function getAgeBucketKey(age: number | null): string {
  if (age == null || !Number.isFinite(age)) return 'unknown';

  for (const bucket of AGE_BUCKETS) {
    if (bucket.key === 'unknown') continue;
    const matchesMin = bucket.min == null || age >= bucket.min;
    const matchesMax = bucket.max == null || age <= bucket.max;
    if (matchesMin && matchesMax) return bucket.key;
  }

  return 'unknown';
}

function toTimestamp(value: string | Date | null): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.NaN : parsed;
  }
  return Number.NaN;
}

function normalizeParkKey(location: string | null): string | null {
  if (typeof location !== 'string') return null;
  const normalized = location.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export async function GET() {
  try {
    const [playersResult, sessionsResult, tableStatusResult] = await Promise.all([
      query(
        `
          SELECT
            pl.id,
            pl.parent_id,
            pl.name,
            pl.age,
            pl.gender,
            pl.team,
            pl.notes,
            pl.created_at,
            pl.updated_at,
            p.name AS parent_name,
            p.email AS parent_email,
            p.phone AS parent_phone
          FROM crm_players pl
          JOIN crm_parents p ON p.id = pl.parent_id
          WHERE COALESCE(p.is_dead, false) = false
          ORDER BY pl.name ASC, pl.id ASC
        `
      ),
      query(
        `
          WITH merged AS (
            SELECT
              sp.player_id,
              'session'::text AS source,
              s.id AS session_id,
              s.session_date,
              s.location,
              s.status,
              s.cancelled
            FROM crm_session_players sp
            JOIN crm_sessions s ON s.id = sp.session_id
            JOIN crm_parents p ON p.id = s.parent_id
            WHERE COALESCE(p.is_dead, false) = false

            UNION ALL

            SELECT
              s.player_id,
              'session'::text AS source,
              s.id AS session_id,
              s.session_date,
              s.location,
              s.status,
              s.cancelled
            FROM crm_sessions s
            JOIN crm_parents p ON p.id = s.parent_id
            WHERE s.player_id IS NOT NULL
              AND COALESCE(p.is_dead, false) = false

            UNION ALL

            SELECT
              fsp.player_id,
              'first_session'::text AS source,
              fs.id AS session_id,
              fs.session_date,
              fs.location,
              fs.status,
              fs.cancelled
            FROM crm_first_session_players fsp
            JOIN crm_first_sessions fs ON fs.id = fsp.first_session_id
            JOIN crm_parents p ON p.id = fs.parent_id
            WHERE COALESCE(p.is_dead, false) = false

            UNION ALL

            SELECT
              fs.player_id,
              'first_session'::text AS source,
              fs.id AS session_id,
              fs.session_date,
              fs.location,
              fs.status,
              fs.cancelled
            FROM crm_first_sessions fs
            JOIN crm_parents p ON p.id = fs.parent_id
            WHERE fs.player_id IS NOT NULL
              AND COALESCE(p.is_dead, false) = false
          )
          SELECT DISTINCT ON (player_id, source, session_id)
            player_id,
            source,
            session_id,
            session_date,
            location,
            status
          FROM merged
          WHERE player_id IS NOT NULL
            AND COALESCE(cancelled, false) = false
            AND COALESCE(status, 'scheduled') NOT IN ('cancelled', 'no_show')
          ORDER BY player_id, source, session_id, session_date DESC
        `
      ),
      query(
        `
          SELECT
            to_regclass('public.players') IS NOT NULL AS has_app_players,
            to_regclass('public.player_tests') IS NOT NULL AS has_player_tests,
            to_regclass('public.player_profiles') IS NOT NULL AS has_player_profiles,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'players'
                AND column_name = 'crm_player_id'
            ) AS has_crm_player_id_column
        `
      ),
    ]);

    const players = playersResult.rows as PlayerRow[];
    const sessions = sessionsResult.rows as SessionRow[];
    const tableStatus = tableStatusResult.rows[0] as TableStatusRow;
    const warnings: string[] = [];

    const playerIds = players.map((player) => Number(player.id));
    const testsByCrmPlayer = new Map<number, Array<PlayerTestRow & { score_summary: ScoreSummary }>>();
    const appLinkByCrmPlayer = new Map<number, AppLinkRow>();
    const latestProfileByCrmPlayer = new Map<number, PlayerProfileRow>();

    const canUseAppLinks = tableStatus.has_app_players && tableStatus.has_crm_player_id_column;
    if (!canUseAppLinks) {
      warnings.push('Linked app player table is missing or not mapped by crm_player_id.');
    }

    if (canUseAppLinks && playerIds.length > 0) {
      const appLinksResult = await query(
        `
          SELECT
            id::text AS app_player_id,
            crm_player_id,
            profile_photo_url
          FROM players
          WHERE crm_player_id = ANY($1::int[])
        `,
        [playerIds]
      );

      for (const row of appLinksResult.rows as AppLinkRow[]) {
        appLinkByCrmPlayer.set(Number(row.crm_player_id), row);
      }
    }

    if (canUseAppLinks && tableStatus.has_player_tests && playerIds.length > 0) {
      const testsResult = await query(
        `
          SELECT
            t.id::text AS id,
            p.crm_player_id,
            t.player_id::text AS player_id,
            t.test_name,
            t.test_date::text AS test_date,
            t.scores,
            t.created_at::text AS created_at,
            t.updated_at::text AS updated_at
          FROM player_tests t
          JOIN players p ON p.id = t.player_id
          WHERE p.crm_player_id = ANY($1::int[])
          ORDER BY t.test_date DESC, t.created_at DESC
        `,
        [playerIds]
      );

      for (const row of testsResult.rows as PlayerTestRow[]) {
        const crmPlayerId = Number(row.crm_player_id);
        const existing = testsByCrmPlayer.get(crmPlayerId) ?? [];
        existing.push({
          ...row,
          score_summary: summarizeScores(row.scores ?? {}),
        });
        testsByCrmPlayer.set(crmPlayerId, existing);
      }
    } else if (!tableStatus.has_player_tests) {
      warnings.push('player_tests table was not found. Test comparison is unavailable.');
    }

    if (canUseAppLinks && tableStatus.has_player_profiles && playerIds.length > 0) {
      const profilesResult = await query(
        `
          SELECT DISTINCT ON (p.crm_player_id)
            pr.id::text AS id,
            p.crm_player_id,
            pr.name,
            pr.computed_at::text AS computed_at,
            pr.data
          FROM player_profiles pr
          JOIN players p ON p.id = pr.player_id
          WHERE p.crm_player_id = ANY($1::int[])
          ORDER BY p.crm_player_id, pr.computed_at DESC, pr.created_at DESC
        `,
        [playerIds]
      );

      for (const row of profilesResult.rows as PlayerProfileRow[]) {
        latestProfileByCrmPlayer.set(Number(row.crm_player_id), row);
      }
    } else if (!tableStatus.has_player_profiles) {
      warnings.push('player_profiles table was not found. Latest profile snapshots are unavailable.');
    }

    const sessionsByPlayer = new Map<number, Array<{
      source: 'session' | 'first_session';
      session_id: number;
      session_date: string | Date | null;
      location: string | null;
      status: string | null;
      weekday: string;
      time_label: string;
      slot_key: string;
      date_label: string;
    }>>();

    for (const row of sessions) {
      const sessionDate = row.session_date;
      if (!sessionDate) continue;
      const weekday = formatInTimeZone(sessionDate, ARIZONA_TIMEZONE, 'EEE');
      const timeLabel = formatInTimeZone(sessionDate, ARIZONA_TIMEZONE, 'h:mm a');
      const hourLabel = formatInTimeZone(sessionDate, ARIZONA_TIMEZONE, 'HH');
      const slotKey = `${weekday}|${hourLabel}`;

      const playerSessions = sessionsByPlayer.get(Number(row.player_id)) ?? [];
      playerSessions.push({
        source: row.source,
        session_id: Number(row.session_id),
        session_date: sessionDate,
        location: row.location,
        status: row.status,
        weekday,
        time_label: timeLabel,
        slot_key: slotKey,
        date_label: formatInTimeZone(sessionDate, ARIZONA_TIMEZONE, 'MM/dd/yyyy'),
      });
      sessionsByPlayer.set(Number(row.player_id), playerSessions);
    }

    for (const playerSessions of sessionsByPlayer.values()) {
      playerSessions.sort((a, b) => {
        const aTs = toTimestamp(a.session_date);
        const bTs = toTimestamp(b.session_date);
        if (Number.isNaN(aTs) && Number.isNaN(bTs)) return 0;
        if (Number.isNaN(aTs)) return 1;
        if (Number.isNaN(bTs)) return -1;
        return bTs - aTs;
      });
    }

    const enrichedPlayers = players.map((player) => {
      const crmPlayerId = Number(player.id);
      const playerSessions = sessionsByPlayer.get(crmPlayerId) ?? [];
      const tests = testsByCrmPlayer.get(crmPlayerId) ?? [];
      const latestTestsByName = new Map<string, (typeof tests)[number]>();
      for (const test of tests) {
        if (!latestTestsByName.has(test.test_name)) {
          latestTestsByName.set(test.test_name, test);
        }
      }

      const slotCounts = new Map<string, { slot_key: string; weekday: string; time_label: string; count: number }>();
      for (const session of playerSessions) {
        const existing = slotCounts.get(session.slot_key);
        if (existing) {
          existing.count += 1;
        } else {
          slotCounts.set(session.slot_key, {
            slot_key: session.slot_key,
            weekday: session.weekday,
            time_label: session.time_label,
            count: 1,
          });
        }
      }

      const sessionSlots = Array.from(slotCounts.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const aDay = WEEKDAY_ORDER.indexOf(a.weekday);
        const bDay = WEEKDAY_ORDER.indexOf(b.weekday);
        if (aDay !== bDay) return aDay - bDay;
        return a.time_label.localeCompare(b.time_label);
      });

      const parkCountsMap = new Map<
        string,
        { park_key: string; park_label: string; count: number }
      >();
      for (const session of playerSessions) {
        const parkKey = normalizeParkKey(session.location);
        if (!parkKey) continue;
        const existing = parkCountsMap.get(parkKey);
        if (existing) {
          existing.count += 1;
          continue;
        }
        parkCountsMap.set(parkKey, {
          park_key: parkKey,
          park_label: session.location!.trim().replace(/\s+/g, ' '),
          count: 1,
        });
      }
      const parkCounts = Array.from(parkCountsMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.park_label.localeCompare(b.park_label);
      });

      return {
        ...player,
        app_link: appLinkByCrmPlayer.get(crmPlayerId) ?? null,
        tests,
        latest_tests: Array.from(latestTestsByName.values()),
        latest_profile: latestProfileByCrmPlayer.get(crmPlayerId) ?? null,
        sessions: playerSessions,
        session_slots: sessionSlots,
        session_count: playerSessions.length,
        park_counts: parkCounts,
        unique_park_count: parkCounts.length,
      };
    });

    const genderCounts = {
      male: 0,
      female: 0,
      other: 0,
      unknown: 0,
    };
    let ageTotal = 0;
    let ageCount = 0;
    let playersWithTests = 0;
    let playersWithProfiles = 0;
    let playersWithAppLink = 0;

    const ageRangeMap = new Map(
      AGE_BUCKETS.map((bucket) => [
        bucket.key,
        {
          key: bucket.key,
          label: bucket.label,
          total: 0,
          male: 0,
          female: 0,
          other: 0,
          unknown: 0,
        },
      ])
    );

    const playerNameById = new Map<number, string>();
    const slotToPlayerIds = new Map<string, Set<number>>();
    const slotMetaByKey = new Map<string, { weekday: string; time_label: string }>();
    const playerSlotSets = new Map<number, Set<string>>();
    const parkToPlayerIds = new Map<string, Set<number>>();
    const parkLabelByKey = new Map<string, string>();
    const playerParkSets = new Map<number, Set<string>>();

    for (const player of enrichedPlayers) {
      const playerId = Number(player.id);
      playerNameById.set(playerId, player.name);

      const genderKey =
        player.gender === 'male' || player.gender === 'female' || player.gender === 'other'
          ? player.gender
          : 'unknown';
      genderCounts[genderKey] += 1;

      if (player.age != null && Number.isFinite(player.age)) {
        ageTotal += player.age;
        ageCount += 1;
      }

      if (player.tests.length > 0) playersWithTests += 1;
      if (player.latest_profile) playersWithProfiles += 1;
      if (player.app_link) playersWithAppLink += 1;

      const ageBucketKey = getAgeBucketKey(player.age);
      const range = ageRangeMap.get(ageBucketKey);
      if (range) {
        range.total += 1;
        range[genderKey] += 1;
      }

      const uniqueSlots = new Set<string>();
      for (const slot of player.session_slots) {
        uniqueSlots.add(slot.slot_key);
        slotMetaByKey.set(slot.slot_key, {
          weekday: slot.weekday,
          time_label: slot.time_label,
        });
      }
      playerSlotSets.set(playerId, uniqueSlots);

      for (const slotKey of uniqueSlots) {
        const ids = slotToPlayerIds.get(slotKey) ?? new Set<number>();
        ids.add(playerId);
        slotToPlayerIds.set(slotKey, ids);
      }

      const uniqueParks = new Set<string>();
      for (const park of player.park_counts) {
        uniqueParks.add(park.park_key);
        parkLabelByKey.set(park.park_key, park.park_label);
      }
      playerParkSets.set(playerId, uniqueParks);
      for (const parkKey of uniqueParks) {
        const ids = parkToPlayerIds.get(parkKey) ?? new Set<number>();
        ids.add(playerId);
        parkToPlayerIds.set(parkKey, ids);
      }
    }

    const weekdayCountsMap = new Map<string, { weekday: string; session_count: number; player_ids: Set<number> }>();
    for (const player of enrichedPlayers) {
      for (const session of player.sessions) {
        const weekday = session.weekday;
        const existing = weekdayCountsMap.get(weekday) ?? {
          weekday,
          session_count: 0,
          player_ids: new Set<number>(),
        };
        existing.session_count += 1;
        existing.player_ids.add(Number(player.id));
        weekdayCountsMap.set(weekday, existing);
      }
    }

    const weekdayCounts = Array.from(weekdayCountsMap.values())
      .map((value) => ({
        weekday: value.weekday,
        session_count: value.session_count,
        unique_players: value.player_ids.size,
      }))
      .sort((a, b) => {
        const aIdx = WEEKDAY_ORDER.indexOf(a.weekday);
        const bIdx = WEEKDAY_ORDER.indexOf(b.weekday);
        return aIdx - bIdx;
      });

    const slotOverlaps = Array.from(slotToPlayerIds.entries())
      .map(([slotKey, ids]) => {
        const slotMeta = slotMetaByKey.get(slotKey);
        const playersInSlot = Array.from(ids)
          .map((id) => ({ id, name: playerNameById.get(id) ?? `Player ${id}` }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          slot_key: slotKey,
          weekday: slotMeta?.weekday ?? '',
          time_label: slotMeta?.time_label ?? '',
          player_count: playersInSlot.length,
          players: playersInSlot,
        };
      })
      .filter((slot) => slot.player_count > 1)
      .sort((a, b) => {
        if (b.player_count !== a.player_count) return b.player_count - a.player_count;
        return a.slot_key.localeCompare(b.slot_key);
      });

    const parkOverlaps = Array.from(parkToPlayerIds.entries())
      .map(([parkKey, ids]) => {
        const playersAtPark = Array.from(ids)
          .map((id) => ({ id, name: playerNameById.get(id) ?? `Player ${id}` }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          park_key: parkKey,
          park_label: parkLabelByKey.get(parkKey) ?? parkKey,
          player_count: playersAtPark.length,
          players: playersAtPark,
        };
      })
      .filter((park) => park.player_count > 1)
      .sort((a, b) => {
        if (b.player_count !== a.player_count) return b.player_count - a.player_count;
        return a.park_label.localeCompare(b.park_label);
      });

    const playerIdsSorted = enrichedPlayers.map((player) => Number(player.id)).sort((a, b) => a - b);
    const pairOverlaps: Array<{
      player_a_id: number;
      player_a_name: string;
      player_b_id: number;
      player_b_name: string;
      shared_slot_count: number;
      shared_slots: Array<{ slot_key: string; weekday: string; time_label: string }>;
    }> = [];
    const parkPairOverlaps: Array<{
      player_a_id: number;
      player_a_name: string;
      player_b_id: number;
      player_b_name: string;
      shared_park_count: number;
      shared_parks: Array<{ park_key: string; park_label: string }>;
    }> = [];

    for (let i = 0; i < playerIdsSorted.length; i += 1) {
      for (let j = i + 1; j < playerIdsSorted.length; j += 1) {
        const playerAId = playerIdsSorted[i];
        const playerBId = playerIdsSorted[j];
        const slotsA = playerSlotSets.get(playerAId) ?? new Set<string>();
        const slotsB = playerSlotSets.get(playerBId) ?? new Set<string>();

        if (slotsA.size === 0 || slotsB.size === 0) continue;

        const [small, large] = slotsA.size <= slotsB.size ? [slotsA, slotsB] : [slotsB, slotsA];
        const sharedSlots: string[] = [];
        for (const slot of small) {
          if (large.has(slot)) sharedSlots.push(slot);
        }

        if (sharedSlots.length === 0) continue;

        pairOverlaps.push({
          player_a_id: playerAId,
          player_a_name: playerNameById.get(playerAId) ?? `Player ${playerAId}`,
          player_b_id: playerBId,
          player_b_name: playerNameById.get(playerBId) ?? `Player ${playerBId}`,
          shared_slot_count: sharedSlots.length,
          shared_slots: sharedSlots
            .map((slotKey) => ({
              slot_key: slotKey,
              weekday: slotMetaByKey.get(slotKey)?.weekday ?? '',
              time_label: slotMetaByKey.get(slotKey)?.time_label ?? '',
            }))
            .sort((a, b) => {
              const aDay = WEEKDAY_ORDER.indexOf(a.weekday);
              const bDay = WEEKDAY_ORDER.indexOf(b.weekday);
              if (aDay !== bDay) return aDay - bDay;
              return a.time_label.localeCompare(b.time_label);
            }),
        });
      }
    }

    for (let i = 0; i < playerIdsSorted.length; i += 1) {
      for (let j = i + 1; j < playerIdsSorted.length; j += 1) {
        const playerAId = playerIdsSorted[i];
        const playerBId = playerIdsSorted[j];
        const parksA = playerParkSets.get(playerAId) ?? new Set<string>();
        const parksB = playerParkSets.get(playerBId) ?? new Set<string>();

        if (parksA.size === 0 || parksB.size === 0) continue;

        const [small, large] = parksA.size <= parksB.size ? [parksA, parksB] : [parksB, parksA];
        const sharedParks: string[] = [];
        for (const park of small) {
          if (large.has(park)) sharedParks.push(park);
        }
        if (sharedParks.length === 0) continue;

        parkPairOverlaps.push({
          player_a_id: playerAId,
          player_a_name: playerNameById.get(playerAId) ?? `Player ${playerAId}`,
          player_b_id: playerBId,
          player_b_name: playerNameById.get(playerBId) ?? `Player ${playerBId}`,
          shared_park_count: sharedParks.length,
          shared_parks: sharedParks
            .map((parkKey) => ({
              park_key: parkKey,
              park_label: parkLabelByKey.get(parkKey) ?? parkKey,
            }))
            .sort((a, b) => a.park_label.localeCompare(b.park_label)),
        });
      }
    }

    pairOverlaps.sort((a, b) => {
      if (b.shared_slot_count !== a.shared_slot_count) return b.shared_slot_count - a.shared_slot_count;
      if (a.player_a_name !== b.player_a_name) return a.player_a_name.localeCompare(b.player_a_name);
      return a.player_b_name.localeCompare(b.player_b_name);
    });
    parkPairOverlaps.sort((a, b) => {
      if (b.shared_park_count !== a.shared_park_count) return b.shared_park_count - a.shared_park_count;
      if (a.player_a_name !== b.player_a_name) return a.player_a_name.localeCompare(b.player_a_name);
      return a.player_b_name.localeCompare(b.player_b_name);
    });

    return jsonResponse({
      generated_at: new Date().toISOString(),
      table_availability: tableStatus,
      warnings,
      summary: {
        total_players: enrichedPlayers.length,
        male_players: genderCounts.male,
        female_players: genderCounts.female,
        other_gender_players: genderCounts.other,
        unknown_gender_players: genderCounts.unknown,
        average_age: ageCount > 0 ? ageTotal / ageCount : null,
        players_with_tests: playersWithTests,
        players_with_profiles: playersWithProfiles,
        players_with_app_link: playersWithAppLink,
      },
      age_ranges: AGE_BUCKETS.map((bucket) => {
        const range = ageRangeMap.get(bucket.key);
        if (range) return range;
        return {
          key: bucket.key,
          label: bucket.label,
          total: 0,
          male: 0,
          female: 0,
          other: 0,
          unknown: 0,
        };
      }),
      session_patterns: {
        weekday_counts: weekdayCounts,
        slot_overlaps: slotOverlaps,
        pair_overlaps: pairOverlaps,
        park_overlaps: parkOverlaps,
        park_pair_overlaps: parkPairOverlaps,
      },
      players: enrichedPlayers,
    });
  } catch (error) {
    console.error('Error building logic data:', error);
    return errorResponse('Failed to fetch logic data');
  }
}
