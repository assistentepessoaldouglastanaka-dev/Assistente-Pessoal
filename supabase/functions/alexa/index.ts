// Skill da Alexa para o Jarvis: "Alexa, pede ao meu jarvis gastei cinquenta reais no mercado".
// Recebe a frase da Alexa, monta um resumo dos dados do usuário direto do banco, pergunta à IA gratuita
// da Cloudflare e executa a ação (gasto, tarefa, alarme, evento) gravando em `itens` — os aparelhos
// recebem a mudança na hora pela sincronização.
// Secrets: ALEXA_SKILL_ID (ID da skill), ALEXA_USER_ID (seu usuário no Supabase), CF_ACCOUNT_ID, CF_API_TOKEN,
// e GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (já existentes) para criar eventos no Google Agenda.
// Segurança: cada pedido tem a assinatura digital da Amazon conferida (certificado + SHA-256) antes de qualquer coisa,
// seguindo as regras oficiais da Amazon para skills hospedadas fora dela.
import { createClient } from 'npm:@supabase/supabase-js@2';
import 'npm:reflect-metadata@0.2.2';
import { X509Certificate, SubjectAlternativeNameExtension } from 'npm:@peculiar/x509@2.2.0';

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
const comLimite = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
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
// O acesso ao Google vale ~1 h: fica guardado entre chamadas para não renovar a cada pedido
const cacheGoogle = { token: '', expira: 0 };
async function tokenGoogle(admin: any, userId: string): Promise<string | null> {
  if (cacheGoogle.token && Date.now() < cacheGoogle.expira) return cacheGoogle.token;
  const { data } = await admin.from('integracoes').select('refresh_token').eq('user_id', userId).eq('provedor', 'google').maybeSingle();
  if (!data?.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: comLimite(2000),
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!, refresh_token: data.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!r.ok) return null;
  const t = await r.json();
  cacheGoogle.token = t.access_token;
  cacheGoogle.expira = Date.now() + (Number(t.expires_in || 3600) - 300) * 1000;
  return cacheGoogle.token;
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

// ---------- Conferência da assinatura da Amazon ----------
// 1) o certificado vem do endereço oficial (https://s3.amazonaws.com/echo.api/...);
// 2) está na validade e foi emitido para echo-api.amazon.com;
// 3) a assinatura SHA-256 do corpo (cabeçalho Signature-256) confere com a chave do certificado;
// 4) o pedido tem no máximo 150 s.
const chavesAlexa = new Map<string, { chave: CryptoKey; ate: number }>();
async function verificarAlexa(urlCert: string, assinatura: string, corpo: string) {
  if (!urlCert || !assinatura) throw new Error('pedido sem assinatura');
  const u = new URL(urlCert);   // já resolve "../" no caminho
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 's3.amazonaws.com' || !u.pathname.startsWith('/echo.api/') || (u.port && u.port !== '443'))
    throw new Error('endereço do certificado não é da Amazon: ' + urlCert);
  let guardada = chavesAlexa.get(u.href);
  if (!guardada || Date.now() > guardada.ate) {
    const pem = await (await fetch(u.href, { signal: comLimite(2500) })).text();
    const primeiro = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
    if (!primeiro) throw new Error('certificado ilegível');
    const cert = new X509Certificate(primeiro);
    const agora = Date.now();
    if (agora < cert.notBefore.getTime() || agora > cert.notAfter.getTime()) throw new Error('certificado fora da validade');
    const nomes = (cert.getExtension(SubjectAlternativeNameExtension)?.names?.toJSON() ?? []) as { value: string }[];
    if (!nomes.some((n) => n.value === 'echo-api.amazon.com')) throw new Error('certificado não é de echo-api.amazon.com');
    const chave = await crypto.subtle.importKey('spki', cert.publicKey.rawData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    guardada = { chave, ate: cert.notAfter.getTime() };
    chavesAlexa.set(u.href, guardada);
  }
  const bytes = Uint8Array.from(atob(assinatura), (ch) => ch.charCodeAt(0));
  const valida = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', guardada.chave, bytes, new TextEncoder().encode(corpo));
  if (!valida) throw new Error('assinatura não confere');
  const quando = Date.parse(JSON.parse(corpo)?.request?.timestamp ?? '');
  if (!quando || Math.abs(Date.now() - quando) > 150000) throw new Error('pedido expirado');
}

// A Alexa espera no máximo 8 s: o pedido inteiro tem um orçamento de 7,2 s
const ORCAMENTO = 7200;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const inicio = Date.now();
  const bruto = await req.text();

  // 1) O pedido veio mesmo da Alexa? (assinatura digital da Amazon; também recusa pedidos com mais de 150 s)
  try {
    await verificarAlexa(req.headers.get('SignatureCertChainUrl') ?? '', req.headers.get('Signature-256') ?? '', bruto);
  } catch (e) {
    console.warn('Pedido recusado (assinatura da Alexa inválida):', String(e));
    return new Response('assinatura inválida', { status: 400 });
  }
  // deno-lint-ignore no-explicit-any
  let corpo: any;
  try { corpo = JSON.parse(bruto); } catch { return new Response('requisição inválida', { status: 400 }); }

  try {
    return await atender(corpo, inicio);
  } catch (e) {
    console.error('Erro na skill:', e);
    return falar('Tive um problema interno, senhor. Os detalhes ficaram no registro da função.');
  }
});

