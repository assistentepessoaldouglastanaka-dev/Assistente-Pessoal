'use strict';
// ============ Controle de gastos (compatível com controle-de-gastos.html) ============
// fixos: { id, nome, valor, categoria, dia, inicio: 'AAAA-MM', fim: 'AAAA-MM'|null, pagos: { 'AAAA-MM': true } }
// variaveis: { id, nome, valor, categoria, data: 'AAAA-MM-DD' }
// dividas: { id, nome, tipo, parcela, total, antes, dia, saldo, inicio, pagos, amortizacoes: [{ data, valor }] }
// renda: { 'AAAA-MM': number }
const CATEGORIAS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Contas', 'Assinaturas', 'Compras', 'Outros'];
const TIPOS_DIVIDA = ['Carro', 'Apartamento', 'Empréstimo', 'Cartão', 'Financiamento', 'Outro'];

const Financas = {
  mes: chaveMes(new Date()),
  fixosDoMes(mes) {
    return db.financas.fixos.filter(f => f.inicio <= mes && (!f.fim || f.fim >= mes)).sort((a, b) => (a.dia || 99) - (b.dia || 99));
  },
  varsDoMes(mes) {
    return db.financas.variaveis.filter(v => v.data.slice(0, 7) === mes).sort((a, b) => b.data.localeCompare(a.data));
  },
  parcelasPagas(d) { return Object.keys(d.pagos || {}).length; },
  restante(d) {
    if (!d.saldo) return null;
    return Math.max(0, d.saldo - this.parcelasPagas(d) * d.parcela - soma(d.amortizacoes || [], 'valor'));
  },
  numParcela(d, mes) { return (d.antes || 0) + mesesEntre(d.inicio, mes) + 1; },
  dividasDoMes(mes) {
    return db.financas.dividas.filter(d => {
      const i = mesesEntre(d.inicio, mes);
      if (i < 0) return false;
      if (d.pagos?.[mes]) return true;
      const r = this.restante(d);
      return i < (d.total || 0) - (d.antes || 0) && (r === null || r > 0);
    }).sort((a, b) => (a.dia || 99) - (b.dia || 99));
  },
  resumo(mes) {
    const fixos = this.fixosDoMes(mes), vars = this.varsDoMes(mes), divs = this.dividasDoMes(mes);
    const tf = soma(fixos, 'valor'), tv = soma(vars, 'valor'), td = soma(divs, 'parcela');
    const renda = db.financas.renda[mes] || 0;
    const pago = soma(fixos.filter(f => f.pagos?.[mes]), 'valor') + soma(divs.filter(d => d.pagos?.[mes]), 'parcela');
    return { fixos, vars, divs, tf, tv, td, renda, pago, total: tf + tv + td, saldo: renda - tf - tv - td };
  },
  // Contas fixas e parcelas ainda não pagas que vencem nos próximos `dias` (inclui atrasadas do mês atual)
  aVencer(dias) {
    const h = hoje(), lim = somaDias(h, dias), m0 = h.slice(0, 7), out = [];
    for (const mes of [m0, somaMes(m0, 1)]) {
      for (const f of this.fixosDoMes(mes)) if (f.dia && !f.pagos?.[mes]) out.push({ nome: f.nome, valor: f.valor, data: diaNoMes(mes, f.dia) });
      for (const d of this.dividasDoMes(mes)) if (d.dia && !d.pagos?.[mes]) out.push({ nome: d.nome, valor: d.parcela, data: diaNoMes(mes, d.dia) });
    }
    return out.filter(x => x.data <= lim && (x.data >= h || x.data.slice(0, 7) === m0)).sort((a, b) => a.data.localeCompare(b.data));
  },
  formVar(v, valores, aoSalvar) {
    crud({
      lista: db.financas.variaveis, item: v, titulos: ['Novo gasto', 'Editar gasto'], valores: v ? null : valores,
      campos: [
        { nome: 'nome', rotulo: 'Descrição', obrigatorio: true, dica: 'Ex.: Mercado' },
        { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', min: 0, obrigatorio: true },
        { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS, padrao: valores?.categoria },
        { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, padrao: valores?.data || hoje() },
      ],
      depois: g => { Financas.mes = g.data.slice(0, 7); aoSalvar?.(g); },
    });
  },
  formFixo(f) {
    crud({
      lista: db.financas.fixos, item: f, titulos: ['Novo gasto fixo', 'Editar gasto fixo'], podeExcluir: false,
      campos: [
        { nome: 'nome', rotulo: 'Descrição', obrigatorio: true, dica: 'Ex.: Aluguel' },
        { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', min: 0, obrigatorio: true },
        { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS },
        { nome: 'dia', rotulo: 'Dia do vencimento', tipo: 'number', min: 1, passo: 1 },
      ],
      preparar: (v, item) => { if (!item) Object.assign(v, { inicio: Financas.mes, fim: null, pagos: {} }); },
    });
  },
  formDivida(d) {
    crud({
      lista: db.financas.dividas, item: d, titulos: ['Nova dívida / financiamento', 'Editar dívida'],
      campos: [
        { nome: 'nome', rotulo: 'Descrição', obrigatorio: true, dica: 'Ex.: Financiamento carro' },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_DIVIDA },
        { nome: 'parcela', rotulo: 'Valor da parcela (R$)', tipo: 'number', min: 0, obrigatorio: true },
        { nome: 'dia', rotulo: 'Dia do vencimento', tipo: 'number', min: 1, passo: 1 },
        { nome: 'total', rotulo: 'Total de parcelas', tipo: 'number', min: 1, passo: 1, obrigatorio: true },
        { nome: 'antes', rotulo: 'Parcelas já pagas antes', tipo: 'number', min: 0, passo: 1, padrao: 0 },
        { nome: 'saldo', rotulo: 'Saldo devedor (R$)', tipo: 'number', min: 0, ajuda: 'Valor que falta pagar a partir do mês inicial' },
        { nome: 'inicio', rotulo: 'Mês inicial', tipo: 'month', obrigatorio: true, padrao: Financas.mes },
      ],
      preparar: (v, item) => {
        v.antes = v.antes || 0;
        if (!item) Object.assign(v, { pagos: {}, amortizacoes: [] });
      },
    });
  },
};

registrar({
  id: 'financas', nome: 'Finanças', icone: '💰',
  render() {
    const F = Financas, mes = F.mes, r = F.resumo(mes);
    const cats = {};
    [...r.fixos, ...r.vars].forEach(g => cats[g.categoria] = (cats[g.categoria] || 0) + g.valor);
    if (r.td) cats['Dívidas / parcelas'] = r.td;
    const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const pct = r.renda ? Math.min(100, r.total / r.renda * 100) : 0;

    return `<div class="topo"><h1>💰 Finanças</h1>
        <button data-acao="mesAnt" title="Mês anterior">◀</button>
        <strong style="min-width:150px;text-align:center">${nomeMes(mes)}</strong>
        <button data-acao="mesProx" title="Próximo mês">▶</button>
        <button data-acao="mesHoje">Hoje</button></div>

      <div class="tiles">
        <div class="card tile"><div class="lbl">Renda do mês</div>
          <input type="number" step="0.01" min="0" placeholder="0,00" value="${r.renda || ''}" data-muda="renda"></div>
        <div class="card tile"><div class="lbl">Gastos fixos</div><div class="val">${brl.format(r.tf)}</div></div>
        <div class="card tile"><div class="lbl">Gastos variáveis</div><div class="val">${brl.format(r.tv)}</div></div>
        <div class="card tile"><div class="lbl">Parcelas / dívidas</div><div class="val">${brl.format(r.td)}</div></div>
        <div class="card tile"><div class="lbl">Saldo</div><div class="val ${r.saldo < 0 ? 'neg' : 'pos'}">${brl.format(r.saldo)}</div>
          ${r.renda ? `<div class="bar ${pct > 90 ? 'alerta' : ''}"><div style="width:${pct}%"></div></div>` : ''}</div>
      </div>

      <div class="grid2">
        <section class="card"><h2><span class="dot" style="background:var(--roxo)"></span> Gastos fixos<span class="sp"></span>
          <button class="mini primary" data-acao="novoFixo">+ Fixo</button></h2>
          <ul class="lista">${r.fixos.map(f => {
            const pago = !!f.pagos?.[mes];
            return `<li class="${pago ? 'feito' : ''}">
              <input type="checkbox" data-acao="pagarFixo" data-id="${f.id}"${pago ? ' checked' : ''} title="Marcar como pago">
              <div class="info"><div class="nome">${esc(f.nome)}</div>
                <div class="sub">${esc(f.categoria)}${f.dia ? ' · vence dia ' + f.dia : ''}</div></div>
              <span class="valor">${brl.format(f.valor)}</span>
              <button class="icon" data-acao="editarFixo" data-id="${f.id}" title="Editar">✎</button>
              <button class="icon del" data-acao="removerFixo" data-id="${f.id}" title="Remover a partir deste mês">✕</button></li>`;
          }).join('') || '<div class="vazio">Nenhum gasto fixo. Os fixos se repetem todo mês automaticamente.</div>'}</ul>
          <div class="total"><span>Pago <span class="muted" style="font-weight:400">${brl.format(soma(r.fixos.filter(f => f.pagos?.[mes]), 'valor'))} de</span></span><span>${brl.format(r.tf)}</span></div>
        </section>

        <section class="card"><h2><span class="dot" style="background:var(--warn)"></span> Gastos variáveis<span class="sp"></span>
          <button class="mini primary" data-acao="novoVar">+ Gasto</button></h2>
          <ul class="lista">${r.vars.map(v => `<li>
              <div class="info"><div class="nome">${esc(v.nome)}</div>
                <div class="sub">${esc(v.categoria)} · ${fmtData(v.data)}</div></div>
              <span class="valor">${brl.format(v.valor)}</span>
              <button class="icon" data-acao="editarVar" data-id="${v.id}" title="Editar">✎</button></li>`).join('')
            || '<div class="vazio">Nenhum gasto variável neste mês.</div>'}</ul>
          <div class="total"><span>Total</span><span>${brl.format(r.tv)}</span></div>
        </section>

        <section class="card"><h2><span class="dot" style="background:var(--bad)"></span> Dívidas e financiamentos<span class="sp"></span>
          <button class="mini primary" data-acao="novaDivida">+ Dívida</button></h2>
          <ul class="lista">${r.divs.map(d => {
            const pago = !!d.pagos?.[mes];
            const rest = F.restante(d);
            return `<li class="${pago ? 'feito' : ''}">
              <input type="checkbox" data-acao="pagarDivida" data-id="${d.id}"${pago ? ' checked' : ''} title="Marcar parcela como paga">
              <div class="info"><div class="nome">${esc(d.nome)}</div>
                <div class="sub">${esc(d.tipo || '')} · parcela ${F.numParcela(d, mes)}/${d.total}${d.dia ? ' · dia ' + d.dia : ''}${rest !== null ? ' · falta ' + brl.format(rest) : ''}</div></div>
              <span class="valor">${brl.format(d.parcela)}</span>
              <button class="icon" data-acao="amortizar" data-id="${d.id}" title="Registrar amortização">💸</button>
              <button class="icon" data-acao="editarDivida" data-id="${d.id}" title="Editar">✎</button></li>`;
          }).join('') || '<div class="vazio">Nenhuma parcela neste mês.</div>'}</ul>
          <div class="total"><span>Total do mês</span><span>${brl.format(r.td)}</span></div>
        </section>

        <section class="card"><h2>Gastos por categoria</h2>
          ${catList.map(([c, v]) => `<div class="cat">
            <div class="top"><span>${esc(c)}</span><span>${brl.format(v)} <span class="muted">(${Math.round(v / r.total * 100)}%)</span></span></div>
            <div class="bar"><div style="width:${v / r.total * 100}%"></div></div></div>`).join('') || '<div class="vazio">Sem gastos neste mês.</div>'}
        </section>
      </div>`;
  },
  acoes: {
    mesAnt() { Financas.mes = somaMes(Financas.mes, -1); render(); },
    mesProx() { Financas.mes = somaMes(Financas.mes, 1); render(); },
    mesHoje() { Financas.mes = chaveMes(new Date()); render(); },
    renda(d, el) {
      const v = parseFloat(String(el.value).replace(',', '.'));
      if (v > 0) db.financas.renda[Financas.mes] = v; else delete db.financas.renda[Financas.mes];
      ok();
    },
    novoFixo() { Financas.formFixo(); },
    editarFixo(d) { Financas.formFixo(db.financas.fixos.find(f => f.id === d.id)); },
    pagarFixo(d, el) {
      const f = db.financas.fixos.find(x => x.id === d.id);
      f.pagos = f.pagos || {};
      if (el.checked) f.pagos[Financas.mes] = true; else delete f.pagos[Financas.mes];
      ok();
    },
    removerFixo(d) {
      const f = db.financas.fixos.find(x => x.id === d.id);
      const anterior = somaMes(Financas.mes, -1);
      if (!confirm(`Remover "${f.nome}" a partir deste mês? Os meses anteriores continuam com ele.`)) return;
      if (f.inicio > anterior) db.financas.fixos.splice(db.financas.fixos.indexOf(f), 1);
      else f.fim = anterior;
      ok('Gasto fixo removido');
    },
    novoVar() {
      const m = Financas.mes, h = hoje();
      Financas.formVar(null, { data: h.slice(0, 7) === m ? h : m + '-01' });
    },
    editarVar(d) { Financas.formVar(db.financas.variaveis.find(v => v.id === d.id)); },
    novaDivida() { Financas.formDivida(); },
    editarDivida(d) { Financas.formDivida(db.financas.dividas.find(x => x.id === d.id)); },
    pagarDivida(d, el) {
      const x = db.financas.dividas.find(y => y.id === d.id);
      x.pagos = x.pagos || {};
      if (el.checked) x.pagos[Financas.mes] = true; else delete x.pagos[Financas.mes];
      ok();
    },
    amortizar(d) {
      const x = db.financas.dividas.find(y => y.id === d.id);
      formulario({
        titulo: `Amortizar: ${x.nome}`, textoSalvar: 'Registrar',
        campos: [
          { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', min: 0, obrigatorio: true },
          { nome: 'data', rotulo: 'Data', tipo: 'date', padrao: hoje() },
        ],
        salvar: v => { (x.amortizacoes = x.amortizacoes || []).push(v); aviso('Amortização registrada'); },
      });
    },
  },
});
