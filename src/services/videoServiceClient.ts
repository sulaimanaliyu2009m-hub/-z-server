const GO_SERVICE_URL = process.env.GO_VIDEO_SERVICE_URL || 'http://localhost:8080';

export const videoServiceClient = {
  // 1. Record high-concurrency view in Go
  async recordView(videoId: string, userId?: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800); // 800ms fast timeout

    try {
      const res = await fetch(`${GO_SERVICE_URL}/api/v1/views/increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, userId }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      clearTimeout(timeout);
      // Fallback: Continue without failing
      return false;
    }
  },

  // 2. Fetch high-speed cached feed from Go
  async getFastFeed(): Promise<any[] | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);

    try {
      const res = await fetch(`${GO_SERVICE_URL}/api/v1/feed`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
      return null;
    } catch {
      clearTimeout(timeout);
      return null; // Fallback to Node.js DB query
    }
  },

  // 3. Sync hot feed to Go memory cache
  async syncFeedCache(videos: any[]): Promise<void> {
    try {
      await fetch(`${GO_SERVICE_URL}/api/v1/feed/cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos })
      });
    } catch {}
  }
};
