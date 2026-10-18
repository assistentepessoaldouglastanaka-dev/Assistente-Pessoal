'use strict';
// ============ Utilidades ============
const CHAVE = 'assistente.v1';
const CHAVE_GASTOS_ANTIGA = 'controleGastos.v1';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DIAS_SEMANA_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const $ = (sel, el = document) => el.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function soma(arr, k) { return arr.reduce((s, x) => s + (Number(x[k]) || 0), 0); }

function isoData(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hoje() { return isoData(new Date()); }
function deISO(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); }
function somaDias(iso, n) { const d = deISO(iso); d.setDate(d.getDate() + n); return isoData(d); }
function chaveMes(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function somaMes(mes, n) { const [a, m] = mes.split('-').map(Number); return chaveMes(new Date(a, m - 1 + n, 1)); }
function mesesEntre(a, b) { const [a1, m1] = a.split('-').map(Number); const [a2, m2] = b.split('-').map(Number); return (a2 - a1) * 12 + (m2 - m1); }
function nomeMes(mes) { const [a, m] = mes.split('-').map(Number); const s = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return s[0].toUpperCase() + s.slice(1); }
function ultimoDia(mes) { const [a, m] = mes.split('-').map(Number); return new Date(a, m, 0).getDate(); }
function diaNoMes(mes, dia) { return mes + '-' + pad(Math.min(dia, ultimoDia(mes))); }
function fmtData(iso) { return iso ? iso.split('-').reverse().join('/') : ''; }
function fmtDia(iso) { const d = deISO(iso); return DIAS_SEMANA[d.getDay()] + ', ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }
function rotuloDia(iso) {
  const h = hoje();
  if (iso === h) return 'Hoje';
  if (iso === somaDias(h, 1)) return 'Amanhã';
  if (iso === somaDias(h, -1)) return 'Ontem';
  return fmtDia(iso);
}
function minutos(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function agoraMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function urlSegura(u) { return /^https?:\/\//i.test(u) ? u : 'https://' + u; }

function aviso(msg, acao) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (acao ? `<button type="button">${esc(acao.texto)}</button>` : '');
  if (acao) t.querySelector('button').onclick = () => { t.classList.remove('show'); acao.fn(); };
  t.classList.add('show');
  clearTimeout(aviso.t); aviso.t = setTimeout(() => t.classList.remove('show'), acao ? 6000 : 2600);
}

// ============ Peças de interface ============
function ic(nome, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ''}</svg>`;
}
// Botão só com ícone (com nome acessível)
function bi(acao, icone, rotulo, extra = '', cls = '') {
  return `<button class="icon ${cls}" type="button" data-acao="${acao}" ${extra} title="${esc(rotulo)}" aria-label="${esc(rotulo)}">${ic(icone)}</button>`;
}
// Cabeçalho de página: título, subtítulo e ações
function cabecalho(titulo, { sub = '', acoes = '' } = {}) {
  return `<div class="topo"><div class="topo-t"><h1>${titulo}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${acoes ? `<div class="topo-a">${acoes}</div>` : ''}</div>`;
}
// Estado vazio com ícone, texto e (opcional) um botão
function vazio(icone, texto, botao = '') {
  return `<div class="vazio-grande">${ic(icone)}<p>${texto}</p>${botao}</div>`;
}
// Confirmação no estilo do app (no lugar do confirm() do navegador)
function confirmar(msg, { titulo = 'Confirmar', ok: textoOk = 'Confirmar', perigo = false } = {}) {
  return new Promise(resolve => {
    const d = $('#confirma');
    let respondido = false;
    const responder = sim => { if (respondido) return; respondido = true; if (d.open) d.close(); resolve(sim); };
    d.innerHTML = `<div class="modal-form"><div class="modal-cab"><h3>${esc(titulo)}</h3></div>
      <div class="modal-corpo"><p>${esc(msg)}</p></div>
      <div class="modal-acoes"><span class="sp"></span><button type="button" data-r="nao">Cancelar</button>
        <button type="button" data-r="sim" class="primary${perigo ? ' perigo' : ''}">${esc(textoOk)}</button></div></div>`;
    d.onclick = e => {
      if (e.target === d) return responder(false);
      const b = e.target.closest('[data-r]');
      if (b) responder(b.dataset.r === 'sim');
    };
    d.oncancel = () => responder(false);   // tecla Esc / voltar
    d.onclose = () => responder(false);
    d.showModal();
    d.querySelector('[data-r=sim]').focus();
  });
}
// Menu em grade (botão +, "Mais")
function folha(titulo, itens) {
  const d = $('#folha');
  d.innerHTML = `<div class="modal-cab"><h3>${esc(titulo)}</h3><button class="icon" type="button" data-f="fechar" aria-label="Fechar">${ic('x')}</button></div>
    <div class="menu-grade">${itens.map((x, i) => `<button type="button" data-i="${i}" class="${x.ativo ? 'ativo' : ''}">${ic(x.icone)}<span>${esc(x.rotulo)}</span></button>`).join('')}</div>`;
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-f=fechar]')) return d.close();
    const b = e.target.closest('[data-i]');
    if (b) { d.close(); itens[b.dataset.i].fn(); }
  };
  d.showModal();
}

// ============ Dados ============
function padrao() {
  return {
    versao: 1,
    config: { nome: '', folga: 10, tema: 'auto', ultimoBackup: null, jarvis: { voz: true, palavra: false, tratamento: 'senhor', velocidade: 'normal', tom: 'normal' } },
    // { id, area: 'trabalho'|'pessoal', titulo, status: 'afazer'|'fazendo'|'feito', prioridade, prazo, projeto, notas, concluida }
    tarefas: [],
    // { id, nome, preco, link, prioridade, comprado, notas }
    wishlist: [],
    // formato compatível com o controle-de-gastos.html
    financas: { fixos: [], variaveis: [], renda: {}, dividas: [] },
    // { id, titulo, data, inicio, fim, local, rotaId, alerta, repetir, ate, tipo, notas }
    eventos: [],
    // { id, nome, endereco }
    locais: [],
    // { id, nome, origem, destino, modo, duracao, notas }
    rotas: [],
    // modelos: { id, nome, exercicios: [{ nome, series, reps, carga }] }; semana: { 0..6: modeloId }
    treinos: { modelos: [], semana: {}, sessoes: [], atual: null },
    // { id, hora, rotulo, dias: [0..6], data, ativo }
    alarmes: [],
    // { id, titulo, texto, fixada, atualizada }
    notas: [],
    // medições de bioimpedância (Nutrição)
    bioimpedancia: [],
    // integração com o Google (sincronizada entre aparelhos)
    google: { agenda: true, tasks: true, listas: {}, tasksCursor: {}, tasksMapa: {}, gmailUsados: [] },
  };
}

function mesclar(base, d) {
  for (const k of Object.keys(base)) {
    if (d[k] === undefined || d[k] === null) d[k] = base[k];
    else if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && typeof d[k] === 'object') mesclar(base[k], d[k]);
  }
  return d;
}

function normalizarFinancas(g) {
  return { fixos: g.fixos || [], variaveis: g.variaveis || [], renda: g.renda || {}, dividas: g.dividas || [] };
}

function carregar() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) {}
  if (d && typeof d === 'object') return mesclar(padrao(), d);
  d = padrao();
  // Primeira vez: aproveita os dados do controle-de-gastos.html, se existirem neste navegador
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE_GASTOS_ANTIGA));
    if (g && Array.isArray(g.fixos)) d.financas = normalizarFinancas(g);
  } catch (e) {}
  return d;
}

let db = carregar();

function salvar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(db)); }
  catch (e) { aviso('Não foi possível salvar no navegador — exporte um backup.'); }
  if (typeof Sync !== 'undefined') Sync.agendar();
  if (typeof Google !== 'undefined') Google.agendarTasks();
}

// Estado do app instalado (PWA): `instalar` guarda o convite de instalação do navegador
const App = { instalar: null, instalado: matchMedia('(display-mode: standalone)').matches };

// ============ Módulos e navegação ============
const Modulos = {};
const ORDEM = [];
let atual = 'inicio';
let ultimaTarefas = 'pessoal';

const NAV = {
  icone: { inicio: 'house', agenda: 'calendar', trabalho: 'briefcase', pessoal: 'list-checks', financas: 'wallet', nutricao: 'salad',
    treinos: 'dumbbell', trajetos: 'route', alarmes: 'alarm-clock', gmail: 'mail', geral: 'settings' },
  grupos: [['Dia a dia', ['inicio', 'agenda', 'trabalho', 'pessoal']], ['Dinheiro e saúde', ['financas', 'nutricao', 'treinos']],
    ['Ferramentas', ['trajetos', 'alarmes', 'gmail']]],
  abas: [['inicio', 'Início', 'house'], ['agenda', 'Agenda', 'calendar'], ['tarefas', 'Tarefas', 'list-checks'], ['financas', 'Finanças', 'wallet'], ['mais', 'Mais', 'layout-grid']],
};

function registrar(m) { Modulos[m.id] = m; ORDEM.push(m.id); }

function montarNav() {
  const item = id => `<a class="item" href="#${id}" data-id="${id}">${ic(NAV.icone[id] || 'circle')}<span>${Modulos[id].nome}</span></a>`;
  $('#lateral').innerHTML = `<div class="marca"><img src="icons/icone-192.png" alt="">Assistente</div>
    <button class="primary novo" data-acao="app:novo">${ic('plus')} Novo</button>
    <button class="bt-jarvis fantasma" data-acao="jarvis:abrir">${reator('reator-mini')} Jarvis <kbd>Alt+J</kbd></button>
    ${NAV.grupos.map(([g, ids]) => `<div class="grupo">${g}</div>${ids.filter(id => Modulos[id]).map(item).join('')}`).join('')}
    <div class="grupo"></div>${item('geral')}
    <div class="rodape"><span class="ponto-sync" id="syncPonto"></span><span id="syncTexto">Sem sincronização</span></div>`;
  $('#abas').innerHTML = NAV.abas.map(([id, rot, ico]) => id === 'mais'
    ? `<a href="#" data-acao="app:mais" data-id="mais">${ic(ico)}<span>${rot}</span></a>`
    : `<a href="#${id === 'tarefas' ? ultimaTarefas : id}" data-id="${id}">${ic(ico)}<span>${rot}</span></a>`).join('');
  $('#barra').innerHTML = `<span class="titulo" id="barraTitulo"></span><span class="ponto-sync" id="syncPontoBarra"></span>
    <button class="bt-jarvis" data-acao="jarvis:abrir" aria-label="Falar com o Jarvis">${reator()}</button>
    <a class="btn icon" href="#geral" aria-label="Configurações e conta">${ic('settings')}</a>`;
  $('#fab').innerHTML = ic('plus');
}

function render() {
  const m = Modulos[atual] || Modulos.inicio;
  if (m.id === 'trabalho' || m.id === 'pessoal') ultimaTarefas = m.id;
  document.querySelectorAll('#lateral a.item').forEach(a => a.classList.toggle('ativo', a.dataset.id === m.id));
  const aba = ['trabalho', 'pessoal'].includes(m.id) ? 'tarefas' : NAV.abas.some(a => a[0] === m.id) ? m.id : 'mais';
  document.querySelectorAll('#abas a').forEach(a => {
    a.classList.toggle('ativo', a.dataset.id === aba);
    if (a.dataset.id === 'tarefas') a.setAttribute('href', '#' + ultimaTarefas);
  });
  $('#barraTitulo').textContent = m.id === 'inicio' ? 'Assistente' : m.nome;
  $('#barra').classList.toggle('sempre', m.id === 'inicio');
  $('#conteudo').innerHTML = m.render();
  document.title = m.nome + ' · Assistente';
  if (typeof Nativo !== 'undefined') Nativo.agendarDepois();
}

function ir(id) { if (atual !== id) location.hash = id; }

// Ações globais: botão +, menu "Mais"
Modulos.app = {
  id: 'app',
  acoes: {
    novo() {
      folha('Adicionar', [
        { icone: 'list-checks', rotulo: 'Tarefa pessoal', fn: () => Modulos.pessoal.acoes.nova() },
        { icone: 'briefcase', rotulo: 'Tarefa do trabalho', fn: () => Modulos.trabalho.acoes.nova() },
        { icone: 'calendar', rotulo: 'Evento', fn: () => Modulos.agenda.acoes.novo() },
        { icone: 'receipt', rotulo: 'Gasto', fn: () => Modulos.financas.acoes.novoVar() },
        { icone: 'alarm-clock', rotulo: 'Alarme', fn: () => Modulos.alarmes.acoes.novo() },
        { icone: 'sticky-note', rotulo: 'Nota', fn: () => Modulos.geral.acoes.novaNota() },
        { icone: 'gift', rotulo: 'Desejo', fn: () => Modulos.pessoal.acoes.novoDesejo() },
        { icone: 'scale', rotulo: 'Medição corporal', fn: () => Modulos.nutricao.acoes.manual() },
        { icone: 'route', rotulo: 'Trajeto', fn: () => Modulos.trajetos.acoes.novaRota() },
      ]);
    },
    mais(d, el, e) {
      e.preventDefault();
      const ids = ['trabalho', 'pessoal', 'nutricao', 'treinos', 'trajetos', 'alarmes', 'gmail', 'geral'];
      const itens = ids.filter(id => Modulos[id]).map(id => ({ icone: NAV.icone[id], rotulo: Modulos[id].nome, ativo: atual === id, fn: () => ir(id) }));
      if (App.instalar) itens.push({ icone: 'download', rotulo: 'Instalar app', fn: () => Modulos.geral.acoes.instalar() });
      folha('Mais', itens);
    },
  },
};

function ok(msg) { salvar(); render(); if (msg) aviso(msg); }

// data-acao="modulo:acao" (clique) e data-muda="modulo:acao" (change). Sem "modulo:" usa o módulo atual.
function despachar(attr, e) {
  const el = e.target.closest(`[${attr}]`);
  if (!el || el.closest('dialog')) return;
  // clique num link/botão/campo dentro de uma área clicável: só o elemento interno age
  const interno = e.target.closest('a[href], button, input, select, textarea, label');
  if (interno && interno !== el && el.contains(interno)) return;
  const spec = el.getAttribute(attr);
  const [mod, nome] = spec.includes(':') ? spec.split(':') : [atual, spec];
  const acoes = Modulos[mod]?.acoes;
  if (acoes?.[nome]) acoes[nome].call(acoes, el.dataset, el, e);
}
document.addEventListener('click', e => despachar('data-acao', e));
document.addEventListener('change', e => despachar('data-muda', e));

// ============ Formulários (modal) ============
function campoHTML(c, v) {
  const id = 'f_' + c.nome;
  const cls = 'campo' + (c.largo ? ' largo' : '');
  const val = v ?? c.padrao ?? '';
  const req = c.obrigatorio ? ' required' : '';
  const ph = c.dica ? ` placeholder="${esc(c.dica)}"` : '';
  const ajuda = c.ajuda ? `<small>${esc(c.ajuda)}</small>` : '';
  let input;
  switch (c.tipo) {
    case 'select':
      input = `<select id="${id}" name="${c.nome}">${c.opcoes.map(o => {
        const [ov, ol] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(ov)}"${String(ov) === String(val) ? ' selected' : ''}>${esc(ol)}</option>`;
      }).join('')}</select>`;
      break;
    case 'textarea':
      input = `<textarea id="${id}" name="${c.nome}" rows="${c.linhas || 4}"${ph}${req}>${esc(val)}</textarea>`;
      break;
    case 'checkbox':
      return `<label class="${cls} check"><input type="checkbox" name="${c.nome}"${val ? ' checked' : ''}> ${esc(c.rotulo)}</label>`;
    case 'dias':
      return `<div class="campo largo"><span class="rot">${esc(c.rotulo)}</span><div class="dias">${DIAS_SEMANA.map((d, i) =>
        `<label><input type="checkbox" name="${c.nome}" value="${i}"${(val || []).includes(i) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div>${ajuda}</div>`;
    default: {
      const tipo = c.tipo || 'text';
      const extra = (tipo === 'number' ? ` step="${c.passo || 'any'}" inputmode="decimal"` : '') + (c.min != null ? ` min="${c.min}"` : '');
      input = `<input id="${id}" name="${c.nome}" type="${tipo}"${extra} value="${esc(val)}"${ph}${req}${c.sugestoes ? ` list="${id}_l"` : ''}>`;
      if (c.sugestoes) input += `<datalist id="${id}_l">${c.sugestoes.map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;
    }
  }
  return `<label class="${cls}" for="${id}"><span class="rot">${esc(c.rotulo)}</span>${input}${ajuda}</label>`;
}

function lerCampos(form, campos) {
  const v = {};
  for (const c of campos) {
    const el = form.elements[c.nome];
    if (c.tipo === 'dias') v[c.nome] = [...form.querySelectorAll(`input[name="${c.nome}"]:checked`)].map(x => +x.value);
    else if (c.tipo === 'checkbox') v[c.nome] = el.checked;
    else if (c.tipo === 'number') v[c.nome] = el.value === '' ? null : parseFloat(el.value);
    else v[c.nome] = el.value.trim();
  }
  return v;
}

function formulario({ titulo, campos, valores = {}, salvar: aoSalvar, excluir: aoExcluir, textoSalvar = 'Salvar' }) {
  const dlg = $('#modal');
  dlg.innerHTML = `<form class="modal-form" novalidate>
    <div class="modal-cab"><h3>${esc(titulo)}</h3><button type="button" class="icon" data-m="cancelar" aria-label="Fechar">${ic('x')}</button></div>
    <div class="modal-corpo"><div class="campos">${campos.map(c => campoHTML(c, valores[c.nome])).join('')}</div></div>
    <div class="modal-acoes">${aoExcluir ? `<button type="button" class="perigo" data-m="excluir">${ic('trash-2')} Excluir</button>` : ''}
      <span class="sp"></span><button type="button" data-m="cancelar">Cancelar</button>
      <button class="primary" type="submit">${esc(textoSalvar)}</button></div></form>`;
  const form = dlg.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    if (!form.checkValidity()) {
      const inv = form.querySelector(':invalid');
      inv.focus(); inv.reportValidity();
      return;
    }
    if (aoSalvar(lerCampos(form, campos)) === false) return;
    dlg.close(); salvar(); render();
  };
  form.querySelectorAll('[data-m=cancelar]').forEach(b => { b.onclick = () => dlg.close(); });
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  if (aoExcluir) form.querySelector('[data-m=excluir]').onclick = () => {
    const desfazer = aoExcluir();
    dlg.close(); salvar(); render();
    aviso('Excluído', typeof desfazer === 'function' ? { texto: 'Desfazer', fn: () => { desfazer(); salvar(); render(); } } : undefined);
  };
  dlg.showModal();
  // no computador o cursor já vai para o primeiro campo; no celular não, para o teclado não cobrir o formulário
  if (matchMedia('(min-width: 900px)').matches) form.querySelector('.campos input:not([type=checkbox]), .campos select, .campos textarea')?.focus();
  else dlg.querySelector('.modal-cab button').focus();
}

// Criar/editar um item de uma lista com o formulário padrão
function crud({ lista, item, titulos, campos, valores, preparar, podeExcluir = true, depois }) {
  const novo = !item;
  formulario({
    titulo: novo ? titulos[0] : titulos[1], campos, valores: valores || item || {},
    salvar: v => {
      if (preparar && preparar(v, item) === false) return false;
      let alvo = item;
      if (novo) { alvo = { id: uid(), ...v }; lista.push(alvo); } else Object.assign(item, v);
      depois?.(alvo, novo);
    },
    excluir: novo || !podeExcluir ? null : () => {
      const i = lista.indexOf(item);
      lista.splice(i, 1);
      return () => lista.splice(i, 0, item);
    },
  });
}

function aplicarTema() {
  const t = db.config.tema;
  if (['light', 'dark', 'jarvis'].includes(t)) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  // fontes do tema Jarvis (licença OFL), carregadas só quando o tema é usado; o service worker guarda para uso offline
  if (t === 'jarvis' && !$('#fontes-jarvis')) {
    const base = 'https://cdn.jsdelivr.net/npm/@fontsource/';
    for (const f of ['rajdhani@5.3.0/500.css', 'rajdhani@5.3.0/600.css', 'rajdhani@5.3.0/700.css', 'orbitron@5.3.0/500.css', 'orbitron@5.3.0/600.css']) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = base + f;
      if (!$('#fontes-jarvis')) l.id = 'fontes-jarvis';
      document.head.appendChild(l);
    }
  }
  for (const m of document.querySelectorAll('meta[name=theme-color]')) m.content = t === 'jarvis' ? '#02070d' : m.media.includes('dark') ? '#0f1218' : '#f3f5f9';
}
