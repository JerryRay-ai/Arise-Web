import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

// Matches the native-splash green so the Android app's launch splash flows
// seamlessly into the admin console's own loading state.
const IS_NATIVE = Capacitor.isNativePlatform()
import {
  LayoutDashboard,
  Users,
  Award,
  Settings,
  LogOut,
  Bell,
  Search,
  ShieldCheck,
  Upload,
  UploadCloud,
  Eye,
  EyeOff,
  Lock,
  Trash2,
  FileText,
  Loader2,
  AlertCircle,
  X,
  Clock,
  CalendarDays,
  CalendarClock,
  Cake,
  Phone,
  Mail,
  MapPin,
  GraduationCap,
  Hash,
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserPlus,
  Quote,
  Check,
  Download,
  FileSpreadsheet,
  Pencil,
} from 'lucide-react'
import { getSupabase } from '../lib/supabase'
import PassportPicker from '../components/PassportPicker'
import { buildStudentsCsv, studentsFileName } from '../lib/csv'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  certificateError,
  passportError,
  isValidName,
  isValidPhone,
  isValidEmail,
  registerErrorCode,
  registerErrorMessage,
  COURSES,
  CLASS_SCHEDULES,
  GENDERS,
  MARITAL_STATUSES,
  RELIGIONS,
} from '../lib/validation'
import type { Candidate, Experience } from '../lib/types'
import { NIGERIA_STATES, getLgas } from '../data/nigeria'
import { clearDraft, dataUrlToFile, loadDraft, saveDraft } from '../lib/draft'

type AuthState = 'loading' | 'signed-out' | 'mfa-required' | 'checking' | 'not-admin' | 'admin'
type View = 'dashboard' | 'students' | 'settings' | 'stories' | 'security'

// Signed URLs must be minted from the object path inside the bucket. Some
// legacy rows stored a full public URL, so strip any prefix down to the path.
function passportPath(url: string): string {
  const marker = '/passports/'
  const i = url.indexOf(marker)
  return i >= 0 ? url.slice(i + marker.length) : url
}
type StatusFilter = 'all' | 'issued' | 'awaiting'
type StoryFilter = 'all' | 'pending' | 'approved' | 'rejected'
type Flash = { kind: 'ok' | 'err'; text: string }

const COLUMNS =
  'id, full_name, email, registration_number, exam_year, passport_url, phone, course, date_of_birth, state_of_origin, marital_status, lga, occupation, religion, last_institution, next_of_kin_name, next_of_kin_phone, gender, class_schedule, address, certificate_url, is_verified, issue_date, created_at'

const PAGE_SIZE = 8

// ---- Small helpers -----------------------------------------------------
const isIssued = (r: Candidate) => r.is_verified && !!r.certificate_url

// The stored PDF filename students download; friendlier than the raw {id}.pdf.
const certFileName = (r: Candidate) => `ARISE-Certificate-${r.registration_number}.pdf`

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  // Date-only strings ("YYYY-MM-DD") parse as UTC midnight; pin to local noon so
  // the displayed day never slips across a timezone boundary.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(email: string): string {
  const name = email.split('@')[0] ?? ''
  const parts = name.split(/[.\-_]+/).filter(Boolean)
  const chars = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')
  return chars.toUpperCase() || 'AD'
}

// Parse a date-only ("YYYY-MM-DD") or full ISO string to a timestamp (local noon
// for date-only, so the day never slips across a timezone boundary).
function toTime(value: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
  return new Date(iso).getTime()
}

