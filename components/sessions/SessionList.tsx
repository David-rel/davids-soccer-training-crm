'use client';

import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import CancelIcon from '@mui/icons-material/Cancel';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EditIcon from '@mui/icons-material/Edit';

interface SessionRow {
  id: number;
  parent_id: number;
  parent_name: string;
  player_names: string[] | null;
  player_ids: number[] | null;
  session_date: string;
  location: string | null;
  price: number | null;
  status?: string;
  showed_up: boolean | null;
  cancelled: boolean;
  was_paid: boolean;
  payment_method: string | null;
  deposit_paid?: boolean;
  deposit_amount?: number | null;
}

interface Player {
  id: number;
  name: string;
}

export default function SessionList() {
  const [firstSessions, setFirstSessions] = useState<SessionRow[]>([]);
  const [regularSessions, setRegularSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [completeDialog, setCompleteDialog] = useState<{ session: SessionRow; type: 'first' | 'regular' } | null>(null);
  const [showedUp, setShowedUp] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  const [wasPaid, setWasPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [editDialog, setEditDialog] = useState<{ session: SessionRow; type: 'first' | 'regular' } | null>(null);
  const [editForm, setEditForm] = useState({
    session_date: '',
    location: '',
    price: '',
    notes: '',
    player_ids: [] as number[],
  });
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);

  const fetchSessions = async () => {
    setLoading(true);
    const [fsRes, sRes] = await Promise.all([
      fetch('/api/first-sessions'),
      fetch('/api/sessions'),
    ]);
    if (fsRes.ok) setFirstSessions(await fsRes.json());
    if (sRes.ok) setRegularSessions(await sRes.json());
    setLoading(false);
  };

  useEffect(() => { fetchSessions(); }, []);

  const handleComplete = async () => {
    if (!completeDialog) return;
    const { session, type } = completeDialog;
    const endpoint = type === 'first'
      ? `/api/first-sessions/${session.id}/complete`
      : `/api/sessions/${session.id}/complete`;

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showed_up: showedUp,
        cancelled,
        was_paid: wasPaid,
        payment_method: wasPaid ? paymentMethod : null,
      }),
    });

    setCompleteDialog(null);
    fetchSessions();
  };

  const openComplete = (session: SessionRow, type: 'first' | 'regular') => {
    setShowedUp(true);
    setCancelled(false);
    setWasPaid(false);
    setPaymentMethod('');
    setCompleteDialog({ session, type });
  };

  const updateSessionStatus = async (sessionId: number, type: 'first' | 'regular', action: 'accept' | 'cancel' | 'reschedule' | 'no-show') => {
    const endpoint = type === 'first'
      ? `/api/first-sessions/${sessionId}/${action}`
      : `/api/sessions/${sessionId}/${action}`;
    
    await fetch(endpoint, { method: 'POST' });
    
    // Update locally without refetching to prevent scroll jump
    const statusMap = {
      accept: 'accepted',
      cancel: 'cancelled',
      reschedule: 'rescheduled',
      'no-show': 'no_show'
    };
    
    if (type === 'first') {
      setFirstSessions(prev => prev.map(s => 
        s.id === sessionId ? { ...s, status: statusMap[action] } : s
      ));
    } else {
      setRegularSessions(prev => prev.map(s => 
        s.id === sessionId ? { ...s, status: statusMap[action] } : s
      ));
    }
  };

  const openEditDialog = async (session: SessionRow, type: 'first' | 'regular') => {
    // Fetch parent's players
    const res = await fetch(`/api/parents/${session.parent_id}/players`);
    if (res.ok) {
      const players = await res.json();
      setAvailablePlayers(players);
    }
    
    setEditForm({
      session_date: new Date(session.session_date).toISOString().slice(0, 16),
      location: session.location || '',
      price: session.price?.toString() || '',
      notes: '',
      player_ids: session.player_ids || [],
    });
    setEditDialog({ session, type });
  };

  const handleEdit = async () => {
    if (!editDialog) return;
    const { session, type } = editDialog;
    const endpoint = type === 'first'
      ? `/api/first-sessions/${session.id}`
      : `/api/sessions/${session.id}`;

    // Update session details
    await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_date: editForm.session_date,
        location: editForm.location.trim() || null,
        price: editForm.price ? parseFloat(editForm.price) : null,
      }),
    });

    // Update players
    const playersEndpoint = type === 'first'
      ? `/api/first-sessions/${session.id}/players`
      : `/api/sessions/${session.id}/players`;
    
    await fetch(playersEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_ids: editForm.player_ids,
      }),
    });

    setEditDialog(null);
    fetchSessions();
  };

  const allSessions = [
    ...firstSessions.map((s) => ({ ...s, sessionType: 'first' as const })),
    ...regularSessions.map((s) => ({ ...s, sessionType: 'regular' as const })),
  ];

  // Split into upcoming and past sessions
  const now = new Date();
  const upcomingSessions = allSessions
    .filter((s) => new Date(s.session_date) > now && !s.cancelled && s.showed_up === null)
    .sort((a, b) => new Date(a.session_date).getTime() - new Date(b.session_date).getTime()); // Earliest first

  const pastSessions = allSessions
    .filter((s) => new Date(s.session_date) <= now || s.cancelled || s.showed_up !== null)
    .sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime()); // Most recent first

  if (loading) return <Typography color="text.secondary">Loading...</Typography>;

  if (allSessions.length === 0) {
    return (
      <Card>
        <CardContent sx={{ textAlign: 'center', py: 6 }}>
          <Typography color="text.secondary">No sessions yet. Book your first one!</Typography>
        </CardContent>
      </Card>
    );
  }

  const renderSession = (session: typeof allSessions[0]) => {
    // Determine background color based on status
    const getBackgroundColor = () => {
      if (session.status === 'accepted') return 'success.50';
      if (session.status === 'cancelled') return 'error.50';
      if (session.status === 'rescheduled') return 'warning.50';
      if (session.status === 'no_show') return 'error.100';
      if (session.status === 'completed') return 'success.100';
      return 'background.paper';
    };

    return (
            <Card key={`${session.sessionType}-${session.id}`} sx={{ bgcolor: getBackgroundColor() }}>
              <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                    <Typography sx={{ fontWeight: 600 }}>{session.parent_name}</Typography>
                    {session.player_names && session.player_names.length > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        ({session.player_names.join(', ')})
                      </Typography>
                    )}
                    {session.sessionType === 'first' && (
                      <Chip label="First Session" size="small" color="primary" />
                    )}
                    {session.status && session.status !== 'scheduled' && (
                      <Chip 
                        label={session.status.replace('_', ' ')} 
                        size="small" 
                        color={session.status === 'accepted' ? 'success' : session.status === 'cancelled' ? 'error' : 'warning'}
                      />
                    )}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(session.session_date).toLocaleString()}
                    {session.location && ` — ${session.location}`}
                    {session.price && ` — $${session.price}`}
                  </Typography>
                  {session.sessionType === 'first' && session.deposit_paid && (
                    <Typography variant="body2" color="primary.main">
                      Deposit: ${session.deposit_amount || 'Paid'}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {session.showed_up === true && <Chip label="Showed Up" color="success" size="small" />}
                  {session.cancelled && <Chip label="Cancelled" color="error" size="small" />}
                  {session.was_paid && <Chip label={`Paid (${session.payment_method})`} size="small" variant="outlined" />}
                  {/* Show action buttons for all sessions (upcoming and past) */}
                  <Button 
                    size="small" 
                    variant="outlined" 
                    startIcon={<EditIcon />}
                    onClick={() => openEditDialog(session, session.sessionType)}
                  >
                    Edit
                  </Button>
                  <Button 
                    size="small" 
                    variant="outlined" 
                    color="success" 
                    startIcon={<EventAvailableIcon />}
                    onClick={() => updateSessionStatus(session.id, session.sessionType, 'accept')}
                  >
                    Accept
                  </Button>
                  <Button 
                    size="small" 
                    variant="outlined" 
                    color="warning" 
                    startIcon={<EventRepeatIcon />}
                    onClick={() => updateSessionStatus(session.id, session.sessionType, 'reschedule')}
                  >
                    Reschedule
                  </Button>
                  <Button 
                    size="small" 
                    variant="outlined" 
                    color="error" 
                    startIcon={<CancelIcon />}
                    onClick={() => updateSessionStatus(session.id, session.sessionType, 'cancel')}
                  >
                    Cancel
                  </Button>
                  <Button 
                    size="small" 
                    variant="outlined" 
                    color="error" 
                    startIcon={<EventBusyIcon />}
                    onClick={() => updateSessionStatus(session.id, session.sessionType, 'no-show')}
                  >
                    No Show
                  </Button>
                </Box>
              </CardContent>
            </Card>
    );
  };

  return (
    <Box>
      {/* Upcoming Sessions */}
      {upcomingSessions.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Upcoming Sessions ({upcomingSessions.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {upcomingSessions.map((session) => renderSession(session))}
          </Box>
        </Box>
      )}

      {/* Past Sessions */}
      {pastSessions.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Past Sessions ({pastSessions.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {pastSessions.map((session) => renderSession(session))}
          </Box>
        </Box>
      )}

      {/* Complete Session Dialog */}
      <Dialog open={!!completeDialog} onClose={() => setCompleteDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Complete Session</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControlLabel
              control={<Checkbox checked={showedUp} onChange={(e) => { setShowedUp(e.target.checked); if (e.target.checked) setCancelled(false); }} />}
              label="Showed Up"
            />
            <FormControlLabel
              control={<Checkbox checked={cancelled} onChange={(e) => { setCancelled(e.target.checked); if (e.target.checked) setShowedUp(false); }} />}
              label="Cancelled"
            />
            <FormControlLabel
              control={<Checkbox checked={wasPaid} onChange={(e) => setWasPaid(e.target.checked)} />}
              label="Was Paid"
            />
            {wasPaid && (
              <TextField
                label="Payment Method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                select
                fullWidth
              >
                <MenuItem value="zelle">Zelle</MenuItem>
                <MenuItem value="venmo">Venmo</MenuItem>
                <MenuItem value="paypal">PayPal</MenuItem>
                <MenuItem value="apple_cash">Apple Cash</MenuItem>
                <MenuItem value="cash">Cash</MenuItem>
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteDialog(null)}>Cancel</Button>
          <Button onClick={handleComplete} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Session Dialog */}
      <Dialog open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Session</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Session Date/Time"
              type="datetime-local"
              fullWidth
              value={editForm.session_date}
              onChange={(e) => setEditForm({ ...editForm, session_date: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Location"
              fullWidth
              value={editForm.location}
              onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
            />
            <TextField
              label="Price ($)"
              type="number"
              fullWidth
              value={editForm.price}
              onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
            />
            {availablePlayers.length > 0 && (
              <TextField
                label="Players (select multiple)"
                select
                fullWidth
                SelectProps={{ 
                  multiple: true,
                  value: editForm.player_ids,
                  onChange: (e) => setEditForm({ ...editForm, player_ids: e.target.value as unknown as number[] })
                }}
              >
                {availablePlayers.map((player) => (
                  <MenuItem key={player.id} value={player.id}>{player.name}</MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(null)}>Cancel</Button>
          <Button onClick={handleEdit} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
