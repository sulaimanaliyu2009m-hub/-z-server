import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let aiClient: GoogleGenAI | null = null;
let activeModelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function initializeGemini(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('⚠️ GEMINI_API_KEY is not set. AI features will respond with user-safe unavailable message.');
    return;
  }

  aiClient = new GoogleGenAI({ apiKey });

  try {
    const configured = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const modelsList = await aiClient.models.list();
    const availableNames: string[] = [];

    for await (const m of modelsList) {
      if (m.name) {
        availableNames.push(m.name.replace(/^models\//, ''));
      }
    }

    if (availableNames.includes(configured)) {
      activeModelName = configured;
      console.log(`🤖 Gemini AI active model: ${activeModelName}`);
    } else {
      // Find first available Flash model
      const fallback = availableNames.find((name) => name.includes('flash')) || availableNames[0];
      if (fallback) {
        console.warn(`⚠️ Configured model "${configured}" not found in your API key tier. Falling back to: "${fallback}"`);
        activeModelName = fallback;
      } else {
        activeModelName = configured;
      }
    }
  } catch (err: any) {
    console.warn(`⚠️ Unable to inspect Gemini models at startup (${err.message}). Using: ${activeModelName}`);
  }
}

// User-facing sanitized error: Never leaks server details, model IDs, or env var names
export const USER_SAFE_AI_ERROR = 'The AI assistant is unavailable right now, please try again.';

// Wrapper with 30-second hard timeout
export async function callGemini(contents: any, config: any = {}): Promise<string> {
  if (!aiClient) {
    throw new Error('AI_CLIENT_NOT_INITIALIZED');
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('AI_REQUEST_TIMEOUT')), 30000);
  });

  const apiPromise = aiClient.models.generateContent({
    model: activeModelName,
    contents,
    config,
  });

  const result: any = await Promise.race([apiPromise, timeoutPromise]);
  return result?.text || '';
}

export function getActiveModelName(): string {
  return activeModelName;
}
