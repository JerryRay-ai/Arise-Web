// Shared CORS handling for the media edge functions. Honors the
// ALLOWED_ORIGINS secret (comma-separated browser origins).
//
// Production defaults are ONLY the origins the shipped Android app needs
// (Capacitor WebView). Plain http://localhost dev origins are NOT included
// by default any more — while developing locally, add them yourself:
//   supabase secrets set ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
// When ALLOWED_ORIGINS contains `*` every origin is allowed — a dev
// convenience that MUST be removed before going live.

const DEFAULT_ORIGINS = ['https://localhost', 'capacitor://localhost']

export function cors(req: Request): Headers {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? ''
  const extra = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const origins = [...new Set([...DEFAULT_ORIGINS, ...extra])]
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

export function json(headers: Headers, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers })
}