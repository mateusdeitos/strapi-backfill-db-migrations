import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import type { Knex } from 'knex';

import { runPostMigrations, type RunResult } from '../../src/runner';
import { ensureTrackingTable } from '../../src/runner/storage';
import type { PluginConfig, StrapiLike } from '../../src/types';
import { makeKnex, resetDatabase } from './helpers';

const TRACKING_TABLE = 'strapi_migrations_post';

const config: PluginConfig = {
  enabled: true,
  autoRun: true,
  directory: 'database/migrations-post',
  tableName: TRACKING_TABLE,
};

interface Instance {
  strapi: StrapiLike;
  knex: Knex;
  logs: string[];
}

// Each instance gets its own pool, so from Postgres' point of view they are as
// separate as two ECS tasks booting the same release.
const makeInstance = (root: string): Instance => {
  const knex = makeKnex();
  const logs: string[] = [];
  const push = (msg: string) => logs.push(msg);
  return {
    knex,
    logs,
    strapi: {
      db: { connection: knex },
      log: { info: push, warn: push, error: push, debug: push },
      dirs: { app: { root } },
    },
  };
};

const writeMigration = async (root: string, name: string, body: string): Promise<void> => {
  await fse.writeFile(
    path.join(root, config.directory, name),
    `'use strict';\nmodule.exports = { async up(knex) { ${body} } };\n`,
    'utf8',
  );
};

describe('integration: concurrent runners (postgres)', () => {
  let root: string;
  let instances: Instance[];

  beforeEach(async () => {
    await resetDatabase();
    root = await fse.mkdtemp(path.join(os.tmpdir(), 'backfill-concurrency-'));
    await fse.ensureDir(path.join(root, config.directory));
    instances = [];
  });

  afterEach(async () => {
    await Promise.all(instances.map((i) => i.knex.destroy()));
    await fse.remove(root);
  });

  const spawn = (count: number): Instance[] => {
    const created = Array.from({ length: count }, () => makeInstance(root));
    instances.push(...created);
    return created;
  };

  // The sleep keeps the first runner inside the migration long enough for the
  // others to reach the point where they would read the same pending list.
  const BUMP = '2026.01.01-00.00.00.bump.js';
  const seedCounterAndBump = async (knex: Knex): Promise<void> => {
    await knex.schema.createTable('counter', (t) => {
      t.increments('id');
      t.integer('n').notNullable().defaultTo(0);
    });
    await knex('counter').insert({ n: 0 });
    await writeMigration(
      root,
      BUMP,
      `await knex.raw('select pg_sleep(0.5)');
       await knex('counter').update({ n: knex.raw('n + 1') });`,
    );
  };

  const runInParallel = async (count: number): Promise<{ results: RunResult[]; logs: string[] }> => {
    const runners = spawn(count);
    const results = await Promise.all(
      runners.map(({ strapi }) => runPostMigrations({ strapi, config })),
    );
    return { results, logs: runners.flatMap((r) => r.logs) };
  };

  const expectAppliedOnce = async (knex: Knex, results: RunResult[]): Promise<void> => {
    expect(results.flatMap((r) => r.executed)).toEqual([BUMP]);
    expect(results.filter((r) => r.skipped.includes(BUMP))).toHaveLength(results.length - 1);

    const [row] = await knex<{ n: number }>('counter').select('n');
    expect(row.n).toBe(1);

    const recorded = await knex<{ name: string }>(TRACKING_TABLE).select('name');
    expect(recorded.map((r) => r.name)).toEqual([BUMP]);
  };

  const createdTableLogs = (logs: string[]) =>
    logs.filter((m) => m.includes(`created tracking table ${TRACKING_TABLE}`));

  it('first deploy: parallel boots create the tracking table once and apply the migration once', async () => {
    const [setup] = spawn(1);
    await seedCounterAndBump(setup.knex);

    const { results, logs } = await runInParallel(4);

    await expectAppliedOnce(setup.knex, results);
    expect(createdTableLogs(logs)).toHaveLength(1);
    expect(logs.some((m) => m.includes('waiting'))).toBe(true);
  });

  it('later deploy: parallel boots apply a pending migration once', async () => {
    const [setup] = spawn(1);
    await ensureTrackingTable(setup.knex, TRACKING_TABLE);
    await seedCounterAndBump(setup.knex);

    const { results, logs } = await runInParallel(4);

    await expectAppliedOnce(setup.knex, results);
    expect(createdTableLogs(logs)).toHaveLength(0);
  });

  it('releases the lock when a migration fails, so the next boot is not blocked', async () => {
    const broken = path.join(root, config.directory, '2026.01.01-00.00.00.broken.js');
    await writeMigration(root, path.basename(broken), `throw new Error('boom');`);

    const [first] = spawn(1);
    await expect(runPostMigrations({ strapi: first.strapi, config })).rejects.toThrow('boom');

    // The fix ships under a new name (require() caches the old module). A separate
    // pool, so a lock leaked on one of `first`'s pooled connections would block
    // here instead of being silently re-entered.
    await fse.remove(broken);
    const fixed = '2026.01.01-00.00.01.fixed.js';
    await writeMigration(root, fixed, `await knex.raw('select 1');`);
    const [second] = spawn(1);
    const result = await runPostMigrations({ strapi: second.strapi, config });
    expect(result.executed).toEqual([fixed]);
  });
});
