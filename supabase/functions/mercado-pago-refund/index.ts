// Endpoint autenticado (ADMIN da empresa): aprova o cancelamento/estorno de
// um pedido delivery. Fluxo:
//   1. Valida que o usuário autenticado é ADMIN da empresa dona do pedido.
//   2. Verifica que há solicitação de cancelamento pendente.
//   3. Chama POST /v1/payments/{mpPaymentId}/refunds no Mercado Pago.
//   4. Atualiza DeliveryOrder: status=CANCELADO, paymentStatus=ESTORNADO,
//      refundMpId=<id retornado pela MP>.
//   5. Debita o valor (líquido de comissão) da Wallet da empresa.
//
// Para REJEITAR (sem reembolso), usar action='reject': só limpa a solicitação
// de cancelamento sem chamar a API da MP.
//
// Request body: { deliveryOrderId: string, action: 'approve' | 'reject' }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getMasterAccessToken } from '../_shared/platformMercadoPago.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Autenticar o usuário via JWT no header Authorization
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: 'Não autenticado.' }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verificar que o usuário é ADMIN da empresa
    const { data: companyUser } = await adminClient
      .from('CompanyUser')
      .select('companyId, role')
      .eq('userId', user.id)
      .maybeSingle();

    if (!companyUser || companyUser.role !== 'ADMIN') {
      return json({ error: 'Acesso negado. Somente ADMIN pode aprovar estornos.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const deliveryOrderId = String(body.deliveryOrderId ?? '');
    const action = String(body.action ?? ''); // 'approve' | 'reject'

    if (!deliveryOrderId || !['approve', 'reject'].includes(action)) {
      return json({ error: 'Parâmetros inválidos.' }, 400);
    }

    // Carregar o pedido
    const { data: order, error: orderError } = await adminClient
      .from('DeliveryOrder')
      .select('id,companyId,total,status,paymentStatus,cancellationRequestedAt,cancellationReason')
      .eq('id', deliveryOrderId)
      .eq('companyId', companyUser.companyId)
      .maybeSingle();

    if (orderError || !order) {
      return json({ error: 'Pedido não encontrado.' }, 404);
    }
    if (!order.cancellationRequestedAt) {
      return json({ error: 'Nenhuma solicitação de cancelamento para este pedido.' }, 400);
    }
    if (order.status === 'CANCELADO') {
      return json({ error: 'Pedido já foi cancelado.' }, 400);
    }

    if (action === 'reject') {
      // Apenas limpa a solicitação — o pedido continua normalmente
      await adminClient
        .from('DeliveryOrder')
        .update({ cancellationReason: null, cancellationRequestedAt: null })
        .eq('id', deliveryOrderId);
      return json({ ok: true, action: 'rejected' });
    }

    // action === 'approve': executar o estorno
    // Verificar se o pagamento foi feito via MP (paymentStatus = PAGO)
    if (order.paymentStatus !== 'PAGO') {
      // Cancelamento sem estorno financeiro (ex: pedido em dinheiro)
      await adminClient
        .from('DeliveryOrder')
        .update({ status: 'CANCELADO', cancellationRequestedAt: null })
        .eq('id', deliveryOrderId);
      return json({ ok: true, action: 'cancelled_no_refund' });
    }

    // Buscar o mpPaymentId no registro de pagamento
    const { data: mpPayment } = await adminClient
      .from('MercadoPagoPayment')
      .select('mpPaymentId')
      .eq('deliveryOrderId', deliveryOrderId)
      .eq('status', 'approved')
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!mpPayment?.mpPaymentId) {
      // Pagamento pago mas sem registro MP (ex: dinheiro marcado como PAGO manualmente)
      await adminClient
        .from('DeliveryOrder')
        .update({ status: 'CANCELADO', paymentStatus: 'ESTORNADO', cancellationRequestedAt: null })
        .eq('id', deliveryOrderId);
      return json({ ok: true, action: 'cancelled_no_mp_record' });
    }

    // Chamar API de reembolso do Mercado Pago
    const accessToken = await getMasterAccessToken(adminClient);
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPayment.mpPaymentId}/refunds`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `refund-${deliveryOrderId}`,
      },
      body: JSON.stringify({}), // reembolso total
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('MP refund error:', mpData);
      return json({ error: 'Falha ao processar estorno no Mercado Pago.', detail: mpData }, 502);
    }

    const refundMpId = String(mpData.id ?? '');

    // Atualizar pedido
    await adminClient
      .from('DeliveryOrder')
      .update({
        status: 'CANCELADO',
        paymentStatus: 'ESTORNADO',
        refundMpId,
        cancellationRequestedAt: null,
      })
      .eq('id', deliveryOrderId);

    // Debitar da wallet (valor líquido que havia sido creditado)
    const { data: wallet } = await adminClient
      .from('Wallet')
      .select('deliveryFeePercent, balance')
      .eq('companyId', companyUser.companyId)
      .maybeSingle();

    const feePercent = Number(wallet?.deliveryFeePercent ?? 0);
    const netAmount  = Number(order.total) * (1 - feePercent / 100);

    await adminClient.rpc('credit_wallet', {
      p_company_id:       companyUser.companyId,
      p_amount:           -netAmount,
      p_type:             'ESTORNO_DELIVERY',
      p_description:      `Estorno pedido delivery ${deliveryOrderId}`,
      p_delivery_order_id: deliveryOrderId,
      p_tab_id:           null,
    });

    return json({ ok: true, action: 'refunded', refundMpId });
  } catch (err) {
    console.error('mercado-pago-refund error:', err);
    return json({ error: 'Erro interno.' }, 500);
  }
});
