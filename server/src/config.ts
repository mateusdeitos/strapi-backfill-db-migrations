import type { PluginConfig, PluginUserConfig } from './types';

export const defaultConfig: PluginConfig = {
  enabled: true,
  autoRun: true,
  directory: 'database/migrations-post',
  tableName: 'strapi_migrations_post',
};

const validate = (config: PluginUserConfig): void => {
  if (config.directory !== undefined && typeof config.directory !== 'string') {
    throw new Error('[backfill-db-migrations] config.directory must be a string');
  }
  if (config.tableName !== undefined && typeof config.tableName !== 'string') {
    throw new Error('[backfill-db-migrations] config.tableName must be a string');
  }
  if (config.autoRun !== undefined && typeof config.autoRun !== 'boolean') {
    throw new Error('[backfill-db-migrations] config.autoRun must be a boolean');
  }
};

export default {
  default: defaultConfig,
  validator: validate,
};
