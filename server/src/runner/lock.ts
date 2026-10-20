import crypto from 'crypto';
import type { Knex } from 'knex';

import type { StrapiLikeLogger } from '../types';

const LOG_PREFIX = '[backfill-db-migrations]';
const LOCK_NAMESPACE = 'strapi-plugin-backfill-db-migrations';
const DEFAULT_POLL_INTERVAL_MS = 500;

export type LockDialect = 'postgres' | 'mysql' | 'sqlite' | 'unsupported';

export interface Lock {
  // Shown in logs so an operator can find the lock in pg_locks / metadata_locks.
  label: string;
  tryAcquire: () => Promise<boolean>;
  release: () => Promise<void>;
}

export interface MigrationLockOptions {
  tableName: string;
  log: StrapiLikeLogger;
  pollIntervalMs?: number;
}

export const resolveLockDialect = (knex: Knex): LockDialect => {
  switch (knex.client.dialect) {
    case 'postgresql':
      return 'postgres';
    case 'mysql':
      return 'mysql';
    case 'sqlite3':
      return 'sqlite';
    default:
      return 'unsupported';
  }
};

const digest = (value: string): Buffer =>
  crypto.createHash('sha256').update(`${LOCK_NAMESPACE}:${value}`).digest();

// pg_advisory_lock takes a signed bigint; passed as a decimal string so it
// survives JS number precision.
export const advisoryLockKey = (tableName: string): string =>
  digest(tableName).readBigInt64BE(0).toString();

// GET_LOCK names are server-wide (not per database) and capped at 64 chars.
export const mysqlLockName = (database: string, tableName: string): string =>
  `post_migrations_${digest(`${database}.${tableName}`).toString('hex').slice(0, 40)}`;

const isTruthy = (value: unknown): boolean => value === true || value === 1 || value === '1';

const selectOn = async (
  knex: Knex,
  connection: unknown,
  expression: string,
  bindings: readonly Knex.Value[],
): Promise<unknown> => {
  const [row] = await knex
    .select(knex.raw(`${expression} as result`, bindings))
    .connection(connection);
  return (row as { result: unknown }).result;
};

const postgresLock = (knex: Knex, connection: unknown, tableName: string): Lock => {
  const key = advisoryLockKey(tableName);
  return {
    label: `pg advisory lock ${key}`,
    tryAcquire: async () =>
      isTruthy(await selectOn(knex, connection, 'pg_try_advisory_lock(?::bigint)', [key])),
    release: async () => {
      await selectOn(knex, connection, 'pg_advisory_unlock(?::bigint)', [key]);
    },
  };
};

const mysqlLock = async (knex: Knex, connection: unknown, tableName: string): Promise<Lock> => {
  const database = String((await selectOn(knex, connection, 'DATABASE()', [])) ?? '');
  const name = mysqlLockName(database, tableName);
  return {
    label: `mysql lock ${name}`,
    tryAcquire: async () => {
      const result = await selectOn(knex, connection, 'GET_LOCK(?, 0)', [name]);
      // NULL means the server failed to take the lock (e.g. out of memory or the
      // thread was killed), which is an error rather than "someone else has it".
      if (result === null || result === undefined) {
        throw new Error(`${LOG_PREFIX} GET_LOCK('${name}') returned NULL`);
      }
      return isTruthy(result);
    },
    release: async () => {
      await selectOn(knex, connection, 'RELEASE_LOCK(?)', [name]);
    },
  };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Polls with a non-blocking try-lock instead of a blocking call, so a waiting
// instance is not killed by statement_timeout / lock_timeout settings.
export const acquireLock = async (
  lock: Lock,
  log: StrapiLikeLogger,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): Promise<void> => {
  if (await lock.tryAcquire()) return;

  log.info(`${LOG_PREFIX} another instance holds ${lock.label}; waiting for it to finish`);
  const startedAt = Date.now();
  while (!(await lock.tryAcquire())) {
    await sleep(pollIntervalMs);
  }
  log.info(`${LOG_PREFIX} acquired ${lock.label} after ${Date.now() - startedAt}ms`);
};

/**
 * Runs `fn` while holding a database-wide lock keyed on the tracking table, so
 * only one instance at a time creates the table, reads pending migrations and
 * applies them. `fn` gets the dedicated connection that holds the lock (or
 * `undefined` when the client has no lock); running every query on it means the
 * work can never outlive the lock.
 */
export const withMigrationLock = async <T>(
  knex: Knex,
  { tableName, log, pollIntervalMs }: MigrationLockOptions,
  fn: (connection: unknown) => Promise<T>,
): Promise<T> => {
  const dialect = resolveLockDialect(knex);
  if (dialect === 'sqlite') return fn(undefined);
  if (dialect === 'unsupported') {
    log.warn(
      `${LOG_PREFIX} no cross-instance lock for client "${knex.client.dialect}"; ` +
        'do not boot several instances at once',
    );
    return fn(undefined);
  }

  const connection = await knex.client.acquireConnection();
  try {
    const lock =
      dialect === 'postgres'
        ? postgresLock(knex, connection, tableName)
        : await mysqlLock(knex, connection, tableName);

    await acquireLock(lock, log, pollIntervalMs);
    try {
      return await fn(connection);
    } finally {
      try {
        await lock.release();
      } catch (err) {
        // Never hand a connection that may still hold the lock back to the pool:
        // it could sit idle there and block every other instance's boot. Closing
        // the session releases the lock server-side.
        log.warn(`${LOG_PREFIX} failed to release ${lock.label}; closing its connection`);
        (connection as { __knex__disposed?: unknown }).__knex__disposed = err;
        await knex.client.destroyRawConnection(connection).catch(() => undefined);
      }
    }
  } finally {
    knex.client.releaseConnection(connection);
  }
};
