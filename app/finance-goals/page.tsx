'use client';

import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import { formatArizonaDateTime } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

interface FinanceGoalsData {
  goals: {
    weekly: number;
    monthly: number;
  };
  week: {
    start: string;
    end: string;
    range_label: string;
    days_counted_label: string;
    total: number;
    percentage: number;
    over_goal_percentage: number;
    potential_sessions_total: number;
    projected_total_if_no_cancel: number;
    projected_percentage_if_no_cancel: number;
    projected_over_goal_percentage_if_no_cancel: number;
    days: Array<{
      day_key: string;
      day_name: string;
      day_short: string;
      date_label: string;
      packages: number;
      sessions: number;
      group_sessions: number;
      sessions_possible: number;
      total: number;
    }>;
  };
  month: {
    start: string;
    end: string;
    range_label: string;
    total: number;
    percentage: number;
    over_goal_percentage: number;
  };
  overall: {
    total: number;
  };
  sessions: {
    happened: {
      count: number;
      total: number;
      items: Array<{
        id: number;
        session_type: 'first' | 'regular';
        session_date: string;
        location: string | null;
        price: number;
        was_paid: boolean;
        status: string | null;
        parent_name: string;
        player_names: string[];
      }>;
    };
    potential: {
      count: number;
      total: number;
      items: Array<{
        id: number;
        session_type: 'first' | 'regular';
        session_date: string;
        location: string | null;
        price: number;
        was_paid: boolean;
        status: string | null;
        parent_name: string;
        player_names: string[];
      }>;
    };
  };
  history: {
    past_weeks: Array<{
      week_number: number;
      week_start: string;
      week_end: string;
      range_label: string;
      total: number;
      percentage: number;
      over_goal_percentage: number;
      met_goal: boolean;
    }>;
  };
}

function progressValue(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function FinanceGoalsPage() {
  const [data, setData] = useState<FinanceGoalsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const res = await fetch('/api/finance-goals', { cache: 'no-store' });
      if (res.ok) setData(await res.json());
      setLoading(false);
    };

    fetchData();
  }, []);

  const currency = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );

  if (loading) return <Typography>Loading finance goals...</Typography>;
  if (!data) return <Typography color="error">Failed to load finance goals.</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Finance Goals
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2, mb: 3 }}>
        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Weekly Goal
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
              {currency.format(data.week.total)} / {currency.format(data.goals.weekly)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              No-cancel projection: {currency.format(data.week.projected_total_if_no_cancel)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {data.week.range_label}
            </Typography>
            <LinearProgress variant="determinate" value={progressValue(data.week.percentage)} sx={{ height: 9, borderRadius: 999, mb: 1.25 }} />
            <Chip
              size="small"
              color={data.week.over_goal_percentage > 0 ? 'success' : 'primary'}
              label={
                data.week.over_goal_percentage > 0
                  ? `${data.week.over_goal_percentage.toFixed(1)}% over goal`
                  : `${data.week.percentage.toFixed(1)}% of goal`
              }
            />
            <Chip
              size="small"
              sx={{ ml: 1 }}
              color={data.week.projected_over_goal_percentage_if_no_cancel > 0 ? 'success' : 'default'}
              label={
                data.week.projected_over_goal_percentage_if_no_cancel > 0
                  ? `Projected +${data.week.projected_over_goal_percentage_if_no_cancel.toFixed(1)}%`
                  : `Projected ${data.week.projected_percentage_if_no_cancel.toFixed(1)}%`
              }
            />
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
              Days counted: {data.week.days_counted_label}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Monthly Goal
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
              {currency.format(data.month.total)} / {currency.format(data.goals.monthly)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {data.month.range_label}
            </Typography>
            <LinearProgress variant="determinate" value={progressValue(data.month.percentage)} sx={{ height: 9, borderRadius: 999, mb: 1.25 }} />
            <Chip
              size="small"
              color={data.month.over_goal_percentage > 0 ? 'success' : 'primary'}
              label={
                data.month.over_goal_percentage > 0
                  ? `${data.month.over_goal_percentage.toFixed(1)}% over goal`
                  : `${data.month.percentage.toFixed(1)}% of goal`
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Total Revenue (All Time)
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {currency.format(data.overall.total)}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Paid This Week By Day
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {data.week.range_label}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr 1fr 1fr 1fr 1fr' }, gap: 1.5 }}>
            {data.week.days.map((day) => (
              <Card key={day.day_key} variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {day.day_short}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    {day.date_label}
                  </Typography>
                  <Typography sx={{ fontWeight: 700, mb: 0.75 }}>
                    {currency.format(day.total)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Packages: {currency.format(day.packages)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Sessions: {currency.format(day.sessions)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Group Sessions: {currency.format(day.group_sessions)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Possible: {currency.format(day.sessions_possible)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2, mt: 3 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              Sessions That Happened ({data.sessions.happened.count})
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Actual session value: {currency.format(data.sessions.happened.total)}
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            {data.sessions.happened.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No completed/past sessions with value yet.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.25,
                  maxHeight: 420,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  pr: 0.5,
                }}
              >
                {data.sessions.happened.items.map((s) => (
                  <Card key={`happened-${s.session_type}-${s.id}`} variant="outlined" sx={{ minHeight: 0 }}>
                    <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {s.parent_name}
                        {s.player_names.length > 0 ? ` (${s.player_names.join(', ')})` : ''}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatArizonaDateTime(s.session_date)}
                        {s.location ? ` — ${s.location}` : ''}
                        {` — ${currency.format(s.price)}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.session_type === 'first' ? 'First Session' : 'Session'}
                        {s.status ? ` • ${s.status}` : ''}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              Upcoming Sessions (Potential) ({data.sessions.potential.count})
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Potential session value: {currency.format(data.sessions.potential.total)}
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            {data.sessions.potential.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No upcoming sessions with value right now.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.25,
                  maxHeight: 420,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  pr: 0.5,
                }}
              >
                {data.sessions.potential.items.map((s) => (
                  <Card key={`potential-${s.session_type}-${s.id}`} variant="outlined" sx={{ minHeight: 0 }}>
                    <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {s.parent_name}
                        {s.player_names.length > 0 ? ` (${s.player_names.join(', ')})` : ''}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatArizonaDateTime(s.session_date)}
                        {s.location ? ` — ${s.location}` : ''}
                        {` — ${currency.format(s.price)}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.session_type === 'first' ? 'First Session' : 'Session'}
                        {s.status ? ` • ${s.status}` : ''}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Past Weeks Goal Memory
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Week 1 starts on 12/28/2025. This list keeps growing each week.
          </Typography>
          <Divider sx={{ mb: 1.5 }} />

          <Box sx={{ display: 'grid', gap: 1.25 }}>
            {data.history.past_weeks.map((w) => (
              <Card key={w.week_start} variant="outlined">
                <CardContent
                  sx={{
                    py: 1.25,
                    '&:last-child': { pb: 1.25 },
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: { xs: 'flex-start', sm: 'center' },
                    gap: 1,
                    flexDirection: { xs: 'column', sm: 'row' },
                  }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>
                      Week {w.week_number} • {w.range_label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {currency.format(w.total)} / {currency.format(data.goals.weekly)}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    color={w.met_goal ? 'success' : 'default'}
                    label={
                      w.met_goal
                        ? `Met goal (+${w.over_goal_percentage.toFixed(1)}%)`
                        : `${w.percentage.toFixed(1)}% of goal`
                    }
                  />
                </CardContent>
              </Card>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
