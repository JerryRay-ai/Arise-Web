import { describe, it, expect } from 'vitest'
import {
  isValidEmail,
  isValidName,
  isValidPhone,
  passportError,
  certificateError,
  registerErrorMessage,
  registerErrorCode,
  experienceError,
  submitErrorMessage,
  submitErrorCode,
  verifyErrorMessage,
  verifyErrorCode,
} from './validation'

function fileOf(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('someone@example.com')).toBe(true)
  })

  it('rejects missing @ or domain', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    expect(isValidEmail('  a@b.co ')).toBe(true)
  })
})

describe('isValidName', () => {
  it('accepts names of two or more characters', () => {
    expect(isValidName('Ada')).toBe(true)
  })

  it('rejects single characters and blanks', () => {
    expect(isValidName('A')).toBe(false)
    expect(isValidName('   ')).toBe(false)
  })
})

describe('isValidPhone', () => {
  it('accepts international and spaced numbers', () => {
    expect(isValidPhone('+234 803 123 4567')).toBe(true)
    expect(isValidPhone('08031234567')).toBe(true)
  })

  it('rejects numbers with fewer than 7 digits', () => {
    expect(isValidPhone('123456')).toBe(false)
    expect(isValidPhone('abc')).toBe(false)
  })
})

describe('passportError', () => {
  it('accepts a small JPEG/PNG', () => {
    expect(passportError(fileOf('p.jpg', 'image/jpeg', 1024))).toBeNull()
    expect(passportError(fileOf('p.png', 'image/png', 1024))).toBeNull()
  })

  it('rejects non-image types', () => {
    expect(passportError(fileOf('p.pdf', 'application/pdf', 1024))).toMatch(/JPEG|PNG/i)
  })

  it('rejects files over 5MB', () => {
    expect(passportError(fileOf('big.jpg', 'image/jpeg', 6 * 1024 * 1024))).toMatch(/5MB/i)
  })
})

describe('certificateError', () => {
  it('accepts a small PDF', () => {
    expect(certificateError(fileOf('c.pdf', 'application/pdf', 1024))).toBeNull()
  })

  it('rejects non-PDF types', () => {
    expect(certificateError(fileOf('c.jpg', 'image/jpeg', 1024))).toMatch(/PDF/i)
  })
})

describe('registerError helpers', () => {
  it('maps every known code to a message', () => {
    const codes = [
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
    for (const code of codes) {
      expect(registerErrorMessage(code)).not.toMatch(/Something went wrong/)
    }
  })

  it('falls back for unknown codes', () => {
    expect(registerErrorMessage('UNKNOWN')).toMatch(/Something went wrong/)
  })

  it('extracts a known code from an error message', () => {
    expect(registerErrorCode('Candidate with EMAIL_EXISTS already registered')).toBe('EMAIL_EXISTS')
  })

  it('returns empty when nothing matches', () => {
    expect(registerErrorCode('database error')).toBe('')
    expect(registerErrorCode(undefined)).toBe('')
  })
})

describe('experienceError', () => {
  it('rejects text shorter than 40 chars', () => {
    expect(experienceError('too short')).toMatch(/40/)
  })

  it('rejects text longer than 1200 chars', () => {
    expect(experienceError('x'.repeat(1201))).toMatch(/1200/)
  })

  it('accepts text in range', () => {
    expect(experienceError('x'.repeat(80))).toBeNull()
  })
})

describe('submit/verify error helpers', () => {
  it('maps submit codes', () => {
    expect(submitErrorMessage('RATE_LIMITED')).toMatch(/Too many submissions/)
    expect(submitErrorCode('INVALID_PHONE somewhere')).toBe('INVALID_PHONE')
    expect(submitErrorCode('nope')).toBe('')
  })

  it('maps verify codes', () => {
    expect(verifyErrorMessage('NOT_FOUND')).toMatch(/No matching record/)
    expect(verifyErrorCode('RATE_LIMITED')).toBe('RATE_LIMITED')
    expect(verifyErrorCode(undefined)).toBe('')
  })
})
