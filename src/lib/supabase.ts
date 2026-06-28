import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env.local and fill in your Supabase credentials.'
  )
}

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost',
  anonKey ?? 'public-anon-key',
  {
    auth: { persistSession: false },
  }
)
