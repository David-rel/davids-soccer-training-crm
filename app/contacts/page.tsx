'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import { useRouter } from 'next/navigation';
import ContactList from '@/components/contacts/ContactList';

export const dynamic = 'force-dynamic';

export default function ContactsPage() {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      const res = await fetch('/api/parents?count_only=true');
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
          Contacts {count !== null ? `(${count})` : ''}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => router.push('/contacts/new')}>
          Add Contact
        </Button>
      </Box>
      <ContactList />
    </Box>
  );
}
