// Expo inlines EXPO_PUBLIC_* at build time, so each must be read by its full name.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. See apps/app/.env.example.`);
  return value;
}

export const config = {
  apiUrl: required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: required(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
};
