'use strict';
// ============ Treinos da academia ============
const Treinos = {
  // "Supino reto 4x10 60kg" -> { nome, series, reps, carga }
  parse(txt) {
    return txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^(.*?)\s+(\d+)\s*[xX×]\s*([\d\-–/]+s?)(?:\s+([\d.,]+)\s*(?:kg)?)?\s*$/);
      return m ? { nome: m[1], series: +m[2], reps: m[3], carga: m[4] ? parseFloat(m[4].replace(',', '.')) : null }
        : { nome: l, series: null, reps: '', carga: null };
    });
  },
  texto(e) { return e.nome + (e.series ? ` ${e.series}x${e.reps}` : '') + (e.carga != null ? ` ${e.carga}kg` : ''); },
  resumoEx(e) { return (e.series ? `${e.series}×${e.reps}` : '') + (e.carga != null ? ` · ${e.carga} kg` : ''); },
  modelo(id) { return db.treinos.modelos.find(m => m.id === id); },
  deHoje() {
    const t = db.treinos;
    if (t.atual) return { andamento: true, modelo: this.modelo(t.atual.modeloId) };
    return { modelo: this.modelo(t.semana[new Date().getDay()]), feito: t.sessoes.some(s => s.data === hoje()) };
  },
  ultimaCarga(nome) {
    const ss = db.treinos.sessoes;
    for (let i = ss.length - 1; i >= 0; i--) {
      const x = ss[i].itens.find(e => e.nome === nome && e.carga != null);
      if (x) return x.carga;
    }
    return null;
  },
  iniciar(modeloId) {
    const m = this.modelo(modeloId);
    db.treinos.atual = {
      data: hoje(), modeloId, inicio: Date.now(),
      itens: m.exercicios.map(e => ({ ...e, carga: this.ultimaCarga(e.nome) ?? e.carga, ok: false })),
    };
  },
  formModelo(m) {
    crud({
      lista: db.treinos.modelos, item: m, titulos: ['Novo treino', 'Editar treino'],
      valores: m && { ...m, exercicios: m.exercicios.map(e => this.texto(e)).join('\n') },
      campos: [
        { nome: 'nome', rotulo: 'Nome do treino', obrigatorio: true, largo: true, dica: 'Ex.: Treino A — Peito e tríceps' },
        { nome: 'exercicios', rotulo: 'Exercícios (um por linha)', tipo: 'textarea', largo: true, linhas: 9, obrigatorio: true,
          dica: 'Supino reto 4x10 60kg\nCrucifixo 3x12 14kg\nTríceps corda 3x12 25kg\nPrancha 3x40s',
          ajuda: 'Formato: nome séries x repetições carga. A carga é atualizada sozinha conforme você registra os treinos.' },
      ],
      preparar: v => { v.exercicios = Treinos.parse(v.exercicios); },
    });
  },
};

