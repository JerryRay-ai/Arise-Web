// Supabase Edge Function: verify
// Public certificate-lookup gate. The anonymous key can no longer call
// verify_candidate directly — the browser must first present a valid
// hCaptcha token, which is verified HERE before the hardened RPC runs.
// This stops automated credential probing even when the frontend is bypassed.
//
// Deploy:  supabase functions deploy verify --no-verify-jwt
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform. Set HCAPTCHA_SECRET to your
//          hCaptcha SECRET key (never expose it to the browser):
//            supabase secrets set HCAPTCHA_SECRET=<your-secret>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Production defaults are ONLY the origins the shipped Android app needs.
// Add http://localhost dev origins via ALLOWED_ORIGINS while developing.
const DEFAULT_ORIGINS = ['https://localhost', 'capacitor://localhost']

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

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json(headers, { error: 'Method not allowed' }, 405)

  let phone = ''
  let reg = ''
  let token = ''
  try {
    const body = await req.json()
    phone = String(body.phone ?? '').trim()
    reg = String(body.registration_number ?? '').trim()
    token = String(body.captcha_token ?? '').trim()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
  }

  if (!phone || !reg) {
    return json(headers, { error: 'Phone number and registration number are required' }, 400)
  }
  if (!token) return json(headers, { error: 'CAPTCHA_REQUIRED' }, 400)

  // Verify the token against hCaptcha before anything else is touched.
  let verified = false
  try {
    const resp = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: Deno.env.get('HCAPTCHA_SECRET') ?? '',
        response: token,
      }),
    })
    const data = (await resp.json()) as { success?: boolean }
    verified = data.success === true
  } catch {
    /* network hiccup — treated as a failed verification below */
  }
  if (!verified) return json(headers, { error: 'CAPTCHA_FAILED' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin.rpc('verify_candidate', {
    p_reg: reg,
    p_phone: phone,
  })

  if (error) {
    const msg = error.message ?? ''
    return json(
      headers,
      { error: msg.includes('RATE_LIMITED') ? 'RATE_LIMITED' : 'VERIFY_FAILED' },
      msg.includes('RATE_LIMITED') ? 429 : 400
    )
  }

  const found = Array.isArray(data) ? data[0] : data
  if (!found) return json(headers, { error: 'NOT_FOUND' }, 404)

  return json(headers, found)
})