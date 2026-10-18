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
  // O app Android abre o site da Vercel: os plugins nativos precisam ser registrados pelo nome
  // (a biblioteca @capacitor/core, em js/vendor, cria a ponte para o código nativo de cada um)
  PLUGINS: ['App', 'LocalNotifications', 'Browser', 'StatusBar', 'SpeechRecognition', 'TextToSpeech'],
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
    A.addListener('appUrlOpen', ({ url }) => this.voltaLogin(url));
    A.addListener('backButton', () => {
      const aberto = document.querySelector('dialog[open]');
      if (aberto) { const b = aberto.querySelector('[data-r=nao], [data-m=cancelar], [data-f=fechar]'); b ? b.click() : aberto.close(); }
      else if (!$('#alarme').hidden) Alarmes.dispensar(false);
      else if (atual !== 'inicio') history.back();
      else A.minimizeApp();
    });
    A.addListener('resume', () => { Sync.sincronizar(); this.agendarDepois(500); });
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
    this.timer = setTimeout(() => this.agendar(), ms);
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
