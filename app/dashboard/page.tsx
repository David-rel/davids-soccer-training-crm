'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CheckIcon from '@mui/icons-material/Check';
import PhoneIcon from '@mui/icons-material/Phone';
import EventIcon from '@mui/icons-material/Event';
import NotificationsIcon from '@mui/icons-material/Notifications';
import PeopleIcon from '@mui/icons-material/People';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CancelIcon from '@mui/icons-material/Cancel';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EditIcon from '@mui/icons-material/Edit';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ViewListIcon from '@mui/icons-material/ViewList';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import CalendarView from '@/components/dashboard/CalendarView';
import { formatArizonaDate, formatArizonaTime, toDatetimeLocal } from '@/lib/timezone';

const reminderCategoryLabels: Record<string, string> = {
  session_reminder: 'Session Reminder',
  dm_follow_up: 'DM Follow-up',
  post_call_follow_up: 'Post-Call Follow-up',
  post_first_session_follow_up: 'Post-First-Session Follow-up',
  post_session_follow_up: 'Client Drop-off Follow-up',
};

const reminderTypeLabels: Record<string, string> = {
  session_48h: '48h before',
  session_24h: '24h before',
  session_6h: '6h before',
  follow_up_1d: 'Day 1',
  follow_up_3d: 'Day 3',
  follow_up_7d: 'Day 7',
  follow_up_14d: 'Day 14',
};

interface DashboardData {
  todays_calls: Array<{ id: number; name: string; call_date_time: string | null; phone: string }>;
  todays_first_sessions: Array<{ id: number; parent_id: number; parent_name: string; player_names: string[] | null; player_ids: number[] | null; session_date: string; location: string | null; price: number | null; status: string }>;
  todays_sessions: Array<{ id: number; parent_id: number; parent_name: string; player_names: string[] | null; player_ids: number[] | null; session_date: string; location: string | null; price: number | null; status: string }>;
  pending_reminders: Array<{ id: number; parent_name: string; parent_id: number; reminder_type: string; reminder_category: string; due_at: string }>;
  stats: { total_contacts: number; sessions_this_week: number; revenue_this_month: number };
}

