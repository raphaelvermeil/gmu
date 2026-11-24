import { todayInToronto } from '@gear/shared';
import { Link } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ErrorState, Loading, Screen } from '../../components/Screen';
import { theme } from '../../components/theme';
import { ApiRequestError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { conditionLabel, formatCents } from '../listings/format';
import { useCategories, useListing } from '../listings/queries';
import { addDays } from './format';
import { useAvailability } from './queries';

export function PublicListingScreen({ id }: { id: string }) {
  const { session } = useSession();
  const listing = useListing(id);
  const categories = useCategories();
  if (listing.isPending) return <Loading />;
  if (listing.isError) {
    const gone = listing.error instanceof ApiRequestError && listing.error.status === 404;
    return gone ? (
      <ErrorState message="This listing is not available." />
    ) : (
      <ErrorState message="Could not load this listing." onRetry={() => void listing.refetch()} />
    );
  }
  const l = listing.data;
  const category = categories.data?.categories.find((c) => c.id === l.category_id);
  return (
    <Screen title={l.title}>
      {session?.user.id === l.owner_id ? (
        <Link
          href={{ pathname: '/listings/[id]/edit', params: { id: l.id } }}
          style={styles.link}
        >
          Edit this listing
        </Link>
      ) : null}
      {l.images.map((image) => (
        <Image key={image.id} source={{ uri: image.url }} style={styles.photo} />
      ))}
      {l.daily_price_cents ? (
        <Text style={styles.text}>
          {formatCents(l.daily_price_cents)} a day · deposit {formatCents(l.deposit_cents)}
        </Text>
      ) : null}
      <Text style={styles.muted}>
        {[category?.label, l.condition ? conditionLabel[l.condition] : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={styles.text}>{l.description}</Text>
      {l.status === 'active' ? <Availability id={l.id} /> : null}
    </Screen>
  );
}

function Availability({ id }: { id: string }) {
  const today = todayInToronto();
  const availability = useAvailability(id, today, addDays(today, 365));
  if (availability.isPending) return <Loading />;
  if (availability.isError) {
    return (
      <ErrorState
        message="Could not load the dates."
        onRetry={() => void availability.refetch()}
      />
    );
  }
  const { taken } = availability.data;
  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        Taken dates
      </Text>
      {taken.length === 0 ? <Text style={styles.muted}>None in the next year.</Text> : null}
      {taken.map((r) => (
        <Text key={r.start} style={styles.muted}>
          {r.start === r.end ? r.start : `${r.start} to ${r.end}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.space.xs },
  heading: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  text: { fontSize: theme.font.body, color: theme.color.text },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  link: { color: theme.color.primary, fontSize: theme.font.body },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: theme.radius.md },
});
