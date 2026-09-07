/**
 * Xendit invoice callback.
 *
 * Unauthenticated by nature — Xendit calls it, not the user — so the `x-callback-token` header
 * is the only thing standing between this route and someone crediting themselves tokens by
 * POSTing a fake "PAID". It is checked before the body is trusted for anything.
 *
 * Idempotency lives in `settleTopup`, not here: Xendit retries callbacks, and a retry after a
 * successful payout must not pay out again.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isDeadStatus, isPaidStatus, verifyCallbackToken } from '@/lib/xendit';
import { settleTopup } from '@/lib/topup';

interface InvoiceCallback {
  id?: string;
  external_id?: string;
  status?: string;
  paid_amount?: number;
  payment_method?: string;
  payment_channel?: string;
}

export async function POST(request: Request) {
  if (!verifyCallbackToken(request.headers.get('x-callback-token'))) {
    return NextResponse.json({ error: 'Invalid callback token' }, { status: 401 });
  }

  let payload: InvoiceCallback;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const orderId = payload.external_id;
  const status = payload.status;
  if (!orderId || !status) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    if (isPaidStatus(status)) {
      await settleTopup(orderId, {
        invoiceId: payload.id,
        providerStatus: status,
        paymentMethod: payload.payment_channel || payload.payment_method,
      });
    } else if (isDeadStatus(status)) {
      const supabase = getSupabaseAdmin();
      await supabase
        .from('topup_requests')
        .update({
          status: 'expired',
          provider_status: status,
          failure_reason: `Gateway reported ${status}`,
        })
        .eq('order_id', orderId)
        // A completed topup stays completed: a late EXPIRED for an order that already paid out
        // must not rewrite it.
        .eq('status', 'pending');
    }

    // Always 200 on a valid token. A non-2xx makes Xendit retry, and retrying only helps when
    // the failure is ours to fix — which the settlement layer already handles on its own.
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
