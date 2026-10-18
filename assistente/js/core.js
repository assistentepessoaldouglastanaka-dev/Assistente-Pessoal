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

function aviso(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(aviso.t); aviso.t = setTimeout(() => t.classList.remove('show'), 2400);
}

// ============ Dados ============
function padrao() {
  return {
    versao: 1,
    config: { nome: '', folga: 10, tema: 'auto', ultimoBackup: null },
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

function registrar(m) { Modulos[m.id] = m; ORDEM.push(m.id); }

function montarNav() {
  $('#nav').innerHTML = '<div class="marca">🤖 Assistente <span id="syncStatus" title="Sem sincronização"></span></div>' + ORDEM.map(id =>
    `<a href="#${id}" data-id="${id}"><span class="ic">${Modulos[id].icone}</span><span>${Modulos[id].nome}</span></a>`).join('');
}

function render() {
  const m = Modulos[atual] || Modulos.inicio;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('ativo', a.dataset.id === m.id));
  $('#conteudo').innerHTML = m.render();
  document.title = m.nome + ' · Assistente';
}

function ir(id) { if (atual !== id) location.hash = id; }

function ok(msg) { salvar(); render(); if (msg) aviso(msg); }

// data-acao="modulo:acao" (clique) e data-muda="modulo:acao" (change). Sem "modulo:" usa o módulo atual.
function despachar(attr, e) {
  const el = e.target.closest(`[${attr}]`);
  if (!el || el.closest('dialog')) return;
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
  dlg.innerHTML = `<form class="modal-form"><h3>${esc(titulo)}</h3>
    <div class="campos">${campos.map(c => campoHTML(c, valores[c.nome])).join('')}</div>
    <div class="modal-acoes">${aoExcluir ? '<button type="button" class="perigo" data-m="excluir">Excluir</button>' : ''}
      <span class="sp"></span><button type="button" data-m="cancelar">Cancelar</button>
      <button class="primary" type="submit">${esc(textoSalvar)}</button></div></form>`;
  const form = dlg.querySelector('form');
  form.onsubmit = e => {
    e.preventDefault();
    if (aoSalvar(lerCampos(form, campos)) === false) return;
    dlg.close(); salvar(); render();
  };
  form.querySelector('[data-m=cancelar]').onclick = () => dlg.close();
  if (aoExcluir) form.querySelector('[data-m=excluir]').onclick = () => {
    if (!confirm('Excluir este item?')) return;
    aoExcluir(); dlg.close(); salvar(); render(); aviso('Excluído');
  };
  dlg.showModal();
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
    excluir: novo || !podeExcluir ? null : () => lista.splice(lista.indexOf(item), 1),
  });
}

function aplicarTema() {
  const t = db.config.tema;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
