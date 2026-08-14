// Supabase Edge Function: certificate
// The ONLY place the private certificate objects are signed, served from
// external S3-compatible storage (Backblaze B2 / R2).
// It re-proves the caller's phone + registration number against the row,
// then hands back a short-lived (5-minute) presigned URL. The service-role
// key lives here as a function secret and never reaches the browser.
//
// Deploy:  supabase functions deploy certificate
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform — no manual setup needed.
//          S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET:
//          S3-compatible object storage credentials.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { presignGet } from '../_shared/s3.ts'

const SIGNED_URL_TTL = 60 * 5 // 5 minutes

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

  // Rate limit per registration number: 20 download requests / 5 minutes.
  const { data: allowed, error: rlErr } = await admin.rpc('rate_limit_try', {
    p_key: `cert:${reg}`,
    p_limit: 20,
    p_window_seconds: 300,
  })
  if (rlErr || allowed !== true) {
    return json(headers, { error: 'Too many attempts. Please wait a few minutes.' }, 429)
  }

  // Re-verify identity: registration number is unique, so fetch that row
  // and confirm the phone matches (compared on digits only).
  const digits = (s: string) => s.replace(/\D/g, '')
  const { data: row, error: qErr } = await admin
    .from('candidates')
    .select('id, certificate_url, is_verified, phone')
    .eq('registration_number', reg)
    .maybeSingle()

  if (qErr) return json(headers, { error: 'Lookup failed' }, 500)
  if (!row || !row.phone || digits(row.phone) !== digits(phone)) {
    return json(headers, { error: 'No matching record' }, 404)
  }
  if (!row.is_verified || !row.certificate_url) {
    return json(headers, { error: 'Certificate not issued yet' }, 409)
  }

  // Certificates are stored as `{candidate_id}.pdf` in the object store.
  // The download name makes the browser save it as an attachment instead of
  // rendering it inline.
  const objectPath = `${row.id}.pdf`
  const safeReg = reg.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const downloadName = `ARISE-Certificate-${safeReg || row.id}.pdf`

  let url: string
  try {
    url = await presignGet(objectPath, SIGNED_URL_TTL, downloadName)
  } catch {
    return json(headers, { error: 'Could not sign certificate' }, 500)
  }

  return json(headers, { url, expires_in: SIGNED_URL_TTL })
})