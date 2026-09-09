/**
 * Receipt scan for split-bill (PRD non-goal — a v1 feature, kept per the user's explicit choice
 * to treat the PRD as a minimum baseline rather than a scope limiter).
 *
 * This existed in the codebase with none of v2's routing conventions: no session check, so
 * anyone who found the URL could burn through GEMINI_API_KEY's quota for free. Fixed here, not
 * rewritten — the Gemini call and prompt are unchanged.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP } from '@/lib/auth-middleware';

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const clientIP = extractClientIP(request) || 'unknown';
  if (!rateLimiter.check(`ocr:${clientIP}`, RATE_LIMITS.IP_BASED).allowed) {
    return NextResponse.json({ error: 'Too many scans. Try again shortly.' }, { status: 429 });
  }

  try {
    const { image } = await request.json();
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Expected a base64 image data URL' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
      Analyze this receipt image. Extract these details:
      1. Store/Merchant name or a brief description of the receipt (e.g., "Starbucks Coffee").
      2. All line items with their name, unit price, and quantity (qty).
      3. Total tax (including PPN, service charges, etc).
      4. Total discount (if any).

      Return ONLY a JSON object:
      {
        "description": "Merchant Name/Event",
        "items": [{"name": "Item Name", "price": 15000, "qty": 2}],
        "totalTax": 5000,
        "totalDiscount": 0
      }
      Important:
      - If qty is not found, assume 1.
      - Ensure all numbers are integers (no strings for prices).
      - Return ONLY the raw JSON.
    `;

    const [, mimeType, base64Content] = image.match(/^data:(image\/\w+);base64,(.+)$/) ?? [];
    if (!base64Content) return NextResponse.json({ error: 'Malformed image data' }, { status: 400 });

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Content, mimeType: mimeType || 'image/jpeg' } },
    ]);

    const text = result.response.text().trim().replace(/```json|```/g, '');
    const data = JSON.parse(text);

    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that receipt';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
