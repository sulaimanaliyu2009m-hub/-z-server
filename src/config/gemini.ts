import dotenv from 'dotenv';

dotenv.config();

let activeGeminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

export async function initializeGemini(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ [Gemini] GEMINI_API_KEY is not defined. AI routes will be disabled.');
    return;
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) {
      console.error(`❌ [Gemini] Could not list models (HTTP ${response.status}).`);
      return;
    }

    const data: any = await response.json();
    const models: { name: string }[] = data.models || [];
    const available = models.map((m) => m.name.replace(/^models\//, ''));

    const requested = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (available.includes(requested)) {
      activeGeminiModel = requested;
      console.log(`✅ [Gemini] Verified model "${activeGeminiModel}" active.`);
    } else {
      const fallback = available.find((m) => m.includes('flash')) || available[0];
      if (fallback) {
        console.warn(`⚠️ [Gemini] Model "${requested}" not found. Falling back to "${fallback}".`);
        activeGeminiModel = fallback;
      } else {
        console.error('❌ [Gemini] No compatible text generation models available.');
      }
    }
  } catch (err: any) {
    console.error('❌ [Gemini Startup] Model check failed:', err.message || err);
  }
}

export function getActiveGeminiModel(): string {
  return activeGeminiModel;
}
