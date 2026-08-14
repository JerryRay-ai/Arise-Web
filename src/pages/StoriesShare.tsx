import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { CheckCircle2, ArrowLeft, Loader2 } from 'lucide-react'
import { getSupabase } from '../lib/supabase'
import {
  COURSES,
  isValidName,
  isValidPhone,
  experienceError,
  submitErrorCode,
  submitErrorMessage,
} from '../lib/validation'

type Status = 'idle' | 'submitting'

export default function StoriesShare() {
  const [fullName, setFullName] = useState('')
  const [program, setProgram] = useState('')
  const [phone, setPhone] = useState('')
  const [experience, setExperience] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const captchaRef = useRef<HCaptcha | null>(null)
  const hcaptchaSitekey = import.meta.env.VITE_HCAPTCHA_SITEKEY ?? ''

  function resetCaptcha() {
    captchaRef.current?.resetCaptcha()
    setCaptchaToken('')
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const name = fullName.trim()
    if (!isValidName(name)) return setError('Please enter your full name.')
    if (!program) return setError('Please select the program you took.')
    if (!isValidPhone(phone)) return setError('Please enter a valid phone number.')
    const expErr = experienceError(experience)
    if (expErr) return setError(expErr)
    if (!captchaToken) return setError('Please complete the CAPTCHA to prove you are human.')

    setStatus('submitting')
    try {
      const supabase = getSupabase()
      // Submission runs through the `share-story` Edge Function, which verifies
      // the CAPTCHA token server-side before invoking the hardened RPC.
      const { error: fnErr } = await supabase.functions.invoke('share-story', {
        body: {
          full_name: name,
          program,
          phone: phone.trim(),
          experience: experience.trim(),
          captcha_token: captchaToken,
        },
      })
      if (fnErr) {
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
        throw new Error(submitErrorMessage(submitErrorCode(detail)))
      }
      setSubmitted(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setStatus('idle')
    }
  }

  // ---- Success screen ----
  if (submitted) {
    return (
      <main className="page">
        <div className="page__inner container">
          <div className="formcard formcard--center">
            <span className="formcard__icon formcard__icon--success">
              <CheckCircle2 size={30} strokeWidth={2.2} />
            </span>
            <h1 className="formcard__title">Thanks for sharing</h1>
            <p className="formcard__lead">
              Your story has been submitted and will appear on the hub once our team reviews it.
              We keep your phone number private — it’s only used to verify you.
            </p>
            <div className="formcard__actions">
              <Link className="btn btn--primary" to="/stories">
                Back
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

  // ---- Submission form ----
  return (
    <main className="page">
      <div className="page__inner container">
        <Link className="page__back" to="/stories">
          <ArrowLeft size={16} /> Back
        </Link>

        <header className="reghead">
          <img className="reghead__logo" src="/assets/logo.png" alt="ARISE ICT HUB" />
          <div>
            <h1 className="reghead__title">Share your ARISE story</h1>
            <p className="reghead__sub">
              Tell us about your experience at ARISE ICT Hub. Approved stories appear on our
              Alumni Success Stories hub.
            </p>
          </div>
        </header>

        <form className="regform" onSubmit={onSubmit} noValidate>
          <h2 className="regform__heading">Your Experience</h2>

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
            <label className="form__label" htmlFor="program">Program You Took</label>
            <select
              id="program" className="form__control form__control--select"
              value={program} onChange={(e) => setProgram(e.target.value)}
            >
              <option value="">Select…</option>
              {COURSES.map((c) => (
                <option key={c} value={c.trim()}>{c.trim()}</option>
              ))}
            </select>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="phone">Phone Number</label>
            <input
              id="phone" className="form__control" type="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel" required
            />
            <p className="form__hint">
              Only used by our team to verify you — never shown publicly.
            </p>
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="experience">Your Experience</label>
            <textarea
              id="experience" className="form__control form__control--area" rows={5}
              value={experience} onChange={(e) => setExperience(e.target.value)}
              placeholder="What did you learn, build, or achieve? How did ARISE help your journey?"
            />
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
                Security check unavailable. Please set <code>VITE_HCAPTCHA_SITEKEY</code> to share a story.
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
              'Submit Story'
            )}
          </button>
        </form>
      </div>
    </main>
  )
}
