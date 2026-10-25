import { pool, queryWithRetry } from '../config/db';
import crypto from 'crypto';

async function runRegressionTest() {
  console.log('🧪 Starting Profile and Follow Regression Test...');

  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  const usernameA = `test_a_${Date.now()}`;
  const usernameB = `test_b_${Date.now()}`;

  try {
    // 1. Create Test Users A and B
    await queryWithRetry(`
      INSERT INTO users (id, email, username, display_name, password_hash)
      VALUES 
        ($1, $2, $3, 'User A', 'hash'),
        ($4, $5, $6, 'User B', 'hash')
    `, [idA, `${usernameA}@test.com`, usernameA, idB, `${usernameB}@test.com`, usernameB]);

    // 2. Post a post for User B
    await queryWithRetry(`
      INSERT INTO posts (user_id, content) VALUES ($1, 'Hello from User B!')
    `, [idB]);

    // 3. User A follows User B
    await queryWithRetry(`
      INSERT INTO follows (follower_id, following_id, status) VALUES ($1, $2, 'accepted')
    `, [idA, idB]);

    // 4. Verify User B Profile as viewed by User A
    const profileQuery = `
      SELECT 
        u.id, u.username,
        (SELECT COUNT(*)::int FROM follows WHERE following_id = u.id AND status = 'accepted') AS followers_count,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id AND status = 'accepted') AS is_following,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = $2 AND status = 'accepted') AS follows_you
      FROM users u WHERE u.id = $1
    `;

    const resB = await queryWithRetry(profileQuery, [idB, idA]);
    const bData = resB.rows[0];

    console.assert(bData.followers_count === 1, `Expected followers_count = 1, got ${bData.followers_count}`);
    console.assert(bData.is_following === true, `Expected is_following = true, got ${bData.is_following}`);
    console.assert(bData.follows_you === false, `Expected follows_you = false, got ${bData.follows_you}`);

    // 5. Verify User A Profile as viewed by User B (Reverse check)
    const resA = await queryWithRetry(profileQuery, [idA, idB]);
    const aData = resA.rows[0];

    console.assert(aData.follows_you === true, `Expected follows_you = true for User B viewing A`);
    console.assert(aData.is_following === false, `Expected is_following = false for User B viewing A`);

    console.log('✅ All profile and follow verification tests PASSED.');
  } finally {
    // Clean up test data
    await queryWithRetry('DELETE FROM users WHERE id IN ($1, $2)', [idA, idB]);
    process.exit(0);
  }
}

runRegressionTest().catch((err) => {
  console.error('❌ Regression test failed:', err);
  process.exit(1);
});
