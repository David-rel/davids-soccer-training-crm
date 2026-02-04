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

interface CustomerRow extends Parent {
  player_count: number;
  sessions_count: number;
  first_sessions_count: number;
  total_paid: number;
  active_package_type: string | null;
  player_names: string[] | null;
}

const packageTypeLabels: Record<string, string> = {
  '12_week_1x': '12-Week 1x/wk',
  '12_week_2x': '12-Week 2x/wk',
  '6_week_1x': '6-Week 1x/wk',
  '6_week_2x': '6-Week 2x/wk',
};

export default function CustomerList() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('filter', 'customers');
      if (search) params.set('search', search);
      params.set('sort', sort);
      const res = await fetch(`/api/parents?${params}`);
      if (res.ok) {
        setCustomers(await res.json());
      }
      setLoading(false);
    };

    const debounce = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(debounce);
  }, [search, sort]);

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          placeholder="Search customers..."
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
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="recent">Most Recent</MenuItem>
          <MenuItem value="name">Name</MenuItem>
          <MenuItem value="most_sessions">Most Sessions</MenuItem>
          <MenuItem value="most_paid">Most Paid</MenuItem>
        </TextField>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading...</Typography>
      ) : customers.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography color="text.secondary">
              {search ? 'No customers match your search.' : 'No customers yet. Customers appear here after completing a first session.'}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {customers.map((customer) => (
            <Card key={customer.id}>
              <CardActionArea component={Link} href={`/contacts/${customer.id}`}>
                <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {customer.name}
                      {customer.player_names && customer.player_names.length > 0 && (
                        <Typography component="span" variant="h6" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1 }}>
                          ({customer.player_names.join(', ')})
                        </Typography>
                      )}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                      {customer.phone && (
                        <Typography variant="body2" color="text.secondary">{customer.phone}</Typography>
                      )}
                      {customer.instagram_link && (
                        <Typography variant="body2" color="text.secondary">IG</Typography>
                      )}
                    </Box>
                    {customer.active_package_type && (
                      <Box sx={{ mt: 1 }}>
                        <Chip
                          label={`📦 ${customer.active_package_type.replace(/_/g, ' ').toUpperCase()}`}
                          size="small"
                          sx={{
                            bgcolor: 'success.main',
                            color: 'white',
                            fontWeight: 600
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" color="text.secondary">
                      {customer.player_count} player{customer.player_count !== 1 ? 's' : ''}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {Number(customer.first_sessions_count) + Number(customer.sessions_count)} sessions
                    </Typography>
                    {Number(customer.total_paid) > 0 && (
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
                        ${Number(customer.total_paid).toFixed(0)} paid
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
