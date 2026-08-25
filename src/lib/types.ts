// A candidate row as read by the admin board (RLS-gated to admins).
export type Candidate = {
  id: string
  full_name: string
  email: string | null
  registration_number: string
  exam_year: number
  passport_url: string | null
  phone: string | null
  course: string | null
  date_of_birth: string | null
  state_of_origin: string | null
  marital_status: string | null
  lga: string | null
  occupation: string | null
  religion: string | null
  last_institution: string | null
  next_of_kin_name: string | null
  next_of_kin_phone: string | null
  gender: string | null
  class_schedule: string | null
  address: string | null
  // Where the row came from: 'online' = self-registered, 'paper_import' =
  // bulk CSV import of old paper-form records.
  source: string
  certificate_url: string | null
  is_verified: boolean
  issue_date: string | null
  created_at: string
}

// Shape returned by the verify_candidate RPC (no id / certificate_url exposed).
// Keyed on registration number + phone; returns only what the profile renders.
export type VerifiedProfile = {
  full_name: string
  registration_number: string
  passport_url: string | null
  address: string | null
  state_of_origin: string | null
  course: string | null
  age: number | null
  is_verified: boolean
  issue_date: string | null
  has_certificate: boolean
}

// Admin view of a submitted story (RLS-gated to admins; includes private phone).
export type Experience = {
  id: string
  full_name: string
  program: string | null
  phone: string
  experience: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

// Public shape from list_approved_experiences() — no phone, no status.
export type PublicExperience = {
  id: string
  full_name: string
  program: string | null
  experience: string
  created_at: string
}
