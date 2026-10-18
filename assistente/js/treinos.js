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
      const feitos = T.atual.itens.filter(i => i.ok).length;
      const min = Math.round((Date.now() - T.atual.inicio) / 60000);
      cardHoje = `<section class="card"><h2>🔥 ${esc(m?.nome || 'Treino')}<span class="sp"></span><span class="chip">${feitos}/${T.atual.itens.length} · ${min} min</span></h2>
        <ul class="lista">${T.atual.itens.map((e, i) => `<li class="${e.ok ? 'feito' : ''}">
          <input type="checkbox" data-acao="marcar" data-i="${i}"${e.ok ? ' checked' : ''}>
          <div class="info"><div class="nome">${esc(e.nome)}</div><div class="sub">${e.series ? `${e.series} × ${esc(e.reps)}` : ''}</div></div>
          <input class="carga" type="number" step="0.5" min="0" inputmode="decimal" placeholder="kg" value="${e.carga ?? ''}" data-muda="carga" data-i="${i}"> kg
        </li>`).join('')}</ul>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="primary" data-acao="concluir">✔ Concluir treino</button>
          <button data-acao="descartar">Descartar</button></div></section>`;
    } else {
      const m = hojeT.modelo;
      cardHoje = `<section class="card"><h2>Hoje · ${DIAS_SEMANA_LONGO[dow]}</h2>
        ${hojeT.feito ? '<p>✅ Treino de hoje concluído. Bom trabalho!</p>' : ''}
        ${m ? `<p>Planejado: <b>${esc(m.nome)}</b></p><ol class="exs">${m.exercicios.map(e => `<li>${esc(e.nome)} <span class="muted">${Treinos.resumoEx(e)}</span></li>`).join('')}</ol>
              <button class="primary mt" data-acao="iniciar" data-id="${m.id}">▶ Iniciar treino</button>`
          : `<p class="muted">${T.modelos.length ? 'Dia de descanso pelo planejamento.' : 'Cadastre seus treinos para começar.'}</p>`}
        ${T.modelos.length && !m ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${T.modelos.map(x =>
          `<button class="mini" data-acao="iniciar" data-id="${x.id}">▶ ${esc(x.nome)}</button>`).join('')}</div>` : ''}
      </section>`;
    }

    const semanaIni = somaDias(h, -dow), mesAtual = h.slice(0, 7);
    const naSemana = T.sessoes.filter(s => s.data >= semanaIni).length;
    const noMes = T.sessoes.filter(s => s.data.startsWith(mesAtual)).length;
    const hist = [...T.sessoes].reverse().slice(0, 12);

    return `<div class="topo"><h1>🏋️ Treinos</h1><button class="primary" data-acao="novo">+ Novo treino</button></div>
      <div class="grid2">
        <div>${cardHoje}
          <section class="card mt"><h2>Planejamento semanal</h2>
            <div class="semana">${[1, 2, 3, 4, 5, 6, 0].map(i => `<label class="${i === dow ? 'hoje' : ''}"><span>${DIAS_SEMANA_LONGO[i]}</span>
              <select data-muda="semana" data-dia="${i}"><option value="">😴 Descanso</option>${T.modelos.map(m =>
                `<option value="${m.id}"${T.semana[i] === m.id ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>`).join('')}</div>
          </section>
        </div>
        <div>
          <section class="card"><h2>Meus treinos</h2>
            ${T.modelos.map(m => `<div class="tcard"><div class="t"><span>${esc(m.nome)}</span><span class="sp"></span>
                <button class="icon" data-acao="iniciar" data-id="${m.id}" title="Iniciar">▶</button>
                <button class="icon" data-acao="editar" data-id="${m.id}" title="Editar">✎</button></div>
              <ol class="exs">${m.exercicios.map(e => `<li>${esc(e.nome)} <span>${Treinos.resumoEx(e)}</span></li>`).join('')}</ol></div>`).join('')
              || '<div class="vazio">Nenhum treino cadastrado. Crie, por exemplo, Treino A, B e C.</div>'}
          </section>
          <section class="card mt"><h2>Histórico</h2>
            <div class="stats"><div><b>${naSemana}</b><span class="muted">nesta semana</span></div><div><b>${noMes}</b><span class="muted">neste mês</span></div><div><b>${T.sessoes.length}</b><span class="muted">no total</span></div></div>
            <ul class="lista">${hist.map(s => `<li><div class="info"><div class="nome">${esc(s.nome)}</div>
              <div class="sub">${rotuloDia(s.data)} · ${s.itens.filter(i => i.ok).length}/${s.itens.length} exercícios${s.duracao ? ' · ' + s.duracao + ' min' : ''}</div></div>
              <button class="icon del" data-acao="apagarSessao" data-id="${s.id}" title="Apagar registro">✕</button></li>`).join('')
              || '<div class="vazio">Seus treinos concluídos aparecem aqui.</div>'}</ul>
          </section>
        </div>
      </div>`;
  },
  acoes: {
    novo() { Treinos.formModelo(); },
    editar(d) { Treinos.formModelo(Treinos.modelo(d.id)); },
    iniciar(d) {
      if (db.treinos.atual && !confirm('Já existe um treino em andamento. Substituir?')) return;
      Treinos.iniciar(d.id); ir('treinos'); ok('Bom treino! 💪');
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
      ok('Treino registrado ✔');
    },
    descartar() { if (confirm('Descartar o treino em andamento?')) { db.treinos.atual = null; ok(); } },
    apagarSessao(d) {
      if (!confirm('Apagar este registro do histórico?')) return;
      db.treinos.sessoes = db.treinos.sessoes.filter(s => s.id !== d.id); ok();
    },
  },
});
