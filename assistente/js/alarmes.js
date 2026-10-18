'use strict';
// ============ Alarmes e lembretes ============
// Os alarmes tocam enquanto o app estiver aberto em alguma aba do navegador.
const Alarmes = {
  fila: [], sonecas: [], disparados: new Set(), ctx: null, bipTimer: null, pararTimer: null, ultimo: null,

  proximaOcorrencia(a) {
    if (!a.ativo) return null;
    const h = hoje(), agora = agoraMin();
    for (let i = 0; i <= 7; i++) {
      const iso = somaDias(h, i);
      if (i === 0 && minutos(a.hora) <= agora) continue;
      if (a.dias?.length ? a.dias.includes(deISO(iso).getDay()) : a.data === iso) return { iso, hora: a.hora };
    }
    return null;
  },
  proximos(n) {
    return db.alarmes.map(a => ({ a, o: this.proximaOcorrencia(a) })).filter(x => x.o)
      .sort((x, y) => (x.o.iso + x.o.hora).localeCompare(y.o.iso + y.o.hora)).slice(0, n);
  },
  // Lembretes automáticos gerados pela agenda, trajetos e contas a pagar
  lembretesDoDia(iso) {
    const out = [];
    for (const ev of Agenda.eventosDoDia(iso)) {
      if (!ev.inicio) continue;
      if (ev.alerta !== '' && ev.alerta != null) {
        const m = minutos(ev.inicio) - Number(ev.alerta);
        if (m >= 0) out.push({ hora: hhmm(m), titulo: '📅 ' + ev.titulo, texto: `Começa às ${ev.inicio}${ev.local ? ' · ' + ev.local : ''}`, chave: `ev:${ev.id}:${iso}` });
      }
      const s = Agenda.horaSaida(ev);
      if (s && minutos(s) <= minutos(ev.inicio)) {
        const r = Agenda.rota(ev);
        out.push({ hora: s, titulo: '🚗 Hora de sair', texto: `${ev.titulo} às ${ev.inicio} · ${r.nome} (~${r.duracao} min)`, chave: `sai:${ev.id}:${iso}` });
      }
    }
    const mes = iso.slice(0, 7);
    for (const f of Financas.fixosDoMes(mes)) if (f.dia && !f.pagos?.[mes] && diaNoMes(mes, f.dia) === iso)
      out.push({ hora: '09:00', titulo: '💰 Conta vence hoje', texto: `${f.nome} · ${brl.format(f.valor)}`, chave: `fx:${f.id}:${iso}` });
    for (const d of Financas.dividasDoMes(mes)) if (d.dia && !d.pagos?.[mes] && diaNoMes(mes, d.dia) === iso)
      out.push({ hora: '09:00', titulo: '💰 Parcela vence hoje', texto: `${d.nome} · ${brl.format(d.parcela)}`, chave: `dv:${d.id}:${iso}` });
    return out.sort((a, b) => a.hora.localeCompare(b.hora));
  },

  verificarMinuto(dt) {
    const iso = isoData(dt), hm = hhmm(dt.getHours() * 60 + dt.getMinutes()), dow = dt.getDay();
    for (const a of db.alarmes) {
      if (!a.ativo || a.hora !== hm) continue;
      if (a.dias?.length ? !a.dias.includes(dow) : a.data !== iso) continue;
      this.disparar(`al:${a.id}:${iso}:${hm}`, a.rotulo || 'Alarme', `⏰ ${a.hora}`, () => {
        if (!a.dias?.length) { a.ativo = false; salvar(); render(); }
      });
    }
    for (const l of this.lembretesDoDia(iso)) if (l.hora === hm) this.disparar(l.chave, l.titulo, l.texto);
  },
  // Chamado a cada 10 s. Recupera minutos perdidos (aba em segundo plano) até 10 min atrás.
  verificar() {
    const fim = Math.floor(Date.now() / 60000) * 60000;
    let t = this.ultimo ? this.ultimo + 60000 : fim;
    if (t < fim - 10 * 60000) t = fim - 10 * 60000;
    for (; t <= fim; t += 60000) this.verificarMinuto(new Date(t));
    this.ultimo = fim;
    const agora = Date.now();
    this.sonecas = this.sonecas.filter(s => {
      if (s.em > agora) return true;
      this.disparar('sn:' + s.em, s.titulo, s.texto + ' (soneca)');
      return false;
    });
  },

  disparar(chave, titulo, texto, aoDisparar) {
    if (this.disparados.has(chave)) return;
    this.disparados.add(chave);
    aoDisparar?.();
    this.fila.push({ titulo, texto });
    if (this.fila.length === 1) this.mostrar();
    this.notificar(titulo, texto);
  },
  mostrar() {
    const a = this.fila[0];
    if (!a) { $('#alarme').hidden = true; this.parar(); return; }
    $('#alarmeTitulo').textContent = a.titulo;
    $('#alarmeTexto').textContent = a.texto;
    $('#alarme').hidden = false;
    this.tocar();
  },
  dispensar(soneca) {
    const a = this.fila.shift();
    if (soneca && a) { this.sonecas.push({ em: Date.now() + 5 * 60000, titulo: a.titulo, texto: a.texto }); aviso('Soneca de 5 minutos'); }
    this.parar(); this.mostrar();
  },
  async notificar(titulo, texto) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opcoes = { body: texto, requireInteraction: true, icon: 'icons/icone-192.png', badge: 'icons/icone-192.png', vibrate: [300, 150, 300], tag: titulo };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) return reg.showNotification(titulo, opcoes);
      new Notification(titulo, opcoes);
    } catch (e) {}
  },
  audio() {
    if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) this.ctx = new C(); }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  bip() {
    const ctx = this.audio(); if (!ctx) return;
    const t0 = ctx.currentTime;
    [0, 0.25, 0.5].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.22);
    });
  },
  tocar() {
    this.parar(); this.bip();
    this.bipTimer = setInterval(() => this.bip(), 1500);
    this.pararTimer = setTimeout(() => this.parar(), 60000);
  },
  parar() { clearInterval(this.bipTimer); clearTimeout(this.pararTimer); },

  form(a) {
    crud({
      lista: db.alarmes, item: a, titulos: ['Novo alarme', 'Editar alarme'],
      campos: [
        { nome: 'hora', rotulo: 'Hora', tipo: 'time', obrigatorio: true },
        { nome: 'rotulo', rotulo: 'Nome', dica: 'Ex.: Acordar, Remédio, Academia' },
        { nome: 'dias', rotulo: 'Repetir', tipo: 'dias', ajuda: 'Nenhum dia marcado = toca uma vez só' },
      ],
      preparar: v => {
        v.ativo = true;
        v.data = v.dias.length ? null : (minutos(v.hora) > agoraMin() ? hoje() : somaDias(hoje(), 1));
      },
    });
  },
  descricaoDias(a) {
    if (!a.dias?.length) return a.data ? 'Uma vez · ' + rotuloDia(a.data) : 'Uma vez';
    if (a.dias.length === 7) return 'Todos os dias';
    const s = [...a.dias].sort().join();
    if (s === '1,2,3,4,5') return 'Dias úteis';
    if (s === '0,6') return 'Fins de semana';
    return [1, 2, 3, 4, 5, 6, 0].filter(i => a.dias.includes(i)).map(i => DIAS_SEMANA[i]).join(', ');
  },
};

