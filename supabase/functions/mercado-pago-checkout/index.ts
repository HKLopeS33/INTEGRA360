// Creates a Mercado Pago Checkout Pro preference for a delivery order.
// Supports all MP payment methods: credit card, debit card, PIX, etc.
//
// Security: amount is ALWAYS taken from the DB — never trusted from the client.
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
    const companyId   = String(body.companyId   ?? '').trim();
    const deliveryOrderId = String(body.deliveryOrderId ?? '').trim();
    const backUrl     = String(body.backUrl      ?? '').trim();

    if (!companyId || !deliveryOrderId || !backUrl) {
      return json({ error: 'Parâmetros inválidos (companyId, deliveryOrderId e backUrl são obrigatórios).' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── 1. Validar pedido ──────────────────────────────────────────────────
    const { data: order, error: orderError } = await adminClient
      .from('DeliveryOrder')
      .select('id, companyId, total, status, paymentStatus, customerName')
      .eq('id', deliveryOrderId)
      .eq('companyId', companyId)
      .maybeSingle();

    if (orderError) {
      console.error('Order query error:', orderError);
      return json({ error: 'Erro ao buscar pedido.' }, 500);
    }
    if (!order) {
      return json({ error: 'Pedido não encontrado.' }, 404);
    }
    if (order.paymentStatus === 'PAGO') {
      return json({ error: 'Este pedido já foi pago.' }, 400);
    }
    if (order.status !== 'AGUARDANDO_PAGAMENTO') {
      return json({ error: `Pedido em status inválido: ${order.status}` }, 400);
    }

    // ── 2. Buscar nome da empresa + token master da plataforma ────────────
    const { data: company, error: companyError } = await adminClient
      .from('Company')
      .select('id, name')
      .eq('id', companyId)
      .single();

    if (companyError) {
      console.error('Company query error:', companyError);
      return json({ error: 'Erro ao buscar dados da empresa.' }, 500);
    }

    const masterAccessToken = Deno.env.get('MP_MASTER_ACCESS_TOKEN');
    if (!masterAccessToken) {
      console.error('MP_MASTER_ACCESS_TOKEN não configurado.');
      return json({ error: 'Pagamento online indisponível no momento.' }, 503);
    }

    // ── 3. Buscar itens do pedido (best-effort) ────────────────────────────
    let items: Array<{ title: string; quantity: number; unit_price: number; currency_id: string }>;
    try {
      const { data: orderItems } = await adminClient
        .from('DeliveryOrderItem')
        .select('productName, quantity, unitPrice')
        .eq('deliveryOrderId', deliveryOrderId);

      items = (orderItems && orderItems.length > 0)
        ? orderItems.map((i: any) => ({
            title: String(i.productName),
            quantity: Number(i.quantity),
            unit_price: Number(i.unitPrice),
            currency_id: 'BRL',
          }))
        : [{ title: `Pedido — ${company.name}`, quantity: 1, unit_price: Number(order.total), currency_id: 'BRL' }];
    } catch {
      items = [{ title: `Pedido — ${company.name}`, quantity: 1, unit_price: Number(order.total), currency_id: 'BRL' }];
    }

    // ── 4. Criar preference no Mercado Pago ────────────────────────────────
    // notification_url inclui companyId para o webhook saber qual token usar
    const notificationUrl = `${supabaseUrl}/functions/v1/mercado-pago-webhook?companyId=${encodeURIComponent(companyId)}`;
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
    };

    console.log('Creating MP preference for order', deliveryOrderId, 'amount', order.total);

    const mpResponse = await fetch(MP_PREFERENCES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${masterAccessToken}`,
        'X-Idempotency-Key': `checkout-${deliveryOrderId}`,
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok) {
      console.error('Mercado Pago preference error', mpResponse.status, JSON.stringify(mpData));
      return json({ error: mpData?.message || `Falha ao criar sessão de pagamento (MP ${mpResponse.status}).` }, 502);
    }

    const preferenceId = String(mpData.id ?? '');
    const initPoint    = String(mpData.init_point ?? '');

    if (!initPoint) {
      console.error('MP returned no init_point', JSON.stringify(mpData));
      return json({ error: 'Mercado Pago não retornou a URL de pagamento.' }, 502);
    }

    // ── 5. Salvar no banco (best-effort — não falha se as colunas não existirem ainda) ──
    try {
      await adminClient.from('MercadoPagoPayment').insert([{
        companyId,
        deliveryOrderId,
        mpPaymentId: `pref_${preferenceId}`,
        status: 'pending',
        amount: Number(order.total),
      }]);
    } catch (dbErr) {
      console.warn('Could not persist preference record (non-fatal):', dbErr);
    }

    console.log('Preference created successfully:', preferenceId);
    return json({ initPoint, preferenceId });

  } catch (err) {
    console.error('Unexpected error in mercado-pago-checkout:', err);
    return json({ error: 'Erro inesperado ao criar sessão de pagamento.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
