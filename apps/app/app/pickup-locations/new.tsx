import { useLocalSearchParams } from 'expo-router';
import { NewPickupLocationScreen } from '../../features/listings/NewPickupLocationScreen';

export default function NewPickupLocationRoute() {
  const { listing } = useLocalSearchParams<{ listing?: string }>();
  return <NewPickupLocationScreen listingId={listing} />;
}
