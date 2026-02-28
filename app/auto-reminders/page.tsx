'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { formatArizonaDateTime, toDatetimeLocal } from '@/lib/timezone';

interface ReminderDefault {
  reminder_type: string;
  label: string;
  message_template: string;
  is_active: boolean;
  updated_at: string | null;
}

interface SessionReminderRow {
  id: number;
  parent_id: number;
  reminder_type: string;
  reminder_category: string;
  due_at: string;
  custom_message: string | null;
  default_message_template: string | null;
  effective_message_template: string | null;
  parent_name: string;
  parent_phone: string | null;
  player_names: string[] | null;
}

interface CustomTemplate {
  id: number;
  name: string;
  message_template: string;
  created_at: string;
  updated_at: string;
}

interface ScheduledMessage {
  id: number;
  parent_id: number;
  title: string | null;
  message_content: string;
  scheduled_for: string;
  sent: boolean;
  sent_at: string | null;
  notes: string | null;
  parent_name: string;
  parent_phone: string | null;
}

interface CustomerOption {
  id: number;
  name: string;
  phone: string | null;
}

type RecipientMode = 'single' | 'all_customers';

function normalizeUtcValue(input: string): string {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(input)) return input;
  return `${input.replace(' ', 'T')}Z`;
}

function toLocalInputValue(value: string): string {
  return toDatetimeLocal(normalizeUtcValue(value));
}

const PLACEHOLDER_HELP =
  'Locked placeholders (must stay exact): {{player_name}}, {{parent_name}}, {{session_time}}, {{profile_url}}, {{session_plan_url}}, {{feedback_url}}, {{tests_url}}, {{notes_summary}}, {{first_session_note}}, {{review_prompt}}, {{coach_phone}}';

