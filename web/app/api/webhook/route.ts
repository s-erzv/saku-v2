import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Jangan lakukan transfer / logic uang dulu
    // Cukup acknowledge bahwa event diterima
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook payload" },
      { status: 400 }
    );
  }
}