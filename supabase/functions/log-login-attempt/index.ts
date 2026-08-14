// Supabase Edge Function: log-login-attempt
// Records every admin sign-in attempt (success or failure) and raises a
// real-time brute-force alert when failed attempts spike within a window.
// Called from the admin login screen WITHOUT an authenticated session (a
// failed password can't produce one), so it runs with verify_jwt off and is
// deliberately tiny: it only INSERTs into the two security tables.
//
// Deploy:  supabase functions deploy log-login-attempt --no-verify-jwt
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform — no manual setup needed.
//          ALLOWED_ORIGINS (optional): comma-separated browser origins.
//          RESEND_API_KEY (optional): enable email alerts to super-admins.
//          ALERT_FROM_EMAIL (optional): verified Resend sender address.
//          If the two Resend secrets are unset, alerts still land in the
//          admin Security panel — only the email copy is skipped.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FAIL_WINDOW_MINUTES = 5
const FAIL_THRESHOLD = 5
const ALERT_COOLDOWN_MINUTES = 60

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173', 'https://localhost', 'capacitor://localhost']

function allowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? ''
  const extra = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return [...new Set([...DEFAULT_ORIGINS, ...extra])]
}

function cors(req: Request): Headers {
  const origins = allowedOrigins()
  const origin = req.headers.get('origin') ?? ''
  const allow = origins.includes(origin) || origins.includes('*') ? origin : 'null'
  return new Headers({
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  })
}

function json(headers: Headers, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

// Best-effort client IP from the platform-injected forwarding headers.
function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() ?? null
}

// Email every super-admin when a security alert is raised. Best-effort: a
// failure to send (or missing Resend secrets) must never break the login flow.
async function notifySuperAdmins(
  admin: ReturnType<typeof createClient>,
  alert: { title: string; detail: string }
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('ALERT_FROM_EMAIL')
  if (!apiKey || !from) return

  const { data: supers, error } = await admin
    .from('admin_emails')
    .select('email')
    .eq('admin_role', 'super-admin')
  if (error || !supers || supers.length === 0) return

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">' +
    '<h2 style="color:#d64545">ARISE Admin Security Alert</h2>' +
    '<p style="color:#1a2b20;font-size:15px;line-height:1.5">' +
    `<strong>${alert.title}</strong></p>` +
    `<p style="color:#1a2b20;font-size:15px;line-height:1.5">${alert.detail}</p>` +
    '<p style="color:#6b7a6f;font-size:13px">' +
    'Open the Admin app &rarr; Security to review the attempts and dismiss this alert.</p>' +
    '</div>'

  for (const s of supers) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [s.email],
          subject: `ARISE Security Alert: ${alert.title}`,
          html,
        }),
      })
    } catch {
      /* best-effort — the alert is already recorded in the Security panel */
    }
  }
}

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json(headers, { error: 'Method not allowed' }, 405)

  let email = ''
  let outcome = ''
  try {
    const body = await req.json()
    email = String(body.email ?? '').trim().toLowerCase()
    outcome = String(body.outcome ?? '').trim().toLowerCase()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
  }

  if (!email || !['success', 'failed'].includes(outcome)) {
    return json(headers, { error: 'email and outcome (success|failed) are required' }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const ip = clientIp(req)

  const { error: insErr } = await admin.from('security_login_attempts').insert({
    email,
    outcome,
    ip,
  })
  if (insErr) return json(headers, { error: 'Could not record the attempt' }, 500)

  // Real-time brute-force detection: when failures pile up fast enough and no
  // alert for the same spike was raised recently, mint one for the admin board.
  if (outcome === 'failed') {
    const since = new Date(Date.now() - FAIL_WINDOW_MINUTES * 60_000).toISOString()
    const { count, error: cntErr } = await admin
      .from('security_login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('outcome', 'failed')
      .gte('created_at', since)
    if (cntErr || (count ?? 0) < FAIL_THRESHOLD) return json(headers, { ok: true })

    const cooldown = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60_000).toISOString()
    const { data: recent, error: qErr } = await admin
      .from('security_alerts')
      .select('id')
      .eq('alert_type', 'brute_force')
      .eq('status', 'open')
      .gte('created_at', cooldown)
      .limit(1)
      .maybeSingle()
    if (qErr) return json(headers, { ok: true })
    if (!recent) {
      const detail = `${count} failed attempts in the last ${FAIL_WINDOW_MINUTES} minutes against ${email}.`
      await admin.from('security_alerts').insert({
        alert_type: 'brute_force',
        severity: 'high',
        title: 'Repeated failed admin login attempts',
        detail,
        status: 'open',
      })
      await notifySuperAdmins(admin, {
        title: 'Repeated failed admin login attempts',
        detail,
      })
    }
  }

  return json(headers, { ok: true })
})