import { randomUUID } from 'node:crypto';
import pg from 'pg';

const adminUrl =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://asg:asg@localhost:5433/postgres';

export interface TestDatabase {
  url: string;
  drop: () => Promise<void>;
}

async function asAdmin(statement: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Creates an empty, uniquely named database so test runs can't see each other. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `asg_test_${randomUUID().replaceAll('-', '')}`;
  await asAdmin(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => asAdmin(`DROP DATABASE ${name} WITH (FORCE)`) };
}
