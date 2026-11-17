import { supabase } from '../../lib/supabase';

// Email: a 6-digit code, no password and no link (G1.7).
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
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
