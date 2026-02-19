'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CustomerList from '@/components/customers/CustomerList';

export const dynamic = 'force-dynamic';

export default function CustomersPage() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      const res = await fetch('/api/parents?filter=customers&count_only=true');
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.count);
    };

    fetchCount();
  }, []);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Customers {count !== null ? `(${count})` : ''}
        </Typography>
      </Box>
      <CustomerList />
    </Box>
  );
}
