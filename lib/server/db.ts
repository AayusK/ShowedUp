import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client. It uses the project's secret key, which bypasses row-level
// security; the tables have RLS on with no public policies, so browsers can't reach them.
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Page through a consistently ordered query without hitting PostgREST's per-response row limit. */
export async function readPages<T>(
  read: (first: number, last: number) => PromiseLike<{ data: T[] | null; error: { code: string; message: string } | null }>,
) {
  const data: T[] = [];
  const size = 250;
  for (let first = 0; ; first += size) {
    const page = await read(first, first + size - 1);
    if (page.error) return { data, error: page.error };
    data.push(...(page.data ?? []));
    if (!page.data || page.data.length < size) return { data, error: null };
  }
}
