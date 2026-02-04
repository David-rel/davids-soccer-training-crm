'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import LinearProgress from '@mui/material/LinearProgress';
import AddIcon from '@mui/icons-material/Add';
import type { Parent } from '@/lib/types';

const packageTypeLabels: Record<string, string> = {
  '12_week_1x': '12 Weeks - 1x/week (12 sessions)',
  '12_week_2x': '12 Weeks - 2x/week (24 sessions)',
  '6_week_1x': '6 Weeks - 1x/week (6 sessions)',
  '6_week_2x': '6 Weeks - 2x/week (12 sessions)',
};

interface PackageRow {
  id: number;
  parent_id: number;
  parent_name: string;
  player_names: string[] | null;
  package_type: string;
  total_sessions: number;
  sessions_completed: number;
  price: number | null;
  start_date: string | null;
  is_active: boolean;
}

export const dynamic = 'force-dynamic';

export default function PackagesPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [parents, setParents] = useState<Parent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parentId, setParentId] = useState('');
  const [packageType, setPackageType] = useState('');
  const [price, setPrice] = useState('');
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPackages = async () => {
    setLoading(true);
    const [pkgRes, parRes] = await Promise.all([
      fetch('/api/packages'),
      fetch('/api/parents'),
    ]);
    if (pkgRes.ok) setPackages(await pkgRes.json());
    if (parRes.ok) setParents(await parRes.json());
    setLoading(false);
  };

  useEffect(() => { fetchPackages(); }, []);

  const handleCreate = async () => {
    if (!parentId || !packageType) return;
    setSaving(true);
    const res = await fetch('/api/packages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent_id: parseInt(parentId),
        package_type: packageType,
        price: price ? parseFloat(price) : null,
        start_date: startDate || null,
      }),
    });
    if (res.ok) {
      setDialogOpen(false);
      setParentId('');
      setPackageType('');
      setPrice('');
      setStartDate('');
      fetchPackages();
    }
    setSaving(false);
  };

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Packages</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          New Package
        </Button>
      </Box>

      {packages.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography color="text.secondary">No packages yet. Create one for a client!</Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {packages.map((pkg) => {
            const progress = pkg.total_sessions > 0 ? (pkg.sessions_completed / pkg.total_sessions) * 100 : 0;
            return (
              <Card key={pkg.id}>
                <CardActionArea onClick={() => router.push(`/packages/${pkg.id}`)}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Box>
                        <Typography sx={{ fontWeight: 600 }}>
                          {pkg.parent_name}
                          {pkg.player_names && pkg.player_names.length > 0 && (
                            <Typography component="span" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1 }}>
                              ({pkg.player_names.join(', ')})
                            </Typography>
                          )}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {packageTypeLabels[pkg.package_type] || pkg.package_type}
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Chip label={pkg.is_active ? 'Active' : 'Completed'} color={pkg.is_active ? 'success' : 'default'} size="small" />
                        {pkg.price && <Typography variant="body2" sx={{ mt: 0.5 }}>${pkg.price}</Typography>}
                      </Box>
                    </Box>
                    <Box sx={{ mt: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">Progress</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {pkg.sessions_completed}/{pkg.total_sessions} sessions
                        </Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Create Package Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Package Deal</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Parent *" value={parentId} onChange={(e) => setParentId(e.target.value)} select fullWidth>
              {parents.map((p: any) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                  {p.player_names && p.player_names.length > 0 && ` (${p.player_names.join(', ')})`}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Package Type *" value={packageType} onChange={(e) => setPackageType(e.target.value)} select fullWidth>
              {Object.entries(packageTypeLabels).map(([val, label]) => (
                <MenuItem key={val} value={val}>{label}</MenuItem>
              ))}
            </TextField>
            <TextField label="Total Price ($)" value={price} onChange={(e) => setPrice(e.target.value)} type="number" fullWidth />
            <TextField label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained" disabled={saving || !parentId || !packageType}>
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
