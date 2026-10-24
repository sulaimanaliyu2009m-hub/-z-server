import { pool } from '../config/db';

const PYTHON_RECOMMENDER_URL = process.env.RECOMMENDER_SERVICE_URL || 'http://localhost:8000';

interface RankedItem {
  id: string;
  final_score: number;
}

export const recommendationClient = {
  async getRankedVideoIds(userId: string, limit = 30): Promise<string[]> {
    // 1. Try Python FastAPI microservice (with 1.5s timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    try {
      const res = await fetch(`${PYTHON_RECOMMENDER_URL}/recommend/for-you`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, limit }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        if (Array.isArray((json as any).results) && (json as any).results.length > 0) {
          return (json as any).results.map((r: RankedItem) => r.id);
        }
      }
    } catch {
      clearTimeout(timeoutId);
      console.warn('⚠️ Python recommendation service unreachable. Falling back to SQL ranking.');
    }

    // 2. RESILIENT FALLBACK: Pure SQL weighted ranking query
    try {
      const fallbackQuery = `
        SELECT p.id
        FROM posts p
        LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
        LEFT JOIN (SELECT post_id, AVG(completion_rate) AS avg_comp FROM video_views GROUP BY post_id) v ON v.post_id = p.id
        WHERE p.post_type = 'video' AND p.media_url IS NOT NULL
        ORDER BY (COALESCE(v.avg_comp, 0) * 0.4 + COALESCE(l.likes_count, 0) * 0.3 + EXTRACT(EPOCH FROM p.created_at) / 1000000.0 * 0.3) DESC
        LIMIT $1;
      `;
      const { rows } = await pool.query(fallbackQuery, [limit]);
      return rows.map(r => r.id);
    } catch {
      return [];
    }
  }
};
