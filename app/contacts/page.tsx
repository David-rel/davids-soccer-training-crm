'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import { useRouter } from 'next/navigation';
import ContactList from '@/components/contacts/ContactList';

export const dynamic = 'force-dynamic';

export default function ContactsPage() {
  const router = useRouter();
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Contacts
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => router.push('/contacts/new')}>
          Add Contact
        </Button>
      </Box>
      <ContactList />
    </Box>
  );
}
