import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../lib/query';
import { SessionProvider, useSession } from '../lib/session';

function Routes() {
  const { session, loading } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="listings/[id]/index" />
      {/* Open while the session loads, so a deep link to a signed-in screen survives. */}
      <Stack.Protected guard={loading || !!session}>
        <Stack.Screen name="my-listings" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="listings/new" />
        <Stack.Screen name="listings/[id]/edit" />
        <Stack.Screen name="pickup-locations/new" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Routes />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
