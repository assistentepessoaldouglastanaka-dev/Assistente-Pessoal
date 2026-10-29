'use strict';
// ============ Nutrição: bioimpedância e plano alimentar da nutricionista ============
// medição: { id, fonte: 'galileu'|'manual', data, peso, cintura, imc, gorduraPct, gorduraKg, massaMagraKg, massaMuscularKg,
//            aguaPct, aguaTotalL, aguaIntraL, aguaExtraL, gorduraVisceral, tmb, razaoMusculoGordura, anguloFase, descartada, motivo }

// [campo, rótulo, unidade, casas, melhor quando: 'cai' | 'sobe' | null]
const BIO_METRICAS = [
  ['peso', 'Peso', 'kg', 1, null],
  ['gorduraPct', 'Gordura', '%', 1, 'cai'],
  ['gorduraKg', 'Massa gorda', 'kg', 1, 'cai'],
  ['massaMuscularKg', 'Massa muscular', 'kg', 1, 'sobe'],
  ['massaMagraKg', 'Massa magra', 'kg', 1, 'sobe'],
  ['aguaPct', 'Água corporal', '%', 1, 'sobe'],
  ['gorduraVisceral', 'Gordura visceral', 'cm²', 1, 'cai'],
  ['cintura', 'Cintura', 'cm', 1, 'cai'],
  ['tmb', 'Metabolismo basal', 'kcal', 0, 'sobe'],
  ['razaoMusculoGordura', 'Músculo / gordura', '', 2, 'sobe'],
];
const BIO_TILES = ['peso', 'gorduraPct', 'massaMuscularKg', 'gorduraVisceral', 'aguaPct', 'tmb'];

