/**
 * Draws a payment request onto a canvas and returns it as a PNG blob.
 *
 * Same reasoning as `lib/receipt-image.ts`, and deliberately the same paper: a saved QR is a
 * thing people put in a chat or print and tape to a counter, so it should carry the amount, the
 * note and the code alongside the code square — a bare QR image tells the person holding it
 * nothing about what they are about to pay.
 *
 * The QR itself is composited from a `<QRCodeCanvas>` the page already renders offscreen, rather
 * than re-encoded here: one encoder, so what is downloaded is exactly what was on screen.
 */

import { PAPER } from '@/lib/receipt-content';

const WIDTH = 720;
const SCALE = 2;
const PAD = 56;
const TOOTH_W = 30;
const TOOTH_H = 17;

function family(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `${value}, ${fallback}` : fallback;
}

/** A perforated sheet, so a saved QR reads as part of the same family as a Saku receipt. */
function paperPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(0, TOOTH_H);
  for (let x = 0; x < w; x += TOOTH_W) {
    ctx.lineTo(x + TOOTH_W / 2, 0);
    ctx.lineTo(x + TOOTH_W, TOOTH_H);
  }
  ctx.lineTo(w, h - TOOTH_H);
  for (let x = w; x > 0; x -= TOOTH_W) {
    ctx.lineTo(x - TOOTH_W / 2, h);
    ctx.lineTo(x - TOOTH_W, h - TOOTH_H);
  }
  ctx.closePath();
}

async function loadMark(): Promise<HTMLImageElement | null> {
  const attempt = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/icons/saku-mark.png';
  });
  return Promise.race([attempt, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
}

export interface QrCardOptions {
  /** The offscreen `<QRCodeCanvas>` the page rendered. */
  qrCanvas: HTMLCanvasElement;
  code: string;
  /** Formatted USDC amount, or null for "any amount". */
  amount: string | null;
  /** The same amount in the payer's local currency, when a rate was available. */
  localAmount: string | null;
  note: string | null;
  payeeName: string | null;
}

export async function generateQrImage(options: QrCardOptions): Promise<Blob> {
  const fonts = {
    mono: family('--font-receipt', 'ui-monospace, SFMono-Regular, Menlo, monospace'),
    sans: family('--font-geist', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
  };

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // A font that never resolves is not a reason to fail the download.
    }
  }

  const mark = await loadMark();

  const qrSize = 380;
  // Laid out top-down, then the sheet is cut to whatever the content came to.
  const height =
    TOOTH_H + PAD + 40 + 34 + (options.amount ? 96 : 62) + (options.localAmount ? 30 : 0) +
    (options.note ? 40 : 0) + 34 + qrSize + 54 + 40 + PAD + TOOTH_H;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = Math.round(height) * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.scale(SCALE, SCALE);

  paperPath(ctx, WIDTH, height);
  const stock = ctx.createLinearGradient(0, 0, 0, height);
  stock.addColorStop(0, PAPER.top);
  stock.addColorStop(1, PAPER.bottom);
  ctx.fillStyle = stock;
  ctx.fill();

  const left = PAD;
  const right = WIDTH - PAD;
  let y = TOOTH_H + PAD;

  // Letterhead
  const markSize = 40;
  let wordmarkX = left;
  if (mark) {
    ctx.drawImage(mark, left, y - markSize + 6, markSize, markSize);
    wordmarkX = left + markSize + 10;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = PAPER.ink;
  ctx.font = `900 32px ${fonts.sans}`;
  ctx.fillText('saku', wordmarkX, y);

  ctx.textAlign = 'right';
  ctx.fillStyle = PAPER.muted;
  ctx.font = `700 14px ${fonts.sans}`;
  ctx.fillText('PAYMENT REQUEST', right, y - 6);

  y += 40;
  ctx.textAlign = 'center';
  ctx.fillStyle = PAPER.muted;
  ctx.font = `400 16px ${fonts.mono}`;
  ctx.fillText(options.payeeName ? `PAY ${options.payeeName.toUpperCase()}` : 'SCAN TO PAY', WIDTH / 2, y);

  // Amount, or the honest absence of one.
  y += options.amount ? 90 : 56;
  ctx.fillStyle = PAPER.ink;
  if (options.amount) {
    // Measured, then laid out left-aligned from a computed start, so the figure and its unit
    // centre as one block. Nudging a centred string by a guessed offset leaves it visibly off.
    const amountFont = `900 66px ${fonts.sans}`;
    const unitFont = `700 24px ${fonts.mono}`;
    const gap = 12;

    ctx.font = amountFont;
    const amountWidth = ctx.measureText(options.amount).width;
    ctx.font = unitFont;
    const unitWidth = ctx.measureText('USDC').width;

    const startX = WIDTH / 2 - (amountWidth + gap + unitWidth) / 2;
    ctx.textAlign = 'left';
    ctx.font = amountFont;
    ctx.fillStyle = PAPER.ink;
    ctx.fillText(options.amount, startX, y);
    ctx.font = unitFont;
    ctx.fillStyle = PAPER.muted;
    ctx.fillText('USDC', startX + amountWidth + gap, y);
    ctx.textAlign = 'center';
  } else {
    ctx.font = `700 30px ${fonts.sans}`;
    ctx.fillText('Any amount', WIDTH / 2, y);
  }

  if (options.localAmount) {
    y += 30;
    ctx.fillStyle = PAPER.muted;
    ctx.font = `600 20px ${fonts.sans}`;
    ctx.fillText(options.localAmount, WIDTH / 2, y);
  }

  if (options.note) {
    y += 38;
    ctx.fillStyle = 'rgba(20,18,16,0.55)';
    ctx.font = `500 20px ${fonts.sans}`;
    // One line only; a note long enough to wrap belongs in the app, not on a printed card.
    const note = options.note.length > 44 ? `${options.note.slice(0, 43)}…` : options.note;
    ctx.fillText(note, WIDTH / 2, y);
  }

  // The QR, on white — a code on cream scans less reliably, and the quiet zone matters.
  y += 34;
  const qrX = WIDTH / 2 - qrSize / 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(qrX - 16, y - 16, qrSize + 32, qrSize + 32, 24);
  ctx.fill();
  ctx.drawImage(options.qrCanvas, qrX, y, qrSize, qrSize);

  y += qrSize + 54;
  ctx.fillStyle = PAPER.ink;
  ctx.font = `700 26px ${fonts.mono}`;
  ctx.fillText(options.code, WIDTH / 2, y);

  y += 34;
  ctx.fillStyle = PAPER.muted;
  ctx.font = `400 13px ${fonts.mono}`;
  ctx.fillText('SCAN IN SAKU, OR ENTER THE CODE', WIDTH / 2, y);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not generate image'));
    }, 'image/png');
  });
}
