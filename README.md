
## Troubleshooting Guide

### 1. Login Stuck on "Please wait..."
* **Root Cause**: Render free instances enter cold sleep after inactivity.
* **Resolution**:
  - The client invokes `GET /health` immediately on load to start warming up the container.
  - After 4 seconds of waiting, the UI informs the user that the server is waking up and renders an active **Cancel** button.
  - Queries to the Neon PostgreSQL database automatically retry once if the connection pool is resuming from a cold state.
  - All form loading states are cleared in a `finally` block to prevent disabled buttons.

### 2. Gemini "Model Not Found"
* **Root Cause**: Incorrect model identifier specified in `GEMINI_MODEL` or key restrictions.
* **Resolution**:
  - On server start, `initializeGemini()` queries the Google API to verify available models for the given API key.
  - If the requested model is absent, it safely falls back to the first available Flash model.
  - Client responses hide server details and display: *"The AI assistant is unavailable right now, please try again"*.
  - Calls timeout after 30 seconds and are rate-limited to 10 requests per minute per user.

### 3. Video Upload "Failed to generate signed upload URL"
* **Root Cause**: Missing S3 environment variables, incorrect checksum configuration, or missing R2 CORS settings.
* **Resolution**:
  - The S3 client sets `region: "auto"` and `requestChecksumCalculation: "WHEN_REQUIRED"` so presigned PUT URLs succeed with Cloudflare R2.
  - Missing variables (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CDN_URL`) are flagged at server startup.
  - Use `GET /health/storage` to verify presigning.
  - The bucket CORS policy must match `cloudflare-r2-cors.json`.

### 4. Video Length Rules
* **Root Cause**: Hardcoded 60-second limit and arbitrary minimums.
* **Resolution**:
  - Clips as short as 1 second are accepted.
  - Upper limits are configured via `MAX_VIDEO_SECONDS` (default: 300) and `MAX_VIDEO_MB` (default: 100).
  - The upload interface displays: *"Up to X minutes"* based on server configuration.
