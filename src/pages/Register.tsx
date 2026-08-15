import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { CheckCircle2, ArrowLeft, Loader2, Copy, Check, X } from 'lucide-react'
import PassportPicker from '../components/PassportPicker'
import { getSupabase } from '../lib/supabase'
import { NIGERIA_STATES, getLgas } from '../data/nigeria'
import {
  COURSES,
  CLASS_SCHEDULES,
  GENDERS,
  MARITAL_STATUSES,
  RELIGIONS,
  isValidEmail,
  isValidName,
  isValidPhone,
  passportError,
  registerErrorCode,
  registerErrorMessage,
} from '../lib/validation'

type Status = 'idle' | 'submitting'

export default function Register() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [stateOfOrigin, setStateOfOrigin] = useState('')
  const [lga, setLga] = useState('')
  const [dob, setDob] = useState('')
  const [occupation, setOccupation] = useState('')
  const [religion, setReligion] = useState('')
  const [lastInstitution, setLastInstitution] = useState('')
  const [maritalStatus, setMaritalStatus] = useState('')
  const [nokName, setNokName] = useState('')
  const [nokPhone, setNokPhone] = useState('')
  const [gender, setGender] = useState('')
  const [course, setCourse] = useState('')
  const [schedule, setSchedule] = useState('')
  const [address, setAddress] = useState('')
  const [passport, setPassport] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [regNumber, setRegNumber] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')

  const captchaRef = useRef<HCaptcha | null>(null)
  const hcaptchaSitekey = import.meta.env.VITE_HCAPTCHA_SITEKEY ?? ''

  function resetCaptcha() {
    captchaRef.current?.resetCaptcha()
    setCaptchaToken('')
  }

  function onPickFile(file: File | null) {
    setError(null)
    if (preview) URL.revokeObjectURL(preview)
    if (!file) {
      setPassport(null)
      setPreview(null)
      return
    }
    const pErr = passportError(file)
    if (pErr) {
      setError(pErr)
      setPassport(null)
      setPreview(null)
      return
    }
    setPassport(file)
    setPreview(URL.createObjectURL(file))
  }

  function removePassport() {
    if (preview) URL.revokeObjectURL(preview)
    setPassport(null)
    setPreview(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const name = fullName.trim()
    const mail = email.trim().toLowerCase()

    if (!isValidName(name)) return setError('Please enter your full name.')
    if (mail && !isValidEmail(mail)) return setError('Please enter a valid email address.')
    if (!isValidPhone(phone)) return setError('Please enter a valid phone number.')
    if (!stateOfOrigin) return setError('Please select your state of origin.')
    if (!lga) return setError('Please select your local government area.')
    if (!dob) return setError('Please enter your date of birth.')
    if (!occupation.trim()) return setError('Please enter your occupation.')
    if (!religion) return setError('Please select your religion.')
    if (!lastInstitution.trim()) return setError('Please enter your last institution attended.')
    if (!maritalStatus) return setError('Please select your marital status.')
    if (!nokName.trim()) return setError('Please enter your next of kin’s name.')
    if (!isValidPhone(nokPhone)) return setError('Please enter your next of kin’s phone number.')
    if (!gender) return setError('Please select your gender.')
    if (!course) return setError('Please select a course.')
    if (!schedule) return setError('Please select a class schedule.')
    if (!address.trim()) return setError('Please enter your address.')
    if (!passport) return setError('Please attach your passport photo.')
    const pErr = passportError(passport)
    if (pErr) return setError(pErr)
    if (!captchaToken) return setError('Please complete the CAPTCHA to prove you are human.')

    setStatus('submitting')
    try {
      const supabase = getSupabase()
      // 1. Upload the passport through the validating Edge Function, which
      //    checks magic bytes + size server-side and stores it privately.
      //    It returns the object path (not a public URL).
      const form = new FormData()
      form.append('file', passport)
      const { data: upData, error: upErr } = await supabase.functions.invoke(
        'upload-passport',
        { body: form }
      )
      if (upErr) {
        // Surface the Edge Function's own reason (deployment / CORS / storage
        // errors all land here) instead of a generic message.
        let detail = ''
        const ctx = (upErr as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            detail = (await ctx.json())?.error ?? ''
          } catch {
            /* body wasn't JSON */
          }
        }
        throw new Error(
          detail || upErr.message || 'Passport upload failed. Please try again.'
        )
      }
      const path = (upData as { path?: string } | null)?.path
      if (!path) throw new Error('Passport upload failed. Please try again.')

      // 2. Register through the `register` Edge Function, which verifies the
      //    CAPTCHA token server-side BEFORE invoking the hardened RPC. The
      //    anon key can no longer create candidates on its own.
      const { data, error: fnErr } = await supabase.functions.invoke('register', {
        body: {
          full_name: name,
          email: mail || null,
          phone: phone.trim(),
          state_of_origin: stateOfOrigin.trim(),
          lga: lga.trim(),
          date_of_birth: dob || null,
          occupation: occupation.trim(),
          religion,
          last_institution: lastInstitution.trim(),
          marital_status: maritalStatus,
          next_of_kin_name: nokName.trim(),
          next_of_kin_phone: nokPhone.trim(),
          gender,
          course,
          class_schedule: schedule,
          address: address.trim(),
          passport_url: path,
          captcha_token: captchaToken,
        },
      })

      if (fnErr) {
        // supabase-js wraps a non-2xx function response in FunctionsHttpError;
        // the real reason is in the response body on error.context.
        let detail = ''
        const ctx = (fnErr as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            detail = (await ctx.json())?.error ?? ''
          } catch {
            /* body wasn't JSON */
          }
        }
        resetCaptcha()
        throw new Error(registerErrorMessage(registerErrorCode(detail)))
      }

      const reg = (data as { registration_number?: string } | null)?.registration_number
      if (!reg) throw new Error('Registration succeeded but no number was returned.')

      setRegNumber(reg)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setStatus('idle')
    }
  }

  async function copyReg() {
    if (!regNumber) return
    try {
      await navigator.clipboard.writeText(regNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  // ---- Success screen ----
  if (regNumber) {
    return (
      <main className="page">
        <div className="page__inner container">
          <div className="formcard formcard--center">
            <span className="formcard__icon formcard__icon--success">
              <CheckCircle2 size={30} strokeWidth={2.2} />
            </span>
            <h1 className="formcard__title">Registration complete</h1>
            <p className="formcard__lead">
              Welcome to ARISE ICT HUB{course ? ` — ${course}` : ''}. Save your registration number —
              you’ll need it (with your phone number) to check your status and download your certificate.
            </p>

            <div className="regbox">
              <span className="regbox__label">Your registration number</span>
              <div className="regbox__value">
                <strong>{regNumber}</strong>
                <button type="button" className="regbox__copy" onClick={copyReg}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="formcard__actions">
              <Link className="btn btn--primary" to="/verify">
                Go to Certificate Portal
              </Link>
              <Link className="btn btn--ghost" to="/">
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ---- Registration form ----
  return (
    <main className="page">
      <div className="page__inner page__inner--wide container">
        <Link className="page__back" to="/">
          <ArrowLeft size={16} /> Back
        </Link>

        <header className="reghead">
          <img className="reghead__logo" src="/assets/logo.png" alt="ARISE ICT HUB" />
          <div>
            <h1 className="reghead__title">New Student Registration</h1>
            <p className="reghead__sub">
              Complete the registration form below to apply for our programs.
            </p>
          </div>
        </header>

        <form className="regform" onSubmit={onSubmit} noValidate>
          <h2 className="regform__heading">Student’s Registration Form</h2>

          {error && (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          )}

          <div className="form__row">
            <label className="form__label" htmlFor="full_name">Full Name</label>
            <input
              id="full_name" className="form__control" type="text"
              value={fullName} onChange={(e) => setFullName(e.target.value)}
              autoComplete="name" required
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="email">
              Email Address <span className="form__opt">(optional)</span>
            </label>
            <input
              id="email" className="form__control" type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="phone">Phone Number</label>
            <input
              id="phone" className="form__control" type="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel" required
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="state">State of Origin</label>
            <select
              id="state" className="form__control form__control--select"
              value={stateOfOrigin} onChange={(e) => {
                setStateOfOrigin(e.target.value)
                setLga('')
              }}
            >
              <option value="">Select…</option>
              {NIGERIA_STATES.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="lga">Local Government Area</label>
            <select
              id="lga" className="form__control form__control--select"
              value={lga} onChange={(e) => setLga(e.target.value)}
              disabled={!stateOfOrigin}
            >
              <option value="">{stateOfOrigin ? 'Select…' : 'Select your state first'}</option>
              {getLgas(stateOfOrigin).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="dob">Date of Birth</label>
            <input
              id="dob" className="form__control" type="date"
              value={dob} onChange={(e) => setDob(e.target.value)}
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="occupation">Occupation</label>
            <input
              id="occupation" className="form__control" type="text"
              value={occupation} onChange={(e) => setOccupation(e.target.value)}
              autoComplete="organization-title"
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="religion">Religion</label>
            <select
              id="religion" className="form__control form__control--select"
              value={religion} onChange={(e) => setReligion(e.target.value)}
            >
              <option value="">Select…</option>
              {RELIGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="last_institution">Last Institution Attended</label>
            <input
              id="last_institution" className="form__control" type="text"
              value={lastInstitution} onChange={(e) => setLastInstitution(e.target.value)}
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="marital">Marital Status</label>
            <select
              id="marital" className="form__control form__control--select"
              value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)}
            >
              <option value="">Select…</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="nok_name">Next of Kin’s Name</label>
            <input
              id="nok_name" className="form__control" type="text"
              value={nokName} onChange={(e) => setNokName(e.target.value)}
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="nok_phone">Next of Kin’s Phone Number</label>
            <input
              id="nok_phone" className="form__control" type="tel"
              value={nokPhone} onChange={(e) => setNokPhone(e.target.value)}
            />
          </div>

          <fieldset className="form__row form__fieldset">
            <legend className="form__label">Gender</legend>
            <div className="choice__list">
              {GENDERS.map((g) => (
                <label key={g} className="choice">
                  <input
                    type="radio" name="gender" value={g}
                    checked={gender === g} onChange={() => setGender(g)}
                  />
                  <span className="choice__box" aria-hidden="true" />
                  <span>{g}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="form__row form__fieldset">
            <legend className="form__label">Select Course</legend>
            <div className="pills">
              {COURSES.map((c) => (
                <button
                  key={c} type="button"
                  className={`pillbtn${course === c ? ' pillbtn--on' : ''}`}
                  aria-pressed={course === c}
                  onClick={() => setCourse(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form__row form__fieldset">
            <legend className="form__label">Class Schedule</legend>
            <div className="pills">
              {CLASS_SCHEDULES.map((s) => (
                <button
                  key={s} type="button"
                  className={`pillbtn${schedule === s ? ' pillbtn--on' : ''}`}
                  aria-pressed={schedule === s}
                  onClick={() => setSchedule(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="form__row">
            <label className="form__label" htmlFor="address">Address</label>
            <textarea
              id="address" className="form__control form__control--area" rows={3}
              value={address} onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="form__row attachrow">
            <span className="form__label">Attach your Passport</span>
            {preview ? (
              <div className="passport">
                <img className="passport__thumb" src={preview} alt="Passport preview" />
                <div className="passport__meta">
                  <span className="passport__name">{passport?.name}</span>
                  <div className="passport__acts">
                    <button
                      type="button"
                      className="passport__link passport__link--danger"
                      onClick={removePassport}
                    >
                      <X size={13} /> Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <PassportPicker onFile={onPickFile} />
          </div>

          <div className="form__row captcha-row">
            <span className="form__label">Security Check</span>
            {hcaptchaSitekey ? (
              <HCaptcha
                ref={captchaRef}
                sitekey={hcaptchaSitekey}
                onVerify={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken('')}
                onError={() => {
                  setCaptchaToken('')
                  setError('The security check could not be loaded. Please refresh and try again.')
                }}
              />
            ) : (
              <p className="form__hint">
                Security check unavailable. Please set <code>VITE_HCAPTCHA_SITEKEY</code> to register.
              </p>
            )}
          </div>

          <button
            className="btn btn--primary regform__submit"
            type="submit"
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? (
              <>
                <Loader2 className="spin" size={18} /> Submitting…
              </>
            ) : (
              'Submit Form'
            )}
          </button>

          <p className="formcard__foot">
            Already registered?{' '}
            <Link to="/verify" className="link">Verify a certificate</Link>
          </p>
        </form>
      </div>
    </main>
  )
}
