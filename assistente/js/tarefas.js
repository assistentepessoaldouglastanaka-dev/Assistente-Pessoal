'use strict';
// ============ Tarefas do trabalho, tarefas pessoais e wishlist ============
const PRIORIDADES = [['alta', '🔴 Alta'], ['media', '🟡 Média'], ['baixa', '🟢 Baixa']];
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
    return `<span class="prazo ${cls}">📅 ${rotuloDia(t.prazo)}</span>`;
  },
  concluir(t, feito = true) {
    t.status = feito ? 'feito' : 'afazer';
    t.concluida = feito ? hoje() : null;
  },
  form(area, t, valores) {
    const projetos = [...new Set(db.tarefas.map(x => x.projeto).filter(Boolean))];
    const campos = [
      { nome: 'titulo', rotulo: 'Tarefa', obrigatorio: true, largo: true },
      { nome: 'prazo', rotulo: 'Prazo', tipo: 'date' },
      { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', opcoes: PRIORIDADES, padrao: 'media' },
    ];
    if (area === 'trabalho') campos.push(
      { nome: 'projeto', rotulo: 'Projeto / cliente', sugestoes: projetos },
      { nome: 'status', rotulo: 'Status', tipo: 'select', opcoes: [['afazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feito', 'Concluído']], padrao: 'afazer' });
    campos.push({ nome: 'notas', rotulo: 'Notas', tipo: 'textarea', largo: true, linhas: 3 });
    crud({
      lista: db.tarefas, item: t, campos, titulos: ['Nova tarefa', 'Editar tarefa'], valores: t ? null : valores,
      preparar: (v, item) => {
        if (!item) { v.area = area; v.status = v.status || 'afazer'; }
        v.concluida = v.status === 'feito' ? (item?.concluida || hoje()) : null;
      },
    });
  },
};

// ---------- Trabalho ----------
const COLUNAS = [['afazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feito', 'Concluído']];

