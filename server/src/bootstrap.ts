import type { PluginConfig, StrapiLike } from './types';
import { runPostMigrations } from './runner';

const PLUGIN_NAME = 'backfill-db-migrations';
const AUTORUN_ENV = 'STRAPI_POST_MIGRATIONS_AUTORUN';

const readBooleanEnv = (name: string): boolean | undefined => {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
};

export interface BootstrapStrapi extends StrapiLike {
  config: { get: (key: string, fallback?: unknown) => unknown };
  plugin: (name: string) => { config: (key: string) => unknown } | undefined;
}

const readPluginConfig = (strapi: BootstrapStrapi): PluginConfig => {
  const raw =
    (strapi.plugin?.(PLUGIN_NAME)?.config?.('') as PluginConfig | undefined) ??
    (strapi.config.get(`plugin::${PLUGIN_NAME}`, {}) as PluginConfig);
  return raw;
};

export const bootstrap = async ({ strapi }: { strapi: BootstrapStrapi }): Promise<void> => {
  const config = readPluginConfig(strapi);

  const envAutoRun = readBooleanEnv(AUTORUN_ENV);
  const autoRun = envAutoRun !== undefined ? envAutoRun : config.autoRun;

  if (!autoRun) {
    strapi.log.info(
      `[${PLUGIN_NAME}] auto-run disabled (env=${envAutoRun}, config=${config.autoRun}); skipping`,
    );
    return;
  }

  try {
    await runPostMigrations({ strapi, config });
  } catch (err) {
    strapi.log.error(`[${PLUGIN_NAME}] migration failed, aborting boot`, err);
    throw err;
  }
};

export default bootstrap;
