// Lightweight draft persistence so long forms (public registration, the admin
// Add Student modal) survive a page reload, browser crash, or Android killing
// the WebView while the native camera is open. Drafts live in localStorage —
// which survives process death — and are cleared once the form is submitted or
// abandoned. Photo captures are stored as small data URLs.

const DRAFT_PREFIX = 'arise.draft.'

export function saveDraft(key: string, data: Record<string, unknown>): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(data))
  } catch {
    /* storage full / unavailable — resume just won't be available */
  }
}

export function loadDraft<T = Record<string, unknown>>(key: string): T | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key)
  } catch {
    /* ignore */
  }
}

// Rehydrate a captured photo saved as a data URL back into a File so the
// restored form can submit it without asking the user to re-shoot.
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const bin = atob(b64 ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}