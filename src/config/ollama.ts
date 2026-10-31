import dotenv from 'dotenv';

dotenv.config();

let activeOllamaModel = process.env.OLLAMA_MODEL || 'llama3';

export async function initializeOllama(): Promise<void> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');

  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) {
      console.warn(`⚠️ [Ollama] Could not fetch models from tags endpoint (HTTP ${res.status}). Using default model.`);
      return;
    }

    const data: any = await res.json();
    const availableModels: string[] = (data.models || []).map((m: any) => m.name);

    const configured = process.env.OLLAMA_MODEL || 'llama3';
    const fallbacks = (process.env.OLLAMA_FALLBACK_MODELS || 'llama3,mistral,phi3').split(',').map(s => s.trim());

    if (availableModels.includes(configured)) {
      activeOllamaModel = configured;
      console.log(`✅ [Ollama] Model "${activeOllamaModel}" verified and active.`);
    } else {
      const match = fallbacks.find((f) => availableModels.includes(f)) || availableModels[0];
      if (match) {
        console.warn(`⚠️ [Ollama] Configured model "${configured}" not found. Falling back to "${match}".`);
        activeOllamaModel = match;
      } else {
        console.warn(`⚠️ [Ollama] No matching models found in tags list. Using configured default: "${configured}".`);
      }
    }
  } catch (err: any) {
    console.warn('⚠️ [Ollama Startup] Connection failed. Ensure Ollama service is running:', err.message || err);
  }
}

export function getActiveOllamaModel(): string {
  return activeOllamaModel;
}
