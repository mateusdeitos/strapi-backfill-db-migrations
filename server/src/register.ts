import type { StrapiLike } from './types';

export const register = ({ strapi }: { strapi: StrapiLike }): void => {
  strapi.log.debug?.('[backfill-db-migrations] plugin registered');
};

export default register;
