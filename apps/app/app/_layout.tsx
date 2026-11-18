import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../lib/query';
import { SessionProvider, useSession } from '../lib/session';
import { Loading } from '../components/Screen';

function Routes() {
  const { session, loading } = useSession();
  if (loading) return <Loading />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="listings/new" />
        <Stack.Screen name="listings/[id]" />
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
