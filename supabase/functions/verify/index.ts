// Supabase Edge Function: verify
// Public certificate-lookup gate. Delegates to the hardened verify_candidate RPC.
//
// Deploy:  supabase functions deploy verify --no-verify-jwt
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function cors(req: Request): Headers {
  const origin = req.headers.get('origin') ?? '*'
  return new Headers({
    'Access-Control-Allow-Origin': origin,
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
  try {
    const body = await req.json()
    phone = String(body.phone ?? '').trim()
    reg = String(body.registration_number ?? '').trim()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
  }

  if (!phone || !reg) {
    return json(headers, { error: 'Phone number and registration number are required' }, 400)
  }

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
