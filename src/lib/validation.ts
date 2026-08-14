export const PASSPORT_MAX_BYTES = 5 * 1024 * 1024 // 2 MB
export const PASSPORT_TYPES = ['image/jpeg', 'image/png'] as const

// Certificates the admin uploads: PDF only, up to 5 MB.
export const CERT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
export const CERT_TYPES = ['application/pdf'] as const

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Course + schedule options as shown on the registration design.
export const COURSES = [
  'Web Development',
  'UI/UX Design',
  'Graphic Design',
  'Data Analytics',
  ' Basic Computer Education',
] as const

export const CLASS_SCHEDULES = ['9am - 11am', '11am - 1pm', '2pm - 4pm'] as const

export const GENDERS = ['Male', 'Female'] as const

export const MARITAL_STATUSES = ['Single', 'Married'] as const

export const RELIGIONS = ['Christianity', 'Islam', 'Traditional', 'Other'] as const

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function isValidName(name: string): boolean {
  return name.trim().length >= 2
}

// Accept +, spaces, dashes and parentheses, but require at least 7 digits.
export function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 7
}

export function passportError(file: File): string | null {
  if (!PASSPORT_TYPES.includes(file.type as (typeof PASSPORT_TYPES)[number])) {
    return 'Passport must be a JPEG or PNG image.'
  }
  if (file.size > PASSPORT_MAX_BYTES) {
    return 'Passport photo must be 5MB or smaller.'
  }
  return null
}

export function certificateError(file: File): string | null {
  if (!CERT_TYPES.includes(file.type as (typeof CERT_TYPES)[number])) {
    return 'Certificate must be a PDF file.'
  }
  if (file.size > CERT_MAX_BYTES) {
    return 'Certificate must be 5MB or smaller.'
  }
  return null
}

// Human-readable message for the error codes raised by register_candidate
export function registerErrorMessage(code: string): string {
  switch (code) {
    case 'EMAIL_EXISTS':
      return 'A candidate is already registered with this email.'
    case 'INVALID_NAME':
      return 'Please enter your full name.'
    case 'INVALID_EMAIL':
      return 'Please enter a valid email address.'
    case 'INVALID_PHONE':
      return 'Please enter a valid phone number.'
    case 'INVALID_PASSPORT':
      return 'Passport photo upload failed. Please try again.'
    case 'INVALID_OCCUPATION':
      return 'Please enter your occupation.'
    case 'INVALID_RELIGION':
      return 'Please select your religion.'
    case 'MISSING_FIELD':
      return 'Please complete all required fields. Only email is optional.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Please try again later.'
    case 'CAPTCHA_REQUIRED':
      return 'Please complete the CAPTCHA to continue.'
    case 'CAPTCHA_FAILED':
      return 'Verification failed. Please try the CAPTCHA again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

// Maps a raw Supabase RPC error message to one of our known codes.
export function registerErrorCode(message: string | undefined): string {
  if (!message) return ''
  const known = [
    'EMAIL_EXISTS',
    'INVALID_NAME',
    'INVALID_EMAIL',
    'INVALID_PHONE',
    'INVALID_PASSPORT',
    'INVALID_OCCUPATION',
    'INVALID_RELIGION',
    'MISSING_FIELD',
    'RATE_LIMITED',
    'CAPTCHA_REQUIRED',
    'CAPTCHA_FAILED',
  ]
  return known.find((code) => message.includes(code)) ?? ''
}

// ---------------------------------------------------------------
// Alumni "Success Stories" submissions (submit_experience RPC)
// ---------------------------------------------------------------
export const EXPERIENCE_MIN = 40
export const EXPERIENCE_MAX = 1200

export function experienceError(text: string): string | null {
  const t = text.trim()
  if (t.length < EXPERIENCE_MIN) return `Please share at least ${EXPERIENCE_MIN} characters about your experience.`
  if (t.length > EXPERIENCE_MAX) return `Please keep your story under ${EXPERIENCE_MAX} characters.`
  return null
}

export function submitErrorMessage(code: string): string {
  switch (code) {
    case 'INVALID_NAME':
      return 'Please enter your full name.'
    case 'INVALID_PROGRAM':
      return 'Please select the program you took.'
    case 'INVALID_PHONE':
      return 'Please enter a valid phone number.'
    case 'INVALID_EXPERIENCE':
      return 'Please share a bit more about your experience.'
    case 'RATE_LIMITED':
      return 'Too many submissions from this number. Please try again later.'
    case 'CAPTCHA_REQUIRED':
      return 'Please complete the CAPTCHA to continue.'
    case 'CAPTCHA_FAILED':
      return 'Verification failed. Please try the CAPTCHA again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export function submitErrorCode(message: string | undefined): string {
  if (!message) return ''
  const known = [
    'INVALID_NAME',
    'INVALID_PROGRAM',
    'INVALID_PHONE',
    'INVALID_EXPERIENCE',
    'RATE_LIMITED',
    'CAPTCHA_REQUIRED',
    'CAPTCHA_FAILED',
  ]
  return known.find((code) => message.includes(code)) ?? ''
}

// ---------------------------------------------------------------
// Certificate portal lookups (verify Edge Function)
// ---------------------------------------------------------------
export function verifyErrorMessage(code: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'No matching record. Check your registration number and phone number.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a few minutes.'
    case 'CAPTCHA_REQUIRED':
      return 'Please complete the CAPTCHA to continue.'
    case 'CAPTCHA_FAILED':
      return 'Verification failed. Please try the CAPTCHA again.'
    default:
      return 'Lookup failed. Please try again.'
  }
}

export function verifyErrorCode(message: string | undefined): string {
  if (!message) return ''
  const known = ['NOT_FOUND', 'RATE_LIMITED', 'CAPTCHA_REQUIRED', 'CAPTCHA_FAILED']
  return known.find((code) => message.includes(code)) ?? ''
}
