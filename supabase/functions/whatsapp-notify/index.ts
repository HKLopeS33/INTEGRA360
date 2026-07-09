// Edge Function: whatsapp-notify
// Notifica o ESTABELECIMENTO via WhatsApp quando um novo pedido delivery chega.
//
// Usa o template aprovado pelo Meta: novo_pedido_delivery
// Parâmetros do template:
//   {{1}} numero do pedido
//   {{2}} nome do cliente
//   {{3}} endereco de entrega
//   {{4}} itens do pedido
//   {{5}} total
//   {{6}} forma de pagamento
//
// Secrets necessários no Supabase:
//   WA_PHONE_NUMBER_ID  — ID do número remetente no Meta Business
//   WA_ACCESS_TOKEN     — Token permanente da Meta Cloud API
//
// Request body: { orderId: string, status: string }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

// Normaliza telefone para formato E.164 sem "+" (ex: "(87) 99971-0850" → "5587999710850")
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  return `55${digits}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  PIX: 'Pix (Mercado Pago)',
  PIX_ONLINE: 'Pix (Mercado Pago)',
  CARTAO: 'Cartão (Mercado Pago)',
  CARTAO_ONLINE: 'Cartão (Mercado Pago)',
  DINHEIRO: 'Dinheiro',
  ONLINE: 'Pagamento online',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const waPhoneNumberId = Deno.env.get('WA_PHONE_NUMBER_ID');
    const waAccessToken   = Deno.env.get('WA_ACCESS_TOKEN');

    if (!waPhoneNumberId || !waAccessToken) {
      console.warn('WhatsApp não configurado (WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN ausentes).');
      return json({ ok: false, reason: 'not_configured' });
    }

    const body = await req.json().catch(() => ({}));
    const { orderId, status } = body as { orderId?: string; status?: string };

    if (!orderId || !status) return json({ error: 'orderId e status são obrigatórios.' }, 400);

    // Apenas notifica o estabelecimento quando um novo pedido chega
    if (status !== 'RECEBIDO') {
      return json({ ok: false, reason: 'status_sem_notificacao' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin       = createClient(supabaseUrl, serviceKey);

    // Buscar dados do pedido
    const { data: order, error: orderErr } = await admin
      .from('DeliveryOrder')
      .select('id,receiptNumber,customerName,customerAddress,total,paymentMethod,companyId')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error('Pedido não encontrado:', orderId, orderErr);
      return json({ ok: false, reason: 'order_not_found' });
    }

    // Buscar telefone do estabelecimento
    const { data: company } = await admin
      .from('Company')
      .select('name, phone, plan')
      .eq('id', order.companyId)
      .maybeSingle();

    if (!company?.phone) {
      console.log('Estabelecimento sem telefone cadastrado, notificação ignorada:', order.companyId);
      return json({ ok: false, reason: 'no_company_phone' });
    }

    const companyPhone = normalizePhone(company.phone);
    if (!companyPhone) {
      console.log('Telefone do estabelecimento inválido:', company.phone);
      return json({ ok: false, reason: 'invalid_company_phone' });
    }

    // Buscar itens do pedido
    let itemsText = '—';
    try {
      const { data: items } = await admin
        .from('DeliveryOrderItem')
        .select('productName, quantity')
        .eq('deliveryOrderId', orderId);

      if (items && items.length > 0) {
        itemsText = items.map((i: any) => `${i.quantity}x ${i.productName}`).join(', ');
      }
    } catch { /* ignora — texto padrão */ }

    const orderNumber   = String(order.receiptNumber ?? orderId.slice(0, 8));
    const customerName  = String(order.customerName ?? 'Cliente');
    const address       = String(order.customerAddress ?? 'Não informado');
    const total         = formatCurrency(Number(order.total ?? 0));
    const paymentMethod = PAYMENT_LABELS[order.paymentMethod] ?? String(order.paymentMethod ?? 'Não informado');

    // Chamar Meta Cloud API com template aprovado
    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${waPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${waAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: companyPhone,
          type: 'template',
          template: {
            name: 'novo_pedido_delivery',
            language: { code: 'pt_BR' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: orderNumber },
                  { type: 'text', text: customerName },
                  { type: 'text', text: address },
                  { type: 'text', text: itemsText },
                  { type: 'text', text: total },
                  { type: 'text', text: paymentMethod },
                ],
              },
            ],
          },
        }),
      },
    );

    const metaData = await metaRes.json();
    console.log('Meta API response:', metaRes.status, JSON.stringify(metaData));

    if (!metaRes.ok) {
      console.error('Falha ao enviar WhatsApp:', metaData);
      return json({ ok: false, reason: 'meta_api_error', detail: metaData }, 200);
    }

    return json({ ok: true, messageId: metaData?.messages?.[0]?.id });
  } catch (err) {
    console.error('whatsapp-notify unhandled error:', String(err));
    return json({ error: String(err) }, 500);
  }
});
