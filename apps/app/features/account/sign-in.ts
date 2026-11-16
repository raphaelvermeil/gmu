import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

// Email: a 6-digit code, no password and no link (G1.7).
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

// Apple and Google: browser OAuth on every platform (G1.7).
export async function signInWithProvider(provider: 'apple' | 'google'): Promise<void> {
  if (Platform.OS === 'web') {
    // A full-page redirect; supabase-js picks the code up from the URL on return.
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return;
  }

  const redirectTo = Linking.createURL('/');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // the person closed the browser
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new Error('Sign-in did not return a code');
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) throw exchanged.error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Phone verification (G1.2): Supabase Auth sends and checks the code.
export async function sendPhoneCode(phone: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ phone });
  if (error) throw error;
}

export async function verifyPhoneCode(phone: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'phone_change' });
  if (error) throw error;
}
