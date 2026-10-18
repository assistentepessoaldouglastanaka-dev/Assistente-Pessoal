'use strict';
// ============ Agenda ============
const REPETICOES = [['nao', 'Não repete'], ['diario', 'Todo dia'], ['uteis', 'Dias úteis (seg–sex)'], ['semanal', 'Toda semana'], ['mensal', 'Todo mês'], ['anual', 'Todo ano']];
const ALERTAS = [['', 'Sem alerta'], ['0', 'Na hora'], ['5', '5 min antes'], ['10', '10 min antes'], ['15', '15 min antes'], ['30', '30 min antes'], ['60', '1 h antes'], ['120', '2 h antes']];
const TIPOS_EVENTO = [['pessoal', 'Pessoal'], ['trabalho', 'Trabalho'], ['saude', 'Saúde / academia']];

const Agenda = {
  sel: hoje(),
  mes: chaveMes(new Date()),
  ocorre(ev, iso) {
    // eventos do Google já vêm expandidos (uma ocorrência por item); os de dia inteiro podem durar vários dias
    if (ev.google) return ev.ateExcl ? iso >= ev.data && iso < ev.ateExcl : iso === ev.data;
    if (iso < ev.data || (ev.ate && iso > ev.ate)) return false;
    switch (ev.repetir) {
      case 'diario': return true;
      case 'uteis': { const d = deISO(iso).getDay(); return d > 0 && d < 6; }
      case 'semanal': return deISO(iso).getDay() === deISO(ev.data).getDay();
      case 'mensal': return iso.slice(8) === ev.data.slice(8);
      case 'anual': return iso.slice(5) === ev.data.slice(5);
      default: return iso === ev.data;
    }
  },
  eventosDoDia(iso) {
    const todos = GAgenda.ativa() ? [...db.eventos, ...GAgenda.eventos] : db.eventos;
    return todos.filter(ev => this.ocorre(ev, iso)).sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
  },
  rota(ev) { return ev.rotaId ? db.rotas.find(r => r.id === ev.rotaId) : null; },
  horaSaida(ev) {
    const r = this.rota(ev);
    if (!r || !ev.inicio || !r.duracao) return null;
    return hhmm(minutos(ev.inicio) - r.duracao - (db.config.folga || 0));
  },
  itemHTML(ev) {
    const saida = this.horaSaida(ev), r = this.rota(ev);
    const repete = (ev.repetir && ev.repetir !== 'nao') || ev.serie;
    const temAlerta = ev.alerta !== '' && ev.alerta != null;
    const link = (href, icone, rotulo) => `<a class="btn icon" href="${esc(href)}" target="_blank" rel="noopener" title="${rotulo}" aria-label="${rotulo}">${ic(icone)}</a>`;
    return `<li class="ev ev-${ev.tipo || 'pessoal'}">
      <div class="hora">${ev.inicio ? ev.inicio + (ev.fim ? `<small>${ev.fim}</small>` : '') : '<small>dia todo</small>'}</div>
      <div class="info" data-acao="agenda:editar" data-id="${ev.id}" style="cursor:pointer">
        <div class="nome">${esc(ev.titulo)}</div>
        <div class="sub">${ev.local ? `<span>${ic('map-pin', 'ic-sm')} ${esc(ev.local)}</span>` : ''}
          ${saida ? `<span class="ehoje">${ic('car', 'ic-sm')} sair às ${saida}</span>` : ''}
          ${repete ? `<span title="Repete">${ic('repeat', 'ic-sm')}</span>` : ''}${temAlerta ? `<span title="Lembrete ${ev.alerta} min antes">${ic('bell', 'ic-sm')}</span>` : ''}</div></div>
      ${ev.meet ? link(ev.meet, 'video', 'Entrar no Meet') : ''}
      ${r ? link(Trajetos.linkMaps(r), 'navigation', 'Abrir rota no Maps') : ev.local ? link(Trajetos.linkBusca(ev.local), 'map', 'Ver no mapa') : ''}
    </li>`;
  },
  campos(valores = {}, comPersonalizada = false) {
    return [
      { nome: 'titulo', rotulo: 'Título', obrigatorio: true, largo: true },
      { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, padrao: valores.data || this.sel },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_EVENTO, padrao: valores.tipo },
      { nome: 'inicio', rotulo: 'Início', tipo: 'time', ajuda: 'Vazio = dia todo' },
      { nome: 'fim', rotulo: 'Fim', tipo: 'time' },
      { nome: 'local', rotulo: 'Local', largo: true, sugestoes: db.locais.map(l => l.nome), padrao: valores.local },
      { nome: 'rotaId', rotulo: 'Trajeto até lá', tipo: 'select', opcoes: [['', 'Sem deslocamento'], ...db.rotas.map(r => [r.id, `${r.nome} (${r.duracao || '?'} min)`])],
        padrao: valores.rotaId, ajuda: 'Avisa a hora de sair' },
      { nome: 'alerta', rotulo: 'Lembrete', tipo: 'select', opcoes: ALERTAS, padrao: '15' },
      { nome: 'repetir', rotulo: 'Repetir', tipo: 'select', opcoes: comPersonalizada ? [...REPETICOES, ['outro', 'Personalizada (definida no Google)']] : REPETICOES },
      { nome: 'ate', rotulo: 'Repetir até', tipo: 'date', ajuda: 'Opcional' },
      { nome: 'notas', rotulo: 'Notas', tipo: 'textarea', largo: true, linhas: 2 },
    ];
  },
  validar(v) {
    if (v.fim && v.inicio && v.fim < v.inicio) { aviso('O fim precisa ser depois do início.'); return false; }
  },
  // Conectado ao Google, eventos novos vão para o Google Agenda; sem conexão, ficam só no app
  form(ev, valores = {}) {
    if (ev?.google || (!ev && GAgenda.ativa())) return GAgenda.form(ev, valores);
    crud({
      lista: db.eventos, item: ev, titulos: ['Novo evento', 'Editar evento'], campos: this.campos(valores),
      preparar: v => this.validar(v),
      depois: e => { this.sel = e.data; this.mes = e.data.slice(0, 7); },
    });
  },
};