const Nutricao = {
  metrica: 'peso', periodo: 'tudo', importando: false,

  metrica_(campo) { return BIO_METRICAS.find(m => m[0] === campo); },
  fmt(v, casas = 1) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); },
  validas() { return db.bioimpedancia.filter(m => !m.descartada).sort((a, b) => a.data.localeCompare(b.data)); },

  // Medição fora do padrão: gordura % e água % muito longe da mediana das vizinhas (±60 dias)
  suspeita(m, todas) {
    const t = deISO(m.data).getTime(), dia = 86400000;
    const viz = todas.filter(x => x !== m && Math.abs(deISO(x.data).getTime() - t) <= 60 * dia);
    if (viz.length < 2) return false;
    const mediana = arr => { const s = [...arr].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
    const dg = Math.abs(m.gorduraPct - mediana(viz.map(x => x.gorduraPct)));
    const da = Math.abs(m.aguaPct - mediana(viz.map(x => x.aguaPct)));
    return dg > 6 && da > 5;
  },

  async importar(link) {
    this.importando = true; render();
    try {
      const { data, error } = await Sync.sb.functions.invoke('importar-bioimpedancia', { body: { link } });
      if (error) {
        let motivo = '';
        try { motivo = (await error.context.json()).erro; } catch (e) {}
        throw new Error({ link_invalido: 'Link inválido. Cole o link completo do relatório do Galileu.',
          relatorio_nao_encontrado: 'Relatório não encontrado.', nao_autenticado: 'Entre com sua conta Google primeiro (Geral).' }[motivo]
          || 'Não foi possível importar agora.');
      }
      let novas = 0, descartadas = 0;
      for (const a of data.avaliacoes) {
        const existente = db.bioimpedancia.find(x => x.id === a.id);
        if (existente) { Object.assign(existente, a, { descartada: existente.descartada, motivo: existente.motivo }); continue; }
        db.bioimpedancia.push({ ...a, descartada: false });
        novas++;
      }
      // marca automaticamente as medições novas fora do padrão (dá para restaurar)
      for (const m of db.bioimpedancia) {
        if (m.revisada || m.descartada || m.gorduraPct == null || m.aguaPct == null) continue;
        if (this.suspeita(m, db.bioimpedancia)) { m.descartada = true; m.motivo = 'Fora do padrão (detectado automaticamente)'; descartadas++; }
      }
      db.bioimpedancia.forEach(m => { m.revisada = true; });
      salvar();
      aviso(`${novas} avaliação(ões) nova(s) importada(s)` + (descartadas ? ` · ${descartadas} descartada(s) por estar fora do padrão` : ''));
    } catch (e) { aviso(e.message); }
    this.importando = false; render();
  },

  // ---------- Plano alimentar ----------
  // PDF com texto é lido aqui no aparelho (pdf.js); o texto vai para a IA gratuita, que organiza refeições e quantidades.
  lendoPlano: false,
  async textoDoPdf(arquivo) {
    if (!window.pdfjsLib) {
      await new Promise((feito, falhou) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
        sc.onload = feito; sc.onerror = () => falhou(new Error('Sem internet para abrir o PDF.'));
        document.head.appendChild(sc);
      });
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    const pdf = await pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const paginas = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      // junta os pedaços por linha (mesma altura na página)
      let linha = '', y = null, txt = '';
      for (const it of c.items) {
        const yy = Math.round(it.transform[5]);
        if (y !== null && Math.abs(yy - y) > 2) { txt += linha.trim() + '\n'; linha = ''; }
        linha += it.str + ' '; y = yy;
      }
      paginas.push(txt + linha.trim());
    }
    return paginas.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  },
  async importarArquivo(arquivo) {
    if (!arquivo) return;
    try {
      const ehPdf = /pdf$/i.test(arquivo.type) || /\.pdf$/i.test(arquivo.name);
      const texto = ehPdf ? await this.textoDoPdf(arquivo) : await arquivo.text();
      if (texto.replace(/\s/g, '').length < 40) return aviso('Esse PDF não tem texto (parece foto ou escaneado). Abra o plano, copie o texto e use "Colar texto".');
      this.lerPlano(texto, arquivo.name.replace(/\.[^.]+$/, ''));
    } catch (e) { aviso(e.message || 'Não consegui abrir o arquivo.'); }
  },
  async lerPlano(texto, nome) {
    if (!Sync.usuario) return aviso('Entre com sua conta Google primeiro (Notas e ajustes).');
    this.lendoPlano = true; render();
    try {
      const { data, error } = await Sync.sb.functions.invoke('jarvis', { body: { modo: 'plano', texto } });
      if (error) throw new Error(await motivoErro(error));
      const pl = data.plano;
      db.planos.forEach(x => { x.ativo = false; });
      const novo = { id: uid(), titulo: pl.titulo || nome || 'Plano alimentar', data: hoje(), ativo: true,
        refeicoes: (pl.refeicoes || []).map(r => ({ nome: r.nome || 'Refeição', horario: /^\d{1,2}:\d{2}$/.test(r.horario || '') ? r.horario.padStart(5, '0') : null,
          itens: (r.itens || []).filter(i => i?.alimento), opcoes: (r.opcoes || []).filter(Boolean) })),
        orientacoes: (pl.orientacoes || []).filter(Boolean), texto: texto.slice(0, 20000) };
      db.planos.push(novo);
      db.planos.splice(0, Math.max(0, db.planos.length - 5));
      salvar();
      const n = novo.refeicoes.reduce((s, r) => s + r.itens.length, 0);
      aviso(`Plano importado: ${novo.refeicoes.length} refeições, ${n} alimentos. Confira e gere a lista de mercado.`);
    } catch (e) { aviso(e.message); }
    this.lendoPlano = false; render();
  },
  cardPlano() {
    const p = Mercado.plano(), lendo = this.lendoPlano;
    const botoes = `<button class="mini${p ? '' : ' primary'}" data-acao="planoArquivo"${lendo ? ' disabled' : ''}>${ic(lendo ? 'refresh-cw' : 'upload-file', 'ic-sm')} ${lendo ? 'Lendo o plano...' : 'Importar PDF'}</button>
      <button class="mini fantasma" data-acao="planoColar"${lendo ? ' disabled' : ''}>${ic('file-text', 'ic-sm')} Colar texto</button>
      <input type="file" id="arqPlano" accept="application/pdf,.pdf,text/plain,.txt" hidden data-muda="planoArquivoEscolhido">`;
    if (!p) return `<section class="card mt"><h2>${ic('utensils')} Plano alimentar</h2>
      ${vazio('utensils', 'Envie o PDF do plano da nutricionista (ou cole o texto). O app organiza as refeições e monta a lista de mercado com a previsão de gasto.',
        `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${botoes}</div>`)}</section>`;
    return `<section class="card mt"><h2>${ic('utensils')} ${esc(p.titulo)}<span class="sp"></span><span class="chip">importado em ${fmtData(p.data)}</span></h2>
      <div class="refeicoes">${p.refeicoes.map(r => `<div class="refeicao">
        <div class="ref-cab"><b>${esc(r.nome)}</b>${r.horario ? `<span class="chip">${r.horario}</span>` : ''}</div>
        <ul>${r.itens.map(i => `<li>${esc(i.texto || i.alimento)}${i.vezesSemana && i.vezesSemana < 7 ? ` <span class="muted">(${i.vezesSemana}x/semana)</span>` : ''}</li>`).join('')}</ul>
        ${r.opcoes?.length ? `<div class="muted" style="font-size:12.5px">${r.opcoes.map(o => '↺ ' + esc(o)).join('<br>')}</div>` : ''}</div>`).join('')}</div>
      ${p.orientacoes?.length ? `<h3 style="font-size:14px;margin:14px 0 6px">Orientações</h3><ul class="orientacoes">${p.orientacoes.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap" class="mt">
        <button class="mini primary" data-acao="planoMercado">${ic('shopping-cart', 'ic-sm')} Gerar lista de mercado</button>
        ${p.refeicoes.some(r => r.horario) ? `<button class="mini" data-acao="planoAlarmes">${ic('bell', 'ic-sm')} Lembretes das refeições</button>` : ''}
        ${botoes}</div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">Organizado por IA a partir do arquivo: confira com o plano original.</p></section>`;
  },

  formManual(m) {
    crud({
      lista: db.bioimpedancia, item: m, titulos: ['Nova medição', 'Editar medição'],
      campos: [
        { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, padrao: hoje() },
        { nome: 'peso', rotulo: 'Peso (kg)', tipo: 'number', min: 0, obrigatorio: true },
        { nome: 'gorduraPct', rotulo: 'Gordura (%)', tipo: 'number', min: 0 },
        { nome: 'massaMuscularKg', rotulo: 'Massa muscular (kg)', tipo: 'number', min: 0 },
        { nome: 'aguaPct', rotulo: 'Água corporal (%)', tipo: 'number', min: 0 },
        { nome: 'gorduraVisceral', rotulo: 'Gordura visceral (cm²)', tipo: 'number', min: 0 },
        { nome: 'cintura', rotulo: 'Cintura (cm)', tipo: 'number', min: 0 },
        { nome: 'tmb', rotulo: 'Metabolismo basal (kcal)', tipo: 'number', min: 0 },
      ],
      preparar: (v, item) => {
        if (v.peso && v.gorduraPct != null) v.gorduraKg = +(v.peso * v.gorduraPct / 100).toFixed(1);
        if (!item) Object.assign(v, { fonte: 'manual', descartada: false, revisada: true });
      },
    });
  },

  // ---------- Gráfico de evolução (uma série, eixo de tempo real) ----------
  grafico() {
    const [campo, rotulo, unid, casas] = this.metrica_(this.metrica);
    let pts = this.validas().filter(m => m[campo] != null);
    if (this.periodo !== 'tudo') { const ini = somaDias(hoje(), -365 * Number(this.periodo)); pts = pts.filter(m => m.data >= ini); }
    if (pts.length < 2) return vazio('trending-up', 'Poucas medições neste período para desenhar a evolução.');

    const W = 640, H = 230, ml = 46, mr = 18, mt = 16, mb = 30;
    const ts = pts.map(p => deISO(p.data).getTime()), vs = pts.map(p => p[campo]);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let v0 = Math.min(...vs), v1 = Math.max(...vs);
    const folga = (v1 - v0) * 0.15 || Math.abs(v1) * 0.05 || 1; v0 -= folga; v1 += folga;
    const x = t => ml + (t - t0) / (t1 - t0) * (W - ml - mr);
    const y = v => mt + (1 - (v - v0) / (v1 - v0)) * (H - mt - mb);

    const ticksY = [0, 1, 2, 3].map(i => v0 + (v1 - v0) * i / 3);
    const grade = ticksY.map(v => `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" class="g-grade"/>
      <text x="${ml - 8}" y="${y(v) + 4}" text-anchor="end" class="g-eixo">${this.fmt(v, casas === 0 ? 0 : 1)}</text>`).join('');
    // rótulos de data: primeiro, último e até 4 no meio, sem sobrepor
    const idx = [...new Set([0, ...[1, 2, 3, 4].map(k => Math.round(k * (pts.length - 1) / 5)), pts.length - 1])];
    let ultimoX = -Infinity;
    const datas = idx.map(i => {
      const px = x(ts[i]); if (px - ultimoX < 70 && i !== pts.length - 1) return ''; ultimoX = px;
      const [a, m] = pts[i].data.split('-');
      return `<text x="${px}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" class="g-eixo">${m}/${a.slice(2)}</text>`;
    }).join('');
    // intervalos de mais de 6 meses sem medição ficam tracejados (não houve acompanhamento nesse período)
    const LACUNA = 183 * 86400000, xy = i => `${x(ts[i]).toFixed(1)},${y(vs[i]).toFixed(1)}`;
    let linha = `M${xy(0)}`, lacunas = '';
    for (let i = 1; i < pts.length; i++) {
      if (ts[i] - ts[i - 1] > LACUNA) { lacunas += `M${xy(i - 1)} L${xy(i)} `; linha += ` M${xy(i)}`; }
      else linha += ` L${xy(i)}`;
    }
    const pontos = pts.map((p, i) => `<circle cx="${x(ts[i])}" cy="${y(vs[i])}" r="4" class="g-ponto"/>`).join('');
    const ult = pts.length - 1;
    const dados = pts.map((p, i) => ({ x: x(ts[i]), y: y(vs[i]), d: fmtData(p.data), v: this.fmt(vs[i], casas) + (unid ? ' ' + unid : '') }));

    return `<div class="grafico-bio" data-pontos='${esc(JSON.stringify(dados))}' data-largura="${W}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução de ${esc(rotulo)}">
        ${grade}${datas}
        ${lacunas ? `<path d="${lacunas}" class="g-lacuna"><title>Período sem medições</title></path>` : ''}
        <path d="${linha}" class="g-linha"/>
        ${pontos}
        <text x="${x(ts[ult]) - 8}" y="${y(vs[ult]) - 10}" text-anchor="end" class="g-rotulo">${this.fmt(vs[ult], casas)}${unid ? ' ' + unid : ''}</text>
        <line class="g-mira" y1="${mt}" y2="${H - mb}" x1="0" x2="0" style="display:none"/>
        <circle class="g-foco" r="6" style="display:none"/>
      </svg>
      <div class="g-dica" hidden></div>
    </div>`;
  },
};

