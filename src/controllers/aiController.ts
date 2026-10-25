import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { callGemini, USER_SAFE_AI_ERROR, getActiveModelName } from '../services/geminiService';

// 1. Generate Captions & Hashtags
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
    console.error('❌ Server AI Caption Error:', err.message || err);
    res.status(503).json({ error: USER_SAFE_AI_ERROR });
  }
};

export const generateCaption = generateCaptions;

// 2. Summarize Post / Thread
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
    console.error('❌ Server AI Summary Error:', err.message || err);
    res.status(503).json({ error: USER_SAFE_AI_ERROR });
  }
};

// 3. Comment Safety Guard
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

// 4. AI Assistant Chat ("Ask Z") with History Sanitization
export const aiChat = async (req: AuthRequest, res: Response) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required.' });
  }

  try {
    // Format conversation history
    const rawHistory = messages.map((m: any) => ({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.text || '') }],
    }));

    // RULE: Gemini requires the first content to have role 'user'
    // Remove any initial AI greeting from the history sent to Google
    while (rawHistory.length > 0 && rawHistory[0].role === 'model') {
      rawHistory.shift();
    }

    if (rawHistory.length === 0) {
      return res.json({ reply: 'Hello! How can I help you today?' });
    }

    const reply = await callGemini(rawHistory, {
      systemInstruction:
        'You are the assistant for social network "Z". Help users brainstorm viral content, draft scripts, summarize topics, and answer questions concisely and politely.',
      temperature: 0.7,
    });

    res.json({ reply: reply || 'I am ready to help!' });
  } catch (err: any) {
    console.error('❌ Server AI Chat Error:', err.message || err);
    if (err.message === 'GEMINI_API_KEY_MISSING') {
      return res.status(503).json({ error: 'GEMINI_API_KEY is not configured in Render environment variables.' });
    }
    res.status(503).json({ error: USER_SAFE_AI_ERROR });
  }
};

// 5. Diagnostic Health Endpoint
export const testAiHealth = async (_req: any, res: Response) => {
  try {
    const reply = await callGemini('Say "AI is online!" in 4 words.');
    res.json({
      status: 'ok',
      activeModel: getActiveModelName(),
      response: reply.trim(),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'error',
      message: err.message,
      activeModel: getActiveModelName(),
    });
  }
};
