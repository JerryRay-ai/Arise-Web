// Shared CORS handling for the media edge functions.
// Allows any origin (reflects request Origin) so the web app works from any
// deployment domain (Vercel, localhost, Capacitor).

export function cors(req: Request): Headers {
  const origin = req.headers.get('origin') ?? '*'
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  })
}

export function json(headers: Headers, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers })
}
