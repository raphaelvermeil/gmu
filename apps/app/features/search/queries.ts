import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { api, ok } from '../../lib/api';

export type Filters = {
  q: string;
  category: string | null;
  range: { from: string; to: string } | null;
  sort: 'distance' | 'price';
};

// G3.5: the device's location; null when the renter denies it. Never log it.
export function useOrigin(enabled = true) {
  return useQuery({
    queryKey: ['device-location'],
    enabled,
    queryFn: async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: coords.latitude, lng: coords.longitude };
    },
    staleTime: Infinity,
    retry: false,
  });
}

export function useSearch(origin: { lat: number; lng: number } | null | undefined, f: Filters) {
  return useInfiniteQuery({
    queryKey: ['search', origin, f],
    enabled: !!origin,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      ok(
        api.v1.listings.$get({
          query: {
            lat: String(origin!.lat),
            lng: String(origin!.lng),
            radius_km: '25', // G3.1
            limit: '30',
            sort: f.sort,
            ...(f.q ? { q: f.q } : {}),
            ...(f.category ? { category: f.category } : {}),
            ...(f.range ?? {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (page) => page.next_cursor,
  });
}

export function useAvailability(id: string, from: string, to: string) {
  return useQuery({
    queryKey: ['availability', id, from, to],
    queryFn: () =>
      ok(api.v1.listings[':id'].availability.$get({ param: { id }, query: { from, to } })),
  });
}
