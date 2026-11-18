// Thin wrapper over pg-boss (R2.20). No business rules here.
// pg-boss lives in the `pgboss` schema of the same database. G1.3: the `api` role owns nothing,
// so `installQueue` creates the schema and the queues as `postgres` during migrations, and the
// API starts pg-boss with migrations and schema creation turned off.
import pg from 'pg';
import { PgBoss } from 'pg-boss';

export const QUEUES = { verifyPhoto: 'verify-photo' } as const;
type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type Queue = {
  send(name: QueueName, data: object): Promise<void>;
  work(name: QueueName, handler: (data: unknown) => Promise<void>): Promise<void>;
  healthy(): Promise<boolean>;
  stop(): Promise<void>;
};

const SCHEMA = 'pgboss';

// Runs as `postgres` with the migrations: installs or upgrades pg-boss, creates the queues,
// and grants the `api` role what it needs at run time.
export async function installQueue(ownerUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: ownerUrl,
    schema: SCHEMA,
    max: 1,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  try {
    // A failed check is retried with backoff; a photo that still fails is deleted by the job.
    if (!(await boss.getQueue(QUEUES.verifyPhoto))) {
      await boss.createQueue(QUEUES.verifyPhoto, {
        retryLimit: 3,
        retryDelay: 10,
        retryBackoff: true,
      });
    }
  } finally {
    await boss.stop({ graceful: false });
  }
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`
      grant usage on schema ${SCHEMA} to api;
      grant select, insert, update, delete on all tables in schema ${SCHEMA} to api;
      grant usage, select on all sequences in schema ${SCHEMA} to api;
      grant execute on all functions in schema ${SCHEMA} to api;
    `);
  } finally {
    await client.end();
  }
}

// The API's queue, connected as `api`. It starts on first use, so a process or test that
// never touches the queue opens no extra connections.
export function createQueue(apiUrl: string): Queue {
  const boss = new PgBoss({
    connectionString: apiUrl,
    schema: SCHEMA,
    max: 3,
    migrate: false,
    createSchema: false,
  });
  boss.on('error', (error) => {
    console.log(JSON.stringify({ level: 'error', msg: 'queue error', error: error.message }));
  });
  let started: Promise<unknown> | undefined;
  const ready = () => (started ??= boss.start());

  return {
    async send(name, data) {
      await ready();
      await boss.send(name, data);
    },
    async work(name, handler) {
      await ready();
      // Up to 5 jobs a fetch, fetching again at once while batches come back full.
      // A throw fails the whole batch, which pg-boss retries; handlers must be idempotent.
      const options = { batchSize: 5, burstWhenBatchFull: true, pollingIntervalSeconds: 1 };
      await boss.work(name, options, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    },
    async healthy() {
      try {
        await ready();
        return (await boss.getQueue(QUEUES.verifyPhoto)) !== null;
      } catch {
        return false;
      }
    },
    async stop() {
      if (started) await boss.stop({ graceful: false });
    },
  };
}
