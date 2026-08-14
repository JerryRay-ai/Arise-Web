// Minimal AWS SigV4 client for S3-compatible object storage (Backblaze B2,
// Cloudflare R2, etc.). Shared by the media edge functions.
//
// NOTE (B2 quirk): B2 rejects signatures that include the `content-type`
// header, so it is always sent unsigned. Signed headers are limited to
// `host;x-amz-content-sha256;x-amz-date`.
//
// Config comes from function secrets:
//   S3_ENDPOINT            e.g. https://s3.us-east-005.backblazeb2.com
//   S3_ACCESS_KEY_ID       B2 application key ID / R2 access key ID
//   S3_SECRET_ACCESS_KEY   B2 application key / R2 secret access key
//   S3_BUCKET              bucket name (private)

export function s3Config() {
  const endpoint = (Deno.env.get('S3_ENDPOINT') ?? '').replace(/\/+$/, '')
  if (!endpoint) throw new Error('S3_ENDPOINT is not set')
  const accessKey = Deno.env.get('S3_ACCESS_KEY_ID') ?? ''
  const secret = Deno.env.get('S3_SECRET_ACCESS_KEY') ?? ''
  const bucket = Deno.env.get('S3_BUCKET') ?? ''
  if (!accessKey || !secret || !bucket) throw new Error('S3 credentials are not set')
  // B2 endpoints are s3.<region>.backblazeb2.com; R2 uses "auto".
  const region = /^s3\.[a-z0-9-]+\.backblazeb2\.com$/i.test(endpoint)
    ? endpoint.replace(/^s3\./, '').replace(/\.backblazeb2\.com$/i, '')
    : 'auto'
  return { endpoint, accessKey, secret, bucket, region }
}

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// WebCrypto types (BufferSource) are picky about Uint8Array generics; a fresh
// copy is backed by an exact-size ArrayBuffer and satisfies both TS and Deno.
function ab(buf: Uint8Array): ArrayBuffer {
  return new Uint8Array(buf).buffer
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', ab(data))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    ab(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', k, ab(bytesOf(data)))
  return new Uint8Array(sig)
}

async function hmacHex(key: Uint8Array, data: string): Promise<string> {
  return [...(await hmac(key, data))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type S3SignOpts = {
  method: string
  key: string
  query?: Record<string, string>
  body?: Uint8Array
  signBodyHash?: boolean
}

// Builds the Authorization header (or the presign query seed) for a request.
// When `presign` is set, returns the query parameters instead of a header.
export async function signRequest(
  cfg: ReturnType<typeof s3Config>,
  opts: S3SignOpts,
  presign?: { expiresSeconds: number }
): Promise<{ headers: Record<string, string>; auth: string; query: string }> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const body = opts.body ?? new Uint8Array()
  const payloadHash = presign ? 'UNSIGNED-PAYLOAD' : opts.signBodyHash === false ? EMPTY_HASH : await sha256Hex(body)
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`

  const headerNames = ['host']
  const headerVals: Record<string, string> = {
    host: cfg.endpoint,
  }
  if (!presign) {
    headerVals['x-amz-content-sha256'] = payloadHash
    headerVals['x-amz-date'] = amzDate
    headerNames.push('x-amz-date', 'x-amz-content-sha256')
  }
  headerNames.sort()

  const canonicalHeaders = headerNames.map((h) => `${h}:${headerVals[h]}\n`).join('')
  const signedHeaders = headerNames.join(';')

  const query = { ...(opts.query ?? {}) }
  const qEntries: [string, string][] = []
  if (presign) {
    qEntries.push(
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${cfg.accessKey}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(presign.expiresSeconds)],
      ['X-Amz-SignedHeaders', signedHeaders]
    )
  }
  for (const [k, v] of Object.entries(query)) qEntries.push([k, v])
  const enc = (s: string) => encodeURIComponent(s).replace(/%7E/g, '~')
  const canonicalQuery = qEntries
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&')

  const canonicalUri = `/${cfg.bucket}/${encodeURIComponent(opts.key)}`.replace(/\/+/g, '/').replace(/\/(?=$)/, '') || '/'
  const canonicalRequest = [opts.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(bytesOf(canonicalRequest))].join('\n')

  const kDate = await hmac(bytesOf('AWS4' + cfg.secret), dateStamp)
  const kRegion = await hmac(kDate, cfg.region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = await hmacHex(kSigning, stringToSign)

  if (presign) {
    const sigQuery = [...qEntries, ['X-Amz-Signature', signature] as [string, string]]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${enc(k)}=${enc(v)}`)
      .join('&')
    return { headers: {}, auth: '', query: sigQuery }
  }

  const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { headers: { ...headerVals }, auth, query: canonicalQuery }
}

async function request(
  cfg: ReturnType<typeof s3Config>,
  method: string,
  key: string,
  opts: { query?: Record<string, string>; body?: Uint8Array; contentType?: string } = {}
): Promise<Response> {
  const { headers, auth } = await signRequest(cfg, {
    method,
    key,
    query: opts.query,
    body: opts.body,
  })
  const send: Record<string, string> = { authorization: auth, ...headers }
  if (opts.contentType) send['content-type'] = opts.contentType
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : ''
  return fetch(`https://${cfg.endpoint}/${cfg.bucket}/${key}${qs}`, {
    method,
    headers: send,
    body: opts.body as BodyInit,
  })
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await request(s3Config(), 'PUT', key, { body, contentType })
  if (!res.ok) throw new Error(`Storage put failed (${res.status})`)
}

export async function deleteObject(key: string): Promise<void> {
  const res = await request(s3Config(), 'DELETE', key)
  if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`)
}

export async function presignGet(
  key: string,
  expiresSeconds: number,
  downloadName?: string
): Promise<string> {
  const cfg = s3Config()
  const query: Record<string, string> = {}
  if (downloadName) {
    query['response-content-disposition'] = `attachment; filename="${downloadName.replace(/["\\]/g, '')}"`
  }
  const { query: sigQuery } = await signRequest(cfg, { method: 'GET', key, query }, { expiresSeconds })
  return `https://${cfg.endpoint}/${cfg.bucket}/${encodeURIComponent(key)}?${sigQuery}`
}
