import type { Knex } from 'knex';

export interface PluginConfig {
  enabled: boolean;
  autoRun: boolean;
  directory: string;
  tableName: string;
}

export type PluginUserConfig = Partial<PluginConfig>;

export interface PostMigrationModule {
  up: (knex: Knex, db?: unknown) => Promise<void> | void;
}

export interface MigrationFile {
  name: string;
  absolutePath: string;
}

export interface StrapiLikeLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  debug?: (msg: string) => void;
}

export interface StrapiLike {
  db: { connection: Knex };
  log: StrapiLikeLogger;
  dirs: { app: { root: string } };
}

export interface RunnerDeps {
  strapi: StrapiLike;
  config: PluginConfig;
}
