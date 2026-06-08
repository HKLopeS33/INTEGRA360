// Receives Mercado Pago payment notifications, fetches the payment status
// (using the *company's own* access token — looked up from our records, never
// trusting the webhook payload alone), and marks it as paid in our DB.
//
// Configure this URL in each company's Mercado Pago webhook settings, or use
// a single global webhook (Mercado Pago sends the payment id; we look up
// which company it belongs to via MercadoPagoPayment.mpPaymentId).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    // Mercado Pago sends either ?topic=payment&id=123 or a JSON body { type: 'payment', data: { id } }
    const paymentId =
      url.searchParams.get('id') ??
      url.searchParams.get('data.id') ??
      body?.data?.id ??
      body?.id ??
      null;
    const topic = url.searchParams.get('topic') ?? body?.type ?? '';

    if (!paymentId || (topic && topic !== 'payment')) {
      return new Response('ignored', { status: 200, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Find which company this payment belongs to (created via our function,
    // so it should already be tracked).
    const { data: existing } = await adminClient
      .from('MercadoPagoPayment')
      .select('id, companyId, status, tabId, deliveryOrderId')
      .eq('mpPaymentId', String(paymentId))
      .maybeSingle();

    if (!existing) {
      // Unknown payment (not created through our flow) — ignore safely.
      return new Response('not tracked', { status: 200, headers: corsHeaders });
    }
    if (existing.status === 'approved') {
      return new Response('already processed', { status: 200, headers: corsHeaders });
    }

    const { data: company } = await adminClient
      .from('Company')
      .select('mercadoPagoAccessToken')
      .eq('id', existing.companyId)
      .single();
    if (!company?.mercadoPagoAccessToken) {
      return new Response('company token missing', { status: 200, headers: corsHeaders });
    }

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${company.mercadoPagoAccessToken}` },
    });
    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Failed to fetch MP payment', mpData);
      return new Response('mp fetch failed', { status: 200, headers: corsHeaders });
    }

    const status = String(mpData.status ?? 'pending');
    const now = new Date().toISOString();

    await adminClient
      .from('MercadoPagoPayment')
      .update({ status, updatedAt: now, paidAt: status === 'approved' ? now : null })
      .eq('id', existing.id);

    if (status === 'approved') {
      // Mirror into the existing Payment table so reports/cash register stay consistent.
      if (existing.tabId) {
        const { data: cashRegister } = await adminClient
          .from('CashRegister')
          .select('id')
          .eq('companyId', existing.companyId)
          .eq('status', 'ABERTO')
          .maybeSingle();

        await adminClient.from('Payment').insert([{
          tabId: existing.tabId,
          cashRegisterId: cashRegister?.id ?? null,
          method: 'PIX',
          amount: String(mpData.transaction_amount ?? 0),
          status: 'PAGO',
          paidAt: now,
        }]);
      }
      if (existing.deliveryOrderId) {
        // Promotes the order out of "awaiting payment" limbo so it finally
        // becomes visible to the company's delivery/kitchen queues.
        await adminClient
          .from('DeliveryOrder')
          .update({ paymentStatus: 'PAGO', status: 'RECEBIDO', updatedAt: now })
          .eq('id', existing.deliveryOrderId)
          .eq('status', 'AGUARDANDO_PAGAMENTO');
      }
    }

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error(err);
    // Always 200 so Mercado Pago doesn't hammer retries on our bugs.
    return new Response('error logged', { status: 200, headers: corsHeaders });
  }
});
