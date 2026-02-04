import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SessionForm from '@/components/sessions/SessionForm';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function NewSessionPage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Book a Session
      </Typography>
      <Suspense>
        <SessionForm />
      </Suspense>
    </Box>
  );
}
