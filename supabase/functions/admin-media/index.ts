// Supabase Edge Function: admin-media
// Admin-only helper for external S3-compatible object storage (Backblaze B2 /
// R2). The client can no longer sign or delete objects directly (it has no
// S3 credentials), so this function — gated by is_admin() — mints short-lived
// presigned GET URLs for passport thumbnails / certificate views and deletes
// objects on revoke.
//
//   { "action": "sign",       "key": "<object-key>" }            -> { url }
//   { "action": "sign_cert",  "key": "<object-key>",
//                              "download": "name.pdf" }          -> { url }
//   { "action": "delete",     "key": "<object-key>" }            -> { ok }
//
// Deploy:  supabase functions deploy admin-media
// Secrets: SUPABASE_URL / SUPABASE_ANON_KEY injected automatically.
//          ALLOWED_ORIGINS (optional): comma-separated browser origins.
//          S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { presignGet, deleteObject } from '../_shared/s3.ts'

const SIGNED_URL_TTL = 60 * 60 // 1 hour

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json(headers, { error: 'Method not allowed' }, 405)

  // Only allowlisted admins may sign or delete media.
  const authHeader = req.headers.get('authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
  const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin')
  if (adminErr || !isAdmin) {
    return json(headers, { error: 'Not authorized' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(headers, { error: 'Invalid request body' }, 400)
  }

  const action = String(body.action ?? '')
  const key = String(body.key ?? '').trim()
  if (!key) return json(headers, { error: 'key is required' }, 400)

  if (action === 'sign' || action === 'sign_cert') {
    const download = action === 'sign_cert' && typeof body.download === 'string' && body.download
      ? body.download
      : undefined
    try {
      const url = await presignGet(key, SIGNED_URL_TTL, download)
      return json(headers, { url, expires_in: SIGNED_URL_TTL })
    } catch {
      return json(headers, { error: 'Could not sign the file' }, 500)
    }
  }

  if (action === 'delete') {
    try {
      await deleteObject(key)
      return json(headers, { ok: true })
    } catch {
      return json(headers, { error: 'Could not delete the file' }, 500)
    }
  }

  return json(headers, { error: 'Unknown action' }, 400)
})