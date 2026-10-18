'use strict';
// ============ App Android (Capacitor) ============
// Dentro do APK: alarmes, lembretes de eventos, hora de sair e contas viram notificações nativas
// agendadas no Android (tocam mesmo com o app fechado). O login com Google abre no navegador do sistema,
// porque o Google não permite login dentro de WebView.
const Nativo = {
  ativo: !!window.Capacitor?.isNativePlatform?.(),
  ESQUEMA: 'br.com.assistentepessoal',
  CANAL: 'alarmes',
  timer: null, assinatura: '', agendados: 0, permissao: null, exato: null,
  relogio: null, // próximo alarme do app Relógio do celular: { quando: ms, pacote }
  // O app Android abre o site da Vercel: os plugins nativos precisam ser registrados pelo nome
  // (a biblioteca @capacitor/core, em js/vendor, cria a ponte para o código nativo de cada um)
  PLUGINS: ['App', 'LocalNotifications', 'Browser', 'StatusBar', 'SpeechRecognition', 'TextToSpeech', 'Preferences', 'Sistema'],
  _p: null,
  get P() {
    if (this._p) return this._p;
    const C = window.Capacitor;
    if (!C?.registerPlugin) return C?.Plugins || {};
    this._p = {};
    for (const n of this.PLUGINS) this._p[n] = C.Plugins?.[n] || C.registerPlugin(n);
    return this._p;
  },

  async iniciar() {
    if (!this.ativo) return;
    const { App: A, LocalNotifications: LN, StatusBar } = this.P;
    try { await StatusBar.setBackgroundColor({ color: '#2f6fed' }); } catch (e) {}
    A.addListener('appUrlOpen', ({ url }) => this.abrirLink(url));
    A.addListener('backButton', () => {
      const aberto = document.querySelector('dialog[open]');
      if (aberto) { const b = aberto.querySelector('[data-r=nao], [data-m=cancelar], [data-f=fechar]'); b ? b.click() : aberto.close(); }
      else if (!$('#alarme').hidden) Alarmes.dispensar(false);
      else if (atual !== 'inicio') history.back();
      else A.minimizeApp();
    });
    A.addListener('resume', () => { Sync.sincronizar(); this.agendarDepois(500); this.lerRelogio(); });
    try {
      await LN.createChannel({
        id: this.CANAL, name: 'Alarmes e lembretes', description: 'Alarmes, eventos, hora de sair e contas a pagar',
        importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#2F6FED',
      });
      await LN.registerActionTypes({ types: [{ id: 'ALERTA', actions: [{ id: 'soneca', title: 'Soneca 5 min' }, { id: 'ok', title: 'OK' }] }] });
    } catch (e) { console.warn('Canal de notificação:', e); }
    LN.addListener('localNotificationActionPerformed', ({ actionId, notification: n }) => {
      if (actionId === 'soneca') return this.soneca(n);
      if (actionId === 'ok') return;
      if (n.extra?.pagina) ir(n.extra.pagina);
    });
    await this.verPermissoes();
    this.agendarDepois(500);
    this.lerRelogio();
    // aberto pelo widget com o app fechado
    try { const { url } = await A.getLaunchUrl() || {}; if (url) setTimeout(() => this.abrirLink(url), 800); } catch (e) {}
  },

  // Links do app: retorno do login e atalhos do widget
  abrirLink(url) {
    if (!url) return;
    if (url.startsWith(this.ESQUEMA + '://login')) return this.voltaLogin(url);
    if (url.startsWith(this.ESQUEMA + '://jarvis')) return Jarvis.abrir({ ouvir: true });
    if (url.startsWith(this.ESQUEMA + '://inicio')) return ir('inicio');
  },

  // ---------- Widget da tela inicial ----------
  // Grava um resumo curto do dia; o widget lê ao sair do app (e a cada 30 min)
  widgetTimer: null, widgetUltimo: '',
  atualizarWidget() {
    if (!this.ativo) return;
    clearTimeout(this.widgetTimer);
    this.widgetTimer = setTimeout(() => {
      const h = hoje(), agora = hhmm(agoraMin());
      const prox = [h, somaDias(h, 1)].flatMap(iso => Agenda.eventosDoDia(iso).map(e => ({ iso, e })))
        .find(x => x.iso > h || !x.e.inicio || x.e.inicio >= agora);
      const pend = db.tarefas.filter(t => t.status !== 'feito');
      const atras = pend.filter(t => t.prazo && t.prazo < h).length;
      const r = Financas.resumo(chaveMes(new Date()));
      const dados = {
        linha1: prox ? `${prox.iso === h ? 'Hoje' : 'Amanhã'}${prox.e.inicio ? ' ' + prox.e.inicio : ''} · ${prox.e.titulo}` : 'Agenda livre hoje e amanhã',
        linha2: `${pend.length} tarefa${pend.length === 1 ? '' : 's'} pendente${pend.length === 1 ? '' : 's'}${atras ? ` · ${atras} atrasada${atras > 1 ? 's' : ''}` : ''}`,
        linha3: r.renda ? `Saldo do mês: ${brl.format(r.saldo)}` : `Gastos do mês: ${brl.format(r.total)}`,
      };
      const json = JSON.stringify(dados);
      if (json === this.widgetUltimo) return;
      this.widgetUltimo = json;
      this.P.Preferences?.set({ key: 'jarvis_widget', value: json }).catch(() => {});
    }, 2000);
  },

  // ---------- App Relógio (Samsung) ----------
  // O Android só deixa ler o PRÓXIMO alarme do Relógio; criar alarmes nele é permitido.
  RELOGIO_PROPRIO: 'br.com.assistentepessoal',
  async lerRelogio() {
    if (!this.ativo) return;
    try {
      const r = await this.P.Sistema.proximoAlarme();
      const novo = r?.quando && r.pacote !== this.RELOGIO_PROPRIO ? { quando: r.quando, pacote: r.pacote } : null;
      if (JSON.stringify(novo) !== JSON.stringify(this.relogio)) { this.relogio = novo; if (['alarmes', 'inicio'].includes(atual)) render(); }
    } catch (e) { this.relogio = null; } // APK antigo, sem o plugin
  },
  relogioTexto() {
    if (!this.relogio) return '';
    const d = new Date(this.relogio.quando), iso = isoData(d);
    return `${rotuloDia(iso)} às ${hhmm(d.getHours() * 60 + d.getMinutes())}`;
  },
  // Com "copiar para o Relógio" ligado, cada alarme do app (criado aqui, no PC ou pelo Jarvis) vai uma vez para o Relógio
  enviandoRelogio: false,
  async enviarParaRelogio() {
    if (!this.ativo || !db.config.relogio || this.enviandoRelogio) return;
    const pend = db.alarmes.filter(a => a.ativo && !a.noRelogio && (a.dias?.length || a.data >= hoje()));
    if (!pend.length) return;
    this.enviandoRelogio = true;
    let n = 0;
    for (const a of pend) {
      const [h, m] = a.hora.split(':').map(Number);
      try {
        await this.P.Sistema.criarAlarmeRelogio({ hora: h, minuto: m, rotulo: a.rotulo || 'Alarme', dias: a.dias || [] });
        a.noRelogio = true; n++;
        await new Promise(r => setTimeout(r, 700)); // o Relógio processa um pedido por vez
      } catch (e) { console.warn('Relógio:', e); break; }
    }
    this.enviandoRelogio = false;
    if (n) { salvar(); aviso(`${n} alarme${n > 1 ? 's' : ''} criado${n > 1 ? 's' : ''} no Relógio do celular`); setTimeout(() => this.lerRelogio(), 5000); }
  },

  // ---------- Permissões ----------
  async verPermissoes() {
    const LN = this.P.LocalNotifications;
    try { this.permissao = (await LN.checkPermissions()).display; } catch (e) { this.permissao = 'denied'; }
    try { this.exato = (await LN.checkExactNotificationSetting()).exact_alarm; } catch (e) { this.exato = 'granted'; }
  },
  async pedirPermissoes() {
    const LN = this.P.LocalNotifications;
    if (this.permissao !== 'granted') await LN.requestPermissions();
    await this.verPermissoes();
    if (this.exato !== 'granted') {
      try { await LN.changeExactNotificationSetting(); } catch (e) {}
      await this.verPermissoes();
    }
    this.assinatura = '';
    this.agendarDepois(0);
    render();
  },

  // ---------- Agendamento ----------
  // Próximas notificações (7 dias): alarmes + lembretes automáticos (eventos, hora de sair, contas)
  proximos() {
    const out = [], h = hoje(), limite = Date.now() + 5000;
    const em = (iso, hm) => { const [a, m, d] = iso.split('-').map(Number); const [hh, mm] = hm.split(':').map(Number); return new Date(a, m - 1, d, hh, mm); };
    for (let i = 0; i < 7; i++) {
      const iso = somaDias(h, i), dow = deISO(iso).getDay();
      for (const a of db.alarmes) {
        if (!a.ativo || (a.dias?.length ? !a.dias.includes(dow) : a.data !== iso)) continue;
        if (a.noRelogio) continue; // já toca pelo Relógio do celular
        out.push({ chave: `al:${a.id}:${iso}`, quando: em(iso, a.hora), titulo: '⏰ ' + (a.rotulo || 'Alarme'), texto: `Alarme das ${a.hora}`, pagina: 'alarmes' });
      }
      for (const l of Alarmes.lembretesDoDia(iso)) {
        out.push({ chave: l.chave, quando: em(iso, l.hora), titulo: l.titulo, texto: l.texto, pagina: /^(fx|dv):/.test(l.chave) ? 'financas' : 'agenda' });
      }
    }
    return out.filter(x => x.quando.getTime() > limite).sort((a, b) => a.quando - b.quando).slice(0, 60);
  },
  idDe(chave) {
    let h = 0;
    for (const c of chave) h = (h * 31 + c.charCodeAt(0)) | 0;
    return (Math.abs(h) % 2000000000) + 1;
  },
  agendarDepois(ms = 2000) {
    if (!this.ativo) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.agendar(); this.enviarParaRelogio(); }, ms);
  },
  notificacao(x) {
    return {
      id: this.idDe(x.chave), title: x.titulo, body: x.texto, channelId: this.CANAL, actionTypeId: 'ALERTA',
      smallIcon: 'ic_stat_assistente', iconColor: '#2F6FED',
      schedule: { at: x.quando, allowWhileIdle: true }, extra: { pagina: x.pagina },
    };
  },
  async agendar() {
    if (!this.ativo || this.permissao !== 'granted') return;
    const LN = this.P.LocalNotifications;
    const lista = this.proximos();
    const assinatura = JSON.stringify(lista.map(x => [x.chave, +x.quando, x.titulo, x.texto]));
    if (assinatura === this.assinatura) return;
    try {
      const pendentes = (await LN.getPending()).notifications.filter(n => !n.extra?.soneca);
      if (pendentes.length) await LN.cancel({ notifications: pendentes.map(n => ({ id: n.id })) });
      if (lista.length) await LN.schedule({ notifications: lista.map(x => this.notificacao(x)) });
      this.assinatura = assinatura;
      this.agendados = lista.length;
    } catch (e) { console.warn('Agendamento nativo:', e); }
  },
  async soneca(n) {
    const quando = new Date(Date.now() + 5 * 60000);
    await this.P.LocalNotifications.schedule({ notifications: [{
      ...this.notificacao({ chave: 'sn:' + quando.getTime(), quando, titulo: n.title, texto: n.body + ' (soneca)', pagina: n.extra?.pagina }),
      extra: { pagina: n.extra?.pagina, soneca: true },
    }] });
  },

  // ---------- Login com Google pelo navegador do sistema ----------
  async entrar() {
    const { data, error } = await Sync.sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: this.ESQUEMA + '://login', scopes: window.GOOGLE_ESCOPOS, skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) return aviso('Erro ao entrar: ' + error.message);
    await this.P.Browser.open({ url: data.url });
  },
  async voltaLogin(url) {
    if (!url?.startsWith(this.ESQUEMA + '://login')) return;
    try { await this.P.Browser.close(); } catch (e) {}
    const u = new URL(url);
    const erro = u.searchParams.get('error_description'), code = u.searchParams.get('code');
    if (erro) return aviso('Login não concluído: ' + erro);
    if (!code) return;
    const { error } = await Sync.sb.auth.exchangeCodeForSession(code);
    aviso(error ? 'Erro ao entrar: ' + error.message : 'Conectado');
  },
};
