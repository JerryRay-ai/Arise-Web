// Supabase Edge Function: register
// Public registration gate. The anonymous key alone can never create a
// candidate through this path — the browser must first present a valid
// hCaptcha token, which is verified HERE against hCaptcha's API before the
// hardened register_candidate RPC is invoked. This stops bots from spamming
// the RPC even if they bypass the frontend entirely.
//
// Deploy:  supabase functions deploy register
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform. Set HCAPTCHA_SECRET to your
//          hCaptcha SECRET key (never expose it to the browser):
//            supabase secrets set HCAPTCHA_SECRET=<your-secret>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Returns a trimmed string, or null when empty — matches what the RPC expects
// for optional fields (e.g. email).
function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json(headers, { error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
  }

  const token = str(body.captcha_token)
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

  const { data, error } = await admin.rpc('register_candidate', {
    p_full_name: str(body.full_name) ?? '',
    p_email: str(body.email),
    p_phone: str(body.phone) ?? '',
    p_state_of_origin: str(body.state_of_origin),
    p_lga: str(body.lga),
    p_date_of_birth: body.date_of_birth || null,
    p_occupation: str(body.occupation),
    p_religion: str(body.religion),
    p_last_institution: str(body.last_institution),
    p_marital_status: str(body.marital_status),
    p_next_of_kin_name: str(body.next_of_kin_name),
    p_next_of_kin_phone: str(body.next_of_kin_phone),
    p_gender: str(body.gender),
    p_course: str(body.course),
    p_class_schedule: str(body.class_schedule),
    p_address: str(body.address),
    p_passport_url: str(body.passport_url),
  })

  if (error) {
    // Echo back the RPC's error code so the client can show its friendly copy.
    const msg = error.message ?? ''
    const known = [
      'RATE_LIMITED',
      'EMAIL_EXISTS',
      'INVALID_NAME',
      'INVALID_EMAIL',
      'INVALID_PHONE',
      'INVALID_PASSPORT',
      'INVALID_OCCUPATION',
      'INVALID_RELIGION',
    ]
    const code = known.find((c) => msg.includes(c))
    return json(
      headers,
      { error: code ?? 'REGISTER_FAILED' },
      code === 'RATE_LIMITED' ? 429 : 400
    )
  }

  const row = Array.isArray(data) ? data[0] : data
  const reg = row?.registration_number
  if (!reg) return json(headers, { error: 'REGISTER_FAILED' }, 500)

  return json(headers, { registration_number: reg })
})
