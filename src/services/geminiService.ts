import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const activeModelName = 'gemini-3.8-flash';

export async function initializeGemini(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('⚠️ GEMINI_API_KEY is not set in Render environment variables.');
    return;
  }
  console.log(`🤖 Gemini AI initialized using Direct REST API with model: ${activeModelName}`);
}

export const USER_SAFE_AI_ERROR = 'The AI assistant is unavailable right now, please try again.';

export async function callGemini(contents: any, config: any = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  let formattedContents = contents;
  if (typeof contents === 'string') {
    formattedContents = [{ parts: [{ text: contents }] }];
  } else if (Array.isArray(contents)) {
    formattedContents = contents.map((c: any) => {
      if (c.role && c.parts) return c;
      return { role: c.sender === 'user' ? 'user' : 'model', parts: [{ text: c.text || '' }] };
    });
  }

  const payload: any = {
    contents: formattedContents,
  };

  if (config.systemInstruction) {
    payload.systemInstruction = { parts: [{ text: config.systemInstruction }] };
  }

  if (config.responseMimeType) {
    payload.generationConfig = {
      responseMimeType: config.responseMimeType,
      temperature: config.temperature ?? 0.7,
    };
  } else if (config.temperature !== undefined) {
    payload.generationConfig = { temperature: config.temperature };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    
    // Cast to any to satisfy TypeScript compilation rules
    const data = (await response.json()) as any;

    if (!response.ok) {
      console.error('❌ Gemini REST API Error:', JSON.stringify(data));
      throw new Error(data?.error?.message || 'Gemini API error');
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error('❌ Gemini Fetch Failed:', err.message || err);
    throw err;
  }
}

export function getActiveModelName(): string {
  return activeModelName;
}