// deno-lint-ignore no-explicit-any
async function atender(corpo: any, inicio: number): Promise<Response> {
  const restante = () => ORCAMENTO - (Date.now() - inicio);
  const tempos: string[] = [`assinatura ${Date.now() - inicio}ms`];
  // 2) É a sua skill? (a assinatura já garantiu que veio da Alexa, então dá para explicar o problema em voz)
  const skill = corpo.session?.application?.applicationId ?? corpo.context?.System?.application?.applicationId;
  const esperado = Deno.env.get('ALEXA_SKILL_ID');
  if (!esperado) return falar('Falta configurar o segredo ALEXA SKILL ID no Supabase.');
  if (skill !== esperado.trim()) {
    console.warn(`ID da skill diferente. Recebido: ${skill} | configurado: ${esperado}`);
    return falar('O ID desta skill não confere com o segredo ALEXA SKILL ID configurado no Supabase.');
  }
  if (!Deno.env.get('ALEXA_USER_ID')) return falar('Falta configurar o segredo ALEXA USER ID no Supabase.');

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

  const userId = Deno.env.get('ALEXA_USER_ID')!.trim();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Dados do usuário (mesma tabela que o app sincroniza) e acesso ao Google, ao mesmo tempo
  const t0 = Date.now();
  const tokenP = tokenGoogle(admin, userId).catch(() => null);
  const { data: linhas, error: erroBanco } = await admin.from('itens').select('colecao,id,dados').eq('user_id', userId).eq('excluido', false);
  tempos.push(`banco ${Date.now() - t0}ms`);
  if (erroBanco) { console.error('Banco:', erroBanco); return falar('Não consegui ler seus dados, senhor. Confira o segredo ALEXA USER ID.'); }
  if (!linhas?.length) return falar('Não encontrei dados para este usuário, senhor. Confira se o ALEXA USER ID é o mesmo da sua conta no app.');
  // deno-lint-ignore no-explicit-any
  const c: Record<string, any[]> = {}, unicos: Record<string, any> = {};
  for (const l of linhas ?? []) {
    if (l.colecao === '_unico') unicos[l.id] = l.dados;
    else (c[l.colecao] ??= []).push(l.dados);
  }

  // Eventos do Google Agenda (hoje e amanhã), se a integração estiver ligada
  const usaGoogle = unicos.google?.agenda !== false;
  const t1 = Date.now();
  const token = usaGoogle ? await Promise.race([tokenP, new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, Math.min(2000, restante() - 4500))))]) : null;
  // deno-lint-ignore no-explicit-any
  let eventosGoogle: any[] = [];
  if (token) {
    const h = hojeISO();
    const p = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: `${h}T00:00:00-03:00`, timeMax: `${somaDias(h, 2)}T00:00:00-03:00` });
    const r = await fetch(`${CAL}?${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: comLimite(Math.max(300, Math.min(2000, restante() - 4000))) }).catch(() => null);
    if (r?.ok) eventosGoogle = ((await r.json()).items ?? []).filter((e: { status: string }) => e.status !== 'cancelled').map((e: { summary?: string; start: { date?: string; dateTime?: string } }) => ({
      titulo: e.summary ?? '(sem título)',
      data: e.start.date ?? (e.start.dateTime ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(e.start.dateTime)) : ''),
      inicio: e.start.dateTime ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(e.start.dateTime)) : '',
    }));
  }

  tempos.push(`google ${Date.now() - t1}ms`);

  // IA gratuita da Cloudflare (com o tempo que sobrou)
  const conta = Deno.env.get('CF_ACCOUNT_ID'), cfToken = Deno.env.get('CF_API_TOKEN');
  if (!conta || !cfToken) return falar('Minha inteligência na nuvem ainda não foi configurada, senhor. Faltam os segredos da Cloudflare.');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/ai/run/${MODELO}`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_tokens: 180, temperature: 0.3, messages: [
      { role: 'system', content: SISTEMA + '\n\nCONTEXTO:\n' + montarContexto(c, unicos, eventosGoogle) },
      { role: 'user', content: pergunta.slice(0, 500) },
    ] }),
    signal: comLimite(Math.max(1000, restante() - 300)),
  }).catch(() => null);
  const dados = await r?.json().catch(() => null);
  tempos.push(`ia ${Date.now() - t1}ms`, `total ${Date.now() - inicio}ms`);
  console.log('Tempos:', tempos.join(' · '));
  if (!r?.ok || !dados?.success) {
    console.error('Cloudflare:', r?.status, JSON.stringify(dados?.errors ?? dados ?? 'sem resposta (tempo esgotado)'));
    return falar(r ? 'Não consegui pensar nisso agora, senhor. Confira o token da Cloudflare.' : 'Demorei demais para pensar, senhor. Tente de novo.');
  }
  const resposta_ia = dados.result?.response;
  // deno-lint-ignore no-explicit-any
  let saida: any = {};
  if (resposta_ia && typeof resposta_ia === 'object') saida = resposta_ia;
  else { const t = String(resposta_ia ?? ''); try { saida = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { saida = { resposta: t }; } }

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
}
