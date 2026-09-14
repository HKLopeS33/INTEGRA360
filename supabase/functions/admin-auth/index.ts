// Edge Function: admin-auth
// Operações de administração do Supabase Auth que exigem service role key.
// A service role key NUNCA deve estar no frontend — apenas neste server-side.
//
// Ações disponíveis:
//   create_user  — cria usuário no Auth com email confirmado automaticamente
//   delete_users — deleta um ou mais usuários do Auth por ID
//
// Segurança: apenas usuários autenticados com role SUPER podem chamar esta função.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl   = Deno.env.get('SUPABASE_URL')!;
    const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey       = Deno.env.get('SUPABASE_ANON_KEY')!;

    // ── Verificar autenticação do chamador ─────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerToken = authHeader.replace('Bearer ', '').trim();
    if (!callerToken) return json({ error: 'Não autenticado.' }, 401);

    // Validar token do usuário chamador via cliente anon
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });
    const { data: { user: callerUser }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !callerUser) return json({ error: 'Token inválido.' }, 401);

    // Verificar se o chamador tem role SUPER no banco
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRow } = await admin
      .from('User')
      .select('role')
      .eq('id', callerUser.id)
      .maybeSingle();

    if (!userRow || userRow.role !== 'SUPER') {
      return json({ error: 'Acesso negado. Apenas SUPER pode usar esta função.' }, 403);
    }

    // ── Processar ação ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // ── Criar usuário ──────────────────────────────────────────────────────
    if (action === 'create_user') {
      const { email, password, metadata } = body as {
        email: string;
        password: string;
        metadata?: Record<string, unknown>;
      };

      if (!email || !password) {
        return json({ error: 'email e password são obrigatórios.' }, 400);
      }

      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: metadata ?? {},
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return json({ error: data.msg || data.message || `Erro ${res.status} ao criar usuário.` }, 400);
      }

      return json({ id: data.id, email: data.email });
    }

    // ── Deletar usuários ───────────────────────────────────────────────────
    if (action === 'delete_users') {
      const { userIds } = body as { userIds: string[] };
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return json({ error: 'userIds é obrigatório.' }, 400);
      }

      const errors: string[] = [];
      await Promise.all(userIds.map(async (uid) => {
        const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'apikey': serviceKey,
          },
        });
        if (!res.ok && res.status !== 404) {
          errors.push(`uid ${uid}: ${res.status}`);
        }
      }));

      if (errors.length > 0) {
        console.warn('Alguns usuários não foram deletados:', errors);
      }

      return json({ ok: true, errors });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);

  } catch (err) {
    console.error('admin-auth unhandled error:', String(err));
    return json({ error: String(err) }, 500);
  }
});