interface Player {
  id: number;
  name: string;
}

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [editDialog, setEditDialog] = useState<{ id: number; parent_id: number; type: 'first' | 'regular' } | null>(null);
  const [editForm, setEditForm] = useState({
    session_date: '',
    location: '',
    price: '',
    player_ids: [] as number[],
  });
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);

  const fetchDashboard = useCallback(async () => {
    const res = await fetch('/api/dashboard');
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const markReminderSent = async (id: number) => {
    await fetch(`/api/reminders/${id}/mark-sent`, { method: 'POST' });
    fetchDashboard();
  };

  const updateFirstSessionStatus = async (id: number, action: 'accept' | 'cancel' | 'reschedule' | 'no-show') => {
    await fetch(`/api/first-sessions/${id}/${action}`, { method: 'POST' });
    
    // Update locally without refetching to prevent scroll jump
    const statusMap = {
      accept: 'accepted',
      cancel: 'cancelled',
      reschedule: 'rescheduled',
      'no-show': 'no_show'
    };
    
    setData(prev => prev ? {
      ...prev,
      todays_first_sessions: prev.todays_first_sessions.map(s =>
        s.id === id ? { ...s, status: statusMap[action] } : s
      )
    } : null);
  };

  const updateSessionStatus = async (id: number, action: 'accept' | 'cancel' | 'reschedule' | 'no-show') => {
    await fetch(`/api/sessions/${id}/${action}`, { method: 'POST' });
    
    // Update locally without refetching to prevent scroll jump
    const statusMap = {
      accept: 'accepted',
      cancel: 'cancelled',
      reschedule: 'rescheduled',
      'no-show': 'no_show'
    };
    
    setData(prev => prev ? {
      ...prev,
      todays_sessions: prev.todays_sessions.map(s =>
        s.id === id ? { ...s, status: statusMap[action] } : s
      )
    } : null);
  };

  const openEditDialog = async (session: any, type: 'first' | 'regular') => {
    // Fetch parent's players
    const res = await fetch(`/api/parents/${session.parent_id}/players`);
    if (res.ok) {
      const players = await res.json();
      setAvailablePlayers(players);
    }
    
    setEditForm({
      session_date: toDatetimeLocal(session.session_date),
      location: session.location || '',
      price: session.price?.toString() || '',
      player_ids: session.player_ids || [],
    });
    setEditDialog({ id: session.id, parent_id: session.parent_id, type });
  };

  const handleEdit = async () => {
    if (!editDialog) return;
    const { id, type } = editDialog;
    const endpoint = type === 'first'
      ? `/api/first-sessions/${id}`
      : `/api/sessions/${id}`;

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
      ? `/api/first-sessions/${id}/players`
      : `/api/sessions/${id}/players`;
    
    await fetch(playersEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_ids: editForm.player_ids,
      }),
    });

    setEditDialog(null);
    fetchDashboard();
  };

  if (loading) return <Typography>Loading dashboard...</Typography>;
  if (!data) return <Typography color="error">Failed to load dashboard.</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Dashboard
        </Typography>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(e, newView) => newView && setViewMode(newView)}
          size="small"
        >
          <ToggleButton value="list">
            <ViewListIcon sx={{ mr: 1 }} />
            List
          </ToggleButton>
          <ToggleButton value="calendar">
            <CalendarMonthIcon sx={{ mr: 1 }} />
            Calendar
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {viewMode === 'calendar' ? (
        <CalendarView />
      ) : (
        <>
          {/* Stats Row */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mb: 3 }}>
        <Card>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <PeopleIcon sx={{ color: 'primary.main', fontSize: 32 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{data.stats.total_contacts}</Typography>
              <Typography variant="body2" color="text.secondary">Total Contacts</Typography>
            </Box>
          </CardContent>
        </Card>
        <Card>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <EventIcon sx={{ color: 'primary.main', fontSize: 32 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{data.stats.sessions_this_week}</Typography>
              <Typography variant="body2" color="text.secondary">Sessions This Week</Typography>
            </Box>
          </CardContent>
        </Card>
        <Card>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <AttachMoneyIcon sx={{ color: 'primary.main', fontSize: 32 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>${Number(data.stats.revenue_this_month).toFixed(0)}</Typography>
              <Typography variant="body2" color="text.secondary">Revenue This Month</Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Today's Calls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <PhoneIcon sx={{ color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Today&apos;s Calls ({data.todays_calls.length})
            </Typography>
          </Box>
          {data.todays_calls.length === 0 ? (
            <Typography color="text.secondary" variant="body2">No calls scheduled today.</Typography>
          ) : (
            data.todays_calls.map((call) => (
              <Box key={call.id} sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2, mb: 1, cursor: 'pointer' }} onClick={() => router.push(`/contacts/${call.id}`)}>
                <Typography sx={{ fontWeight: 600 }}>{call.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {call.call_date_time ? formatArizonaDate(call.call_date_time) : 'No date set'}
                  {call.phone && ` — ${call.phone}`}
                </Typography>
              </Box>
            ))
          )}
        </CardContent>
      </Card>

      {/* Today's Sessions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <EventIcon sx={{ color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Today&apos;s Sessions ({data.todays_first_sessions.length + data.todays_sessions.length})
            </Typography>
          </Box>
          {data.todays_first_sessions.length === 0 && data.todays_sessions.length === 0 ? (
            <Typography color="text.secondary" variant="body2">No sessions today.</Typography>
          ) : (
            <>
              {data.todays_first_sessions.map((s) => {
                // Determine background color based on status
                const getBackgroundColor = () => {
                  if (s.status === 'accepted') return 'success.light';
                  if (s.status === 'cancelled') return 'error.light';
                  if (s.status === 'rescheduled') return 'warning.light';
                  if (s.status === 'no_show') return 'error.dark';
                  if (s.status === 'completed') return 'success.dark';
                  return 'grey.50';
                };
                
                return (
                <Box key={`fs-${s.id}`} sx={{ p: 1.5, bgcolor: getBackgroundColor(), borderRadius: 2, mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography sx={{ fontWeight: 600 }}>{s.parent_name}</Typography>
                        {s.player_names && s.player_names.length > 0 && (
                          <Typography variant="body2" color="text.secondary">
                            ({s.player_names.join(', ')})
                          </Typography>
                        )}
                        <Chip label="First Session" size="small" color="primary" />
                        {s.status !== 'scheduled' && (
                          <Chip 
                            label={s.status.replace('_', ' ')} 
                            size="small" 
                            color={s.status === 'accepted' ? 'success' : s.status === 'cancelled' ? 'error' : 'warning'}
                          />
                        )}
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {formatArizonaTime(s.session_date)}
                        {s.location && ` — ${s.location}`}
                        {s.price && ` — $${s.price}`}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditIcon />}
                      onClick={() => openEditDialog(s, 'first')}
                    >
                      Edit
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="success" 
                      startIcon={<EventAvailableIcon />}
                      onClick={() => updateFirstSessionStatus(s.id, 'accept')}
                    >
                      Accept
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="warning" 
                      startIcon={<EventRepeatIcon />}
                      onClick={() => updateFirstSessionStatus(s.id, 'reschedule')}
                    >
                      Reschedule
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="error" 
                      startIcon={<CancelIcon />}
                      onClick={() => updateFirstSessionStatus(s.id, 'cancel')}
                    >
                      Cancel
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="error" 
                      startIcon={<EventBusyIcon />}
                      onClick={() => updateFirstSessionStatus(s.id, 'no-show')}
                    >
                      No Show
                    </Button>
                  </Box>
                </Box>
                );
              })}
              {data.todays_sessions.map((s) => {
                // Determine background color based on status
                const getBackgroundColor = () => {
                  if (s.status === 'accepted') return 'success.light';
                  if (s.status === 'cancelled') return 'error.light';
                  if (s.status === 'rescheduled') return 'warning.light';
                  if (s.status === 'no_show') return 'error.dark';
                  if (s.status === 'completed') return 'success.dark';
                  return 'grey.50';
                };
                
                return (
                <Box key={`s-${s.id}`} sx={{ p: 1.5, bgcolor: getBackgroundColor(), borderRadius: 2, mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography sx={{ fontWeight: 600 }}>{s.parent_name}</Typography>
                        {s.player_names && s.player_names.length > 0 && (
                          <Typography variant="body2" color="text.secondary">
                            ({s.player_names.join(', ')})
                          </Typography>
                        )}
                        {s.status !== 'scheduled' && (
                          <Chip 
                            label={s.status.replace('_', ' ')} 
                            size="small" 
                            color={s.status === 'accepted' ? 'success' : s.status === 'cancelled' ? 'error' : 'warning'}
                          />
                        )}
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {formatArizonaTime(s.session_date)}
                        {s.location && ` — ${s.location}`}
                        {s.price && ` — $${s.price}`}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditIcon />}
                      onClick={() => openEditDialog(s, 'regular')}
                    >
                      Edit
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="success" 
                      startIcon={<EventAvailableIcon />}
                      onClick={() => updateSessionStatus(s.id, 'accept')}
                    >
                      Accept
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="warning" 
                      startIcon={<EventRepeatIcon />}
                      onClick={() => updateSessionStatus(s.id, 'reschedule')}
                    >
                      Reschedule
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="error" 
                      startIcon={<CancelIcon />}
                      onClick={() => updateSessionStatus(s.id, 'cancel')}
                    >
                      Cancel
                    </Button>
                    <Button 
                      size="small" 
                      variant="outlined" 
                      color="error" 
                      startIcon={<EventBusyIcon />}
                      onClick={() => updateSessionStatus(s.id, 'no-show')}
                    >
                      No Show
                    </Button>
                  </Box>
                </Box>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pending Reminders */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <NotificationsIcon sx={{ color: data.pending_reminders.length > 0 ? 'error.main' : 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Text Reminders ({data.pending_reminders.length})
            </Typography>
          </Box>
          {data.pending_reminders.length === 0 ? (
            <Typography color="text.secondary" variant="body2">No reminders due right now.</Typography>
          ) : (
            data.pending_reminders.map((reminder) => (
              <Box key={reminder.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, bgcolor: 'grey.50', borderRadius: 2, mb: 1 }}>
                <Box sx={{ cursor: 'pointer' }} onClick={() => router.push(`/contacts/${reminder.parent_id}`)}>
                  <Typography sx={{ fontWeight: 600 }}>
                    Text {reminder.parent_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {reminderCategoryLabels[reminder.reminder_category] || reminder.reminder_category}
                    {' — '}
                    {reminderTypeLabels[reminder.reminder_type] || reminder.reminder_type}
                  </Typography>
                </Box>
                <IconButton color="success" onClick={() => markReminderSent(reminder.id)} title="Mark as sent">
                  <CheckIcon />
                </IconButton>
              </Box>
            ))
          )}
        </CardContent>
      </Card>

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
        </>
      )}
    </Box>
  );
}