registrar({
  id: 'treinos', nome: 'Treinos', icone: '🏋️',
  render() {
    const T = db.treinos, h = hoje(), dow = new Date().getDay();
    const hojeT = Treinos.deHoje();
    let cardHoje;
    if (T.atual) {
      const m = Treinos.modelo(T.atual.modeloId);
      const feitos = T.atual.itens.filter(i => i.ok).length, total = T.atual.itens.length;
      const min = Math.round((Date.now() - T.atual.inicio) / 60000);
      cardHoje = `<section class="card" style="border-color:var(--accent)"><h2>${ic('flame')} ${esc(m?.nome || 'Treino')}<span class="sp"></span>
          <span class="chip azul">${ic('timer', 'ic-sm')} ${min} min</span></h2>
        <div class="bar" style="margin:0 0 6px"><div style="width:${total ? feitos / total * 100 : 0}%;background:var(--ok)"></div></div>
        <div class="muted" style="font-size:13px;margin-bottom:6px">${feitos} de ${total} exercícios</div>
        <ul class="lista">${T.atual.itens.map((e, i) => `<li class="${e.ok ? 'feito' : ''}">
          <input type="checkbox" data-acao="marcar" data-i="${i}"${e.ok ? ' checked' : ''} aria-label="Feito: ${esc(e.nome)}">
          <div class="info"><div class="nome">${esc(e.nome)}</div><div class="sub">${e.series ? `${e.series} × ${esc(e.reps)}` : ''}</div></div>
          <label style="display:flex;align-items:center;gap:6px" class="muted"><input class="carga" type="number" step="0.5" min="0" inputmode="decimal" placeholder="—"
            value="${e.carga ?? ''}" data-muda="carga" data-i="${i}" aria-label="Carga de ${esc(e.nome)} em kg"> kg</label>
        </li>`).join('')}</ul>
        <div style="display:flex;gap:8px;margin-top:14px"><button class="primary" data-acao="concluir">${ic('check')} Concluir treino</button>
          <button class="fantasma" data-acao="descartar">Descartar</button></div></section>`;
    } else {
      const m = hojeT.modelo;
      cardHoje = `<section class="card"><h2>${ic('calendar')} Hoje · ${DIAS_SEMANA_LONGO[dow]}</h2>
        ${hojeT.feito ? `<div class="aviso" style="background:var(--ok-soft)">${ic('circle-check')} Treino de hoje concluído. Bom trabalho!</div>` : ''}
        ${m ? `<p style="margin-top:0">Planejado: <b>${esc(m.nome)}</b></p><ol class="exs">${m.exercicios.map(e => `<li>${esc(e.nome)} <span class="muted">${Treinos.resumoEx(e)}</span></li>`).join('')}</ol>
              <button class="primary mt" data-acao="iniciar" data-id="${m.id}">${ic('play')} Iniciar treino</button>`
          : T.modelos.length ? vazio('coffee', 'Dia de descanso pelo seu planejamento. Quer treinar mesmo assim?',
              `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">${T.modelos.map(x =>
                `<button class="mini" data-acao="iniciar" data-id="${x.id}">${ic('play', 'ic-sm')} ${esc(x.nome)}</button>`).join('')}</div>`)
          : vazio('dumbbell', 'Cadastre seus treinos (A, B, C...) para começar.', `<button class="mini" data-acao="novo">${ic('plus', 'ic-sm')} Novo treino</button>`)}
      </section>`;
    }

    const semanaIni = somaDias(h, -dow), mesAtual = h.slice(0, 7);
    const naSemana = T.sessoes.filter(s => s.data >= semanaIni).length;
    const noMes = T.sessoes.filter(s => s.data.startsWith(mesAtual)).length;
    const hist = [...T.sessoes].reverse().slice(0, 12);

    return cabecalho('Treinos', { acoes: `<button class="primary" data-acao="novo">${ic('plus')}<span class="rotulo-opc">Novo treino</span></button>` })
      + `<div class="grid2">
        <div>${cardHoje}
          <section class="card mt"><h2>${ic('calendar-days')} Planejamento semanal</h2>
            <div class="semana">${[1, 2, 3, 4, 5, 6, 0].map(i => `<label class="${i === dow ? 'hoje' : ''}"><span>${DIAS_SEMANA_LONGO[i]}</span>
              <select data-muda="semana" data-dia="${i}"><option value="">Descanso</option>${T.modelos.map(m =>
                `<option value="${m.id}"${T.semana[i] === m.id ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>`).join('')}</div>
          </section>
        </div>
        <div>
          <section class="card"><h2>${ic('dumbbell')} Meus treinos</h2>
            ${T.modelos.map(m => `<div class="tcard"><div class="t"><span>${esc(m.nome)}</span><span class="sp"></span>
                ${bi('iniciar', 'play', 'Iniciar', `data-id="${m.id}"`)}${bi('editar', 'pencil', 'Editar', `data-id="${m.id}"`)}</div>
              <ol class="exs">${m.exercicios.map(e => `<li>${esc(e.nome)} <span>${Treinos.resumoEx(e)}</span></li>`).join('')}</ol></div>`).join('')
              || vazio('dumbbell', 'Nenhum treino cadastrado.')}
          </section>
          <section class="card mt"><h2>${ic('activity')} Histórico</h2>
            <div class="stats"><div><b>${naSemana}</b><span class="muted">nesta semana</span></div><div><b>${noMes}</b><span class="muted">neste mês</span></div><div><b>${T.sessoes.length}</b><span class="muted">no total</span></div></div>
            ${hist.length ? `<ul class="lista">${hist.map(s => `<li><span class="muted">${ic('circle-check')}</span><div class="info"><div class="nome">${esc(s.nome)}</div>
              <div class="sub"><span>${rotuloDia(s.data)}</span><span>${s.itens.filter(i => i.ok).length}/${s.itens.length} exercícios</span>${s.duracao ? `<span>${s.duracao} min</span>` : ''}</div></div>
              <div class="acoes-li">${bi('apagarSessao', 'trash-2', 'Apagar registro', `data-id="${s.id}"`).replace('class="icon"', 'class="icon del"')}</div></li>`).join('')}</ul>`
              : vazio('activity', 'Seus treinos concluídos aparecem aqui.')}
          </section>
        </div>
      </div>`;
  },
  acoes: {
    novo() { Treinos.formModelo(); },
    editar(d) { Treinos.formModelo(Treinos.modelo(d.id)); },
    async iniciar(d) {
      if (db.treinos.atual && !await confirmar('Já existe um treino em andamento. Começar outro no lugar dele?', { titulo: 'Treino em andamento', ok: 'Começar novo' })) return;
      Treinos.iniciar(d.id); ir('treinos'); ok('Bom treino!');
    },
    marcar(d, el) { db.treinos.atual.itens[d.i].ok = el.checked; ok(); },
    carga(d, el) { db.treinos.atual.itens[d.i].carga = el.value === '' ? null : parseFloat(el.value); salvar(); },
    semana(d, el) { if (el.value) db.treinos.semana[d.dia] = el.value; else delete db.treinos.semana[d.dia]; ok(); },
    concluir() {
      const a = db.treinos.atual, m = Treinos.modelo(a.modeloId);
      db.treinos.sessoes.push({ id: uid(), data: a.data, modeloId: a.modeloId, nome: m?.nome || 'Treino',
        itens: a.itens, duracao: Math.round((Date.now() - a.inicio) / 60000) });
      // progressão: o modelo passa a sugerir a última carga usada
      if (m) for (const e of m.exercicios) { const x = a.itens.find(i => i.nome === e.nome); if (x && x.carga != null) e.carga = x.carga; }
      db.treinos.atual = null;
      ok('Treino registrado');
    },
    async descartar() {
      if (!await confirmar('O progresso deste treino será perdido.', { titulo: 'Descartar treino', ok: 'Descartar', perigo: true })) return;
      db.treinos.atual = null; ok();
    },
    apagarSessao(d) {
      const lista = db.treinos.sessoes, i = lista.findIndex(s => s.id === d.id), sessao = lista[i];
      lista.splice(i, 1); ok();
      aviso('Registro apagado', { texto: 'Desfazer', fn: () => { lista.splice(i, 0, sessao); ok(); } });
    },
  },
});
