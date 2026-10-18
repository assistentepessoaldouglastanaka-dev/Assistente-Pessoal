// Entrega ao app um token de acesso do Google renovado, a partir do refresh token salvo no login.
// O client secret do Google fica só aqui no servidor (secrets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ erro: 'nao_autenticado' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ erro: 'nao_autenticado' }, 401);

  const { data: integracao } = await admin
    .from('integracoes')
    .select('refresh_token')
    .eq('user_id', user.id)
    .eq('provedor', 'google')
    .maybeSingle();
  if (!integracao?.refresh_token) return json({ erro: 'sem_token' }, 404);

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: integracao.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const t = await r.json();
  if (!r.ok) {
    // invalid_grant: o usuário revogou o acesso ou o token expirou (app do Google em modo "Teste")
    return t.error === 'invalid_grant'
      ? json({ erro: 'reconectar' }, 401)
      : json({ erro: 'google', detalhe: t.error }, 502);
  }
  return json({ access_token: t.access_token, expires_in: t.expires_in });
});
