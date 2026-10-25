import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

neonConfig.webSocketConstructor = ws;

let dbUrl = process.env.DATABASE_URL || '';

// Normalize connection string to Neon pooled endpoint if not already specified
if (dbUrl.includes('neon.tech') && !dbUrl.includes('-pooler')) {
  dbUrl = dbUrl.replace(/@([^/]+)/, '@$1-pooler');
}

export const pool = new Pool({
  connectionString: dbUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function queryWithRetry(text: string, params?: any[]): Promise<any> {
  try {
    return await pool.query(text, params);
  } catch (error: any) {
    const isColdStart =
      error.message?.includes('Connection terminated') ||
      error.message?.includes('timeout') ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT';

    if (isColdStart) {
      console.warn('⚠️ Neon database waking up. Retrying query in 1500ms...');
      await new Promise((res) => setTimeout(res, 1500));
      return await pool.query(text, params);
    }
    throw error;
  }
}
