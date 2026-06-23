// Public (anonymous) endpoint: processes an in-page card payment for a public
// delivery order, using a card token generated client-side by the Mercado
// Pago Card Payment Brick (the raw card number never reaches our backend).
//
// Security: amount and installments are ALWAYS controlled server-side —
// never trusted from the client. installments is hard-coded to 1 ("à
// vista") regardless of what the client sends, per business requirement.
//
// Request body: { companyId, deliveryOrderId, token, paymentMethodId,
//                  issuerId?, payerEmail?, payerDocType?, payerDocNumber? }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getMasterAccessToken } from '../_shared/platformMercadoPago.ts';
import { creditDeliveryWallet } from '../_shared/walletCredit.ts';

const MP_API = 'https://api.mercadopago.com/v1/payments';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = String(body.companyId ?? '');
    const deliveryOrderId = String(body.deliveryOrderId ?? '');
    const token = String(body.token ?? '');
    const paymentMethodId = String(body.paymentMethodId ?? '');

    if (!companyId || !deliveryOrderId || !token || !paymentMethodId) {
      return json({ error: 'Dados do cartão incompletos.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: order, error: orderError } = await adminClient
      .from('DeliveryOrder')
      .select('id, companyId, total, status, paymentStatus, customerName')
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

    const { data: company, error: companyError } = await adminClient
      .from('Company')
      .select('id, name')
      .eq('id', companyId)
      .single();
    if (companyError || !company) {
      return json({ error: 'Loja não encontrada.' }, 404);
    }

    const masterAccessToken = await getMasterAccessToken(adminClient);
    if (!masterAccessToken) {
      console.error('Token master do Mercado Pago não configurado.');
      return json({ error: 'Pagamento online indisponível no momento.' }, 503);
    }

    const amount = Number(order.total);
    const idempotencyKey = `card-${deliveryOrderId}-${Date.now()}`;
    const notificationUrl = `${supabaseUrl}/functions/v1/mercado-pago-webhook?companyId=${encodeURIComponent(companyId)}`;

    const payer: Record<string, unknown> = { email: body.payerEmail || 'cliente@integra360.app' };
    if (body.payerDocType && body.payerDocNumber) {
      payer.identification = { type: String(body.payerDocType), number: String(body.payerDocNumber) };
    }

    const mpResponse = await fetch(MP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${masterAccessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: amount,
        token,
        description: `Pedido delivery — ${company.name} (${order.customerName})`,
        installments: 1, // "à vista" — forçado no servidor, ignora o que vier do cliente
        payment_method_id: paymentMethodId,
        issuer_id: body.issuerId || undefined,
        payer,
        external_reference: deliveryOrderId,
        notification_url: notificationUrl,
      }),
    });

    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Mercado Pago card payment error', mpData);
      return json({ error: mpData?.message || 'Pagamento recusado. Tente outro cartão.' }, 502);
    }

    const status = String(mpData.status ?? 'pending');
    const statusDetail = String(mpData.status_detail ?? '');
    const mpPaymentId = String(mpData.id);
    const now = new Date().toISOString();

    await adminClient.from('MercadoPagoPayment').upsert([{
      companyId,
      deliveryOrderId,
      mpPaymentId,
      status,
      amount,
      paidAt: status === 'approved' ? now : null,
      updatedAt: now,
    }], { onConflict: 'mpPaymentId', ignoreDuplicates: false });

    if (status === 'approved') {
      const { data: updatedRows } = await adminClient
        .from('DeliveryOrder')
        .update({ paymentStatus: 'PAGO', status: 'RECEBIDO', updatedAt: now })
        .eq('id', deliveryOrderId)
        .eq('status', 'AGUARDANDO_PAGAMENTO')
        .select('id');

      // Só credita a carteira se esta chamada realmente fez a transição —
      // evita crédito duplicado caso o webhook chegue depois para o mesmo pagamento.
      if (updatedRows && updatedRows.length > 0) {
        await creditDeliveryWallet(adminClient, companyId, amount, deliveryOrderId);
      }
    }

    return json({ status, statusDetail, mpPaymentId });
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro inesperado ao processar pagamento.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
