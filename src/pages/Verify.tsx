import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { Search, Loader2, ShieldCheck, Download, RotateCcw } from 'lucide-react'
import { getSupabase } from '../lib/supabase'
import { isValidPhone, verifyErrorCode, verifyErrorMessage } from '../lib/validation'
import type { VerifiedProfile } from '../lib/types'

type Status = 'idle' | 'searching' | 'downloading'

export default function Verify() {
  const [reg, setReg] = useState('')
  const [phone, setPhone] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<VerifiedProfile | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  const captchaRef = useRef<HCaptcha | null>(null)
  const hcaptchaSitekey = import.meta.env.VITE_HCAPTCHA_SITEKEY ?? ''

  function resetCaptcha() {
    captchaRef.current?.resetCaptcha()
    setCaptchaToken('')
  }

  // After a successful two-factor lookup, ask the `passport` Edge Function
  // (which re-verifies the same credentials) for a short-lived signed URL to
  // the candidate's photo. The photo bucket is private, so an <img> tag can
  // only ever point at a freshly-signed URL.
  async function loadPhoto() {
    setPhotoUrl(null)
    try {
      const supabase = getSupabase()
      const { data, error: fnErr } = await supabase.functions.invoke('passport', {
        body: { phone: phone.trim(), registration_number: reg.trim() },
      })
      if (fnErr) return
      const url = (data as { url?: string } | null)?.url
      if (url) setPhotoUrl(url)
    } catch {
      /* photo fails silently — profile still renders without it */
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const regNo = reg.trim()
    if (regNo.length < 3) return setError('Enter your student registration number.')
    if (!isValidPhone(phone)) return setError('Enter the phone number you registered with.')
    if (!captchaToken) return setError('Please complete the CAPTCHA to prove you are human.')

    setStatus('searching')
    try {
      const supabase = getSupabase()
      // The lookup runs through the `verify` Edge Function, which validates the
      // CAPTCHA token server-side before calling the two-factor RPC.
      const { data, error: fnErr } = await supabase.functions.invoke('verify', {
        body: {
          phone: phone.trim(),
          registration_number: regNo,
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
        throw new Error(verifyErrorMessage(verifyErrorCode(detail)))
      }

      const found = (Array.isArray(data) ? data[0] : data) as VerifiedProfile | undefined
      if (!found) {
        resetCaptcha()
        throw new Error('No matching record. Check your registration number and phone number.')
      }
      setProfile(found)
      void loadPhoto()
    } catch (err) {
      setProfile(null)
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setStatus('idle')
    }
  }

  async function downloadCertificate() {
    setError(null)
    setStatus('downloading')
    try {
      const supabase = getSupabase()
      // The private-certificate signing lives server-side in the Edge Function,
      // which re-checks the reg number + phone before minting a 5-minute URL.
      const { data, error: fnErr } = await supabase.functions.invoke('certificate', {
        body: { phone: phone.trim(), registration_number: reg.trim() },
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
        throw new Error(detail || 'Could not prepare your download. Please try again.')
      }
      const url = (data as { url?: string })?.url
      if (!url) throw new Error('Your certificate is not available yet.')
      // The signed URL is minted with a `download` disposition, so the browser
      // saves the PDF instead of opening it. A programmatic anchor click starts
      // the download without navigating away from this page.
      const a = document.createElement('a')
      a.href = url
      a.download = '' // filename comes from the server's Content-Disposition
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed. Please try again.')
    } finally {
      setStatus('idle')
    }
  }

  function reset() {
    setProfile(null)
    setPhotoUrl(null)
    setError(null)
    resetCaptcha()
  }
  // ---- Student profile (verification success) ----
  if (profile) {
    const graduated = profile.is_verified
    const canDownload = graduated && profile.has_certificate
    return (
      <main className="page">
        <div className="page__inner container">
          <header className="page__head page__head--center">
            <h1 className="page__title">Student Profile</h1>
            <p className="page__sub">
              Verification Successful. Below is the authenticated academic record and official
              digital certification for the successfully completed program at Arise ICT Hub.
            </p>
          </header>

          <div className="verifycard">
            <div className="verifycard__banner">
              <ShieldCheck size={16} />
              <span>Secured Arise Verification Record: ID {profile.registration_number}</span>
            </div>

            <div className="profile">
              <div className="profile__aside">
                {photoUrl ? (
                  <img
                    className="profile__photo"
                    src={photoUrl}
                    alt={profile.full_name}
                  />
                ) : (
                  <span className="profile__photo profile__photo--placeholder" aria-hidden="true" />
                )}
                <span className={`profile__badge${graduated ? '' : ' profile__badge--wait'}`}>
                  <span className="profile__dot" aria-hidden="true" />
                  {graduated ? 'Verified Graduate' : 'Enrolled Student'}
                </span>
              </div>

              <dl className="profile__grid">
                <div className="profile__item">
                  <dt>Full Name</dt>
                  <dd>{profile.full_name}</dd>
                </div>
                <div className="profile__item">
                  <dt>Age</dt>
                  <dd>{profile.age != null ? `${profile.age} Years` : '—'}</dd>
                </div>
                <div className="profile__item">
                  <dt>Marital Status</dt>
                  <dd>{profile.marital_status ?? '—'}</dd>
                </div>
                <div className="profile__item">
                  <dt>State of Origin</dt>
                  <dd>{profile.state_of_origin ?? '—'}</dd>
                </div>
                <div className="profile__item">
                  <dt>Course Offering</dt>
                  <dd>{profile.course ?? '—'}</dd>
                </div>
                <div className="profile__item">
                  <dt>Course Status</dt>
                  <dd>
                    <span className={`status${graduated ? ' status--ok' : ' status--wait'}`}>
                      {graduated ? 'Graduated' : 'In Progress'}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            {error && (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            )}

            {canDownload ? (
              <button
                className="btn btn--green verifycard__download"
                type="button"
                onClick={downloadCertificate}
                disabled={status === 'downloading'}
              >
                {status === 'downloading' ? (
                  <>
                    <Loader2 className="spin" size={18} /> Preparing…
                  </>
                ) : (
                  <>
                    <Download size={18} /> Download Official Certificate
                  </>
                )}
              </button>
            ) : (
              <p className="verifycard__pending">
                Your certificate has not been issued yet. Check back once your program results are
                published.
              </p>
            )}
          </div>

          <div className="verifycard__foot">
            <button className="btn btn--ghost" type="button" onClick={reset}>
              <RotateCcw size={16} /> Check another record
            </button>
          </div>
        </div>
      </main>
    )
  }
// __CONT2__

  // ---- Certificate inquiry form ----
  return (
    <main className="page">
      <div className="page__inner container">
        <header className="page__head page__head--center">
          <h1 className="page__title">Verify Your Certificate</h1>
          <p className="page__sub">
            Enter your credentials below to authenticate your Arise ICT Hub digital certification.
            Students can verify enrollment statuses, program completions, and securely download
            official records.
          </p>
        </header>

        <form className="formcard formcard--inquiry" onSubmit={onSubmit} noValidate>
          <h2 className="formcard__heading">Certificate Inquiry</h2>

          {error && (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          )}

          <div className="form__row">
            <label className="form__label" htmlFor="v_reg">
              Student Registration Number
            </label>
            <input
              id="v_reg"
              className="form__control"
              type="text"
              value={reg}
              onChange={(e) => setReg(e.target.value)}
              placeholder="e.g. ARISE/ICT/2026/000"
              autoComplete="off"
              required
            />
          </div>

          <div className="form__row">
            <label className="form__label" htmlFor="v_phone">
              Phone Number
            </label>
            <input
              id="v_phone"
              className="form__control"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +234 707 155 6233"
              autoComplete="tel"
              required
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
                Security check unavailable. Please set <code>VITE_HCAPTCHA_SITEKEY</code> to verify.
              </p>
            )}
          </div>

          <button
            className="btn btn--green formcard__submit"
            type="submit"
            disabled={status === 'searching'}
          >
            {status === 'searching' ? (
              <>
                <Loader2 className="spin" size={18} /> Checking…
              </>
            ) : (
              <>
                <Search size={18} /> Check Status
              </>
            )}
          </button>

          <p className="formcard__foot">
            Not registered yet?{' '}
            <Link to="/register" className="link">
              Enroll now
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
