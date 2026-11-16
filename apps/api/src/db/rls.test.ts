import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { LOCAL_PUBLISHABLE_KEY, LOCAL_SUPABASE_URL, ownerPool } from '../test/helpers.ts';

const owner = ownerPool();
afterAll(() => owner.end());

describe('row-level security catalogue (R1.8)', () => {
  // Stays in the suite: every later table in `public` is covered with no new code.
  it('every table in public has RLS on and zero policies', async () => {
    const { rows: tables } = await owner.query(`
      select c.relname as table, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by c.relname`);
    expect(tables.length).toBeGreaterThan(0);
    const bad = tables.filter((t) => !t.rls || t.policies !== 0);
    expect(bad).toEqual([]);
  });

  it('the api role owns no table and bypasses RLS', async () => {
    const { rows } = await owner.query(`
      select r.rolbypassrls as bypass,
             (select count(*)::int from pg_tables t where t.tableowner = 'api') as owned
        from pg_roles r where r.rolname = 'api'`);
    expect(rows).toEqual([{ bypass: true, owned: 0 }]);
  });
});

describe('publishable key (R1.8, invariant 7)', () => {
  it('reads no row from users through the Data API', async () => {
    await owner.query('insert into public.users (id) values ($1)', [randomUUID()]);
    const res = await fetch(`${LOCAL_SUPABASE_URL}/rest/v1/users?select=*`, {
      headers: { apikey: LOCAL_PUBLISHABLE_KEY },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
