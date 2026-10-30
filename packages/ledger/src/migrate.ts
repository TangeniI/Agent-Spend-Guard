import { createDb, migrate } from './db.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, close } = createDb(url, { max: 1 });
await migrate(db);
await close();
console.log('migrations applied');
