import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';

// Force IPv4 first to prevent MTN cellular timeouts on Node 24
dns.setDefaultResultOrder('ipv4first');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

// Route through Port 443 WebSockets
neonConfig.webSocketConstructor = ws;

// Remove -pooler because Neon WebSocket proxy (/v2) requires the direct host
const rawUrl = process.env.DATABASE_URL || '';
const dbUrl = rawUrl.replace('-pooler', '');

export const pool = new Pool({
  connectionString: dbUrl,
  connectionTimeoutMillis: 15000,
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
      console.warn('⚠️ Neon database waking from sleep. Retrying query in 2s...');
      await new Promise((res) => setTimeout(res, 2000));
      return await pool.query(text, params);
    }
    throw error;
  }
}
