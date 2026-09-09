/**
 * Draws a transaction receipt onto an offscreen canvas and returns it as a PNG blob.
 *
 * Drawn manually rather than via `html2canvas`/`dom-to-image` — this app leans on gradients and
 * backdrop-blur that those DOM-to-image libraries routinely mis-render. A canvas draw has no such
 * failure mode, at the cost of duplicating the *layout* here. The layout is all that is
 * duplicated: what the receipt actually says comes from `lib/receipt-content.ts`, shared with the
 * on-screen modal, so the image someone shares is recognisably the receipt they just looked at.
 */

import type { SakuTransaction } from '@/hooks/useTransactions';
import { PAPER, buildReceipt, type ReceiptContent } from '@/lib/receipt-content';

const WIDTH = 720;
const SCALE = 2; // draw at 2x for a crisp share image, then let CSS-equivalent sizing handle display
const PAD = 52;
const TOOTH_W = 30;
const TOOTH_H = 17;
const ROW_GAP = 42;

/**
 * next/font hashes the family it generates, so the literal string "Space Mono" would silently
 * fall through to the browser's default in `ctx.font`. The real name is in the CSS variable the
 * root layout sets.
 */
function family(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value ? `${value}, ${fallback}` : fallback;
}

/** A receipt that never prints is worse than one printed in the wrong face — never throw here. */
async function loadMark(): Promise<HTMLImageElement | null> {
  const attempt = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/icons/saku-mark.png';
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  return Promise.race([attempt, timeout]);
}

/**
 * The paper's silhouette: perforated along the top and bottom edges, straight down the sides.
 * One path for the whole sheet means the gradient, the grain, and the shadow all stop at the
 * teeth rather than at an invisible bounding box.
 */
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

/** Deterministic so the same transaction always prints the same sheet of paper. */
function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const rand = seededRandom(seed);
  ctx.save();
  ctx.fillStyle = 'rgba(20,18,16,0.035)';
  for (let i = 0; i < 2600; i += 1) {
    ctx.fillRect(rand() * w, rand() * h, 1.4, 1.4);
  }
  ctx.restore();
}

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, y: number, x2: number) {
  ctx.save();
  ctx.strokeStyle = PAPER.hairline;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

/** Label left, dotted leader, value right — the same shape as the modal's line items. */
function row(
  ctx: CanvasRenderingContext2D,
  fonts: { mono: string },
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  valueColor: string
) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = PAPER.muted;
  ctx.font = `400 20px ${fonts.mono}`;
  const upperLabel = label.toUpperCase();
  ctx.fillText(upperLabel, x, y);
  const labelWidth = ctx.measureText(upperLabel).width;

  ctx.fillStyle = valueColor;
  ctx.font = `700 20px ${fonts.mono}`;
  const valueWidth = ctx.measureText(value).width;
  ctx.textAlign = 'right';
  ctx.fillText(value, x + w, y);

  ctx.save();
  ctx.strokeStyle = PAPER.hairline;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(x + labelWidth + 10, y - 5);
  ctx.lineTo(x + w - valueWidth - 10, y - 5);
  ctx.stroke();
  ctx.restore();
}

/**
 * The sheet is cut to its contents, so a receipt with fewer rows isn't padded out with blank
 * paper. These are the same advances the draw below makes, in the same order — change one and
 * this has to move with it.
 */
function contentHeight(receipt: ReceiptContent) {
  const beforeRows =
    TOOTH_H + PAD + // top teeth, then the letterhead baseline
    38 + // type label
    24 + // divider
    78 + // amount
    28 + // "USDC"
    34 + // status pill
    30 + // divider
    30; // first row's baseline

  const afterRows =
    -12 + // the loop overshoots by one gap; the divider sits back inside it
    30 + // total row
    (receipt.fee ? 74 : 0) + // sent + fee lines and their rule
    46 + // barcode top
    46 + 26 + // barcode height, then the first footer line
    24 + // second footer line
    10 + // descender room under it
    PAD + TOOTH_H;

  return beforeRows + receipt.rows.length * ROW_GAP + afterRows;
}