export default function AutoRemindersPage() {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [defaults, setDefaults] = useState<ReminderDefault[]>([]);
  const [sessionReminders, setSessionReminders] = useState<SessionReminderRow[]>([]);
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  const [defaultEdits, setDefaultEdits] = useState<Record<string, string>>({});
  const [overrideEdits, setOverrideEdits] = useState<Record<number, string>>({});
  const [templateEdits, setTemplateEdits] = useState<
    Record<number, { name: string; message_template: string }>
  >({});
  const [scheduledEdits, setScheduledEdits] = useState<
    Record<number, { title: string; message_content: string; scheduled_for: string }>
  >({});

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('single');
  const [newTemplate, setNewTemplate] = useState({ name: '', message_template: '' });
  const [scheduleForm, setScheduleForm] = useState({
    parent_id: '',
    title: '',
    template_id: '',
    message_content: '',
    scheduled_for: '',
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [defaultsRes, remindersRes, templatesRes, messagesRes, customersRes] =
        await Promise.all([
          fetch('/api/auto-reminders/defaults'),
          fetch('/api/auto-reminders/session-reminders?days=30&limit=600'),
          fetch('/api/auto-reminders/custom-templates'),
          fetch('/api/auto-reminders/custom-messages?days=90'),
          fetch('/api/parents?filter=customers'),
        ]);

      if (!defaultsRes.ok || !remindersRes.ok || !templatesRes.ok || !messagesRes.ok || !customersRes.ok) {
        throw new Error('Failed to load auto reminders data');
      }

      const defaultsData = (await defaultsRes.json()) as ReminderDefault[];
      const remindersData = (await remindersRes.json()) as { reminders: SessionReminderRow[] };
      const templatesData = (await templatesRes.json()) as CustomTemplate[];
      const messagesData = (await messagesRes.json()) as { messages: ScheduledMessage[] };
      const customersData = (await customersRes.json()) as Array<{ id: number; name: string; phone: string | null }>;

      setDefaults(defaultsData);
      setSessionReminders(remindersData.reminders || []);
      setTemplates(templatesData);
      setScheduledMessages(messagesData.messages || []);
      setCustomers(customersData.map((c) => ({ id: c.id, name: c.name, phone: c.phone })));

      setDefaultEdits(
        defaultsData.reduce<Record<string, string>>((acc, row) => {
          acc[row.reminder_type] = row.message_template;
          return acc;
        }, {})
      );
      setOverrideEdits(
        (remindersData.reminders || []).reduce<Record<number, string>>((acc, row) => {
          acc[row.id] = row.custom_message || '';
          return acc;
        }, {})
      );
      setTemplateEdits(
        templatesData.reduce<Record<number, { name: string; message_template: string }>>(
          (acc, row) => {
            acc[row.id] = {
              name: row.name,
              message_template: row.message_template,
            };
            return acc;
          },
          {}
        )
      );
      setScheduledEdits(
        (messagesData.messages || []).reduce<
          Record<number, { title: string; message_content: string; scheduled_for: string }>
        >((acc, row) => {
          acc[row.id] = {
            title: row.title || '',
            message_content: row.message_content,
            scheduled_for: toLocalInputValue(row.scheduled_for),
          };
          return acc;
        }, {})
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const templateLookup = useMemo(() => {
    return templates.reduce<Record<string, CustomTemplate>>((acc, item) => {
      acc[String(item.id)] = item;
      return acc;
    }, {});
  }, [templates]);

  const handleSaveDefault = async (reminderType: string) => {
    const messageTemplate = (defaultEdits[reminderType] || '').trim();
    if (!messageTemplate) return;
    setSavingKey(`default-${reminderType}`);
    try {
      const res = await fetch('/api/auto-reminders/defaults', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reminder_type: reminderType,
          message_template: messageTemplate,
        }),
      });
      if (!res.ok) throw new Error('Failed to save default');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save default');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveOverride = async (reminderId: number) => {
    setSavingKey(`override-${reminderId}`);
    try {
      const res = await fetch(`/api/auto-reminders/session-reminders/${reminderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_message: overrideEdits[reminderId] || '',
        }),
      });
      if (!res.ok) throw new Error('Failed to save override');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save override');
    } finally {
      setSavingKey(null);
    }
  };

  const handleCreateTemplate = async () => {
    const payload = {
      name: newTemplate.name.trim(),
      message_template: newTemplate.message_template.trim(),
    };
    if (!payload.name || !payload.message_template) return;
    setSavingKey('template-create');
    try {
      const res = await fetch('/api/auto-reminders/custom-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create template');
      setNewTemplate({ name: '', message_template: '' });
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveTemplate = async (templateId: number) => {
    const edit = templateEdits[templateId];
    if (!edit) return;
    setSavingKey(`template-${templateId}`);
    try {
      const res = await fetch(`/api/auto-reminders/custom-templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: edit.name.trim(),
          message_template: edit.message_template.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save template');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    setSavingKey(`template-delete-${templateId}`);
    try {
      const res = await fetch(`/api/auto-reminders/custom-templates/${templateId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete template');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setSavingKey(null);
    }
  };

  const handleScheduleMessage = async () => {
    const messageContent = scheduleForm.message_content.trim();
    if (!scheduleForm.scheduled_for || !messageContent) return;

    const payload =
      recipientMode === 'single'
        ? {
            recipient_mode: 'single',
            parent_id: Number(scheduleForm.parent_id),
            title: scheduleForm.title.trim(),
            message_content: messageContent,
            scheduled_for: scheduleForm.scheduled_for,
          }
        : {
            recipient_mode: 'all_customers',
            title: scheduleForm.title.trim(),
            message_content: messageContent,
            scheduled_for: scheduleForm.scheduled_for,
          };

    setSavingKey('schedule-create');
    try {
      const res = await fetch('/api/auto-reminders/custom-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to schedule custom message');
      setScheduleForm({
        parent_id: '',
        title: '',
        template_id: '',
        message_content: '',
        scheduled_for: '',
      });
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule custom message');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveScheduledMessage = async (messageId: number) => {
    const edit = scheduledEdits[messageId];
    if (!edit) return;
    setSavingKey(`scheduled-${messageId}`);
    try {
      const res = await fetch(`/api/auto-reminders/custom-messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: edit.title,
          message_content: edit.message_content,
          scheduled_for: edit.scheduled_for,
        }),
      });
      if (!res.ok) throw new Error('Failed to update scheduled message');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scheduled message');
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteScheduledMessage = async (messageId: number) => {
    setSavingKey(`scheduled-delete-${messageId}`);
    try {
      const res = await fetch(`/api/auto-reminders/custom-messages/${messageId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete scheduled message');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scheduled message');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={20} />
        <Typography>Loading auto reminders...</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Auto Reminders
          </Typography>
          <Typography color="text.secondary">
            Manage default session reminder messages, per-reminder overrides, and custom scheduled customer messages.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchAll}>
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Session Auto Reminders" />
        <Tab label="Custom Customer Messages" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Default Message Templates
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                These defaults are auto-applied to every new session reminder. You can edit wording and links, but placeholder names are locked for safety.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {PLACEHOLDER_HELP}
              </Typography>

              <Stack spacing={2} sx={{ mt: 2 }}>
                {defaults.map((row) => (
                  <Box key={row.reminder_type} sx={{ border: '1px solid #e5e7eb', borderRadius: 2, p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{row.label}</Typography>
                      <Chip size="small" label={row.reminder_type} />
                    </Box>
                    <TextField
                      fullWidth
                      multiline
                      minRows={3}
                      helperText="You can change text and links. Keep {{...}} placeholders unchanged."
                      value={defaultEdits[row.reminder_type] || ''}
                      onChange={(e) =>
                        setDefaultEdits((prev) => ({
                          ...prev,
                          [row.reminder_type]: e.target.value,
                        }))
                      }
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                      <Button
                        startIcon={<SaveIcon />}
                        variant="contained"
                        onClick={() => handleSaveDefault(row.reminder_type)}
                        disabled={savingKey === `default-${row.reminder_type}`}
                      >
                        Save Default
                      </Button>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Upcoming Session Reminder Queue
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Override any specific reminder without changing the default template.
              </Typography>
              <Stack spacing={2}>
                {sessionReminders.map((row) => (
                  <Box key={row.id} sx={{ border: '1px solid #e5e7eb', borderRadius: 2, p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Box>
                        <Typography sx={{ fontWeight: 600 }}>
                          {row.parent_name}
                          {row.player_names?.length ? ` (${row.player_names.join(', ')})` : ''}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {formatArizonaDateTime(normalizeUtcValue(row.due_at))} • {row.reminder_type}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        color={row.custom_message ? 'warning' : 'success'}
                        label={row.custom_message ? 'Using Override' : 'Using Default'}
                      />
                    </Box>

                    <TextField
                      fullWidth
                      multiline
                      minRows={3}
                      label="Custom Override (optional)"
                      placeholder="Leave empty to use default template."
                      helperText="You can change wording, but placeholder names in {{...}} are locked."
                      value={overrideEdits[row.id] || ''}
                      onChange={(e) =>
                        setOverrideEdits((prev) => ({
                          ...prev,
                          [row.id]: e.target.value,
                        }))
                      }
                    />

                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Default template preview:
                    </Typography>
                    <Box sx={{ bgcolor: 'grey.50', borderRadius: 1.5, p: 1.5, mt: 0.5, whiteSpace: 'pre-wrap' }}>
                      <Typography variant="body2">
                        {row.default_message_template || '(No default template)'}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, gap: 1 }}>
                      <Button
                        variant="outlined"
                        onClick={() =>
                          setOverrideEdits((prev) => ({
                            ...prev,
                            [row.id]: '',
                          }))
                        }
                      >
                        Reset Text
                      </Button>
                      <Button
                        startIcon={<SaveIcon />}
                        variant="contained"
                        onClick={() => handleSaveOverride(row.id)}
                        disabled={savingKey === `override-${row.id}`}
                      >
                        Save Override
                      </Button>
                    </Box>
                  </Box>
                ))}
                {sessionReminders.length === 0 && (
                  <Typography color="text.secondary">No upcoming session reminders found.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Schedule Custom Customer Message
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Messages here are also picked up by the cron sender and sent automatically.
              </Typography>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  select
                  label="Recipient Mode"
                  value={recipientMode}
                  onChange={(e) => setRecipientMode(e.target.value as RecipientMode)}
                >
                  <MenuItem value="single">One customer</MenuItem>
                  <MenuItem value="all_customers">All active customers</MenuItem>
                </TextField>

                {recipientMode === 'single' ? (
                  <TextField
                    select
                    label="Customer"
                    value={scheduleForm.parent_id}
                    onChange={(e) =>
                      setScheduleForm((prev) => ({ ...prev, parent_id: e.target.value }))
                    }
                  >
                    {customers.map((customer) => (
                      <MenuItem key={customer.id} value={String(customer.id)}>
                        {customer.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <TextField label="Customer" value="All active customers" disabled />
                )}

                <TextField
                  type="datetime-local"
                  label="Send At (Arizona time)"
                  InputLabelProps={{ shrink: true }}
                  value={scheduleForm.scheduled_for}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({ ...prev, scheduled_for: e.target.value }))
                  }
                />
                <TextField
                  label="Title (optional)"
                  value={scheduleForm.title}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                />
              </Box>

              <Box sx={{ mt: 2 }}>
                <TextField
                  select
                  fullWidth
                  label="Load From Saved Template (optional)"
                  value={scheduleForm.template_id}
                  onChange={(e) => {
                    const templateId = e.target.value;
                    const selected = templateLookup[templateId];
                    setScheduleForm((prev) => ({
                      ...prev,
                      template_id: templateId,
                      message_content: selected ? selected.message_template : prev.message_content,
                    }));
                  }}
                >
                  <MenuItem value="">None</MenuItem>
                  {templates.map((template) => (
                    <MenuItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>

              <Box sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={4}
                  label="Message Content"
                  helperText="You can include links and placeholders like {{parent_name}}, {{scheduled_time}}, {{coach_phone}}."
                  value={scheduleForm.message_content}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({ ...prev, message_content: e.target.value }))
                  }
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                  startIcon={<AddIcon />}
                  variant="contained"
                  onClick={handleScheduleMessage}
                  disabled={savingKey === 'schedule-create'}
                >
                  Schedule Message
                </Button>
              </Box>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Saved Message Templates
              </Typography>

              <Box sx={{ border: '1px solid #e5e7eb', borderRadius: 2, p: 2, mb: 2 }}>
                <Typography sx={{ fontWeight: 600, mb: 1 }}>Create New Template</Typography>
                <TextField
                  fullWidth
                  label="Template Name"
                  value={newTemplate.name}
                  onChange={(e) =>
                    setNewTemplate((prev) => ({ ...prev, name: e.target.value }))
                  }
                  sx={{ mb: 1 }}
                />
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Template Content"
                  value={newTemplate.message_template}
                  onChange={(e) =>
                    setNewTemplate((prev) => ({ ...prev, message_template: e.target.value }))
                  }
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                  <Button
                    startIcon={<AddIcon />}
                    variant="contained"
                    onClick={handleCreateTemplate}
                    disabled={savingKey === 'template-create'}
                  >
                    Save Template
                  </Button>
                </Box>
              </Box>

              <Stack spacing={2}>
                {templates.map((template) => {
                  const edit = templateEdits[template.id] || {
                    name: template.name,
                    message_template: template.message_template,
                  };
                  return (
                    <Box key={template.id} sx={{ border: '1px solid #e5e7eb', borderRadius: 2, p: 2 }}>
                      <TextField
                        fullWidth
                        label="Template Name"
                        value={edit.name}
                        onChange={(e) =>
                          setTemplateEdits((prev) => ({
                            ...prev,
                            [template.id]: {
                              ...edit,
                              name: e.target.value,
                            },
                          }))
                        }
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        fullWidth
                        multiline
                        minRows={3}
                        label="Template Content"
                        value={edit.message_template}
                        onChange={(e) =>
                          setTemplateEdits((prev) => ({
                            ...prev,
                            [template.id]: {
                              ...edit,
                              message_template: e.target.value,
                            },
                          }))
                        }
                      />
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                        <Button
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => handleDeleteTemplate(template.id)}
                          disabled={savingKey === `template-delete-${template.id}`}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="contained"
                          startIcon={<SaveIcon />}
                          onClick={() => handleSaveTemplate(template.id)}
                          disabled={savingKey === `template-${template.id}`}
                        >
                          Save
                        </Button>
                      </Box>
                    </Box>
                  );
                })}
                {templates.length === 0 && (
                  <Typography color="text.secondary">No custom templates saved yet.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Scheduled Queue
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Edit or delete unsent scheduled messages.
              </Typography>

              <Stack spacing={2}>
                {scheduledMessages.map((message) => {
                  const edit = scheduledEdits[message.id] || {
                    title: message.title || '',
                    message_content: message.message_content,
                    scheduled_for: toLocalInputValue(message.scheduled_for),
                  };

                  return (
                    <Box key={message.id} sx={{ border: '1px solid #e5e7eb', borderRadius: 2, p: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Box>
                          <Typography sx={{ fontWeight: 600 }}>{message.parent_name}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            Scheduled for {formatArizonaDateTime(normalizeUtcValue(message.scheduled_for))}
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={message.sent ? 'Sent' : 'Pending'}
                          color={message.sent ? 'success' : 'warning'}
                        />
                      </Box>

                      <TextField
                        fullWidth
                        label="Title (optional)"
                        value={edit.title}
                        onChange={(e) =>
                          setScheduledEdits((prev) => ({
                            ...prev,
                            [message.id]: {
                              ...edit,
                              title: e.target.value,
                            },
                          }))
                        }
                        sx={{ mb: 1 }}
                        disabled={message.sent}
                      />

                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Send At (Arizona time)"
                        InputLabelProps={{ shrink: true }}
                        value={edit.scheduled_for}
                        onChange={(e) =>
                          setScheduledEdits((prev) => ({
                            ...prev,
                            [message.id]: {
                              ...edit,
                              scheduled_for: e.target.value,
                            },
                          }))
                        }
                        sx={{ mb: 1 }}
                        disabled={message.sent}
                      />

                      <TextField
                        fullWidth
                        multiline
                        minRows={3}
                        label="Message Content"
                        value={edit.message_content}
                        onChange={(e) =>
                          setScheduledEdits((prev) => ({
                            ...prev,
                            [message.id]: {
                              ...edit,
                              message_content: e.target.value,
                            },
                          }))
                        }
                        disabled={message.sent}
                      />

                      {message.notes && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                          Notes: {message.notes}
                        </Typography>
                      )}

                      {!message.sent && (
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => handleDeleteScheduledMessage(message.id)}
                            disabled={savingKey === `scheduled-delete-${message.id}`}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="contained"
                            startIcon={<SaveIcon />}
                            onClick={() => handleSaveScheduledMessage(message.id)}
                            disabled={savingKey === `scheduled-${message.id}`}
                          >
                            Save
                          </Button>
                        </Box>
                      )}
                    </Box>
                  );
                })}
                {scheduledMessages.length === 0 && (
                  <Typography color="text.secondary">No scheduled custom messages yet.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}

      <Divider sx={{ mt: 2 }} />
    </Box>
  );
}
