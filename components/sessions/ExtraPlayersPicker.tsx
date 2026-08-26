'use client';

import { useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/** A player anywhere in the CRM, with the family they belong to. */
export interface PickerPlayer {
  id: number;
  name: string;
  parent_id: number;
  parent_name: string;
}

interface ExtraPlayersPickerProps {
  /** Currently attached extra player ids. */
  value: number[];
  onChange: (playerIds: number[]) => void;
  /**
   * The session's own contact. Their players are the session's regular
   * roster, so they're filtered out of the extras list to keep the two
   * concepts from overlapping.
   */
  hostParentId?: number | null;
  disabled?: boolean;
}

/**
 * Picks players from OTHER families to ride along on a session — the "mini
 * group" case, where a couple of extra kids join a private session without it
 * becoming a scheduled group session.
 */
export default function ExtraPlayersPicker({
  value,
  onChange,
  hostParentId,
  disabled,
}: ExtraPlayersPickerProps) {
  const [allPlayers, setAllPlayers] = useState<PickerPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/players')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PickerPlayer[]) => {
        if (!cancelled) setAllPlayers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () =>
      allPlayers.filter(
        (player) => hostParentId == null || Number(player.parent_id) !== Number(hostParentId)
      ),
    [allPlayers, hostParentId]
  );

  // Keep any already-attached extra visible even if the host filter would hide
  // it, so an existing selection never silently disappears from the field.
  const selected = useMemo(() => {
    const byId = new Map(allPlayers.map((player) => [player.id, player]));
    return value
      .map((id) => byId.get(id))
      .filter((player): player is PickerPlayer => Boolean(player));
  }, [allPlayers, value]);

  // A player of the host family that somehow got attached as an extra: surfaced
  // rather than hidden so it can be removed.
  const conflicting = selected.filter(
    (player) => hostParentId != null && Number(player.parent_id) === Number(hostParentId)
  );

  return (
    <Box>
      <Autocomplete
        multiple
        disableCloseOnSelect
        loading={loading}
        options={options}
        value={selected}
        onChange={(_event, next) => onChange(next.map((player) => player.id))}
        isOptionEqualToValue={(option, selectedOption) => option.id === selectedOption.id}
        getOptionLabel={(option) => `${option.name} (${option.parent_name})`}
        groupBy={(option) => option.parent_name}
        disabled={disabled}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Extra Players (other families)"
            placeholder={selected.length === 0 ? 'Add players from other contacts' : ''}
            helperText="Their parent's contact info, calendar invite, and text reminders attach to this session."
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
                label={`${option.name} — ${option.parent_name}`}
              />
            );
          })
        }
      />
      {conflicting.length > 0 && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
          {conflicting.map((player) => player.name).join(', ')} already belong to this session&apos;s
          contact — remove them here and use the Players field instead.
        </Typography>
      )}
    </Box>
  );
}
