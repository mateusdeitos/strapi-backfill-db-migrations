import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import knexLib, { Knex } from 'knex';

import { runPostMigrations, listMigrationFiles } from '../src/runner';
import { ensureTrackingTable, listExecuted } from '../src/runner/storage';
import type { PluginConfig, StrapiLike } from '../src/types';

const TABLE = 'strapi_migrations_post';

const baseConfig: PluginConfig = {
  enabled: true,
  autoRun: true,
  directory: 'database/migrations-post',
  tableName: TABLE,
};

const makeLogger = () => {
  const calls: { level: string; msg: string }[] = [];
  return {
    calls,
    logger: {
      info: (msg: string) => calls.push({ level: 'info', msg }),
      warn: (msg: string) => calls.push({ level: 'warn', msg }),
      error: (msg: string) => calls.push({ level: 'error', msg }),
      debug: (msg: string) => calls.push({ level: 'debug', msg }),
    },
  };
};

const makeStrapi = (root: string, knex: Knex): StrapiLike & { _logCalls: { level: string; msg: string }[] } => {
  const { calls, logger } = makeLogger();
  return {
    db: { connection: knex },
    log: logger,
    dirs: { app: { root } },
    _logCalls: calls,
  };
};

const setupRoot = async (): Promise<{ root: string; migrationsDir: string }> => {
  const root = await fse.mkdtemp(path.join(os.tmpdir(), 'backfill-test-'));
  const migrationsDir = path.join(root, baseConfig.directory);
  await fse.ensureDir(migrationsDir);
  return { root, migrationsDir };
};

const writeJsMigration = async (
  dir: string,
  name: string,
  body: string,
): Promise<void> => {
  await fse.writeFile(
    path.join(dir, name),
    `'use strict';\nmodule.exports = { async up(knex) { ${body} } };\n`,
    'utf8',
  );
};

const makeKnex = (): Knex =>
  knexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

describe('runPostMigrations', () => {
  let knex: Knex;
  let root: string;
  let migrationsDir: string;

  beforeEach(async () => {
    knex = makeKnex();
    const setup = await setupRoot();
    root = setup.root;
    migrationsDir = setup.migrationsDir;
  });

  afterEach(async () => {
    await knex.destroy();
    await fse.remove(root);
  });

  it('creates the tracking table on first run', async () => {
    const strapi = makeStrapi(root, knex);
    await runPostMigrations({ strapi, config: baseConfig });
    expect(await knex.schema.hasTable(TABLE)).toBe(true);
  });

  it('runs pending migrations in alphabetical order and records them', async () => {
    await knex.schema.createTable('demo', (t) => {
      t.increments('id');
      t.string('value');
    });
    await knex('demo').insert([{ value: 'a' }, { value: 'b' }]);

    await writeJsMigration(
      migrationsDir,
      '2026.01.01-00.00.00.first.js',
      `await knex('demo').update({ value: 'first' });`,
    );
    await writeJsMigration(
      migrationsDir,
      '2026.01.02-00.00.00.second.js',
      `await knex('demo').update({ value: 'second' });`,
    );

    const strapi = makeStrapi(root, knex);
    const result = await runPostMigrations({ strapi, config: baseConfig });

    expect(result.executed).toEqual([
      '2026.01.01-00.00.00.first.js',
      '2026.01.02-00.00.00.second.js',
    ]);
    const rows = await knex<{ value: string }>('demo').select('value');
    expect(rows.every((r) => r.value === 'second')).toBe(true);

    const recorded = await listExecuted(knex, TABLE);
    expect(recorded).toEqual([
      '2026.01.01-00.00.00.first.js',
      '2026.01.02-00.00.00.second.js',
    ]);
  });

  it('is idempotent: a second run skips already-executed migrations', async () => {
    await knex.schema.createTable('counter', (t) => {
      t.increments('id');
      t.integer('n').defaultTo(0);
    });
    await knex('counter').insert({ n: 0 });

    await writeJsMigration(
      migrationsDir,
      '2026.01.01-00.00.00.bump.js',
      `await knex('counter').update({ n: knex.raw('n + 1') });`,
    );

    const strapi = makeStrapi(root, knex);
    await runPostMigrations({ strapi, config: baseConfig });
    await runPostMigrations({ strapi, config: baseConfig });

    const [row] = await knex<{ n: number }>('counter').select('n');
    expect(row.n).toBe(1);
  });

  it('rolls back the transaction and does not record on failure', async () => {
    await knex.schema.createTable('thing', (t) => {
      t.increments('id');
      t.string('label');
    });

    await writeJsMigration(
      migrationsDir,
      '2026.01.01-00.00.00.broken.js',
      `await knex('thing').insert({ label: 'will-rollback' });
       throw new Error('boom');`,
    );

    const strapi = makeStrapi(root, knex);
    await expect(
      runPostMigrations({ strapi, config: baseConfig }),
    ).rejects.toThrow('boom');

    const rows = await knex<{ label: string }>('thing').select('label');
    expect(rows).toHaveLength(0);
    const recorded = await listExecuted(knex, TABLE);
    expect(recorded).toHaveLength(0);
  });

  it('returns empty result when directory has no migration files', async () => {
    const strapi = makeStrapi(root, knex);
    const result = await runPostMigrations({ strapi, config: baseConfig });
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('listMigrationFiles', () => {
  it('returns supported extensions only and sorted alphabetically', async () => {
    const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'list-test-'));
    try {
      await fse.writeFile(path.join(dir, 'b.js'), '');
      await fse.writeFile(path.join(dir, 'a.ts'), '');
      await fse.writeFile(path.join(dir, 'README.md'), '');
      await fse.writeFile(path.join(dir, 'c.json'), '');

      const files = await listMigrationFiles(dir);
      expect(files.map((f) => f.name)).toEqual(['a.ts', 'b.js']);
    } finally {
      await fse.remove(dir);
    }
  });
});

describe('ensureTrackingTable', () => {
  it('is idempotent', async () => {
    const knex = makeKnex();
    try {
      await ensureTrackingTable(knex, TABLE);
      await ensureTrackingTable(knex, TABLE);
      expect(await knex.schema.hasTable(TABLE)).toBe(true);
    } finally {
      await knex.destroy();
    }
  });
});
