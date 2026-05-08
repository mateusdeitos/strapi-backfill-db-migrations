import path from 'path';
import fse from 'fs-extra';
import knexLib, { Knex } from 'knex';
import { compileStrapi, createStrapi } from '@strapi/strapi';

export const PLAYGROUND_DIR = path.resolve(__dirname, '..', '..', '..', 'playground');
export const MIGRATIONS_DIR = path.join(PLAYGROUND_DIR, 'database', 'migrations-post');

export const dbConfig = {
  host: process.env.DATABASE_HOST ?? '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME ?? 'strapi_test',
  user: process.env.DATABASE_USERNAME ?? 'strapi',
  password: process.env.DATABASE_PASSWORD ?? 'strapi',
};

export const makeKnex = (): Knex =>
  knexLib({
    client: 'pg',
    connection: dbConfig,
    pool: { min: 0, max: 5 },
  });

export const resetDatabase = async (): Promise<void> => {
  const knex = makeKnex();
  try {
    await knex.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await knex.raw('CREATE SCHEMA public');
  } finally {
    await knex.destroy();
  }
};

export const clearMigrationsDir = async (): Promise<void> => {
  await fse.emptyDir(MIGRATIONS_DIR);
  // Preserve the marker so the empty directory survives in git checkouts.
  await fse.writeFile(path.join(MIGRATIONS_DIR, '.gitkeep'), '', 'utf8');
};

export const writeMigration = async (name: string, body: string): Promise<void> => {
  await fse.writeFile(
    path.join(MIGRATIONS_DIR, name),
    `'use strict';\nmodule.exports = { async up(knex) { ${body} } };\n`,
    'utf8',
  );
};

export interface BootedStrapi {
  // Core.Strapi at runtime; typed loosely to avoid heavy @strapi/types imports here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strapi: any;
  destroy: () => Promise<void>;
}

let compiledCtx: { appDir: string; distDir: string } | undefined;

export const bootStrapi = async (): Promise<BootedStrapi> => {
  if (!compiledCtx) {
    compiledCtx = await compileStrapi({ appDir: PLAYGROUND_DIR, ignoreDiagnostics: true });
  }
  const strapi = createStrapi({
    appDir: compiledCtx.appDir,
    distDir: compiledCtx.distDir,
    autoReload: false,
    serveAdminPanel: false,
  });
  await strapi.load();
  return {
    strapi,
    destroy: async () => {
      await strapi.destroy();
    },
  };
};
