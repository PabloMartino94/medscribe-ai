import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@workspace/api-client-react';

let client: SupabaseClient | null = null;

/**
 * Creates the browser auth client from configuration the API serves at runtime.
 *
 * Fetching it instead of inlining it at build time keeps the Supabase project
 * and key out of the bundle, and lets either change without rebuilding the
 * frontend. Called once during bootstrap, before anything renders.
 */
export async function initSupabase(): Promise<SupabaseClient> {
  if (client) return client;

  const config = await getRuntimeConfig();

  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'medscribe-auth',
    },
  });

  return client;
}

/**
 * The initialised client. Only used for authentication — every read and write
 * of clinical data goes through our own API, which re-checks the token and
 * relies on RLS.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error('getSupabase() called before initSupabase() resolved');
  }
  return client;
}
