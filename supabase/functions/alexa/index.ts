// Skill da Alexa para o Jarvis: "Alexa, pede ao meu jarvis gastei cinquenta reais no mercado".
// Recebe a frase da Alexa, monta um resumo dos dados do usuário direto do banco, pergunta à IA gratuita
// da Cloudflare e executa a ação (gasto, tarefa, alarme, evento) gravando em `itens` — os aparelhos
// recebem a mudança na hora pela sincronização.
// Secrets: ALEXA_SKILL_ID (ID da skill), ALEXA_USER_ID (seu usuário no Supabase), CF_ACCOUNT_ID, CF_API_TOKEN,
// e GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (já existentes) para criar eventos no Google Agenda.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TZ = 'America/Sao_Paulo';
const MODELO = Deno.env.get('CF_MODELO') ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CATEGORIAS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Contas', 'Assinaturas', 'Compras', 'Outros'];

// ---------- Respostas no formato da Alexa ----------
const falar = (texto: string, continuar = false) => new Response(JSON.stringify({
  version: '1.0',
  response: {
    outputSpeech: { type: 'PlainText', text: texto },
    ...(continuar ? { reprompt: { outputSpeech: { type: 'PlainText', text: 'Posso ajudar em mais alguma coisa?' } } } : {}),
    shouldEndSession: !continuar,
  },
}), { headers: { 'Content-Type': 'application/json' } });

