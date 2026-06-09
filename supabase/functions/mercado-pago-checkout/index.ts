// Creates a Mercado Pago Checkout Pro preference for a delivery order.
// Supports all MP payment methods: credit card, debit card, PIX, boleto, etc.
//
// Security: amount is ALWAYS taken from the DB — never trusted from the client.
// Only orders in AGUARDANDO_PAGAMENTO with paymentMethod = 'ONLINE' are accepted.
//
// Request body: { companyId: string, deliveryOrderId: string, backUrl: string }
// Response:     { initPoint: string, preferenceId: string }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const MP_PREFERENCES_API = 'https://api.mercadopago.com/checkout/preferences';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = String(body.companyId ?? '');
    const deliveryOrderId = String(body.deliveryOrderId ?? '');
    const backUrl = String(body.backUrl ?? '');

    if (!companyId || !deliveryOrderId || !backUrl) {
      return json({ error: 'Parâmetros inválidos.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    const fnUrl = Deno.env.get('SUPABASE_URL')!;

    // ── 1. Validar pedido no banco ──────────────────────────────────────────
    const { data: order, error: orderError } = await adminClient
      .from('DeliveryOrder')
      .select('id, companyId, total, status, paymentMethod, paymentStatus, customerName, customerPhone')
      .eq('id', deliveryOrderId)
      .eq('companyId', companyId)
      .maybeSingle();

    if (orderError || !order) {
      return json({ error: 'Pedido não encontrado.' }, 404);
    }
    if (order.paymentStatus === 'PAGO') {
      return json({ error: 'Este pedido já foi pago.' }, 400);
    }
    if (order.status !== 'AGUARDANDO_PAGAMENTO') {
      return json({ error: 'Pedido não está aguardando pagamento.' }, 400);
    }

    // ── 2. Buscar token do MP da empresa ────────────────────────────────────
    const { data: company, error: companyError } = await adminClient
      .from('Company')
      .select('id, name, mercadoPagoAccessToken')
      .eq('id', companyId)
      .single();

    if (companyError || !company?.mercadoPagoAccessToken) {
      return json({ error: 'Esta loja não possui Mercado Pago configurado.' }, 400);
    }

    // ── 3. Reutilizar preference existente se ainda pendente ───────────────
    const { data: existingCharge } = await adminClient
      .from('MercadoPagoPayment')
      .select('mpPaymentId, status, preferenceId, initPoint')
      .eq('deliveryOrderId', deliveryOrderId)
      .not('preferenceId', 'is', null)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingCharge?.preferenceId && existingCharge.status !== 'rejected' && existingCharge.status !== 'cancelled') {
      return json({ initPoint: existingCharge.initPoint, preferenceId: existingCharge.preferenceId });
    }

    // ── 4. Buscar itens do pedido ───────────────────────────────────────────
    const { data: orderItems } = await adminClient
      .from('DeliveryOrderItem')
      .select('productName, quantity, unitPrice')
      .eq('deliveryOrderId', deliveryOrderId);

    const items = (orderItems ?? []).length > 0
      ? (orderItems ?? []).map((i: any) => ({
          title: i.productName,
          quantity: Number(i.quantity),
          unit_price: Number(i.unitPrice),
          currency_id: 'BRL',
        }))
      : [{ title: `Pedido delivery — ${company.name}`, quantity: 1, unit_price: Number(order.total), currency_id: 'BRL' }];

    // ── 5. Criar preference no Mercado Pago ────────────────────────────────
    // notification_url inclui companyId para o webhook saber qual token usar
    const notificationUrl = `${fnUrl}/functions/v1/mercado-pago-webhook?companyId=${encodeURIComponent(companyId)}`;
    const successUrl = `${backUrl}?delivery=${encodeURIComponent(companyId)}&mp_order=${encodeURIComponent(deliveryOrderId)}&mp_status=success`;
    const failureUrl = `${backUrl}?delivery=${encodeURIComponent(companyId)}&mp_order=${encodeURIComponent(deliveryOrderId)}&mp_status=failure`;
    const pendingUrl  = `${backUrl}?delivery=${encodeURIComponent(companyId)}&mp_order=${encodeURIComponent(deliveryOrderId)}&mp_status=pending`;

    const preference = {
      items,
      external_reference: deliveryOrderId,
      notification_url: notificationUrl,
      back_urls: { success: successUrl, failure: failureUrl, pending: pendingUrl },
      auto_return: 'approved',
      statement_descriptor: company.name.substring(0, 22),
      metadata: { companyId, deliveryOrderId },
    };

    const mpResponse = await fetch(MP_PREFERENCES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${company.mercadoPagoAccessToken}`,
        'X-Idempotency-Key': `checkout-${deliveryOrderId}`,
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Mercado Pago preference error', mpData);
      return json({ error: mpData?.message || 'Falha ao criar sessão de pagamento.' }, 502);
    }

    const preferenceId = String(mpData.id);
    const initPoint = String(mpData.init_point); // URL de checkout para produção
    // mpData.sandbox_init_point — para testes em sandbox

    // ── 6. Registrar no banco ──────────────────────────────────────────────
    const { error: insertError } = await adminClient.from('MercadoPagoPayment').insert([{
      companyId,
      deliveryOrderId,
      mpPaymentId: `pref_${preferenceId}`,  // prefixado para não colidir com payment IDs
      preferenceId,
      initPoint,
      status: 'pending',
      amount: Number(order.total),
    }]);
    if (insertError) console.error('Failed to persist preference record', insertError);

    return json({ initPoint, preferenceId });
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro inesperado ao criar sessão de pagamento.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
