
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Define a safe client interface to prevent crashes if env vars are missing
let supabase: SupabaseClient | null = null;

// Helper to safely access env vars in a Vite environment
const getViteEnv = (key: string) => {
  // @ts-ignore
  const envValue = import.meta.env?.[key];
  console.log(`NZERP Debug: getViteEnv('${key}') returned:`, envValue); // Debugging log
  return envValue;
};

let SUPABASE_URL = getViteEnv('VITE_SUPABASE_URL');
let SUPABASE_ANON_KEY = getViteEnv('VITE_SUPABASE_ANON_KEY');

// NZERP Fallback: Use hardcoded values if environment variables are not properly loaded.
// This is a temporary measure to ensure functionality given persistent env var issues.
// For production, ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are correctly configured.
if (!SUPABASE_URL) {
  SUPABASE_URL = 'https://ipehorttsrvjynnhyzhu.supabase.co';
  console.warn('NZERP WARNING: VITE_SUPABASE_URL not found, using hardcoded fallback URL.');
}
if (!SUPABASE_ANON_KEY) {
  SUPABASE_ANON_KEY = 'sb_publishable_eEjkCcpecmcZFOt_DiCBOA_RiDQNkEX';
  console.warn('NZERP WARNING: VITE_SUPABASE_ANON_KEY not found, using hardcoded fallback key.');
}

export const initSupabase = (): SupabaseClient | null => {
  console.log('NZERP INFO: initSupabase called.'); // Log de entrada
  if (supabase) {
    console.log('NZERP INFO: Supabase client already initialized and available.');
    return supabase;
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error(
        'NZERP CRITICAL: Supabase Environment Variables are still missing or invalid even after fallback. Cannot initialize Supabase client.'
      );
      supabase = null; // Garante que é null
      return null;
    }

    console.log('NZERP INFO: Attempting to create Supabase client with URL:', SUPABASE_URL, 'and ANON KEY:', SUPABASE_ANON_KEY ? '***** (present)' : 'MISSING');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    console.log('NZERP INFO: Supabase client created successfully.');
    supabase = client;
    return supabase;
  } catch (error) {
    console.error('NZERP CRITICAL: Failed to create Supabase client during initSupabase:', error);
    supabase = null; // Garante que é null em caso de falha
    return null;
  }
};

export const supabaseClient = initSupabase();

// Helper to check connection status
export const isOnline = (): boolean => !!supabaseClient;