// Hover do gráfico: mira vertical + dica com data e valor do ponto mais próximo
document.addEventListener('pointermove', e => {
  const g = e.target.closest?.('.grafico-bio');
  document.querySelectorAll('.grafico-bio').forEach(o => { if (o !== g) esconderDica(o); });
  if (!g) return;
  const svg = g.querySelector('svg'), r = svg.getBoundingClientRect();
  const escala = r.width / Number(g.dataset.largura);
  const px = (e.clientX - r.left) / escala;
  const pts = JSON.parse(g.dataset.pontos);
  const p = pts.reduce((a, b) => Math.abs(b.x - px) < Math.abs(a.x - px) ? b : a);
  const mira = g.querySelector('.g-mira'), foco = g.querySelector('.g-foco'), dica = g.querySelector('.g-dica');
  mira.setAttribute('x1', p.x); mira.setAttribute('x2', p.x); mira.style.display = '';
  foco.setAttribute('cx', p.x); foco.setAttribute('cy', p.y); foco.style.display = '';
  dica.innerHTML = `<b>${p.v}</b><span>${p.d}</span>`;
  dica.hidden = false;
  g.classList.add('ativo');
  const esquerda = Math.min(Math.max(p.x * escala - dica.offsetWidth / 2, 0), r.width - dica.offsetWidth);
  dica.style.left = esquerda + 'px';
  dica.style.top = Math.max(p.y * escala - dica.offsetHeight - 14, 0) + 'px';
});
function esconderDica(g) {
  g.querySelector('.g-dica').hidden = true;
  g.classList.remove('ativo');
  g.querySelector('.g-mira').style.display = 'none';
  g.querySelector('.g-foco').style.display = 'none';
}

