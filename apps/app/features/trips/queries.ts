import type { AddTripItem, CreateTrip } from '@gear/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ok } from '../../lib/api';

const keys = {
  all: ['trips'] as const,
  list: ['trips', 'list'] as const,
  trip: (id: string | undefined) => ['trips', id] as const,
};

export function useTrips() {
  return useInfiniteQuery({
    queryKey: keys.list,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      ok(
        api.v1.trips.$get({
          query: { limit: '20', ...(pageParam ? { cursor: pageParam } : {}) },
        }),
      ),
    getNextPageParam: (page) => page.next_cursor,
  });
}

// Marks are computed on each read (R4.7), so opening the screen always reads again.
export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: keys.trip(id),
    enabled: !!id,
    queryFn: () => ok(api.v1.trips[':id'].$get({ param: { id: id! } })),
    refetchOnMount: 'always',
  });
}

export function useCreateTrip() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTrip) => ok(api.v1.trips.$post({ json: body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useAddTripItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, ...body }: AddTripItem & { tripId: string }) =>
      ok(api.v1.trips[':id'].items.$post({ param: { id: tripId }, json: body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useRemoveTripItem(tripId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await api.v1.trips[':id'].items[':itemId'].$delete({
        param: { id: tripId, itemId },
      });
      if (!res.ok) await ok(Promise.resolve(res as never));
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}
