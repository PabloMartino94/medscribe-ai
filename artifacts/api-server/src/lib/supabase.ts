import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const publishableKey =
  process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];

if (!url) {
  throw new Error("SUPABASE_URL must be set (see .env.example).");
}

if (!publishableKey) {
  throw new Error(
    "SUPABASE_PUBLISHABLE_KEY must be set (the publishable/anon key, see .env.example).",
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_PUBLISHABLE_KEY = publishableKey;

/** Bucket holding consultation recordings. Private; read only via signed URLs. */
export const RECORDINGS_BUCKET = "recordings";

/**
 * A client bound to one request's access token.
 *
 * Everything the API does on the physician's behalf goes through this client,
 * never the service-role key, so Postgres RLS is the last line of defence: a
 * mistake in a query still cannot reach another physician's rows.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(url!, publishableKey!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Anonymous client, used only to validate an access token. */
const authClient = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export type AuthenticatedUser = {
  id: string;
  email: string;
  fullName: string | null;
};

/**
 * Validate an access token against the Supabase Auth API.
 *
 * This costs one round trip per request rather than verifying the JWT locally,
 * which is the deliberate trade: it honours revoked sessions and deleted users
 * immediately, and it works whether the project signs tokens with a symmetric
 * secret or an asymmetric key. The AI calls that follow dominate the latency.
 */
export async function verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;

  const meta = data.user.user_metadata as Record<string, unknown> | null;
  const fullName = typeof meta?.["full_name"] === "string" ? meta["full_name"] : null;

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    fullName: fullName || null,
  };
}
