import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { callGemini, USER_SAFE_AI_ERROR } from '../services/geminiService';

export const generateCaptions = async (req: AuthRequest, res: Response) => {
  const { prompt, mediaType } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Topic or prompt is required.' });
  }

  try {
    const systemPrompt = `You are an elite social media content creator for the app "Z".
Generate caption ideas for a ${mediaType || 'post'} about: "${prompt.trim()}".
Return response strictly as JSON with this structure:
{
  "captions": ["caption 1", "caption 2", "caption 3"],
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

    const text = await callGemini(systemPrompt, {
      responseMimeType: 'application/json',
      temperature: 0.7,
    });

    const parsed = JSON.parse(text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('❌ Server AI Caption Error (Internal):', err.message || err);
    res.status(503).json({ error: USER_SAFE_AI_ERROR });
  }
};

// Export alias expected by aiRoutes.ts
export const generateCaption = generateCaptions;

export const summarizePost = async (req: AuthRequest, res: Response) => {
  const { content, comments } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Post content is required.' });
  }

  try {
    const prompt = `Summarize this post and its discussion on social app Z.
Post: "${content}"
Comments: ${JSON.stringify(comments || [])}

Return strictly JSON with:
{
  "summary": "1-2 sentence executive summary",
  "keyTakeaways": ["point 1", "point 2", "point 3"]
}`;

    const text = await callGemini(prompt, {
      responseMimeType: 'application/json',
    });

    const parsed = JSON.parse(text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('❌ Server AI Summary Error (Internal):', err.message || err);
    res.status(503).json({ error: USER_SAFE_AI_ERROR });
  }
};

export const checkCommentSafety = async (text: string): Promise<{ isSafe: boolean; reason?: string }> => {
  try {
    const prompt = `Analyze this social media comment for severe toxicity, hate speech, or malicious spam: "${text}".
Return strictly JSON with:
{
  "isSafe": true or false,
  "reason": "Brief explanation if unsafe, otherwise empty string"
}`;

    const responseText = await callGemini(prompt, {
      responseMimeType: 'application/json',
      temperature: 0.1,
    });

    return JSON.parse(responseText || '{"isSafe": true}');
  } catch {
    return { isSafe: true };
  }
};

export const aiChat = async (req: AuthRequest, res: Response) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required.' });
  }

  try {
    const conversationHistory = messages.map((m: any) => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const reply = await callGemini(conversationHistory, {
      systemInstruction:
        'You are the assistant for social network "Z". Help users brainstorm viral content, draft scripts, summarize topics, and answer questions concisely and politely.',
      temperature: 0.7,
    });

    res.json({ reply: reply || 'No response generated.' });
  } catch (err: any) {
    console.error('❌ Server AI Chat Error (Internal):', err.message || err);
    res.status(503).json({ error: USER_SAFE_AI_ERROR });
  }
};
