'use strict';
// ============ Lista de mercado ============
// Gerada do plano da nutricionista (quanto se come por semana) + itens avulsos. Cada item tem preço por kg/L/unidade,
// o que permite prever quanto a compra vai custar e quanto o mercado pesa no mês.
// item: { id, nome, quantidade, unidade: 'kg'|'L'|'un', setor, precoUnit, fonte: 'ia'|'manual'|'compra', comprado, origem: 'plano'|'manual' }
// db.mercado: { dias, precos: { chave: { valor, unidade, fonte, data } }, historico: [{ data, total, estimado, itens }] }
const SETORES = [
  ['Hortifrúti', /banana|maca|mamao|laranja|limao|morango|uva|abacate|melao|melancia|pera|kiwi|manga|abacaxi|fruta|alface|tomate|cenoura|cebola|alho|batata|abobora|abobrinha|brocolis|couve|espinafre|rucula|pepino|pimentao|beterraba|chuchu|berinjela|legume|verdura|salada|mandioca|inhame|vagem/],
  ['Carnes e ovos', /frango|carne|patinho|alcatra|file|peixe|tilapia|salmao|atum|sardinha|ovo|porco|lombo|peru|presunto|acem|musculo|camarao/],
  ['Frios e laticínios', /leite|iogurte|queijo|requeijao|manteiga|ricota|cottage|kefir|nata|creme de leite/],
  ['Padaria', /pao|torrada|bisnaguinha|tapioca|wrap|rap10/],
  ['Mercearia', /arroz|feijao|aveia|granola|macarrao|massa|farinha|azeite|oleo|acucar|cafe|cha|mel|castanha|amendoim|pasta de|chia|linhaca|quinoa|lentilha|grao|milho|ervilha|biscoito|cereal|whey|cacau|chocolate|sal|tempero|molho|vinagre|gelatina/],
  ['Bebidas', /suco|refrigerante|agua de coco|bebida|cha gelado/],
  ['Limpeza e casa', /detergente|sabao|amaciante|desinfetante|papel|esponja|saco de lixo|alcool|limpador/],
];

