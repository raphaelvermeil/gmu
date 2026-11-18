import { useLocalSearchParams } from 'expo-router';
import { ListingScreen } from '../../features/listings/ListingScreen';

export default function ListingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ListingScreen id={id} />;
}
