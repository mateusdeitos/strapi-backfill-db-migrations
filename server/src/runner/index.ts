import path from 'path';
import fse from 'fs-extra';
import fg from 'fast-glob';
import type { Knex } from 'knex';

import type { MigrationFile, RunnerDeps } from '../types';
import { ensureTrackingTable, listExecuted, recordExecuted } from './storage';
import { loadMigration } from './resolver';
import { withMigrationLock } from './lock';

const SUPPORTED_EXTENSIONS = ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts', 'tsx'];

export const resolveDirectory = (root: string, directory: string): string =>
  path.isAbsolute(directory) ? directory : path.join(root, directory);

export const listMigrationFiles = async (dir: string): Promise<MigrationFile[]> => {
  const pattern = `*.{${SUPPORTED_EXTENSIONS.join(',')}}`;
  const matches = await fg(pattern, {
    cwd: dir,
    onlyFiles: true,
    dot: false,
  });
  return matches
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, absolutePath: path.join(dir, name) }));
};

export interface RunResult {
  executed: string[];
  skipped: string[];
}

export const runPostMigrations = async (deps: RunnerDeps): Promise<RunResult> => {
  const { strapi, config } = deps;
  const dir = resolveDirectory(strapi.dirs.app.root, config.directory);
  await fse.ensureDir(dir);

  const knex = strapi.db.connection;

  // Several instances can boot at once (e.g. a rolling deploy with more than one
  // task). The lock lets one of them create the tracking table and apply the
  // pending migrations; the others wait, then find nothing left to run.
  return withMigrationLock(knex, { tableName: config.tableName, log: strapi.log }, async (connection) => {
    const onLockConnection = <T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> =>
      knex.transaction(work, { connection });

    if (await onLockConnection((trx) => ensureTrackingTable(trx, config.tableName))) {
      strapi.log.info(`[backfill-db-migrations] created tracking table ${config.tableName}`);
    }

    const files = await listMigrationFiles(dir);
    if (files.length === 0) {
      strapi.log.info(`[backfill-db-migrations] no migrations found in ${config.directory}`);
      return { executed: [], skipped: [] };
    }

    // Read only once the lock is held: an instance that waited must see what the
    // previous holder applied.
    const executedNames = new Set(
      await onLockConnection((trx) => listExecuted(trx, config.tableName)),
    );
    const pending = files.filter((f) => !executedNames.has(f.name));
    const skipped = files.filter((f) => executedNames.has(f.name)).map((f) => f.name);

    if (pending.length === 0) {
      strapi.log.info('[backfill-db-migrations] nothing to run, all migrations applied');
      return { executed: [], skipped };
    }

    strapi.log.info(`[backfill-db-migrations] ${pending.length} pending migration(s)`);

    const executed: string[] = [];
    for (const file of pending) {
      strapi.log.info(`[backfill-db-migrations] running ${file.name}`);
      const mod = await loadMigration(file.absolutePath);

      await onLockConnection(async (trx) => {
        await mod.up(trx, strapi.db);
        await recordExecuted(trx, config.tableName, file.name);
      });

      strapi.log.info(`[backfill-db-migrations] applied ${file.name}`);
      executed.push(file.name);
    }

    return { executed, skipped };
  });
};
