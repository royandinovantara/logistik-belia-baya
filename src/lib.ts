import { createClient } from '@supabase/supabase-js';

const u = import.meta.env.VITE_SUPABASE_URL;
const k = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const ready = !!u && !!k && !u.includes('YOUR_PROJECT') && !k.includes('YOUR_SUPABASE');

const getTabId = () => {
  const key = 'lb-tab-id';
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(key, id);
  }
  return id;
};

export const db = ready ? createClient(u!, k!, {
  auth: {
    storage: window.sessionStorage,
    storageKey: `lb-auth-${getTabId()}`,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
}) : null;
