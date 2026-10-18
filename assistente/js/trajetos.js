'use strict';
// ============ Trajetos e deslocamentos ============
const MODOS = [['carro', 'Carro'], ['transporte', 'Transporte público'], ['moto', 'Moto'], ['bike', 'Bicicleta'], ['ape', 'A pé']];
const ICONE_MODO = { carro: 'car', transporte: 'bus', moto: 'bike', bike: 'bike', ape: 'footprints' };
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

    const link = (href, rotulo) => `<a class="btn mini" href="${esc(href)}" target="_blank" rel="noopener">${rotulo}</a>`;

    return cabecalho('Trajetos', { sub: `Folga de ${db.config.folga || 0} min somada ao tempo de cada trajeto`, acoes: `
        <button data-acao="novoLocal">${ic('map-pin')}<span class="rotulo-opc">Novo local</span></button>
        <button class="primary" data-acao="novaRota">${ic('plus')}<span class="rotulo-opc">Novo trajeto</span></button>` })
      + `<div class="grid2">
        <div>
          <section class="card"><h2>${ic('car')} Hoje e amanhã</h2>
            ${desloc.length ? `<ul class="lista">${desloc.map(x => `<li>
              <div class="info"><div class="nome">${esc(x.ev.titulo)}</div>
                <div class="sub"><span>${rotuloDia(x.iso)} às ${x.ev.inicio}</span><span>${esc(x.r.nome)} · ${x.r.duracao} min</span></div></div>
              <div style="text-align:right"><div class="muted" style="font-size:12px">sair às</div><b class="ehoje" style="font-size:18px">${x.s}</b></div>
              <a class="btn icon" href="${T.linkMaps(x.r)}" target="_blank" rel="noopener" aria-label="Abrir rota no Maps" title="Abrir rota no Maps">${ic('navigation')}</a></li>`).join('')}</ul>`
              : vazio('car', 'Nenhum deslocamento previsto. Ao criar um evento, escolha um trajeto para ser avisado da hora de sair.')}
          </section>
          <section class="card mt"><h2>${ic('timer')} Que horas preciso sair?</h2>
            <div class="campos">
              <label class="campo"><span class="rot">Trajeto</span><select data-muda="calcRota"><option value="">Escolha...</option>${db.rotas.map(r =>
                `<option value="${r.id}"${r.id === c.rotaId ? ' selected' : ''}>${esc(r.nome)}</option>`).join('')}</select></label>
              <label class="campo"><span class="rot">Chegar às</span><input type="time" value="${c.chegada}" data-muda="calcHora"></label>
            </div>
            ${saidaCalc ? `<div class="aviso" style="margin:14px 0 0">${ic('clock')}<span>Saia às <b style="font-size:20px">${saidaCalc}</b></span>
              <span class="muted">${rc.duracao} min de trajeto + ${db.config.folga || 0} de folga</span></div>` : ''}
          </section>
        </div>

        <div>
          <section class="card"><h2>${ic('route')} Trajetos salvos</h2>
            ${db.rotas.length ? `<ul class="lista">${db.rotas.map(r => `<li>
              <span class="muted">${ic(ICONE_MODO[r.modo] || 'car')}</span>
              <div class="info" data-acao="editarRota" data-id="${r.id}" style="cursor:pointer"><div class="nome">${esc(r.nome)}</div>
                <div class="sub"><span>${esc(r.origem)} → ${esc(r.destino)}</span><span>~${r.duracao} min</span></div>
                ${r.notas ? `<div class="sub">${esc(r.notas)}</div>` : ''}</div>
              ${link(T.linkMaps(r), 'Maps')}${['carro', 'moto'].includes(r.modo) ? link(T.linkWaze(r), 'Waze') : ''}
              <div class="acoes-li">${bi('eventoRota', 'calendar', 'Criar evento com este trajeto', `data-id="${r.id}"`)}</div></li>`).join('')}</ul>`
              : vazio('route', 'Cadastre seus trajetos frequentes, como casa → trabalho ou academia.', `<button class="mini" data-acao="novaRota">${ic('plus', 'ic-sm')} Novo trajeto</button>`)}
          </section>
          <section class="card mt"><h2>${ic('map-pin')} Locais</h2>
            ${db.locais.length ? `<ul class="lista">${db.locais.map(l => `<li>
              <div class="info" data-acao="editarLocal" data-id="${l.id}" style="cursor:pointer"><div class="nome">${esc(l.nome)}</div><div class="sub">${esc(l.endereco || '')}</div></div>
              <a class="btn icon" href="${T.linkBusca(l.nome)}" target="_blank" rel="noopener" aria-label="Ver no mapa" title="Ver no mapa">${ic('map')}</a></li>`).join('')}</ul>`
              : vazio('map-pin', 'Salve endereços que você usa sempre.', `<button class="mini" data-acao="novoLocal">${ic('plus', 'ic-sm')} Novo local</button>`)}
          </section>
        </div>
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
