import type { UpdateMe } from '@gear/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ok } from '../../lib/api';

const meKey = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => ok(api.v1.me.$get()) });
}

export function useUpdateMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMe) => ok(api.v1.me.$patch({ json: body })),
    onSuccess: (me) => client.setQueryData(meKey, me),
  });
}

// Asks the API to copy the phone confirmation from Supabase Auth (R1.11).
export function useConfirmPhone() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => ok(api.v1.me.phone.$post()),
    onSuccess: (me) => client.setQueryData(meKey, me),
  });
}
