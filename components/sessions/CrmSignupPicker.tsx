'use client';

import { useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';

/** A player anywhere in the CRM, with the family they belong to. */
interface CrmPlayer {
  id: number;
  name: string;
  parent_id: number;
  parent_name: string;
}

/** What the server reports back after a bulk add. */
export interface AddFromCrmResult {
  added: number;
  skipped: string[];
  warnings: string[];
  notified: {
    emailed: number;
    texted: number;
    problems: string[];
  } | null;
}

interface CrmSignupPickerProps {
  open: boolean;
  groupSessionId: number | null;
  sessionTitle: string;
  /** CRM player ids already signed up for this session — greyed out, not offered. */
  alreadyAddedPlayerIds: number[];
  onClose: () => void;
  onAdded: (result: AddFromCrmResult) => void | Promise<void>;
}

/**
 * One option in the picker. A `family` option is the whole household in a
 * single click — the common case, since siblings almost always train together
 * — while a `player` option picks one kid out of it.
 */
type PickerOption = {
  key: string;
  kind: 'family' | 'player';
  parentName: string;
  label: string;
  playerIds: number[];
};

/**
 * Adds existing CRM players to a group session in bulk. Everything the signup
 * row needs (contact name, email, phone, age, birthday, team) is copied from
 * the CRM by the server, so a coach never re-types a family that is already in
 * the system.
 */
export default function CrmSignupPicker({
  open,
  groupSessionId,
  sessionTitle,
  alreadyAddedPlayerIds,
  onClose,
  onAdded,
}: CrmSignupPickerProps) {
  const [allPlayers, setAllPlayers] = useState<CrmPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PickerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // On by default: adding a family from the CRM is normally the moment you
  // want them told. Unchecked for back-fills and for families you already
  // spoke to in person.
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setSelected([]);
    setError(null);
    setNotify(true);

    fetch('/api/players', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CrmPlayer[]) => {
        if (!cancelled) setAllPlayers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load CRM players.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const addedSet = useMemo(
    () => new Set(alreadyAddedPlayerIds.map((id) => Number(id))),
    [alreadyAddedPlayerIds]
  );

  const options = useMemo<PickerOption[]>(() => {
    const families = new Map<number, { parentName: string; players: CrmPlayer[] }>();

    allPlayers.forEach((player) => {
      const family = families.get(player.parent_id);
      if (family) {
        family.players.push(player);
      } else {
        families.set(player.parent_id, { parentName: player.parent_name, players: [player] });
      }
    });

    const list: PickerOption[] = [];

    [...families.entries()]
      .sort((a, b) => a[1].parentName.localeCompare(b[1].parentName))
      .forEach(([parentId, family]) => {
        const openPlayers = family.players.filter((player) => !addedSet.has(Number(player.id)));

        // A family already fully signed up has nothing left to offer.
        if (openPlayers.length === 0) return;

        // Only worth a "whole family" shortcut when there is more than one kid.
        if (openPlayers.length > 1) {
          list.push({
            key: `family-${parentId}`,
            kind: 'family',
            parentName: family.parentName,
            label: `Everyone (${openPlayers.length} players)`,
            playerIds: openPlayers.map((player) => player.id),
          });
        }

        openPlayers.forEach((player) => {
          list.push({
            key: `player-${player.id}`,
            kind: 'player',
            parentName: family.parentName,
            label: player.name,
            playerIds: [player.id],
          });
        });
      });

    return list;
  }, [allPlayers, addedSet]);

  // A family and one of its kids can both be selected; the union is what counts.
  const resolvedPlayerIds = useMemo(() => {
    const ids = new Set<number>();
    selected.forEach((option) => option.playerIds.forEach((id) => ids.add(id)));
    return [...ids];
  }, [selected]);

  const hiddenCount = allPlayers.length - options.filter((o) => o.kind === 'player').length;

  const handleAdd = async () => {
    if (!groupSessionId || resolvedPlayerIds.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/group-sessions/${groupSessionId}/players/from-crm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_ids: resolvedPlayerIds, notify }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to add players from the CRM');
      }

      const result = (await res.json()) as AddFromCrmResult;
      setSelected([]);
      await onAdded(result);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to add players from the CRM');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Players from CRM</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Pick a whole family or single players to add to{' '}
          <strong>{sessionTitle || 'this group session'}</strong>. They come in as unpaid prospects
          at the session price — mark them paid once the money lands.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Autocomplete
          multiple
          disableCloseOnSelect
          loading={loading}
          options={options}
          value={selected}
          onChange={(_event, next) => setSelected(next)}
          isOptionEqualToValue={(option, selectedOption) => option.key === selectedOption.key}
          getOptionLabel={(option) => `${option.label} — ${option.parentName}`}
          groupBy={(option) => option.parentName}
          disabled={saving}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props as typeof props & { key: string };
            return (
              <Box component="li" key={key} {...optionProps}>
                <Typography sx={{ fontWeight: option.kind === 'family' ? 700 : 400 }}>
                  {option.label}
                </Typography>
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Families & Players"
              placeholder={selected.length === 0 ? 'Search a contact or player name' : ''}
              helperText={
                hiddenCount > 0
                  ? `${hiddenCount} player${hiddenCount === 1 ? ' is' : 's are'} already in this session.`
                  : ' '
              }
            />
          )}
          renderValue={(selectedOptions, getItemProps) =>
            selectedOptions.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index });
              return (
                <Chip
                  key={key}
                  {...itemProps}
                  size="small"
                  color={option.kind === 'family' ? 'primary' : 'default'}
                  label={`${option.label} — ${option.parentName}`}
                />
              );
            })
          }
        />

        <FormControlLabel
          sx={{ mt: 1 }}
          control={
            <Checkbox
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
              disabled={saving}
            />
          }
          label="Text and email these families, with a calendar invite"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleAdd}
          disabled={saving || resolvedPlayerIds.length === 0}
        >
          {saving
            ? 'Adding...'
            : `Add ${resolvedPlayerIds.length || ''} Player${resolvedPlayerIds.length === 1 ? '' : 's'}`.trim()}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
