import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { config } from './config';
import { chunkedSecureStorage } from './secure-storage';

// The app uses Supabase directly for sign-in only (and later uploads and realtime).
// It never queries a table.
export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    // Web keeps the browser's default storage; iOS and Android use SecureStore.
    storage: Platform.OS === 'web' ? undefined : chunkedSecureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});
