import type { Block, Listing } from '@gear/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chip, ChipRow } from '../../components/Chip';
import { ErrorState, Loading, Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { ApiRequestError } from '../../lib/api';
import { conditionLabel, missingLabel, parseDollars, statusLabel } from './format';
import {
  useAddPhoto,
  useBlocks,
  useCategories,
  useDeletePhoto,
  useListing,
  usePickupLocations,
  usePutBlocks,
  useStatusCommand,
  useUpdateListing,
} from './queries';

const MAX_PHOTOS = 8; // G2.6

export function ListingScreen({ id }: { id: string }) {
  const listing = useListing(id);
  if (listing.isPending) return <Loading />;
  if (listing.isError) {
    return <ErrorState message="Could not load this listing." onRetry={() => listing.refetch()} />;
  }
  const l = listing.data;
  return (
    <Screen title={l.title}>
      <StatusSection listing={l} />
      <DetailsSection listing={l} />
      <CategorySection listing={l} />
      <PickupSection listing={l} />
      <PhotosSection listing={l} />
      <BlocksSection id={l.id} />
    </Screen>
  );
}

function errorText(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof ApiRequestError && error.body?.code === 'activation_refused') {
    const missing = (error.body.details as { missing?: string[] } | undefined)?.missing ?? [];
    return `Before publishing: ${missing.map((m) => missingLabel[m] ?? m).join(', ')}.`;
  }
  if (error instanceof ApiRequestError && error.body?.code === 'required_while_published') {
    const missing = (error.body.details as { missing?: string[] } | undefined)?.missing ?? [];
    const names = missing.map((m) => ({ category: 'category', price: 'price', pickup_location: 'pickup location' })[m] ?? m);
    return `A published listing needs its ${names.join(', ')}. Pause it first to remove it.`;
  }
  return error.message;
}

function Heading({ children }: { children: string }) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}

// G2.12: publish, pause, archive. Archive is final, so it asks twice.
function StatusSection({ listing }: { listing: Listing }) {
  const command = useStatusCommand(listing.id);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const { status } = listing;
  return (
    <View style={styles.section}>
      <Text style={styles.muted}>Status: {statusLabel[status]}</Text>
      {status === 'draft' || status === 'paused' ? (
        <Button
          title="Publish"
          busy={command.isPending}
          onPress={() => command.mutate('publish')}
        />
      ) : null}
      {status === 'active' ? (
        <Button
          title="Pause"
          variant="secondary"
          busy={command.isPending}
          onPress={() => command.mutate('pause')}
        />
      ) : null}
      {status !== 'archived' ? (
        <Button
          title={confirmArchive ? 'Tap again to archive for good' : 'Archive'}
          variant="secondary"
          onPress={() => {
            if (!confirmArchive) return setConfirmArchive(true);
            setConfirmArchive(false);
            command.mutate('archive');
          }}
        />
      ) : null}
      {command.isError ? <Text style={styles.error}>{errorText(command.error)}</Text> : null}
    </View>
  );
}

function DetailsSection({ listing }: { listing: Listing }) {
  const update = useUpdateListing(listing.id);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(
    listing.daily_price_cents ? (listing.daily_price_cents / 100).toFixed(2) : '',
  );
  const [deposit, setDeposit] = useState((listing.deposit_cents / 100).toFixed(2));
  const [condition, setCondition] = useState(listing.condition);

  const priceCents = price.trim() ? parseDollars(price) : null;
  const depositCents = parseDollars(deposit || '0');
  const priceError =
    price.trim() && (priceCents === null || priceCents === 0)
      ? 'Enter a price above zero, like 25 or 25.50'
      : undefined;
  const depositError = depositCents === null ? 'Enter an amount, like 100 or 0' : undefined;

  return (
    <View style={styles.section}>
      <Heading>Details</Heading>
      <TextField label="Title" value={title} onChangeText={setTitle} maxLength={100} />
      <TextField
        label="Description: what's included, sizes, specs"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={5000}
        style={styles.multiline}
      />
      <Text style={styles.label}>Condition</Text>
      <ChipRow>
        {(Object.keys(conditionLabel) as (keyof typeof conditionLabel)[]).map((c) => (
          <Chip
            key={c}
            label={conditionLabel[c]}
            selected={condition === c}
            onPress={() => setCondition(c)}
          />
        ))}
      </ChipRow>
      <TextField
        label="Price per day (CAD)"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={priceError}
      />
      <TextField
        label="Deposit (CAD). Settled between you and the renter; the app never charges it."
        value={deposit}
        onChangeText={setDeposit}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={depositError}
      />
      <Button
        title="Save details"
        busy={update.isPending}
        disabled={!title.trim() || !!priceError || !!depositError}
        onPress={() =>
          update.mutate({
            title: title.trim(),
            description: description.trim(),
            condition,
            daily_price_cents: priceCents,
            deposit_cents: depositCents ?? 0,
          })
        }
      />
      {update.isError ? <Text style={styles.error}>{errorText(update.error)}</Text> : null}
      {update.isSuccess ? <Text style={styles.muted}>Saved.</Text> : null}
    </View>
  );
}

function CategorySection({ listing }: { listing: Listing }) {
  const categories = useCategories();
  const update = useUpdateListing(listing.id);
  return (
    <View style={styles.section}>
      <Heading>Category</Heading>
      {categories.isPending ? <Loading /> : null}
      {categories.isError ? (
        <ErrorState message="Could not load categories." onRetry={() => categories.refetch()} />
      ) : null}
      <ChipRow>
        {categories.data?.categories.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            selected={listing.category_id === c.id}
            onPress={() => update.mutate({ category_id: c.id })}
          />
        ))}
      </ChipRow>
      {update.isError ? <Text style={styles.error}>{errorText(update.error)}</Text> : null}
    </View>
  );
}