registrar({
  id: 'alarmes', nome: 'Alarmes', icone: '⏰',
  render() {
    const A = Alarmes;
    const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
    const lista = [...db.alarmes].sort((a, b) => a.hora.localeCompare(b.hora));
    const lemb = A.lembretesDoDia(hoje()), agora = hhmm(agoraMin());
    return `<div class="topo"><h1>⏰ Alarmes</h1><button data-acao="testar">🔊 Testar som</button>
        <button class="primary" data-acao="novo">+ Novo alarme</button></div>
      <div class="aviso">ℹ️ Os alarmes tocam enquanto este app estiver aberto em uma aba do navegador (pode ficar minimizada).
        ${perm === 'default' ? '<button class="mini primary" data-acao="permitir">Ativar notificações</button>' : ''}
        ${perm === 'denied' ? '<b>Notificações bloqueadas no navegador — o alarme toca só dentro do app.</b>' : ''}</div>
      <div class="grid2">
        <section class="card"><h2>Meus alarmes</h2>
          ${lista.map(a => `<div class="al ${a.ativo ? '' : 'off'}">
            <div class="h">${a.hora}</div>
            <div class="info"><div style="font-weight:600">${esc(a.rotulo || 'Alarme')}</div><div class="muted" style="font-size:13px">${A.descricaoDias(a)}</div></div>
            <button class="switch ${a.ativo ? 'on' : ''}" data-acao="alternar" data-id="${a.id}" title="Ligar/desligar"></button>
            <button class="icon" data-acao="editar" data-id="${a.id}" title="Editar">✎</button></div>`).join('')
            || '<div class="vazio">Nenhum alarme.</div>'}
        </section>
        <section class="card"><h2>Lembretes automáticos de hoje</h2>
          <ul class="lista">${lemb.map(l => `<li class="${l.hora < agora ? 'feito' : ''}">
            <div class="hora" style="width:52px;font-weight:650">${l.hora}</div>
            <div class="info"><div class="nome">${esc(l.titulo)}</div><div class="sub">${esc(l.texto)}</div></div></li>`).join('')
            || '<div class="vazio">Eventos com lembrete, horários de saída e contas que vencem hoje aparecem aqui.</div>'}</ul>
        </section>
      </div>`;
  },
  acoes: {
    novo() { Alarmes.form(); },
    editar(d) { Alarmes.form(db.alarmes.find(a => a.id === d.id)); },
    alternar(d) {
      const a = db.alarmes.find(x => x.id === d.id);
      a.ativo = !a.ativo;
      if (a.ativo && !a.dias?.length) a.data = minutos(a.hora) > agoraMin() ? hoje() : somaDias(hoje(), 1);
      ok(a.ativo ? 'Alarme ligado' : 'Alarme desligado');
    },
    testar() { Alarmes.bip(); },
    async permitir() { await Notification.requestPermission(); render(); },
  },
});
