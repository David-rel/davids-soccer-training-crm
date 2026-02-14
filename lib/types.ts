// DM Status pipeline
export type DMStatus = 'first_message' | 'started_talking' | 'request_phone_call' | 'went_cold';

// Call outcome after phone call
export type CallOutcome = 'session_booked' | 'thinking_about_it' | 'uninterested' | 'went_cold';

// Payment methods
export type PaymentMethod = 'zelle' | 'venmo' | 'paypal' | 'apple_cash' | 'cash';

// Package types
export type PackageType = '12_week_1x' | '12_week_2x' | '6_week_1x' | '6_week_2x';

// Reminder types
export type ReminderType = 'session_48h' | 'session_24h' | 'session_6h' | 'follow_up_1d' | 'follow_up_3d' | 'follow_up_7d' | 'follow_up_14d';

// Reminder categories (which ghost scenario or session reminder)
export type ReminderCategory = 'session_reminder' | 'dm_follow_up' | 'post_call_follow_up' | 'post_first_session_follow_up' | 'post_session_follow_up';

// Gender
export type Gender = 'male' | 'female' | 'other';

// --- Database Row Types ---

export interface Parent {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  instagram_link: string | null;
  secondary_parent_name: string | null;
  dm_status: DMStatus | null;
  phone_call_booked: boolean;
  call_date_time: string | null;
  call_outcome: CallOutcome | null;
  interest_in_package: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: number;
  parent_id: number;
  name: string;
  age: number | null;
  team: string | null;
  gender: Gender | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FirstSession {
  id: number;
  parent_id: number;
  player_id: number | null;
  session_date: string;
  location: string | null;
  price: number | null;
  deposit_paid: boolean;
  deposit_amount: number | null;
  showed_up: boolean | null;
  cancelled: boolean;
  was_paid: boolean;
  payment_method: PaymentMethod | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  parent_id: number;
  player_id: number | null;
  session_date: string;
  location: string | null;
  price: number | null;
  showed_up: boolean | null;
  cancelled: boolean;
  was_paid: boolean;
  payment_method: PaymentMethod | null;
  package_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Package {
  id: number;
  parent_id: number;
  package_type: PackageType;
  total_sessions: number;
  sessions_completed: number;
  price: number | null;
  start_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: number;
  parent_id: number;
  first_session_id: number | null;
  session_id: number | null;
  reminder_type: ReminderType;
  reminder_category: ReminderCategory;
  due_at: string;
  sent: boolean;
  sent_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Expense {
  id: number;
  expense_date: string;
  vendor: string;
  category: string;
  description: string | null;
  amount: number;
  payment_method: string | null;
  receipt_url: string | null;
  receipt_blob_path: string | null;
  business_percentage: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// --- Joined/Extended Types for API responses ---

export interface ParentWithPlayers extends Parent {
  players: Player[];
}

export interface ParentDetail extends ParentWithPlayers {
  first_session: FirstSession | null;
  sessions: Session[];
  active_package: Package | null;
  pending_reminders: Reminder[];
}

export interface DashboardData {
  todays_calls: (Parent & { call_date_time: string })[];
  todays_first_sessions: (FirstSession & { parent_name: string; player_name: string | null })[];
  todays_sessions: (Session & { parent_name: string; player_name: string | null })[];
  pending_reminders: (Reminder & { parent_name: string })[];
  stats: {
    total_contacts: number;
    sessions_this_week: number;
    revenue_this_month: number;
  };
}
