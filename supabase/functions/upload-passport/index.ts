// Supabase Edge Function: upload-passport
// Server-side validated passport photo upload. The anonymous role has NO
// access to write the object store directly — every photo goes through here
// so file type (magic bytes) and size are enforced on the server, then the
// photo is stored on external S3-compatible storage (Backblaze B2 / R2).
// Returns the object KEY (not a public URL), which the registration /
// add-student RPCs then validate and store.
//
// Deploy:  supabase functions deploy upload-passport
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform — no manual setup needed.
//          ALLOWED_ORIGINS (optional): comma-separated browser origins that
//          may call this function (defaults to localhost dev).
//          S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET:
//          S3-compatible object storage credentials (Backblaze B2, R2, ...).

import { cors, json } from '../_shared/cors.ts'
import { putObject } from '../_shared/s3.ts'

const MAX_BYTES = (3 * 1024 * 1024) / 2 // 1.5 MB — mirrors PASSPORT_MAX_BYTES client-side

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isPng(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < sig.length) return false
  return sig.every((b, i) => bytes[i] === b)
}

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  if (req.method !== 'POST') {
    return json(headers, { error: 'Method not allowed' }, 405)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(headers, { error: 'Invalid upload' }, 400)
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return json(headers, { error: 'A photo file is required' }, 400)
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return json(headers, { error: 'Photo must be JPEG or PNG and no larger than 1.5MB' }, 400)
  }

  const mime = file.type === 'image/jpeg' || file.type === 'image/png' ? file.type : ''
  if (!mime) {
    return json(headers, { error: 'Only JPEG or PNG images are allowed' }, 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const looksLikeImage = mime === 'image/png' ? isPng(bytes) : isJpeg(bytes)
  if (!looksLikeImage) {
    return json(headers, { error: 'The file does not look like a valid image' }, 400)
  }

  const ext = mime === 'image/png' ? 'png' : 'jpg'
  const path = `${crypto.randomUUID()}.${ext}`

  try {
    await putObject(path, bytes, mime)
  } catch {
    return json(headers, { error: 'Upload failed. Please try again.' }, 500)
  }

  return json(headers, { path })
})