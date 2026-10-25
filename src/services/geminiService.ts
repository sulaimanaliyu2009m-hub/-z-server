import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

let aiClient: GoogleGenAI | null = null;
// Use gemini-3.8-flash as the primary modern model
let activeModelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export async function initializeGemini(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('⚠️ GEMINI_API_KEY is not set in Render environment variables.');
    return;
  }

  aiClient = new GoogleGenAI({ apiKey });

  try {
    const configured = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
      const fallback = availableNames.find((name) => name.includes('flash')) || 'gemini-3.8-flash';
      activeModelName = fallback;
      console.log(`🤖 Gemini AI model set to: ${activeModelName}`);
    }
  } catch (err: any) {
    console.warn(`⚠️ Model list notice: ${err.message}. Using: ${activeModelName}`);
  }
}

export const USER_SAFE_AI_ERROR = 'The AI assistant is unavailable right now, please try again.';

export async function callGemini(contents: any, config: any = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }

  const modelToUse = process.env.GEMINI_MODEL || activeModelName || 'gemini-3.8-flash';

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('AI_REQUEST_TIMEOUT')), 30000);
  });

  const apiPromise = aiClient.models.generateContent({
    model: modelToUse,
    contents,
    config,
  });

  const result: any = await Promise.race([apiPromise, timeoutPromise]);
  return result?.text || '';
}

export function getActiveModelName(): string {
  return activeModelName;
}
