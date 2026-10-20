import knexLib from 'knex';

import {
  acquireLock,
  advisoryLockKey,
  mysqlLockName,
  resolveLockDialect,
  type Lock,
} from '../src/runner/lock';

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

describe('advisoryLockKey', () => {
  it('is a stable signed 64-bit integer per table name', () => {
    const key = advisoryLockKey('strapi_migrations_post');
    expect(advisoryLockKey('strapi_migrations_post')).toBe(key);
    expect(BigInt(key) >= INT64_MIN && BigInt(key) <= INT64_MAX).toBe(true);
    expect(advisoryLockKey('other_table')).not.toBe(key);
  });
});

describe('mysqlLockName', () => {
  it('fits the 64-char GET_LOCK limit and is scoped by database', () => {
    const name = mysqlLockName('a'.repeat(64), 't'.repeat(255));
    expect(name.length).toBeLessThanOrEqual(64);
    expect(mysqlLockName('db1', 'x')).not.toBe(mysqlLockName('db2', 'x'));
    expect(mysqlLockName('db1', 'x')).toBe(mysqlLockName('db1', 'x'));
  });
});

describe('resolveLockDialect', () => {
  it.each([
    ['pg', 'postgres'],
    ['mysql2', 'mysql'],
    ['better-sqlite3', 'sqlite'],
    ['mssql', 'unsupported'],
  ])('maps knex client %s to %s', async (client, expected) => {
    const knex = knexLib({ client, useNullAsDefault: true });
    try {
      expect(resolveLockDialect(knex)).toBe(expected);
    } finally {
      await knex.destroy();
    }
  });
});

describe('acquireLock', () => {
  const makeLog = () => {
    const info: string[] = [];
    return { info, log: { info: (m: string) => info.push(m), warn: jest.fn(), error: jest.fn() } };
  };

  it('returns at once when the lock is free', async () => {
    const lock: Lock = { label: 'L', tryAcquire: jest.fn().mockResolvedValue(true), release: jest.fn() };
    const { info, log } = makeLog();
    await acquireLock(lock, log, 1);
    expect(lock.tryAcquire).toHaveBeenCalledTimes(1);
    expect(info).toEqual([]);
  });

  it('polls until the holder releases, logging the wait', async () => {
    const tryAcquire = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { info, log } = makeLog();
    await acquireLock({ label: 'L', tryAcquire, release: jest.fn() }, log, 1);
    expect(tryAcquire).toHaveBeenCalledTimes(3);
    expect(info[0]).toMatch(/another instance holds L; waiting/);
    expect(info[1]).toMatch(/acquired L after \d+ms/);
  });

  it('propagates errors from the try-lock', async () => {
    const tryAcquire = jest.fn().mockRejectedValue(new Error('GET_LOCK returned NULL'));
    const { log } = makeLog();
    await expect(acquireLock({ label: 'L', tryAcquire, release: jest.fn() }, log, 1)).rejects.toThrow(
      'NULL',
    );
  });
});
