'use strict';
// ============ Trajetos e deslocamentos ============
const MODOS = [['carro', '🚗 Carro'], ['transporte', '🚌 Transporte público'], ['moto', '🏍️ Moto'], ['bike', '🚲 Bicicleta'], ['ape', '🚶 A pé']];
const MODO_MAPS = { carro: 'driving', moto: 'driving', transporte: 'transit', bike: 'bicycling', ape: 'walking' };

const Trajetos = {
  calc: { rotaId: '', chegada: '' },
  endereco(txt) {
    const l = db.locais.find(x => x.nome.toLowerCase() === String(txt || '').toLowerCase());
    return l ? (l.endereco || l.nome) : txt;
  },
  linkMaps(r) {
    return 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(this.endereco(r.origem)) +
      '&destination=' + encodeURIComponent(this.endereco(r.destino)) + '&travelmode=' + (MODO_MAPS[r.modo] || 'driving');
  },
  linkWaze(r) { return 'https://waze.com/ul?navigate=yes&q=' + encodeURIComponent(this.endereco(r.destino)); },
  linkBusca(q) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(this.endereco(q)); },
  modo(r) { return (MODOS.find(m => m[0] === r.modo) || MODOS[0])[1]; },
  formRota(r) {
    const nomes = db.locais.map(l => l.nome);
    crud({
      lista: db.rotas, item: r, titulos: ['Novo trajeto', 'Editar trajeto'],
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true, largo: true, dica: 'Ex.: Casa → Trabalho' },
        { nome: 'origem', rotulo: 'Origem', obrigatorio: true, sugestoes: nomes, dica: 'Local salvo ou endereço' },
        { nome: 'destino', rotulo: 'Destino', obrigatorio: true, sugestoes: nomes, dica: 'Local salvo ou endereço' },
        { nome: 'modo', rotulo: 'Como vai', tipo: 'select', opcoes: MODOS },
        { nome: 'duracao', rotulo: 'Tempo estimado (min)', tipo: 'number', min: 1, passo: 1, obrigatorio: true },
        { nome: 'notas', rotulo: 'Observações', tipo: 'textarea', largo: true, linhas: 2, dica: 'Ex.: evitar marginal no horário de pico' },
      ],
    });
  },
  formLocal(l) {
    crud({
      lista: db.locais, item: l, titulos: ['Novo local', 'Editar local'],
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true, dica: 'Ex.: Casa, Trabalho, Academia' },
        { nome: 'endereco', rotulo: 'Endereço', largo: true, dica: 'Rua, número, cidade' },
      ],
    });
  },
};

registrar({
  id: 'trajetos', nome: 'Trajetos', icone: '🚗',
  render() {
    const T = Trajetos, h = hoje();
    const desloc = [];
    for (const iso of [h, somaDias(h, 1)]) for (const ev of Agenda.eventosDoDia(iso)) {
      const s = Agenda.horaSaida(ev);
      if (s) desloc.push({ iso, ev, s, r: Agenda.rota(ev) });
    }
    const c = T.calc, rc = db.rotas.find(r => r.id === c.rotaId);
    const saidaCalc = rc && c.chegada ? hhmm(minutos(c.chegada) - rc.duracao - (db.config.folga || 0)) : null;

    return `<div class="topo"><h1>🚗 Trajetos</h1>
        <button data-acao="novoLocal">+ Local</button><button class="primary" data-acao="novaRota">+ Trajeto</button></div>
      <div class="grid2">
        <section class="card"><h2>Deslocamentos de hoje e amanhã</h2>
          <ul class="lista">${desloc.map(x => `<li>
            <div class="info"><div class="nome">${esc(x.ev.titulo)}</div>
              <div class="sub">${rotuloDia(x.iso)} às ${x.ev.inicio} · ${esc(x.r.nome)} (${x.r.duracao} min + ${db.config.folga || 0} de folga)</div></div>
            <span class="valor">sair ${x.s}</span>
            <a class="btn mini" href="${T.linkMaps(x.r)}" target="_blank" rel="noopener">Maps</a></li>`).join('')
            || '<div class="vazio">Nenhum evento com trajeto. Ao criar um evento na Agenda, escolha um trajeto para receber o aviso de "hora de sair".</div>'}</ul>
          <h2 class="mt">⏱️ Que horas preciso sair?</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select data-muda="calcRota"><option value="">Escolha o trajeto</option>${db.rotas.map(r =>
              `<option value="${r.id}"${r.id === c.rotaId ? ' selected' : ''}>${esc(r.nome)}</option>`).join('')}</select>
            <span>chegar às</span><input type="time" value="${c.chegada}" data-muda="calcHora">
          </div>
          ${saidaCalc ? `<p style="margin:10px 0 0">Saia às <b class="grande" style="font-size:22px">${saidaCalc}</b>
            <span class="muted">(${rc.duracao} min de trajeto + ${db.config.folga || 0} min de folga)</span></p>` : ''}
        </section>

        <section class="card"><h2>Trajetos salvos</h2>
          <ul class="lista">${db.rotas.map(r => `<li>
            <div class="info"><div class="nome">${esc(r.nome)}</div>
              <div class="sub">${esc(r.origem)} → ${esc(r.destino)} · ${T.modo(r)} · ~${r.duracao} min${r.notas ? '<br>' + esc(r.notas) : ''}</div></div>
            <a class="btn mini" href="${T.linkMaps(r)}" target="_blank" rel="noopener">Maps</a>
            ${['carro', 'moto'].includes(r.modo) ? `<a class="btn mini" href="${T.linkWaze(r)}" target="_blank" rel="noopener">Waze</a>` : ''}
            <button class="icon" data-acao="eventoRota" data-id="${r.id}" title="Criar evento com este trajeto">📅</button>
            <button class="icon" data-acao="editarRota" data-id="${r.id}" title="Editar">✎</button></li>`).join('')
            || '<div class="vazio">Cadastre seus trajetos frequentes (casa → trabalho, academia...).</div>'}</ul>
          <h2 class="mt">📍 Locais</h2>
          <ul class="lista">${db.locais.map(l => `<li>
            <div class="info"><div class="nome">${esc(l.nome)}</div><div class="sub">${esc(l.endereco || '')}</div></div>
            <a class="btn mini" href="${T.linkBusca(l.nome)}" target="_blank" rel="noopener">Mapa</a>
            <button class="icon" data-acao="editarLocal" data-id="${l.id}" title="Editar">✎</button></li>`).join('')
            || '<div class="vazio">Salve endereços que você usa sempre.</div>'}</ul>
        </section>
      </div>`;
  },
  acoes: {
    novaRota() { Trajetos.formRota(); },
    editarRota(d) { Trajetos.formRota(db.rotas.find(r => r.id === d.id)); },
    novoLocal() { Trajetos.formLocal(); },
    editarLocal(d) { Trajetos.formLocal(db.locais.find(l => l.id === d.id)); },
    eventoRota(d) {
      const r = db.rotas.find(x => x.id === d.id);
      Agenda.form(null, { rotaId: r.id, local: r.destino, data: hoje() });
    },
    calcRota(d, el) { Trajetos.calc.rotaId = el.value; render(); },
    calcHora(d, el) { Trajetos.calc.chegada = el.value; render(); },
  },
});
