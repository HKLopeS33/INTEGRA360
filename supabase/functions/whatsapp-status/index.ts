// Edge Function: whatsapp-status
// Webhook da Meta Cloud API para acompanhar o status de entrega das mensagens
// enviadas pela whatsapp-notify (sent → delivered → read, ou failed + motivo).
//
// A Meta só informa falhas de entrega por este webhook — a resposta do envio
// (ok + wamid) apenas confirma que a mensagem foi ACEITA, não que foi entregue.
//
// Configuração:
//   1. Secret no Supabase: WA_WEBHOOK_VERIFY_TOKEN (qualquer texto que você escolher)
//   2. Deploy com "Verify JWT" DESLIGADO (a Meta não envia JWT do Supabase)
//   3. Meta App → WhatsApp → Configuração → Webhook:
//        URL de callback: https://<project>.supabase.co/functions/v1/whatsapp-status
//        Token de verificação: o mesmo valor de WA_WEBHOOK_VERIFY_TOKEN
//      e assinar o campo "messages".
//
// Os eventos aparecem em Edge Functions → whatsapp-status → Logs.

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── Verificação do webhook (GET feito pela Meta ao salvar a URL) ─────────
  if (req.method === 'GET') {
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expected  = Deno.env.get('WA_WEBHOOK_VERIFY_TOKEN');

    if (mode === 'subscribe' && expected && token === expected) {
      return new Response(challenge ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  // ── Eventos de status ────────────────────────────────────────────────────
  try {
    const body = await req.json().catch(() => ({}));
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const st of change?.value?.statuses ?? []) {
          const base = `[WA status] ${st.status} id=${st.id} to=${st.recipient_id}`;
          if (st.status === 'failed') {
            for (const err of st.errors ?? []) {
              console.error(`${base} code=${err.code} title="${err.title}" detail="${err?.error_data?.details ?? err.message ?? ''}"`);
            }
          } else {
            console.log(base);
          }
        }
      }
    }
  } catch (err) {
    console.error('whatsapp-status error:', String(err));
  }

  // Sempre 200 — se não, a Meta fica reenviando
  return new Response('ok', { status: 200 });
});
