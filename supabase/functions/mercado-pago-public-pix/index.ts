// Public (anonymous) endpoint: creates a Mercado Pago Pix charge for a public
// delivery order. Used by the customer-facing delivery link — no Supabase auth
// session exists at that point.
//
// Security: we never trust client-provided amounts. The order is looked up
// server-side by (companyId, orderId) and must be in AGUARDANDO_PAGAMENTO with
// paymentMethod = 'PIX_ONLINE'; the charge amount is taken from the stored
// order total, not from the request body.
//
// Request body: { companyId: string, deliveryOrderId: string, payerEmail?: string }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const MP_API = 'https://api.mercadopago.com/v1/payments';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = String(body.companyId ?? '');
    const deliveryOrderId = String(body.deliveryOrderId ?? '');
    if (!companyId || !deliveryOrderId) {
      return json({ error: 'Pedido inválido.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: order, error: orderError } = await adminClient
      .from('DeliveryOrder')
      .select('id, companyId, total, status, paymentMethod, paymentStatus, customerName')
      .eq('id', deliveryOrderId)
      .eq('companyId', companyId)
      .maybeSingle();
    if (orderError || !order) {
      return json({ error: 'Pedido não encontrado.' }, 404);
    }
    if (order.paymentMethod !== 'PIX_ONLINE') {
      return json({ error: 'Este pedido não usa pagamento online.' }, 400);
    }
    if (order.paymentStatus === 'PAGO') {
      return json({ error: 'Este pedido já foi pago.' }, 400);
    }
    if (order.status !== 'AGUARDANDO_PAGAMENTO') {
      return json({ error: 'Pedido não está aguardando pagamento.' }, 400);
    }

    // Reuse an existing pending charge if one was already created for this order.
    const { data: existingCharge } = await adminClient
      .from('MercadoPagoPayment')
      .select('mpPaymentId, status, qrCode, qrCodeBase64, ticketUrl')
      .eq('deliveryOrderId', deliveryOrderId)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingCharge && existingCharge.status !== 'rejected' && existingCharge.status !== 'cancelled') {
      return json({
        mpPaymentId: existingCharge.mpPaymentId,
        status: existingCharge.status,
        qrCode: existingCharge.qrCode,
        qrCodeBase64: existingCharge.qrCodeBase64,
        ticketUrl: existingCharge.ticketUrl,
      });
    }

    const { data: company, error: companyError } = await adminClient
      .from('Company')
      .select('id, name')
      .eq('id', companyId)
      .single();
    if (companyError || !company) {
      return json({ error: 'Loja não encontrada.' }, 404);
    }

    const masterAccessToken = Deno.env.get('MP_MASTER_ACCESS_TOKEN');
    if (!masterAccessToken) {
      console.error('MP_MASTER_ACCESS_TOKEN não configurado.');
      return json({ error: 'Esta loja não está com pagamento online disponível no momento.' }, 503);
    }

    const amount = Number(order.total);
    const idempotencyKey = `delivery-${deliveryOrderId}-${Date.now()}`;

    const mpResponse = await fetch(MP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${masterAccessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description: `Pedido delivery — ${company.name} (${order.customerName})`,
        payment_method_id: 'pix',
        payer: { email: body.payerEmail || 'cliente@integra360.app' },
      }),
    });

    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Mercado Pago error', mpData);
      return json({ error: mpData?.message || 'Falha ao gerar cobrança Pix.' }, 502);
    }

    const txData = mpData.point_of_interaction?.transaction_data ?? {};
    const record = {
      companyId,
      deliveryOrderId,
      mpPaymentId: String(mpData.id),
      status: mpData.status ?? 'pending',
      amount,
      qrCode: txData.qr_code ?? null,
      qrCodeBase64: txData.qr_code_base64 ?? null,
      ticketUrl: txData.ticket_url ?? null,
    };

    const { error: insertError } = await adminClient.from('MercadoPagoPayment').insert([record]);
    if (insertError) console.error('Failed to persist MercadoPagoPayment', insertError);

    return json({
      mpPaymentId: record.mpPaymentId,
      status: record.status,
      qrCode: record.qrCode,
      qrCodeBase64: record.qrCodeBase64,
      ticketUrl: record.ticketUrl,
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro inesperado ao gerar cobrança Pix.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
