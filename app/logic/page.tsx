'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

export const dynamic = 'force-dynamic';
const WEEKDAY_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type ScoreSummary = {
  numeric_count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
};

type PlayerTest = {
  id: string;
  test_name: string;
  test_date: string;
  scores: Record<string, unknown>;
  score_summary: ScoreSummary;
};

type PlayerProfileSnapshot = {
  id: string;
  name: string;
  computed_at: string;
  data: Record<string, unknown>;
};

type LogicPlayer = {
  id: number;
  parent_id: number;
  name: string;
  age: number | null;
  gender: 'male' | 'female' | 'other' | null;
  team: string | null;
  notes: string | null;
  parent_name: string;
  parent_email: string | null;
  parent_phone: string | null;
  session_count: number;
  session_slots: Array<{
    slot_key: string;
    weekday: string;
    time_label: string;
    count: number;
  }>;
  latest_tests: PlayerTest[];
  tests: PlayerTest[];
  latest_profile: PlayerProfileSnapshot | null;
  park_counts: Array<{
    park_key: string;
    park_label: string;
    count: number;
  }>;
  unique_park_count: number;
  app_link: {
    app_player_id: string;
    crm_player_id: number;
    profile_photo_url: string | null;
  } | null;
};

type LogicResponse = {
  generated_at: string;
  warnings: string[];
  summary: {
    total_players: number;
    male_players: number;
    female_players: number;
    other_gender_players: number;
    unknown_gender_players: number;
    average_age: number | null;
    players_with_tests: number;
    players_with_profiles: number;
    players_with_app_link: number;
  };
  age_ranges: Array<{
    key: string;
    label: string;
    total: number;
    male: number;
    female: number;
    other: number;
    unknown: number;
  }>;
  session_patterns: {
    weekday_counts: Array<{
      weekday: string;
      session_count: number;
      unique_players: number;
    }>;
    slot_overlaps: Array<{
      slot_key: string;
      weekday: string;
      time_label: string;
      player_count: number;
      players: Array<{ id: number; name: string }>;
    }>;
    pair_overlaps: Array<{
      player_a_id: number;
      player_a_name: string;
      player_b_id: number;
      player_b_name: string;
      shared_slot_count: number;
      shared_slots: Array<{
        slot_key: string;
        weekday: string;
        time_label: string;
      }>;
    }>;
    park_overlaps: Array<{
      park_key: string;
      park_label: string;
      player_count: number;
      players: Array<{ id: number; name: string }>;
    }>;
    park_pair_overlaps: Array<{
      player_a_id: number;
      player_a_name: string;
      player_b_id: number;
      player_b_name: string;
      shared_park_count: number;
      shared_parks: Array<{
        park_key: string;
        park_label: string;
      }>;
    }>;
  };
  players: LogicPlayer[];
};

function formatNum(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return value.toFixed(digits);
}

function getGenderLabel(gender: LogicPlayer['gender']) {
  if (gender === 'male') return 'Boy';
  if (gender === 'female') return 'Girl';
  if (gender === 'other') return 'Other';
  return 'Unknown';
}

function collectNumericEntries(
  value: unknown,
  prefix: string,
  out: Array<{ key: string; value: number }>
) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push({ key: prefix || 'value', value });
    return;
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (value.trim() !== '' && Number.isFinite(asNumber)) {
      out.push({ key: prefix || 'value', value: asNumber });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectNumericEntries(item, prefix ? `${prefix}[${index}]` : `[${index}]`, out);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      collectNumericEntries(child, prefix ? `${prefix}.${key}` : key, out);
    });
  }
}

