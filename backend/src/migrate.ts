import fs from 'fs';
import path from 'path';
import { pool } from './db';

const schemaPath = path.resolve(__dirname, '../db/schema.sql');

export async function migrate(): Promise<void> {
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));
}

/** Test helper: wipe everything and re-create the schema. */
export async function resetDatabase(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Database schema is up to date.'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
