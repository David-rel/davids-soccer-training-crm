'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { CallOutcome, DMStatus, Gender } from '@/lib/types';

interface PlayerInput {
  name: string;
  age: string;
  team: string;
  gender: Gender | '';
  notes: string;
}

const emptyPlayer: PlayerInput = { name: '', age: '', team: '', gender: '', notes: '' };

const dmStatusOptions: { value: DMStatus; label: string }[] = [
  { value: 'first_message', label: 'First Message' },
  { value: 'started_talking', label: 'Started Talking' },
  { value: 'request_phone_call', label: 'Got to Request Phone Call' },
];

export default function ContactForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  const [secondaryParent, setSecondaryParent] = useState('');
  const [dmStatus, setDmStatus] = useState<DMStatus | ''>('');
  const [phoneCallBooked, setPhoneCallBooked] = useState(false);
  const [callDate, setCallDate] = useState('');
  const [callOutcome, setCallOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [players, setPlayers] = useState<PlayerInput[]>([{ ...emptyPlayer }]);

  const addPlayer = () => setPlayers([...players, { ...emptyPlayer }]);

  const removePlayer = (index: number) => {
    if (players.length > 1) {
      setPlayers(players.filter((_, i) => i !== index));
    }
  };

  const updatePlayer = (index: number, field: keyof PlayerInput, value: string) => {
    const updated = [...players];
    updated[index] = { ...updated[index], [field]: value };
    setPlayers(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/parents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          instagram_link: instagram.trim() || null,
          secondary_parent_name: secondaryParent.trim() || null,
          dm_status: dmStatus || null,
          phone_call_booked: phoneCallBooked,
          call_date_time: phoneCallBooked ? (callDate || null) : null,
          call_outcome: phoneCallBooked ? (callOutcome || null) : null,
          notes: notes.trim() || null,
          players: players
            .filter((p) => p.name.trim())
            .map((p) => ({
              name: p.name.trim(),
              age: p.age ? parseInt(p.age) : null,
              team: p.team.trim() || null,
              gender: p.gender || null,
              notes: p.notes.trim() || null,
            })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/contacts/${data.id}`);
      }
    } catch (error) {
      console.error('Error creating contact:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Parent Info
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField label="Parent Name *" value={name} onChange={(e) => setName(e.target.value)} required fullWidth />
            <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" fullWidth />
            <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth />
            <TextField label="Instagram Link" value={instagram} onChange={(e) => setInstagram(e.target.value)} fullWidth />
            <TextField label="Secondary Parent Name" value={secondaryParent} onChange={(e) => setSecondaryParent(e.target.value)} fullWidth />
            <TextField label="DM Status" value={dmStatus} onChange={(e) => setDmStatus(e.target.value as DMStatus)} select fullWidth>
              <MenuItem value="">None</MenuItem>
              {dmStatusOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Phone Call"
              value={phoneCallBooked ? 'booked' : 'not_booked'}
              onChange={(e) => {
                const booked = e.target.value === 'booked';
                setPhoneCallBooked(booked);
                if (!booked) {
                  setCallDate('');
                  setCallOutcome('');
                }
              }}
              select
              fullWidth
            >
              <MenuItem value="not_booked">Not Booked</MenuItem>
              <MenuItem value="booked">Booked</MenuItem>
            </TextField>
            {phoneCallBooked && (
              <TextField
                label="Call Date"
                type="date"
                value={callDate}
                onChange={(e) => setCallDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            )}
            {phoneCallBooked && (
              <TextField
                label="Call Outcome"
                value={callOutcome}
                onChange={(e) => setCallOutcome(e.target.value as CallOutcome)}
                select
                fullWidth
              >
                <MenuItem value="">--</MenuItem>
                <MenuItem value="session_booked">Session Booked</MenuItem>
                <MenuItem value="thinking_about_it">Thinking About It</MenuItem>
                <MenuItem value="uninterested">Uninterested</MenuItem>
                <MenuItem value="went_cold">Went Cold</MenuItem>
              </TextField>
            )}
          </Box>
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline rows={3} fullWidth sx={{ mt: 2 }} />
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Players
            </Typography>
            <Button startIcon={<AddIcon />} onClick={addPlayer} size="small">
              Add Player
            </Button>
          </Box>

          {players.map((player, index) => (
            <Box key={index} sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Player {index + 1}
                </Typography>
                {players.length > 1 && (
                  <IconButton size="small" onClick={() => removePlayer(index)} color="error">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <TextField label="Player Name" value={player.name} onChange={(e) => updatePlayer(index, 'name', e.target.value)} size="small" fullWidth />
                <TextField label="Age" value={player.age} onChange={(e) => updatePlayer(index, 'age', e.target.value)} type="number" size="small" fullWidth />
                <TextField label="Team" value={player.team} onChange={(e) => updatePlayer(index, 'team', e.target.value)} size="small" fullWidth />
                <TextField label="Gender" value={player.gender} onChange={(e) => updatePlayer(index, 'gender', e.target.value)} select size="small" fullWidth>
                  <MenuItem value="">--</MenuItem>
                  <MenuItem value="male">Male</MenuItem>
                  <MenuItem value="female">Female</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </TextField>
              </Box>
              <TextField label="Notes" value={player.notes} onChange={(e) => updatePlayer(index, 'notes', e.target.value)} size="small" fullWidth sx={{ mt: 1 }} />
            </Box>
          ))}
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button variant="contained" type="submit" disabled={saving || !name.trim()} size="large">
          {saving ? 'Saving...' : 'Add Contact'}
        </Button>
        <Button variant="outlined" onClick={() => router.back()} size="large">
          Cancel
        </Button>
      </Box>
    </form>
  );
}