registrar({
  id: 'trabalho', nome: 'Trabalho', icone: '💼',
  render() {
    const todas = Tarefas.da('trabalho');
    const projetos = [...new Set(todas.map(t => t.projeto).filter(Boolean))].sort();
    const lista = Tarefas.filtro ? todas.filter(t => t.projeto === Tarefas.filtro) : todas;
    const col = (st, titulo) => {
      let ts = lista.filter(t => t.status === st);
      ts = st === 'feito' ? ts.sort((a, b) => (b.concluida || '').localeCompare(a.concluida || '')).slice(0, 15) : ts.sort(Tarefas.ordenar);
      const idx = COLUNAS.findIndex(c => c[0] === st);
      return `<div class="col"><h2>${titulo} <span class="chip">${lista.filter(t => t.status === st).length}</span><span class="sp"></span>
        ${st === 'afazer' ? '<button class="mini" data-acao="nova">+ Nova</button>' : ''}
        ${st === 'feito' && ts.length ? '<button class="mini" data-acao="limpar">Limpar</button>' : ''}</h2>
        ${ts.map(t => `<div class="tcard ${t.status === 'feito' ? 'feito' : ''}">
          <div class="t"><span class="dot p-${t.prioridade || 'media'}"></span><span>${esc(t.titulo)}</span></div>
          <div class="meta">${t.projeto ? `<span class="chip">${esc(t.projeto)}</span>` : ''}${Tarefas.prazoHTML(t)}</div>
          ${t.notas ? `<div class="notas">${esc(t.notas)}</div>` : ''}
          <div class="acoes">
            ${idx > 0 ? `<button class="icon" data-acao="mover" data-id="${t.id}" data-dir="-1" title="Voltar">◀</button>` : ''}
            ${idx < 2 ? `<button class="icon" data-acao="mover" data-id="${t.id}" data-dir="1" title="Avançar">▶</button>` : ''}
            <button class="icon" data-acao="editar" data-id="${t.id}" title="Editar">✎</button>
          </div></div>`).join('') || '<div class="vazio">Nada aqui.</div>'}
      </div>`;
    };
    return `<div class="topo"><h1>💼 Tarefas do trabalho</h1>
        ${projetos.length ? `<select data-muda="filtrar"><option value="">Todos os projetos</option>${projetos.map(p =>
          `<option${p === Tarefas.filtro ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
        <button class="primary" data-acao="nova">+ Nova tarefa</button></div>
      <div class="kanban">${COLUNAS.map(([st, t]) => col(st, t)).join('')}</div>`;
  },
  acoes: {
    nova() { Tarefas.form('trabalho', null, Tarefas.filtro ? { projeto: Tarefas.filtro } : {}); },
    editar(d) { Tarefas.form('trabalho', db.tarefas.find(t => t.id === d.id)); },
    filtrar(d, el) { Tarefas.filtro = el.value; render(); },
    mover(d) {
      const t = db.tarefas.find(x => x.id === d.id);
      const i = COLUNAS.findIndex(c => c[0] === t.status) + Number(d.dir);
      t.status = COLUNAS[i][0];
      t.concluida = t.status === 'feito' ? hoje() : null;
      ok(t.status === 'feito' ? 'Tarefa concluída ✔' : '');
    },
    limpar() {
      if (!confirm('Remover todas as tarefas concluídas do trabalho?')) return;
      db.tarefas = db.tarefas.filter(t => !(t.area === 'trabalho' && t.status === 'feito'));
      ok('Concluídas removidas');
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
      <input type="checkbox" data-acao="alternar" data-id="${t.id}"${t.status === 'feito' ? ' checked' : ''} title="Concluir">
      <span class="dot p-${t.prioridade || 'media'}"></span>
      <div class="info"><div class="nome">${esc(t.titulo)}</div>
        <div class="sub">${Tarefas.prazoHTML(t)}${t.notas ? ' ' + esc(t.notas) : ''}</div></div>
      <button class="icon" data-acao="editar" data-id="${t.id}" title="Editar">✎</button></li>`;

    const wl = [...db.wishlist].sort((a, b) => (a.comprado - b.comprado) || (RANK_PRIO[a.prioridade] ?? 1) - (RANK_PRIO[b.prioridade] ?? 1));
    const totalWl = soma(db.wishlist.filter(w => !w.comprado), 'preco');
    return `<div class="topo"><h1>✅ Pessoal</h1></div>
    <div class="grid2">
      <section class="card"><h2>Tarefas pessoais <span class="chip">${pend.length}</span><span class="sp"></span>
        <button class="primary mini" data-acao="nova">+ Nova</button></h2>
        <ul class="lista">${pend.map(item).join('') || '<div class="vazio">Nenhuma tarefa pendente 🎉</div>'}</ul>
        ${feitas.length ? `<details><summary>Concluídas (${feitas.length})</summary><ul class="lista">${feitas.slice(0, 30).map(item).join('')}</ul>
          <button class="mini" data-acao="limpar">Limpar concluídas</button></details>` : ''}
      </section>
      <section class="card"><h2>🎁 Wishlist<span class="sp"></span><button class="primary mini" data-acao="novoDesejo">+ Item</button></h2>
        <ul class="lista">${wl.map(w => `<li class="${w.comprado ? 'feito' : ''}">
          <input type="checkbox" data-acao="comprar" data-id="${w.id}"${w.comprado ? ' checked' : ''} title="Comprado">
          <span class="dot p-${w.prioridade || 'media'}"></span>
          <div class="info"><div class="nome">${w.link ? `<a href="${esc(urlSegura(w.link))}" target="_blank" rel="noopener">${esc(w.nome)}</a>` : esc(w.nome)}</div>
            ${w.notas ? `<div class="sub">${esc(w.notas)}</div>` : ''}</div>
          ${w.preco ? `<span class="valor">${brl.format(w.preco)}</span>` : ''}
          <button class="icon" data-acao="editarDesejo" data-id="${w.id}" title="Editar">✎</button></li>`).join('')
          || '<div class="vazio">Adicione coisas que você quer comprar ou fazer.</div>'}</ul>
        ${totalWl ? `<div class="total"><span>Total pendente</span><span>${brl.format(totalWl)}</span></div>` : ''}
      </section>
    </div>`;
  },
  acoes: {
    nova() { Tarefas.form('pessoal'); },
    editar(d) { Tarefas.form('pessoal', db.tarefas.find(t => t.id === d.id)); },
    alternar(d, el) { Tarefas.concluir(db.tarefas.find(t => t.id === d.id), el.checked); ok(); },
    limpar() { db.tarefas = db.tarefas.filter(t => !(t.area === 'pessoal' && t.status === 'feito')); ok('Concluídas removidas'); },
    novoDesejo() { this.formDesejo(); },
    editarDesejo(d) { this.formDesejo(db.wishlist.find(w => w.id === d.id)); },
    formDesejo(w) {
      crud({
        lista: db.wishlist, item: w, titulos: ['Novo item da wishlist', 'Editar item'],
        campos: [
          { nome: 'nome', rotulo: 'O que', obrigatorio: true, largo: true },
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
      if (w.comprado && w.preco && confirm(`Lançar ${brl.format(w.preco)} de "${w.nome}" como gasto em Finanças?`)) {
        db.financas.variaveis.push({ id: uid(), nome: w.nome, valor: w.preco, categoria: 'Compras', data: hoje() });
        aviso('Gasto lançado em Finanças');
      }
      ok();
    },
  },
});
