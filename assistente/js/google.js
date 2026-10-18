'use strict';
// ============ Integração com o Google: Agenda, Tasks e Gmail ============
// O app pede um token de acesso à Edge Function `google-token` (que guarda o refresh token no servidor)
// e conversa direto com as APIs do Google.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const Google = {
  token: null, expira: 0, erro: '', timerTasks: null, hashTarefas: null, ultimaAtualizacao: 0, iniciado: false,

  conectado() { return !!Sync.usuario; },
  usarToken(token, segundos) { this.token = token; this.expira = Date.now() + segundos * 1000; },

  aoConectar() {
    GAgenda.lerCache();
    this.atualizar();
    if (this.iniciado) return;
    this.iniciado = true;
    setInterval(() => this.atualizar(), 5 * 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - this.ultimaAtualizacao > 60000) this.atualizar();
    });
  },
  aoDesconectar() { this.token = null; GAgenda.eventos = []; GGmail.limpar(); },

  async atualizar() {
    if (!this.conectado()) return;
    this.ultimaAtualizacao = Date.now();
    await Promise.allSettled([db.google.agenda && GAgenda.carregar(), db.google.tasks && GTarefas.sincronizar()]);
    this.render();
  },
  // Re-renderiza sem atrapalhar quem está digitando ou com um formulário aberto
  render() {
    if ($('#modal').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    render();
  },
  // Chamado a cada salvar(): espelha no Google Tasks só quando as tarefas mudaram
  agendarTasks() {
    if (!this.conectado() || !db.google.tasks) return;
    const h = JSON.stringify(db.tarefas.map(t => [t.id, t.titulo, t.notas, t.prazo, t.status, t.area]));
    if (h === this.hashTarefas) return;
    this.hashTarefas = h;
    clearTimeout(this.timerTasks);
    this.timerTasks = setTimeout(() => GTarefas.sincronizar().then(m => { if (m) this.render(); }), 3000);
  },

  async acesso() {
    if (this.token && Date.now() < this.expira - 60000) return this.token;
    const { data, error } = await Sync.sb.functions.invoke('google-token');
    if (error) {
      let motivo = '';
      try { motivo = (await error.context.json()).erro; } catch (e) {}
      this.erro = ['reconectar', 'sem_token'].includes(motivo)
        ? 'O acesso ao Google expirou. Vá em Geral → Sair e entre de novo com o Google.'
        : 'Não foi possível falar com o Google agora.';
      throw new Error(this.erro);
    }
    this.erro = '';
    this.usarToken(data.access_token, data.expires_in);
    return this.token;
  },
  async api(url, { metodo = 'GET', corpo, parametros } = {}, tentativa = 0) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(parametros || {})) {
      if (Array.isArray(v)) v.forEach(x => u.searchParams.append(k, x));
      else if (v != null && v !== '') u.searchParams.set(k, v);
    }
    const r = await fetch(u, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + await this.acesso(), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401 && !tentativa) { this.token = null; return this.api(url, { metodo, corpo, parametros }, 1); }
    if (!r.ok) {
      let msg = String(r.status);
      try { msg = (await r.json()).error?.message || msg; } catch (e) {}
      throw new Error(`Google (${r.status}): ${msg}`);
    }
    return r.status === 204 ? null : r.json();
  },
};

