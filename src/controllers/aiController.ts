import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getActiveGeminiModel } from '../config/gemini';

export async function generateCaption(req: AuthRequest, res: Response) {
  const { prompt, mediaType } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({ error: 'The AI assistant is unavailable right now, please try again.' });
  }

  const model = getActiveGeminiModel();
  const promptText = `Generate an engaging social media caption with 2-3 hashtags for a ${mediaType || 'post'} about: "${prompt || 'something inspiring'}".`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`❌ [Gemini Error HTTP ${geminiRes.status}]:`, errText);
      return res.status(503).json({ error: 'The AI assistant is unavailable right now, please try again.' });
    }

    const data: any = await geminiRes.json();
    const caption = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.status(200).json({ caption: caption.trim() });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('❌ [Gemini Timeout] 30-second execution exceeded.');
    } else {
      console.error('❌ [Gemini Request Error]:', err.message || err);
    }
    return res.status(503).json({ error: 'The AI assistant is unavailable right now, please try again.' });
  }
}
