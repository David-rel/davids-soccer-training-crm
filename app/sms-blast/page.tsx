'use client';

import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import SmsIcon from '@mui/icons-material/Sms';
import SendIcon from '@mui/icons-material/Send';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';

interface SmsContact {
  phone: string;
  name: string;
  source: 'crm' | 'signup' | 'list';
  is_dead: boolean;
}

interface SendResult {
  sent_count: number;
  failed_count: number;
  sent: string[];
  failed: { phone: string; error: string }[];
}

interface PhoneList {
  id: number;
  name: string;
  member_count: number;
}

interface PhoneListDetail {
  id: number;
  name: string;
  members: { id: number; phone: string; name: string }[];
}

const SOURCE_LABEL: Record<string, string> = {
  crm: 'CRM',
  signup: 'Signup',
  list: 'List',
};
const SOURCE_COLOR: Record<string, 'primary' | 'success' | 'warning' | 'default'> = {
  crm: 'primary',
  signup: 'success',
  list: 'warning',
};

const SMS_SEGMENT_SIZE = 160;

function getSmsSegments(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / SMS_SEGMENT_SIZE);
}

export default function SmsBlastPage() {
  const [contacts, setContacts] = useState<SmsContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'crm' | 'signup' | 'list'>('all');
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeadContacts, setShowDeadContacts] = useState(false);

  // Load list dialog
  const [loadListOpen, setLoadListOpen] = useState(false);
  const [availableLists, setAvailableLists] = useState<PhoneList[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

  // Save as list dialog
  const [saveListOpen, setSaveListOpen] = useState(false);
  const [saveListName, setSaveListName] = useState('');
  const [savingList, setSavingList] = useState(false);
  const [saveListSuccess, setSaveListSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sms-blast', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: SmsContact[]) => setContacts(data))
      .catch(() => setError('Failed to load contacts'))
      .finally(() => setLoading(false));
  }, []);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { crm: 0, signup: 0, list: 0 };
    contacts.forEach((c) => { counts[c.source] = (counts[c.source] ?? 0) + 1; });
    return counts;
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!showDeadContacts && c.is_dead) return false;
      if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.phone.includes(q);
    });
  }, [contacts, search, sourceFilter, showDeadContacts]);

  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every((c) => selectedPhones.has(c.phone));
  const someFilteredSelected = filteredContacts.some((c) => selectedPhones.has(c.phone));

  const toggleContact = (phone: string) => {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredContacts.forEach((c) => next.delete(c.phone));
      } else {
        filteredContacts.forEach((c) => next.add(c.phone));
      }
      return next;
    });
  };

  const handleSend = async () => {
    if (selectedPhones.size === 0) { setError('Select at least one contact.'); return; }
    if (!message.trim()) { setError('Message is required.'); return; }

    const confirmed = window.confirm(
      `Send this SMS to ${selectedPhones.size} contact${selectedPhones.size === 1 ? '' : 's'}?`
    );
    if (!confirmed) return;

    setSending(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/sms-blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phones: Array.from(selectedPhones),
          message: message.trim(),
        }),
      });
      const data = await res.json() as SendResult & { error?: string };
      if (!res.ok) {
        setError(data.error || 'Failed to send SMS');
      } else {
        setResult(data);
        if (data.sent_count > 0) setSelectedPhones(new Set());
      }
    } catch {
      setError('Failed to send SMS');
    } finally {
      setSending(false);
    }
  };

  const openLoadList = async () => {
    setLoadListOpen(true);
    setLoadingLists(true);
    try {
      const res = await fetch('/api/phone-lists', { cache: 'no-store' });
      const data: PhoneList[] = await res.json();
      setAvailableLists(data);
    } catch {
      setError('Failed to load phone lists');
      setLoadListOpen(false);
    } finally {
      setLoadingLists(false);
    }
  };

  const handleLoadList = async (listId: number) => {
    setLoadListOpen(false);
    try {
      const res = await fetch(`/api/phone-lists/${listId}`, { cache: 'no-store' });
      const data: PhoneListDetail = await res.json();

      setContacts((prev) => {
        const existingPhones = new Set(prev.map((c) => c.phone));
        const newContacts: SmsContact[] = data.members
          .filter((m) => !existingPhones.has(m.phone))
          .map((m) => ({
            phone: m.phone,
            name: m.name || m.phone,
            source: 'list' as const,
            is_dead: false,
          }));
        return [...prev, ...newContacts];
      });

      setSelectedPhones((prev) => {
        const next = new Set(prev);
        data.members.forEach((m) => next.add(m.phone));
        return next;
      });
    } catch {
      setError('Failed to load list');
    }
  };

  const handleSaveList = async () => {
    if (!saveListName.trim()) return;
    setSavingList(true);
    try {
      const selectedContacts = contacts.filter((c) => selectedPhones.has(c.phone));
      const members = selectedContacts.map((c) => ({ phone: c.phone, name: c.name }));

      const res = await fetch('/api/phone-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveListName.trim(), members }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save list');
      } else {
        setSaveListSuccess(`Saved "${data.name}" with ${data.member_count} number${data.member_count !== 1 ? 's' : ''}`);
        setSaveListOpen(false);
        setSaveListName('');
      }
    } catch {
      setError('Failed to save list');
    } finally {
      setSavingList(false);
    }
  };

  if (loading) return <Typography>Loading contacts...</Typography>;

  const selectedContactList = contacts.filter((c) => selectedPhones.has(c.phone));
  const hasListContacts = sourceCounts.list > 0;
  const charCount = message.length;
  const segments = getSmsSegments(message);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '360px 1fr' }, gap: 3, alignItems: 'start' }}>
      {/* Left: Contact selector */}
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Contacts</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">{contacts.length} total</Typography>
              <Button size="small" startIcon={<BookmarkIcon fontSize="small" />} onClick={openLoadList} sx={{ ml: 0.5, fontSize: 12 }}>
                Load List
              </Button>
            </Box>
          </Box>

          <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
            <InputLabel>Source</InputLabel>
            <Select
              value={sourceFilter}
              label="Source"
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
            >
              <MenuItem value="all">All ({contacts.length})</MenuItem>
              <MenuItem value="crm">CRM Contacts ({sourceCounts.crm})</MenuItem>
              <MenuItem value="signup">Group Signups ({sourceCounts.signup})</MenuItem>
              {hasListContacts && <MenuItem value="list">From Lists ({sourceCounts.list})</MenuItem>}
            </Select>
          </FormControl>

          <TextField
            size="small"
            placeholder="Search by name or phone..."
            fullWidth
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mb: 1 }}
          />

          <FormControlLabel
            control={<Checkbox size="small" checked={showDeadContacts} onChange={(e) => setShowDeadContacts(e.target.checked)} />}
            label={<Typography variant="body2">Show archived contacts</Typography>}
          />

          <Divider sx={{ my: 1 }} />

          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={allFilteredSelected}
                indeterminate={someFilteredSelected && !allFilteredSelected}
                onChange={toggleAllFiltered}
              />
            }
            label={<Typography variant="body2" sx={{ fontWeight: 600 }}>Select all ({filteredContacts.length})</Typography>}
          />

          <Box sx={{ maxHeight: 400, overflowY: 'auto', mt: 0.5 }}>
            {filteredContacts.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No contacts found
              </Typography>
            ) : (
              filteredContacts.map((contact) => (
                <FormControlLabel
                  key={contact.phone}
                  sx={{ display: 'flex', mx: 0, py: 0.25, alignItems: 'flex-start' }}
                  control={
                    <Checkbox
                      size="small"
                      checked={selectedPhones.has(contact.phone)}
                      onChange={() => toggleContact(contact.phone)}
                      sx={{ pt: 0.5 }}
                    />
                  }
                  label={
                    <Box sx={{ pt: 0.25 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }}>{contact.name}</Typography>
                        <Chip
                          label={SOURCE_LABEL[contact.source] ?? contact.source}
                          size="small"
                          color={SOURCE_COLOR[contact.source] ?? 'default'}
                          sx={{ height: 16, fontSize: 10 }}
                        />
                        {contact.is_dead && <Chip label="archived" size="small" sx={{ height: 16, fontSize: 10 }} />}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {contact.phone}
                      </Typography>
                    </Box>
                  }
                />
              ))
            )}
          </Box>

          <Divider sx={{ mt: 1, mb: 1.5 }} />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <SmsIcon fontSize="small" color="primary" />
            <Typography variant="body2">
              <strong>{selectedPhones.size}</strong> selected
              {selectedPhones.size > 0 && (
                <Button size="small" sx={{ ml: 1, minWidth: 0, p: 0, fontSize: 12 }} onClick={() => setSelectedPhones(new Set())}>
                  Clear
                </Button>
              )}
            </Typography>
            {selectedPhones.size > 0 && (
              <Button size="small" startIcon={<BookmarkAddIcon fontSize="small" />} onClick={() => setSaveListOpen(true)} sx={{ ml: 'auto', fontSize: 12 }}>
                Save as List
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Right: Compose */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {saveListSuccess && <Alert severity="success" onClose={() => setSaveListSuccess(null)}>{saveListSuccess}</Alert>}

        {result && (
          <Alert severity={result.failed_count === 0 ? 'success' : 'warning'} onClose={() => setResult(null)}>
            <Typography variant="body2">
              Sent to <strong>{result.sent_count}</strong> contact{result.sent_count !== 1 ? 's' : ''}.
              {result.failed_count > 0 && (
                <> Failed for <strong>{result.failed_count}</strong>: {result.failed.map((f) => f.phone).join(', ')}</>
              )}
            </Typography>
          </Alert>
        )}

        {selectedPhones.size > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {selectedContactList.slice(0, 10).map((c) => (
              <Chip key={c.phone} label={c.name} size="small" onDelete={() => toggleContact(c.phone)} />
            ))}
            {selectedContactList.length > 10 && (
              <Chip label={`+${selectedContactList.length - 10} more`} size="small" variant="outlined" />
            )}
          </Box>
        )}

        <Card variant="outlined">
          <CardContent sx={{ pb: '16px !important' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Compose SMS</Typography>

            <TextField
              multiline
              rows={8}
              fullWidth
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your SMS message here..."
              sx={{ mb: 1 }}
            />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="caption" color={charCount > SMS_SEGMENT_SIZE ? 'warning.main' : 'text.secondary'}>
                {charCount} character{charCount !== 1 ? 's' : ''}
                {charCount > 0 && ` · ${segments} SMS segment${segments !== 1 ? 's' : ''}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Sending from: +1 (888) 670-2766
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                onClick={handleSend}
                disabled={sending || selectedPhones.size === 0 || !message.trim()}
                size="large"
              >
                {sending ? 'Sending...' : `Send to ${selectedPhones.size} contact${selectedPhones.size !== 1 ? 's' : ''}`}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Load List dialog */}
      <Dialog open={loadListOpen} onClose={() => setLoadListOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Load Phone List</DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {loadingLists ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : availableLists.length === 0 ? (
            <Typography color="text.secondary" sx={{ px: 3, py: 3 }}>
              No saved phone lists. Go to Phone Lists to create one.
            </Typography>
          ) : (
            <List disablePadding>
              {availableLists.map((list, i) => (
                <Box key={list.id}>
                  {i > 0 && <Divider />}
                  <ListItem disablePadding>
                    <ListItemButton onClick={() => handleLoadList(list.id)}>
                      <ListItemText
                        primary={list.name}
                        secondary={`${list.member_count} number${list.member_count !== 1 ? 's' : ''}`}
                      />
                    </ListItemButton>
                  </ListItem>
                </Box>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoadListOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Save as List dialog */}
      <Dialog open={saveListOpen} onClose={() => { setSaveListOpen(false); setSaveListName(''); }} maxWidth="xs" fullWidth>
        <DialogTitle>Save Selection as List</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Save the {selectedPhones.size} selected number{selectedPhones.size !== 1 ? 's' : ''} as a reusable list.
          </Typography>
          <TextField
            autoFocus
            label="List Name"
            fullWidth
            value={saveListName}
            onChange={(e) => setSaveListName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveList(); }}
            placeholder="e.g. Summer Camp Parents"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setSaveListOpen(false); setSaveListName(''); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveList}
            disabled={!saveListName.trim() || savingList}
            startIcon={savingList ? <CircularProgress size={16} color="inherit" /> : <BookmarkAddIcon />}
          >
            Save List
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