registrar({
  id: 'nutricao', nome: 'Nutrição', icone: '🥗',
  render() {
    const N = Nutricao, val = N.validas();
    const ult = val[val.length - 1], ant = val[val.length - 2];
    const descartadas = db.bioimpedancia.filter(m => m.descartada).length;

    const tile = campo => {
      const [, rotulo, unid, casas, melhor] = N.metrica_(campo);
      const v = ult?.[campo], d = v != null && ant?.[campo] != null ? v - ant[campo] : null;
      const bom = d == null || melhor == null || Math.abs(d) < 10 ** -casas ? null : (d < 0) === (melhor === 'cai');
      return `<button class="card tile bio-tile${N.metrica === campo ? ' sel' : ''}" data-acao="metrica" data-k="${campo}">
        <div class="lbl">${rotulo}</div>
        <div class="val">${N.fmt(v, casas)}<small> ${unid}</small></div>
        ${d != null ? `<div class="delta ${bom == null ? '' : bom ? 'pos' : 'neg'}">${d > 0 ? ic('arrow-up', 'ic-sm') : d < 0 ? ic('arrow-down', 'ic-sm') : ''} ${N.fmt(Math.abs(d), casas)} ${unid}</div>` : ''}
      </button>`;
    };

    const linhas = [...db.bioimpedancia].sort((a, b) => b.data.localeCompare(a.data));
    return cabecalho('Nutrição', {
        sub: ult ? `Última avaliação em ${fmtData(ult.data)}${ant ? `, comparada com ${fmtData(ant.data)}` : ''}` : '',
        acoes: `<button data-acao="manual">${ic('scale')}<span class="rotulo-opc">Medição manual</span></button>
          <button class="primary" data-acao="importar"${N.importando ? ' disabled' : ''}>${ic(N.importando ? 'refresh-cw' : 'download')}<span class="rotulo-opc">${N.importando ? 'Importando...' : 'Importar bioimpedância'}</span></button>` })
      + `${!db.bioimpedancia.length ? `<div class="card">${vazio('activity', 'Cole o link do relatório do Galileu (b.IA) e todo o histórico de avaliações entra de uma vez.',
        `<button class="primary" data-acao="importar">${ic('download')} Importar bioimpedância</button>`)}</div>` : `
      <div class="tiles bio">${BIO_TILES.map(tile).join('')}</div>

      <section class="card"><h2>${ic('trending-up')} Evolução · ${esc(N.metrica_(N.metrica)[1])}<span class="sp"></span>
          <select data-muda="periodo" aria-label="Período">${[['1', 'Último ano'], ['2', '2 anos'], ['tudo', 'Tudo']].map(([v, l]) =>
            `<option value="${v}"${N.periodo === v ? ' selected' : ''}>${l}</option>`).join('')}</select></h2>
        <div class="chips-metrica">${BIO_METRICAS.map(([k, l]) => `<button class="mini${N.metrica === k ? ' primary' : ''}" data-acao="metrica" data-k="${k}">${l}</button>`).join('')}</div>
        ${N.grafico()}
      </section>`}

      ${N.cardPlano()}

      ${linhas.length ? `<section class="card mt"><h2>${ic('file-text')} Histórico <span class="chip">${val.length} válidas${descartadas ? ` · ${descartadas} descartada(s)` : ''}</span></h2>
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Data</th><th>Peso</th><th>Gordura %</th><th>Gordura kg</th><th>Músculo kg</th><th>Água %</th><th>Visceral</th><th>Cintura</th><th>TMB</th><th></th></tr></thead>
          <tbody>${linhas.map(m => `<tr class="${m.descartada ? 'descartada' : ''}" title="${esc(m.motivo || '')}">
            <td>${fmtData(m.data)}${m.fonte === 'manual' ? ' <span class="chip">manual</span>' : ''}${m.descartada ? ' <span class="chip">descartada</span>' : ''}</td>
            <td>${N.fmt(m.peso)}</td><td>${N.fmt(m.gorduraPct)}</td><td>${N.fmt(m.gorduraKg)}</td><td>${N.fmt(m.massaMuscularKg)}</td>
            <td>${N.fmt(m.aguaPct)}</td><td>${N.fmt(m.gorduraVisceral)}</td><td>${N.fmt(m.cintura)}</td><td>${N.fmt(m.tmb, 0)}</td>
            <td style="white-space:nowrap">${m.fonte === 'manual' ? bi('editar', 'pencil', 'Editar', `data-id="${m.id}"`) : ''}
              ${bi('descartar', m.descartada ? 'rotate-ccw' : 'eye-off', m.descartada ? 'Voltar a considerar' : 'Descartar esta medição', `data-id="${m.id}"`)}</td>
          </tr>`).join('')}</tbody></table></div>
      </section>` : ''}`;
  },
  acoes: {
    importar() {
      if (!Sync.usuario) return aviso('Entre com sua conta Google primeiro (Geral).');
      formulario({
        titulo: 'Importar bioimpedância (Galileu)', textoSalvar: 'Importar',
        campos: [{ nome: 'link', rotulo: 'Link do relatório', obrigatorio: true, largo: true, dica: 'https://galileuonline.com.br/relatorio/#/?relatorio=...',
          ajuda: 'O link que você recebe por e-mail ou WhatsApp. Todo o histórico vem junto.' }],
        salvar: v => { Nutricao.importar(v.link); },
      });
    },
    manual() { Nutricao.formManual(); },
    editar(d) { Nutricao.formManual(db.bioimpedancia.find(m => m.id === d.id)); },
    descartar(d) {
      const m = db.bioimpedancia.find(x => x.id === d.id);
      m.descartada = !m.descartada;
      m.motivo = m.descartada ? 'Descartada manualmente' : '';
      ok(m.descartada ? 'Medição descartada' : 'Medição restaurada');
    },
    planoArquivo() { $('#arqPlano').click(); },
    planoArquivoEscolhido(d, el) { Nutricao.importarArquivo(el.files[0]); el.value = ''; },
    planoColar() {
      formulario({
        titulo: 'Colar o plano alimentar', textoSalvar: 'Organizar',
        campos: [{ nome: 'texto', rotulo: 'Texto do plano', tipo: 'textarea', linhas: 12, largo: true, obrigatorio: true,
          ajuda: 'Abra o PDF ou a mensagem da nutricionista, selecione tudo, copie e cole aqui.' }],
        salvar: v => { Nutricao.lerPlano(v.texto); },
      });
    },
    planoMercado() { Mercado.gerarDoPlano(); ir('mercado'); },
    planoAlarmes() {
      const p = Mercado.plano();
      let n = 0;
      for (const r of p.refeicoes) {
        if (!r.horario || db.alarmes.some(a => a.hora === r.horario && a.rotulo === r.nome)) continue;
        db.alarmes.push({ id: uid(), hora: r.horario, rotulo: r.nome, dias: [0, 1, 2, 3, 4, 5, 6], data: null, ativo: true });
        n++;
      }
      ok(n ? `${n} lembretes de refeição criados em Alarmes` : 'Os lembretes das refeições já existem');
    },
    metrica(d) { Nutricao.metrica = d.k; render(); },
    periodo(d, el) { Nutricao.periodo = el.value; render(); },
  },
});
