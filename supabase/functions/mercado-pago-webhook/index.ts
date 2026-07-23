// Receives Mercado Pago payment notifications for both:
//   a) PIX charges created via mercado-pago-public-pix (tracked by mpPaymentId)
//   b) Checkout Pro payments (identified via external_reference = deliveryOrderId)
//
// For Checkout Pro, the preference creation stores ?companyId=xxx in the
// notification_url so we know which company access-token to use when fetching
// the payment details from the MP API.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getMasterAccessToken } from '../_shared/platformMercadoPago.ts';
import { creditDeliveryWallet, creditTabWallet } from '../_shared/walletCredit.ts';

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

    // ── Eventos de assinatura recorrente ──────────────────────────────────
    if (topic === 'subscription_authorized_payment' || topic === 'subscription_preapproval') {
      if (!paymentId) return new Response('ignored', { status: 200, headers: corsHeaders });

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminClient = createClient(supabaseUrl, serviceKey);
      const masterAccessToken = await getMasterAccessToken(adminClient);
      if (!masterAccessToken) return new Response('master token missing', { status: 200, headers: corsHeaders });

      if (topic === 'subscription_authorized_payment') {
        // Buscar pagamento autorizado no MP
        const mpRes = await fetch(`https://api.mercadopago.com/authorized_payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${masterAccessToken}` },
        });
        const mpData = await mpRes.json().catch(() => ({}));
        if (!mpRes.ok) {
          console.error('Failed to fetch authorized_payment', paymentId, mpData);
          return new Response('mp fetch failed', { status: 200, headers: corsHeaders });
        }

        const status = String(mpData.status ?? '');
        const preapprovalId = String(mpData.preapproval_id ?? '');
        const amount = Number(mpData.transaction_amount ?? 0);

        if (status !== 'processed' && status !== 'authorized') {
          console.log('Subscription payment not yet processed:', status);
          return new Response('not processed', { status: 200, headers: corsHeaders });
        }

        // Encontrar empresa pela assinatura MP
        const { data: sub } = await adminClient
          .from('Subscription')
          .select('companyId, monthlyFee, expiresAt')
          .eq('mpSubscriptionId', preapprovalId)
          .maybeSingle();

        if (!sub) {
          console.warn('Subscription not found for preapproval', preapprovalId);
          return new Response('subscription not found', { status: 200, headers: corsHeaders });
        }

        const now = new Date();
        const currentExpiry = sub.expiresAt ? new Date(sub.expiresAt) : now;
        const baseDate = currentExpiry > now ? currentExpiry : now;
        const newExpiry = new Date(baseDate);
        newExpiry.setMonth(newExpiry.getMonth() + 1);

        // Determinar plano a partir do external_reference do preapproval
        const preapRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
          headers: { Authorization: `Bearer ${masterAccessToken}` },
        });
        const preapData = await preapRes.json().catch(() => ({}));
        const extRef = String(preapData.external_reference ?? '');
        const planMatch = extRef.match(/plan:(\w+)/);
        const plan = planMatch ? planMatch[1] : 'PRO';

        // Atualizar subscription e plano da empresa
        await adminClient.from('Subscription').update({
          status: 'ATIVO',
          expiresAt: newExpiry.toISOString(),
          lastRenewed: now.toISOString(),
          monthlyFee: amount || sub.monthlyFee,
        }).eq('companyId', sub.companyId);

        await adminClient.from('Company').update({
          plan,
          updatedAt: now.toISOString(),
        }).eq('id', sub.companyId);

        // Registrar pagamento
        await adminClient.from('PaymentRecord').insert([{
          companyId: sub.companyId,
          amount: amount || sub.monthlyFee,
          status: 'PAGO',
          dueDate: now.toISOString(),
          paidAt: now.toISOString(),
          renewalDate: newExpiry.toISOString(),
        }]);

        console.log('Subscription renewed for company', sub.companyId, 'until', newExpiry.toISOString());
      } else {
        // subscription_preapproval: atualizar status da assinatura
        const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${paymentId}`, {
          headers: { Authorization: `Bearer ${masterAccessToken}` },
        });
        const mpData = await mpRes.json().catch(() => ({}));
        if (!mpRes.ok) return new Response('mp fetch failed', { status: 200, headers: corsHeaders });

        const mpStatus = String(mpData.status ?? '');
        const extRef   = String(mpData.external_reference ?? '');
        const companyMatch = extRef.match(/company:([^:]+)/);
        const planMatch    = extRef.match(/plan:(\w+)/);
        if (!companyMatch) return new Response('no company ref', { status: 200, headers: corsHeaders });

        const companyId = companyMatch[1];
        const plan      = planMatch ? planMatch[1] : 'PRO';

        if (mpStatus === 'authorized') {
          // Assinatura ativada pelo cliente
          const now = new Date();
          const newExpiry = new Date(now);
          newExpiry.setMonth(newExpiry.getMonth() + 1);

          await adminClient.from('Subscription').update({
            status: 'ATIVO',
            expiresAt: newExpiry.toISOString(),
            lastRenewed: now.toISOString(),
          }).eq('companyId', companyId);

          await adminClient.from('Company').update({
            plan,
            updatedAt: now.toISOString(),
          }).eq('id', companyId);

          console.log('Subscription authorized for company', companyId, 'plan', plan);
        } else if (mpStatus === 'cancelled' || mpStatus === 'paused') {
          await adminClient.from('Subscription').update({
            status: mpStatus === 'cancelled' ? 'CANCELADO' : 'PAUSADO',
            mpSubscriptionId: mpStatus === 'cancelled' ? null : undefined,
          }).eq('companyId', companyId);
          console.log('Subscription', mpStatus, 'for company', companyId);
        }
      }

      return new Response('ok', { status: 200, headers: corsHeaders });
    }

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

    const masterAccessToken = await getMasterAccessToken(adminClient);
    if (!masterAccessToken) {
      console.error('Token master do Mercado Pago não configurado.');
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
            // Notifica o cliente que o pedido foi recebido após confirmação do pagamento
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-notify`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: deliveryOrderId, status: 'RECEBIDO' }),
            }).catch(() => {});
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
  const masterAccessToken = await getMasterAccessToken(adminClient);
  if (!masterAccessToken) {
    console.error('Token master do Mercado Pago não configurado.');
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
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-notify`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: existing.deliveryOrderId, status: 'RECEBIDO' }),
        }).catch(() => {});
      }
    }
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
}
