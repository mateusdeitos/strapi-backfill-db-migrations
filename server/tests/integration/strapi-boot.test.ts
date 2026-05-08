import type { Knex } from 'knex';

import {
  bootStrapi,
  clearMigrationsDir,
  resetDatabase,
  writeMigration,
} from './helpers';

const TRACKING_TABLE = 'strapi_migrations_post';

describe('integration: Strapi boot + post-schema migrations (postgres)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMigrationsDir();
  });

  it('creates the tracking table after schema sync on first boot', async () => {
    const { strapi, destroy } = await bootStrapi();
    try {
      const knex: Knex = strapi.db.connection;
      expect(await knex.schema.hasTable(TRACKING_TABLE)).toBe(true);
      // Strapi's schema sync should have created the articles table from
      // playground/src/api/article.
      expect(await knex.schema.hasTable('articles')).toBe(true);
    } finally {
      await destroy();
    }
  });

  it('runs a backfill migration that updates rows created via Strapi schema sync', async () => {
    // First boot: schema sync creates `articles`. Insert seed rows whose
    // `slug` is null, simulating data written before the column was backfilled.
    const first = await bootStrapi();
    try {
      const knex: Knex = first.strapi.db.connection;
      await knex('articles').insert([
        { title: 'Hello World', slug: null, document_id: 'doc-1' },
        { title: 'Another Post', slug: null, document_id: 'doc-2' },
      ]);
    } finally {
      await first.destroy();
    }

    // Drop a migration that backfills `slug` from `title`, then reboot.
    await writeMigration(
      '2026.01.01-00.00.00.backfill-slug.js',
      `await knex('articles')
         .whereNull('slug')
         .update({ slug: knex.raw("lower(replace(title, ' ', '-'))") });`,
    );

    const second = await bootStrapi();
    try {
      const knex: Knex = second.strapi.db.connection;
      const rows = await knex<{ title: string; slug: string }>('articles')
        .select('title', 'slug')
        .orderBy('title', 'asc');
      expect(rows).toEqual([
        { title: 'Another Post', slug: 'another-post' },
        { title: 'Hello World', slug: 'hello-world' },
      ]);
      const recorded = await knex<{ name: string }>(TRACKING_TABLE).select('name');
      expect(recorded.map((r: { name: string }) => r.name)).toEqual([
        '2026.01.01-00.00.00.backfill-slug.js',
      ]);
    } finally {
      await second.destroy();
    }
  });

  it('does not re-run a migration on subsequent boots', async () => {
    await writeMigration(
      '2026.01.01-00.00.00.bump.js',
      `if (!(await knex.schema.hasTable('counter'))) {
         await knex.schema.createTable('counter', (t) => {
           t.increments('id');
           t.integer('n').notNullable().defaultTo(0);
         });
         await knex('counter').insert({ n: 0 });
       }
       await knex('counter').update({ n: knex.raw('n + 1') });`,
    );

    for (let i = 0; i < 2; i++) {
      const { destroy } = await bootStrapi();
      await destroy();
    }

    const { strapi, destroy } = await bootStrapi();
    try {
      const knex: Knex = strapi.db.connection;
      const [row] = await knex<{ n: number }>('counter').select('n');
      expect(row.n).toBe(1);
    } finally {
      await destroy();
    }
  });

  it('aborts boot when a migration throws', async () => {
    await writeMigration(
      '2026.01.01-00.00.00.broken.js',
      `throw new Error('boom');`,
    );

    await expect(bootStrapi()).rejects.toThrow(/boom/);
  });
});
