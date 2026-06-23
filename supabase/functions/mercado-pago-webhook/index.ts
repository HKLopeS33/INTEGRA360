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
      // Sem companyId não conseguimos contextualizar — ignorar com segurança
      console.warn('Webhook sem companyId na URL e sem registro prévio para paymentId', paymentId);
      return new Response('no company context', { status: 200, headers: corsHeaders });
    }

    const masterAccessToken = Deno.env.get('MP_MASTER_ACCESS_TOKEN');
    if (!masterAccessToken) {
      console.error('MP_MASTER_ACCESS_TOKEN não configurado.');
      return new Response('master token missing', { status: 200, headers: corsHeaders });
    }

    // Buscar dados do pagamento no MP
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${masterAccessToken}` },
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
        .select('id, companyId, status, paymentStatus, total')
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
          const { data: updatedRows } = await adminClient
            .from('DeliveryOrder')
            .update({ paymentStatus: 'PAGO', status: 'RECEBIDO', updatedAt: now })
            .eq('id', deliveryOrderId)
            .eq('status', 'AGUARDANDO_PAGAMENTO')
            .select('id');

          // Só credita a carteira se este request realmente fez a transição
          // (evita crédito duplicado em entregas repetidas do webhook).
          if (updatedRows && updatedRows.length > 0) {
            const amount = Number(mpData.transaction_amount ?? dlvOrder.total);
            await creditDeliveryWallet(adminClient, companyIdToUse, amount, deliveryOrderId);
          }
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
  const masterAccessToken = Deno.env.get('MP_MASTER_ACCESS_TOKEN');
  if (!masterAccessToken) {
    console.error('MP_MASTER_ACCESS_TOKEN não configurado.');
    return new Response('master token missing', { status: 200, headers: corsHeaders });
  }

  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${masterAccessToken}` },
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
    const amount = Number(mpData.transaction_amount ?? 0);

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
        amount: String(amount),
        status: 'PAGO',
        paidAt: now,
      }]);

      await creditTabWallet(adminClient, existing.companyId, amount, existing.tabId);
    }
    if (existing.deliveryOrderId) {
      const { data: updatedRows } = await adminClient
        .from('DeliveryOrder')
        .update({ paymentStatus: 'PAGO', status: 'RECEBIDO', updatedAt: now })
        .eq('id', existing.deliveryOrderId)
        .eq('status', 'AGUARDANDO_PAGAMENTO')
        .select('id');

      if (updatedRows && updatedRows.length > 0) {
        await creditDeliveryWallet(adminClient, existing.companyId, amount, existing.deliveryOrderId);
      }
    }
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
}

// ── Helpers: creditam a carteira da empresa via RPC (atômico) ─────────────

async function creditDeliveryWallet(adminClient: any, companyId: string, amount: number, deliveryOrderId: string) {
  const { data: wallet } = await adminClient
    .from('Wallet')
    .select('deliveryFeePercent')
    .eq('companyId', companyId)
    .maybeSingle();
  const feePercent = Number(wallet?.deliveryFeePercent ?? 0);
  const netAmount = amount * (1 - feePercent / 100);

  const { error } = await adminClient.rpc('credit_wallet', {
    p_company_id: companyId,
    p_amount: netAmount,
    p_type: 'CREDITO_DELIVERY',
    p_description: `Pedido delivery ${deliveryOrderId} (comissão ${feePercent}%)`,
    p_delivery_order_id: deliveryOrderId,
    p_tab_id: null,
  });
  if (error) console.error('Failed to credit wallet (delivery)', error);
}

async function creditTabWallet(adminClient: any, companyId: string, amount: number, tabId: string) {
  const { error } = await adminClient.rpc('credit_wallet', {
    p_company_id: companyId,
    p_amount: amount,
    p_type: 'CREDITO_MESA',
    p_description: `Pix mesa/comanda ${tabId}`,
    p_delivery_order_id: null,
    p_tab_id: tabId,
  });
  if (error) console.error('Failed to credit wallet (mesa)', error);
}
