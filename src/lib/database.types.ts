// Keep this shape aligned with supabase/schema.sql.
// Regenerate with Supabase CLI in production if desired.
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; role: 'employee' | 'admin'; emp_id: string | null; created_at: string; updated_at: string };
        Insert: { id: string; role?: 'employee' | 'admin'; emp_id?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      departments: {
        Row: { id: string; name: string; description: string | null; created_at: string };
        Insert: { id?: string; name: string; description?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['departments']['Insert']>;
      };
      employees: {
        Row: {
          id: string; profile_id: string | null; emp_id: string; name: string; email: string; avatar_url: string | null;
          department_id: string | null; designation: string | null; phone: string | null; manager_id: string | null;
          shift_start: string; shift_end: string; join_date: string | null; status: 'active' | 'inactive';
          wfh_balance: number; leave_balance: number; created_at: string; updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['employees']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['employees']['Insert']>;
      };
      holidays: {
        Row: { id: string; name: string; date: string; description: string | null; mandatory: boolean; created_by: string | null; created_at: string };
        Insert: { id?: string; name: string; date: string; description?: string | null; mandatory?: boolean; created_by?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['holidays']['Insert']>;
      };
      wfh_requests: {
        Row: { id: string; employee_id: string; date: string; duration: 'full_day' | 'half_day'; reason: string; note: string | null; status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['wfh_requests']['Row'], 'id' | 'created_at' | 'status'> & { id?: string; status?: 'pending' | 'approved' | 'rejected'; created_at?: string };
        Update: Partial<Database['public']['Tables']['wfh_requests']['Insert']>;
      };
      leave_requests: {
        Row: { id: string; employee_id: string; leave_type: 'casual' | 'sick' | 'earned' | 'unpaid'; start_date: string; end_date: string; days: number; reason: string; status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['leave_requests']['Row'], 'id' | 'created_at' | 'status'> & { id?: string; status?: 'pending' | 'approved' | 'rejected'; created_at?: string };
        Update: Partial<Database['public']['Tables']['leave_requests']['Insert']>;
      };
      attendance: {
        Row: { id: string; employee_id: string; date: string; mode: 'office' | 'wfh'; status: 'present' | 'late' | 'absent' | 'wfh' | 'leave' | 'holiday'; check_in_at: string | null; check_out_at: string | null; working_seconds: number; total_break_seconds: number; current_state: 'not_checked_in' | 'working' | 'on_break' | 'completed'; wfh_request_id: string | null; leave_request_id: string | null; notes: string | null; created_at: string; updated_at: string };
        Insert: Omit<Database['public']['Tables']['attendance']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database['public']['Tables']['attendance']['Insert']>;
      };
      break_events: {
        Row: { id: string; attendance_id: string; employee_id: string; break_start: string; break_end: string | null; duration_seconds: number | null; created_at: string };
        Insert: { id?: string; attendance_id: string; employee_id: string; break_start?: string; break_end?: string | null; duration_seconds?: number | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['break_events']['Insert']>;
      };
      attendance_events: {
        Row: { id: string; attendance_id: string; event_type: 'check_in' | 'check_out' | 'break_start' | 'break_end'; event_at: string; user_agent: string | null; created_at: string };
        Insert: { id?: string; attendance_id: string; event_type: 'check_in' | 'check_out' | 'break_start' | 'break_end'; event_at?: string; user_agent?: string | null; created_at?: string };
        Update: never;
      };
      regularization_requests: {
        Row: { id: string; employee_id: string; attendance_id: string | null; date: string; original_check_in: string | null; original_check_out: string | null; requested_check_in: string; requested_check_out: string; reason: string; status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string };
        Insert: Omit<Database['public']['Tables']['regularization_requests']['Row'], 'id' | 'created_at' | 'status'> & { id?: string; status?: 'pending' | 'approved' | 'rejected'; created_at?: string };
        Update: Partial<Database['public']['Tables']['regularization_requests']['Insert']>;
      };
      auth_sessions: {
        Row: { id: string; user_id: string; login_at: string; logout_at: string | null; session_duration_seconds: number | null; user_agent: string | null; status: 'active' | 'ended' | 'expired'; created_at: string };
        Insert: { id?: string; user_id: string; login_at?: string; logout_at?: string | null; session_duration_seconds?: number | null; user_agent?: string | null; status?: 'active' | 'ended' | 'expired'; created_at?: string };
        Update: Partial<Database['public']['Tables']['auth_sessions']['Insert']>;
      };
    };
    Views: {};
    Functions: {
      get_my_role: { Args: Record<string, never>; Returns: string };
      get_my_employee_id: { Args: Record<string, never>; Returns: string };
      get_employee_login_email: { Args: { p_name: string }; Returns: string | null };
    };
    Enums: {};
  };
}