const Mercado = {
  estimando: false,
  chave: nome => semAcentoM(nome).toLowerCase().replace(/\s+/g, ' ').trim(),
  setorDe(nome) { const n = this.chave(nome); return (SETORES.find(([, re]) => re.test(n)) || ['Outros'])[0]; },
  dias() { return db.mercado.dias || 7; },

  // Quantidade do plano (g/ml/un por vez) → unidade de compra (kg/L/un)
  base(q, u) {
    if (u === 'g') return { q: q / 1000, u: 'kg' };
    if (u === 'ml') return { q: q / 1000, u: 'L' };
    return { q, u: 'un' };
  },
  fmtQtd(q, u) {
    if (q == null) return '';
    const n = (v, c) => v.toLocaleString('pt-BR', { maximumFractionDigits: c });
    if (u === 'kg') return q < 1 ? `${n(Math.round(q * 1000 / 10) * 10, 0)} g` : `${n(q, 2)} kg`;
    if (u === 'L') return q < 1 ? `${n(Math.round(q * 1000 / 10) * 10, 0)} ml` : `${n(q, 2)} L`;
    return `${n(Math.ceil(q), 0)} un`;
  },
  // valor da linha: unidades sempre arredondadas para cima (não se compra meio ovo)
  valor(i) {
    if (!i.precoUnit || !i.quantidade) return 0;
    return (i.unidade === 'un' ? Math.ceil(i.quantidade) : i.quantidade) * i.precoUnit;
  },
  totais() {
    const ls = db.compras;
    const semPreco = ls.filter(i => !i.precoUnit).length;
    return { total: ls.reduce((s, i) => s + this.valor(i), 0), marcados: ls.filter(i => i.comprado).reduce((s, i) => s + this.valor(i), 0), semPreco };
  },
  // Previsão do mês: a lista cobre `dias` dias; avulsos contam uma vez por lista
  previsaoMensal() { const { total } = this.totais(); return total ? total * 30 / this.dias() : 0; },
  gastoAlimentacao(mes) { return soma(Financas.varsDoMes(mes).filter(v => v.categoria === 'Alimentação'), 'valor'); },

  plano() { return db.planos.find(p => p.ativo) || db.planos[db.planos.length - 1] || null; },

  // Soma o que o plano pede para o período e atualiza a lista (mantém avulsos, marcações e preços)
  gerarDoPlano() {
    const p = this.plano();
    if (!p) return aviso('Importe o plano da nutricionista primeiro (Nutrição).');
    const dias = this.dias(), soma_ = {};
    for (const r of p.refeicoes || []) for (const it of r.itens || []) {
      if (!it.alimento || !it.quantidade) continue;
      const b = this.base(Number(it.quantidade), it.unidade);
      const k = this.chave(it.alimento);
      const vezes = Math.min(7, Math.max(0, Number(it.vezesSemana ?? 7)));
      soma_[k] ||= { nome: it.alimento, q: 0, u: b.u };
      if (soma_[k].u === b.u) soma_[k].q += b.q * vezes * dias / 7;
    }
    const antigos = Object.fromEntries(db.compras.filter(i => i.origem === 'plano').map(i => [this.chave(i.nome), i]));
    db.compras = db.compras.filter(i => i.origem !== 'plano');
    for (const [k, x] of Object.entries(soma_)) {
      const velho = antigos[k], memo = db.mercado.precos[k];
      db.compras.push({
        id: velho?.id || uid(), nome: x.nome, quantidade: +x.q.toFixed(3), unidade: x.u, setor: velho?.setor || this.setorDe(x.nome),
        precoUnit: velho?.precoUnit ?? (memo?.unidade === x.u ? memo.valor : null), fonte: velho?.fonte || memo?.fonte || null,
        comprado: velho?.comprado || false, origem: 'plano',
      });
    }
    ok(`Lista gerada para ${dias === 7 ? '1 semana' : dias === 14 ? '2 semanas' : '1 mês'}: ${Object.keys(soma_).length} itens do plano`);
  },

  async estimarPrecos(todos) {
    if (!Sync.usuario) return aviso('Entre com sua conta Google primeiro (Notas e ajustes).');
    const alvo = db.compras.filter(i => todos || !i.precoUnit);
    if (!alvo.length) return aviso('Todos os itens já têm preço. Toque num item para mudar.');
    this.estimando = true; render();
    try {
      const { data, error } = await Sync.sb.functions.invoke('jarvis', { body: { modo: 'precos', itens: alvo.map(i => ({ nome: i.nome, unidade: i.unidade })) } });
      if (error) throw new Error(await motivoErro(error));
      let n = 0;
      for (const p of data.precos || []) {
        const i = alvo.find(x => this.chave(x.nome) === this.chave(p.nome));
        if (!i || (i.fonte === 'compra' && !todos)) continue;
        i.precoUnit = p.preco; i.fonte = 'ia'; n++;
      }
      salvar();
      aviso(n ? `${n} preços estimados · confira e ajuste com os preços reais` : 'A IA não devolveu preços agora. Tente de novo.');
    } catch (e) { aviso(e.message); }
    this.estimando = false; render();
  },

  form(i) {
    crud({
      lista: db.compras, item: i, titulos: ['Novo item', 'Editar item'],
      campos: [
        { nome: 'nome', rotulo: 'Item', obrigatorio: true, largo: true, dica: 'Ex.: Café, Detergente' },
        { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'number', min: 0, padrao: 1 },
        { nome: 'unidade', rotulo: 'Unidade', tipo: 'select', opcoes: [['un', 'unidade'], ['kg', 'kg'], ['L', 'litro']], padrao: 'un' },
        { nome: 'precoUnit', rotulo: 'Preço por unidade/kg/L (R$)', tipo: 'number', min: 0 },
        { nome: 'setor', rotulo: 'Setor', tipo: 'select', opcoes: [['', 'Automático'], ...SETORES.map(s => s[0]), 'Outros'] },
      ],
      preparar: (v, item) => {
        if (!item) Object.assign(v, { origem: 'manual', comprado: false });
        if (!v.setor) v.setor = this.setorDe(v.nome);
        if (v.precoUnit != null && v.precoUnit !== item?.precoUnit) {
          v.fonte = 'manual';
          db.mercado.precos[this.chave(v.nome)] = { valor: v.precoUnit, unidade: v.unidade, fonte: 'manual', data: hoje() };
        }
      },
    });
  },

  // Fecha a compra: lança o gasto em Finanças e aprende os preços reais
  finalizar() {
    const marcados = db.compras.filter(i => i.comprado);
    if (!marcados.length) return aviso('Marque os itens que você comprou.');
    const estimado = marcados.reduce((s, i) => s + this.valor(i), 0);
    formulario({
      titulo: 'Finalizar compra', textoSalvar: 'Lançar gasto',
      valores: { valor: estimado ? +estimado.toFixed(2) : null, data: hoje(), nome: 'Mercado' },
      campos: [
        { nome: 'valor', rotulo: 'Total pago (R$)', tipo: 'number', min: 0, obrigatorio: true,
          ajuda: estimado ? `Previsto para os ${marcados.length} itens marcados: ${brl.format(estimado)}` : '' },
        { nome: 'nome', rotulo: 'Descrição', obrigatorio: true },
        { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true },
      ],
      salvar: v => {
        db.financas.variaveis.push({ id: uid(), nome: v.nome, valor: v.valor, categoria: 'Alimentação', data: v.data });
        // ajusta os preços dos itens comprados na proporção do que foi pago de verdade
        const fator = estimado ? v.valor / estimado : 1;
        for (const i of marcados) {
          if (i.precoUnit && fator > 0.3 && fator < 3) {
            i.precoUnit = +(i.precoUnit * fator).toFixed(2); i.fonte = 'compra';
            db.mercado.precos[this.chave(i.nome)] = { valor: i.precoUnit, unidade: i.unidade, fonte: 'compra', data: v.data };
          }
        }
        db.mercado.historico.push({ data: v.data, total: v.valor, estimado: +estimado.toFixed(2), itens: marcados.length });
        db.mercado.historico = db.mercado.historico.slice(-24);
        // itens do plano voltam para a próxima lista; avulsos comprados saem
        db.compras = db.compras.filter(i => !(i.comprado && i.origem === 'manual'));
        db.compras.forEach(i => { i.comprado = false; });
        ok(`Gasto de ${brl.format(v.valor)} lançado em Finanças (Alimentação)`);
      },
    });
  },
};

