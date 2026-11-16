import { setupLocalDb } from '../db/local-setup.ts';

export default async function setup(): Promise<void> {
  await setupLocalDb();
}
