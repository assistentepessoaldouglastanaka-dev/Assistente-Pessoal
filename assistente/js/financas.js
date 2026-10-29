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
        { nome: 'nome', rotulo: 'Descrição', obrigatorio: true, largo: true, dica: 'Ex.: Mercado' },
        { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', min: 0, obrigatorio: true },
        { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS, padrao: valores?.categoria || 'Alimentação' },
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
    const ehMesAtual = mes === chaveMes(new Date());
    const pagoFixos = soma(r.fixos.filter(f => f.pagos?.[mes]), 'valor');

    return cabecalho('Finanças', { acoes: `
        <div class="grupo-botoes" role="group" aria-label="Mês">
          <button data-acao="mesAnt" aria-label="Mês anterior">${ic('chevron-left')}</button>
          <button data-acao="mesHoje" style="min-width:150px" title="Voltar para o mês atual">${nomeMes(mes)}</button>
          <button data-acao="mesProx" aria-label="Próximo mês">${ic('chevron-right')}</button>
        </div>
        <button class="primary" data-acao="novoVar">${ic('plus')}<span class="rotulo-opc">Novo gasto</span></button>` })
      + `<div class="tiles">
        <div class="card tile destaque"><div class="lbl">${ic('wallet', 'ic-sm')} Saldo ${ehMesAtual ? 'previsto' : 'do mês'}</div>
          <div class="val">${brl.format(r.saldo)}</div>
          ${r.renda ? `<div class="bar"><div style="width:${pct}%"></div></div><small>${Math.round(pct)}% da renda comprometida</small>` : '<small>Informe a renda do mês ao lado</small>'}</div>
        <label class="card tile"><span class="lbl">${ic('banknote', 'ic-sm')} Renda do mês</span>
          <input type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${r.renda || ''}" data-muda="renda" aria-label="Renda do mês"></label>
        <div class="card tile"><div class="lbl">${ic('repeat', 'ic-sm')} Fixos</div><div class="val">${brl.format(r.tf)}</div></div>
        <div class="card tile"><div class="lbl">${ic('shopping-bag', 'ic-sm')} Variáveis</div><div class="val">${brl.format(r.tv)}</div></div>
        <div class="card tile"><div class="lbl">${ic('landmark', 'ic-sm')} Parcelas</div><div class="val">${brl.format(r.td)}</div></div>
        ${ehMesAtual && Mercado.previsaoMensal() ? (() => {
          const prev = Mercado.previsaoMensal(), gasto = Mercado.gastoAlimentacao(mes), falta = Math.max(0, prev - gasto);
          return `<a class="card tile" href="#mercado"><div class="lbl">${ic('shopping-cart', 'ic-sm')} Mercado previsto</div><div class="val">${brl.format(prev)}</div>
            <small>${brl.format(gasto)} já gasto · saldo após mercado ${brl.format(r.saldo - falta)}</small></a>`;
        })() : ''}
      </div>

      <div class="grid2">
        <section class="card"><h2>${ic('repeat')} Gastos fixos<span class="sp"></span>${bi('novoFixo', 'plus', 'Novo gasto fixo')}</h2>
          ${r.fixos.length ? `<ul class="lista">${r.fixos.map(f => {
            const pago = !!f.pagos?.[mes];
            return `<li class="${pago ? 'feito' : ''}">
              <input type="checkbox" data-acao="pagarFixo" data-id="${f.id}"${pago ? ' checked' : ''} aria-label="Pago: ${esc(f.nome)}">
              <div class="info clicavel" data-acao="editarFixo" data-id="${f.id}"><div class="nome">${esc(f.nome)}</div>
                <div class="sub"><span>${esc(f.categoria)}</span>${f.dia ? `<span>vence dia ${f.dia}</span>` : ''}</div></div>
              <span class="valor">${brl.format(f.valor)}</span>
              <div class="acoes-li">${bi('editarFixo', 'pencil', 'Editar', `data-id="${f.id}"`, 'so-desktop')}${bi('removerFixo', 'trash-2', 'Remover a partir deste mês', `data-id="${f.id}"`).replace('class="icon"', 'class="icon del"')}</div></li>`;
          }).join('')}</ul>
          <div class="total"><span>Pago <span class="muted" style="font-weight:400">${brl.format(pagoFixos)} de</span></span><span>${brl.format(r.tf)}</span></div>`
          : vazio('repeat', 'Aluguel, contas, assinaturas... Os fixos se repetem todo mês sozinhos.', `<button class="mini" data-acao="novoFixo">${ic('plus', 'ic-sm')} Novo gasto fixo</button>`)}
        </section>

        <section class="card"><h2>${ic('shopping-bag')} Gastos variáveis<span class="sp"></span>${bi('novoVar', 'plus', 'Novo gasto')}</h2>
          ${r.vars.length ? `<ul class="lista">${r.vars.map(v => `<li>
              <div class="info clicavel" data-acao="editarVar" data-id="${v.id}"><div class="nome">${esc(v.nome)}</div>
                <div class="sub"><span>${esc(v.categoria)}</span><span>${rotuloDia(v.data)}</span></div></div>
              <span class="valor">${brl.format(v.valor)}</span>
              <div class="acoes-li">${bi('editarVar', 'pencil', 'Editar', `data-id="${v.id}"`, 'so-desktop')}</div></li>`).join('')}</ul>
          <div class="total"><span>Total</span><span>${brl.format(r.tv)}</span></div>`
          : vazio('shopping-bag', 'Nenhum gasto variável neste mês.', `<button class="mini" data-acao="novoVar">${ic('plus', 'ic-sm')} Lançar gasto</button>`)}
        </section>

        <section class="card"><h2>${ic('landmark')} Dívidas e financiamentos<span class="sp"></span>${bi('novaDivida', 'plus', 'Nova dívida')}</h2>
          ${r.divs.length ? `<ul class="lista">${r.divs.map(d => {
            const pago = !!d.pagos?.[mes];
            const rest = F.restante(d);
            const n = F.numParcela(d, mes);
            return `<li class="${pago ? 'feito' : ''}">
              <input type="checkbox" data-acao="pagarDivida" data-id="${d.id}"${pago ? ' checked' : ''} aria-label="Parcela paga: ${esc(d.nome)}">
              <div class="info clicavel" data-acao="editarDivida" data-id="${d.id}"><div class="nome">${esc(d.nome)}</div>
                <div class="sub"><span>Parcela ${n}/${d.total}</span>${d.dia ? `<span>dia ${d.dia}</span>` : ''}${rest !== null ? `<span>falta ${brl.format(rest)}</span>` : ''}</div>
                <div class="bar" style="height:5px"><div style="width:${Math.min(100, (n - (pago ? 0 : 1)) / d.total * 100)}%;background:var(--ok)"></div></div></div>
              <span class="valor">${brl.format(d.parcela)}</span>
              <div class="acoes-li">${bi('amortizar', 'piggy-bank', 'Registrar amortização', `data-id="${d.id}"`)}${bi('editarDivida', 'pencil', 'Editar', `data-id="${d.id}"`, 'so-desktop')}</div></li>`;
          }).join('')}</ul>
          <div class="total"><span>Total do mês</span><span>${brl.format(r.td)}</span></div>`
          : vazio('landmark', 'Nenhuma parcela neste mês.')}
        </section>

        <section class="card"><h2>${ic('activity')} Para onde foi o dinheiro</h2>
          ${catList.map(([c, v]) => `<div class="cat">
            <div class="top"><span>${esc(c)}</span><span>${brl.format(v)} <span class="muted">· ${Math.round(v / r.total * 100)}%</span></span></div>
            <div class="bar"><div style="width:${v / r.total * 100}%"></div></div></div>`).join('') || vazio('activity', 'Sem gastos neste mês.')}
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
    async removerFixo(d) {
      const f = db.financas.fixos.find(x => x.id === d.id);
      const anterior = somaMes(Financas.mes, -1);
      if (!await confirmar(`"${f.nome}" deixa de aparecer a partir de ${nomeMes(Financas.mes).toLowerCase()}. Os meses anteriores continuam com ele.`,
        { titulo: 'Remover gasto fixo', ok: 'Remover', perigo: true })) return;
      const lista = db.financas.fixos, i = lista.indexOf(f), fimAntes = f.fim;
      if (f.inicio > anterior) lista.splice(i, 1); else f.fim = anterior;
      ok();
      aviso('Gasto fixo removido', { texto: 'Desfazer', fn: () => { if (!lista.includes(f)) lista.splice(i, 0, f); f.fim = fimAntes; ok(); } });
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