// ---------- Google Agenda ----------
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const RRULES = { diario: 'FREQ=DAILY', uteis: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', semanal: 'FREQ=WEEKLY', mensal: 'FREQ=MONTHLY', anual: 'FREQ=YEARLY' };

const GAgenda = {
  eventos: [], carregadoEm: null, erro: '',
  ativa() { return Google.conectado() && db.google.agenda; },
  lerCache() {
    try {
      const c = JSON.parse(localStorage.getItem('assistente.gcal'));
      if (c?.usuario === Sync.usuario?.id) { this.eventos = c.eventos; this.carregadoEm = c.em; }
    } catch (e) {}
  },
  async carregar() {
    try {
      const itens = [];
      let pageToken;
      do {
        const r = await Google.api(CAL, { parametros: {
          singleEvents: 'true', orderBy: 'startTime', maxResults: 2500, pageToken,
          timeMin: deISO(somaDias(hoje(), -60)).toISOString(), timeMax: deISO(somaDias(hoje(), 366)).toISOString(),
        } });
        itens.push(...(r.items || []));
        pageToken = r.nextPageToken;
      } while (pageToken);
      this.eventos = itens.filter(e => e.status !== 'cancelled' && e.start).map(e => this.converter(e));
      this.carregadoEm = new Date().toISOString();
      this.erro = '';
      try { localStorage.setItem('assistente.gcal', JSON.stringify({ usuario: Sync.usuario.id, eventos: this.eventos, em: this.carregadoEm })); } catch (e) {}
    } catch (e) { this.erro = e.message; }
  },
  // Evento do Google → formato de evento do app
  converter(g) {
    const p = g.extendedProperties?.private || {};
    const diaTodo = !!g.start.date;
    const ini = diaTodo ? null : new Date(g.start.dateTime), fim = diaTodo ? null : new Date(g.end.dateTime);
    const hm = d => hhmm(d.getHours() * 60 + d.getMinutes());
    const popups = (g.reminders?.overrides || []).filter(r => r.method === 'popup').map(r => r.minutes);
    return {
      id: 'g:' + g.id, gid: g.id, serie: g.recurringEventId || null, google: true,
      titulo: g.summary || '(sem título)', data: diaTodo ? g.start.date : isoData(ini),
      ateExcl: diaTodo ? g.end.date : null,
      inicio: diaTodo ? '' : hm(ini), fim: diaTodo || isoData(fim) !== isoData(ini) ? '' : hm(fim),
      local: g.location || '', notas: g.description || '', rotaId: p.rotaId || '', tipo: p.tipo || 'pessoal',
      alerta: popups.length ? String(Math.min(...popups)) : '', repetir: 'nao',
      link: g.htmlLink || '', meet: g.hangoutLink || '',
    };
  },
  deRecorrencia(rec) {
    const r = (rec || []).find(x => x.startsWith('RRULE:'));
    if (!r) return { repetir: 'nao', ate: '' };
    const s = r.slice(6);
    const ate = s.match(/UNTIL=(\d{4})(\d{2})(\d{2})/);
    const base = s.split(';').filter(x => !/^(UNTIL|WKST)=/.test(x)).join(';');
    const repetir = /^FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR$/.test(base) ? 'uteis'
      : base === 'FREQ=DAILY' ? 'diario'
      : /^FREQ=WEEKLY(;BYDAY=[A-Z]{2})?$/.test(base) ? 'semanal'
      : /^FREQ=MONTHLY(;BYMONTHDAY=\d+)?$/.test(base) ? 'mensal'
      : base === 'FREQ=YEARLY' ? 'anual' : 'outro';
    return { repetir, ate: ate ? `${ate[1]}-${ate[2]}-${ate[3]}` : '' };
  },
  // Formato do app → corpo da API do Google
  paraGoogle(v, recorrenciaOriginal) {
    const corpo = {
      summary: v.titulo, location: v.local || '', description: v.notas || '',
      extendedProperties: { private: { rotaId: v.rotaId || '', tipo: v.tipo || 'pessoal' } },
      reminders: { useDefault: false, overrides: v.alerta === '' || v.alerta == null ? [] : [{ method: 'popup', minutes: Number(v.alerta) }] },
    };
    if (v.inicio) {
      const fim = v.fim || hhmm(Math.min(minutos(v.inicio) + 60, 1439));
      corpo.start = { dateTime: `${v.data}T${v.inicio}:00`, timeZone: TZ };
      corpo.end = { dateTime: `${v.data}T${fim}:00`, timeZone: TZ };
    } else {
      corpo.start = { date: v.data };
      corpo.end = { date: somaDias(v.data, 1) };
    }
    if (v.repetir === 'outro') corpo.recurrence = recorrenciaOriginal;
    else if (RRULES[v.repetir]) corpo.recurrence = ['RRULE:' + RRULES[v.repetir] + (v.ate ? ';UNTIL=' + v.ate.replace(/-/g, '') + 'T235959Z' : '')];
    else corpo.recurrence = [];
    return corpo;
  },
  async form(ev, valores = {}) {
    let alvo = ev, rec = null;
    if (ev?.serie) {
      // Evento repetido: edita a série inteira
      try {
        const m = await Google.api(`${CAL}/${encodeURIComponent(ev.serie)}`);
        rec = m.recurrence;
        alvo = { ...this.converter(m), ...this.deRecorrencia(rec) };
      } catch (e) { aviso(e.message); return; }
    }
    const editando = !!alvo;
    formulario({
      titulo: !editando ? 'Novo evento · Google Agenda' : ev.serie ? 'Editar série · Google Agenda' : 'Editar evento · Google Agenda',
      campos: Agenda.campos(valores, alvo?.repetir === 'outro'),
      valores: alvo || { data: Agenda.sel, ...valores },
      salvar: v => {
        if (Agenda.validar(v) === false) return false;
        Agenda.sel = v.data; Agenda.mes = v.data.slice(0, 7);
        this.gravar(editando ? 'PATCH' : 'POST', editando ? alvo.gid : null, this.paraGoogle(v, rec));
      },
      excluir: editando ? () => this.gravar('DELETE', alvo.gid) : null,
    });
  },
  async gravar(metodo, gid, corpo) {
    aviso('Salvando no Google Agenda...');
    try {
      await Google.api(gid ? `${CAL}/${encodeURIComponent(gid)}` : CAL, { metodo, corpo });
      await this.carregar();
      Google.render();
      aviso(metodo === 'DELETE' ? 'Excluído do Google Agenda' : 'Salvo no Google Agenda ✔');
    } catch (e) { aviso('Erro: ' + e.message); }
  },
  async enviarLocais() {
    const n = db.eventos.length;
    if (!confirm(`Enviar ${n} evento(s) do app para o seu Google Agenda? Depois disso eles passam a ficar só no Google.`)) return;
    aviso('Enviando eventos ao Google...');
    let ok = 0;
    for (const ev of [...db.eventos]) {
      try {
        await Google.api(CAL, { metodo: 'POST', corpo: this.paraGoogle(ev) });
        db.eventos.splice(db.eventos.indexOf(ev), 1);
        ok++;
      } catch (e) { console.warn('Evento não enviado:', ev.titulo, e.message); }
    }
    salvar();
    await this.carregar();
    render();
    aviso(ok === n ? `${ok} evento(s) enviados ✔` : `${ok} de ${n} enviados — tente de novo para os demais`);
  },
};

// ---------- Google Tasks ----------
const TASKS = 'https://tasks.googleapis.com/tasks/v1';

const GTarefas = {
  rodando: false, erro: '', em: null,
  NOMES: { trabalho: 'Trabalho', pessoal: 'Pessoal' },
  async listas() {
    const L = db.google.listas;
    if (L.trabalho && L.pessoal) return L;
    const r = await Google.api(`${TASKS}/users/@me/lists`, { parametros: { maxResults: 100 } });
    for (const area of ['trabalho', 'pessoal']) {
      if (L[area]) continue;
      const achada = (r.items || []).find(l => l.title.toLowerCase() === this.NOMES[area].toLowerCase());
      L[area] = achada ? achada.id : (await Google.api(`${TASKS}/users/@me/lists`, { metodo: 'POST', corpo: { title: this.NOMES[area] } })).id;
    }
    return L;
  },
  hash(t) { return JSON.stringify([t.titulo, t.notas || '', t.prazo || '', t.status === 'feito']); },
  corpo(t) {
    const feito = t.status === 'feito';
    return { title: t.titulo, notes: t.notas || '', due: t.prazo ? t.prazo + 'T00:00:00.000Z' : null,
      status: feito ? 'completed' : 'needsAction', ...(feito ? {} : { completed: null }) };
  },
  async apagar(lista, gid) {
    try { await Google.api(`${TASKS}/lists/${lista}/tasks/${gid}`, { metodo: 'DELETE' }); }
    catch (e) { if (!/\((404|410)\)/.test(e.message)) throw e; }
  },
  // Retorna true se alterou algo nas tarefas do app
  async sincronizar() {
    if (this.rodando || !Google.conectado() || !db.google.tasks) return false;
    this.rodando = true;
    let mudou = false;
    try {
      const L = await this.listas(), G = db.google, mapa = G.tasksMapa;

      // 1) Recebe o que mudou no Google (Gmail, Agenda, app Tasks no celular)
      for (const area of ['trabalho', 'pessoal']) {
        const cursor = G.tasksCursor[area] || null;
        let maior = cursor, pageToken;
        do {
          const r = await Google.api(`${TASKS}/lists/${L[area]}/tasks`, { parametros: {
            showCompleted: 'true', showHidden: 'true', showDeleted: 'true', maxResults: 100, pageToken, updatedMin: cursor,
          } });
          for (const gt of r.items || []) {
            if (!maior || gt.updated > maior) maior = gt.updated;
            const t = db.tarefas.find(x => x.gtaskId === gt.id);
            if (gt.deleted) {
              if (t) { db.tarefas.splice(db.tarefas.indexOf(t), 1); mudou = true; }
              delete mapa[gt.id];
              continue;
            }
            if (t && t.gAtualizada && gt.updated <= t.gAtualizada) continue;
            const feito = gt.status === 'completed';
            const dados = { titulo: gt.title || '', notas: gt.notes || '', prazo: gt.due ? gt.due.slice(0, 10) : '' };
            if (t) {
              Object.assign(t, dados);
              if (feito && t.status !== 'feito') { t.status = 'feito'; t.concluida = (gt.completed || '').slice(0, 10) || hoje(); }
              if (!feito && t.status === 'feito') { t.status = 'afazer'; t.concluida = null; }
              t.gAtualizada = gt.updated; t.gHash = this.hash(t);
              mudou = true;
            } else if (gt.title && !mapa[gt.id] && !(feito && !cursor)) {
              // !mapa: tarefa já conhecida e apagada no app (o passo 3 apaga no Google)
              // na primeira vez, não importa tarefas antigas já concluídas
              const nova = { id: uid(), area, ...dados, status: feito ? 'feito' : 'afazer', prioridade: 'media', projeto: '',
                concluida: feito ? hoje() : null, gtaskId: gt.id, gLista: L[area], gAtualizada: gt.updated };
              nova.gHash = this.hash(nova);
              db.tarefas.push(nova);
              mapa[gt.id] = L[area];
              mudou = true;
            }
          }
          pageToken = r.nextPageToken;
        } while (pageToken);
        if (maior !== cursor) { G.tasksCursor[area] = maior; mudou = true; }
      }

      // 2) Envia o que mudou no app
      for (const t of db.tarefas) {
        const lista = L[t.area];
        if (!lista) continue;
        if (t.gtaskId && t.gLista && t.gLista !== lista) { // mudou de área → muda de lista
          await this.apagar(t.gLista, t.gtaskId);
          delete mapa[t.gtaskId];
          t.gtaskId = null;
        }
        const h = this.hash(t);
        if (!t.gtaskId) {
          if (t.status === 'feito') continue;
          const r = await Google.api(`${TASKS}/lists/${lista}/tasks`, { metodo: 'POST', corpo: this.corpo(t) });
          Object.assign(t, { gtaskId: r.id, gLista: lista, gAtualizada: r.updated, gHash: h });
          mudou = true;
        } else if (t.gHash !== h) {
          const r = await Google.api(`${TASKS}/lists/${lista}/tasks/${t.gtaskId}`, { metodo: 'PATCH', corpo: this.corpo(t) });
          Object.assign(t, { gAtualizada: r.updated, gHash: h });
          mudou = true;
        }
        if (t.gtaskId && mapa[t.gtaskId] !== lista) { mapa[t.gtaskId] = lista; mudou = true; }
      }

      // 3) Tarefas apagadas no app → apaga no Google
      const vivas = new Set(db.tarefas.map(t => t.gtaskId).filter(Boolean));
      for (const [gid, lista] of Object.entries(mapa)) {
        if (vivas.has(gid)) continue;
        await this.apagar(lista, gid);
        delete mapa[gid];
        mudou = true;
      }
      this.em = new Date().toISOString();
      this.erro = '';
    } catch (e) {
      this.erro = e.message;
    } finally {
      this.rodando = false;
      if (mudou) salvar();
    }
    return mudou;
  },
};

// ---------- Gmail ----------
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const GGmail = {
  listas: {}, consulta: '', carregando: false, erro: '',
  Q: {
    importantes: 'is:unread (is:starred OR is:important) newer_than:14d -category:promotions -category:social',
    contas: 'newer_than:45d -category:promotions (boleto OR fatura OR "segunda via" OR vencimento OR "conta de luz" OR "conta de água" OR "conta de energia")',
  },
  limpar() { this.listas = {}; this.consulta = ''; },
  texto(html) { const t = document.createElement('textarea'); t.innerHTML = html || ''; return t.value; },
  async buscar(q, max = 15) {
    const r = await Google.api(`${GMAIL}/messages`, { parametros: { q, maxResults: max } });
    return Promise.all((r.messages || []).map(async m => {
      const d = await Google.api(`${GMAIL}/messages/${m.id}`, { parametros: { format: 'metadata', metadataHeaders: ['Subject', 'From'] } });
      const h = n => (d.payload?.headers || []).find(x => x.name.toLowerCase() === n)?.value || '';
      const trecho = this.texto(d.snippet);
      const valor = trecho.match(/R\$\s*([\d.]{1,10},\d{2})/);
      const venc = trecho.match(/venc\w*\D{0,25}(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/i);
      return {
        id: d.id, thread: d.threadId, assunto: h('subject') || '(sem assunto)',
        de: h('from').replace(/<.*>/, '').replace(/"/g, '').trim() || h('from'),
        data: isoData(new Date(Number(d.internalDate))), trecho,
        valor: valor ? parseFloat(valor[1].replace(/\./g, '').replace(',', '.')) : null,
        vencimento: venc ? `${venc[3] ? (venc[3].length === 2 ? '20' + venc[3] : venc[3]) : new Date().getFullYear()}-${venc[2]}-${venc[1]}` : null,
      };
    }));
  },
  async carregar() {
    if (this.carregando || !Google.conectado()) return;
    this.carregando = true; this.erro = '';
    Google.render();
    try {
      const [importantes, contas, busca] = await Promise.all([
        this.buscar(this.Q.importantes), this.buscar(this.Q.contas),
        this.consulta ? this.buscar(this.consulta, 20) : null,
      ]);
      this.listas = { importantes, contas, busca };
    } catch (e) { this.erro = e.message; this.listas = { importantes: [], contas: [] }; }
    this.carregando = false;
    Google.render();
  },
  link(m) { return `https://mail.google.com/mail/?authuser=${encodeURIComponent(Sync.usuario?.email || '')}#all/${m.thread}`; },
  achar(id) { return Object.values(this.listas).flat().find(m => m?.id === id); },
  usado(id) { return db.google.gmailUsados.includes(id); },
  marcar(id) { const u = db.google.gmailUsados; if (!u.includes(id)) { u.push(id); if (u.length > 300) u.splice(0, u.length - 300); } },
};

registrar({
  id: 'gmail', nome: 'Gmail', icone: '📧',
  render() {
    const G = GGmail;
    if (!Google.conectado()) return `<div class="topo"><h1>📧 Gmail</h1></div>
      <div class="card"><p class="muted" style="margin:0">Entre com sua conta Google em <a href="#geral">Geral</a> para ver seus e-mails aqui.</p></div>`;
    if (!G.listas.importantes && !G.carregando && !G.erro) setTimeout(() => G.carregar(), 0);

    const item = (m, tipo) => {
      const usado = G.usado(m.id);
      return `<li class="${usado ? 'feito' : ''}"><div class="info">
          <div class="nome">${esc(m.assunto)}</div>
          <div class="sub">${esc(m.de)} · ${rotuloDia(m.data)}${m.valor ? ` · <b>${brl.format(m.valor)}</b>` : ''}${m.vencimento ? ` · vence ${fmtData(m.vencimento)}` : ''}</div>
          <div class="sub">${esc(m.trecho.slice(0, 140))}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${tipo === 'conta'
            ? `<button class="mini${usado ? '' : ' primary'}" data-acao="gasto" data-id="${m.id}">${usado ? '✔ Lançado' : '💸 Lançar gasto'}</button>`
            : `<button class="mini" data-acao="tarefa" data-area="trabalho" data-id="${m.id}" title="Criar tarefa do trabalho">💼 Tarefa</button>
               <button class="mini" data-acao="tarefa" data-area="pessoal" data-id="${m.id}" title="Criar tarefa pessoal">✅ Tarefa</button>`}
          <a class="btn mini" href="${G.link(m)}" target="_blank" rel="noopener">Abrir ↗</a></div></li>`;
    };
    const lista = (ms, tipo, vazio) => G.carregando && !ms ? '<div class="vazio">Carregando...</div>'
      : `<ul class="lista">${(ms || []).map(m => item(m, tipo)).join('') || `<div class="vazio">${vazio}</div>`}</ul>`;

    return `<div class="topo"><h1>📧 Gmail</h1>
        <input type="search" placeholder="Buscar no Gmail (ex.: from:banco)" value="${esc(G.consulta)}" data-muda="buscar" style="min-width:220px">
        <button data-acao="atualizar">${G.carregando ? '⏳' : '🔄'} Atualizar</button></div>
      ${G.erro ? `<div class="aviso">⚠️ ${esc(G.erro)}</div>` : ''}
      ${G.consulta ? `<section class="card" style="margin-bottom:14px"><h2>🔎 Resultado: ${esc(G.consulta)}<span class="sp"></span>
          <button class="mini" data-acao="limparBusca">Limpar</button></h2>${lista(G.listas.busca, 'email', 'Nada encontrado.')}</section>` : ''}
      <div class="grid2">
        <section class="card"><h2>📌 Importantes não lidos</h2>${lista(G.listas.importantes, 'email', 'Nenhum e-mail importante pendente 🎉')}</section>
        <section class="card"><h2>💰 Contas e boletos (45 dias)</h2>${lista(G.listas.contas, 'conta', 'Nenhuma conta encontrada.')}
          <p class="muted" style="font-size:12px;margin:10px 0 0">O valor é lido do resumo do e-mail; confira antes de salvar.</p></section>
      </div>`;
  },
  acoes: {
    atualizar() { GGmail.carregar(); },
    buscar(d, el) { GGmail.consulta = el.value.trim(); GGmail.carregar(); },
    limparBusca() { GGmail.consulta = ''; GGmail.listas.busca = null; render(); },
    tarefa(d) {
      const m = GGmail.achar(d.id);
      GGmail.marcar(m.id);
      Tarefas.form(d.area, null, { titulo: m.assunto, notas: `E-mail de ${m.de}\n${GGmail.link(m)}`, prazo: '' });
    },
    gasto(d) {
      const m = GGmail.achar(d.id);
      Financas.formVar(null, { nome: m.assunto.slice(0, 60), valor: m.valor, categoria: 'Contas', data: hoje() },
        () => { GGmail.marcar(m.id); salvar(); });
    },
  },
});