function semAcentoM(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
async function motivoErro(error) {
  let m = '';
  try { m = (await error.context.json()).erro; } catch (e) {}
  return { nao_configurado: 'A IA gratuita (Cloudflare) ainda não foi configurada no Supabase.', cota: 'Limite gratuito da IA atingido hoje. Tente amanhã.',
    nao_autenticado: 'Entre com sua conta Google primeiro.', nao_entendi: 'Não consegui entender o plano. Tente colar o texto.',
    sem_texto: 'O arquivo não tem texto legível. Se for foto ou PDF escaneado, copie o texto e cole.' }[m] || 'Não foi possível agora. Tente de novo.';
}

registrar({
  id: 'mercado', nome: 'Mercado', icone: '🛒',
  render() {
    const M = Mercado, t = M.totais(), p = M.plano(), mes = chaveMes(new Date());
    const ult = db.mercado.historico[db.mercado.historico.length - 1];
    const porSetor = {};
    for (const i of db.compras) (porSetor[i.setor || 'Outros'] ||= []).push(i);
    const ordem = [...SETORES.map(s => s[0]), 'Outros'].filter(s => porSetor[s]);
    const linha = i => `<li class="${i.comprado ? 'feito' : ''}">
      <input type="checkbox" data-acao="marcar" data-id="${i.id}"${i.comprado ? ' checked' : ''} aria-label="Comprado: ${esc(i.nome)}">
      <div class="info clicavel" data-acao="editar" data-id="${i.id}"><div class="nome">${esc(i.nome)}</div>
        <div class="sub"><span>${M.fmtQtd(i.quantidade, i.unidade)}</span>
          ${i.precoUnit ? `<span>${brl.format(i.precoUnit)}/${i.unidade}${i.fonte === 'ia' ? ' · estimado' : i.fonte === 'compra' ? ' · da última compra' : ''}</span>` : '<span>sem preço</span>'}
          ${i.origem === 'plano' ? '<span>plano</span>' : ''}</div></div>
      <span class="valor">${i.precoUnit ? brl.format(M.valor(i)) : '—'}</span>
      <div class="acoes-li">${bi('remover', 'trash-2', 'Remover', `data-id="${i.id}"`).replace('class="icon"', 'class="icon del"')}</div></li>`;

    return cabecalho('Mercado', {
        sub: p ? `Plano: ${esc(p.titulo || 'plano alimentar')}` : 'Importe o plano da nutri em Nutrição para montar a lista sozinha',
        acoes: `<button data-acao="estimar"${M.estimando ? ' disabled' : ''}>${ic(M.estimando ? 'refresh-cw' : 'sparkles')}<span class="rotulo-opc">${M.estimando ? 'Estimando...' : 'Estimar preços'}</span></button>
          <button class="primary" data-acao="novo">${ic('plus')}<span class="rotulo-opc">Item</span></button>` })
      + `<div class="tiles">
        <div class="card tile destaque"><div class="lbl">${ic('shopping-cart', 'ic-sm')} Esta compra</div><div class="val">${brl.format(t.total)}</div>
          <small>${db.compras.length} itens${t.semPreco ? ` · ${t.semPreco} sem preço` : ''}</small></div>
        <div class="card tile"><div class="lbl">${ic('calendar', 'ic-sm')} Previsão no mês</div><div class="val">${brl.format(M.previsaoMensal())}</div>
          <small>Já gasto com alimentação: ${brl.format(M.gastoAlimentacao(mes))}</small></div>
        <label class="card tile"><span class="lbl">${ic('repeat', 'ic-sm')} A lista cobre</span>
          <select data-muda="dias" aria-label="Período da lista">${[[7, '1 semana'], [14, '2 semanas'], [30, '1 mês']].map(([v, l]) =>
            `<option value="${v}"${M.dias() === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${ult ? `<div class="card tile"><div class="lbl">${ic('receipt', 'ic-sm')} Última compra</div><div class="val">${brl.format(ult.total)}</div>
          <small>${fmtData(ult.data)}${ult.estimado ? ` · previsto ${brl.format(ult.estimado)}` : ''}</small></div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px">
        ${p ? `<button class="mini" data-acao="gerar">${ic('refresh-cw', 'ic-sm')} ${db.compras.some(i => i.origem === 'plano') ? 'Atualizar' : 'Gerar'} lista do plano</button>` : `<a class="btn mini" href="#nutricao">${ic('salad', 'ic-sm')} Importar plano da nutri</a>`}
        ${db.compras.some(i => i.comprado) ? `<button class="mini primary" data-acao="finalizar">${ic('check', 'ic-sm')} Finalizar compra · ${brl.format(t.marcados)}</button>` : ''}
      </div>
      ${db.compras.length ? ordem.map(s => `<section class="card mt"><h2>${esc(s)}<span class="sp"></span>
          <span class="muted" style="font-size:13px;font-weight:500">${brl.format(porSetor[s].reduce((x, i) => x + M.valor(i), 0))}</span></h2>
          <ul class="lista">${porSetor[s].sort((a, b) => a.comprado - b.comprado || a.nome.localeCompare(b.nome)).map(linha).join('')}</ul></section>`).join('')
        : `<div class="card">${vazio('shopping-cart', 'A lista está vazia. Gere a partir do plano da nutricionista ou adicione itens avulsos.',
          `<button class="mini" data-acao="novo">${ic('plus', 'ic-sm')} Adicionar item</button>`)}</div>`}
      <p class="muted" style="font-size:12.5px;margin-top:12px">Preços "estimados" vêm da IA (média de mercado) e servem para prever. Ao finalizar a compra com o total pago, o app ajusta os preços pelos reais e lança o gasto em Finanças.</p>`;
  },
  acoes: {
    novo() { Mercado.form(); },
    editar(d) { Mercado.form(db.compras.find(i => i.id === d.id)); },
    marcar(d) { const i = db.compras.find(x => x.id === d.id); i.comprado = !i.comprado; ok(); },
    remover(d) {
      const i = db.compras.find(x => x.id === d.id), pos = db.compras.indexOf(i);
      db.compras.splice(pos, 1); ok();
      aviso(`${i.nome} removido`, { texto: 'Desfazer', fn: () => { db.compras.splice(pos, 0, i); ok(); } });
    },
    gerar() { Mercado.gerarDoPlano(); },
    estimar() { Mercado.estimarPrecos(false); },
    finalizar() { Mercado.finalizar(); },
    dias(d, el) { db.mercado.dias = Number(el.value); Mercado.plano() && db.compras.some(i => i.origem === 'plano') ? Mercado.gerarDoPlano() : ok(); },
  },
});
