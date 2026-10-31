import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getActiveOllamaModel } from '../config/ollama';

export async function generateCaption(req: AuthRequest, res: Response) {
  const { prompt, mediaType } = req.body;
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model = getActiveOllamaModel();
  const promptText = `Generate an engaging social media caption with 2-3 hashtags for a ${mediaType || 'post'} about: "${prompt || 'something inspiring'}".`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const resOllama = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: promptText,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resOllama.ok) {
      const errText = await resOllama.text();
      console.error(`❌ [Ollama Error HTTP ${resOllama.status}]:`, errText);
      return res.status(503).json({ error: 'The AI assistant is unavailable right now, please try again.' });
    }

    const data: any = await resOllama.json();
    const caption = data.response || '';

    return res.status(200).json({ caption: caption.trim() });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('❌ [Ollama Timeout] Request aborted after 30 seconds.');
    } else {
      console.error('❌ [Ollama Request Error]:', err.message || err);
    }
    return res.status(503).json({ error: 'The AI assistant is unavailable right now, please try again.' });
  }
}

export const generateCaptions = generateCaption;

export async function summarizePost(req: any, res: any) {
  return res.status(200).json({ summary: "Post summary placeholder" });
}
export async function aiChat(req: any, res: any) {
  return res.status(200).json({ reply: "Hello from Zumeko AI" });
}
export async function checkCommentSafety(commentText: string): Promise<{ isSafe: boolean; reason?: string }> {
  return { isSafe: true };
}
export async function testAiHealth(req: any, res: any) {
  return res.status(200).json({ status: "healthy" });
}