export async function generateReceiptImage(tx: SakuTransaction): Promise<Blob> {
  const receipt = buildReceipt(tx);
  const width = WIDTH;
  const height = Math.round(contentHeight(receipt));

  const fonts = {
    mono: family('--font-receipt', 'ui-monospace, SFMono-Regular, Menlo, monospace'),
    sans: family('--font-geist', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
  };

  // Without this the first share after a cold load prints in the fallback face — the webfont is
  // still in flight when the canvas measures it.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // A font that never resolves is not a reason to fail the share.
    }
  }

  const mark = await loadMark();

  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.scale(SCALE, SCALE);

  // Paper stock
  paperPath(ctx, width, height);
  const stock = ctx.createLinearGradient(0, 0, 0, height);
  stock.addColorStop(0, PAPER.top);
  stock.addColorStop(1, PAPER.bottom);
  ctx.fillStyle = stock;
  ctx.fill();

  ctx.save();
  paperPath(ctx, width, height);
  ctx.clip();
  drawGrain(ctx, width, height, parseInt(tx.txHash.slice(2, 10), 16) || 1);
  ctx.restore();

  const left = PAD;
  const right = width - PAD;
  const rowWidth = right - left;
  let y = TOOTH_H + PAD;

  // Letterhead — the mark, then the wordmark. A failed image load prints the wordmark alone
  // rather than leaving a gap, and never blocks the share.
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
  ctx.fillText('PAYMENT RECEIPT', right, y - 6);

  y += 38;
  ctx.textAlign = 'center';
  ctx.fillStyle = PAPER.muted;
  ctx.font = `400 16px ${fonts.mono}`;
  ctx.fillText(receipt.typeLabel.toUpperCase(), width / 2, y);

  y += 24;
  dashedLine(ctx, left, y, right);

  // Amount
  y += 78;
  ctx.textAlign = 'center';
  ctx.fillStyle = receipt.incoming ? PAPER.emerald : PAPER.ink;
  ctx.font = `900 68px ${fonts.sans}`;
  ctx.fillText(`${receipt.incoming ? '+' : '−'}${receipt.amount}`, width / 2, y);

  y += 28;
  ctx.fillStyle = PAPER.muted;
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillText('U S D C', width / 2, y);

  // Status pill
  y += 34;
  ctx.font = `700 15px ${fonts.mono}`;
  const statusText = receipt.statusLabel.toUpperCase();
  const pillWidth = ctx.measureText(statusText).width + 40;
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = receipt.statusColor;
  const pillX = width / 2 - pillWidth / 2;
  ctx.beginPath();
  ctx.roundRect(pillX, y - 20, pillWidth, 30, 15);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = receipt.statusColor;
  ctx.fillText(statusText, width / 2, y);

  y += 30;
  dashedLine(ctx, left, y, right);

  // Line items
  y += 30;
  for (const item of receipt.rows) {
    row(ctx, fonts, left, y, rowWidth, item.label, item.value, item.label === 'Ref' ? PAPER.accent : PAPER.ink);
    y += ROW_GAP;
  }

  y -= 12;
  dashedLine(ctx, left, y, right);

  // Fee, then total. Shown as separate lines for the same reason the modal does: a fee added on
  // top and then folded into one number is a fee the payer cannot check.
  y += 30;
  if (receipt.fee) {
    ctx.font = `400 17px ${fonts.mono}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = PAPER.muted;
    ctx.fillText('SENT', left, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = PAPER.ink;
    ctx.fillText(`${receipt.amount} USDC`, right, y);

    y += 26;
    ctx.textAlign = 'left';
    ctx.fillStyle = PAPER.muted;
    ctx.fillText('PLATFORM FEE', left, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = PAPER.ink;
    ctx.fillText(`+${receipt.fee} USDC`, right, y);

    y += 20;
    dashedLine(ctx, left, y, right);
    y += 28;
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = PAPER.muted;
  ctx.font = `700 16px ${fonts.mono}`;
  ctx.fillText(receipt.fee ? 'TOTAL PAID' : 'TOTAL', left, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = PAPER.ink;
  ctx.font = `700 22px ${fonts.mono}`;
  ctx.fillText(`${receipt.incoming ? '+' : '−'}${receipt.total} USDC`, right, y);

  // Barcode — decorative, derived from the hash; the Ref row above is what actually verifies.
  y += 46;
  const barGap = 3;
  const totalBarWidth = receipt.barcode.reduce((sum, w) => sum + w * 2 + barGap, 0);
  let barX = width / 2 - totalBarWidth / 2;
  ctx.fillStyle = PAPER.ink;
  receipt.barcode.forEach((weight, i) => {
    const w = weight * 2;
    if (i % 2 === 0) ctx.fillRect(barX, y, w, 46);
    barX += w + barGap;
  });

  y += 46 + 26;
  ctx.textAlign = 'center';
  ctx.fillStyle = PAPER.muted;
  ctx.font = `400 13px ${fonts.mono}`;
  ctx.fillText('VERIFIED ON-CHAIN · TESTNET.BSCSCAN.COM', width / 2, y);

  y += 24;
  ctx.fillStyle = 'rgba(20,18,16,0.3)';
  ctx.font = `600 14px ${fonts.sans}`;
  ctx.fillText('Thank you for using Saku', width / 2, y);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not generate image'));
    }, 'image/png');
  });
}
