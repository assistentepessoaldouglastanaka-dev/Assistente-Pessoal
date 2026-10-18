'use strict';
// ============ Gestão geral: notas, configurações e backup ============
registrar({
  id: 'geral', nome: 'Geral', icone: '🗂️',
  render() {
    const notas = [...db.notas].sort((a, b) => (b.fixada - a.fixada) || (b.atualizada || '').localeCompare(a.atualizada || ''));
    const c = db.config;
    const contagem = [
      ['Tarefas pendentes', db.tarefas.filter(t => t.status !== 'feito').length],
      ['Itens na wishlist', db.wishlist.filter(w => !w.comprado).length],
      ['Eventos', db.eventos.length],
      ['Trajetos', db.rotas.length],
      ['Treinos registrados', db.treinos.sessoes.length],
      ['Alarmes ativos', db.alarmes.filter(a => a.ativo).length],
    ];
    return `<div class="topo"><h1>🗂️ Geral</h1><button class="primary" data-acao="novaNota">+ Nota</button></div>
      <section class="card"><h2>📝 Notas</h2>
        <div class="notas">${notas.map(n => `<div class="nota ${n.fixada ? 'fixada' : ''}">
          <div class="t"><span>${esc(n.titulo || 'Sem título')}</span>
            <button class="icon" data-acao="fixar" data-id="${n.id}" title="${n.fixada ? 'Desafixar' : 'Fixar no início'}">${n.fixada ? '📌' : '📍'}</button>
            <button class="icon" data-acao="editarNota" data-id="${n.id}" title="Editar">✎</button></div>
          <div class="tx">${esc(n.texto)}</div></div>`).join('') || '<div class="vazio">Ideias, senhas de wi-fi, listas de mercado... (notas fixadas aparecem no Início).</div>'}</div>
      </section>
      <section class="card mt"><h2>☁️ Conta e sincronização <span class="sp"></span>${Sync.usuario ? Sync.rotulo()[0] : ''}</h2>
        ${this.cardSync()}
      </section>
      ${Sync.usuario ? `<section class="card mt"><h2>🔗 Google Workspace<span class="sp"></span>
          <button class="mini" data-acao="googleAgora">🔄 Atualizar agora</button></h2>${this.cardGoogle()}</section>` : ''}
      <div class="grid2 mt">
        <section class="card"><h2>⚙️ Configurações</h2>
          <div class="campos">
            <label class="campo"><span class="rot">Seu nome</span><input value="${esc(c.nome)}" data-muda="config" data-k="nome"></label>
            <label class="campo"><span class="rot">Folga nos deslocamentos (min)</span><input type="number" min="0" value="${c.folga}" data-muda="config" data-k="folga"></label>
            <label class="campo"><span class="rot">Tema</span><select data-muda="config" data-k="tema">
              ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<option value="${v}"${c.tema === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
        </section>
        <section class="card"><h2>💾 Backup</h2>
          <p class="muted" style="margin-top:0;font-size:14px">Os dados ficam salvos neste navegador. Exporte um backup de vez em quando
            (e antes de limpar o navegador ou trocar de computador).<br>Último backup: <b>${c.ultimoBackup ? fmtData(c.ultimoBackup) : 'nunca'}</b></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button data-acao="exportar">⬇ Exportar tudo</button>
            <button data-acao="abrirImport">⬆ Importar backup</button>
            <input id="arqImport" type="file" accept="application/json,.json" hidden data-muda="importar">
          </div>
          <p class="muted" style="font-size:13px">Também aceita os backups do antigo <i>controle-de-gastos.html</i> (substitui só a parte de Finanças).</p>
        </section>
      </div>
      <section class="card mt"><h2>📊 Visão geral</h2>
        ${contagem.map(([l, n]) => `<div class="linha"><span>${l}</span><b>${n}</b></div>`).join('')}
      </section>`;
  },
  cardSync() {
    const p = t => `<p class="muted" style="margin:0;font-size:14px">${t}</p>`;
    if (!Sync.configurado()) return p('A sincronização entre PC, notebook e celular ainda não foi configurada (falta conectar o Supabase em <code>js/config.js</code>).');
    if (Sync.estado === 'arquivo') return p('Você abriu o app como arquivo. Para sincronizar, abra pelo endereço web do app.');
    if (!Sync.usuario) return `${p('Entre com sua conta Google para sincronizar seus dados entre todos os aparelhos e conectar Agenda, Tasks e Gmail.')}
      <button class="primary mt" data-acao="entrar">Entrar com Google</button>`;
    return `<div class="linha"><span>Conta</span><b>${esc(Sync.usuario.email)}</b></div>
      <div class="linha"><span>Situação</span><span>${esc(Sync.rotulo()[1])}</span></div>
      <div class="linha"><span>Último envio</span><span>${Sync.ultimo ? new Date(Sync.ultimo).toLocaleString('pt-BR') : '—'}</span></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button data-acao="syncAgora">🔄 Sincronizar agora</button><button data-acao="sair">Sair</button></div>`;
  },
  cardGoogle() {
    const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const linha = (k, nome, status) => `<div class="linha" style="align-items:center">
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-muda="googleLiga" data-k="${k}"${db.google[k] ? ' checked' : ''}> ${nome}</label>
      <span class="muted" style="text-align:right">${status}</span></div>`;
    return `${Google.erro ? `<div class="aviso">⚠️ ${esc(Google.erro)}</div>` : ''}
      ${linha('agenda', '📅 Google Agenda', !db.google.agenda ? 'desligado' : GAgenda.erro ? '⚠️ ' + esc(GAgenda.erro)
        : `${GAgenda.eventos.length} eventos · atualizado ${hora(GAgenda.carregadoEm)}`)}
      ${linha('tasks', '✔️ Google Tasks (listas "Trabalho" e "Pessoal")', !db.google.tasks ? 'desligado' : GTarefas.erro ? '⚠️ ' + esc(GTarefas.erro)
        : `${db.tarefas.filter(t => t.gtaskId).length} tarefas ligadas · ${hora(GTarefas.em)}`)}
      <div class="linha"><span>📧 Gmail</span><a href="#gmail">abrir e-mails →</a></div>`;
  },
  acoes: {
    entrar() { Sync.entrar(); },
    async googleAgora() { aviso('Atualizando com o Google...'); await Google.atualizar(); render(); aviso(Google.erro || 'Google atualizado ✔'); },
    googleLiga(d, el) { db.google[d.k] = el.checked; ok(); if (el.checked) Google.atualizar(); },
    sair() { Sync.sair(); },
    async instalar() {
      if (!App.instalar) return;
      App.instalar.prompt();
      await App.instalar.userChoice;
      App.instalar = null; render();
    },
    async syncAgora() { await Sync.sincronizar(); render(); aviso(Sync.estado === 'ok' ? 'Sincronizado ✔' : Sync.rotulo()[1]); },
    novaNota() { this.formNota(); },
    editarNota(d) { this.formNota(db.notas.find(n => n.id === d.id)); },
    formNota(n) {
      crud({
        lista: db.notas, item: n, titulos: ['Nova nota', 'Editar nota'],
        campos: [
          { nome: 'titulo', rotulo: 'Título', largo: true },
          { nome: 'texto', rotulo: 'Texto', tipo: 'textarea', largo: true, linhas: 8 },
          { nome: 'fixada', rotulo: 'Fixar no Início', tipo: 'checkbox' },
        ],
        preparar: v => { v.atualizada = new Date().toISOString(); if (!v.titulo && !v.texto) return false; },
      });
    },
    fixar(d) { const n = db.notas.find(x => x.id === d.id); n.fixada = !n.fixada; ok(); },
    config(d, el) {
      db.config[d.k] = el.type === 'number' ? (parseInt(el.value) || 0) : el.value;
      if (d.k === 'tema') aplicarTema();
      ok('Configuração salva');
    },
    exportar() {
      db.config.ultimoBackup = hoje(); salvar();
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `assistente-backup-${hoje()}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      render();
    },
    abrirImport() { $('#arqImport').click(); },
    async importar(d, el) {
      const arq = el.files[0]; if (!arq) return;
      try {
        const dados = JSON.parse(await arq.text());
        if (dados.financas || dados.tarefas || dados.treinos) {
          if (!confirm('Substituir TODOS os dados atuais pelos do backup?')) return;
          db = mesclar(padrao(), dados);
          aplicarTema();
        } else if (Array.isArray(dados.fixos)) {
          if (!confirm('Este é um backup do controle de gastos. Substituir os dados de Finanças por ele?')) return;
          db.financas = normalizarFinancas(dados);
        } else throw new Error('formato');
        ok('Backup importado ✔');
      } catch (e) { aviso('Arquivo de backup inválido'); }
      el.value = '';
    },
  },
});
