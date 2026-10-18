'use strict';
// ============ Início: resumo do dia ============
const semEmoji = s => String(s).replace(/^\p{Extended_Pictographic}️?\s*/u, '');
const ICONE_LEMBRETE = { ev: 'calendar', sai: 'car', fx: 'receipt', dv: 'landmark', al: 'alarm-clock' };

registrar({
  id: 'inicio', nome: 'Início', icone: '🏠',
  render() {
    const h = hoje(), d = new Date(), hr = d.getHours();
    const saud = hr >= 5 && hr < 12 ? 'Bom dia' : hr >= 12 && hr < 18 ? 'Boa tarde' : 'Boa noite';
    const eventos = Agenda.eventosDoDia(h);
    const nAmanha = Agenda.eventosDoDia(somaDias(h, 1)).length;
    const pend = db.tarefas.filter(t => t.status !== 'feito');
    const atrasadas = pend.filter(t => t.prazo && t.prazo < h).length;
    const urg = pend.filter(t => t.prazo && t.prazo <= somaDias(h, 2)).sort(Tarefas.ordenar);
    const semPrazo = pend.filter(t => !t.prazo && t.prioridade === 'alta');
    const r = Financas.resumo(chaveMes(d));
    const contas = Financas.aVencer(7);
    const tr = Treinos.deHoje();
    const agora = hhmm(agoraMin());
    const alertas = [
      ...Alarmes.lembretesDoDia(h).filter(l => l.hora >= agora).map(l => ({ quando: l.hora, rot: 'Hoje', ic: ICONE_LEMBRETE[l.chave.split(':')[0]] || 'bell', t: semEmoji(l.titulo), sub: l.texto })),
      ...Alarmes.proximos(3).map(x => ({ quando: x.o.hora, rot: rotuloDia(x.o.iso), ic: 'alarm-clock', t: x.a.rotulo || 'Alarme', sub: Alarmes.descricaoDias(x.a) })),
    ].slice(0, 5);
    const notas = db.notas.filter(n => n.fixada);
    const pct = r.renda ? Math.min(100, r.total / r.renda * 100) : 0;
    const proximoEv = eventos.find(e => !e.inicio || e.inicio >= agora);

    const tarefaLi = t => `<li>
      <input type="checkbox" data-acao="concluir" data-id="${t.id}" aria-label="Concluir: ${esc(t.titulo)}">
      <div class="info"><div class="nome">${esc(t.titulo)}</div>
        <div class="sub"><span class="dot p-${t.prioridade || 'media'}"></span>${t.area === 'trabalho' ? 'Trabalho' : 'Pessoal'}${Tarefas.prazoHTML(t)}${t.projeto ? `<span>${esc(t.projeto)}</span>` : ''}</div></div></li>`;

    const resumo = [
      { href: '#agenda', cor: '', ic: 'calendar', b: eventos.length ? `${eventos.length} evento${eventos.length > 1 ? 's' : ''}` : 'Livre',
        s: proximoEv ? `Próximo: ${proximoEv.inicio || 'dia todo'}` : 'Agenda de hoje' },
      { href: '#' + (pend.some(t => t.area === 'pessoal') ? 'pessoal' : 'trabalho'), cor: atrasadas ? 'vermelho' : 'laranja', ic: 'list-checks',
        b: `${pend.length} pendente${pend.length === 1 ? '' : 's'}`, s: atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}` : 'Tarefas' },
      { href: '#financas', cor: r.saldo < 0 ? 'vermelho' : 'verde', ic: 'wallet', b: brl.format(r.saldo),
        s: contas.length ? `${contas.length} conta${contas.length > 1 ? 's' : ''} a vencer` : 'Saldo do mês' },
      { href: '#treinos', cor: 'roxo', ic: 'dumbbell', b: tr.andamento ? 'Em andamento' : tr.feito ? 'Concluído' : tr.modelo ? 'Dia de treino' : 'Descanso',
        s: tr.modelo ? esc(tr.modelo.nome.split(' — ')[0]) : 'Treino de hoje' },
    ];

    const dataLonga = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div class="jv-hero"><button data-acao="jarvis:abrir" aria-label="Falar com o Jarvis">${reator()}</button>
        <div class="ola"><h1>${saud}, ${esc(Jarvis.tratamento())}</h1><p>${dataLonga}</p><div class="online">J.A.R.V.I.S. ONLINE</div></div></div>
      <div class="ola so-fora-jarvis"><h1>${saud}${db.config.nome ? ', ' + esc(db.config.nome) : ''}</h1><p>${dataLonga}</p></div>

      <div class="resumo">${resumo.map(x => `<a href="${x.href}"><span class="bolha ${x.cor}">${ic(x.ic)}</span>
        <div><b>${x.b}</b><span>${x.s}</span></div></a>`).join('')}</div>

      <div class="atalhos">
        <button class="mini" data-acao="pessoal:nova">${ic('plus', 'ic-sm')} Tarefa</button>
        <button class="mini" data-acao="agenda:novo">${ic('plus', 'ic-sm')} Evento</button>
        <button class="mini" data-acao="financas:novoVar">${ic('plus', 'ic-sm')} Gasto</button>
        <button class="mini" data-acao="alarmes:novo">${ic('plus', 'ic-sm')} Alarme</button>
        ${App.instalar ? `<button class="mini primary" data-acao="geral:instalar">${ic('download', 'ic-sm')} Instalar app</button>` : ''}
      </div>

      <div class="painel">
        <section class="card"><h2>${ic('calendar')} Agenda de hoje<span class="sp"></span><a class="ver" href="#agenda">Ver agenda</a></h2>
          ${eventos.length ? `<ul class="lista">${eventos.map(e => Agenda.itemHTML(e)).join('')}</ul>`
            : vazio('calendar', 'Nenhum compromisso hoje.', `<button class="mini" data-acao="agenda:novo">${ic('plus', 'ic-sm')} Novo evento</button>`)}
          ${nAmanha ? `<p class="muted" style="font-size:13px;margin:12px 0 0">Amanhã: ${nAmanha} evento${nAmanha > 1 ? 's' : ''}</p>` : ''}
        </section>

        <section class="card"><h2>${ic('list-checks')} Prioridades<span class="sp"></span>
            <span class="chip">${pend.filter(t => t.area === 'trabalho').length} trabalho · ${pend.filter(t => t.area === 'pessoal').length} pessoais</span></h2>
          ${urg.length + semPrazo.length ? `<ul class="lista">${[...urg, ...semPrazo].slice(0, 7).map(tarefaLi).join('')}</ul>`
            : vazio('circle-check', 'Nada urgente para os próximos dias.')}
        </section>

        <section class="card"><h2>${ic('wallet')} ${nomeMes(chaveMes(d))}<span class="sp"></span><a class="ver" href="#financas">Finanças</a></h2>
          <div class="muted" style="font-size:13px">Saldo previsto</div>
          <div class="grande ${r.saldo < 0 ? 'neg' : ''}">${brl.format(r.saldo)}</div>
          ${r.renda ? `<div class="bar ${pct > 90 ? 'alerta' : ''}"><div style="width:${pct}%"></div></div>
            <div class="linha muted" style="border:none"><span>Gastos ${brl.format(r.total)}</span><span>Renda ${brl.format(r.renda)}</span></div>`
            : `<p class="muted" style="font-size:13px;margin:6px 0 0">Informe a renda do mês em <a href="#financas">Finanças</a>.</p>`}
          ${contas.length ? `<div class="dia-titulo">A vencer em 7 dias</div>${contas.map(c => `<div class="linha">
            <span class="${c.data < h ? 'atrasado' : c.data === h ? 'ehoje' : ''}">${rotuloDia(c.data)} · ${esc(c.nome)}</span><b>${brl.format(c.valor)}</b></div>`).join('')}` : ''}
        </section>

        <section class="card"><h2>${ic('dumbbell')} Treino<span class="sp"></span><a class="ver" href="#treinos">Treinos</a></h2>
          ${tr.andamento ? `<p style="margin-top:0"><b>${esc(tr.modelo?.nome || 'Treino')}</b> em andamento.</p><a class="btn primary" href="#treinos">${ic('play')} Continuar</a>`
            : tr.feito ? vazio('circle-check', 'Treino de hoje concluído. Bom trabalho!')
            : tr.modelo ? `<p style="margin-top:0">Hoje: <b>${esc(tr.modelo.nome)}</b> · ${tr.modelo.exercicios.length} exercícios</p>
                <button class="primary" data-acao="treinos:iniciar" data-id="${tr.modelo.id}">${ic('play')} Iniciar treino</button>`
            : vazio('coffee', 'Dia de descanso.')}
        </section>

        <section class="card"><h2>${ic('bell')} Próximos alertas<span class="sp"></span><a class="ver" href="#alarmes">Alarmes</a></h2>
          ${alertas.length ? `<ul class="lista">${alertas.map(x => `<li><span class="muted">${ic(x.ic)}</span>
              <div class="info"><div class="nome">${esc(x.t)}</div><div class="sub">${esc(x.sub)}</div></div>
              <div style="text-align:right"><b style="font-variant-numeric:tabular-nums">${x.quando}</b><div class="muted" style="font-size:12px">${x.rot}</div></div></li>`).join('')}</ul>`
            : vazio('bell', 'Nenhum alarme ou lembrete programado.')}
        </section>

        ${notas.length ? `<section class="card"><h2>${ic('pin')} Notas fixadas<span class="sp"></span><a class="ver" href="#geral">Notas</a></h2>
          <div class="notas">${notas.map(n => `<div class="nota"><div class="t"><span>${esc(n.titulo || '')}</span></div><div class="tx">${esc(n.texto)}</div></div>`).join('')}</div>
        </section>` : ''}
      </div>`;
  },
  acoes: {
    concluir(d) {
      const t = db.tarefas.find(x => x.id === d.id);
      Tarefas.concluir(t);
      ok();
      aviso('Tarefa concluída', { texto: 'Desfazer', fn: () => { Tarefas.concluir(t, false); ok(); } });
    },
  },
});