registrar({
  id: 'agenda', nome: 'Agenda', icone: '📅',
  render() {
    const A = Agenda, h = hoje();
    const [a, m] = A.mes.split('-').map(Number);
    const primeiro = new Date(a, m - 1, 1);
    const ini = somaDias(isoData(primeiro), -primeiro.getDay());
    const prazos = {};
    db.tarefas.forEach(t => { if (t.prazo && t.status !== 'feito') prazos[t.prazo] = (prazos[t.prazo] || 0) + 1; });
    let cells = DIAS_SEMANA.map(d => `<div class="cab">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const iso = somaDias(ini, i);
      const n = A.eventosDoDia(iso).length;
      cells += `<button class="dia${iso.slice(0, 7) !== A.mes ? ' fora' : ''}${iso === h ? ' hoje' : ''}${iso === A.sel ? ' sel' : ''}" data-acao="dia" data-iso="${iso}">
        <span class="n">${Number(iso.slice(8))}</span><span class="pontos">${'<i></i>'.repeat(Math.min(n, 3))}${prazos[iso] ? '<i class="t"></i>' : ''}</span></button>`;
    }
    const evs = A.eventosDoDia(A.sel);
    const tarefasDia = db.tarefas.filter(t => t.prazo === A.sel && t.status !== 'feito');

    let proximos = '';
    for (let i = 1; i <= 7; i++) {
      const iso = somaDias(h, i), l = A.eventosDoDia(iso);
      if (l.length) proximos += `<div class="dia-titulo">${rotuloDia(iso)}</div><ul class="lista">${l.map(e => A.itemHTML(e)).join('')}</ul>`;
    }

    const g = GAgenda.ativa();
    return cabecalho('Agenda', {
        sub: g ? (GAgenda.erro ? `${ic('circle-alert', 'ic-sm')} Google Agenda com erro` : `${ic('link', 'ic-sm')} Sincronizada com o Google Agenda`) : '',
        acoes: `${g && db.eventos.length ? `<button data-acao="enviarGoogle">${ic('upload')}<span class="rotulo-opc">Enviar ${db.eventos.length} evento(s) ao Google</span></button>` : ''}
          <button class="primary" data-acao="novo">${ic('plus')}<span class="rotulo-opc">Novo evento</span></button>` })
      + `${g && GAgenda.erro ? `<div class="aviso laranja">${ic('circle-alert')} ${esc(GAgenda.erro)}</div>` : ''}
      <div class="grid2">
        <section class="card">
          <div class="cal-topo">
            <strong>${nomeMes(A.mes)}</strong>
            ${A.mes !== chaveMes(new Date()) || A.sel !== h ? `<button class="mini" data-acao="irHoje">Hoje</button>` : ''}
            ${bi('mesAnt', 'chevron-left', 'Mês anterior')}${bi('mesProx', 'chevron-right', 'Próximo mês')}
          </div>
          <div class="cal">${cells}</div>
          <div class="legenda"><span><i class="dot" style="background:var(--accent)"></i> Eventos</span><span><i class="dot" style="background:var(--warn)"></i> Prazo de tarefa</span></div>
        </section>
        <section class="card">
          <h2>${A.sel === h ? 'Hoje' : rotuloDia(A.sel)} <span class="muted" style="font-weight:400">${fmtData(A.sel)}</span><span class="sp"></span>
            ${bi('novo', 'plus', 'Novo evento neste dia')}</h2>
          ${evs.length ? `<ul class="lista">${evs.map(e => A.itemHTML(e)).join('')}</ul>` : vazio('calendar', 'Nenhum evento neste dia.')}
          ${tarefasDia.length ? `<div class="dia-titulo">Tarefas com prazo</div><ul class="lista">${tarefasDia.map(t => `<li>
            <span class="dot p-${t.prioridade || 'media'}"></span><div class="info"><div class="nome">${esc(t.titulo)}</div>
            <div class="sub">${ic(t.area === 'trabalho' ? 'briefcase' : 'list-checks', 'ic-sm')} ${t.area === 'trabalho' ? 'Trabalho' : 'Pessoal'}${t.projeto ? ' · ' + esc(t.projeto) : ''}</div></div></li>`).join('')}</ul>` : ''}
          <h2 class="mt" style="margin-bottom:0">Próximos 7 dias</h2>${proximos || vazio('calendar-days', 'Nada agendado para a próxima semana.')}
        </section>
      </div>`;
  },
  acoes: {
    novo() { Agenda.form(); },
    editar(d) { Agenda.form(db.eventos.find(e => e.id === d.id) || GAgenda.eventos.find(e => e.id === d.id)); },
    enviarGoogle() { GAgenda.enviarLocais(); },
    dia(d) { Agenda.sel = d.iso; Agenda.mes = d.iso.slice(0, 7); render(); },
    mesAnt() { Agenda.mes = somaMes(Agenda.mes, -1); render(); },
    mesProx() { Agenda.mes = somaMes(Agenda.mes, 1); render(); },
    irHoje() { Agenda.sel = hoje(); Agenda.mes = Agenda.sel.slice(0, 7); render(); },
  },
});
