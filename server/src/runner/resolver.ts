import path from 'path';
import { pathToFileURL } from 'url';
import type { PostMigrationModule } from '../types';

let tsxRegistered = false;

const ensureTsxRegistered = async (): Promise<void> => {
  if (tsxRegistered) return;
  // Lazy: only pay the cost when a .ts file is actually loaded.
  // tsx/cjs/api uses require.extensions to make `require` understand TS,
  // which works for both CJS and ESM-compiled-to-CJS modules.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { register } = require('tsx/cjs/api');
  register();
  tsxRegistered = true;
};

const normalize = (mod: unknown): PostMigrationModule => {
  const candidate =
    mod && typeof mod === 'object' && 'default' in (mod as Record<string, unknown>)
      ? ((mod as Record<string, unknown>).default as unknown)
      : mod;

  if (!candidate || typeof candidate !== 'object') {
    throw new Error('migration module must export an object with an `up` function');
  }
  const up = (candidate as { up?: unknown }).up;
  if (typeof up !== 'function') {
    throw new Error('migration module must export an `up` function');
  }
  return { up: up as PostMigrationModule['up'] };
};

export const loadMigration = async (absolutePath: string): Promise<PostMigrationModule> => {
  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
    await ensureTsxRegistered();
    // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-dynamic-require, global-require
    const mod = require(absolutePath);
    return normalize(mod);
  }

  if (ext === '.mjs') {
    const mod = await import(pathToFileURL(absolutePath).href);
    return normalize(mod);
  }

  // .js / .cjs
  // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-dynamic-require, global-require
  const mod = require(absolutePath);
  return normalize(mod);
};
