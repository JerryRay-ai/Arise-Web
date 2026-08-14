import { describe, it, expect } from 'vitest'
import { csvField, buildStudentsCsv, studentsFileName } from './csv'
import type { Candidate } from './types'

describe('csvField', () => {
  it('leaves simple values unquoted', () => {
    expect(csvField('Ada Lovelace')).toBe('Ada Lovelace')
  })

  it('quotes values containing commas', () => {
    expect(csvField('Benue, Makurdi')).toBe('"Benue, Makurdi"')
  })

  it('doubles embedded quotes', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes values with newlines', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('buildStudentsCsv', () => {
  const row: Candidate = {
    id: '1',
    full_name: 'Ada Lovelace',
    registration_number: 'AR/2025/0001',
    email: 'ada@example.com',
    phone: '08030000000',
    course: 'Web Development',
    exam_year: 2025,
    passport_url: 'abc.jpg',
    date_of_birth: '2000-01-01',
    certificate_url: null,
    is_verified: true,
    issue_date: '2026-08-13',
    state_of_origin: 'Akwa Ibom',
    marital_status: 'Single',
    created_at: '2026-08-13T10:00:00Z',
  }

  it('starts with a UTF-8 BOM', () => {
    expect(buildStudentsCsv([row]).startsWith('\uFEFF')).toBe(true)
  })

  it('writes the header row', () => {
    const lines = buildStudentsCsv([row]).slice(1).split('\r\n')
    expect(lines[0]).toBe(
      'Full Name,Reg. Number,Email,Phone,Course,Exam Year,Status,State of Origin,Marital Status,Registered On'
    )
  })

  it('writes issued status for verified students', () => {
    const lines = buildStudentsCsv([row]).slice(1).split('\r\n')
    expect(lines[1]).toContain(',Issued,')
  })

  it('marks unverified students as awaiting', () => {
    const lines = buildStudentsCsv([{ ...row, is_verified: false }]).slice(1).split('\r\n')
    expect(lines[1]).toContain(',Awaiting,')
  })
})

describe('studentsFileName', () => {
  it('formats the date into a filename', () => {
    expect(studentsFileName(new Date(2026, 7, 13))).toBe('arise-students-2026-08-13.csv')
  })
})
