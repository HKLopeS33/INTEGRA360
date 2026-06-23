// Creates a dynamic Pix charge via Mercado Pago using the calling company's
// own access token (stored server-side, never exposed to the client).
//
// Request body: { tabId?: string, deliveryOrderId?: string, amount: number, description?: string, payerEmail?: string }
// Response: { mpPaymentId, status, qrCode, qrCodeBase64, ticketUrl }
//
// Secrets required (set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the platform)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const MP_API = 'https://api.mercadopago.com/v1/payments';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Não autenticado.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client scoped to the caller — used only to identify who's calling.
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData?.user) {
      return json({ error: 'Sessão inválida.' }, 401);
    }

    // Service-role client — the only one allowed to read the access token.
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: userRow, error: userError } = await adminClient
      .from('User')
      .select('id, companyId, role')
      .eq('id', authData.user.id)
      .single();
    if (userError || !userRow?.companyId) {
      return json({ error: 'Usuário sem empresa associada.' }, 403);
    }

    const { data: company, error: companyError } = await adminClient
      .from('Company')
      .select('id, name')
      .eq('id', userRow.companyId)
      .single();
    if (companyError || !company) {
      return json({ error: 'Empresa não encontrada.' }, 404);
    }

    const masterAccessToken = Deno.env.get('MP_MASTER_ACCESS_TOKEN');
    if (!masterAccessToken) {
      console.error('MP_MASTER_ACCESS_TOKEN não configurado.');
      return json({ error: 'Pagamento online indisponível no momento.' }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return json({ error: 'Valor inválido.' }, 400);
    }
    const tabId = body.tabId ?? null;
    const deliveryOrderId = body.deliveryOrderId ?? null;
    const description = String(body.description ?? `Pedido — ${company.name}`).slice(0, 250);
    const payerEmail = body.payerEmail || 'cliente@integra360.app';

    // Idempotency key avoids duplicate charges on retry.
    const idempotencyKey = `${userRow.companyId}-${tabId ?? deliveryOrderId ?? crypto.randomUUID()}-${Date.now()}`;

    const mpResponse = await fetch(MP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${masterAccessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description,
        payment_method_id: 'pix',
        payer: { email: payerEmail },
      }),
    });

    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      console.error('Mercado Pago error', mpData);
      return json({ error: mpData?.message || 'Falha ao criar cobrança no Mercado Pago.' }, 502);
    }

    const txData = mpData.point_of_interaction?.transaction_data ?? {};
    const record = {
      companyId: userRow.companyId,
      tabId,
      deliveryOrderId,
      mpPaymentId: String(mpData.id),
      status: mpData.status ?? 'pending',
      amount,
      qrCode: txData.qr_code ?? null,
      qrCodeBase64: txData.qr_code_base64 ?? null,
      ticketUrl: txData.ticket_url ?? null,
    };

    const { error: insertError } = await adminClient.from('MercadoPagoPayment').insert([record]);
    if (insertError) {
      console.error('Failed to persist MercadoPagoPayment', insertError);
    }

    return json({
      mpPaymentId: record.mpPaymentId,
      status: record.status,
      qrCode: record.qrCode,
      qrCodeBase64: record.qrCodeBase64,
      ticketUrl: record.ticketUrl,
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'Erro inesperado ao criar cobrança Pix.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
