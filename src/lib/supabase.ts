import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazily-created browser client — anon key only, bound to Row Level Security.
// The service-role key is NEVER shipped here; privileged work (signing private
// certificate downloads) lives in the `certificate` Edge Function.
//
// It is created on first use (not at import) so the public landing page still
// renders even before Supabase env vars are configured — only the portal
// pages surface a friendly "not configured" message.
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!url || !anonKey) {
    throw new Error(
      'Portal is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file, then restart the dev server.'
    )
  }

  client = createClient(url, anonKey)
  return client
}
