import path from 'path';
import fse from 'fs-extra';
import { Command } from 'commander';

import { defaultConfig } from '../server/src/config';
import { runPostMigrations, listMigrationFiles, resolveDirectory } from '../server/src/runner';
import { ensureTrackingTable, listExecuted } from '../server/src/runner/storage';
import type { PluginConfig, StrapiLike } from '../server/src/types';
import { jsTemplate, slugify, timestamp, tsTemplate } from './templates';

const PLUGIN_NAME = 'backfill-db-migrations';

interface LoadedStrapi extends StrapiLike {
  config: { get: (key: string, fallback?: unknown) => unknown };
  destroy?: () => Promise<void>;
}

const resolvePluginConfig = (strapi: LoadedStrapi): PluginConfig => {
  const raw = (strapi.config.get(`plugin::${PLUGIN_NAME}`, {}) as Partial<PluginConfig>) || {};
  return { ...defaultConfig, ...raw };
};

const loadStrapi = async (): Promise<LoadedStrapi> => {
  // Prevent the bootstrap auto-run from firing during CLI invocations.
  process.env.STRAPI_POST_MIGRATIONS_AUTORUN = 'false';

  // Resolved from the consumer project's node_modules.
  const cwd = process.cwd();
  const strapiModulePath = require.resolve('@strapi/strapi', { paths: [cwd] });
  // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-dynamic-require, global-require
  const strapiPkg = require(strapiModulePath);

  const compileStrapi = strapiPkg.compileStrapi ?? strapiPkg.default?.compileStrapi;
  const createStrapi = strapiPkg.createStrapi ?? strapiPkg.default?.createStrapi ?? strapiPkg.default;

  if (typeof createStrapi !== 'function') {
    throw new Error('Could not locate `createStrapi` in the installed @strapi/strapi package');
  }

  const appContext = typeof compileStrapi === 'function' ? await compileStrapi() : undefined;
  const instance = appContext ? createStrapi(appContext) : createStrapi();
  await instance.load();
  return instance as LoadedStrapi;
};

const formatTable = (rows: Array<{ name: string; status: string }>): string => {
  if (rows.length === 0) return '(no migrations)';
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));
  const header = `${'NAME'.padEnd(nameW)}  STATUS`;
  const sep = `${'-'.repeat(nameW)}  ${'-'.repeat(8)}`;
  const body = rows.map((r) => `${r.name.padEnd(nameW)}  ${r.status}`).join('\n');
  return `${header}\n${sep}\n${body}`;
};

const program = new Command();
program
  .name('strapi-post-migrations')
  .description("Manage Strapi post-schema-sync (backfill) migrations")
  .version('0.1.0');

program
  .command('create')
  .description('Create a new migration file from the template')
  .argument('<name>', 'Short description (used as slug)')
  .option('--js', 'Create a JavaScript migration instead of TypeScript')
  .option('-d, --dir <directory>', 'Override migrations directory (relative to cwd)')
  .action(async (name: string, opts: { js?: boolean; dir?: string }) => {
    const dir = opts.dir
      ? path.resolve(process.cwd(), opts.dir)
      : path.resolve(process.cwd(), defaultConfig.directory);
    await fse.ensureDir(dir);
    const ext = opts.js ? 'js' : 'ts';
    const filename = `${timestamp()}.${slugify(name)}.${ext}`;
    const target = path.join(dir, filename);
    const content = opts.js ? jsTemplate(name) : tsTemplate(name);
    await fse.writeFile(target, content, 'utf8');
    process.stdout.write(`Created ${path.relative(process.cwd(), target)}\n`);
  });

program
  .command('status')
  .description('Show executed and pending migrations')
  .action(async () => {
    const strapi = await loadStrapi();
    try {
      const config = resolvePluginConfig(strapi);
      const dir = resolveDirectory(strapi.dirs.app.root, config.directory);
      await fse.ensureDir(dir);

      const knex = strapi.db.connection;
      await ensureTrackingTable(knex, config.tableName);

      const files = await listMigrationFiles(dir);
      const executed = new Set(await listExecuted(knex, config.tableName));
      const rows = files.map((f) => ({
        name: f.name,
        status: executed.has(f.name) ? 'executed' : 'pending',
      }));
      const orphans = [...executed].filter((n) => !files.some((f) => f.name === n));
      for (const name of orphans) rows.push({ name, status: 'missing-file' });

      process.stdout.write(`${formatTable(rows)}\n`);
    } finally {
      await strapi.destroy?.();
    }
  });

program
  .command('up')
  .description('Run all pending migrations')
  .action(async () => {
    const strapi = await loadStrapi();
    try {
      const config = resolvePluginConfig(strapi);
      const result = await runPostMigrations({ strapi, config });
      if (result.executed.length === 0) {
        process.stdout.write('No pending migrations.\n');
      } else {
        process.stdout.write(
          `Executed ${result.executed.length} migration(s):\n` +
            result.executed.map((n) => `  - ${n}`).join('\n') +
            '\n',
        );
      }
    } finally {
      await strapi.destroy?.();
    }
  });

program
  .parseAsync(process.argv)
  .catch((err) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
