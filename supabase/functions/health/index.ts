// Supabase Edge Function: health
// Read-only heartbeat for uptime/error monitoring. Verifies the database is
// reachable, the core tables and buckets exist, and the key write paths are
// still callable. Returns 200 + a status map on success, or 503 with a
// breakdown when something is wrong.
//
// Deploy:  supabase functions deploy health --no-verify-jwt
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform — no manual setup needed.
//          ALLOWED_ORIGINS (optional): comma-separated browser origins.

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  if (req.method !== 'GET') return json(headers, { error: 'Method not allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const checks: Record<string, string> = {}

  // 1. Database connectivity + RLS registration RPC (write path).
  try {
    const { data, error } = await admin.rpc('rate_limit_try', {
      p_key: `health:${Date.now()}`,
      p_limit: 1,
      p_window_seconds: 60,
    })
    checks.database = error ? 'error' : data === true ? 'ok' : 'error'
  } catch {
    checks.database = 'error'
  }

  // 2. Core tables exist and are readable via RLS-bypassing service role.
  for (const table of ['candidates', 'experiences', 'security_alerts']) {
    try {
      const { error } = await admin.from(table).select('id').limit(1)
      checks[`table.${table}`] = error ? 'error' : 'ok'
    } catch {
      checks[`table.${table}`] = 'error'
    }
  }

  // 3. Storage buckets exist (even when empty, the bucket row is present).
  try {
    const { data, error } = await admin.storage.listBuckets()
    const ids = (data ?? []).map((b) => b.id)
    checks['bucket.passports'] = ids.includes('passports') ? 'ok' : 'missing'
    checks['bucket.certificates'] = ids.includes('certificates') ? 'ok' : 'missing'
    if (error) {
      checks['bucket.passports'] = 'error'
      checks['bucket.certificates'] = 'error'
    }
  } catch {
    checks['bucket.passports'] = 'error'
    checks['bucket.certificates'] = 'error'
  }

  const degraded = Object.entries(checks).some(([, v]) => v !== 'ok')
  return json(
    headers,
    {
      status: degraded ? 'degraded' : 'ok',
      checked_at: new Date().toISOString(),
      checks,
    },
    degraded ? 503 : 200
  )
})