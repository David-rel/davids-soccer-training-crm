'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Slider from '@mui/material/Slider';

const packageTypeLabels: Record<string, string> = {
  '12_week_1x': '12 Weeks - 1x/week',
  '12_week_2x': '12 Weeks - 2x/week',
  '6_week_1x': '6 Weeks - 1x/week',
  '6_week_2x': '6 Weeks - 2x/week',
};

interface PackageDetail {
  id: number;
  parent_id: number;
  parent_name: string;
  player_names: string[] | null;
  package_type: string;
  total_sessions: number;
  sessions_completed: number;
  price: number | null;
  amount_received: number | null;
  start_date: string | null;
  is_active: boolean;
  sessions: Array<{
    id: number;
    session_date: string;
    player_names: string[] | null;
    showed_up: boolean | null;
    cancelled: boolean;
    was_paid: boolean;
    payment_method: string | null;
  }>;
}

export const dynamic = 'force-dynamic';

export default function PackageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [pkg, setPkg] = useState<PackageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftAmountReceived, setDraftAmountReceived] = useState(0);
  const [savingAmount, setSavingAmount] = useState(false);

  const fetchPackage = useCallback(async () => {
    const res = await fetch(`/api/packages/${id}`);
    if (res.ok) {
      const data: PackageDetail = await res.json();
      setPkg(data);
      setDraftAmountReceived(Number(data.amount_received ?? 0));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchPackage(); }, [fetchPackage]);

  const toggleActive = async () => {
    if (!pkg) return;
    await fetch(`/api/packages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !pkg.is_active }),
    });
    fetchPackage();
  };

  const saveAmountReceived = async (value: number) => {
    if (!pkg) return;
    const priceCap = Number(pkg.price ?? 0);
    const clamped = Math.min(Math.max(0, value), priceCap);
    const current = Number(pkg.amount_received ?? 0);
    if (Math.abs(clamped - current) < 0.01) return;

    setSavingAmount(true);
    const res = await fetch(`/api/packages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_received: clamped,
        payment_note: 'slider_update_detail',
      }),
    });

    if (res.ok) {
      const updated = await res.json();
      setPkg((prev) => (prev ? { ...prev, amount_received: Number(updated.amount_received ?? clamped) } : prev));
      setDraftAmountReceived(Number(updated.amount_received ?? clamped));
    } else {
      setDraftAmountReceived(current);
    }
    setSavingAmount(false);
  };

  if (loading) return <Typography>Loading...</Typography>;
  if (!pkg) return <Typography>Package not found.</Typography>;

  const progress = pkg.total_sessions > 0 ? (pkg.sessions_completed / pkg.total_sessions) * 100 : 0;
  const packagePrice = Number(pkg.price ?? 0);
  const sliderValue = Math.min(Math.max(0, draftAmountReceived), packagePrice);
  const percentReceived = packagePrice > 0 ? (sliderValue / packagePrice) * 100 : 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {pkg.parent_name}
            {pkg.player_names && pkg.player_names.length > 0 && (
              <Typography component="span" variant="h4" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1 }}>
                ({pkg.player_names.join(', ')})
              </Typography>
            )}
          </Typography>
          <Typography color="text.secondary">
            {packageTypeLabels[pkg.package_type] || pkg.package_type}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip label={pkg.is_active ? 'Active' : 'Completed'} color={pkg.is_active ? 'success' : 'default'} />
          <Button size="small" variant="outlined" onClick={toggleActive}>
            {pkg.is_active ? 'Mark Complete' : 'Reactivate'}
          </Button>
        </Box>
      </Box>

      {/* Progress */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Progress</Typography>
            <Typography sx={{ fontWeight: 700 }}>
              {pkg.sessions_completed} / {pkg.total_sessions} sessions
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={progress} sx={{ height: 12, borderRadius: 6 }} />
          {pkg.price && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Package price: ${pkg.price}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Received so far: ${sliderValue.toFixed(2)} / ${packagePrice.toFixed(2)}
            {packagePrice > 0 ? ` (${percentReceived.toFixed(0)}%)` : ''}
          </Typography>
          <Slider
            value={sliderValue}
            min={0}
            max={packagePrice > 0 ? packagePrice : 0}
            step={1}
            disabled={packagePrice <= 0 || savingAmount}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `$${Number(value).toFixed(0)}`}
            onChange={(_, value) => setDraftAmountReceived(value as number)}
            onChangeCommitted={(_, value) => saveAmountReceived(value as number)}
            sx={{ mt: 1 }}
          />
          {packagePrice <= 0 && (
            <Typography variant="caption" color="text.secondary">
              Add package price to track money received.
            </Typography>
          )}
          {pkg.start_date && (
            <Typography variant="body2" color="text.secondary">
              Started: {new Date(pkg.start_date).toLocaleDateString()}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Sessions in this package */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Sessions ({pkg.sessions.length})
            </Typography>
            <Button size="small" variant="contained" onClick={() => router.push(`/sessions/new?parent_id=${pkg.parent_id}&package_id=${pkg.id}`)}>
              Schedule Session
            </Button>
          </Box>
          {pkg.sessions.length === 0 ? (
            <Typography color="text.secondary" variant="body2">No sessions booked for this package yet.</Typography>
          ) : (
            pkg.sessions.map((s) => (
              <Box key={s.id} sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2, mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>
                    {new Date(s.session_date).toLocaleDateString()}
                  </Typography>
                  {s.player_names && s.player_names.length > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {s.player_names.join(', ')}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {s.showed_up === true && <Chip label="Showed" color="success" size="small" />}
                  {s.cancelled && <Chip label="Cancelled" color="error" size="small" />}
                  {s.was_paid && <Chip label={`Paid (${s.payment_method})`} size="small" variant="outlined" />}
                  {s.showed_up === null && !s.cancelled && <Chip label="Upcoming" color="info" size="small" />}
                </Box>
              </Box>
            ))
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
