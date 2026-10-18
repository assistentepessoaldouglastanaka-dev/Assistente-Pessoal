'use strict';
// ============ Tarefas do trabalho, tarefas pessoais e wishlist ============
const PRIORIDADES = [['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']];
const RANK_PRIO = { alta: 0, media: 1, baixa: 2 };

const Tarefas = {
  filtro: '',
  da(area) { return db.tarefas.filter(t => t.area === area); },
  ordenar(a, b) {
    return (a.prazo || '9999').localeCompare(b.prazo || '9999') || (RANK_PRIO[a.prioridade] ?? 1) - (RANK_PRIO[b.prioridade] ?? 1);
  },
  prazoHTML(t) {
    if (!t.prazo) return '';
    const h = hoje();
    const cls = t.status === 'feito' ? '' : t.prazo < h ? 'atrasado' : t.prazo === h ? 'ehoje' : '';
    return `<span class="prazo ${cls}">${ic('calendar', 'ic-sm')}${rotuloDia(t.prazo)}</span>`;
  },
  concluir(t, feito = true) {
    t.status = feito ? 'feito' : 'afazer';
    t.concluida = feito ? hoje() : null;
  },
  // Trabalho | Pessoal no topo das duas telas
  segmentos(area) {
    const n = a => db.tarefas.filter(t => t.area === a && t.status !== 'feito').length;
    return `<div class="segmentos" role="tablist">
      <a href="#pessoal" role="tab" class="${area === 'pessoal' ? 'ativo' : ''}">${ic('list-checks', 'ic-sm')} Pessoal <span class="chip">${n('pessoal')}</span></a>
      <a href="#trabalho" role="tab" class="${area === 'trabalho' ? 'ativo' : ''}">${ic('briefcase', 'ic-sm')} Trabalho <span class="chip">${n('trabalho')}</span></a></div>`;
  },
  form(area, t, valores) {
    const projetos = [...new Set(db.tarefas.map(x => x.projeto).filter(Boolean))];
    const campos = [
      { nome: 'titulo', rotulo: 'Tarefa', obrigatorio: true, largo: true, dica: area === 'trabalho' ? 'Ex.: Enviar proposta' : 'Ex.: Marcar dentista' },
      { nome: 'prazo', rotulo: 'Prazo', tipo: 'date' },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', opcoes: PRIORIDADES, padrao: 'media' },
    ];
    if (area === 'trabalho') campos.push(
      { nome: 'projeto', rotulo: 'Projeto / cliente', sugestoes: projetos },
      { nome: 'status', rotulo: 'Status', tipo: 'select', opcoes: [['afazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feito', 'Concluído']], padrao: 'afazer' });
    campos.push({ nome: 'notas', rotulo: 'Notas', tipo: 'textarea', largo: true, linhas: 3 });
    crud({
      lista: db.tarefas, item: t, campos, titulos: [area === 'trabalho' ? 'Nova tarefa do trabalho' : 'Nova tarefa pessoal', 'Editar tarefa'],
      valores: t ? null : valores,
      preparar: (v, item) => {
        if (!item) { v.area = area; v.status = v.status || 'afazer'; }
        v.concluida = v.status === 'feito' ? (item?.concluida || hoje()) : null;
      },
    });
  },
  // Conclui com opção de desfazer
  concluirComDesfazer(t, feito) {
    const antes = { status: t.status, concluida: t.concluida };
    Tarefas.concluir(t, feito);
    ok();
    if (feito) aviso('Tarefa concluída', { texto: 'Desfazer', fn: () => { Object.assign(t, antes); ok(); } });
  },
};

// ---------- Trabalho ----------
const COLUNAS = [['afazer', 'A fazer', 'circle'], ['fazendo', 'Fazendo', 'timer'], ['feito', 'Concluído', 'circle-check']];

