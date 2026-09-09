/**
 * Upload the caller's profile picture to the `avatars` storage bucket, then point
 * `users.avatar_url` at it.
 *
 * Same posture as `/api/profile/update`: the browser has no direct write path to `users` or to
 * storage, so this route holds the service-role key and does both writes after verifying the
 * session. The object is named by `userId`, not a random id — a re-upload overwrites the same
 * path (`upsert: true`) rather than accumulating orphaned files with nothing pointing at them.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';

const BUCKET = 'avatars';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const image = typeof body.image === 'string' ? body.image : '';

    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return NextResponse.json({ error: 'Expected a base64 image data URL' }, { status: 400 });

    const [, mimeType, base64Data] = match;
    const extension = ALLOWED_MIME[mimeType];
    if (!extension) {
      return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are allowed' }, { status: 400 });
    }

    const bytes = Buffer.from(base64Data, 'base64');
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be under 5MB' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const path = `${session.userId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    // Cache-busted — the path is stable per user, so without this a browser or CDN that already
    // cached the old image would keep showing it after a re-upload.
    const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', session.userId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, avatarUrl });
  } catch (error) {
    console.error('[profile/avatar] failed:', error);
    return NextResponse.json({ error: 'Could not upload profile picture' }, { status: 500 });
  }
}
