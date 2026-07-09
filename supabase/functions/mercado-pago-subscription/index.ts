// Cria ou retorna uma assinatura recorrente no Mercado Pago (Preapproval).
//
// POST { companyId, plan: 'STARTER' | 'PRO', backUrl }
//   → { initPoint, subscriptionId }        (nova ou pendente de autorização)
//
// DELETE { companyId }
//   → { ok: true }                          (cancela assinatura ativa)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getMasterAccessToken } from '../_shared/platformMercadoPago.ts';

const MP_PREAPPROVAL_API = 'https://api.mercadopago.com/preapproval';

const PLAN_CONFIG: Record<string, { label: string; amount: number }> = {
  STARTER: { label: 'Integra360 — Plano Starter', amount: 79.00 },
  PRO:     { label: 'Integra360 — Plano Pro',     amount: 149.00 },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Autenticação: extrair company do JWT ──────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Não autenticado.' }, 401);

    const masterAccessToken = await getMasterAccessToken(adminClient);
    if (!masterAccessToken) return json({ error: 'Pagamento online indisponível.' }, 503);

    // ── Cancelamento ──────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => ({}));
      const companyId = String(body.companyId ?? '').trim();
      if (!companyId) return json({ error: 'companyId obrigatório.' }, 400);

      const { data: sub } = await adminClient
        .from('Subscription')
        .select('mpSubscriptionId')
        .eq('companyId', companyId)
        .maybeSingle();

      if (sub?.mpSubscriptionId) {
        await fetch(`${MP_PREAPPROVAL_API}/${sub.mpSubscriptionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterAccessToken}` },
          body: JSON.stringify({ status: 'cancelled' }),
        });
        await adminClient.from('Subscription')
          .update({ mpSubscriptionId: null, status: 'CANCELADO' })
          .eq('companyId', companyId);
      }
      return json({ ok: true });
    }

    // ── Criação ───────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const companyId = String(body.companyId ?? '').trim();
    const planKey   = String(body.plan      ?? 'PRO').toUpperCase();
    const backUrl   = String(body.backUrl   ?? '').trim();

    if (!companyId || !backUrl) return json({ error: 'companyId e backUrl são obrigatórios.' }, 400);

    const planCfg = PLAN_CONFIG[planKey];
    if (!planCfg) return json({ error: 'Plano inválido. Use STARTER ou PRO.' }, 400);

    // Buscar empresa e e-mail do admin
    const { data: company } = await adminClient
      .from('Company')
      .select('id, name, email')
      .eq('id', companyId)
      .maybeSingle();
    if (!company) return json({ error: 'Empresa não encontrada.' }, 404);

    // Verificar se já existe assinatura ativa
    const { data: existing } = await adminClient
      .from('Subscription')
      .select('mpSubscriptionId, status')
      .eq('companyId', companyId)
      .maybeSingle();

    if (existing?.mpSubscriptionId) {
      // Buscar status atual no MP
      const mpRes = await fetch(`${MP_PREAPPROVAL_API}/${existing.mpSubscriptionId}`, {
        headers: { Authorization: `Bearer ${masterAccessToken}` },
      });
      const mpData = await mpRes.json();
      if (mpRes.ok && mpData.status === 'authorized' && mpData.init_point) {
        return json({ initPoint: mpData.init_point, subscriptionId: existing.mpSubscriptionId, existing: true });
      }
    }

    // Criar nova assinatura no MP
    const externalRef = `company:${companyId}:plan:${planKey}`;
    const preapproval = {
      reason: planCfg.label,
      external_reference: externalRef,
      payer_email: company.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: planCfg.amount,
        currency_id: 'BRL',
      },
      back_url: backUrl,
      status: 'pending',
    };

    console.log('Creating MP preapproval for company', companyId, 'plan', planKey);

    const mpResponse = await fetch(MP_PREAPPROVAL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${masterAccessToken}`,
        'X-Idempotency-Key': `sub-${companyId}-${planKey}-${Date.now()}`,
      },
      body: JSON.stringify(preapproval),
    });

    const mpData = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok) {
      console.error('MP preapproval error', mpResponse.status, JSON.stringify(mpData));
      return json({ error: mpData?.message || `Falha ao criar assinatura (MP ${mpResponse.status}).` }, 502);
    }

    const subscriptionId = String(mpData.id ?? '');
    const initPoint      = String(mpData.init_point ?? '');

    if (!initPoint) return json({ error: 'Mercado Pago não retornou URL de assinatura.' }, 502);

    // Salvar mpSubscriptionId na Subscription
    await adminClient.from('Subscription')
      .upsert([{
        companyId,
        mpSubscriptionId: subscriptionId,
        status: 'PENDENTE',
        monthlyFee: planCfg.amount,
        lastRenewed: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 dias para autorizar
      }], { onConflict: 'companyId' });

    console.log('Preapproval created:', subscriptionId, initPoint);
    return json({ initPoint, subscriptionId });

  } catch (err) {
    console.error('Unexpected error in mercado-pago-subscription:', err);
    return json({ error: 'Erro inesperado.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
