import type { Block, CreateListing, UpdateListing } from '@gear/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api, ok } from '../../lib/api';
import { pickPhoto, uploadPhoto } from '../../lib/photos';

const keys = {
  categories: ['categories'] as const,
  myListings: ['me', 'listings'] as const,
  locations: ['me', 'pickup-locations'] as const,
  listing: (id: string) => ['listings', id] as const,
  blocks: (id: string) => ['listings', id, 'blocks'] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => ok(api.v1.categories.$get()),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMyListings() {
  return useQuery({
    queryKey: keys.myListings,
    queryFn: () => ok(api.v1.me.listings.$get({ query: { limit: '50' } })),
  });
}

export function usePickupLocations() {
  return useQuery({
    queryKey: keys.locations,
    queryFn: () => ok(api.v1.me['pickup-locations'].$get({ query: { limit: '50' } })),
  });
}

export function useCreatePickupLocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { address: string; lat: number; lng: number; precision: '1km' | '5km' }) =>
      ok(api.v1.me['pickup-locations'].$post({ json: body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.locations }),
  });
}

// Polls while a photo waits for its check, so "Checking" turns into "Checked" on its own.
// Gives up after a minute: a check that slow has failed, and the owner can remove the photo.
export function useListing(id: string) {
  const pendingSince = useRef<number | null>(null);
  return useQuery({
    queryKey: keys.listing(id),
    queryFn: () => ok(api.v1.listings[':id'].$get({ param: { id } })),
    refetchInterval: (query) => {
      if (!query.state.data?.images.some((i) => !i.verified)) {
        pendingSince.current = null;
        return false;
      }
      pendingSince.current ??= Date.now();
      return Date.now() - pendingSince.current < 60_000 ? 2000 : false;
    },
  });
}

function useListingMutation<T, R>(id: string, fn: (vars: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.listing(id) });
      void client.invalidateQueries({ queryKey: keys.myListings });
    },
  });
}

export function useCreateListing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateListing) => ok(api.v1.listings.$post({ json: body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.myListings }),
  });
}

export function useUpdateListing(id: string) {
  return useListingMutation(id, (body: UpdateListing) =>
    ok(api.v1.listings[':id'].$patch({ param: { id }, json: body })),
  );
}

export function useStatusCommand(id: string) {
  return useListingMutation(id, (command: 'publish' | 'pause' | 'archive') => {
    const route = api.v1.listings[':id'];
    const call =
      command === 'publish' ? route.publish : command === 'pause' ? route.pause : route.archive;
    return ok(call.$post({ param: { id } }));
  });
}

// Pick, resize, get a signed URL, upload, then ask the API to queue the check.
export function useAddPhoto(id: string) {
  return useListingMutation(id, async () => {
    const uri = await pickPhoto();
    if (!uri) return;
    const upload = await ok(api.v1.listings[':id'].images.$post({ param: { id } }));
    const imageId = upload.image_id!;
    try {
      await uploadPhoto(upload.upload_url, uri);
      await ok(api.v1.listings[':id'].images[':imageId'].complete.$post({ param: { id, imageId } }));
    } catch (error) {
      // Do not leave a photo that will never be checked: it would count toward the limit.
      await api.v1.listings[':id'].images[':imageId'].$delete({ param: { id, imageId } }).catch(() => {});
      throw error;
    }
  });
}

export function useDeletePhoto(id: string) {
  return useListingMutation(id, async (imageId: string) => {
    const res = await api.v1.listings[':id'].images[':imageId'].$delete({
      param: { id, imageId },
    });
    if (!res.ok) await ok(Promise.resolve(res as never));
  });
}

export function useBlocks(id: string) {
  return useQuery({
    queryKey: keys.blocks(id),
    queryFn: () => ok(api.v1.listings[':id'].blocks.$get({ param: { id } })),
  });
}

export function usePutBlocks(id: string) {
  return useListingMutation(id, (blocks: Block[]) =>
    ok(api.v1.listings[':id'].blocks.$put({ param: { id }, json: { blocks } })),
  );
}
