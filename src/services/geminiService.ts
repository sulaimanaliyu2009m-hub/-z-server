import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let aiClient: GoogleGenAI | null = null;
let activeModelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export async function initializeGemini(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('⚠️ GEMINI_API_KEY is not set in Render environment variables.');
    return;
  }

  aiClient = new GoogleGenAI({ apiKey });
  console.log(`🤖 Gemini AI initialized with model: ${activeModelName}`);
}

export const USER_SAFE_AI_ERROR = 'The AI assistant is unavailable right now, please try again.';

// Wrapper with 60-second timeout and detailed error logging
export async function callGemini(contents: any, config: any = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }

  const modelToUse = process.env.GEMINI_MODEL || activeModelName || 'gemini-3.8-flash';

  console.log(`🤖 Sending request to Gemini (${modelToUse})...`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('AI_REQUEST_TIMEOUT_60S')), 60000);
  });

  try {
    const apiPromise = aiClient.models.generateContent({
      model: modelToUse,
      contents,
      config,
    });

    const result: any = await Promise.race([apiPromise, timeoutPromise]);
    console.log('✅ Gemini responded successfully.');
    return result?.text || '';
  } catch (err: any) {
    console.error('❌ Gemini API Error Details:', err.message || err);
    throw err;
  }
}

export function getActiveModelName(): string {
  return activeModelName;
}
