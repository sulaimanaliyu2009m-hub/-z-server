import { getActiveGeminiModel } from "../config/gemini";
import { Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { AuthRequest } from '../middleware/auth';

const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in z-server/.env');
  }
  return new GoogleGenAI({ apiKey });
};

// Clean, human-readable error messages
const formatAiError = (err: any): string => {
  const msg = String(err?.message || err);
  if (err?.status === 503 || msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')) {
    return 'Google Gemini is temporarily handling peak global traffic. Please try again in a few seconds.';
  }
  if (err?.status === 429 || msg.includes('429') || msg.includes('quota')) {
    return 'AI rate limit reached. Please wait a moment before sending another prompt.';
  }
  if (err?.status === 404 || msg.includes('404')) {
    return 'The requested Gemini model is not found. Check GEMINI_MODEL in your z-server/.env.';
  }
  return err?.message || 'AI request failed.';
};

// Resilient executor: retries with exponential backoff on transient errors (503/429)
async function executeWithRetry(fn: () => Promise<any>, maxRetries = 2): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isTransient = err?.status === 503 || msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE');

      if (isTransient && attempt < maxRetries) {
        const delay = (attempt + 1) * 1000;
        console.warn(`⚠️ Gemini 503 spike detected. Retrying in ${delay}ms (Attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// 1. Generate Captions & Hashtags
export const generateCaptions = async (req: AuthRequest, res: Response) => {
  const { prompt, mediaType } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Topic or prompt is required' });
  }

  const model = getActiveGeminiModel();

  try {
    const ai = getAiClient();
    const systemPrompt = `You are an elite social media content creator for the hybrid app "Z".
Generate caption ideas for a ${mediaType || 'post'} about: "${prompt.trim()}".
Return response strictly as JSON with this structure:
{
  "captions": ["caption 1", "caption 2", "caption 3"],
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

    const response = await executeWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: systemPrompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        }
      })
    );

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('Gemini Caption Error:', err.message);
    res.status(500).json({ error: formatAiError(err) });
  }
};

// 2. Summarize Post / Thread
export const summarizePost = async (req: AuthRequest, res: Response) => {
  const { content, comments } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Post content is required' });
  }

  const model = getActiveGeminiModel();

  try {
    const ai = getAiClient();
    const prompt = `Summarize this post and its discussion on social app Z.
Post: "${content}"
Comments: ${JSON.stringify(comments || [])}

Return strictly JSON with:
{
  "summary": "1-2 sentence executive summary",
  "keyTakeaways": ["point 1", "point 2", "point 3"]
}`;

    const response = await executeWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      })
    );

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('Gemini Summarize Error:', err.message);
    res.status(500).json({ error: formatAiError(err) });
  }
};

// 3. Comment Moderation Helper
export const checkCommentSafety = async (text: string): Promise<{ isSafe: boolean; reason?: string }> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return { isSafe: true };
  }

  const model = getActiveGeminiModel();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Analyze this social media comment for toxicity, hate speech, severe harassment, or malicious spam: "${text}".
Return strictly JSON with:
{
  "isSafe": true or false,
  "reason": "Brief explanation if unsafe, otherwise empty string"
}`;

    const response = await executeWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        }
      })
    );

    const result = JSON.parse(response.text || '{"isSafe": true}');
    return result;
  } catch {
    return { isSafe: true }; // Fail-open to avoid blocking comment posting if servers are down
  }
};

// 4. AI Assistant Chat ("Ask Z")
export const aiChat = async (req: AuthRequest, res: Response) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const model = getActiveGeminiModel();

  try {
    const ai = getAiClient();
    const conversationHistory = messages.map((m: any) => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    }));

    const response = await executeWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: conversationHistory,
        config: {
          systemInstruction: 'You are the intelligent core assistant of the social network "Z". You help users brainstorm viral content, draft scripts, summarize topics, write code for Kali Linux, and answer questions concisely and politely.',
          temperature: 0.7
        }
      })
    );

    res.json({ reply: response.text || 'No response generated.' });
  } catch (err: any) {
    console.error('Gemini Chat Error:', err.message);
    res.status(500).json({ error: formatAiError(err) });
  }
};

export const generateCaption = generateCaptions;