registrar({
  id: 'trabalho', nome: 'Trabalho', icone: '💼',
  render() {
    const todas = Tarefas.da('trabalho');
    const projetos = [...new Set(todas.map(t => t.projeto).filter(Boolean))].sort();
    if (Tarefas.filtro && !projetos.includes(Tarefas.filtro)) Tarefas.filtro = '';
    const lista = Tarefas.filtro ? todas.filter(t => t.projeto === Tarefas.filtro) : todas;
    const cartao = (t, idx) => `<div class="tcard ${t.status === 'feito' ? 'feito' : ''}">
      <div class="t"><span class="dot p-${t.prioridade || 'media'}" title="Prioridade ${t.prioridade || 'media'}"></span><span>${esc(t.titulo)}</span></div>
      ${t.projeto || t.prazo ? `<div class="meta">${t.projeto ? `<span class="chip">${esc(t.projeto)}</span>` : ''}${Tarefas.prazoHTML(t)}</div>` : ''}
      ${t.notas ? `<div class="notas">${esc(t.notas)}</div>` : ''}
      <div class="acoes">
        ${idx > 0 ? bi('mover', 'chevron-left', 'Voltar para ' + COLUNAS[idx - 1][1], `data-id="${t.id}" data-dir="-1"`) : ''}
        ${bi('editar', 'pencil', 'Editar', `data-id="${t.id}"`)}
        ${idx < 2 ? bi('mover', idx === 1 ? 'check' : 'chevron-right', 'Mover para ' + COLUNAS[idx + 1][1], `data-id="${t.id}" data-dir="1"`) : ''}
      </div></div>`;
    const col = ([st, titulo, icone], idx) => {
      let ts = lista.filter(t => t.status === st);
      const total = ts.length;
      ts = st === 'feito' ? ts.sort((a, b) => (b.concluida || '').localeCompare(a.concluida || '')).slice(0, 15) : ts.sort(Tarefas.ordenar);
      const corpo = ts.map(t => cartao(t, idx)).join('') || `<div class="vazio">${st === 'afazer' ? 'Nenhuma tarefa. Use o botão + para criar.' : 'Nada aqui.'}</div>`;
      if (st === 'feito') return `<div class="col"><details${total && total <= 3 ? ' open' : ''}><summary style="padding:2px 4px 6px">
          <h2 style="margin:0;flex:1">${ic(icone)} ${titulo} <span class="chip">${total}</span></h2>${ic('chevron-down')}</summary>
          ${corpo}${total ? `<button class="mini fantasma mt" data-acao="limpar">${ic('trash-2', 'ic-sm')} Limpar concluídas</button>` : ''}</details></div>`;
      return `<div class="col"><h2>${ic(icone)} ${titulo} <span class="chip">${total}</span></h2>${corpo}</div>`;
    };
    return cabecalho('Tarefas', {
        acoes: `${projetos.length ? `<select data-muda="filtrar" aria-label="Filtrar por projeto"><option value="">Todos os projetos</option>${projetos.map(p =>
          `<option${p === Tarefas.filtro ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
          <button class="primary" data-acao="nova">${ic('plus')}<span class="rotulo-opc">Nova tarefa</span></button>` })
      + `<div style="margin:-6px 0 16px">${Tarefas.segmentos('trabalho')}</div>
      <div class="kanban">${COLUNAS.map(col).join('')}</div>`;
  },
  acoes: {
    nova() { Tarefas.form('trabalho', null, Tarefas.filtro ? { projeto: Tarefas.filtro } : {}); },
    editar(d) { Tarefas.form('trabalho', db.tarefas.find(t => t.id === d.id)); },
    filtrar(d, el) { Tarefas.filtro = el.value; render(); },
    mover(d) {
      const t = db.tarefas.find(x => x.id === d.id);
      const antes = { status: t.status, concluida: t.concluida };
      const i = COLUNAS.findIndex(c => c[0] === t.status) + Number(d.dir);
      t.status = COLUNAS[i][0];
      t.concluida = t.status === 'feito' ? hoje() : null;
      ok();
      if (t.status === 'feito') aviso('Tarefa concluída', { texto: 'Desfazer', fn: () => { Object.assign(t, antes); ok(); } });
    },
    async limpar() {
      const n = db.tarefas.filter(t => t.area === 'trabalho' && t.status === 'feito').length;
      if (!await confirmar(`Remover ${n} tarefa(s) concluída(s) do trabalho?`, { titulo: 'Limpar concluídas', ok: 'Remover', perigo: true })) return;
      const antes = [...db.tarefas];
      db.tarefas = db.tarefas.filter(t => !(t.area === 'trabalho' && t.status === 'feito'));
      ok();
      aviso('Concluídas removidas', { texto: 'Desfazer', fn: () => { db.tarefas = antes; ok(); } });
    },
  },
});

// ---------- Pessoal + wishlist ----------
registrar({
  id: 'pessoal', nome: 'Pessoal', icone: '✅',
  render() {
    const ts = Tarefas.da('pessoal');
    const pend = ts.filter(t => t.status !== 'feito').sort(Tarefas.ordenar);
    const feitas = ts.filter(t => t.status === 'feito').sort((a, b) => (b.concluida || '').localeCompare(a.concluida || ''));
    const item = t => `<li class="${t.status === 'feito' ? 'feito' : ''}">
      <input type="checkbox" data-acao="alternar" data-id="${t.id}"${t.status === 'feito' ? ' checked' : ''} aria-label="Concluir: ${esc(t.titulo)}">
      <div class="info clicavel" data-acao="editar" data-id="${t.id}"><div class="nome">${esc(t.titulo)}</div>
        <div class="sub"><span class="dot p-${t.prioridade || 'media'}"></span>${Tarefas.prazoHTML(t)}${t.notas ? `<span>${esc(t.notas.split('\n')[0])}</span>` : ''}</div></div>
      <div class="acoes-li">${bi('editar', 'pencil', 'Editar', `data-id="${t.id}"`, 'so-desktop')}</div></li>`;

    const wl = [...db.wishlist].sort((a, b) => (a.comprado - b.comprado) || (RANK_PRIO[a.prioridade] ?? 1) - (RANK_PRIO[b.prioridade] ?? 1));
    const totalWl = soma(db.wishlist.filter(w => !w.comprado), 'preco');
    return cabecalho('Tarefas', { acoes: `<button class="primary" data-acao="nova">${ic('plus')}<span class="rotulo-opc">Nova tarefa</span></button>` })
      + `<div style="margin:-6px 0 16px">${Tarefas.segmentos('pessoal')}</div>
    <div class="grid2">
      <section class="card"><h2>${ic('list-checks')} Pessoais <span class="chip">${pend.length}</span></h2>
        ${pend.length ? `<ul class="lista">${pend.map(item).join('')}</ul>`
          : vazio('circle-check', 'Nenhuma tarefa pendente.', `<button class="mini" data-acao="nova">${ic('plus', 'ic-sm')} Nova tarefa</button>`)}
        ${feitas.length ? `<details><summary>${ic('chevron-down', 'ic-sm')} Concluídas (${feitas.length})</summary><ul class="lista">${feitas.slice(0, 30).map(item).join('')}</ul>
          <button class="mini fantasma" data-acao="limpar">${ic('trash-2', 'ic-sm')} Limpar concluídas</button></details>` : ''}
      </section>
      <section class="card"><h2>${ic('gift')} Wishlist<span class="sp"></span>${bi('novoDesejo', 'plus', 'Novo desejo')}</h2>
        ${wl.length ? `<ul class="lista">${wl.map(w => `<li class="${w.comprado ? 'feito' : ''}">
          <input type="checkbox" data-acao="comprar" data-id="${w.id}"${w.comprado ? ' checked' : ''} aria-label="Comprado: ${esc(w.nome)}">
          <div class="info clicavel" data-acao="editarDesejo" data-id="${w.id}"><div class="nome">${esc(w.nome)}</div>
            <div class="sub"><span class="dot p-${w.prioridade || 'media'}"></span>${w.notas ? `<span>${esc(w.notas)}</span>` : ''}
              ${w.link ? `<a href="${esc(urlSegura(w.link))}" target="_blank" rel="noopener">${ic('external-link', 'ic-sm')} link</a>` : ''}</div></div>
          ${w.preco ? `<span class="valor">${brl.format(w.preco)}</span>` : ''}
          <div class="acoes-li">${bi('editarDesejo', 'pencil', 'Editar', `data-id="${w.id}"`, 'so-desktop')}</div></li>`).join('')}</ul>`
          : vazio('gift', 'Anote aqui o que você quer comprar ou fazer.', `<button class="mini" data-acao="novoDesejo">${ic('plus', 'ic-sm')} Adicionar desejo</button>`)}
        ${totalWl ? `<div class="total"><span>Total pendente</span><span>${brl.format(totalWl)}</span></div>` : ''}
      </section>
    </div>`;
  },
  acoes: {
    nova() { Tarefas.form('pessoal'); },
    editar(d) { Tarefas.form('pessoal', db.tarefas.find(t => t.id === d.id)); },
    alternar(d, el) { Tarefas.concluirComDesfazer(db.tarefas.find(t => t.id === d.id), el.checked); },
    limpar() {
      const antes = [...db.tarefas];
      db.tarefas = db.tarefas.filter(t => !(t.area === 'pessoal' && t.status === 'feito'));
      ok();
      aviso('Concluídas removidas', { texto: 'Desfazer', fn: () => { db.tarefas = antes; ok(); } });
    },
    novoDesejo() { this.formDesejo(); },
    editarDesejo(d) { this.formDesejo(db.wishlist.find(w => w.id === d.id)); },
    formDesejo(w) {
      crud({
        lista: db.wishlist, item: w, titulos: ['Novo desejo', 'Editar desejo'],
        campos: [
          { nome: 'nome', rotulo: 'O que', obrigatorio: true, largo: true, dica: 'Ex.: Fone bluetooth' },
          { nome: 'preco', rotulo: 'Preço (R$)', tipo: 'number', min: 0 },
          { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', opcoes: PRIORIDADES, padrao: 'media' },
          { nome: 'link', rotulo: 'Link', tipo: 'url', largo: true, dica: 'https://...' },
          { nome: 'notas', rotulo: 'Notas', tipo: 'textarea', largo: true, linhas: 2 },
        ],
        preparar: (v, item) => { if (!item) v.comprado = false; },
      });
    },
    comprar(d, el) {
      const w = db.wishlist.find(x => x.id === d.id);
      w.comprado = el.checked;
      ok();
      if (w.comprado && w.preco) aviso('Marcado como comprado', { texto: 'Lançar gasto', fn: () => {
        db.financas.variaveis.push({ id: uid(), nome: w.nome, valor: w.preco, categoria: 'Compras', data: hoje() });
        ok('Gasto lançado em Finanças');
      } });
    },
  },
});
