import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

// Route database traffic through Port 443 (HTTPS/WebSocket) to bypass ISP port 5432 block
neonConfig.webSocketConstructor = ws;

const dbUrl = process.env.DATABASE_URL || '';

export const pool = new Pool({
  connectionString: dbUrl,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message || err);
  } else {
    console.log('✅ Connected to Neon PostgreSQL over Port 443 successfully at:', res.rows[0].now);
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL Pool Error:', err);
});
