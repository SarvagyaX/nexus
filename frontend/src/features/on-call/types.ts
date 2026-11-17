export interface OnCallMember {
  user_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  order: number;
}

export type RotationType = 'daily' | 'weekly' | 'custom';

export interface OnCallSchedule {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  timezone: string;
  is_active: boolean;
  rotation_type: RotationType;
  rotation_interval_days: number;
  shift_start_time: string;
  handover_hour: number;
  members: OnCallMember[];
  created_at: string;
  updated_at: string;
}

export interface OnCallScheduleCreate {
  name: string;
  description?: string;
  timezone?: string;
  is_active?: boolean;
  rotation_type?: RotationType;
  rotation_interval_days?: number;
  shift_start_time?: string;
  handover_hour?: number;
  members?: OnCallMember[];
}

export interface OnCallScheduleUpdate {
  name?: string;
  description?: string;
  timezone?: string;
  is_active?: boolean;
  rotation_type?: RotationType;
  rotation_interval_days?: number;
  shift_start_time?: string;
  handover_hour?: number;
  members?: OnCallMember[];
}

export interface CurrentOnCallResponse {
  schedule_id: string;
  schedule_name: string;
  timezone: string;
  is_active: boolean;
  current_user?: OnCallMember | null;
  shift_start?: string | null;
  shift_end?: string | null;
}