function PickupSection({ listing }: { listing: Listing }) {
  const router = useRouter();
  const locations = usePickupLocations();
  const update = useUpdateListing(listing.id);
  return (
    <View style={styles.section}>
      <Heading>Pickup location</Heading>
      <Text style={styles.muted}>
        Tap the location to use for this listing. Renters see a spot near it, never the address.
      </Text>
      {locations.isPending ? <Loading /> : null}
      {locations.isError ? (
        <ErrorState message="Could not load your locations." onRetry={() => locations.refetch()} />
      ) : null}
      {locations.data?.pickup_locations.length === 0 ? (
        <Text style={styles.muted}>You have no pickup location yet.</Text>
      ) : null}
      <ChipRow>
        {locations.data?.pickup_locations.map((p) => (
          <Chip
            key={p.id}
            label={p.address}
            selected={listing.pickup_location_id === p.id}
            onPress={() => update.mutate({ pickup_location_id: p.id })}
          />
        ))}
      </ChipRow>
      <Button
        title="Add a pickup location"
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/pickup-locations/new', params: { listing: listing.id } })
        }
      />
      {update.isError ? <Text style={styles.error}>{errorText(update.error)}</Text> : null}
    </View>
  );
}

function PhotosSection({ listing }: { listing: Listing }) {
  const add = useAddPhoto(listing.id);
  const remove = useDeletePhoto(listing.id);
  const full = listing.images.length >= MAX_PHOTOS;
  return (
    <View style={styles.section}>
      <Heading>Photos</Heading>
      {listing.images.length === 0 ? (
        <Text style={styles.muted}>No photos yet. Listings need at least one checked photo.</Text>
      ) : null}
      <View style={styles.photos}>
        {listing.images.map((image) => (
          <View key={image.id} style={styles.photo}>
            <Image
              source={{ uri: image.url }}
              style={styles.thumb}
              accessibilityIgnoresInvertColors
            />
            <Text style={styles.small}>{image.verified ? 'Checked' : 'Checking…'}</Text>
            <Pressable accessibilityRole="button" onPress={() => remove.mutate(image.id)}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <Button
        title={full ? `${MAX_PHOTOS} photos at most` : 'Add a photo'}
        variant="secondary"
        busy={add.isPending}
        disabled={full}
        onPress={() => add.mutate(undefined)}
      />
      {add.isError ? <Text style={styles.error}>{add.error.message}</Text> : null}
      {remove.isError ? <Text style={styles.error}>{remove.error.message}</Text> : null}
    </View>
  );
}

// Dates are inclusive and typed as YYYY-MM-DD for now; step 3 decides on a calendar (G3.8).
function BlocksSection({ id }: { id: string }) {
  const blocks = useBlocks(id);
  if (blocks.isPending) return <Loading />;
  if (blocks.isError) {
    return (
      <ErrorState message="Could not load your blocked dates." onRetry={() => blocks.refetch()} />
    );
  }
  return <BlocksForm id={id} saved={blocks.data.blocks} />;
}

function BlocksForm({ id, saved }: { id: string; saved: Block[] }) {
  const put = usePutBlocks(id);
  const [rows, setRows] = useState<Block[]>(saved);
  const set = (i: number, field: keyof Block, value: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  return (
    <View style={styles.section}>
      <Heading>Blocked dates</Heading>
      <Text style={styles.muted}>Days the gear is not available. Both dates are included.</Text>
      {rows.length === 0 ? <Text style={styles.muted}>No blocked dates.</Text> : null}
      {rows.map((row, i) => (
        <View key={i} style={styles.blockRow}>
          <View style={styles.grow}>
            <TextField
              label="From"
              value={row.start}
              onChangeText={(v) => set(i, 'start', v)}
              placeholder="2027-01-10"
            />
          </View>
          <View style={styles.grow}>
            <TextField
              label="To"
              value={row.end}
              onChangeText={(v) => set(i, 'end', v)}
              placeholder="2027-01-12"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Button
        title="Add dates"
        variant="secondary"
        onPress={() => setRows([...rows, { start: '', end: '' }])}
      />
      <Button
        title="Save blocked dates"
        busy={put.isPending}
        onPress={() => put.mutate(rows, { onSuccess: (r) => setRows(r.blocks) })}
      />
      {put.isError ? (
        <Text style={styles.error}>
          {put.error instanceof ApiRequestError && put.error.status === 409
            ? 'Two date ranges overlap.'
            : put.error instanceof ApiRequestError && put.error.status === 400
              ? 'Use dates like 2027-01-10, with the end on or after the start.'
              : put.error.message}
        </Text>
      ) : null}
      {put.isSuccess ? <Text style={styles.muted}>Saved.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.space.sm, paddingTop: theme.space.md },
  heading: { fontSize: theme.font.body, fontWeight: '700', color: theme.color.text },
  label: { fontSize: theme.font.small, color: theme.color.muted },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  small: { color: theme.color.muted, fontSize: theme.font.small },
  error: { color: theme.color.danger },
  multiline: { minHeight: 120, paddingVertical: theme.space.sm, textAlignVertical: 'top' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
  photo: { width: 96, gap: theme.space.xs },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
  },
  remove: {
    color: theme.color.danger,
    fontSize: theme.font.small,
    paddingVertical: theme.space.xs,
  },
  blockRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'flex-end' },
  grow: { flex: 1 },
});

