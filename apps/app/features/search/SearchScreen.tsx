import { todayInToronto, type SearchResult } from '@gear/shared';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Chip, ChipRow } from '../../components/Chip';
import { DateRangePicker } from '../../components/DateRangePicker';
import { ErrorState, Loading } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { useSession } from '../../lib/session';
import { formatCents } from '../listings/format';
import { useCategories } from '../listings/queries';
import { addDays, formatDistance } from './format';
import { useOrigin, useSearch, type Filters } from './queries';

const MAX_DAYS = 30; // G3.4

export function SearchScreen() {
  const { session } = useSession();
  const [filters, setFilters] = useState<Filters>({
    q: '',
    category: null,
    range: null,
    sort: 'distance',
  });
  const origin = useOrigin();
  const results = useSearch(origin.data, filters);
  const items = results.data?.pages.flatMap((p) => p.listings) ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => <Result listing={item} />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.section}>
            <Text style={styles.title} accessibilityRole="header">
              Find gear near you
            </Text>
            {session ? (
              <View style={styles.links}>
                <Link href="/my-listings" style={styles.link}>
                  Your gear
                </Link>
                <Link href="/profile" style={styles.link}>
                  Your profile
                </Link>
              </View>
            ) : (
              <Link href="/sign-in" style={styles.link}>
                Sign in
              </Link>
            )}
            <FilterBar filters={filters} onChange={setFilters} />
          </View>
        }
        ListEmptyComponent={
          origin.isError || origin.data === null ? (
            <ErrorState
              message={
                origin.isError
                  ? 'Could not read your location.'
                  : 'Search needs your location. Allow it for this app, then try again.'
              }
              onRetry={() => void origin.refetch()}
            />
          ) : results.isError ? (
            <ErrorState message="Could not search." onRetry={() => void results.refetch()} />
          ) : results.isPending ? (
            <Loading />
          ) : (
            <Text style={styles.muted}>No gear found nearby. Try other dates or words.</Text>
          )
        }
        ListFooterComponent={
          results.isFetchNextPageError ? (
            <ErrorState
              message="Could not load more."
              onRetry={() => void results.fetchNextPage()}
            />
          ) : results.isFetchingNextPage ? (
            <Loading />
          ) : undefined
        }
        onEndReached={() => {
          if (results.hasNextPage && !results.isFetching && !results.isFetchNextPageError) {
            void results.fetchNextPage();
          }
        }}
      />
    </SafeAreaView>
  );
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const categories = useCategories();
  const [q, setQ] = useState(filters.q);
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const submit = () => onChange({ ...filters, q: q.trim() });

  return (
    <View style={styles.section}>
      <TextField
        label="Keyword"
        value={q}
        onChangeText={setQ}
        onSubmitEditing={submit}
        returnKeyType="search"
        maxLength={200}
      />
      <Button title="Search" onPress={submit} />
      <Button
        title={filters.range ? `${filters.range.from} to ${filters.range.to}` : 'Any dates'}
        variant="secondary"
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <DateRangePicker
          value={dates}
          minDate={addDays(todayInToronto(), 1)}
          maxDays={MAX_DAYS}
          onChange={(next) => {
            setDates(next);
            if (next.from && next.to) {
              onChange({ ...filters, range: { from: next.from, to: next.to } });
              setOpen(false);
            }
          }}
        />
      ) : null}
      {filters.range ? (
        <Button
          title="Clear dates"
          variant="secondary"
          onPress={() => {
            setDates({ from: null, to: null });
            onChange({ ...filters, range: null });
          }}
        />
      ) : null}
      <ChipRow>
        <Chip
          label="All"
          selected={!filters.category}
          onPress={() => onChange({ ...filters, category: null })}
        />
        {categories.data?.categories.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            selected={filters.category === c.id}
            onPress={() => onChange({ ...filters, category: c.id })}
          />
        ))}
      </ChipRow>
      <ChipRow>
        <Chip
          label="Nearest"
          selected={filters.sort === 'distance'}
          onPress={() => onChange({ ...filters, sort: 'distance' })}
        />
        <Chip
          label="Cheapest"
          selected={filters.sort === 'price'}
          onPress={() => onChange({ ...filters, sort: 'price' })}
        />
      </ChipRow>
    </View>
  );
}

function Result({ listing: l }: { listing: SearchResult }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      style={styles.row}
      onPress={() => router.push({ pathname: '/listings/[id]', params: { id: l.id } })}
    >
      {l.photo_url ? <Image source={{ uri: l.photo_url }} style={styles.thumb} /> : null}
      <View style={styles.grow}>
        <Text style={styles.name}>{l.title}</Text>
        <Text style={styles.muted}>
          {formatCents(l.daily_price_cents)} a day · deposit {formatCents(l.deposit_cents)}
        </Text>
        <Text style={styles.muted}>
          {l.category.label} · {formatDistance(l.distance_m)}
        </Text>
        <Text style={styles.muted}>
          {l.owner.display_name ?? 'Owner'}
          {l.owner.rating_avg === null
            ? ''
            : ` · ${l.owner.rating_avg.toFixed(1)} (${l.owner.rating_count})`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: {
    padding: theme.space.lg,
    gap: theme.space.md,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  section: { gap: theme.space.md },
  title: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text },
  links: { flexDirection: 'row', gap: theme.space.md },
  link: { color: theme.color.primary, fontSize: theme.font.body },
  row: {
    flexDirection: 'row',
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
  },
  thumb: { width: 80, height: 80, borderRadius: theme.radius.sm },
  grow: { flex: 1, gap: theme.space.xs },
  name: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
});
