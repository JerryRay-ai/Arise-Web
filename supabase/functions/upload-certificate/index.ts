// Supabase Edge Function: upload-certificate
// Admin-only certificate upload. Validates that the caller is an allowlisted
// admin (is_admin()), checks the file is a real PDF under 5MB, then stores it
// on external S3-compatible storage (Backblaze B2 / R2) at `{candidate_id}.pdf`.
// Returns the object key; the caller then runs the admin_issue_certificate RPC
// (which no longer checks Supabase storage — the file existence is proven here).
//
// Deploy:  supabase functions deploy upload-certificate
// Secrets: SUPABASE_URL / SUPABASE_ANON_KEY injected automatically.
//          ALLOWED_ORIGINS (optional): comma-separated browser origins.
//          S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { putObject } from '../_shared/s3.ts'

const MAX_BYTES = 5 * 1024 * 1024

function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false
  const head = new TextDecoder().decode(bytes.subarray(0, 5))
  return head === '%PDF-'
}

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json(headers, { error: 'Method not allowed' }, 405)

  // Only allowlisted admins may upload certificates.
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

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(headers, { error: 'Invalid upload' }, 400)
  }

  const candidateId = String(form.get('candidate_id') ?? '').trim()
  const file = form.get('file')
  if (!candidateId) {
    return json(headers, { error: 'candidate_id is required' }, 400)
  }
  if (!(file instanceof File)) {
    return json(headers, { error: 'A PDF file is required' }, 400)
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return json(headers, { error: 'Certificate must be a PDF no larger than 5MB' }, 400)
  }
  if (file.type !== 'application/pdf') {
    return json(headers, { error: 'Only PDF files are allowed' }, 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!isPdf(bytes)) {
    return json(headers, { error: 'The file does not look like a valid PDF' }, 400)
  }

  const path = `${candidateId}.pdf`
  try {
    await putObject(path, bytes, 'application/pdf')
  } catch {
    return json(headers, { error: 'Upload failed. Please try again.' }, 500)
  }

  return json(headers, { path })
})