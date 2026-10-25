import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Enable WebSocket transport over Port 443 (bypasses ISP port 5432 blocking)
neonConfig.webSocketConstructor = ws;

const dbUrl = process.env.DATABASE_URL || '';

if (!dbUrl) {
  console.error('❌ DATABASE_URL is not set in z-server/.env');
}

export const pool = new Pool({
  connectionString: dbUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL Pool Idle Client Error:', err.message);
});

// Retries query once after a brief delay if Neon is waking from compute suspension
export async function executeQueryWithRetry(text: string, params: any[] = []): Promise<any> {
  try {
    return await pool.query(text, params);
  } catch (err: any) {
    const isColdStart =
      err.code === '57P01' ||
      err.message?.includes('connection') ||
      err.message?.includes('timeout') ||
      err.message?.includes('terminating connection');
    if (isColdStart) {
      console.warn('⚠️ Neon database is waking up. Retrying query in 1.5s...');
      await new Promise((r) => setTimeout(r, 1500));
      return await pool.query(text, params);
    }
    throw err;
  }
}

// Deep health diagnostic for /health/deep
export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await executeQueryWithRetry('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}
