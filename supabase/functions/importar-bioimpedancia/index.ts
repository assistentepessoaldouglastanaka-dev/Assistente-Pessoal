// Importa as avaliações de bioimpedância de um relatório do Galileu (b.IA / Tera Science).
// O site não permite chamadas de outros domínios (CORS), então a busca é feita aqui no servidor.
// Nada é guardado: a função só lê o relatório e devolve as medições normalizadas para o app.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const n = (v: unknown, casas = 1) => (typeof v === 'number' && isFinite(v) ? +v.toFixed(casas) : null);

// deno-lint-ignore no-explicit-any
function normalizar(a: any) {
  const r = a.result ?? {};
  return {
    id: 'galileu:' + a._id,
    fonte: 'galileu',
    data: String(a.dateTime).slice(0, 10),
    peso: n(a.weight),
    altura: n(a.height, 0),
    cintura: n(a.waistCircunference),
    imc: n(r.IMC),
    gorduraPct: n(r.fatPerc),
    gorduraKg: n(r.fatWeight),
    massaMagraKg: n(r.FFM),
    massaMagraPct: n(r.FFMPerc),
    massaMuscularKg: n(r.SMM),
    massaMuscularPct: n(r.SMMPerc),
    aguaTotalL: n(r.TBW),
    aguaPct: n(r.TBWPerc),
    aguaIntraL: n(r.ICW),
    aguaExtraL: n(r.ECW),
    indiceHidratacao: n(r.hr),
    razaoMusculoGordura: n(r.RazaoMusculoGordura, 2),
    gorduraVisceral: n(r.VFA),
    tmb: n(r.TMB, 0),
    idadeAnguloFase: n(r.ageOfPhaseAngle, 0),
    anguloFase: n(a.measure?.['50khz']?.phaseAngle, 2),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Só usuários logados no app
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!user) return json({ erro: 'nao_autenticado' }, 401);

  const { link } = await req.json().catch(() => ({ link: '' }));
  const id = String(link ?? '').match(/relatorio=([a-f0-9]{24})/i)?.[1] ?? String(link ?? '').match(/^\s*([a-f0-9]{24})\s*$/i)?.[1];
  if (!id) return json({ erro: 'link_invalido' }, 400);

  const r = await fetch('https://galileuonline.com.br/api/evaluation/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _id: id, limit: 500 }),
  });
  if (!r.ok) return json({ erro: 'galileu', status: r.status }, 502);
  const info = (await r.json())?.info;
  if (!info?._id) return json({ erro: 'relatorio_nao_encontrado' }, 404);

  // O relatório traz a avaliação atual + o histórico em `evaluations`
  const vistos = new Set<string>();
  const avaliacoes = [info, ...(info.evaluations ?? [])]
    .filter((a) => a?._id && !vistos.has(a._id) && vistos.add(a._id))
    .map(normalizar)
    .sort((a, b) => a.data.localeCompare(b.data));

  return json({ avaliacoes });
});