// ---------- Datas no fuso do usuário ----------
const partes = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .formatToParts(d).map((p) => [p.type, p.value]));
const hojeISO = () => { const p = partes(); return `${p.year}-${p.month}-${p.day}`; };
const agoraHM = () => { const p = partes(); return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`; };
const somaDias = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaSemana = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Mesma lógica de recorrência da agenda do app
// deno-lint-ignore no-explicit-any
function ocorre(ev: any, iso: string) {
  if (iso < ev.data || (ev.ate && iso > ev.ate)) return false;
  switch (ev.repetir) {
    case 'diario': return true;
    case 'uteis': { const d = diaSemana(iso); return d > 0 && d < 6; }
    case 'semanal': return diaSemana(iso) === diaSemana(ev.data);
    case 'mensal': return iso.slice(8) === ev.data.slice(8);
    case 'anual': return iso.slice(5) === ev.data.slice(5);
    default: return iso === ev.data;
  }
}

// ---------- Google (Agenda) ----------
// deno-lint-ignore no-explicit-any
async function tokenGoogle(admin: any, userId: string): Promise<string | null> {
  const { data } = await admin.from('integracoes').select('refresh_token').eq('user_id', userId).eq('provedor', 'google').maybeSingle();
  if (!data?.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, refresh_token: data.refresh_token, grant_type: 'refresh_token' }),
  });
  return r.ok ? (await r.json()).access_token : null;
}
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// ---------- Contexto (o "R" do RAG): resumo dos dados do usuário ----------
// deno-lint-ignore no-explicit-any
function montarContexto(c: Record<string, any[]>, unicos: Record<string, any>, eventosGoogle: any[]) {
  const h = hojeISO(), mes = h.slice(0, 7), amanha = somaDias(h, 1);
  const linhas = [`Agora: ${h} ${agoraHM()} (fuso de São Paulo).`];
  for (const iso of [h, amanha]) {
    const locais = (c.eventos ?? []).filter((e) => ocorre(e, iso)).map((e) => `${e.inicio || 'dia todo'} ${e.titulo}`);
    const google = eventosGoogle.filter((e) => e.data === iso).map((e) => `${e.inicio || 'dia todo'} ${e.titulo}`);
    const todos = [...locais, ...google].sort();
    linhas.push(`Agenda ${iso === h ? 'hoje' : 'amanhã'}: ${todos.join('; ') || 'nada'}.`);
  }
  const pend = (c.tarefas ?? []).filter((t) => t.status !== 'feito').sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999')).slice(0, 12);
  linhas.push(`Tarefas pendentes: ${pend.map((t) => `${t.titulo} [${t.area}${t.prazo ? ', prazo ' + t.prazo : ''}]`).join('; ') || 'nenhuma'}.`);
  const fixos = (c.fixos ?? []).filter((f) => f.inicio <= mes && (!f.fim || f.fim >= mes));
  const vars = (c.variaveis ?? []).filter((v) => String(v.data).startsWith(mes));
  const divs = (c.dividas ?? []).filter((d) => d.inicio <= mes);
  const soma = (l: any[], k: string) => l.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const renda = unicos.renda?.[mes] ?? 0, tf = soma(fixos, 'valor'), tv = soma(vars, 'valor'), td = soma(divs, 'parcela');
  const cats: Record<string, number> = {};
  for (const g of [...fixos, ...vars]) cats[g.categoria] = (cats[g.categoria] ?? 0) + Number(g.valor);
  linhas.push(`Finanças do mês: renda ${renda}, fixos ${tf}, variáveis ${tv}, parcelas ${td}, saldo previsto ${renda - tf - tv - td}. Por categoria: ${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`);
  const naoPagos = fixos.filter((f) => f.dia && !f.pagos?.[mes]).map((f) => `${f.nome} ${f.valor} dia ${f.dia}`);
  linhas.push(`Contas fixas não pagas: ${naoPagos.join('; ') || 'nenhuma'}.`);
  const bio = (c.bioimpedancia ?? []).filter((b) => !b.descartada).sort((a, b) => a.data.localeCompare(b.data)).slice(-2);
  if (bio.length) linhas.push(`Bioimpedância: ${bio.map((b) => `${b.data}: peso ${b.peso}, gordura ${b.gorduraPct}%, músculo ${b.massaMuscularKg}kg`).join(' | ')}.`);
  const sem = unicos.treinos_semana ?? {}, modelos = c.treinos_modelos ?? [];
  const mHoje = modelos.find((m) => m.id === sem[String(diaSemana(h))]);
  linhas.push(`Treino de hoje: ${mHoje ? mHoje.nome : 'descanso'}.`);
  linhas.push(`Alarmes ativos: ${(c.alarmes ?? []).filter((a) => a.ativo).map((a) => `${a.hora} ${a.rotulo || ''}`).join('; ') || 'nenhum'}.`);
  return linhas.join('\n');
}

const SISTEMA = `Você é o J.A.R.V.I.S., assistente pessoal do usuário, falando pela Alexa. Educado, objetivo, levemente espirituoso,
sempre em português do Brasil. Trate o usuário como "senhor". A resposta será FALADA: no máximo 3 frases curtas, sem listas,
sem markdown, sem emojis. Use SOMENTE os dados do CONTEXTO para falar da vida do usuário; se não houver o dado, diga que não tem.
Se o usuário pedir para CRIAR algo, inclua uma ação (use as datas a partir de "Agora" do contexto):
- {"tipo":"gasto","valor":number,"descricao":string,"categoria":"${CATEGORIAS.join('|')}","data":"AAAA-MM-DD"}
- {"tipo":"tarefa","titulo":string,"area":"pessoal|trabalho","prazo":"AAAA-MM-DD"|null}
- {"tipo":"evento","titulo":string,"data":"AAAA-MM-DD","inicio":"HH:MM"|null}
- {"tipo":"alarme","hora":"HH:MM","rotulo":string,"data":"AAAA-MM-DD"|null}
Responda APENAS com JSON válido: {"resposta": "texto falado", "acao": null ou objeto de ação}.`;

// Frase reconstruída a partir da intenção da Alexa (a palavra de comando não vem no slot)
const PREFIXO: Record<string, string> = {
  GastoIntent: 'gastei ', AlarmeIntent: 'me acorda ', LembreteIntent: 'me lembra de ', EventoIntent: 'marca na agenda ',
  TarefaIntent: 'cria uma tarefa ', PerguntaIntent: '', ResumoIntent: 'faça um resumo do meu dia de hoje',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  // deno-lint-ignore no-explicit-any
  const corpo: any = await req.json().catch(() => null);
  if (!corpo?.request) return new Response('requisição inválida', { status: 400 });

  // Só aceita a sua skill, e só pedidos recentes (até 150 s)
  const skill = corpo.session?.application?.applicationId ?? corpo.context?.System?.application?.applicationId;
  if (skill !== Deno.env.get('ALEXA_SKILL_ID')) return new Response('skill não autorizada', { status: 403 });
  if (Math.abs(Date.now() - Date.parse(corpo.request.timestamp)) > 150000) return new Response('pedido expirado', { status: 400 });

  const tipo = corpo.request.type;
  if (tipo === 'LaunchRequest') return falar('J.A.R.V.I.S. online. Em que posso ajudar, senhor?', true);
  if (tipo === 'SessionEndedRequest') return falar('');
  const intent = corpo.request.intent?.name ?? '';
  if (intent === 'AMAZON.HelpIntent') return falar('Você pode dizer, por exemplo: gastei cinquenta reais no mercado; me lembra de ligar para o banco às três da tarde; o que tenho amanhã; ou como estão minhas finanças.', true);
  if (['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'].includes(intent)) return falar('Até logo, senhor.');
  if (intent === 'AMAZON.FallbackIntent') return falar('Não entendi, senhor. Pode repetir de outro jeito?', true);

  const frase = String(corpo.request.intent?.slots?.frase?.value ?? '').trim();
  const pergunta = (PREFIXO[intent] ?? '') + frase;
  if (!pergunta.trim()) return falar('Pode repetir, senhor?', true);

  const userId = Deno.env.get('ALEXA_USER_ID')!;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Dados do usuário (mesma tabela que o app sincroniza)
  const { data: linhas } = await admin.from('itens').select('colecao,id,dados').eq('user_id', userId).eq('excluido', false);
  // deno-lint-ignore no-explicit-any
  const c: Record<string, any[]> = {}, unicos: Record<string, any> = {};
  for (const l of linhas ?? []) {
    if (l.colecao === '_unico') unicos[l.id] = l.dados;
    else (c[l.colecao] ??= []).push(l.dados);
  }

  // Eventos do Google Agenda (hoje e amanhã), se a integração estiver ligada
  const usaGoogle = unicos.google?.agenda !== false;
  const token = usaGoogle ? await tokenGoogle(admin, userId).catch(() => null) : null;
  // deno-lint-ignore no-explicit-any
  let eventosGoogle: any[] = [];
  if (token) {
    const h = hojeISO();
    const p = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: `${h}T00:00:00-03:00`, timeMax: `${somaDias(h, 2)}T00:00:00-03:00` });
    const r = await fetch(`${CAL}?${p}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (r?.ok) eventosGoogle = ((await r.json()).items ?? []).filter((e: { status: string }) => e.status !== 'cancelled').map((e: { summary?: string; start: { date?: string; dateTime?: string } }) => ({
      titulo: e.summary ?? '(sem título)',
      data: e.start.date ?? (e.start.dateTime ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(e.start.dateTime)) : ''),
      inicio: e.start.dateTime ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(e.start.dateTime)) : '',
    }));
  }

  // IA gratuita da Cloudflare
  const conta = Deno.env.get('CF_ACCOUNT_ID'), cfToken = Deno.env.get('CF_API_TOKEN');
  if (!conta || !cfToken) return falar('Minha inteligência na nuvem ainda não foi configurada, senhor.');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/${MODELO}`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_tokens: 250, temperature: 0.3, messages: [
      { role: 'system', content: SISTEMA + '\n\nCONTEXTO:\n' + montarContexto(c, unicos, eventosGoogle) },
      { role: 'user', content: pergunta.slice(0, 500) },
    ] }),
  }).catch(() => null);
  const dados = await r?.json().catch(() => null);
  if (!r?.ok || !dados?.success) return falar('Não consegui pensar nisso agora, senhor. Tente de novo em instantes.');
  const bruto = dados.result?.response;
  // deno-lint-ignore no-explicit-any
  let saida: any = {};
  if (bruto && typeof bruto === 'object') saida = bruto;
  else { const t = String(bruto ?? ''); try { saida = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { saida = { resposta: t }; } }

  // Executa a ação (validada) gravando no banco do usuário
  const a = saida.acao;
  const data = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  const hora = (s: unknown) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s) ? s : null;
  const gravar = (colecao: string, item: Record<string, unknown>) =>
    admin.from('itens').upsert({ user_id: userId, colecao, id: item.id as string, dados: item, excluido: false }, { onConflict: 'user_id,colecao,id' });
  let falhou = false;
  if (a && typeof a === 'object') {
    if (a.tipo === 'gasto' && Number(a.valor) > 0) {
      await gravar('variaveis', { id: uid(), nome: String(a.descricao || 'Gasto').slice(0, 80), valor: Math.round(Number(a.valor) * 100) / 100,
        categoria: CATEGORIAS.includes(a.categoria) ? a.categoria : 'Outros', data: data(a.data) ?? hojeISO() });
    } else if (a.tipo === 'tarefa' && a.titulo) {
      await gravar('tarefas', { id: uid(), area: a.area === 'trabalho' ? 'trabalho' : 'pessoal', titulo: String(a.titulo).slice(0, 120), status: 'afazer', prioridade: 'media', prazo: data(a.prazo) ?? '', projeto: '' });
    } else if (a.tipo === 'alarme' && hora(a.hora)) {
      const h = hojeISO();
      await gravar('alarmes', { id: uid(), hora: a.hora, rotulo: String(a.rotulo || 'Alarme').slice(0, 60), dias: [], ativo: true,
        data: data(a.data) ?? (a.hora > agoraHM() ? h : somaDias(h, 1)) });
    } else if (a.tipo === 'evento' && a.titulo && data(a.data)) {
      const ini = hora(a.inicio);
      if (token) {
        const fim = ini ? `${String(Math.min(23, Number(ini.slice(0, 2)) + 1)).padStart(2, '0')}:${ini.slice(3)}` : null;
        const ev = { summary: String(a.titulo).slice(0, 120), reminders: { useDefault: false, overrides: ini ? [{ method: 'popup', minutes: 15 }] : [] },
          start: ini ? { dateTime: `${a.data}T${ini}:00`, timeZone: TZ } : { date: a.data }, end: ini ? { dateTime: `${a.data}T${fim}:00`, timeZone: TZ } : { date: somaDias(a.data, 1) } };
        const rr = await fetch(CAL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).catch(() => null);
        falhou = !rr?.ok;
      } else {
        await gravar('eventos', { id: uid(), titulo: String(a.titulo).slice(0, 120), data: a.data, inicio: ini ?? '', fim: '', local: '', rotaId: '', alerta: ini ? '15' : '', repetir: 'nao', ate: '', tipo: 'pessoal', notas: '' });
      }
    }
  }
  const resposta = String(saida.resposta ?? '').trim() || 'Feito, senhor.';
  return falar(falhou ? 'Não consegui salvar no Google Agenda agora, senhor.' : resposta);
});
