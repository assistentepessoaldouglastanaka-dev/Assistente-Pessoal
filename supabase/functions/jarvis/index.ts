// Jarvis: responde perguntas livres usando a IA gratuita da Cloudflare (Workers AI).
// Os comandos comuns são resolvidos no próprio app, por regras; só o que elas não entendem chega aqui.
// O app envia um resumo dos dados do dia (agenda, tarefas, finanças...) como contexto.
// Secrets: CF_ACCOUNT_ID, CF_API_TOKEN (permissão "Workers AI: Read") e, opcional, CF_MODELO.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MODELO = Deno.env.get('CF_MODELO') ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SISTEMA = `Você é o J.A.R.V.I.S., assistente pessoal do usuário, no estilo do mordomo digital do Homem de Ferro:
educado, objetivo, levemente espirituoso, sempre em português do Brasil. Trate o usuário como "{TRATAMENTO}".
Suas respostas serão FALADAS em voz alta: no máximo 3 frases curtas, sem listas, sem markdown, sem emojis.
Valores em reais por extenso de forma natural ("mil e duzentos reais"); horários como "nove e meia".
Use SOMENTE os dados do CONTEXTO para falar da vida do usuário. Se a informação não estiver lá, diga que não tem esse dado.
Se o usuário pedir para CRIAR algo, responda com uma ação. Ações possíveis (campos obrigatórios):
- {"tipo":"gasto","valor":number,"descricao":string,"categoria":"Moradia|Alimentação|Transporte|Saúde|Educação|Lazer|Contas|Assinaturas|Compras|Outros","data":"AAAA-MM-DD"}
- {"tipo":"tarefa","titulo":string,"area":"pessoal|trabalho","prazo":"AAAA-MM-DD"|null}
- {"tipo":"evento","titulo":string,"data":"AAAA-MM-DD","inicio":"HH:MM"|null}
- {"tipo":"alarme","hora":"HH:MM","rotulo":string}
Responda APENAS com JSON válido neste formato: {"resposta": "texto falado", "acao": null ou um objeto de ação}.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Só usuários logados no app
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!user) return json({ erro: 'nao_autenticado' }, 401);

  const conta = Deno.env.get('CF_ACCOUNT_ID'), token = Deno.env.get('CF_API_TOKEN');
  if (!conta || !token) return json({ erro: 'nao_configurado' }, 503);

  const { pergunta, contexto, historico, tratamento } = await req.json().catch(() => ({}));
  if (!pergunta || typeof pergunta !== 'string') return json({ erro: 'sem_pergunta' }, 400);

  const mensagens = [
    { role: 'system', content: SISTEMA.replace('{TRATAMENTO}', String(tratamento || 'senhor').slice(0, 40)) + '\n\nCONTEXTO:\n' + String(contexto ?? '').slice(0, 6000) },
    ...(Array.isArray(historico) ? historico.slice(-6) : [])
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) })),
    { role: 'user', content: pergunta.slice(0, 600) },
  ];

  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/${MODELO}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: mensagens, max_tokens: 300, temperature: 0.4 }),
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados?.success) {
    const cota = JSON.stringify(dados ?? '').match(/neuron|quota|limit/i);
    return json({ erro: cota ? 'cota' : 'ia', detalhe: dados?.errors?.[0]?.message }, cota ? 429 : 502);
  }

  // O modelo deve responder JSON; se vier texto solto, usa como resposta
  const bruto = dados.result?.response;
  let saida: { resposta?: string; acao?: unknown } = {};
  if (bruto && typeof bruto === 'object') saida = bruto;
  else {
    const texto = String(bruto ?? '').trim();
    const trecho = texto.match(/\{[\s\S]*\}/)?.[0];
    try { saida = trecho ? JSON.parse(trecho) : { resposta: texto }; } catch { saida = { resposta: texto }; }
  }
  return json({ resposta: String(saida.resposta ?? '').slice(0, 600), acao: saida.acao ?? null });
});
