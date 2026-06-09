// Receives Mercado Pago payment notifications for both:
//   a) PIX charges created via mercado-pago-public-pix (tracked by mpPaymentId)
//   b) Checkout Pro payments (identified via external_reference = deliveryOrderId)
//
// For Checkout Pro, the preference creation stores ?companyId=xxx in the
// notification_url so we know which company access-token to use when fetching
// the payment details from the MP API.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    // Mercado Pago sends either ?topic=payment&id=123 or { type: 'payment', data: { id } }
    const paymentId =
      url.searchParams.get('id') ??
      url.searchParams.get('data.id') ??
      body?.data?.id ??
      body?.id ??
      null;
    const topic = url.searchParams.get('topic') ?? body?.type ?? '';

    // companyId injected in the notification_url by mercado-pago-checkout function
    const urlCompanyId = url.searchParams.get('companyId') ?? null;

    if (!paymentId || (topic && topic !== 'payment')) {
      return new Response('ignored', { status: 200, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Caminho A: PIX charge rastreado pelo nosso MercadoPagoPayment ────────
    const { data: existing } = await adminClient
      .from('MercadoPagoPayment')
      .select('id, companyId, status, tabId, deliveryOrderId')
      .eq('mpPaymentId', String(paymentId))
      .maybeSingle();

    if (existing) {
      if (existing.status === 'approved') {
        return new Response('already processed', { status: 200, headers: corsHeaders });
      }
      return await processPayment(adminClient, String(paymentId), existing, null);
    }

    // ── Caminho B: Checkout Pro — não há registro prévio com esse paymentId ──
    // O companyId pode vir da URL ou precisamos buscá-lo via external_reference
    // Tentamos ambos: primeiro via companyId na URL (mais rápido), depois
    // via external_reference no payload do MP.

    const companyIdToUse = urlCompanyId;
    if (!companyIdToUse) {
      // Sem companyId não conseguimos buscar o token — ignorar com segurança
      console.warn('Webhook sem companyId na URL e sem registro prévio para paymentId', paymentId);
      return new Response('no company context', { status: 200, headers: corsHeaders });
    }

    const { data: company } = await adminClient
      .from('Company')
      .select('mercadoPagoAccessToken')
      .eq('id', companyIdToUse)
      .single();

    if (!company?.mercadoPagoAccessToken) {
      return new Response('company token missing', { status: 200, headers: corsHeaders });
    }

    // Buscar dados do pagamento no MP
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${company.mercadoPagoAccessToken}` },
    });
    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Failed to fetch MP payment', mpData);
      return new Response('mp fetch failed', { status: 200, headers: corsHeaders });
    }

    const status = String(mpData.status ?? 'pending');
    const externalRef = mpData.external_reference ?? null;
    const now = new Date().toISOString();

    // Tentar associar ao pedido via external_reference (= deliveryOrderId)
    let deliveryOrderId: string | null = null;
    if (externalRef) {
      const { data: dlvOrder } = await adminClient
        .from('DeliveryOrder')
        .select('id, companyId, status, paymentStatus')
        .eq('id', externalRef)
        .eq('companyId', companyIdToUse)
        .maybeSingle();

      if (dlvOrder) {
        deliveryOrderId = dlvOrder.id;

        // Registrar o pagamento no nosso banco (para auditoria)
        await adminClient.from('MercadoPagoPayment').upsert([{
          companyId: companyIdToUse,
          deliveryOrderId,
          mpPaymentId: String(paymentId),
          status,
          amount: Number(mpData.transaction_amount ?? 0),
          paidAt: status === 'approved' ? now : null,
          updatedAt: now,
        }], { onConflict: 'mpPaymentId', ignoreDuplicates: false });

        if (status === 'approved' && dlvOrder.status === 'AGUARDANDO_PAGAMENTO') {
          await adminClient
            .from('DeliveryOrder')
            .update({ paymentStatus: 'PAGO', status: 'RECEBIDO', updatedAt: now })
            .eq('id', deliveryOrderId)
            .eq('status', 'AGUARDANDO_PAGAMENTO');
        }
      }
    }

    // Também atualizar o registro de preference se existir (mpPaymentId com prefixo pref_)
    if (externalRef) {
      const { data: prefRecord } = await adminClient
        .from('MercadoPagoPayment')
        .select('id')
        .eq('deliveryOrderId', externalRef)
        .like('mpPaymentId', 'pref_%')
        .maybeSingle();
      if (prefRecord) {
        await adminClient.from('MercadoPagoPayment')
          .update({ status, paidAt: status === 'approved' ? now : null, updatedAt: now })
          .eq('id', prefRecord.id);
      }
    }

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response('error logged', { status: 200, headers: corsHeaders });
  }
});

// ── Helper: processar pagamento já rastreado (PIX direto) ──────────────────
async function processPayment(adminClient: any, paymentId: string, existing: any, _extra: any) {
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
      await adminClient
        .from('DeliveryOrder')
        .update({ paymentStatus: 'PAGO', status: 'RECEBIDO', updatedAt: now })
        .eq('id', existing.deliveryOrderId)
        .eq('status', 'AGUARDANDO_PAGAMENTO');
    }
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
}
