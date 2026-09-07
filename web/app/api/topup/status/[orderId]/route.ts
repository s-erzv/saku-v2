/**
 * Status of one topup, and the settlement path that works without a public webhook URL.
 *
 * On localhost Xendit cannot reach the webhook, so the client polls this route after coming
 * back from checkout. If the gateway says the money arrived and the row has not settled yet,
 * the payout runs from here. It is the same `settleTopup` the webhook calls, so whichever path
 * gets there first wins and the other becomes a no-op.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { fetchInvoiceByOrderId, isDeadStatus, isPaidStatus } from '@/lib/xendit';
import { settleTopup } from '@/lib/topup';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const { orderId } = await params;

  try {
    const supabase = getSupabaseAdmin();

    // Scoped to the caller: an order id is guessable enough that another user's topup must not
    // be readable, let alone settleable, through this route.
    const { data: topup, error } = await supabase
      .from('topup_requests')
      .select('order_id, status, gross_amount, currency, token_amount, payout_tx_hash, failure_reason')
      .eq('order_id', orderId)
      .eq('user_id', session.userId)
      .maybeSingle();

    if (error) throw error;
    if (!topup) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    let status = topup.status;
    let payoutTxHash = topup.payout_tx_hash;

    if (status === 'pending' || status === 'failed') {
      const invoice = await fetchInvoiceByOrderId(orderId);

      if (invoice && isPaidStatus(invoice.status)) {
        const result = await settleTopup(orderId, {
          invoiceId: invoice.id,
          providerStatus: invoice.status,
          paymentMethod: invoice.payment_channel || invoice.payment_method,
        });

        if (result.status === 'completed') {
          status = 'completed';
          payoutTxHash = result.txHash?.toLowerCase() ?? null;
        } else {
          // Re-read: another caller may have completed it while this one was paying out.
          const { data: fresh } = await supabase
            .from('topup_requests')
            .select('status, payout_tx_hash')
            .eq('order_id', orderId)
            .maybeSingle();
          status = fresh?.status ?? status;
          payoutTxHash = fresh?.payout_tx_hash ?? payoutTxHash;
        }
      } else if (invoice && isDeadStatus(invoice.status)) {
        status = 'expired';
        await supabase
          .from('topup_requests')
          .update({ status, provider_status: invoice.status })
          .eq('order_id', orderId)
          .eq('status', 'pending');
      }
    }

    return NextResponse.json({
      orderId: topup.order_id,
      status,
      grossAmount: Number(topup.gross_amount),
      currency: topup.currency,
      tokenAmount: String(topup.token_amount),
      payoutTxHash,
      failureReason: topup.failure_reason,
    });
  } catch {
    return NextResponse.json({ error: 'Could not check the payment status' }, { status: 500 });
  }
}
