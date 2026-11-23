import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';
import { PublicListingScreen } from '../../../features/search/PublicListingScreen';
import { listingMetadata } from '../../../features/search/metadata';

// R3.11: runs on the server before the page renders, so a link preview finds the tags.
export const generateMetadata: GenerateMetadataFunction = (_request, params) =>
  listingMetadata(String(params.id));

export default function ListingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PublicListingScreen id={id} />;
}
