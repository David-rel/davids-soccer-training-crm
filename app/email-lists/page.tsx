'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import PeopleIcon from '@mui/icons-material/People';

interface EmailList {
  id: number;
  name: string;
  created_at: string;
  member_count: number;
}

interface EmailListDetail extends EmailList {
  members: { id: number; email: string; name: string }[];
}

export default function EmailListsPage() {
  const [lists, setLists] = useState<EmailList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  // Edit dialog
  const [editList, setEditList] = useState<EmailListDetail | null>(null);
  const [editName, setEditName] = useState('');
  const [editMembers, setEditMembers] = useState<{ email: string; name: string }[]>([]);
  const [editNewEmail, setEditNewEmail] = useState('');
  const [editNewName, setEditNewName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  // Delete dialog
  const [deleteList, setDeleteList] = useState<EmailList | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    loadLists();
  }, []);

  async function loadLists() {
    setLoading(true);
    try {
      const res = await fetch('/api/email-lists', { cache: 'no-store' });
      const data = await res.json();
      setLists(data);
    } catch {
      setError('Failed to load email lists');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!createName.trim()) return;
    setCreateSaving(true);
    try {
      const res = await fetch('/api/email-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim(), members: [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create list');
      } else {
        setSuccess(`List "${data.name}" created`);
        setCreateOpen(false);
        setCreateName('');
        await loadLists();
      }
    } catch {
      setError('Failed to create list');
    } finally {
      setCreateSaving(false);
    }
  }

  async function openEdit(list: EmailList) {
    setEditLoading(true);
    try {
      const res = await fetch(`/api/email-lists/${list.id}`, { cache: 'no-store' });
      const data: EmailListDetail = await res.json();
      setEditList(data);
      setEditName(data.name);
      setEditMembers(data.members.map((m) => ({ email: m.email, name: m.name })));
      setEditNewEmail('');
      setEditNewName('');
    } catch {
      setError('Failed to load list details');
    } finally {
      setEditLoading(false);
    }
  }

  function addMember() {
    const email = editNewEmail.trim().toLowerCase();
    if (!email.includes('@')) { setError('Enter a valid email address'); return; }
    if (editMembers.some((m) => m.email === email)) { setError('That email is already in the list'); return; }
    setEditMembers((prev) => [...prev, { email, name: editNewName.trim() }]);
    setEditNewEmail('');
    setEditNewName('');
  }

  function removeMember(email: string) {
    setEditMembers((prev) => prev.filter((m) => m.email !== email));
  }

  async function handleSaveEdit() {
    if (!editList) return;
    if (!editName.trim()) { setError('List name cannot be empty'); return; }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/email-lists/${editList.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), members: editMembers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save list');
      } else {
        setSuccess(`List "${data.name}" saved`);
        setEditList(null);
        await loadLists();
      }
    } catch {
      setError('Failed to save list');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteList) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/email-lists/${deleteList.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete list');
      } else {
        setSuccess(`List "${deleteList.name}" deleted`);
        setDeleteList(null);
        await loadLists();
      }
    } catch {
      setError('Failed to delete list');
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Email Lists</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          Create List
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>{success}</Alert>
      )}

      {lists.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <PeopleIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">No email lists yet. Create one to get started.</Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {lists.map((list) => (
            <Card key={list.id} variant="outlined">
              <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: '12px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{list.name}</Typography>
                  <Chip
                    label={`${list.member_count} email${list.member_count !== 1 ? 's' : ''}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton size="small" onClick={() => openEdit(list)} title="Edit list">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => setDeleteList(list)} title="Delete list">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); setCreateName(''); }} maxWidth="xs" fullWidth>
        <DialogTitle>Create Email List</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="List Name"
            fullWidth
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            sx={{ mt: 1 }}
            placeholder="e.g. Summer Camp Parents"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); setCreateName(''); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!createName.trim() || createSaving}
            startIcon={createSaving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editList} onClose={() => setEditList(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit List</DialogTitle>
        <DialogContent>
          {editLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                label="List Name"
                fullWidth
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />

              <Divider />

              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Members ({editMembers.length})
              </Typography>

              {editMembers.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Email</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell width={40} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {editMembers.map((m) => (
                      <TableRow key={m.email}>
                        <TableCell sx={{ fontSize: 13 }}>{m.email}</TableCell>
                        <TableCell sx={{ fontSize: 13, color: m.name ? 'text.primary' : 'text.disabled' }}>
                          {m.name || '—'}
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" color="error" onClick={() => removeMember(m.email)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Email"
                  size="small"
                  value={editNewEmail}
                  onChange={(e) => setEditNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
                  sx={{ flex: 2 }}
                  placeholder="name@example.com"
                />
                <TextField
                  label="Name (optional)"
                  size="small"
                  value={editNewName}
                  onChange={(e) => setEditNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
                  sx={{ flex: 2 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={addMember}
                  sx={{ mt: 0.5, whiteSpace: 'nowrap' }}
                >
                  Add
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditList(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveEdit}
            disabled={!editName.trim() || editSaving || editLoading}
            startIcon={editSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteList} onClose={() => setDeleteList(null)} maxWidth="xs">
        <DialogTitle>Delete List</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{deleteList?.name}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteList(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleteLoading}
            startIcon={deleteLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
