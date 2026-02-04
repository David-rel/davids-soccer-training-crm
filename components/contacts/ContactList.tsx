'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import type { Parent } from '@/lib/types';

interface ParentRow extends Parent {
  player_count: number;
  sessions_count: number;
  first_sessions_count: number;
  total_paid: number;
  player_names: string[] | null;
  last_activity_at: string;
  is_customer?: boolean;
  active_package_type?: string | null;
}

// Helper to determine if a lead is going cold
function isGoingCold(parent: ParentRow): { cold: boolean; daysInactive: number } {
  if (!parent.last_activity_at) return { cold: false, daysInactive: 0 };
  
  const lastActivity = new Date(parent.last_activity_at);
  const now = new Date();
  const daysInactive = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
  
  // Different thresholds based on stage
  let threshold = 7; // default
  
  if (parent.dm_status === 'first_message') {
    threshold = 2;
  } else if (parent.dm_status === 'started_talking' || parent.dm_status === 'request_phone_call') {
    threshold = 3;
  } else if (parent.phone_call_booked) {
    threshold = 5;
  } else if (parent.is_customer) {
    threshold = 14;
  }
  
  return { cold: daysInactive >= threshold, daysInactive };
}

const dmStatusLabels: Record<string, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error' }> = {
  first_message: { label: 'First Message', color: 'info' },
  started_talking: { label: 'Started Talking', color: 'warning' },
  request_phone_call: { label: 'Request Call', color: 'success' },
  went_cold: { label: 'Went Cold', color: 'error' },
};

const callOutcomeLabels: Record<string, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error' }> = {
  session_booked: { label: 'Session Booked', color: 'success' },
  thinking_about_it: { label: 'Thinking About It', color: 'warning' },
  uninterested: { label: 'Uninterested', color: 'error' },
  went_cold: { label: 'Went Cold', color: 'error' },
};

export default function ContactList() {
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchParents = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('sort', sort);
      const res = await fetch(`/api/parents?${params}`);
      if (res.ok) {
        setParents(await res.json());
      }
      setLoading(false);
    };

    const debounce = setTimeout(fetchParents, 300);
    return () => clearTimeout(debounce);
  }, [search, sort]);

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          select
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="recent">Most Recent</MenuItem>
          <MenuItem value="name">Name (A-Z)</MenuItem>
          <MenuItem value="most_sessions">Most Sessions</MenuItem>
          <MenuItem value="most_paid">💰 Best Clients</MenuItem>
        </TextField>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading...</Typography>
      ) : parents.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography color="text.secondary">
              {search ? 'No contacts match your search.' : 'No contacts yet. Add your first one!'}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {parents.map((parent) => (
            <Card key={parent.id}>
              <CardActionArea component={Link} href={`/contacts/${parent.id}`}>
                <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {parent.name}
                      {parent.player_names && parent.player_names.length > 0 && (
                        <Typography component="span" variant="h6" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1 }}>
                          ({parent.player_names.join(', ')})
                        </Typography>
                      )}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                      {parent.phone && (
                        <Typography variant="body2" color="text.secondary">{parent.phone}</Typography>
                      )}
                      {parent.instagram_link && (
                        <Typography variant="body2" color="text.secondary">IG</Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                      {(() => {
                        const coldStatus = isGoingCold(parent);
                        return coldStatus.cold && (
                          <Chip
                            label={`🥶 Going Cold (${coldStatus.daysInactive}d)`}
                            size="small"
                            sx={{
                              bgcolor: 'warning.main',
                              color: 'white',
                              fontWeight: 600
                            }}
                          />
                        );
                      })()}
                      {parent.active_package_type && (
                        <Chip
                          label={`📦 ${parent.active_package_type.replace(/_/g, ' ').toUpperCase()}`}
                          size="small"
                          sx={{
                            bgcolor: 'success.main',
                            color: 'white',
                            fontWeight: 600
                          }}
                        />
                      )}
                      {parent.dm_status && dmStatusLabels[parent.dm_status] && (
                        <Chip
                          label={dmStatusLabels[parent.dm_status].label}
                          color={dmStatusLabels[parent.dm_status].color}
                          size="small"
                        />
                      )}
                      {parent.call_outcome && callOutcomeLabels[parent.call_outcome] && (
                        <Chip
                          label={callOutcomeLabels[parent.call_outcome].label}
                          color={callOutcomeLabels[parent.call_outcome].color}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" color="text.secondary">
                      {parent.player_count} player{parent.player_count !== 1 ? 's' : ''}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {Number(parent.first_sessions_count) + Number(parent.sessions_count)} sessions
                    </Typography>
                    {Number(parent.total_paid) > 0 && (
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main', fontSize: '1.1rem' }}>
                        ${Number(parent.total_paid).toFixed(0)} revenue
                      </Typography>
                    )}
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
