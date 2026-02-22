ALTER TABLE crm_reminders
DROP CONSTRAINT IF EXISTS crm_reminders_reminder_type_check;

ALTER TABLE crm_reminders
ADD CONSTRAINT crm_reminders_reminder_type_check
CHECK (
  (reminder_type)::text = ANY (
    (
      ARRAY[
        'session_48h'::character varying,
        'session_24h'::character varying,
        'session_6h'::character varying,
        'session_start'::character varying,
        'coach_session_start'::character varying,
        'coach_session_plus_60m'::character varying,
        'parent_session_plus_120m'::character varying,
        'follow_up_1d'::character varying,
        'follow_up_3d'::character varying,
        'follow_up_7d'::character varying,
        'follow_up_14d'::character varying
      ]
    )::text[]
  )
);
