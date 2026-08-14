import type { Candidate } from './types'

// Quote a single CSV field: fields containing a comma, quote or newline are
// wrapped in double quotes, with embedded quotes doubled.
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export type StudentCsvRow = {
  fullName: string
  registrationNumber: string
  email: string
  phone: string
  course: string
  examYear: string
  status: string
  stateOfOrigin: string
  maritalStatus: string
  registeredOn: string
}

// Builds the student export. `rows` should be the currently-visible (filtered)
// list; the file mirrors the table columns shown to the admin.
export function buildStudentsCsv(rows: Candidate[]): string {
  const header = [
    'Full Name',
    'Reg. Number',
    'Email',
    'Phone',
    'Course',
    'Exam Year',
    'Status',
    'State of Origin',
    'Marital Status',
    'Registered On',
  ]
  const lines: string[] = [header.map(csvField).join(',')]
  for (const r of rows) {
    const row: StudentCsvRow = {
      fullName: r.full_name,
      registrationNumber: r.registration_number,
      email: r.email ?? '',
      phone: r.phone ?? '',
      course: r.course ?? '',
      examYear: String(r.exam_year),
      status: r.is_verified ? 'Issued' : 'Awaiting',
      stateOfOrigin: r.state_of_origin ?? '',
      maritalStatus: r.marital_status ?? '',
      registeredOn: r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
    }
    lines.push(Object.values(row).map(csvField).join(','))
  }
  // BOM so Excel opens the UTF-8 file with the right characters.
  return `\uFEFF${lines.join('\r\n')}`
}

// A safe filename for the export, e.g. arise-students-2026-08-13.csv
export function studentsFileName(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `arise-students-${y}-${m}-${d}.csv`
}
