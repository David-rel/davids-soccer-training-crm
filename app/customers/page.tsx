'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CustomerList from '@/components/customers/CustomerList';

export const dynamic = 'force-dynamic';

export default function CustomersPage() {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Customers
        </Typography>
      </Box>
      <CustomerList />
    </Box>
  );
}