// Coarse "2 min ago" / "3 hours ago" / "5 days ago", falling back to a date.
function timeAgo(value: string | null | undefined): string {
  if (!value) return ''
  const t = toTime(value)
  if (Number.isNaN(t)) return ''
  const secs = Math.floor((Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return fmtDate(value)
}

type ActivityItem = {
  key: string
  id: string
  name: string
  label: string
  tone: 'green' | 'orange'
  when: string
}

// Derive a "Recent Activity" feed from real candidate data: registrations
// (created_at) and certificate issuances (issue_date). No fabricated events.
function buildActivity(rows: Candidate[], limit = 6): ActivityItem[] {
  const events: ActivityItem[] = []
  for (const r of rows) {
    if (r.created_at) {
      events.push({
        key: `${r.id}-reg`,
        id: r.id,
        name: r.full_name,
        label: r.course ? `registered for ${r.course}` : 'registered',
        tone: 'orange',
        when: r.created_at,
      })
    }
    if (isIssued(r) && r.issue_date) {
      events.push({
        key: `${r.id}-iss`,
        id: r.id,
        name: r.full_name,
        label: 'was issued a certificate',
        tone: 'green',
        when: r.issue_date,
      })
    }
  }
  events.sort((a, b) => toTime(b.when) - toTime(a.when))
  return events.slice(0, limit)
}

// ---- Notification bell -------------------------------------------------
// The feed is the same real candidate events as Recent Activity; "read" state
// is just the timestamp of the last time the panel was opened, kept locally
// per browser (nothing to sync, nothing to store server-side).
const NOTIFS_SEEN_KEY = 'arise.admin.notifications-seen'

function readSeenAt(): number {
  try {
    const n = Number(localStorage.getItem(NOTIFS_SEEN_KEY) ?? 0)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0 // storage blocked (private mode) — treat everything as unread
  }
}

function NotificationBell({
  rows,
  onOpenStudent,
}: {
  rows: Candidate[]
  onOpenStudent: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [seenAt, setSeenAt] = useState(readSeenAt)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(() => buildActivity(rows, 12), [rows])
  const unread = useMemo(() => items.filter((it) => toTime(it.when) > seenAt).length, [items, seenAt])

  const markAllRead = useCallback(() => {
    // Snap the "seen" mark at least as far forward as the newest event in the
    // feed. Activity can carry date-only timestamps (certificate issue_date →
    // local noon), which would otherwise stay "newer" than a mark set earlier
    // the same day and keep reappearing as unread after a re-login.
    const newest = items.reduce((max, it) => Math.max(max, toTime(it.when)), 0)
    const seen = Math.max(Date.now(), newest)
    setSeenAt(seen)
    try {
      localStorage.setItem(NOTIFS_SEEN_KEY, String(seen))
    } catch {
      /* storage blocked — badge simply returns on reload */
    }
  }, [items])

  // Close on outside click / Escape, like any other menu on the board.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="admin__notifs" ref={wrapRef}>
      <button
        type="button"
        className={`admin__iconbtn admin__notifs-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="admin__notifs-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="admin__notifs-panel" role="dialog" aria-label="Notifications">
          <div className="admin__notifs-head">
            <strong>Notifications</strong>
            <div className="admin__notifs-headacts">
              {unread > 0 && (
                <button
                  type="button"
                  className="admin__notifs-mark"
                  onClick={markAllRead}
                >
                  <Check size={14} /> Mark all as read
                </button>
              )}
              <button
                type="button"
                className="admin__notifs-close"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="admin__notifs-empty">Nothing yet — new registrations show up here.</p>
          ) : (
            <ul className="admin__notifs-list">
              {items.map((it) => {
                const isUnread = toTime(it.when) > seenAt
                return (
                  <li key={it.key}>
                    <button
                      type="button"
                      className={`admin__notifs-item${isUnread ? ' admin__notifs-item--unread' : ''}`}
                      onClick={() => {
                        onOpenStudent(it.id)
                        setOpen(false)
                      }}
                    >
                      <span
                        className={`activity__dot activity__dot--${it.tone}`}
                        aria-hidden="true"
                      />
                      <span className="admin__notifs-text">
                        <strong>{it.name}</strong> {it.label}
                        {isUnread && <span className="admin__notifs-new">new</span>}
                      </span>
                      <span className="admin__notifs-time">{timeAgo(it.when)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// =======================================================================
// Root: session lifecycle + admin allowlist gate (unchanged behaviour)
// =======================================================================
export default function Admin() {
  const [auth, setAuth] = useState<AuthState>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [isFullAdmin, setIsFullAdmin] = useState(false)

  useEffect(() => {
    let active = true
    let supabase
    try {
      supabase = getSupabase()
    } catch {
      // Portal not configured — treat as signed out; the login form surfaces it.
      setAuth('signed-out')
      return
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) {
        // Second-factor gate: a session must reach assurance level 2 (TOTP)
        // before the allowlist is even consulted.
        const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (!active) return
        setAuth(assurance?.currentLevel === 'aal2' ? 'checking' : 'mfa-required')
      } else {
        setAuth('signed-out')
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return
      setSession(s)
      if (s) {
        const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (!active) return
        setAuth(assurance?.currentLevel === 'aal2' ? 'checking' : 'mfa-required')
      } else {
        setAuth('signed-out')
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Once we have a session, ask the DB whether this user is an allowlisted admin
  // (and, for the Security/Admin-management surfaces, whether they're a SUPER-admin).
  useEffect(() => {
    if (auth !== 'checking' || !session) return
    let active = true
    ;(async () => {
      try {
        const supabase = getSupabase()
        const [r, role] = await Promise.all([
          supabase.rpc('is_admin'),
          supabase.rpc('is_admin_role'),
        ])
        if (!active) return
        if (r.error) {
          setAuth('not-admin')
          return
        }
        setAuth(r.data === true ? 'admin' : 'not-admin')
        setIsFullAdmin(role.data === true)
      } catch {
        if (active) setAuth('not-admin')
      }
    })()
    return () => {
      active = false
    }
  }, [auth, session])

  // Native app: match the status bar to the current screen. The launch splash
  // and login are white (dark icons); the dark-green portal needs light icons.
  useEffect(() => {
    if (!IS_NATIVE) return
    const onGreen = auth === 'admin'
    StatusBar.setStyle({ style: onGreen ? Style.Light : Style.Dark })
    StatusBar.setBackgroundColor({ color: onGreen ? '#103f18' : '#ffffff' })
  }, [auth])

  const signOut = useCallback(async () => {
    try {
      await getSupabase().auth.signOut()
    } catch {
      /* no-op */
    }
  }, [])

  if (auth === 'loading' || auth === 'checking') {
    return (
      <main className={`admin-splash${IS_NATIVE ? ' is-native' : ''}`}>
        <img className="admin-splash__logo" src="/assets/logo.png" alt="ARISE" />
        <p className="admin-splash__word">ICT HUB</p>
        <Loader2 className="spin admin-splash__spin" size={18} aria-label="Loading" />
      </main>
    )
  }
  if (auth === 'signed-out') {
    return (
      <AuthScreen>
        <AdminLogin />
      </AuthScreen>
    )
  }
  if (auth === 'mfa-required') {
    return (
      <AuthScreen>
        <AdminMfa onVerified={() => setAuth('checking')} />
      </AuthScreen>
    )
  }
  if (auth === 'not-admin') {
    return (
      <AuthScreen>
        <NotAuthorized email={session?.user.email ?? ''} onSignOut={signOut} />
      </AuthScreen>
    )
  }
  return <AdminApp session={session!} isFullAdmin={isFullAdmin} onSignOut={signOut} />
}

// ---- Branded auth shell: brand image panel (web) + form column ----------
// The left panel is a full-bleed portrait with a dark scrim; it collapses on
// mobile, where a compact logo box + footer stand in for it (see CSS).
function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="adminlogin">
      <aside className="adminlogin__aside">
        <img className="adminlogin__aside-photo" src="/assets/umo.jpg" alt="" aria-hidden="true" />
        <div className="adminlogin__aside-scrim" />
        <div className="adminlogin__aside-brand">
          <img src="/assets/logo.png" alt="" />
          <span>ARISE ICT HUB</span>
        </div>
        <div className="adminlogin__aside-copy">
          <h2 className="adminlogin__aside-title">
            Empowering
            <br />
            Digital Futures.
          </h2>
          <p className="adminlogin__aside-text">
            Access the administrative core of Arise ICT Hub. Monitor complete program timelines,
            student certifications, and institutional capabilities in real-time.
          </p>
          <div className="adminlogin__aside-foot">
            <span>© 2026 ARISE Tech Hub</span>
            <span className="adminlogin__aside-chip">SECURE PORTAL</span>
          </div>
        </div>
      </aside>

      <section className="adminlogin__panel">
        <div className="adminlogin__mobrand">
          <img src="/assets/logo.png" alt="" />
          <span>ARISE ICT HUB</span>
        </div>
        {children}
        <p className="adminlogin__mofoot">
          <span>© 2026 ARISE Tech Hub. All rights reserved.</span>
          <span>
            <Lock size={12} /> Authorized personnel entry only
          </span>
        </p>
      </section>
    </main>
  )
}

function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const attempted = email.trim()
    // Fire-and-forget: record the attempt (used for brute-force alerting).
    // Never blocks the login round-trip.
    const logAttempt = (outcome: 'success' | 'failed') => {
      getSupabase()
        .functions.invoke('log-login-attempt', {
          body: { email: attempted, outcome },
        })
        .catch(() => {
          /* logging is best-effort */
        })
    }
    try {
      const supabase = getSupabase()
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: attempted,
        password,
      })
      if (signErr) throw new Error('Incorrect email or password.')
      logAttempt('success')
      // onAuthStateChange takes it from here.
    } catch (err) {
      logAttempt('failed')
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adminlogin__card">
      <h1 className="adminlogin__title">Admin Login</h1>
      <p className="adminlogin__sub">
        Please authenticate with your credential details to continue.
      </p>

      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        )}
        <div className="adminlogin__field">
          <label className="adminlogin__label" htmlFor="admin_email">
            Admin Email Address
          </label>
          <input
            id="admin_email"
            className="adminlogin__input"
            type="email"
            placeholder="e.g. administrator@ariseict.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="adminlogin__field">
          <label className="adminlogin__label" htmlFor="admin_pw">
            Secure Password
          </label>
          <div className="adminlogin__pw">
            <input
              id="admin_pw"
              className="adminlogin__input"
              type={showPw ? 'text' : 'password'}
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="adminlogin__pw-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        <button className="adminlogin__submit" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="spin" size={18} /> Authenticating…
            </>
          ) : (
            'Authenticate Access'
          )}
        </button>
      </form>

      <p className="adminlogin__lock">
        <ShieldCheck size={14} /> End-to-end encrypted administrative terminal.
      </p>
    </div>
  )
}

// ---- Second-factor (TOTP) screen --------------------------------------
// Every admin must pass MFA before the allowlist is consulted. If the
// account has no authenticator enrolled yet, the admin self-enrols with
// their authenticator app (QR scan + confirmation code).
function AdminMfa({ onVerified }: { onVerified: () => void }) {
  const supabase = getSupabase()
  const [stage, setStage] = useState<'loading' | 'verify' | 'enroll'>('loading')
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Decide: is an authenticator already enrolled?
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data, error: lErr } = await supabase.auth.mfa.listFactors()
        if (!active) return
        if (lErr) throw new Error(lErr.message)
        if (data.all.length > 0) {
          setFactorId(data.all[0].id)
          setStage('verify')
        } else {
          setStage('enroll')
        }
      } catch {
        if (active) setError('Could not check your security setup. Please try again.')
      }
    })()
    return () => {
      active = false
    }
  }, [supabase])

  async function startEnroll() {
    setBusy(true)
    setError(null)
    try {
      const { data, error: eErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'ARISE Admin',
      })
      if (eErr) throw new Error('Could not start setup. Your authenticator may already be enrolled.')
      setFactorId(data.id)
      setQr(data.totp.qr_code)
      setSecret(data.totp.secret)
      setStage('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
      if (chErr) throw new Error('Could not start verification.')
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: code.trim(),
      })
      if (vErr) throw new Error('Incorrect code. Please try again.')
      onVerified()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adminlogin__card">
      <h1 className="adminlogin__title">Two-Factor Verification</h1>
      <p className="adminlogin__sub">
        Confirm it&rsquo;s you with a code from your authenticator app. This protects the
        administrator account even if the password is ever compromised.
      </p>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      {stage === 'loading' && (
        <div className="adminlogin__sub">
          <Loader2 className="spin admin-splash__spin" size={18} aria-label="Loading" /> Checking…
        </div>
      )}

      {stage === 'enroll' && (
        <>
          <p className="adminlogin__sub">
            You don&rsquo;t have an authenticator set up yet. Before you can access the console
            you&rsquo;ll need one — Google Authenticator, 1Password, Authy, or any TOTP app.
          </p>
          <button
            type="button"
            className="adminlogin__submit"
            onClick={startEnroll}
            disabled={busy}
          >
            {busy ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={16} />} Set up an
            authenticator app
          </button>
        </>
      )}

      {stage === 'verify' && (
        <form onSubmit={submitCode} noValidate>
          {qr && (
            <div className="adminlogin__qrcode">
              <img src={qr} alt="Scan this QR code with your authenticator app" />
              {secret && (
                <p className="adminlogin__sub adminlogin__secret">
                  Manual entry code: <strong>{secret}</strong>
                </p>
              )}
            </div>
          )}

          <div className="adminlogin__field">
            <label className="adminlogin__label" htmlFor="admin_mfa_code">
              {qr ? 'Confirm code' : 'Authenticator code'}
            </label>
            <input
              id="admin_mfa_code"
              className="adminlogin__input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>

          <button className="adminlogin__submit" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={16} />} Verify code
          </button>
        </form>
      )}
    </div>
  )
}

function NotAuthorized({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="adminlogin__card adminlogin__card--warn">
      <span className="adminlogin__warnicon">
        <AlertCircle size={26} strokeWidth={2.2} />
      </span>
      <h1 className="adminlogin__title">Not authorised</h1>
      <p className="adminlogin__sub">
        The account <strong>{email}</strong> is signed in but is not on the administrator allowlist.
        Contact a super admin to be added.
      </p>
      <button
        type="button"
        className="adminlogin__submit adminlogin__submit--ghost"
        onClick={onSignOut}
      >
        <LogOut size={16} /> Sign out
      </button>
    </div>
  )
}

// =======================================================================
// Authenticated dashboard
// =======================================================================
const NAV: { key: View; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'students', label: 'Students', icon: Users },
  { key: 'stories', label: 'Stories', icon: Quote },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'settings', label: 'Settings', icon: Settings },
]

const PAGE_META: Record<View, { title: string; sub?: string }> = {
  dashboard: { title: 'Dashboard'},
  students: { title: 'Student Management'},
  stories: { title: 'Alumni Stories'},
  security: { title: 'Security Monitor'},
  settings: { title: 'Settings'},
}

// Status chips on the Students view (mirrors the mobile design's All/Active/Inactive
// tabs, mapped to our real states: Issued vs Awaiting a certificate).
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'issued', label: 'Issued' },
  { key: 'awaiting', label: 'Awaiting' },
]

// Story moderation chips. Defaults to "Pending" — the actionable queue.
const STORY_FILTERS: { key: StoryFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

function AdminApp({
  session,
  isFullAdmin,
  onSignOut,
}: {
  session: Session
  isFullAdmin: boolean
  onSignOut: () => void
}) {
  const [view, setView] = useState<View>('dashboard')
  const [rows, setRows] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)

  // If Android killed the WebView mid "Add Student" (common on low-RAM devices
  // during the camera trip), re-open the modal so the saved draft is restored.
  useEffect(() => {
    if (loadDraft<Record<string, unknown>>('add-student')) setAdding(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Signed URLs for the PRIVATE passports bucket, keyed by candidate id.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  // Mirror for the signing callback below: keeps its identity stable so the
  // page-signing effect doesn't re-run every time a URL lands.
  const photoUrlsRef = useRef(photoUrls)
  photoUrlsRef.current = photoUrls

  // Alumni story moderation lives in its own state so the two views never entangle.
  const [storyRows, setStoryRows] = useState<Experience[]>([])
  const [storiesLoading, setStoriesLoading] = useState(true)
  const [storiesError, setStoriesError] = useState<string | null>(null)
  const [storyFilter, setStoryFilter] = useState<StoryFilter>('pending')
  const [storyPage, setStoryPage] = useState(1)

  const email = session.user.email ?? ''

  // ---- Data ------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = getSupabase()
      const { data, error: qErr } = await supabase
        .from('candidates')
        .select(COLUMNS)
        .order('created_at', { ascending: false })
      if (qErr) throw new Error(qErr.message)
      setRows((data ?? []) as Candidate[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load candidates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Auto-dismiss the flash banner.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 4500)
    return () => clearTimeout(t)
  }, [flash])

  // Auto sign-out after 30 minutes of inactivity. Defense-in-depth on top of
  // the session expiry configured in Supabase Auth; keeps an unlocked console
  // from staying live on a shared machine.
  useEffect(() => {
    const IDLE_MS = 30 * 60 * 1000
    let last = Date.now()
    const reset = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    const iv = window.setInterval(() => {
      if (Date.now() - last > IDLE_MS) onSignOut()
    }, 60_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset))
      window.clearInterval(iv)
    }
  }, [onSignOut])

  const patchRow = useCallback((id: string, patch: Partial<Candidate>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  // The object store is PRIVATE. Allowlisted admins get short-lived presigned
  // URLs for thumbnails from the admin-media Edge Function (they have no S3
  // credentials of their own). The whole page is signed in ONE batched call —
  // a serial per-row round trip made thumbnails crawl in, especially on cold
  // edge-function starts.
  const signPhotos = useCallback(async (targets: Candidate[]) => {
    const pending = targets.filter((r) => r.passport_url && !(r.id in photoUrlsRef.current))
    if (!pending.length) return
    const supabase = getSupabase()
    const keyById = new Map(pending.map((r) => [r.id, passportPath(r.passport_url!)]))
    const apply = (next: Record<string, string>) => {
      if (Object.keys(next).length) setPhotoUrls((prev) => ({ ...prev, ...next }))
    }
    try {
      const { data, error } = await supabase.functions.invoke('admin-media', {
        body: { action: 'sign_batch', keys: [...keyById.values()] },
      })
      const urls = (data as { urls?: Record<string, string> } | null)?.urls
      if (!error && urls) {
        const next: Record<string, string> = {}
        for (const [id, key] of keyById) {
          const url = urls[key]
          if (url) next[id] = url
        }
        apply(next)
        return
      }
      throw new Error('batch signing unavailable')
    } catch {
      // Older deployed admin-media without sign_batch: sign in parallel instead.
      const results = await Promise.all(
        [...keyById.entries()].map(async ([id, key]) => {
          try {
            const { data } = await supabase.functions.invoke('admin-media', {
              body: { action: 'sign', key },
            })
            const url = (data as { url?: string } | null)?.url
            return url ? ([id, url] as const) : null
          } catch {
            return null
          }
        })
      )
      apply(Object.fromEntries(results.filter((r): r is readonly [string, string] => r !== null)))
    }
  }, [])

  // ---- Alumni stories: load + moderate ---------------------------------
  // RLS returns rows only for allowlisted admins; the private phone comes
  // through here (never on the public read path).
  const loadStories = useCallback(async () => {
    setStoriesLoading(true)
    setStoriesError(null)
    try {
      const supabase = getSupabase()
      const { data, error: qErr } = await supabase
        .from('experiences')
        .select('id, full_name, program, phone, experience, status, created_at')
        .order('created_at', { ascending: false })
      if (qErr) throw new Error(qErr.message)
      setStoryRows((data ?? []) as Experience[])
    } catch (err) {
      setStoriesError(err instanceof Error ? err.message : 'Could not load stories.')
    } finally {
      setStoriesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStories()
  }, [loadStories])

  const patchStory = useCallback((id: string, patch: Partial<Experience>) => {
    setStoryRows((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const approveStory = useCallback(
    async (row: Experience): Promise<boolean> => {
      try {
        const supabase = getSupabase()
        const { error: rpcErr } = await supabase.rpc('admin_approve_experience', { p_id: row.id })
        if (rpcErr) throw new Error('Could not approve. Please try again.')
        patchStory(row.id, { status: 'approved' })
        setFlash({ kind: 'ok', text: `${row.full_name}'s story is now live.` })
        return true
      } catch (err) {
        setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Approve failed.' })
        return false
      }
    },
    [patchStory]
  )

  const rejectStory = useCallback(
    async (row: Experience): Promise<boolean> => {
      if (!window.confirm(`Reject ${row.full_name}'s story? It will stay hidden from the public hub.`)) {
        return false
      }
      try {
        const supabase = getSupabase()
        const { error: rpcErr } = await supabase.rpc('admin_reject_experience', { p_id: row.id })
        if (rpcErr) throw new Error('Could not reject. Please try again.')
        patchStory(row.id, { status: 'rejected' })
        setFlash({ kind: 'ok', text: `${row.full_name}'s story was rejected.` })
        return true
      } catch (err) {
        setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Reject failed.' })
        return false
      }
    },
    [patchStory]
  )

  // ---- Certificate operations (shared by table row + detail modal) -----
  const issueCertificate = useCallback(
    async (row: Candidate, file: File): Promise<boolean> => {
      const cErr = certificateError(file)
      if (cErr) {
        setFlash({ kind: 'err', text: cErr })
        return false
      }
      const replacing = isIssued(row)
      try {
        const supabase = getSupabase()
        const objectPath = `${row.id}.pdf`
        // Validate + store through the admin edge function (writes to
        // external S3 storage); the browser has no storage credentials.
        const form = new FormData()
        form.append('candidate_id', row.id)
        form.append('file', file)
        const { data: upData, error: upErr } = await supabase.functions.invoke(
          'upload-certificate',
          { body: form }
        )
        if (upErr) {
          let detail = ''
          const ctx = (upErr as { context?: Response }).context
          if (ctx && typeof ctx.json === 'function') {
            try {
              detail = (await ctx.json())?.error ?? ''
            } catch {
              /* body wasn't JSON */
            }
          }
          throw new Error(detail || upErr.message || 'Upload failed. Please try again.')
        }
        const path = (upData as { path?: string } | null)?.path
        if (!path) throw new Error('Upload failed. Please try again.')

        const { error: rpcErr } = await supabase.rpc('admin_issue_certificate', { p_id: row.id })
        if (rpcErr) throw new Error('Uploaded, but could not mark as issued. Please retry.')

        patchRow(row.id, {
          certificate_url: objectPath,
          is_verified: true,
          issue_date: new Date().toISOString().slice(0, 10),
        })
        setFlash({
          kind: 'ok',
          text: replacing
            ? `Certificate replaced for ${row.full_name}.`
            : `Certificate issued to ${row.full_name}.`,
        })
        return true
      } catch (err) {
        setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Upload failed.' })
        return false
      }
    },
    [patchRow]
  )

  const viewCertificate = useCallback(async (row: Candidate): Promise<boolean> => {
    try {
      const supabase = getSupabase()
      const safeReg = (row.registration_number ?? '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
      const { data, error: sErr } = await supabase.functions.invoke('admin-media', {
        body: {
          action: 'sign_cert',
          key: `${row.id}.pdf`,
          download: `ARISE-Certificate-${safeReg || row.id}.pdf`,
        },
      })
      const url = (data as { url?: string } | null)?.url
      if (sErr || !url) throw new Error('Could not open the certificate.')
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    } catch (err) {
      setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Could not open.' })
      return false
    }
  }, [])

  const revokeCertificate = useCallback(
    async (row: Candidate): Promise<boolean> => {
      try {
        const supabase = getSupabase()
        const { error: rpcErr } = await supabase.rpc('admin_revoke_certificate', { p_id: row.id })
        if (rpcErr) throw new Error('Could not revoke. Please try again.')
        // Remove the file too (best effort — the status is already cleared).
        await supabase.functions.invoke('admin-media', {
          body: { action: 'delete', key: `${row.id}.pdf` },
        })
        patchRow(row.id, { certificate_url: null, is_verified: false, issue_date: null })
        setFlash({ kind: 'ok', text: `Certificate revoked for ${row.full_name}.` })
        return true
      } catch (err) {
        setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Revoke failed.' })
        return false
      }
    },
    [patchRow]
  )

  // ---- Add a manually-registered student, then jump to their certificate ---
  const handleCreated = useCallback(
    async (id: string, reg: string) => {
      setAdding(false)
      setFlash({ kind: 'ok', text: `${reg} added. Upload their certificate to issue it.` })
      await load()
      setSelectedId(id)
    },
    [load]
  )

  // ---- Attach a passport to an imported row (uploads via the validating
  //      Edge Function, then binds the object path through the admin RPC).
  const attachPassport = useCallback(
    async (row: Candidate, file: File): Promise<boolean> => {
      try {
        const supabase = getSupabase()
        const pErr = passportError(file)
        if (pErr) throw new Error(pErr)
        const form = new FormData()
        form.append('file', file)
        const { data: upData, error: upErr } = await supabase.functions.invoke(
          'upload-passport',
          { body: form }
        )
        if (upErr) {
          let detail = ''
          const ctx = (upErr as { context?: Response }).context
          if (ctx && typeof ctx.json === 'function') {
            try {
              detail = (await ctx.json())?.error ?? ''
            } catch {
              /* body wasn't JSON */
            }
          }
          throw new Error(detail || upErr.message || 'Passport upload failed. Please try again.')
        }
        const path = (upData as { path?: string } | null)?.path
        if (!path) throw new Error('Passport upload failed. Please try again.')

        const { error: rpcErr } = await supabase.rpc('admin_set_passport', {
          p_candidate_id: row.id,
          p_passport_url: path,
        })
        if (rpcErr) throw new Error('Could not save the photo. Please try again.')

        patchRow(row.id, { passport_url: path })
        // Drop the stale signed URL so the effect re-signs the new photo.
        setPhotoUrls((prev) => {
          if (!(row.id in prev)) return prev
          const next = { ...prev }
          delete next[row.id]
          return next
        })
        setFlash({ kind: 'ok', text: `Passport saved for ${row.full_name}.` })
        return true
      } catch (err) {
        setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Could not attach passport.' })
        return false
      }
    },
    [patchRow]
  )

  // ---- Edit a student's details (typo/correction fixes). The registration
  //      number and exam year are deliberately immutable — they're printed
  //      on issued certificates and are half of the verification key.
  const updateCandidate = useCallback(
    async (
      row: Candidate,
      values: {
        full_name: string
        email: string | null
        phone: string
        state_of_origin: string
        lga: string
        date_of_birth: string
        occupation: string
        religion: string
        last_institution: string
        marital_status: string
        next_of_kin_name: string
        next_of_kin_phone: string
        gender: string
        course: string
        class_schedule: string
        address: string
      }
    ): Promise<boolean> => {
      try {
        const supabase = getSupabase()
        const { error: rpcErr } = await supabase.rpc('admin_update_candidate', {
          p_id: row.id,
          p_full_name: values.full_name,
          p_email: values.email,
          p_phone: values.phone,
          p_state_of_origin: values.state_of_origin,
          p_lga: values.lga,
          p_date_of_birth: values.date_of_birth || null,
          p_occupation: values.occupation,
          p_religion: values.religion,
          p_last_institution: values.last_institution,
          p_marital_status: values.marital_status,
          p_next_of_kin_name: values.next_of_kin_name,
          p_next_of_kin_phone: values.next_of_kin_phone,
          p_gender: values.gender,
          p_course: values.course,
          p_class_schedule: values.class_schedule,
          p_address: values.address,
        })
        if (rpcErr) {
          const raw = rpcErr.message || ''
          const code = raw.includes('NOT_ADMIN')
            ? 'NOT_ADMIN'
            : raw.includes('EMAIL_EXISTS')
              ? 'EMAIL_EXISTS'
              : raw.includes('INVALID_EMAIL')
                ? 'INVALID_EMAIL'
                : raw.includes('INVALID_PHONE')
                  ? 'INVALID_PHONE'
                  : 'UPDATE_FAILED'
          throw new Error(updateErrorMessage(code))
        }
        patchRow(row.id, values)
        setFlash({ kind: 'ok', text: `Details updated for ${values.full_name}.` })
        return true
      } catch (err) {
        setFlash({ kind: 'err', text: err instanceof Error ? err.message : 'Update failed.' })
        return false
      }
    },
    [patchRow]
  )

  // ---- Stats -----------------------------------------------------------
  const stats = useMemo(() => {
    const total = rows.length
    const issued = rows.filter(isIssued).length
    const thisYear = new Date().getFullYear()
    const newThisYear = rows.filter((r) => (r.created_at ?? '').slice(0, 4) === String(thisYear)).length
    return { total, issued, awaiting: total - issued, newThisYear, thisYear }
  }, [rows])

  // ---- Filtering + pagination ------------------------------------------
  // Students view honours the status chips (All / Issued / Awaiting).
  const base = useMemo(() => {
    if (view === 'students' && statusFilter !== 'all') {
      return rows.filter((r) => (statusFilter === 'issued' ? isIssued(r) : !isIssued(r)))
    }
    return rows
  }, [rows, view, statusFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter((r) =>
      [r.full_name, r.registration_number, r.phone ?? '', r.email ?? '', r.course ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [base, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  // Reset to page 1 whenever the result set changes underneath us.
  useEffect(() => {
    setPage(1)
  }, [query, view, statusFilter])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, filtered.length)

  // Export the currently-visible students as CSV. On the website this triggers
  // a browser download; in the Android app it writes a temp file and opens the
  // system share sheet so the admin can save it anywhere.
  const exportCsv = useCallback(() => {
    const csv = buildStudentsCsv(filtered)
    const name = studentsFileName()
    if (IS_NATIVE) {
      void (async () => {
        try {
          const { uri } = await Filesystem.writeFile({
            path: name,
            data: csv,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
          })
          await Share.share({
            title: 'Students export',
            url: uri,
            dialogTitle: 'Save students CSV',
          })
        } catch {
          /* user cancelled the share sheet — nothing else to do */
        }
      })()
    } else {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }
  }, [filtered])

  // ---- Story filtering + pagination (independent of the candidate pipeline) ----
  const storyFiltered = useMemo(() => {
    if (storyFilter === 'all') return storyRows
    return storyRows.filter((s) => s.status === storyFilter)
  }, [storyRows, storyFilter])

  const storyPageCount = Math.max(1, Math.ceil(storyFiltered.length / PAGE_SIZE))
  const pendingStories = useMemo(
    () => storyRows.filter((s) => s.status === 'pending').length,
    [storyRows]
  )

  useEffect(() => {
    setStoryPage(1)
  }, [storyFilter, view])

  useEffect(() => {
    if (storyPage > storyPageCount) setStoryPage(storyPageCount)
  }, [storyPage, storyPageCount])

  const storyPageRows = storyFiltered.slice((storyPage - 1) * PAGE_SIZE, storyPage * PAGE_SIZE)
  const storyRangeStart = storyFiltered.length === 0 ? 0 : (storyPage - 1) * PAGE_SIZE + 1
  const storyRangeEnd = Math.min(storyPage * PAGE_SIZE, storyFiltered.length)

  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null

  // Sign photos for the visible page plus any opened profile (passports are
  // stored privately; thumbnails load through short-lived signed URLs).
  useEffect(() => {
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const targets = [...visible]
    if (selected) targets.push(selected)
    void signPhotos(targets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, page, selected, signPhotos])

  const meta = PAGE_META[view]
  const showSearch = view === 'students'
  // Super-admins see everything; plain admins lose the Security Monitor.
  const nav = isFullAdmin ? NAV : NAV.filter((n) => n.key !== 'security')

  return (
    <div className="admin">
      {/* ---- Sidebar ---- */}
      <aside className="admin__sidebar">
        <div className="admin__logo">
          <img src="/assets/logo.png" alt="ARISE ICT HUB" />
          <span className="admin__logo-text">
            ARISE ICT HUB<small>Admin</small>
          </span>
        </div>

        <nav className="admin__nav">
          {nav.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`admin__navlink${view === key ? ' is-active' : ''}`}
              onClick={() => setView(key)}
              aria-current={view === key ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={2} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="admin__side-foot">
          <div className="admin__user">
            <span className="admin__avatar" aria-hidden="true">
              {initials(email)}
            </span>
            <span className="admin__user-info">
              <span className="admin__user-name">{email || 'Administrator'}</span>
              <span className="admin__user-role">
                {isFullAdmin ? 'Super Administrator' : 'Administrator'}
              </span>
            </span>
          </div>
          <button type="button" className="admin__logout" onClick={onSignOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* ---- Main ---- */}
      <div className="admin__main">
        <header className="admin__topbar">
          <div className="admin__topbar-head">
            <img className="admin__topbar-logo" src="/assets/logo.png" alt="ARISE ICT HUB" />
            <div className="admin__topbar-heading">
              <h1 className="admin__topbar-title">{meta.title}</h1>
              {meta.sub && <p className="admin__topbar-sub">{meta.sub}</p>}
            </div>
          </div>

          <div className="admin__topbar-tools">
            {showSearch && (
              <div className="admin__search">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search students…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search students"
                />
              </div>
            )}
            <NotificationBell rows={rows} onOpenStudent={(id) => setSelectedId(id)} />
            <span className="admin__avatar admin__avatar--sm" aria-hidden="true">
              {initials(email)}
            </span>
          </div>
        </header>

        <div className="admin__content">
          {flash && (
            <div
              className={`admin__flash admin__flash--${flash.kind}`}
              role={flash.kind === 'err' ? 'alert' : 'status'}
            >
              <span>{flash.text}</span>
              <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )}

          {view === 'dashboard' && (
            <>
              <WelcomeCard email={email} awaiting={stats.awaiting} total={stats.total} />
              <div className="admin__stats">
                <StatCard icon={Users} tone="green" label="Total Students" value={stats.total} />
                <StatCard
                  icon={Award}
                  tone="green"
                  label="Certificates Issued"
                  value={stats.issued}
                />
                <StatCard
                  icon={Clock}
                  tone="orange"
                  label="Awaiting Certificate"
                  value={stats.awaiting}
                />
                <StatCard
                  icon={CalendarDays}
                  tone="ink"
                  label={`Registered ${stats.thisYear}`}
                  value={stats.newThisYear}
                />
              </div>
              <RecentActivity
                rows={rows}
                loading={loading}
                onOpen={(id) => setSelectedId(id)}
                onSeeAll={() => setView('students')}
              />
            </>
          )}

          {view === 'students' && (
            <section className="admin__panel">
              <div className="admin__panel-head">
                <h2 className="admin__panel-title">Registered Students</h2>
                <div className="admin__panel-acts">
                  <button
                    type="button"
                    className="admin__iconbtn"
                    onClick={() => setImporting(true)}
                    aria-label="Import students from a CSV file"
                    title="Import CSV"
                  >
                    <UploadCloud size={16} />
                  </button>
                  <button
                    type="button"
                    className="admin__iconbtn"
                    onClick={exportCsv}
                    disabled={filtered.length === 0}
                    aria-label="Export the current list of students as a CSV file"
                    title="Export CSV"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    type="button"
                    className="admin__iconbtn"
                    onClick={load}
                    disabled={loading}
                    aria-label="Refresh list"
                    title="Refresh"
                  >
                    <RefreshCw size={16} className={loading ? 'spin' : undefined} />
                  </button>
                </div>
              </div>

              <div className="admin__chips" role="tablist" aria-label="Filter by certificate status">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === f.key}
                    className={`admin__chip${statusFilter === f.key ? ' is-active' : ''}`}
                    onClick={() => setStatusFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {error && (
                <div className="notice notice--error" role="alert">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="admin__loading">
                  <Loader2 className="spin" size={24} />
                  <p>Loading students…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="admin__empty">
                  {rows.length === 0
                    ? 'No students have registered yet.'
                    : 'No students match your filters.'}
                </div>
              ) : (
                <>
                  {/* Desktop / tablet: table */}
                  <div className="admin__tablewrap admin-desktop">
                    <table className="admin__table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Reg. Number</th>
                          <th>Status</th>
                          <th className="admin__th-acts">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row) => (
                          <StudentRow
                            key={row.id}
                            row={row}
                            photoUrl={photoUrls[row.id]}
                            onManage={() => setSelectedId(row.id)}
                            onIssue={issueCertificate}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: stacked cards */}
                  <ul className="admin__cards admin-mobile">
                    {pageRows.map((row) => (
                      <StudentCard
                        key={row.id}
                        row={row}
                        photoUrl={photoUrls[row.id]}
                        onManage={() => setSelectedId(row.id)}
                        onIssue={issueCertificate}
                      />
                    ))}
                  </ul>

                  <div className="admin__pager">
                    <span className="admin__pager-info">
                      Showing {rangeStart}–{rangeEnd} of {filtered.length} student
                      {filtered.length === 1 ? '' : 's'}
                    </span>
                    <div className="admin__pager-btns">
                      <button
                        type="button"
                        className="admin__pagebtn"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="admin__pager-page">
                        {page} / {pageCount}
                      </span>
                      <button
                        type="button"
                        className="admin__pagebtn"
                        onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                        disabled={page >= pageCount}
                        aria-label="Next page"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {view === 'stories' && (
            <section className="admin__panel">
              <div className="admin__panel-head">
                <h2 className="admin__panel-title">
                  Story Submissions
                  {pendingStories > 0 && <span className="admin__count">{pendingStories}</span>}
                </h2>
                <button
                  type="button"
                  className="admin__iconbtn"
                  onClick={loadStories}
                  disabled={storiesLoading}
                  aria-label="Refresh stories"
                  title="Refresh"
                >
                  <RefreshCw size={16} className={storiesLoading ? 'spin' : undefined} />
                </button>
              </div>

              <div className="admin__chips" role="tablist" aria-label="Filter by story status">
                {STORY_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={storyFilter === f.key}
                    className={`admin__chip${storyFilter === f.key ? ' is-active' : ''}`}
                    onClick={() => setStoryFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {storiesError && (
                <div className="notice notice--error" role="alert">
                  {storiesError}
                </div>
              )}

              {storiesLoading ? (
                <div className="admin__loading">
                  <Loader2 className="spin" size={24} />
                  <p>Loading stories…</p>
                </div>
              ) : storyFiltered.length === 0 ? (
                <div className="admin__empty">
                  {storyRows.length === 0
                    ? 'No stories have been submitted yet.'
                    : 'No stories match this filter.'}
                </div>
              ) : (
                <>
                  {/* Desktop / tablet: table */}
                  <div className="admin__tablewrap admin-desktop">
                    <table className="admin__table admin__table--stories">
                      <thead>
                        <tr>
                          <th>Author</th>
                          <th>Experience</th>
                          <th>Phone</th>
                          <th>Status</th>
                          <th className="admin__th-acts">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {storyPageRows.map((row) => (
                          <StoryRow
                            key={row.id}
                            row={row}
                            onApprove={approveStory}
                            onReject={rejectStory}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: stacked cards */}
                  <ul className="admin__cards admin-mobile">
                    {storyPageRows.map((row) => (
                      <StoryCard
                        key={row.id}
                        row={row}
                        onApprove={approveStory}
                        onReject={rejectStory}
                      />
                    ))}
                  </ul>

                  <div className="admin__pager">
                    <span className="admin__pager-info">
                      Showing {storyRangeStart}–{storyRangeEnd} of {storyFiltered.length} stor
                      {storyFiltered.length === 1 ? 'y' : 'ies'}
                    </span>
                    <div className="admin__pager-btns">
                      <button
                        type="button"
                        className="admin__pagebtn"
                        onClick={() => setStoryPage((p) => Math.max(1, p - 1))}
                        disabled={storyPage <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="admin__pager-page">
                        {storyPage} / {storyPageCount}
                      </span>
                      <button
                        type="button"
                        className="admin__pagebtn"
                        onClick={() => setStoryPage((p) => Math.min(storyPageCount, p + 1))}
                        disabled={storyPage >= storyPageCount}
                        aria-label="Next page"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {view === 'settings' && (
            <SettingsPanel email={email} stats={stats} isFullAdmin={isFullAdmin} onSignOut={onSignOut} />
          )}

          {view === 'security' && isFullAdmin && <SecurityPanel />}
        </div>
      </div>

      {/* ---- Mobile bottom tab bar ---- */}
      <nav className="admin__tabbar" aria-label="Primary">
        {nav.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`admin__tab${view === key ? ' is-active' : ''}`}
            onClick={() => setView(key)}
            aria-current={view === key ? 'page' : undefined}
          >
            <Icon size={21} strokeWidth={2} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* ---- Mobile FAB: add a manually-registered student (students view) ---- */}
      {view === 'students' && (
        <button
          type="button"
          className="admin__fab"
          onClick={() => setAdding(true)}
          aria-label="Add student"
        >
          <UserPlus size={22} strokeWidth={2.2} />
        </button>
      )}

      {adding && <AddStudentModal onClose={() => setAdding(false)} onCreated={handleCreated} />}

      {importing && (
        <ImportStudentsModal
          onClose={() => setImporting(false)}
          onImported={(summary) => {
            setImporting(false)
            setFlash({ kind: 'ok', text: summary })
            void load()
          }}
        />
      )}

      {selected && (
        <StudentModal
          row={selected}
          photoUrl={photoUrls[selected.id]}
          onClose={() => setSelectedId(null)}
          onIssue={issueCertificate}
          onView={viewCertificate}
          onRevoke={revokeCertificate}
          onAttachPassport={attachPassport}
          onUpdate={updateCandidate}
        />
      )}
    </div>
  )
}

// ---- Stat card ---------------------------------------------------------
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users
  label: string
  value: number
  tone: 'green' | 'orange' | 'ink'
}) {
  return (
    <div className="mstat">
      <span className={`mstat__icon mstat__icon--${tone}`}>
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="mstat__body">
        <span className="mstat__value">{value}</span>
        <span className="mstat__label">{label}</span>
      </div>
    </div>
  )
}

// ---- Certificate upload button (shared by table row + mobile card) -----
function UploadButton({
  row,
  onIssue,
}: {
  row: Candidate
  onIssue: (row: Candidate, file: File) => Promise<boolean>
}) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const issued = isIssued(row)

  async function handleFile(file: File | null) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setUploading(true)
    await onIssue(row, file)
    setUploading(false)
  }

  return (
    <>
      <button
        type="button"
        className="admin__act admin__act--primary"
        // Stop propagation so an upload inside a tappable card doesn't also open it.
        onClick={(e) => {
          e.stopPropagation()
          fileRef.current?.click()
        }}
        disabled={uploading}
        title={issued ? 'Replace certificate' : 'Upload certificate'}
        aria-label={issued ? 'Replace certificate' : 'Upload certificate'}
      >
        {uploading ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </>
  )
}

// ---- Table row (desktop / tablet) --------------------------------------
function StudentRow({
  row,
  photoUrl,
  onManage,
  onIssue,
}: {
  row: Candidate
  photoUrl?: string
  onManage: () => void
  onIssue: (row: Candidate, file: File) => Promise<boolean>
}) {
  const issued = isIssued(row)
  return (
    <tr>
      <td>
        {/* Clicking the student opens their profile detail. */}
        <button type="button" className="admin__student" onClick={onManage} title="View student profile">
          {photoUrl ? (
            <img className="admin__student-photo" src={photoUrl} alt="" loading="lazy" />
          ) : (
            <span className="admin__student-photo" aria-hidden="true" />
          )}
          <span className="admin__student-id">
            <span className="admin__student-name">
              {row.full_name}
              {!row.passport_url && (
                <span className="badge badge--warn admin__photo-badge">No photo</span>
              )}
            </span>
            {row.email && <span className="admin__student-email">{row.email}</span>}
          </span>
        </button>
      </td>
      <td className="admin__reg">{row.registration_number}</td>
      <td>
        <span className={`badge${issued ? ' badge--ok' : ' badge--wait'}`}>
          {issued ? 'Issued' : 'Awaiting'}
        </span>
      </td>
      <td>
        <div className="admin__rowacts">
          <UploadButton row={row} onIssue={onIssue} />
        </div>
      </td>
    </tr>
  )
}

// ---- Student card (mobile) ---------------------------------------------
function StudentCard({
  row,
  photoUrl,
  onManage,
  onIssue,
}: {
  row: Candidate
  photoUrl?: string
  onManage: () => void
  onIssue: (row: Candidate, file: File) => Promise<boolean>
}) {
  const issued = isIssued(row)
  return (
    <li>
      {/* Whole card is tappable → opens the profile sheet. */}
      <button type="button" className="scard" onClick={onManage}>
        {photoUrl ? (
          <img className="scard__photo" src={photoUrl} alt="" loading="lazy" />
        ) : (
          <span className="scard__photo" aria-hidden="true" />
        )}
        <span className="scard__body">
          <span className="scard__name">
            {row.full_name}
            {!row.passport_url && (
              <span className="badge badge--warn admin__photo-badge">No photo</span>
            )}
          </span>
          <span className="scard__reg">{row.registration_number}</span>
          {row.course && <span className="scard__course">{row.course}</span>}
        </span>
        <span className="scard__aside">
          <span className={`badge${issued ? ' badge--ok' : ' badge--wait'}`}>
            {issued ? 'Issued' : 'Awaiting'}
          </span>
          <span className="scard__act">
            <UploadButton row={row} onIssue={onIssue} />
          </span>
        </span>
      </button>
    </li>
  )
}

// ---- Alumni story helpers ----------------------------------------------
const storyRole = (program: string | null) =>
  program ? `${program} Graduate` : 'ARISE Alumni'

function StoryBadge({ status }: { status: Experience['status'] }) {
  const cls =
    status === 'approved' ? 'badge--ok' : status === 'rejected' ? 'badge--rejected' : 'badge--wait'
  return <span className={`badge ${cls}`}>{status[0].toUpperCase() + status.slice(1)}</span>
}

// Approve / Reject buttons with a per-action busy spinner (mirrors UploadButton).
function StoryActions({
  row,
  onApprove,
  onReject,
}: {
  row: Experience
  onApprove: (row: Experience) => Promise<boolean>
  onReject: (row: Experience) => Promise<boolean>
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)

  async function run(kind: 'approve' | 'reject', fn: (row: Experience) => Promise<boolean>) {
    setBusy(kind)
    await fn(row)
    setBusy(null)
  }

  return (
    <div className="admin__rowacts">
      {row.status !== 'approved' && (
        <button
          type="button"
          className="admin__act admin__act--primary"
          onClick={() => run('approve', onApprove)}
          disabled={busy !== null}
          title="Approve story"
          aria-label="Approve story"
        >
          {busy === 'approve' ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
        </button>
      )}
      {row.status !== 'rejected' && (
        <button
          type="button"
          className="admin__act admin__act--danger"
          onClick={() => run('reject', onReject)}
          disabled={busy !== null}
          title="Reject story"
          aria-label="Reject story"
        >
          {busy === 'reject' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
        </button>
      )}
    </div>
  )
}

// ---- Story row (desktop / tablet) --------------------------------------
function StoryRow({
  row,
  onApprove,
  onReject,
}: {
  row: Experience
  onApprove: (row: Experience) => Promise<boolean>
  onReject: (row: Experience) => Promise<boolean>
}) {
  return (
    <tr>
      <td>
        <span className="admin__student-id">
          <span className="admin__student-name">{row.full_name}</span>
          <span className="admin__student-email">{storyRole(row.program)}</span>
        </span>
      </td>
      <td className="admin__story-text">{row.experience}</td>
      <td className="admin__reg">{row.phone}</td>
      <td>
        <StoryBadge status={row.status} />
      </td>
      <td>
        <StoryActions row={row} onApprove={onApprove} onReject={onReject} />
      </td>
    </tr>
  )
}

// ---- Story card (mobile) -----------------------------------------------
function StoryCard({
  row,
  onApprove,
  onReject,
}: {
  row: Experience
  onApprove: (row: Experience) => Promise<boolean>
  onReject: (row: Experience) => Promise<boolean>
}) {
  return (
    <li className="admin__story-card">
      <div className="admin__story-card-top">
        <span className="admin__story-card-id">
          <span className="scard__name">{row.full_name}</span>
          <span className="scard__course">{storyRole(row.program)}</span>
        </span>
        <StoryBadge status={row.status} />
      </div>
      <p className="admin__story-card-text">{row.experience}</p>
      <div className="admin__story-card-foot">
        <span className="admin__story-phone">
          <Phone size={13} strokeWidth={2} />
          {row.phone}
        </span>
        <StoryActions row={row} onApprove={onApprove} onReject={onReject} />
      </div>
    </li>
  )
}

// ---- Dashboard: welcome banner -----------------------------------------
function WelcomeCard({
  email,
  awaiting,
  total,
}: {
  email: string
  awaiting: number
  total: number
}) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const message =
    total === 0
      ? 'No students have registered yet — new registrations will appear here.'
      : awaiting > 0
        ? `You have ${awaiting} student${awaiting === 1 ? '' : 's'} awaiting a certificate.`
        : 'Every registered student has their certificate. Nice work!'
  return (
    <section className="welcome">
      <span className="welcome__eyebrow">Welcome back</span>
      <h2 className="welcome__title">{greeting}, Admin</h2>
      <p className="welcome__sub">{message}</p>
      {email && <p className="welcome__email">{email}</p>}
    </section>
  )
}

// ---- Dashboard: recent activity ----------------------------------------
function RecentActivity({
  rows,
  loading,
  onOpen,
  onSeeAll,
}: {
  rows: Candidate[]
  loading: boolean
  onOpen: (id: string) => void
  onSeeAll: () => void
}) {
  const items = useMemo(() => buildActivity(rows), [rows])
  return (
    <section className="admin__panel activity">
      <div className="admin__panel-head">
        <h2 className="admin__panel-title">
          <Activity size={18} strokeWidth={2.4} className="activity__title-icon" />
          Recent Activity
        </h2>
        <button type="button" className="activity__all" onClick={onSeeAll}>
          View all
        </button>
      </div>
      {loading ? (
        <div className="admin__loading">
          <Loader2 className="spin" size={22} />
        </div>
      ) : items.length === 0 ? (
        <p className="modal__note">No activity yet.</p>
      ) : (
        <ul className="activity__list">
          {items.map((it) => (
            <li key={it.key}>
              <button type="button" className="activity__item" onClick={() => onOpen(it.id)}>
                <span className={`activity__dot activity__dot--${it.tone}`} aria-hidden="true" />
                <span className="activity__text">
                  <strong>{it.name}</strong> {it.label}
                </span>
                <span className="activity__time">{timeAgo(it.when)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Student profile modal ---------------------------------------------
function StudentModal({
  row,
  photoUrl,
  onClose,
  onIssue,
  onView,
  onRevoke,
  onAttachPassport,
  onUpdate,
}: {
  row: Candidate
  photoUrl?: string
  onClose: () => void
  onIssue: (row: Candidate, file: File) => Promise<boolean>
  onView: (row: Candidate) => Promise<boolean>
  onRevoke: (row: Candidate) => Promise<boolean>
  onAttachPassport: (row: Candidate, file: File) => Promise<boolean>
  onUpdate: (
    row: Candidate,
    values: {
      full_name: string
      email: string | null
      phone: string
      state_of_origin: string
      lga: string
      date_of_birth: string
      occupation: string
      religion: string
      last_institution: string
      marital_status: string
      next_of_kin_name: string
      next_of_kin_phone: string
      gender: string
      course: string
      class_schedule: string
      address: string
    }
  ) => Promise<boolean>
}) {
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'viewing' | 'revoking'>('idle')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const issued = isIssued(row)
  const working = busy !== 'idle'

  // Edit mode swaps the read-only info grid for a correction form.
  const [editing, setEditing] = useState(false)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleFile(file: File | null) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy('uploading')
    await onIssue(row, file)
    setBusy('idle')
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (working) return
    handleFile(e.dataTransfer.files?.[0] ?? null)
  }

  async function handleView() {
    setBusy('viewing')
    await onView(row)
    setBusy('idle')
  }

  async function handleRevoke() {
    if (
      !window.confirm(
        `Revoke ${row.full_name}'s certificate? They will no longer be able to download it.`
      )
    )
      return
    setBusy('revoking')
    await onRevoke(row)
    setBusy('idle')
  }

  async function handlePassport(file: File | null) {
    if (!file) return
    await onAttachPassport(row, file)
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Student profile" onClick={onClose}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        <div className="modal__head">
          {photoUrl ? (
            <img className="modal__photo" src={photoUrl} alt="" />
          ) : (
            <span className="modal__photo" aria-hidden="true" />
          )}
          <div className="modal__head-id">
            <h2 className="modal__name">{row.full_name}</h2>
            <span className="modal__reg">{row.registration_number}</span>
            <span className={`badge${issued ? ' badge--ok' : ' badge--wait'}`}>
              {issued ? 'Certificate Issued' : 'Awaiting Certificate'}
            </span>
          </div>
        </div>

        <div className="modal__body">
          <div className="modal__section-head">
            <h3 className="modal__section-title">Student Information</h3>
            {!editing && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setEditing(true)}
                disabled={working}
              >
                <Pencil size={14} /> Edit Details
              </button>
            )}
          </div>
          {editing ? (
            <EditDetailsForm
              row={row}
              busy={working}
              onCancel={() => setEditing(false)}
              onSave={async (values) => {
                const ok = await onUpdate(row, values)
                if (ok) setEditing(false)
              }}
            />
          ) : (
            <div className="modal__grid">
              <Field icon={Hash} label="Registration Number" value={row.registration_number} />
              <Field icon={GraduationCap} label="Enrolled Course" value={row.course} />
              <Field icon={Cake} label="Date of Birth" value={fmtDate(row.date_of_birth)} />
              <Field icon={Phone} label="Phone Number" value={row.phone} />
              <Field icon={Mail} label="Email" value={row.email} />
              <Field icon={MapPin} label="State of Origin" value={row.state_of_origin} />
              <Field icon={CalendarDays} label="Exam Year" value={String(row.exam_year)} />
              <Field icon={CalendarClock} label="Registration Date" value={fmtDate(row.created_at)} />
            </div>
          )}

          <div className="modal__section">
            <h3 className="modal__section-title">Passport Photo</h3>
            {row.passport_url ? (
              <div className="certfile">
                <span className="certfile__icon">
                  <FileText size={20} />
                </span>
                <div className="certfile__meta">
                  <span className="certfile__name">Passport attached</span>
                  <span className="certfile__sub">
                    Stored privately — shown to students in the verification portal.
                  </span>
                </div>
                <div className="certfile__acts">
                  <PassportPicker compact onFile={(f) => void handlePassport(f)} />
                </div>
              </div>
            ) : (
              <div className="certfile">
                <span className="certfile__icon">
                  <Upload size={20} />
                </span>
                <div className="certfile__meta">
                  <span className="certfile__name">No passport yet</span>
                  <span className="certfile__sub">
                    Imported without a photo — attach one here (JPEG/PNG, ≤1.5MB).
                  </span>
                </div>
                <div className="certfile__acts">
                  <PassportPicker compact onFile={(f) => void handlePassport(f)} />
                </div>
              </div>
            )}
          </div>

          <div className="modal__section">
            <h3 className="modal__section-title">Certificate</h3>
            {issued ? (
              <div className="certfile">
                <span className="certfile__icon">
                  <FileText size={20} />
                </span>
                <div className="certfile__meta">
                  <span className="certfile__name">{certFileName(row)}</span>
                  <span className="certfile__sub">Issued {fmtDate(row.issue_date)}</span>
                </div>
                <div className="certfile__acts">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handleView}
                    disabled={working}
                  >
                    {busy === 'viewing' ? <Loader2 className="spin" size={15} /> : <Eye size={15} />}
                    View
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm certfile__revoke"
                    onClick={handleRevoke}
                    disabled={working}
                  >
                    {busy === 'revoking' ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <Trash2 size={15} />
                    )}
                    Revoke
                  </button>
                </div>
              </div>
            ) : (
              <p className="modal__note">No certificate has been issued to this student yet.</p>
            )}
          </div>

          <div className="modal__section">
            <h3 className="modal__section-title">
              {issued ? 'Replace Certificate' : 'Upload Certificate'}
            </h3>
            <button
              type="button"
              className={`dropzone${dragOver ? ' is-drag' : ''}`}
              onClick={() => !working && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              disabled={working}
            >
              {busy === 'uploading' ? (
                <>
                  <Loader2 className="spin" size={26} />
                  <span className="dropzone__title">Uploading…</span>
                </>
              ) : (
                <>
                  <UploadCloud size={28} />
                  <span className="dropzone__title">
                    Drag &amp; drop the certificate here, or click to browse
                  </span>
                  <span className="dropzone__hint">PDF · up to 5MB</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
          {issued && (
            <button
              type="button"
              className="btn btn--green"
              onClick={handleView}
              disabled={working}
            >
              {busy === 'viewing' ? <Loader2 className="spin" size={16} /> : <Eye size={16} />} View
              Certificate
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | null | undefined
  icon?: typeof Hash
}) {
  return (
    <div className="modal__field">
      {Icon && (
        <span className="modal__field-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={2} />
        </span>
      )}
      <span className="modal__field-text">
        <span className="modal__field-label">{label}</span>
        <span className="modal__field-value">{value || '—'}</span>
      </span>
    </div>
  )
}

// ---- Edit student details (correction form) -----------------------------
// Mirrors AddStudentModal's fields + validation, minus passport (handled
// separately via attachPassport) and reg number / exam year (immutable —
// they appear on issued certificates and key the verification lookup).
type EditDetailsValues = {
  full_name: string
  email: string | null
  phone: string
  state_of_origin: string
  lga: string
  date_of_birth: string
  occupation: string
  religion: string
  last_institution: string
  marital_status: string
  next_of_kin_name: string
  next_of_kin_phone: string
  gender: string
  course: string
  class_schedule: string
  address: string
}

// Legacy rows (registered before the dropdowns existed, or CSV-imported free
// text) may hold values that don't exactly match today's option lists. A
// <select> whose value has no matching <option> renders blank, so inject the
// stored value as an extra option — it then displays as-is, and picking any
// listed option normalizes the data on save.
function withValue(list: readonly string[], value: string): string[] {
  const v = value.trim()
  return v && !list.includes(v) ? [v, ...list] : [...list]
}

function EditDetailsForm({
  row,
  busy,
  onCancel,
  onSave,
}: {
  row: Candidate
  busy: boolean
  onCancel: () => void
  onSave: (values: EditDetailsValues) => Promise<void>
}) {
  const [fullName, setFullName] = useState(row.full_name ?? '')
  const [email, setEmail] = useState(row.email ?? '')
  const [phone, setPhone] = useState(row.phone ?? '')
  const [dob, setDob] = useState(row.date_of_birth ?? '')
  const [occupation, setOccupation] = useState(row.occupation ?? '')
  const [religion, setReligion] = useState(row.religion ?? '')
  const [stateOfOrigin, setStateOfOrigin] = useState(row.state_of_origin ?? '')
  const [lga, setLga] = useState(row.lga ?? '')
  const [maritalStatus, setMaritalStatus] = useState(row.marital_status ?? '')
  const [gender, setGender] = useState(row.gender ?? '')
  const [course, setCourse] = useState(row.course ?? '')
  const [classSchedule, setClassSchedule] = useState(row.class_schedule ?? '')
  const [lastInstitution, setLastInstitution] = useState(row.last_institution ?? '')
  const [nokName, setNokName] = useState(row.next_of_kin_name ?? '')
  const [nokPhone, setNokPhone] = useState(row.next_of_kin_phone ?? '')
  const [address, setAddress] = useState(row.address ?? '')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const name = fullName.trim()
    const mail = email.trim().toLowerCase()

    if (!isValidName(name)) return setError('Please enter the student’s full name.')
    if (mail && !isValidEmail(mail)) return setError('Please enter a valid email address.')
    if (!isValidPhone(phone)) return setError('Please enter a valid phone number.')
    if (!occupation.trim()) return setError('Please enter an occupation.')
    if (!religion) return setError('Please select a religion.')
    if (!stateOfOrigin) return setError('Please select the state of origin.')
    if (!lga) return setError('Please select the LGA.')
    if (!dob) return setError('Please select a date of birth.')
    if (!lastInstitution.trim()) return setError('Please enter the last institution.')
    if (!maritalStatus) return setError('Please select a marital status.')
    if (!gender) return setError('Please select a gender.')
    if (!course) return setError('Please select a course.')
    if (!classSchedule) return setError('Please select a class schedule.')
    if (!nokName.trim()) return setError('Please enter the next of kin name.')
    if (!nokPhone.trim()) return setError('Please enter the next of kin phone.')
    if (!address.trim()) return setError('Please enter the address.')

    await onSave({
      full_name: name,
      email: mail || null,
      phone: phone.trim(),
      state_of_origin: stateOfOrigin,
      lga,
      date_of_birth: dob,
      occupation: occupation.trim(),
      religion,
      last_institution: lastInstitution.trim(),
      marital_status: maritalStatus,
      next_of_kin_name: nokName.trim(),
      next_of_kin_phone: nokPhone.trim(),
      gender,
      course,
      class_schedule: classSchedule,
      address: address.trim(),
    })
  }

  return (
    <form className="addform" onSubmit={onSubmit} noValidate>
      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <div className="addform__grid">
        <div className="form__row">
          <label className="form__label" htmlFor={`es_name-${row.id}`}>Full Name</label>
          <input
            id={`es_name-${row.id}`} className="form__control" type="text"
            value={fullName} onChange={(e) => setFullName(e.target.value)}
            autoComplete="off" required
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_phone-${row.id}`}>Phone Number</label>
          <input
            id={`es_phone-${row.id}`} className="form__control" type="tel"
            value={phone} onChange={(e) => setPhone(e.target.value)}
            autoComplete="off" required
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_email-${row.id}`}>
            Email <span className="form__opt">(optional)</span>
          </label>
          <input
            id={`es_email-${row.id}`} className="form__control" type="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_dob-${row.id}`}>Date of Birth</label>
          <input
            id={`es_dob-${row.id}`} className="form__control" type="date"
            value={dob} onChange={(e) => setDob(e.target.value)}
            required
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_course-${row.id}`}>Course</label>
          <select
            id={`es_course-${row.id}`} className="form__control form__control--select"
            value={course} onChange={(e) => setCourse(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {withValue(COURSES.map((c) => c.trim()), course).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_schedule-${row.id}`}>Class Schedule</label>
          <select
            id={`es_schedule-${row.id}`} className="form__control form__control--select"
            value={classSchedule} onChange={(e) => setClassSchedule(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {withValue(CLASS_SCHEDULES, classSchedule).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_occupation-${row.id}`}>Occupation</label>
          <input
            id={`es_occupation-${row.id}`} className="form__control" type="text"
            value={occupation} onChange={(e) => setOccupation(e.target.value)}
            required
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_religion-${row.id}`}>Religion</label>
          <select
            id={`es_religion-${row.id}`} className="form__control form__control--select"
            value={religion} onChange={(e) => setReligion(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {withValue(RELIGIONS, religion).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_state-${row.id}`}>State of Origin</label>
          <select
            id={`es_state-${row.id}`} className="form__control form__control--select"
            value={stateOfOrigin} onChange={(e) => {
              setStateOfOrigin(e.target.value)
              setLga('')
            }}
            required
          >
            <option value="">Select…</option>
            {withValue(NIGERIA_STATES.map((s) => s.name), stateOfOrigin).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_lga-${row.id}`}>LGA</label>
          <select
            id={`es_lga-${row.id}`} className="form__control form__control--select"
            value={lga} onChange={(e) => setLga(e.target.value)}
            disabled={!stateOfOrigin}
            required
          >
            <option value="">{stateOfOrigin ? 'Select…' : 'Select your state first'}</option>
            {withValue(getLgas(stateOfOrigin), lga).map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_marital-${row.id}`}>Marital Status</label>
          <select
            id={`es_marital-${row.id}`} className="form__control form__control--select"
            value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {withValue(MARITAL_STATUSES, maritalStatus).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_gender-${row.id}`}>Gender</label>
          <select
            id={`es_gender-${row.id}`} className="form__control form__control--select"
            value={gender} onChange={(e) => setGender(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {withValue(GENDERS, gender).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_last-${row.id}`}>Last Institution</label>
          <input
            id={`es_last-${row.id}`} className="form__control" type="text"
            value={lastInstitution} onChange={(e) => setLastInstitution(e.target.value)}
            required
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_nok-${row.id}`}>Next of Kin</label>
          <input
            id={`es_nok-${row.id}`} className="form__control" type="text"
            value={nokName} onChange={(e) => setNokName(e.target.value)}
            required
          />
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor={`es_nokphone-${row.id}`}>Next of Kin Phone</label>
          <input
            id={`es_nokphone-${row.id}`} className="form__control" type="tel"
            value={nokPhone} onChange={(e) => setNokPhone(e.target.value)}
            required
          />
        </div>

        <div className="form__row addform__full">
          <label className="form__label" htmlFor={`es_address-${row.id}`}>Address</label>
          <textarea
            id={`es_address-${row.id}`} className="form__control form__control--area" rows={2}
            value={address} onChange={(e) => setAddress(e.target.value)}
            required
          />
        </div>
      </div>

      <p className="admin__settings-note">
        The registration number ({row.registration_number}) and exam year can&rsquo;t be changed —
        they appear on issued certificates and are used for verification.
      </p>

      <div className="modal__foot">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--green" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="spin" size={16} /> Saving…
            </>
          ) : (
            <>
              <Check size={16} /> Save Changes
            </>
          )}
        </button>
      </div>
    </form>
  )
}

// ---- Security monitor --------------------------------------------------
type SecurityAlert = {
  id: string
  alert_type: string
  severity: string
  title: string
  detail: string | null
  status: 'open' | 'dismissed'
  created_at: string
}

type LoginAttempt = {
  id: string
  email: string
  outcome: 'success' | 'failed'
  ip: string | null
  created_at: string
}

// Reads security_alerts + security_login_attempts (admin-only via RLS) and
// lets the admin dismiss resolved alerts. Alerts are minted automatically by
// the `log-login-attempt` Edge Function when failed logins spike.
function SecurityPanel() {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [attempts, setAttempts] = useState<LoginAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [attemptPage, setAttemptPage] = useState(1)

  const ATTEMPT_PAGE_SIZE = 10
  const attemptPageCount = Math.max(1, Math.ceil(attempts.length / ATTEMPT_PAGE_SIZE))
  const attemptPageRows = attempts.slice(
    (attemptPage - 1) * ATTEMPT_PAGE_SIZE,
    attemptPage * ATTEMPT_PAGE_SIZE
  )
  const attemptStart = attempts.length === 0 ? 0 : (attemptPage - 1) * ATTEMPT_PAGE_SIZE + 1
  const attemptEnd = Math.min(attemptPage * ATTEMPT_PAGE_SIZE, attempts.length)

  // Back to the first page whenever the data set changes underneath us.
  useEffect(() => {
    setAttemptPage(1)
  }, [attempts])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = getSupabase()
      const [aRes, tRes] = await Promise.all([
        supabase
          .from('security_alerts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('security_login_attempts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(25),
      ])
      if (aRes.error) throw new Error(aRes.error.message)
      if (tRes.error) throw new Error(tRes.error.message)
      setAlerts((aRes.data ?? []) as SecurityAlert[])
      setAttempts((tRes.data ?? []) as LoginAttempt[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load security data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function dismiss(alert: SecurityAlert) {
    setBusyId(alert.id)
    try {
      const supabase = getSupabase()
      const { error: rpcErr } = await supabase.rpc('dismiss_security_alert', {
        p_id: alert.id,
      })
      if (rpcErr) throw new Error('Could not dismiss the alert. Please try again.')
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, status: 'dismissed' } : a)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not dismiss the alert.')
    } finally {
      setBusyId(null)
    }
  }

  const openAlerts = alerts.filter((a) => a.status === 'open')

  return (
    <section className="admin__panel">
      <div className="admin__panel-head">
        <h2 className="admin__panel-title">Security Monitor</h2>
        <button
          type="button"
          className="admin__iconbtn"
          onClick={load}
          disabled={loading}
          aria-label="Refresh security data"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'spin' : undefined} />
        </button>
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="admin__loading">
          <Loader2 className="spin" size={24} />
          <p>Loading security data…</p>
        </div>
      ) : (
        <>
          <div className="admin__settings-tiles">
            <div className="admin__stat-tile">
              <span className="admin__stat-tile-label">Open alerts</span>
              <span className="admin__stat-tile-value">{openAlerts.length}</span>
            </div>
            <div className="admin__stat-tile">
              <span className="admin__stat-tile-label">Failed logins (shown)</span>
              <span className="admin__stat-tile-value">
                {attempts.filter((t) => t.outcome === 'failed').length}
              </span>
            </div>
            <div className="admin__stat-tile">
              <span className="admin__stat-tile-label">Successful logins</span>
              <span className="admin__stat-tile-value">
                {attempts.filter((t) => t.outcome === 'success').length}
              </span>
            </div>
          </div>

          <h3 className="admin__section-title">Alerts</h3>
          {alerts.length === 0 ? (
            <p className="admin__empty">No alerts. You're all clear.</p>
          ) : (
            <div className="admin__tablewrap">
              <table className="admin__table">
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th className="admin__th-acts">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="admin__student-id">
                          <span className="admin__student-name">{a.title}</span>
                          <span className="admin__student-email">{a.detail}</span>
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge--${a.severity === 'high' ? 'warn' : 'wait'}`}>
                          {a.severity}
                        </span>
                      </td>
                      <td>
                        <span className={`badge${a.status === 'open' ? ' badge--wait' : ''}`}>
                          {a.status}
                        </span>
                      </td>
                      <td>
                        <div className="admin__rowacts">
                          {a.status === 'open' && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => void dismiss(a)}
                              disabled={busyId === a.id}
                            >
                              {busyId === a.id ? (
                                <Loader2 className="spin" size={15} />
                              ) : (
                                <Check size={15} />
                              )}{' '}
                              Resolve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="admin__section-title">Recent login activity</h3>
          {attempts.length === 0 ? (
            <p className="admin__empty">No login attempts recorded yet.</p>
          ) : (
            <div className="admin__tablewrap">
              <table className="admin__table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Email</th>
                    <th>IP</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {attemptPageRows.map((t) => (
                    <tr key={t.id}>
                      <td>{timeAgo(t.created_at)}</td>
                      <td className="admin__reg">{t.email}</td>
                      <td>{t.ip || '—'}</td>
                      <td>
                        <span className={`badge${t.outcome === 'success' ? ' badge--ok' : ' badge--warn'}`}>
                          {t.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attempts.length > ATTEMPT_PAGE_SIZE && (
                <div className="admin__pager">
                  <span className="admin__pager-info">
                    Showing {attemptStart}–{attemptEnd} of {attempts.length} attempt
                    {attempts.length === 1 ? '' : 's'}
                  </span>
                  <div className="admin__pager-btns">
                    <button
                      type="button"
                      className="admin__pagebtn"
                      onClick={() => setAttemptPage((p) => Math.max(1, p - 1))}
                      disabled={attemptPage <= 1}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="admin__pager-page">
                      {attemptPage} / {attemptPageCount}
                    </span>
                    <button
                      type="button"
                      className="admin__pagebtn"
                      onClick={() => setAttemptPage((p) => Math.min(attemptPageCount, p + 1))}
                      disabled={attemptPage >= attemptPageCount}
                      aria-label="Next page"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="admin__settings-note">
            Attempts are recorded by the login screen and stored privately. Alerts are raised
            automatically when 5 or more failed logins occur within 5 minutes.
          </p>
        </>
      )}
    </section>
  )
}

// ---- Settings ----------------------------------------------------------
function SettingsPanel({
  email,
  stats,
  isFullAdmin,
  onSignOut,
}: {
  email: string
  stats: { total: number; issued: number; awaiting: number }
  isFullAdmin: boolean
  onSignOut: () => void
}) {
  return (
    <section className="admin__panel admin__settings">
      <header className="admin__settings-head">
        <span className="admin__avatar admin__settings-avatar" aria-hidden="true">
          {initials(email)}
        </span>
        <div className="admin__settings-id">
          <h2 className="admin__settings-name">{email}</h2>
          <span className="admin__settings-role">
            {isFullAdmin ? 'Super Administrator' : 'Administrator'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--ghost admin__settings-signout"
          onClick={onSignOut}
        >
          <LogOut size={16} /> Sign out
        </button>
      </header>

      <div className="admin__settings-tiles">
        <div className="admin__stat-tile">
          <span className="admin__stat-tile-label">Signed in as</span>
          <span className="admin__stat-tile-value">{email}</span>
        </div>
        <div className="admin__stat-tile">
          <span className="admin__stat-tile-label">Role</span>
          <span className="admin__stat-tile-value">
            {isFullAdmin ? 'Super Administrator' : 'Administrator'}
          </span>
        </div>
        <div className="admin__stat-tile">
          <span className="admin__stat-tile-label">Total students</span>
          <span className="admin__stat-tile-value">{stats.total}</span>
        </div>
        <div className="admin__stat-tile">
          <span className="admin__stat-tile-label">Certificates issued</span>
          <span className="admin__stat-tile-value">{stats.issued}</span>
        </div>
      </div>

      <p className="admin__settings-note">
        {isFullAdmin
          ? 'Super administrators can manage every student, story and certificate, view the security monitor, and control who else has access.'
          : ''}
      </p>

      {isFullAdmin && <AdminMembersPanel selfEmail={email} />}
    </section>
  )
}

// ---- Admin management (super-admin only) --------------------------------
type AdminMember = {
  email: string
  admin_role: 'super-admin' | 'admin'
  created_at: string
}

function AdminMembersPanel({ selfEmail }: { selfEmail: string }) {
  const [members, setMembers] = useState<AdminMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Two-step confirm: first click arms the button ("Confirm?"), second click removes.
  // Native window.confirm is silently blocked in some embedded/preview contexts,
  // which made the Remove button appear dead — this never relies on it.
  const [confirmingEmail, setConfirmingEmail] = useState<string | null>(null)
  // Add form state
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<'super-admin' | 'admin'>('admin')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = getSupabase()
      const { data, error: rpcErr } = await supabase.rpc('list_admin_members')
      if (rpcErr) throw new Error(rpcErr.message)
      setMembers((data ?? []) as AdminMember[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load admin members.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const clearError = () => setError(null)

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    const target = newEmail.trim().toLowerCase()
    if (!target) return
    setAdding(true)
    try {
      const supabase = getSupabase()
      const { error: rpcErr } = await supabase.rpc('add_admin_member', {
        p_email: target,
        p_role: newRole,
      })
      if (rpcErr) throw new Error(memberError(rpcErr.message))
      setNewEmail('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the member.')
    } finally {
      setAdding(false)
    }
  }

  async function changeRole(m: AdminMember, role: 'super-admin' | 'admin') {
    if (m.admin_role === role) return
    setBusy(m.email)
    clearError()
    try {
      const supabase = getSupabase()
      const { error: rpcErr } = await supabase.rpc('update_admin_role', {
        p_email: m.email,
        p_role: role,
      })
      if (rpcErr) throw new Error(memberError(rpcErr.message))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the role.')
    } finally {
      setBusy(null)
    }
  }

  function armRemove(m: AdminMember) {
    if (confirmingEmail === m.email) {
      setConfirmingEmail(null)
      void removeMember(m)
    } else {
      setConfirmingEmail(m.email)
      window.setTimeout(() => {
        setConfirmingEmail((c) => (c === m.email ? null : c))
      }, 4000)
    }
  }

  async function removeMember(m: AdminMember) {
    setBusy(m.email)
    clearError()
    try {
      const supabase = getSupabase()
      const { error: rpcErr } = await supabase.rpc('remove_admin_member', {
        p_email: m.email,
      })
      if (rpcErr) throw new Error(memberError(rpcErr.message))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the member.')
    } finally {
      setBusy(null)
    }
  }

  const you = (m: AdminMember) => m.email === selfEmail

  return (
    <div className="admin__manage">
      <h3 className="admin__section-title">Admin Access</h3>
      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <form className="admin__manage-add" onSubmit={addMember}>
        <input
          type="email"
          className="form__control"
          placeholder="email@example.com"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          aria-label="New admin email"
          required
        />
        <select
          className="form__control"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as 'super-admin' | 'admin')}
          aria-label="New admin role"
        >
          <option value="admin">Admin</option>
          <option value="super-admin">Super Admin</option>
        </select>
        <button type="submit" className="btn btn--primary" disabled={adding}>
          {adding ? <Loader2 className="spin" size={15} /> : <UserPlus size={15} />}
          {adding ? ' Adding…' : ' Add member'}
        </button>
      </form>

      {loading ? (
        <div className="admin__loading">
          <Loader2 className="spin" size={20} />
          <p>Loading team…</p>
        </div>
      ) : members.length === 0 ? (
        <p className="admin__empty">No admin members yet.</p>
      ) : (
        <div className="admin__tablewrap">
          <table className="admin__table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th className="admin__th-acts">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.email}>
                  <td>
                    <span className="admin__student-id">
                      <span className="admin__student-name">
                        {m.email} {you(m) && <span className="admin__you-tag">you</span>}
                      </span>
                      <span className="admin__student-email">Added {timeAgo(m.created_at)}</span>
                    </span>
                  </td>
                  <td>
                    <span className={`badge${m.admin_role === 'super-admin' ? ' badge--warn' : ''}`}>
                      {m.admin_role === 'super-admin' ? 'Super Admin' : 'Admin'}
                    </span>
                  </td>
                  <td>
                    <div className="admin__rowacts">
                      <select
                        className="form__control admin__role-select"
                        value={m.admin_role}
                        onChange={(e) =>
                          void changeRole(m, e.target.value as 'super-admin' | 'admin')
                        }
                        disabled={busy === m.email || you(m)}
                        title={you(m) ? "Your own role can't be changed here." : `Role for ${m.email}`}
                        aria-label={`Role for ${m.email}`}
                      >
                        <option value="admin">Admin</option>
                        <option value="super-admin">Super Admin</option>
                      </select>
                      {!you(m) && (
                        <button
                          type="button"
                          className={`btn btn--ghost btn--sm${confirmingEmail === m.email ? ' btn--danger' : ''}`}
                          onClick={() => armRemove(m)}
                          disabled={busy === m.email}
                          title={
                            confirmingEmail === m.email
                              ? 'Click again to confirm removal'
                              : 'Remove access'
                          }
                        >
                          {busy === m.email ? (
                            <Loader2 className="spin" size={15} />
                          ) : confirmingEmail === m.email ? (
                            <AlertCircle size={15} />
                          ) : (
                            <Trash2 size={15} />
                          )}
                          {confirmingEmail === m.email ? ' Confirm?' : ' Remove'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="admin__settings-note">
        New members must already have signed up and confirmed their account, or the add will be
        rejected. Your own row is locked — you can't change or remove your own access. The last
        super administrator can never be demoted or removed.
      </p>
    </div>
  )
}

function memberError(message: string): string {
  const code = message.replace(/^.*"code"\s*:\s*"([A-Z_]+)".*$/s, '$1')
  if (code === 'NOT_SUPER_ADMIN') return 'Only a super administrator can manage admin access.'
  if (code === 'NO_AUTH_USER')
    return 'No confirmed account found for that email. Ask them to register first.'
  if (code === 'ALREADY_MEMBER') return 'That email is already an admin member.'
  if (code === 'LAST_SUPER_ADMIN')
    return 'Cannot remove or demote the last super administrator.'
  if (code === 'NOT_FOUND') return 'That member was not found.'
  if (code === 'INVALID_EMAIL') return 'Please enter a valid email address.'
  if (code === 'INVALID_ROLE') return 'Please choose a valid role.'
  return message
}

// ---- Add-student error copy (extends the shared register messages) ------
function addErrorMessage(code: string): string {
  if (code === 'NOT_ADMIN') return 'Your account is not authorised to add students.'
  if (code === 'INVALID_YEAR') return 'Please enter a valid registration year.'
  return registerErrorMessage(code)
}

function updateErrorMessage(code: string): string {
  switch (code) {
    case 'NOT_ADMIN':
      return 'Your account is not authorised to edit students.'
    case 'EMAIL_EXISTS':
      return 'That email is already registered to another student.'
    case 'INVALID_EMAIL':
      return 'Please enter a valid email address.'
    case 'INVALID_PHONE':
      return 'Please enter a valid phone number.'
    default:
      return 'Could not save the changes. Please try again.'
  }
}

// ---- Add a manually-registered student ---------------------------------
// Creates the candidate row via the admin-only RPC, then hands the new id
// back so the parent can open its profile and attach the certificate.
interface AddStudentDraft {
  fullName: string
  email: string
  phone: string
  year: string
  course: string
  dob: string
  stateOfOrigin: string
  lga: string
  occupation: string
  religion: string
  maritalStatus: string
  gender: string
  classSchedule: string
  lastInstitution: string
  nokName: string
  nokPhone: string
  address: string
  photoDataUrl: string | null
}

function AddStudentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string, reg: string) => void | Promise<void>
}) {
  const thisYear = new Date().getFullYear()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [year, setYear] = useState(String(thisYear))
  const [course, setCourse] = useState('')
  const [dob, setDob] = useState('')
  const [stateOfOrigin, setStateOfOrigin] = useState('')
  const [lga, setLga] = useState('')
  const [occupation, setOccupation] = useState('')
  const [religion, setReligion] = useState('')
  const [maritalStatus, setMaritalStatus] = useState('')
  const [gender, setGender] = useState('')
  const [classSchedule, setClassSchedule] = useState('')
  const [lastInstitution, setLastInstitution] = useState('')
  const [nokName, setNokName] = useState('')
  const [nokPhone, setNokPhone] = useState('')
  const [address, setAddress] = useState('')
  const DRAFT_KEY = 'add-student'
  const [passport, setPassport] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the form was rehydrated from localStorage after the app was
  // restarted mid-entry (Android killing the WebView while the camera was
  // open) so we can tell the admin what happened instead of it feeling
  // like a mysterious crash.
  const [restored, setRestored] = useState(false)

  // Closing the modal abandons the in-progress form, so clear its draft.
  const close = () => {
    clearDraft(DRAFT_KEY)
    onClose()
  }

  // Close on Escape (matches the profile modal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // Restore a saved draft (e.g. after Android killed the WebView while the
  // camera was open) so the admin picks up exactly where they left off.
  useEffect(() => {
    const d = loadDraft<AddStudentDraft>(DRAFT_KEY)
    if (!d) return
    setRestored(true)
    setFullName(d.fullName ?? '')
    setEmail(d.email ?? '')
    setPhone(d.phone ?? '')
    setYear(d.year ?? String(thisYear))
    setCourse(d.course ?? '')
    setDob(d.dob ?? '')
    setStateOfOrigin(d.stateOfOrigin ?? '')
    setLga(d.lga ?? '')
    setOccupation(d.occupation ?? '')
    setReligion(d.religion ?? '')
    setMaritalStatus(d.maritalStatus ?? '')
    setGender(d.gender ?? '')
    setClassSchedule(d.classSchedule ?? '')
    setLastInstitution(d.lastInstitution ?? '')
    setNokName(d.nokName ?? '')
    setNokPhone(d.nokPhone ?? '')
    setAddress(d.address ?? '')
    if (d.photoDataUrl) {
      const file = dataUrlToFile(d.photoDataUrl, 'passport.jpg')
      setPhotoDataUrl(d.photoDataUrl)
      setPassport(file)
      setPreview(URL.createObjectURL(file))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save the whole form (fields + photo) as a debounced draft so any
  // reload — the slow-device camera kill included — is lossless.
  const formDraft = {
    fullName, email, phone, year, course, dob, stateOfOrigin, lga,
    occupation, religion, maritalStatus, gender, classSchedule,
    lastInstitution, nokName, nokPhone, address, photoDataUrl,
  }
  // Latest snapshot for the synchronous flush below (the debounced effect's
  // closure would go stale between keystrokes).
  const draftRef = useRef(formDraft)
  draftRef.current = formDraft

  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft(DRAFT_KEY, formDraft)
    }, 400)
    return () => clearTimeout(t)
  }, [formDraft])

  // Android may destroy the activity outright while the native camera is in
  // the foreground; the 400ms debounce would lose anything typed just before
  // the trip. Flush synchronously the moment the app is sent to background.
  useEffect(() => {
    const flush = () => saveDraft(DRAFT_KEY, draftRef.current)
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Release the object URL when it changes or the modal unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  function onPickFile(file: File | null) {
    setError(null)
    if (preview) URL.revokeObjectURL(preview)
    if (!file) {
      setPassport(null)
      setPreview(null)
      setPhotoDataUrl(null)
      return
    }
    const pErr = passportError(file)
    if (pErr) {
      setError(pErr)
      setPassport(null)
      setPreview(null)
      setPhotoDataUrl(null)
      return
    }
    setPassport(file)
    setPreview(URL.createObjectURL(file))
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
  }

  function removePassport() {
    if (preview) URL.revokeObjectURL(preview)
    setPassport(null)
    setPreview(null)
    setPhotoDataUrl(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const name = fullName.trim()
    const mail = email.trim().toLowerCase()

    if (!isValidName(name)) return setError('Please enter the student’s full name.')
    if (mail && !isValidEmail(mail)) return setError('Please enter a valid email address.')
    if (!isValidPhone(phone)) return setError('Please enter a valid phone number.')
    if (!occupation.trim()) return setError('Please enter an occupation.')
    if (!religion) return setError('Please select a religion.')
    if (!stateOfOrigin) return setError('Please select the state of origin.')
    if (!lga) return setError('Please select the LGA.')
    if (!dob) return setError('Please select a date of birth.')
    if (!lastInstitution.trim()) return setError('Please enter the last institution.')
    if (!maritalStatus) return setError('Please select a marital status.')
    if (!gender) return setError('Please select a gender.')
    if (!course) return setError('Please select a course.')
    if (!classSchedule) return setError('Please select a class schedule.')
    if (!nokName.trim()) return setError('Please enter the next of kin name.')
    if (!nokPhone.trim()) return setError('Please enter the next of kin phone.')
    if (!address.trim()) return setError('Please enter the address.')
    if (!passport) return setError('Please attach a passport photo.')
    const pErr = passportError(passport)
    if (pErr) return setError(pErr)
    const yr = Number(year)
    if (!Number.isInteger(yr) || yr < 2000 || yr > thisYear + 1) {
      return setError('Please enter a valid registration year.')
    }

    setBusy(true)
    try {
      const supabase = getSupabase()
      // 1. Upload the passport through the validating Edge Function (server-side
      //    magic-byte + size checks, private storage). Returns the object path.
      const form = new FormData()
      form.append('file', passport)
      const { data: upData, error: upErr } = await supabase.functions.invoke(
        'upload-passport',
        { body: form }
      )
      if (upErr) {
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

      // 2. Create the row via the admin-only RPC (validates + assigns reg number).
      const { data, error: rpcErr } = await supabase.rpc('admin_add_candidate', {
        p_full_name: name,
        p_email: mail || null,
        p_phone: phone.trim(),
        p_state_of_origin: stateOfOrigin.trim() || null,
        p_lga: lga.trim() || null,
        p_date_of_birth: dob || null,
        p_occupation: occupation.trim(),
        p_religion: religion,
        p_last_institution: lastInstitution.trim() || null,
        p_marital_status: maritalStatus || null,
        p_next_of_kin_name: nokName.trim() || null,
        p_next_of_kin_phone: nokPhone.trim() || null,
        p_gender: gender || null,
        p_course: course || null,
        p_class_schedule: classSchedule || null,
        p_address: address.trim() || null,
        p_passport_url: path,
        p_exam_year: yr,
      })

      if (rpcErr) {
        const raw = rpcErr.message || ''
        const code = raw.includes('NOT_ADMIN')
          ? 'NOT_ADMIN'
          : raw.includes('INVALID_YEAR')
            ? 'INVALID_YEAR'
            : registerErrorCode(raw)
        throw new Error(addErrorMessage(code))
      }

      const row = Array.isArray(data) ? data[0] : data
      const id = (row?.id ?? '') as string
      const reg = (row?.registration_number ?? '') as string
      if (!id || !reg) throw new Error('Student added, but no reference was returned. Please refresh.')

      clearDraft(DRAFT_KEY)
      await onCreated(id, reg)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the student.')
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add student" onClick={close}>
      <div className="modal__card modal__card--form" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={close} aria-label="Close">
          <X size={20} />
        </button>

        <div className="addform__head">
          <span className="addform__head-icon" aria-hidden="true">
            <UserPlus size={22} strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="modal__name">Add Student</h2>
          </div>
        </div>

        <form className="addform" onSubmit={onSubmit} noValidate>
          {restored && (
            <div className="notice notice--info" role="status">
              We picked up where you left off after the app restarted. Your entries were saved —
              only the passport photo needs to be taken again.
            </div>
          )}
          {error && (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          )}

          <div className="addform__grid">
            <div className="form__row">
              <label className="form__label" htmlFor="as_name">Full Name</label>
              <input
                id="as_name" className="form__control" type="text"
                value={fullName} onChange={(e) => setFullName(e.target.value)}
                autoComplete="off" required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_phone">Phone Number</label>
              <input
                id="as_phone" className="form__control" type="tel"
                value={phone} onChange={(e) => setPhone(e.target.value)}
                autoComplete="off" required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_email">
                Email <span className="form__opt">(optional)</span>
              </label>
              <input
                id="as_email" className="form__control" type="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_year">Registration Year</label>
              <input
                id="as_year" className="form__control" type="number"
                min={2000} max={thisYear + 1} step={1}
                value={year} onChange={(e) => setYear(e.target.value)}
                required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_course">
                Course
              </label>
              <select
                id="as_course" className="form__control form__control--select"
                value={course} onChange={(e) => setCourse(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {COURSES.map((c) => (
                  <option key={c} value={c.trim()}>{c.trim()}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_dob">
                Date of Birth
              </label>
              <input
                id="as_dob" className="form__control" type="date"
                value={dob} onChange={(e) => setDob(e.target.value)}
                required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_occupation">Occupation</label>
              <input
                id="as_occupation" className="form__control" type="text"
                value={occupation} onChange={(e) => setOccupation(e.target.value)}
                required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_religion">Religion</label>
              <select
                id="as_religion" className="form__control form__control--select"
                value={religion} onChange={(e) => setReligion(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {RELIGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_state">
                State of Origin
              </label>
              <select
                id="as_state" className="form__control form__control--select"
                value={stateOfOrigin} onChange={(e) => {
                  setStateOfOrigin(e.target.value)
                  setLga('')
                }}
                required
              >
                <option value="">Select…</option>
                {NIGERIA_STATES.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_lga">
                LGA
              </label>
              <select
                id="as_lga" className="form__control form__control--select"
                value={lga} onChange={(e) => setLga(e.target.value)}
                disabled={!stateOfOrigin}
                required
              >
                <option value="">{stateOfOrigin ? 'Select…' : 'Select your state first'}</option>
                {getLgas(stateOfOrigin).map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_marital">
                Marital Status
              </label>
              <select
                id="as_marital" className="form__control form__control--select"
                value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {MARITAL_STATUSES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_gender">
                Gender
              </label>
              <select
                id="as_gender" className="form__control form__control--select"
                value={gender} onChange={(e) => setGender(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_schedule">
                Class Schedule
              </label>
              <select
                id="as_schedule" className="form__control form__control--select"
                value={classSchedule} onChange={(e) => setClassSchedule(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {CLASS_SCHEDULES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_last">
                Last Institution
              </label>
              <input
                id="as_last" className="form__control" type="text"
                value={lastInstitution} onChange={(e) => setLastInstitution(e.target.value)}
                required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_nok">
                Next of Kin
              </label>
              <input
                id="as_nok" className="form__control" type="text"
                value={nokName} onChange={(e) => setNokName(e.target.value)}
                required
              />
            </div>

            <div className="form__row">
              <label className="form__label" htmlFor="as_nokphone">
                Next of Kin Phone
              </label>
              <input
                id="as_nokphone" className="form__control" type="tel"
                value={nokPhone} onChange={(e) => setNokPhone(e.target.value)}
                required
              />
            </div>

            <div className="form__row addform__full">
              <label className="form__label" htmlFor="as_address">
                Address
              </label>
              <textarea
                id="as_address" className="form__control form__control--area" rows={2}
                value={address} onChange={(e) => setAddress(e.target.value)}
                required
              />
            </div>

            <div className="form__row addform__full">
              <span className="form__label">Passport Photo</span>
              {preview ? (
                <div className="passport">
                  <img className="passport__thumb" src={preview} alt="Passport preview" />
                  <div className="passport__meta">
                    <span className="passport__name">{passport?.name}</span>
                    <div className="passport__acts">
                      <button
                        type="button" className="passport__link passport__link--danger"
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
          </div>

          <div className="modal__foot">
            <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn--green" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="spin" size={16} /> Adding…
                </>
              ) : (
                <>
                  <UserPlus size={16} /> Add Student
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- CSV import ----------------------------------------------------------
// RFC-4180-ish parser: handles quoted fields (incl. commas, quotes, newlines)
// and blank rows. Comment lines beginning with "#" are skipped.
function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      // Lenient quoting: only treat a quote as opening a quoted field when
      // it starts the field. A stray " in the middle of an unquoted value
      // (e.g. addresses or notes) then can't swallow the rest of the file.
    } else if (c === '"' && field === '') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      const joined = row.map((v) => v.trim()).join('')
      if (joined) out.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((v) => v.trim() !== '')) out.push(row)
  }
  return out
}

const IMPORT_HEADERS = [
  'full_name',
  'email',
  'phone',
  'state_of_origin',
  'lga',
  'date_of_birth',
  'occupation',
  'religion',
  'last_institution',
  'marital_status',
  'next_of_kin_name',
  'next_of_kin_phone',
  'gender',
  'course',
  'class_schedule',
  'address',
  'exam_year',
] as const

type ImportRow = {
  n: number
  name: string
  phone: string
  course: string
  values: Record<string, string>
  data?: Record<string, string | null>
  error: string | null
  status: 'ok' | 'bad' | 'importing' | 'imported' | 'failed'
  msg?: string
}

// Returns the canonical list entry whose trimmed value matches, or null.
function matchOption(list: readonly string[], value: string): string | null {
  const v = value.trim()
  return list.find((o) => o.trim() === v) ?? null
}

function validateImportRow(values: Record<string, string>): { error: string | null; data?: Record<string, string | null> } {
  const thisYear = new Date().getFullYear()
  const get = (k: string) => (values[k] ?? '').trim()

  if (!get('full_name')) return { error: 'Full name is required.' }
  if (!isValidName(get('full_name'))) return { error: 'Full name looks invalid.' }
  const email = get('email')
  if (email && !isValidEmail(email)) return { error: 'Email is not a valid address.' }
  if (!get('phone')) return { error: 'Phone is required.' }
  if (!isValidPhone(get('phone'))) return { error: 'Phone number looks invalid.' }
  for (const k of ['state_of_origin', 'lga', 'occupation', 'last_institution', 'next_of_kin_name', 'next_of_kin_phone', 'address']) {
    if (!get(k)) return { error: `${k} is required.` }
  }
  const dob = get('date_of_birth')
  if (!dob) return { error: 'Date of birth is required.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(new Date(dob).getTime()))
    return { error: 'Date of birth must be YYYY-MM-DD.' }

  const course = matchOption(COURSES, get('course'))
  if (!course) return { error: `Course must be one of: ${COURSES.map((c) => c.trim()).join(', ')}.` }
  const schedule = matchOption(CLASS_SCHEDULES, get('class_schedule'))
  if (!schedule) return { error: `Class schedule must be one of: ${CLASS_SCHEDULES.join(', ')}.` }
  const gender = matchOption(GENDERS, get('gender'))
  if (!gender) return { error: 'Gender must be Male or Female.' }
  const marital = matchOption(MARITAL_STATUSES, get('marital_status'))
  if (!marital) return { error: 'Marital status must be Single or Married.' }
  const religion = matchOption(RELIGIONS, get('religion'))
  if (!religion) return { error: `Religion must be one of: ${RELIGIONS.join(', ')}.` }

  const yearRaw = get('exam_year')
  let examYear: string | null = null
  if (yearRaw) {
    if (!/^\d{4}$/.test(yearRaw)) return { error: 'Exam year must be a 4-digit year.' }
    const y = Number(yearRaw)
    if (y < 2000 || y > thisYear + 1) return { error: 'Exam year is out of range.' }
    examYear = yearRaw
  }

  return {
    error: null,
    data: {
      p_full_name: get('full_name'),
      p_email: email || null,
      p_phone: get('phone'),
      p_state_of_origin: get('state_of_origin'),
      p_lga: get('lga'),
      p_date_of_birth: dob,
      p_occupation: get('occupation'),
      p_religion: religion,
      p_last_institution: get('last_institution'),
      p_marital_status: marital,
      p_next_of_kin_name: get('next_of_kin_name'),
      p_next_of_kin_phone: get('next_of_kin_phone'),
      p_gender: gender,
      p_course: course,
      p_class_schedule: schedule,
      p_address: get('address'),
      p_exam_year: examYear,
    },
  }
}

function ImportStudentsModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (summary: string) => void
}) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: { n: number; msg: string }[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function handleFile(file: File | null) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setFileName(file.name)
    setFileError(null)
    setResult(null)
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length < 2) {
      setFileError('The file has no data rows. Use the template and keep the header row.')
      setRows([])
      return
    }
    const header = parsed[0].map((h) => h.trim())
    const missing = IMPORT_HEADERS.filter((h) => !header.includes(h))
    if (missing.length > 0) {
      setFileError(`Missing column(s): ${missing.join(', ')}. Use the template.`)
      setRows([])
      return
    }
    const idx = Object.fromEntries(IMPORT_HEADERS.map((h) => [h, header.indexOf(h)]))
    const parsedRows: ImportRow[] = parsed
      .slice(1)
      .map((cells, i) => {
        const n = i + 2
        if (cells.length !== IMPORT_HEADERS.length) {
          return {
            n,
            name: (cells[0] ?? '').trim() || `Row ${n}`,
            phone: (cells[2] ?? '').trim(),
            course: (cells[13] ?? '').trim(),
            values: {},
            error: `Row has ${cells.length} columns, expected ${IMPORT_HEADERS.length}. A stray " in the file or an extra comma may have shifted the columns.`,
            status: 'bad',
          } as ImportRow
        }
        const values: Record<string, string> = {}
        for (const h of IMPORT_HEADERS) values[h] = (cells[idx[h]] ?? '').trim()
        const name = values['full_name']
        if (!name) {
          return {
            n,
            name: `Row ${n}`,
            phone: values['phone'],
            course: values['course'],
            values,
            error: 'Full name is required.',
            status: 'bad',
          } as ImportRow
        }
        const check = validateImportRow(values)
        return {
          n,
          name,
          phone: values['phone'],
          course: values['course'],
          values,
          error: check.error,
          status: check.error ? 'bad' : 'ok',
          ...(check.data ? { data: check.data } : {}),
        } as ImportRow
      })
    setRows(parsedRows)
  }

  const okRows = rows.filter((r) => r.status === 'ok')

  async function runImport() {
    if (okRows.length === 0 || busy) return
    setBusy(true)
    const failed: { n: number; msg: string }[] = []
    for (const r of okRows) {
      setRows((prev) => prev.map((x) => (x.n === r.n ? { ...x, status: 'importing' } : x)))
      try {
        const supabase = getSupabase()
        const { error: rpcErr } = await supabase.rpc('admin_import_candidate', r.data)
        if (rpcErr) {
          const code = registerErrorCode(rpcErr.message)
          const msg = code ? addErrorMessage(code) : rpcErr.message
          failed.push({ n: r.n, msg })
          setRows((prev) => prev.map((x) => (x.n === r.n ? { ...x, status: 'failed', msg } : x)))
        } else {
          setRows((prev) => prev.map((x) => (x.n === r.n ? { ...x, status: 'imported' } : x)))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Import failed.'
        failed.push({ n: r.n, msg })
        setRows((prev) => prev.map((x) => (x.n === r.n ? { ...x, status: 'failed', msg } : x)))
      }
    }
    setResult({ ok: okRows.length - failed.length, failed })
    setBusy(false)
  }

  function closeWithSummary() {
    const ok = result?.ok ?? 0
    const bad = rows.filter((r) => r.status === 'bad').length
    onImported(
      `Imported ${ok} student${ok === 1 ? '' : 's'}.${bad > 0 ? ` ${bad} row${bad === 1 ? '' : 's'} skipped.` : ''}`
    )
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Import students"
      onClick={() => !busy && onClose()}
    >
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="modal__close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="modal__head">
          <h2 className="modal__name">Import Students</h2>
          <p className="modal__hint">
            Upload a CSV matching the template.          </p>
        </div>

        <div className="modal__body">
          {fileError && (
            <div className="notice notice--error" role="alert">
              {fileError}
            </div>
          )}

          <div className="import__bar">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const a = document.createElement('a')
                a.href = `${import.meta.env.BASE_URL}import-students-template.csv`
                a.download = 'import-students-template.csv'
                a.click()
              }}
            >
              <Download size={15} /> Template
            </button>
            <button
              type="button"
              className="btn btn--green btn--sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <UploadCloud size={15} /> Choose CSV
            </button>
            {fileName && <span className="import__file">{fileName}</span>}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv"
              hidden
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {rows.length > 0 && (
            <div className="import__preview">
              <div className="import__tablewrap">
                <table className="import__table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Course</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.n}>
                        <td>{r.n}</td>
                        <td>{r.name}</td>
                        <td>{r.phone}</td>
                        <td>{r.course}</td>
                        <td>
                          {r.status === 'ok' && <span className="badge badge--wait">Ready</span>}
                          {r.status === 'bad' && (
                            <span className="badge badge--warn" title={r.error ?? ''}>
                              Skip
                            </span>
                          )}
                          {r.status === 'importing' && (
                            <span className="badge badge--wait">
                              <Loader2 className="spin import__spin" size={12} /> Importing…
                            </span>
                          )}
                          {r.status === 'imported' && <span className="badge badge--ok">Done</span>}
                          {r.status === 'failed' && (
                            <span className="badge badge--warn" title={r.msg}>
                              Failed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="import__note">
                {rows.length} row{rows.length === 1 ? '' : 's'} found · {okRows.length} ready to
                import
                {rows.some((r) => r.status === 'bad')
                  ? ` · ${rows.filter((r) => r.status === 'bad').length} skipped (hover the Skip badge for why)`
                  : ''}
                {rows.length > 8 ? ' · scroll the table to see all' : ''}.
              </p>
              {result && (
                <div className={`notice ${result.failed.length ? 'notice--error' : 'notice--success'}`}>
                  Imported {result.ok} student{result.ok === 1 ? '' : 's'}
                  {result.failed.length > 0
                    ? `, ${result.failed.length} failed${result.failed
                        .slice(0, 5)
                        .map((f) => ` · Row ${f.n}: ${f.msg}`)
                        .join('')}`
                    : ''}
                  .
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal__foot">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => (result ? closeWithSummary() : onClose())}
            disabled={busy}
          >
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn--green"
              onClick={() => void runImport()}
              disabled={busy || okRows.length === 0}
            >
              {busy ? (
                <>
                  <Loader2 className="spin" size={16} /> Importing…
                </>
              ) : (
                <>
                  <FileSpreadsheet size={16} /> Import {okRows.length} row{okRows.length === 1 ? '' : 's'}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
