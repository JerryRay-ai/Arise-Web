// Supabase Edge Function: share-story
// Public alumni-story submission gate. The anonymous key can no longer call
// submit_experience directly — the browser must first present a valid
// hCaptcha token, which is verified HERE before the hardened RPC runs.
//
// Deploy:  supabase functions deploy share-story --no-verify-jwt
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

  let fullName = ''
  let program = ''
  let phone = ''
  let experience = ''
  let token = ''
  try {
    const body = await req.json()
    fullName = String(body.full_name ?? '').trim()
    program = String(body.program ?? '').trim()
    phone = String(body.phone ?? '').trim()
    experience = String(body.experience ?? '').trim()
    token = String(body.captcha_token ?? '').trim()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
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

  const { error } = await admin.rpc('submit_experience', {
    p_full_name: fullName,
    p_program: program,
    p_phone: phone,
    p_experience: experience,
  })

  if (error) {
    const msg = error.message ?? ''
    const known = [
      'RATE_LIMITED',
      'INVALID_NAME',
      'INVALID_PROGRAM',
      'INVALID_PHONE',
      'INVALID_EXPERIENCE',
    ]
    const code = known.find((c) => msg.includes(c))
    return json(
      headers,
      { error: code ?? 'SUBMIT_FAILED' },
      code === 'RATE_LIMITED' ? 429 : 400
    )
  }

  return json(headers, { ok: true })
})