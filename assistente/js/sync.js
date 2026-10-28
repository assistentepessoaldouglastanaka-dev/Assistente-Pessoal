'use strict';
// ============ Sincronização com o Supabase ============
// Funciona offline: compara o estado local com a última versão enviada ("sombra") e envia só o que mudou.
// Recebe mudanças dos outros aparelhos em tempo real e, como reserva, a cada minuto e ao voltar para o app.
const Sync = {
  sb: null, usuario: null, canal: null, timer: null, enviando: false, pendente: false,
  estado: 'desligado', // desligado | arquivo | sincronizando | ok | offline | erro
  sombra: {}, cursor: null, ultimo: null, erro: '',
  CHAVE: 'assistente.sync',

  configurado() { return !!(window.SUPABASE_URL && window.SUPABASE_KEY && window.supabase); },

  iniciar() {
    if (!this.configurado()) return;
    if (location.protocol === 'file:') { this.estado = 'arquivo'; return; }
    this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, Nativo.ativo ? { auth: { flowType: 'pkce' } } : undefined);
    this.sb.auth.onAuthStateChange((evento, sessao) => {
      // chamadas ao Supabase fora do callback (recomendação da biblioteca)
      setTimeout(() => {
        if (evento === 'SIGNED_IN' && sessao?.provider_refresh_token) this.salvarTokenGoogle(sessao);
        if (evento === 'SIGNED_IN' && sessao?.provider_token) Google.usarToken(sessao.provider_token, 3000);
        const u = sessao?.user || null;
        if (u?.id === this.usuario?.id) return;
        this.usuario = u;
        if (u) this.conectar(); else this.desconectar();
      }, 0);
    });
    window.addEventListener('online', () => this.sincronizar());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sincronizar(); });
    setInterval(() => this.sincronizar(), 60000);
  },

  async entrar() {
    if (Nativo.ativo) return Nativo.entrar();
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + location.pathname,
        scopes: window.GOOGLE_ESCOPOS,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) aviso('Erro ao entrar: ' + error.message);
  },
  async sair() {
    if (!await confirmar('Os dados continuam neste aparelho, mas param de sincronizar com os outros.', { titulo: 'Sair da conta', ok: 'Sair' })) return;
    await this.sb.auth.signOut();
  },
  async salvarTokenGoogle(sessao) {
    const { error } = await this.sb.rpc('salvar_token_google', { p_refresh_token: sessao.provider_refresh_token, p_escopos: window.GOOGLE_ESCOPOS });
    if (error) console.warn('Token do Google não salvo:', error.message);
  },

  // ---------- Estado da sincronização (por usuário) ----------
  carregarEstado() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(this.CHAVE)); } catch (e) {}
    if (s && s.usuario === this.usuario.id) { this.sombra = s.sombra || {}; this.cursor = s.cursor || null; this.ultimo = s.ultimo || null; }
    else { this.sombra = {}; this.cursor = null; this.ultimo = null; }
  },
  salvarEstado() {
    try {
      localStorage.setItem(this.CHAVE, JSON.stringify({ usuario: this.usuario.id, sombra: this.sombra, cursor: this.cursor, ultimo: this.ultimo }));
    } catch (e) {}
  },

  // ---------- Mapeamento entre o `db` local e as linhas da tabela `itens` ----------
  colecoes() {
    return {
      tarefas: db.tarefas, wishlist: db.wishlist, eventos: db.eventos, locais: db.locais, rotas: db.rotas,
      alarmes: db.alarmes, notas: db.notas,
      fixos: db.financas.fixos, variaveis: db.financas.variaveis, dividas: db.financas.dividas,
      treinos_modelos: db.treinos.modelos, treinos_sessoes: db.treinos.sessoes, bioimpedancia: db.bioimpedancia,
      planos: db.planos, compras: db.compras,
    };
  },
  unicos() {
    return { config: db.config, renda: db.financas.renda, treinos_semana: db.treinos.semana, treinos_atual: db.treinos.atual, google: db.google, mercado: db.mercado };
  },
  definirUnico(nome, v) {
    const trocar = (alvo, novo) => { for (const k of Object.keys(alvo)) delete alvo[k]; Object.assign(alvo, novo || {}); };
    if (nome === 'config') { Object.assign(db.config, v || {}); aplicarTema(); }
    else if (nome === 'renda') trocar(db.financas.renda, v);
    else if (nome === 'treinos_semana') trocar(db.treinos.semana, v);
    else if (nome === 'treinos_atual') db.treinos.atual = v ?? null;
    else if (nome === 'mercado') { trocar(db.mercado, v); mesclar(padrao().mercado, db.mercado); }
    else if (nome === 'google') { trocar(db.google, v); mesclar(padrao().google, db.google); }
  },
  estadoLocal() {
    const m = {};
    for (const [c, arr] of Object.entries(this.colecoes())) for (const it of arr) if (it?.id) m[c + '/' + it.id] = JSON.stringify(it);
    for (const [n, v] of Object.entries(this.unicos())) m['_unico/' + n] = JSON.stringify(v ?? null);
    return m;
  },
  aplicarItem(colecao, id, dados) {
    if (colecao === '_unico') return this.definirUnico(id, dados);
    const arr = this.colecoes()[colecao];
    if (!arr) return;
    const i = arr.findIndex(x => x.id === id);
    if (dados == null) { if (i >= 0) arr.splice(i, 1); }
    else if (i >= 0) arr[i] = dados;
    else arr.push(dados);
  },

  // ---------- Envio ----------
  agendar() {
    if (!this.usuario) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.enviar(), 800);
  },
  async enviar() {
    if (!this.usuario) return;
    if (this.enviando) { this.pendente = true; return; }
    this.enviando = true;
    try {
      const local = this.estadoLocal(), linhas = [];
      for (const [k, s] of Object.entries(local)) if (this.sombra[k] !== s) linhas.push(this.linha(k, JSON.parse(s), false));
      for (const k of Object.keys(this.sombra)) if (!(k in local)) linhas.push(this.linha(k, null, true));
      for (let i = 0; i < linhas.length; i += 500) {
        const lote = linhas.slice(i, i + 500);
        const { error } = await this.sb.from('itens').upsert(lote, { onConflict: 'user_id,colecao,id' });
        if (error) throw error;
        for (const l of lote) {
          const k = l.colecao + '/' + l.id;
          if (l.excluido) delete this.sombra[k]; else this.sombra[k] = JSON.stringify(l.dados);
        }
      }
      if (linhas.length) { this.ultimo = new Date().toISOString(); this.salvarEstado(); }
      this.definirEstado('ok');
    } catch (e) {
      this.falha(e);
    } finally {
      this.enviando = false;
      if (this.pendente) { this.pendente = false; this.agendar(); }
    }
  },
  linha(chave, dados, excluido) {
    const i = chave.indexOf('/');
    return { user_id: this.usuario.id, colecao: chave.slice(0, i), id: chave.slice(i + 1), dados, excluido };
  },

  // ---------- Recebimento ----------
  async receber() {
    // 5 s de sobreposição para não perder alterações gravadas quase ao mesmo tempo
    const desde = this.cursor ? new Date(new Date(this.cursor).getTime() - 5000).toISOString() : null;
    const recebidas = [];
    for (let de = 0; ; de += 1000) {
      let q = this.sb.from('itens').select('colecao,id,dados,excluido,atualizado_em').order('atualizado_em').range(de, de + 999);
      if (desde) q = q.gt('atualizado_em', desde);
      const { data, error } = await q;
      if (error) throw error;
      recebidas.push(...data);
      if (data.length < 1000) break;
    }
    this.aplicar(recebidas);
    for (const r of recebidas) if (!this.cursor || new Date(r.atualizado_em) > new Date(this.cursor)) this.cursor = r.atualizado_em;
    this.salvarEstado();
  },
  aplicar(linhas) {
    if (!linhas.length) return;
    const local = this.estadoLocal();
    let mudou = false;
    for (const r of linhas) {
      const k = r.colecao + '/' + r.id;
      const remoto = r.excluido ? undefined : JSON.stringify(r.dados);
      // Alteração local ainda não enviada vence (exceto na primeira sincronização deste aparelho)
      if (this.cursor && local[k] !== this.sombra[k]) continue;
      if (remoto !== local[k]) { this.aplicarItem(r.colecao, r.id, r.excluido ? null : r.dados); mudou = true; }
      if (r.excluido) delete this.sombra[k]; else this.sombra[k] = remoto;
    }
    if (mudou) {
      try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch (e) {}
      if (!$('#modal').open) render();
    }
  },

  // ---------- Ciclo ----------
  async conectar() {
    this.carregarEstado();
    this.definirEstado('sincronizando');
    try {
      await this.receber();
      await this.enviar();
    } catch (e) { this.falha(e); }
    const uid = this.usuario.id;
    this.canal = this.sb.channel('itens-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itens', filter: 'user_id=eq.' + uid },
        p => { if (p.new?.colecao) { this.aplicar([p.new]); this.salvarEstado(); } })
      .subscribe();
    render();
    Google.aoConectar();
  },
  desconectar() {
    if (this.canal) { this.sb.removeChannel(this.canal); this.canal = null; }
    Google.aoDesconectar();
    this.definirEstado('desligado');
    render();
  },
  async sincronizar() {
    if (!this.usuario || this.enviando) return;
    try {
      await this.receber();
      await this.enviar();
    } catch (e) { this.falha(e); }
  },
  falha(e) {
    this.erro = e?.message || String(e);
    this.definirEstado(navigator.onLine ? 'erro' : 'offline');
    if (navigator.onLine) console.warn('Sincronização:', this.erro);
  },
  definirEstado(s) {
    this.estado = s;
    const [, texto] = this.rotulo();
    for (const el of document.querySelectorAll('#syncPonto, #syncPontoBarra')) { el.className = 'ponto-sync ' + s; el.title = texto; }
    const t = $('#syncTexto');
    if (t) t.textContent = this.usuario ? (s === 'ok' ? 'Sincronizado' : texto) : (this.configurado() ? 'Não conectado' : 'Só neste aparelho');
  },
  rotulo() {
    return {
      desligado: ['', 'Sem sincronização'], arquivo: ['', 'Aberto como arquivo — sem sincronização'],
      sincronizando: ['azul', 'Sincronizando...'], ok: ['verde', 'Sincronizado'],
      offline: ['laranja', 'Sem internet — as alterações serão enviadas depois'], erro: ['vermelho', 'Erro na sincronização: ' + this.erro],
    }[this.estado];
  },
};
