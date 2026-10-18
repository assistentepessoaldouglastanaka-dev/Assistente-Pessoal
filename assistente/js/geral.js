'use strict';
// ============ Gestão geral: notas, configurações e backup ============
registrar({
  id: 'geral', nome: 'Notas e ajustes', icone: '🗂️',
  render() {
    const notas = [...db.notas].sort((a, b) => (b.fixada - a.fixada) || (b.atualizada || '').localeCompare(a.atualizada || ''));
    const c = db.config;
    return cabecalho('Notas e ajustes', { acoes: `<button class="primary" data-acao="novaNota">${ic('plus')}<span class="rotulo-opc">Nova nota</span></button>` })
      + `<section class="card"><h2>${ic('sticky-note')} Notas</h2>
        ${notas.length ? `<div class="notas">${notas.map(n => `<div class="nota ${n.fixada ? 'fixada' : ''}">
          <div class="t"><span data-acao="editarNota" data-id="${n.id}" style="cursor:pointer">${esc(n.titulo || 'Sem título')}</span>
            ${bi('fixar', n.fixada ? 'pin-off' : 'pin', n.fixada ? 'Desafixar do Início' : 'Fixar no Início', `data-id="${n.id}"`)}
            ${bi('editarNota', 'pencil', 'Editar', `data-id="${n.id}"`)}</div>
          <div class="tx" data-acao="editarNota" data-id="${n.id}" style="cursor:pointer">${esc(n.texto)}</div></div>`).join('')}</div>`
          : vazio('sticky-note', 'Ideias, senha do wi-fi, lista de mercado... As notas fixadas aparecem no Início.',
              `<button class="mini" data-acao="novaNota">${ic('plus', 'ic-sm')} Nova nota</button>`)}
      </section>
      <div class="grid2 mt">
        <section class="card"><h2>${ic('cloud')} Conta e sincronização</h2>${this.cardSync()}</section>
        ${Sync.usuario ? `<section class="card"><h2>${ic('link')} Google Workspace<span class="sp"></span>
            ${bi('googleAgora', 'refresh-cw', 'Atualizar agora')}</h2>${this.cardGoogle()}</section>` : ''}
        <section class="card"><h2>${ic('settings')} Preferências</h2>
          <div class="campos">
            <label class="campo"><span class="rot">Como quer ser chamado</span><input value="${esc(c.nome)}" data-muda="config" data-k="nome" placeholder="Seu nome"></label>
            <label class="campo"><span class="rot">Tema</span><select data-muda="config" data-k="tema">
              ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro'], ['jarvis', 'Jarvis (HUD)']].map(([v, l]) => `<option value="${v}"${c.tema === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="campo largo"><span class="rot">Folga nos deslocamentos (minutos)</span>
              <input type="number" min="0" inputmode="numeric" value="${c.folga}" data-muda="config" data-k="folga">
              <small>Somada ao tempo de cada trajeto no aviso de "hora de sair".</small></label>
          </div>
        </section>
        <section class="card"><h2>${reator('reator-mini')} Jarvis<span class="sp"></span>
            <button class="mini" data-acao="jarvis:abrir">Falar agora</button></h2>${this.cardJarvis()}</section>
        <section class="card"><h2>${ic('hard-drive-download')} Backup</h2>
          <p class="muted" style="margin-top:0;font-size:14px">${Sync.usuario ? 'Seus dados já ficam salvos na nuvem.' : 'Seus dados ficam só neste aparelho.'}
            Um backup em arquivo é uma garantia extra. Último: <b>${c.ultimoBackup ? fmtData(c.ultimoBackup) : 'nunca'}</b></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button data-acao="exportar">${ic('download')} Exportar tudo</button>
            <button data-acao="abrirImport">${ic('upload')} Importar backup</button>
            <input id="arqImport" type="file" accept="application/json,.json" hidden data-muda="importar">
          </div>
          <p class="muted" style="font-size:12.5px;margin-bottom:0">Aceita também os backups do antigo controle de gastos (substitui só Finanças).</p>
        </section>
      </div>`;
  },
  cardJarvis() {
    const J = db.config.jarvis;
    // ainda não procurou as vozes neste aparelho: procura agora (o resultado redesenha a tela)
    if (!Voz.lista.length && !Voz.carregando && !Voz.situacao) setTimeout(() => Voz.carregarVozes(), 0);
    const linha = (k, nome, sub) => `<div class="linha"><span><b style="font-weight:550">${nome}</b><br><span class="muted" style="font-size:12.5px">${sub}</span></span>
      <button class="switch ${J[k] ? 'on' : ''}" data-acao="jarvisLiga" data-k="${k}" role="switch" aria-checked="${!!J[k]}" aria-label="${nome}"></button></div>`;
    return `${linha('voz', 'Responder falando', Voz.podeFalar() ? 'Além de mostrar na tela' : 'Este aparelho não tem voz disponível')}
      ${Escuta.pode() ? linha('palavra', 'Ativar dizendo "Jarvis"', 'Com o app aberto na tela. Usa o microfone continuamente.')
        : `<div class="linha"><span><b style="font-weight:550">Ativar dizendo "Jarvis"</b><br><span class="muted" style="font-size:12.5px">${Nativo.ativo ? 'No app Android, toque no reator para falar' : 'Disponível no Chrome'}</span></span></div>`}
      <div class="linha"><span><b style="font-weight:550">Como ele te chama</b></span>
        <select data-muda="jarvisTratamento" aria-label="Como o Jarvis te chama">
          <option value="senhor"${J.tratamento !== 'nome' ? ' selected' : ''}>Senhor</option>
          <option value="nome"${J.tratamento === 'nome' ? ' selected' : ''}>Pelo nome${db.config.nome ? ' (' + esc(db.config.nome) + ')' : ''}</option></select></div>
      ${Voz.podeFalar() ? `<div class="campos mt">
        <label class="campo largo"><span class="rot">Voz deste aparelho</span>
          <select data-muda="jarvisVoz" aria-label="Voz do Jarvis">${Voz.lista.length ? Voz.lista.map((v, i) =>
            `<option value="${esc(v.id)}"${Voz.escolhida()?.id === v.id ? ' selected' : ''}>${esc(v.rotulo)}${i === 0 ? ' ★ recomendada' : ''}</option>`).join('')
            : '<option>Procurando vozes...</option>'}</select>
          <small>${esc(Voz.descricaoSituacao())} A ★ é a voz masculina mais natural encontrada; teste as outras e fique com a que soar melhor.</small></label>
        <label class="campo"><span class="rot">Velocidade</span><select data-muda="jarvisAjuste" data-k="velocidade">
          ${[['devagar', 'Mais devagar'], ['normal', 'Normal'], ['rapido', 'Mais rápida']].map(([v, l]) => `<option value="${v}"${(J.velocidade || 'normal') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="campo"><span class="rot">Tom</span><select data-muda="jarvisAjuste" data-k="tom">
          ${[['normal', 'Natural'], ['grave', 'Mais grave']].map(([v, l]) => `<option value="${v}"${(J.tom || 'normal') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap" class="mt">
        <button class="mini" data-acao="jarvisTestar">${ic('play', 'ic-sm')} Testar voz</button>
        <button class="mini fantasma" data-acao="jarvisRecarregarVozes">${ic('refresh-cw', 'ic-sm')} Recarregar vozes</button></div>` : ''}
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">Comandos comuns funcionam sem internet. Perguntas livres usam a IA gratuita da Cloudflare. Atalho no computador: Alt+J.</p>`;
  },
  cardSync() {
    const p = t => `<p class="muted" style="margin:0;font-size:14px">${t}</p>`;
    if (!Sync.configurado()) return p('A sincronização ainda não foi configurada neste app.');
    if (Sync.estado === 'arquivo') return p('Você abriu o app como arquivo. Para sincronizar, abra pelo endereço web do app.');
    if (!Sync.usuario) return `${p('Entre com sua conta Google para ter seus dados no celular, no notebook e no PC, e conectar Agenda, Tasks e Gmail.')}
      <button class="primary mt" data-acao="entrar">${ic('log-in')} Entrar com Google</button>`;
    const [cor, texto] = Sync.rotulo();
    return `<div class="linha"><span>Conta</span><b style="overflow-wrap:anywhere;text-align:right">${esc(Sync.usuario.email)}</b></div>
      <div class="linha"><span>Situação</span><span class="chip ${cor}">${esc(texto)}</span></div>
      <div class="linha"><span>Último envio</span><span>${Sync.ultimo ? new Date(Sync.ultimo).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span></div>
      <div style="display:flex;gap:8px;margin-top:12px"><button data-acao="syncAgora">${ic('refresh-cw')} Sincronizar agora</button>
        <button class="fantasma" data-acao="sair">${ic('log-out')} Sair</button></div>`;
  },
  cardGoogle() {
    const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const linha = (k, icone, nome, status, erro) => `<div class="linha">
      <span style="display:flex;gap:10px;align-items:center">${ic(icone)}<span><b style="font-weight:550">${nome}</b><br>
        <span class="${erro ? 'neg' : 'muted'}" style="font-size:12.5px">${status}</span></span></span>
      <button class="switch ${db.google[k] ? 'on' : ''}" data-acao="googleLiga" data-k="${k}" role="switch" aria-checked="${!!db.google[k]}" aria-label="${nome}"></button></div>`;
    return `${Google.erro ? `<div class="aviso laranja">${ic('circle-alert')} ${esc(Google.erro)}</div>` : ''}
      ${linha('agenda', 'calendar', 'Google Agenda', !db.google.agenda ? 'Desligado' : GAgenda.erro ? esc(GAgenda.erro)
        : `${GAgenda.eventos.length} eventos · atualizado às ${hora(GAgenda.carregadoEm)}`, !!GAgenda.erro)}
      ${linha('tasks', 'list-checks', 'Google Tasks', !db.google.tasks ? 'Desligado' : GTarefas.erro ? esc(GTarefas.erro)
        : `${db.tarefas.filter(t => t.gtaskId).length} tarefas nas listas Trabalho e Pessoal`, !!GTarefas.erro)}
      <div class="linha"><span style="display:flex;gap:10px;align-items:center">${ic('mail')}<b style="font-weight:550">Gmail</b></span><a href="#gmail">Abrir e-mails</a></div>`;
  },
  acoes: {
    entrar() { Sync.entrar(); },
    jarvisLiga(d) {
      db.config.jarvis[d.k] = !db.config.jarvis[d.k]; ok();
      if (d.k === 'palavra') db.config.jarvis.palavra ? (Escuta.ligar(), aviso('Diga "Jarvis" e o comando')) : Escuta.desligar();
      if (d.k === 'voz' && db.config.jarvis.voz) Voz.falar(`Voz ativada, ${Jarvis.tratamento()}.`);
    },
    jarvisVoz(d, el) { Voz.escolher(el.value); Voz.falar(`Voz selecionada. Às suas ordens, ${Jarvis.tratamento()}.`, true); },
    jarvisAjuste(d, el) { db.config.jarvis[d.k] = el.value; ok(); Voz.falar('Assim está melhor?', true); },
    async jarvisRecarregarVozes() {
      aviso('Procurando vozes...');
      await Voz.carregarVozes(true);
      aviso(Voz.lista.length ? `${Voz.lista.length} vozes encontradas` : Voz.descricaoSituacao());
    },
    jarvisTestar() { Voz.falar(`Às suas ordens, ${Jarvis.tratamento()}. Todos os sistemas estão operacionais. Sua agenda de hoje tem três compromissos e o saldo do mês está positivo.`, true); },
    jarvisTratamento(d, el) { db.config.jarvis.tratamento = el.value; ok(); Voz.falar(`Certo, ${Jarvis.tratamento()}.`); },
    async googleAgora() { aviso('Atualizando com o Google...'); await Google.atualizar(); render(); aviso(Google.erro || 'Google atualizado'); },
    googleLiga(d) { db.google[d.k] = !db.google[d.k]; ok(); if (db.google[d.k]) Google.atualizar(); },
    sair() { Sync.sair(); },
    async instalar() {
      if (!App.instalar) return;
      App.instalar.prompt();
      await App.instalar.userChoice;
      App.instalar = null; render();
    },
    async syncAgora() { await Sync.sincronizar(); render(); aviso(Sync.estado === 'ok' ? 'Sincronizado' : Sync.rotulo()[1]); },
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
          if (!await confirmar('Todos os dados atuais serão substituídos pelos do backup.', { titulo: 'Importar backup', ok: 'Substituir tudo', perigo: true })) { el.value = ''; return; }
          db = mesclar(padrao(), dados);
          aplicarTema();
        } else if (Array.isArray(dados.fixos)) {
          if (!await confirmar('Este é um backup do controle de gastos. Os dados de Finanças serão substituídos por ele.', { titulo: 'Importar Finanças', ok: 'Substituir Finanças', perigo: true })) { el.value = ''; return; }
          db.financas = normalizarFinancas(dados);
        } else throw new Error('formato');
        ok('Backup importado');
      } catch (e) { aviso('Arquivo de backup inválido'); }
      el.value = '';
    },
  },
});
