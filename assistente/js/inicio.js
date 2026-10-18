'use strict';
// ============ Início: resumo do dia ============
registrar({
  id: 'inicio', nome: 'Início', icone: '🏠',
  render() {
    const h = hoje(), d = new Date(), hr = d.getHours();
    const saud = hr >= 5 && hr < 12 ? 'Bom dia' : hr >= 12 && hr < 18 ? 'Boa tarde' : 'Boa noite';
    const eventos = Agenda.eventosDoDia(h);
    const nAmanha = Agenda.eventosDoDia(somaDias(h, 1)).length;
    const pend = db.tarefas.filter(t => t.status !== 'feito');
    const urg = pend.filter(t => t.prazo && t.prazo <= somaDias(h, 2)).sort(Tarefas.ordenar);
    const semPrazo = pend.filter(t => !t.prazo && t.prioridade === 'alta');
    const r = Financas.resumo(chaveMes(d));
    const contas = Financas.aVencer(7);
    const tr = Treinos.deHoje();
    const alarmes = Alarmes.proximos(3);
    const agora = hhmm(agoraMin());
    const lembretes = Alarmes.lembretesDoDia(h).filter(l => l.hora >= agora).slice(0, 4);
    const notas = db.notas.filter(n => n.fixada);
    const pct = r.renda ? Math.min(100, r.total / r.renda * 100) : 0;

    const tarefaLi = t => `<li>
      <input type="checkbox" data-acao="concluir" data-id="${t.id}" title="Concluir">
      <span class="dot p-${t.prioridade || 'media'}"></span>
      <div class="info"><div class="nome">${esc(t.titulo)}</div>
        <div class="sub">${t.area === 'trabalho' ? '💼' : '✅'} ${Tarefas.prazoHTML(t)}${t.projeto ? ' · ' + esc(t.projeto) : ''}</div></div></li>`;

    return `<div class="ola"><h1>${saud}${db.config.nome ? ', ' + esc(db.config.nome) : ''} 👋</h1>
        <p>${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="atalhos">
        <button data-acao="trabalho:nova">💼 + Tarefa trabalho</button>
        <button data-acao="pessoal:nova">✅ + Tarefa pessoal</button>
        <button data-acao="agenda:novo">📅 + Evento</button>
        <button data-acao="financas:novoVar">💸 + Gasto</button>
        <button data-acao="alarmes:novo">⏰ + Alarme</button>
        ${App.instalar ? '<button class="primary" data-acao="geral:instalar">📲 Instalar app</button>' : ''}
      </div>
      <div class="painel">
        <section class="card"><h2>📅 Agenda de hoje<span class="sp"></span><a class="ver" href="#agenda">ver agenda →</a></h2>
          <ul class="lista">${eventos.map(e => Agenda.itemHTML(e)).join('') || '<div class="vazio">Dia livre na agenda.</div>'}</ul>
          ${nAmanha ? `<p class="muted" style="font-size:13px;margin:10px 0 0">Amanhã: ${nAmanha} evento(s)</p>` : ''}
        </section>

        <section class="card"><h2>✔️ Tarefas<span class="sp"></span><span class="chip">${pend.filter(t => t.area === 'trabalho').length} trabalho · ${pend.filter(t => t.area === 'pessoal').length} pessoais</span></h2>
          <ul class="lista">${[...urg, ...semPrazo].slice(0, 8).map(tarefaLi).join('') || '<div class="vazio">Nada urgente para os próximos dias.</div>'}</ul>
        </section>

        <section class="card"><h2>💰 Finanças · <span style="font-weight:400">${nomeMes(chaveMes(d))}</span><span class="sp"></span><a class="ver" href="#financas">abrir →</a></h2>
          <div class="muted" style="font-size:13px">Saldo previsto</div>
          <div class="grande ${r.saldo < 0 ? 'neg' : 'pos'}">${brl.format(r.saldo)}</div>
          ${r.renda ? `<div class="bar ${pct > 90 ? 'alerta' : ''}"><div style="width:${pct}%"></div></div>
            <div class="linha muted"><span>Gastos ${brl.format(r.total)}</span><span>Renda ${brl.format(r.renda)}</span></div>` : '<p class="muted" style="font-size:13px">Informe a renda do mês em Finanças.</p>'}
          ${contas.length ? `<div style="font-weight:600;margin-top:10px">A vencer (7 dias)</div>${contas.map(c => `<div class="linha">
            <span class="${c.data < h ? 'atrasado' : c.data === h ? 'ehoje' : ''}">${rotuloDia(c.data)} · ${esc(c.nome)}</span><b>${brl.format(c.valor)}</b></div>`).join('')}` : ''}
        </section>

        <section class="card"><h2>🏋️ Treino<span class="sp"></span><a class="ver" href="#treinos">abrir →</a></h2>
          ${tr.andamento ? `<p>🔥 <b>${esc(tr.modelo?.nome || 'Treino')}</b> em andamento.</p><a class="btn primary" href="#treinos">Continuar</a>`
            : tr.feito ? '<p>✅ Treino de hoje concluído!</p>'
            : tr.modelo ? `<p>Hoje: <b>${esc(tr.modelo.nome)}</b> (${tr.modelo.exercicios.length} exercícios)</p>
                <button class="primary" data-acao="treinos:iniciar" data-id="${tr.modelo.id}">▶ Iniciar treino</button>`
            : '<p class="muted">Descanso hoje.</p>'}
        </section>

        <section class="card"><h2>⏰ Próximos alertas<span class="sp"></span><a class="ver" href="#alarmes">alarmes →</a></h2>
          ${[...lembretes.map(l => ({ q: 'Hoje ' + l.hora, t: l.titulo + ' — ' + l.texto })),
             ...alarmes.map(x => ({ q: rotuloDia(x.o.iso) + ' ' + x.o.hora, t: '⏰ ' + (x.a.rotulo || 'Alarme') }))]
            .map(x => `<div class="linha"><span>${esc(x.t)}</span><b style="white-space:nowrap">${x.q}</b></div>`).join('')
            || '<div class="vazio">Nenhum alarme ou lembrete programado.</div>'}
        </section>

        ${notas.length ? `<section class="card"><h2>📌 Notas fixadas<span class="sp"></span><a class="ver" href="#geral">notas →</a></h2>
          <div class="notas">${notas.map(n => `<div class="nota"><div class="t"><span>${esc(n.titulo || '')}</span></div><div class="tx">${esc(n.texto)}</div></div>`).join('')}</div>
        </section>` : ''}
      </div>`;
  },
  acoes: {
    concluir(d) { Tarefas.concluir(db.tarefas.find(t => t.id === d.id)); ok('Tarefa concluída ✔'); },
  },
});
