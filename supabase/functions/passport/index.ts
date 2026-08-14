// Supabase Edge Function: passport
// Returns a short-lived presigned URL for a candidate's passport photo,
// served from external S3-compatible storage (Backblaze B2 / R2).
// Re-proves the caller's phone + registration number against the row
// (the same hardening as the `certificate` function) before signing, so
// the photo is only ever revealed to someone holding both credentials.
// The object store is private; students never read it directly.
//
// Deploy:  supabase functions deploy passport
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform — no manual setup needed.
//          ALLOWED_ORIGINS (optional): comma-separated browser origins.
//          S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET:
//          S3-compatible object storage credentials.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { presignGet } from '../_shared/s3.ts'

const SIGNED_URL_TTL = 60 * 5 // 5 minutes

const digits = (s: string) => s.replace(/\D/g, '')

// Keys must be minted from the object path inside the bucket. Some legacy
// rows stored a full public URL, so strip any prefix down to the path.
const passportPath = (url: string): string => {
  const marker = '/passports/'
  const i = url.indexOf(marker)
  return i >= 0 ? url.slice(i + marker.length) : url
}

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  if (req.method !== 'POST') {
    return json(headers, { error: 'Method not allowed' }, 405)
  }

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

  // Rate limit per registration number: 20 photo lookups / 5 minutes.
  const { data: allowed, error: rlErr } = await admin.rpc('rate_limit_try', {
    p_key: `photo:${reg}`,
    p_limit: 20,
    p_window_seconds: 300,
  })
  if (rlErr || allowed !== true) {
    return json(headers, { error: 'Too many attempts. Please wait a few minutes.' }, 429)
  }

  // Re-verify identity: registration number is unique, so fetch that row
  // and confirm the phone matches (compared on digits only).
  const { data: row, error: qErr } = await admin
    .from('candidates')
    .select('id, passport_url, phone')
    .eq('registration_number', reg)
    .maybeSingle()
  if (qErr) return json(headers, { error: 'Lookup failed' }, 500)
  if (!row || !row.phone || digits(row.phone) !== digits(phone) || !row.passport_url) {
    return json(headers, { error: 'No matching record' }, 404)
  }

  let url: string
  try {
    url = await presignGet(passportPath(row.passport_url), SIGNED_URL_TTL)
  } catch {
    return json(headers, { error: 'Could not prepare the photo' }, 500)
  }

  return json(headers, { url, expires_in: SIGNED_URL_TTL })
})