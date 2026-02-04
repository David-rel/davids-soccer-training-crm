import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ContactForm from '@/components/contacts/ContactForm';

export default function NewContactPage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Add New Contact
      </Typography>
      <ContactForm />
    </Box>
  );
}
