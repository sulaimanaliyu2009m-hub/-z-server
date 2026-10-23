import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

export const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false
      }
    : {
        user: 'z_admin',
        password: 'z_secure_password',
        host: 'localhost',
        port: 5432,
        database: 'z_db'
      }
);

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log('✅ Connected to PostgreSQL successfully at:', res.rows[0].now);
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL Pool Error:', err.message);
});
