import type { UpdateMe } from '@gear/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ok } from '../../lib/api';
import { pickPhoto, uploadPhoto } from '../../lib/photos';

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

// G2.14: pick, resize, upload to a signed URL, queue the check, then wait for the result.
// Resolves true when the new avatar passed the check, false when it was refused.
export function useUploadAvatar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<boolean | null> => {
      const uri = await pickPhoto();
      if (!uri) return null;
      const upload = await ok(api.v1.me.avatar.$post());
      await uploadPhoto(upload.upload_url, uri);
      await ok(api.v1.me.avatar.complete.$post());
      const before = client.getQueryData<{ avatar_url: string | null }>(meKey)?.avatar_url ?? null;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const me = await ok(api.v1.me.$get());
        client.setQueryData(meKey, me);
        if (!me.avatar_pending) return me.avatar_url !== before;
      }
      return false;
    },
  });
}
