import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const { image } = await req.json();
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

    const base64Content = image.split(",")[1];
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Content, mimeType: "image/jpeg" } },
    ]);

    const response = await result.response;
    let text = response.text().trim().replace(/```json|```/g, "");
    
    const data = JSON.parse(text);
    return NextResponse.json({ success: true, ...data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}