function topProfileMetrics(profile: PlayerProfileSnapshot | null) {
  if (!profile?.data) return [];
  const entries: Array<{ key: string; value: number }> = [];
  collectNumericEntries(profile.data, '', entries);
  return entries
    .filter((entry) => !entry.key.toLowerCase().includes('test_history'))
    .slice(0, 8);
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hourFromTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

function hourFromSlotKey(slotKey: string): number | null {
  const parts = slotKey.split('|');
  if (parts.length < 2) return null;
  const hour = Number(parts[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

export default function LogicPage() {
  const [data, setData] = useState<LogicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [gender, setGender] = useState<'all' | 'male' | 'female' | 'other' | 'unknown'>('all');
  const [ageBucket, setAgeBucket] = useState('all');
  const [withTestsOnly, setWithTestsOnly] = useState(false);
  const [withAppLinkOnly, setWithAppLinkOnly] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);
  const [groupAgeMin, setGroupAgeMin] = useState('');
  const [groupAgeMax, setGroupAgeMax] = useState('');
  const [groupPark, setGroupPark] = useState('');
  const [groupWeekday, setGroupWeekday] = useState('');
  const [groupTime, setGroupTime] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/logic');
        if (!res.ok) {
          throw new Error('Failed to load logic data.');
        }
        const payload: LogicResponse = await res.json();
        if (!active) return;
        setData(payload);
      } catch (err) {
        if (!active) return;
        console.error(err);
        setError('Could not load Logic page data.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const filteredPlayers = useMemo(() => {
    if (!data) return [];

    return data.players.filter((player) => {
      const searchNormalized = search.trim().toLowerCase();
      const matchesSearch =
        searchNormalized.length === 0 ||
        player.name.toLowerCase().includes(searchNormalized) ||
        player.parent_name.toLowerCase().includes(searchNormalized) ||
        (player.team ?? '').toLowerCase().includes(searchNormalized) ||
        player.park_counts.some((park) => park.park_label.toLowerCase().includes(searchNormalized)) ||
        String(player.id).includes(searchNormalized);

      if (!matchesSearch) return false;

      if (gender !== 'all') {
        const normalized = player.gender ?? 'unknown';
        if (normalized !== gender) return false;
      }

      if (ageBucket !== 'all') {
        const bucket = data.age_ranges.find((range) => range.key === ageBucket);
        if (!bucket) return false;

        const found = data.age_ranges.find((range) => {
          if (range.key === 'unknown') return player.age == null;
          if (range.key === 'u6') return player.age != null && player.age <= 6;
          if (range.key === 'u7_9') return player.age != null && player.age >= 7 && player.age <= 9;
          if (range.key === 'u10_12') return player.age != null && player.age >= 10 && player.age <= 12;
          if (range.key === 'u13_15') return player.age != null && player.age >= 13 && player.age <= 15;
          if (range.key === 'u16_18') return player.age != null && player.age >= 16 && player.age <= 18;
          if (range.key === 'adult') return player.age != null && player.age >= 19;
          return false;
        });
        if (!found || found.key !== bucket.key) return false;
      }

      if (withTestsOnly && player.tests.length === 0) return false;
      if (withAppLinkOnly && !player.app_link) return false;

      return true;
    });
  }, [data, search, gender, ageBucket, withTestsOnly, withAppLinkOnly]);

  const selectedPlayers = useMemo(() => {
    if (!data) return [];
    return data.players.filter((player) => selectedPlayerIds.includes(player.id));
  }, [data, selectedPlayerIds]);

  const comparisonTestNames = useMemo(() => {
    const names = new Set<string>();
    selectedPlayers.forEach((player) => {
      player.latest_tests.forEach((test) => names.add(test.test_name));
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [selectedPlayers]);

  const groupFitResults = useMemo(() => {
    if (!data) return [];

    const minAge = groupAgeMin.trim() === '' ? null : Number(groupAgeMin);
    const maxAge = groupAgeMax.trim() === '' ? null : Number(groupAgeMax);
    const hasMinAge = minAge != null && Number.isFinite(minAge);
    const hasMaxAge = maxAge != null && Number.isFinite(maxAge);
    const normalizedPark = normalizeText(groupPark);
    const hasPark = normalizedPark.length > 0;
    const hasWeekday = groupWeekday.trim().length > 0;
    const targetHour = hourFromTimeInput(groupTime);
    const hasTime = targetHour != null;
    const hasAnyCriteria = hasMinAge || hasMaxAge || hasPark || hasWeekday || hasTime;

    if (!hasAnyCriteria) return [];

    return data.players
      .map((player) => {
        let score = 0;
        const notes: string[] = [];
        let ageMatch = 'Not set';
        let parkMatch = 'Not set';
        let scheduleMatch = 'Not set';
        let ageExcluded = false;

        if (hasMinAge || hasMaxAge) {
          if (player.age == null || !Number.isFinite(player.age)) {
            ageMatch = 'Unknown age (excluded)';
            ageExcluded = true;
          } else {
            const below = hasMinAge && player.age < (minAge as number);
            const above = hasMaxAge && player.age > (maxAge as number);
            if (!below && !above) {
              ageMatch = `In range (${player.age})`;
              score += 40;
              notes.push('Age matches');
            } else {
              ageMatch = below
                ? `${player.age} (below min ${minAge})`
                : `${player.age} (above max ${maxAge})`;
              ageExcluded = true;
            }
          }
        }

        if (hasPark) {
          const exactPark = player.park_counts.find(
            (park) => normalizeText(park.park_label) === normalizedPark
          );
          const partialPark =
            exactPark ??
            player.park_counts.find((park) =>
              normalizeText(park.park_label).includes(normalizedPark)
            );

          if (exactPark) {
            const parkPoints = 30 + Math.min(8, exactPark.count * 2);
            score += parkPoints;
            parkMatch = `${exactPark.park_label} (${exactPark.count})`;
            notes.push('Exact park match');
          } else if (partialPark) {
            const parkPoints = 18 + Math.min(6, partialPark.count);
            score += parkPoints;
            parkMatch = `${partialPark.park_label} (${partialPark.count})`;
            notes.push('Partial park match');
          } else {
            parkMatch = 'No park match';
          }
        }

        if (hasWeekday || hasTime) {
          const weekdaySlots = player.session_slots.filter((slot) =>
            hasWeekday ? slot.weekday === groupWeekday : true
          );

          if (weekdaySlots.length === 0) {
            scheduleMatch = hasWeekday ? `No sessions on ${groupWeekday}` : 'No matching session time';
          } else if (!hasTime) {
            const totalOnDay = weekdaySlots.reduce((sum, slot) => sum + slot.count, 0);
            const dayPoints = 18 + Math.min(8, totalOnDay);
            score += dayPoints;
            scheduleMatch = `${groupWeekday} sessions (${totalOnDay})`;
            notes.push('Day match');
          } else {
            const slotWithDiff = weekdaySlots
              .map((slot) => {
                const slotHour = hourFromSlotKey(slot.slot_key);
                const diff = slotHour == null ? Number.POSITIVE_INFINITY : Math.abs(slotHour - targetHour);
                return { slot, diff };
              })
              .sort((a, b) => a.diff - b.diff)[0];

            if (!slotWithDiff || !Number.isFinite(slotWithDiff.diff)) {
              scheduleMatch = 'No matching session time';
            } else if (slotWithDiff.diff === 0) {
              const timePoints = 28 + Math.min(8, slotWithDiff.slot.count * 2);
              score += timePoints;
              scheduleMatch = `${slotWithDiff.slot.weekday} ${slotWithDiff.slot.time_label} (${slotWithDiff.slot.count})`;
              notes.push('Exact day/time match');
            } else if (slotWithDiff.diff === 1) {
              score += 18;
              scheduleMatch = `${slotWithDiff.slot.weekday} ${slotWithDiff.slot.time_label} (within 1 hr)`;
              notes.push('Near day/time match');
            } else if (slotWithDiff.diff <= 2) {
              score += 10;
              scheduleMatch = `${slotWithDiff.slot.weekday} ${slotWithDiff.slot.time_label} (within 2 hrs)`;
              notes.push('Some schedule overlap');
            } else {
              scheduleMatch = `${slotWithDiff.slot.weekday} ${slotWithDiff.slot.time_label} (far time)`;
            }
          }
        }

        const experiencePoints = Math.min(8, Math.floor(player.session_count / 3));
        if (experiencePoints > 0) {
          score += experiencePoints;
          notes.push('Consistent session history');
        }

        if (ageExcluded) {
          score = 0;
          notes.length = 0;
          notes.push('Excluded by age range');
        }

        const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
        return {
          player,
          score: boundedScore,
          age_excluded: ageExcluded,
          age_match: ageMatch,
          park_match: parkMatch,
          schedule_match: scheduleMatch,
          notes,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.player.name.localeCompare(b.player.name);
      });
  }, [data, groupAgeMin, groupAgeMax, groupPark, groupWeekday, groupTime]);

  const toggleSelectedPlayer = (playerId: number) => {
    setSelectedPlayerIds((prev) => {
      if (prev.includes(playerId)) return prev.filter((id) => id !== playerId);
      return [...prev, playerId];
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={20} />
        <Typography>Loading Logic page...</Typography>
      </Box>
    );
  }

  if (error || !data) {
    return <Typography color="error">{error ?? 'Failed to load Logic page.'}</Typography>;
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Logic
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Compare player ages, gender splits, session overlaps, linked profiles, and test scores.
        </Typography>
      </Box>

      {data.warnings.length > 0 && (
        <Stack spacing={1.25} sx={{ mb: 2.5 }}>
          {data.warnings.map((warning) => (
            <Alert severity="warning" key={warning}>
              {warning}
            </Alert>
          ))}
        </Stack>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(5, 1fr)' }, gap: 1.5, mb: 3 }}>
        <Card>
          <CardContent>
            <Typography color="text.secondary">Total Players</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {data.summary.total_players}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary">Boys / Girls</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {data.summary.male_players} / {data.summary.female_players}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary">Avg Age</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {formatNum(data.summary.average_age, 1)}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary">Players With Tests</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {data.summary.players_with_tests}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="text.secondary">Linked App Profiles</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {data.summary.players_with_app_link}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.2fr 1fr' }, gap: 2, mb: 3 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.25 }}>
              Age and Gender Ranges
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Range</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Boys</TableCell>
                    <TableCell align="right">Girls</TableCell>
                    <TableCell align="right">Other</TableCell>
                    <TableCell align="right">Unknown</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.age_ranges.map((range) => (
                    <TableRow key={range.key}>
                      <TableCell>{range.label}</TableCell>
                      <TableCell align="right">{range.total}</TableCell>
                      <TableCell align="right">{range.male}</TableCell>
                      <TableCell align="right">{range.female}</TableCell>
                      <TableCell align="right">{range.other}</TableCell>
                      <TableCell align="right">{range.unknown}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.25 }}>
              Session Overlaps
            </Typography>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Top day/time slot overlaps
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {data.session_patterns.slot_overlaps.slice(0, 6).map((slot) => (
                <Box key={slot.slot_key} sx={{ p: 1.25, bgcolor: 'grey.50', borderRadius: 1.5 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {slot.weekday} {slot.time_label} ({slot.player_count})
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {slot.players.map((player) => player.name).join(', ')}
                  </Typography>
                </Box>
              ))}
              {data.session_patterns.slot_overlaps.length === 0 && (
                <Typography color="text.secondary">No overlap slots yet.</Typography>
              )}
            </Stack>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Player pair overlaps (time)
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {data.session_patterns.pair_overlaps.slice(0, 6).map((pair) => (
                <Box key={`${pair.player_a_id}-${pair.player_b_id}`} sx={{ p: 1.25, bgcolor: 'grey.50', borderRadius: 1.5 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {pair.player_a_name} + {pair.player_b_name} ({pair.shared_slot_count} shared slots)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {pair.shared_slots.slice(0, 3).map((slot) => `${slot.weekday} ${slot.time_label}`).join(', ')}
                  </Typography>
                </Box>
              ))}
              {data.session_patterns.pair_overlaps.length === 0 && (
                <Typography color="text.secondary">No overlapping player pairs yet.</Typography>
              )}
            </Stack>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Top park overlaps
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {data.session_patterns.park_overlaps.slice(0, 6).map((park) => (
                <Box key={park.park_key} sx={{ p: 1.25, bgcolor: 'grey.50', borderRadius: 1.5 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {park.park_label} ({park.player_count})
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {park.players.map((player) => player.name).join(', ')}
                  </Typography>
                </Box>
              ))}
              {data.session_patterns.park_overlaps.length === 0 && (
                <Typography color="text.secondary">No shared parks yet.</Typography>
              )}
            </Stack>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Player pair overlaps (parks)
            </Typography>
            <Stack spacing={1}>
              {data.session_patterns.park_pair_overlaps.slice(0, 6).map((pair) => (
                <Box key={`park-${pair.player_a_id}-${pair.player_b_id}`} sx={{ p: 1.25, bgcolor: 'grey.50', borderRadius: 1.5 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {pair.player_a_name} + {pair.player_b_name} ({pair.shared_park_count} shared parks)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {pair.shared_parks.map((park) => park.park_label).join(', ')}
                  </Typography>
                </Box>
              ))}
              {data.session_patterns.park_pair_overlaps.length === 0 && (
                <Typography color="text.secondary">No overlapping player park pairs yet.</Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.5 }}>
            Player Comparison
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.3fr 1fr 1fr 1fr 1fr' }, gap: 1.25, mb: 1.25 }}>
            <TextField
              size="small"
              label="Search player / parent / team / ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              fullWidth
            />
            <TextField
              select
              size="small"
              label="Gender"
              value={gender}
              onChange={(e) => setGender(e.target.value as typeof gender)}
              fullWidth
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="male">Boys</MenuItem>
              <MenuItem value="female">Girls</MenuItem>
              <MenuItem value="other">Other</MenuItem>
              <MenuItem value="unknown">Unknown</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Age range"
              value={ageBucket}
              onChange={(e) => setAgeBucket(e.target.value)}
              fullWidth
            >
              <MenuItem value="all">All</MenuItem>
              {data.age_ranges.map((range) => (
                <MenuItem key={range.key} value={range.key}>
                  {range.label}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={<Checkbox checked={withTestsOnly} onChange={(e) => setWithTestsOnly(e.target.checked)} />}
              label="Only players with tests"
            />
            <FormControlLabel
              control={<Checkbox checked={withAppLinkOnly} onChange={(e) => setWithAppLinkOnly(e.target.checked)} />}
              label="Only players with app link"
            />
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Select players to compare side-by-side.
          </Typography>

          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Select</TableCell>
                  <TableCell>Player</TableCell>
                  <TableCell>Profile Tag</TableCell>
                  <TableCell>Age / Gender</TableCell>
                  <TableCell>Team</TableCell>
                  <TableCell>Session Times</TableCell>
                  <TableCell align="right">Tests</TableCell>
                  <TableCell>Profile</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPlayers.map((player) => {
                  const checked = selectedPlayerIds.includes(player.id);
                  return (
                    <TableRow key={player.id} hover selected={checked}>
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleSelectedPlayer(player.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{player.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Parent: {player.parent_name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Chip size="small" label={`CRM ${player.id}`} />
                          {player.app_link ? (
                            <Chip size="small" color="primary" variant="outlined" label={`App ${player.app_link.app_player_id.slice(0, 8)}...`} />
                          ) : (
                            <Chip size="small" variant="outlined" label="No app link" />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {player.age ?? 'n/a'} / {getGenderLabel(player.gender)}
                      </TableCell>
                      <TableCell>{player.team || 'n/a'}</TableCell>
                      <TableCell>
                        {player.session_slots.slice(0, 2).map((slot) => `${slot.weekday} ${slot.time_label}`).join(', ') || 'n/a'}
                      </TableCell>
                      <TableCell align="right">{player.tests.length}</TableCell>
                      <TableCell>
                        <Button component={Link} href={`/contacts/${player.parent_id}`} size="small">
                          Open CRM Profile
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredPlayers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography color="text.secondary">No players match these filters.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.25 }}>
            Side-by-Side Details
          </Typography>

          {selectedPlayers.length === 0 ? (
            <Typography color="text.secondary">Select players above to compare their profile and test data.</Typography>
          ) : (
            <>
              <Box sx={{ overflowX: 'auto', mb: 2 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: `repeat(${selectedPlayers.length}, minmax(260px, 1fr))` }, gap: 1.5, minWidth: { xl: selectedPlayers.length > 0 ? `${selectedPlayers.length * 280}px` : 'auto' } }}>
                {selectedPlayers.map((player) => {
                  const profileMetrics = topProfileMetrics(player.latest_profile);
                  return (
                    <Card key={player.id} variant="outlined">
                      <CardContent>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                          {player.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          CRM {player.id}
                          {player.app_link ? ` | App ${player.app_link.app_player_id}` : ''}
                        </Typography>

                        <Stack direction="row" spacing={0.75} sx={{ mt: 1, mb: 1.5, flexWrap: 'wrap' }}>
                          <Chip size="small" label={`Age ${player.age ?? 'n/a'}`} />
                          <Chip size="small" label={getGenderLabel(player.gender)} />
                          <Chip size="small" label={player.team || 'No team'} />
                          <Chip size="small" label={`${player.session_count} sessions`} />
                        </Stack>

                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                          Session habits
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                          {player.session_slots.slice(0, 4).map((slot) => `${slot.weekday} ${slot.time_label} (${slot.count})`).join(', ') || 'No sessions'}
                        </Typography>

                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                          Parks
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                          {player.park_counts.map((park) => `${park.park_label} (${park.count})`).join(', ') || 'No parks yet'}
                        </Typography>

                        <Divider sx={{ mb: 1.25 }} />

                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                          Latest profile metrics
                        </Typography>
                        {profileMetrics.length > 0 ? (
                          <Stack spacing={0.25} sx={{ mb: 1.25 }}>
                            {profileMetrics.map((metric) => (
                              <Typography variant="body2" key={metric.key}>
                                {metric.key}: <strong>{formatNum(metric.value, 2)}</strong>
                              </Typography>
                            ))}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                            No profile snapshot.
                          </Typography>
                        )}

                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                          Latest tests
                        </Typography>
                        <Stack spacing={0.5}>
                          {player.latest_tests.slice(0, 4).map((test) => (
                            <Box key={test.id} sx={{ p: 0.75, bgcolor: 'grey.50', borderRadius: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {test.test_name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {test.test_date} | avg {formatNum(test.score_summary.avg)} | min {formatNum(test.score_summary.min)} | max {formatNum(test.score_summary.max)}
                              </Typography>
                            </Box>
                          ))}
                          {player.latest_tests.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                              No tests yet.
                            </Typography>
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
                </Box>
              </Box>

              {selectedPlayers.length > 1 && (
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                    Common Test Comparison
                  </Typography>
                  <TableContainer sx={{ maxHeight: 360 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Test</TableCell>
                          {selectedPlayers.map((player) => (
                            <TableCell key={player.id}>{player.name}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {comparisonTestNames.map((testName) => (
                          <TableRow key={testName}>
                            <TableCell sx={{ fontWeight: 600 }}>{testName}</TableCell>
                            {selectedPlayers.map((player) => {
                              const test = player.latest_tests.find((entry) => entry.test_name === testName);
                              return (
                                <TableCell key={`${player.id}-${testName}`}>
                                  {test ? (
                                    <Typography variant="body2">
                                      {test.test_date}
                                      <br />
                                      avg {formatNum(test.score_summary.avg)} | min {formatNum(test.score_summary.min)} | max {formatNum(test.score_summary.max)}
                                    </Typography>
                                  ) : (
                                    <Typography color="text.secondary" variant="body2">
                                      n/a
                                    </Typography>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                        {comparisonTestNames.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={selectedPlayers.length + 1}>
                              <Typography color="text.secondary">No shared test names to compare yet.</Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.75 }}>
            Group Session Fit Finder
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Set target age range, park, day, and time. Age is a hard gate: below min age or above max age = score 0.
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' },
              gap: 1.25,
              mb: 1.5,
            }}
          >
            <TextField
              size="small"
              type="number"
              label="Min age"
              value={groupAgeMin}
              onChange={(e) => setGroupAgeMin(e.target.value)}
              inputProps={{ min: 0 }}
            />
            <TextField
              size="small"
              type="number"
              label="Max age"
              value={groupAgeMax}
              onChange={(e) => setGroupAgeMax(e.target.value)}
              inputProps={{ min: 0 }}
            />
            <TextField
              size="small"
              label="Park / location"
              value={groupPark}
              onChange={(e) => setGroupPark(e.target.value)}
              placeholder="e.g. Arcadia Park"
            />
            <TextField
              select
              size="small"
              label="Day"
              value={groupWeekday}
              onChange={(e) => setGroupWeekday(e.target.value)}
            >
              <MenuItem value="">Any</MenuItem>
              {WEEKDAY_OPTIONS.map((day) => (
                <MenuItem key={day} value={day}>
                  {day}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="time"
              label="Time"
              value={groupTime}
              onChange={(e) => setGroupTime(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Box>

          {groupFitResults.length === 0 ? (
            <Typography color="text.secondary">
              Enter at least one criteria to rank players.
            </Typography>
          ) : (
            <TableContainer sx={{ maxHeight: 460 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Player</TableCell>
                    <TableCell>Fit Score</TableCell>
                    <TableCell>Age Match</TableCell>
                    <TableCell>Park Match</TableCell>
                    <TableCell>Schedule Match</TableCell>
                    <TableCell>Why</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupFitResults.map((result, index) => (
                    <TableRow key={`group-fit-${result.player.id}`} hover>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{result.player.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Parent: {result.player.parent_name} | CRM {result.player.id}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={
                            result.age_excluded
                              ? 'error'
                              : result.score >= 75
                              ? 'success'
                              : result.score >= 50
                                ? 'primary'
                                : result.score >= 30
                                  ? 'warning'
                                  : 'default'
                          }
                          label={`${result.score}/100`}
                        />
                      </TableCell>
                      <TableCell>{result.age_match}</TableCell>
                      <TableCell>{result.park_match}</TableCell>
                      <TableCell>{result.schedule_match}</TableCell>
                      <TableCell>{result.notes.join(' | ') || 'No strong match signals'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
