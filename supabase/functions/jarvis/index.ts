// Jarvis: responde perguntas livres usando a IA gratuita da Cloudflare (Workers AI).
// Os comandos comuns são resolvidos no próprio app, por regras; só o que elas não entendem chega aqui.
// O app envia um resumo dos dados do dia (agenda, tarefas, finanças...) como contexto.
// Também lê o plano da nutricionista (modo "plano") e estima preços de mercado (modo "precos").
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

const PLANO = `Você recebe o texto de um plano alimentar escrito por uma nutricionista brasileira (pode vir bagunçado, extraído de PDF).
Organize em JSON EXATAMENTE neste formato:
{"titulo": string, "refeicoes": [{"nome": string, "horario": "HH:MM" ou null,
  "itens": [{"alimento": string, "texto": string, "quantidade": number ou null, "unidade": "g"|"ml"|"un", "vezesSemana": number}],
  "opcoes": [string]}],
 "orientacoes": [string]}
Regras:
- "alimento": nome do produto como se compra no mercado, curto e genérico (ex.: "Peito de frango", "Aveia em flocos", "Banana", "Ovo").
- "texto": a linha como está no plano (ex.: "2 colheres de sopa de aveia (30 g)").
- "quantidade" + "unidade": quanto se come por vez, convertido para gramas (g), mililitros (ml) ou unidades (un).
  Use os gramas do plano quando houver; se só houver medida caseira, estime (1 colher de sopa de aveia ≈ 15 g, 1 fatia de pão ≈ 25 g, 1 xícara de leite ≈ 240 ml).
- "vezesSemana": quantas vezes por semana esse item é comido (7 se for todo dia; menos se o plano disser, ex.: "3x por semana").
- Se a refeição tiver opções (Opção 1, Opção 2...), coloque a PRIMEIRA em "itens" e resuma as outras em "opcoes", uma frase cada.
- Substituições de um alimento vão em "opcoes" da refeição, ex.: "Frango pode trocar por peixe ou patinho".
- Não inclua água, sal, temperos a gosto, chás sem quantidade nem suplementos manipulados em "itens"; ponha-os em "orientacoes" se forem importantes.
- "orientacoes": recomendações gerais (hidratação, horários, o que evitar), frases curtas.
Responda APENAS com o JSON, sem comentários.`;

const PRECOS = `Você estima preços de supermercado no Brasil (média de grandes redes, preço atual, sem promoção).
Para cada item recebido, dê o preço em reais por unidade indicada: "kg" = por quilo, "L" = por litro, "un" = por unidade.
Responda APENAS com JSON: {"precos": [{"nome": string, "preco": number}]}, na mesma ordem e com os mesmos nomes.`;

// Chama o modelo da Cloudflare e devolve o JSON da resposta (ou texto solto em { resposta })
async function rodar(conta: string, token: string, messages: unknown[], max_tokens: number, temperature: number) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/${MODELO}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens, temperature }),
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados?.success) {
    const cota = JSON.stringify(dados ?? '').match(/neuron|quota|limit/i);
    return { erro: cota ? 'cota' : 'ia', detalhe: dados?.errors?.[0]?.message, status: cota ? 429 : 502 };
  }
  const bruto = dados.result?.response;
  if (bruto && typeof bruto === 'object') return { saida: bruto };
  const texto = String(bruto ?? '').trim();
  const trecho = texto.match(/\{[\s\S]*\}/)?.[0];
  try { return { saida: trecho ? JSON.parse(trecho) : { resposta: texto } }; } catch { return { saida: { resposta: texto }, quebrado: true }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Só usuários logados no app
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!user) return json({ erro: 'nao_autenticado' }, 401);

  const conta = Deno.env.get('CF_ACCOUNT_ID'), token = Deno.env.get('CF_API_TOKEN');
  if (!conta || !token) return json({ erro: 'nao_configurado' }, 503);

  const corpo = await req.json().catch(() => ({}));
  const { pergunta, contexto, historico, tratamento } = corpo;

  if (corpo.modo === 'plano') {
    const texto = String(corpo.texto ?? '').trim();
    if (texto.length < 30) return json({ erro: 'sem_texto' }, 400);
    const r = await rodar(conta, token, [{ role: 'system', content: PLANO }, { role: 'user', content: texto.slice(0, 14000) }], 4000, 0.1);
    if (r.erro) return json({ erro: r.erro, detalhe: r.detalhe }, r.status);
    if (!Array.isArray(r.saida?.refeicoes)) return json({ erro: 'nao_entendi' }, 422);
    return json({ plano: r.saida });
  }
  if (corpo.modo === 'precos') {
    const itens = (Array.isArray(corpo.itens) ? corpo.itens : []).slice(0, 80)
      .map((i: { nome?: string; unidade?: string }) => ({ nome: String(i?.nome ?? '').slice(0, 60), unidade: ['kg', 'L', 'un'].includes(String(i?.unidade)) ? i.unidade : 'un' }));
    if (!itens.length) return json({ erro: 'sem_itens' }, 400);
    const r = await rodar(conta, token, [{ role: 'system', content: PRECOS }, { role: 'user', content: JSON.stringify(itens) }], 2500, 0.1);
    if (r.erro) return json({ erro: r.erro, detalhe: r.detalhe }, r.status);
    const precos = (Array.isArray(r.saida?.precos) ? r.saida.precos : [])
      .filter((p: { nome?: unknown; preco?: unknown }) => typeof p?.nome === 'string' && Number(p?.preco) > 0)
      .map((p: { nome: string; preco: number }) => ({ nome: p.nome, preco: Math.round(Number(p.preco) * 100) / 100 }));
    return json({ precos });
  }

  if (!pergunta || typeof pergunta !== 'string') return json({ erro: 'sem_pergunta' }, 400);

  const mensagens = [
    { role: 'system', content: SISTEMA.replace('{TRATAMENTO}', String(tratamento || 'senhor').slice(0, 40)) + '\n\nCONTEXTO:\n' + String(contexto ?? '').slice(0, 6000) },
    ...(Array.isArray(historico) ? historico.slice(-6) : [])
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) })),
    { role: 'user', content: pergunta.slice(0, 600) },
  ];

  const r = await rodar(conta, token, mensagens, 300, 0.4);
  if (r.erro) return json({ erro: r.erro, detalhe: r.detalhe }, r.status);
  const saida: { resposta?: string; acao?: unknown } = r.saida ?? {};
  return json({ resposta: String(saida.resposta ?? '').slice(0, 600), acao: saida.acao ?? null });
});
