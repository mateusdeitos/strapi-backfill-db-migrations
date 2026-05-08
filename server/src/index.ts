import bootstrap from './bootstrap';
import register from './register';
import config from './config';

export { runPostMigrations } from './runner';
export type { PluginConfig, PostMigrationModule } from './types';

export default {
  register,
  bootstrap,
  config,
};
