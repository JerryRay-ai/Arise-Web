// Supabase Edge Function: share-story
// Public alumni-story submission gate. Delegates to the hardened submit_experience RPC.
//
// Deploy:  supabase functions deploy share-story --no-verify-jwt
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

  let fullName = ''
  let program = ''
  let phone = ''
  let experience = ''
  try {
    const body = await req.json()
    fullName = String(body.full_name ?? '').trim()
    program = String(body.program ?? '').trim()
    phone = String(body.phone ?? '').trim()
    experience = String(body.experience ?? '').trim()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
  }

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
