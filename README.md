# strapi-plugin-backfill-db-migrations

Run Knex-style database migrations **after** Strapi's schema sync, ideal for
backfilling data into newly created columns in the same deploy.

## Why

Strapi runs migrations from `./database/migrations/` **before** it syncs the
schema. That means when you add a new column to a content-type, you cannot use
the built-in migrations folder to populate it — the column does not exist yet
when the migration runs.

This plugin provides a second migration runner that executes during the
plugin's `bootstrap()` lifecycle, which Strapi calls **after** the schema sync.
By that point all newly added columns exist in the database and can be safely
backfilled.

## Install

```bash
npm install strapi-plugin-backfill-db-migrations
# or
yarn add strapi-plugin-backfill-db-migrations
# or
pnpm add strapi-plugin-backfill-db-migrations
```

## Enable

`config/plugins.ts` (or `.js`):

```ts
export default {
  'backfill-db-migrations': {
    enabled: true,
    config: {
      // Run pending migrations automatically during boot. Default: true.
      autoRun: true,
      // Directory (relative to the project root) containing the migration files.
      // Default: 'database/migrations-post'.
      directory: 'database/migrations-post',
      // Tracking table where executed migrations are recorded.
      // Default: 'strapi_migrations_post'.
      tableName: 'strapi_migrations_post',
    },
  },
};
```

## Authoring a migration

Create a file under `database/migrations-post/`. Files run in alphabetical
order, so use a timestamp prefix (the `create` CLI command does this for you):

```ts
// database/migrations-post/2026.05.08-12.00.00.backfill-slug.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex('articles')
    .whereNull('slug')
    .update({ slug: knex.raw("LOWER(REPLACE(title, ' ', '-'))") });
}
```

Both `.ts` and `.js` files are supported. TypeScript files are loaded on demand
via [`tsx`](https://www.npmjs.com/package/tsx); no extra build step is needed.

Each migration runs inside its own database transaction. If `up` throws, the
transaction is rolled back, the migration is **not** recorded in the tracking
table, and the Strapi boot is aborted so the failure is loud.

## Lifecycle

During `bootstrap`, the plugin:

1. Takes a database lock keyed on the tracking table name (see
   [Concurrent boots](#concurrent-boots)), waiting if another instance holds it.
2. Ensures the tracking table exists (created on first run).
3. Lists files in the migrations directory.
4. Compares against the tracking table to find pending migrations.
5. Runs each pending migration (in alphabetical order) inside a transaction.
6. Records successful migrations in the tracking table.
7. Releases the lock, whether the run succeeded or failed.

If there are no pending migrations, boot continues normally with a single log
line.

### Concurrent boots

Several instances can boot against the same database at once, for example an
ECS service with `desiredCount > 1` during a rolling deploy. Steps 2–6 run under
a lock, so exactly one instance creates the tracking table and applies each
pending migration. The others log
`another instance holds … waiting for it to finish`, poll every 500 ms, then
re-read the tracking table and find nothing left to run. Waiting is not a
failure: those instances finish booting normally.

| Client | Lock | Notes |
| --- | --- | --- |
| PostgreSQL | `pg_try_advisory_lock(<bigint>)` | Session lock; the key is derived from `tableName`. Advisory locks are per database. |
| MySQL / MariaDB | `GET_LOCK('post_migrations_<hash>', 0)` | Session lock; the name hashes the database name and `tableName`, since `GET_LOCK` names are server-wide. |
| SQLite | none | No-op. SQLite apps run as a single instance; do not point several processes at one SQLite file and boot them at once. |

The lock is held on a dedicated pool connection, and the tracking-table checks
and each migration's transaction run on that same connection, so a run never
outlives its lock and needs no extra pool slot. If the instance holding the lock
dies, the database ends its session and releases the lock; a waiting instance
then takes over and runs the migration that was rolled back.

The CLI `up` command takes the same lock, so it is safe to run alongside a
booting instance. `status` only reads.

## CLI

A standalone CLI ships with the plugin for managing migrations outside of the
boot flow.

```bash
# Scaffold a new migration
npx strapi-post-migrations create "backfill slug column"

# Or a JavaScript one
npx strapi-post-migrations create "backfill slug column" --js

# List executed and pending migrations
npx strapi-post-migrations status

# Run pending migrations without starting the server
npx strapi-post-migrations up
```

`status` and `up` boot Strapi internally (they need access to the project's
database connection). They set `STRAPI_POST_MIGRATIONS_AUTORUN=false` before
booting so the auto-runner does not duplicate work.

You can also disable the auto-runner explicitly in any environment by setting
that env var:

```bash
STRAPI_POST_MIGRATIONS_AUTORUN=false strapi start
```

The env var takes precedence over `config.autoRun`.

## Plugin order

`bootstrap()` hooks run in the order plugins are registered. If another plugin
depends on a column populated by these migrations, make sure this plugin is
registered before it.

## Development

### Unit tests

Fast SQLite-backed tests for the runner internals:

```bash
npm test
```

### Integration tests

End-to-end tests boot a real Strapi v5 fixture app (`playground/`) against
Postgres and assert that migrations run after Strapi's schema sync.

Requirements: Docker.

```bash
# Start Postgres in the background (uses docker-compose.yml at the repo root)
npm run db:up

# Run the integration suite (also rebuilds dist/ first via pretest:integration)
npm run test:integration

# Tear it down when done
npm run db:down
```

The integration suite also runs in CI (`.github/workflows/test.yml`) using a
`postgres` service container, so the same scenarios are validated on every
push and pull request.

## Caveats

- **No `down`**. Aligned with Strapi v5's core migrations, only `up` is
  supported. Roll forward with a new migration if you need to revert.
- **Failures abort boot**. This is intentional: a half-migrated database is
  unsafe to serve from. Investigate, fix, and restart.
- **One transaction per file**. Cross-file consistency is not guaranteed; keep
  related changes in the same migration.
- **Long migrations delay other instances' boots**. Instances that boot while a
  migration runs wait for it before they start serving. Size health-check grace
  periods (e.g. ECS `healthCheckGracePeriodSeconds`) for your slowest backfill,
  or run it ahead of the deploy with `npx strapi-post-migrations up`.
- **Concurrent boots need PostgreSQL or MySQL**. The lock is a no-op on SQLite
  and on any other client (which logs a warning).

## License

MIT
