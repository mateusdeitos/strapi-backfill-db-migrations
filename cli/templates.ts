export const tsTemplate = (description: string): string => `import type { Knex } from 'knex';

/**
 * ${description}
 */
export async function up(knex: Knex): Promise<void> {
  // Write the SQL / Knex queries you need to backfill data here.
  // This runs *after* Strapi's schema sync, so new columns already exist.
  //
  // Example:
  // await knex('articles')
  //   .whereNull('slug')
  //   .update({ slug: knex.raw("LOWER(REPLACE(title, ' ', '-'))") });
}
`;

export const jsTemplate = (description: string): string => `'use strict';

/**
 * ${description}
 */
module.exports = {
  /** @param {import('knex').Knex} knex */
  async up(knex) {
    // Write the SQL / Knex queries you need to backfill data here.
    // This runs *after* Strapi's schema sync, so new columns already exist.
    //
    // Example:
    // await knex('articles')
    //   .whereNull('slug')
    //   .update({ slug: knex.raw("LOWER(REPLACE(title, ' ', '-'))") });
  },
};
`;

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'migration';

export const timestamp = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}` +
    `-${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  );
};
