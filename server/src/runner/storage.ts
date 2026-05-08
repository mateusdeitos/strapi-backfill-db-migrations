import type { Knex } from 'knex';

export const ensureTrackingTable = async (knex: Knex, tableName: string): Promise<void> => {
  const exists = await knex.schema.hasTable(tableName);
  if (exists) return;

  await knex.schema.createTable(tableName, (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable().unique();
    table.timestamp('time', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });
};

export const listExecuted = async (knex: Knex, tableName: string): Promise<string[]> => {
  const rows = await knex<{ name: string }>(tableName).select('name').orderBy('name', 'asc');
  return rows.map((r) => r.name);
};

export const recordExecuted = async (
  trx: Knex.Transaction,
  tableName: string,
  name: string,
): Promise<void> => {
  await trx(tableName).insert({ name, time: new Date() });
};
