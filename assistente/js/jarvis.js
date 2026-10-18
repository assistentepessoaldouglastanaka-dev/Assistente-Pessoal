'use strict';
// ============ J.A.R.V.I.S. — assistente de voz ============
// 1) Entende comandos comuns por regras (grátis, instantâneo, offline): gastos, tarefas, eventos, alarmes, consultas.
// 2) O que as regras não entendem vai para a IA gratuita da Cloudflare (Edge Function `jarvis`).
// 3) Ouve e fala pelo navegador (Chrome) ou pelos plugins nativos no app Android.

// ---------- Leitura de números, datas e horários falados ----------
// As regras comparam o texto SEM acentos (s), que tem o mesmo tamanho do texto original (t);
// assim as posições encontradas em s servem para recortar títulos de t, mantendo os acentos.
const semAcento = t => t.split('').map(c => c.normalize('NFD')[0]).join('');

const NUMEROS = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100,
  duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000,
};
// "cento e vinte e cinco" → "125"; "dois mil e quinhentos" → "2500"; "dez e quinze" continua "10 e 15" (horário).
// "um"/"uma" sozinhos ficam como estão (são artigos: "uma tarefa").
function numerosPorExtenso(txt) {
  const tk = txt.split(/(\s+)/), out = [];
  const esp = x => x !== undefined && /^\s+$/.test(x);
  for (let i = 0; i < tk.length; i++) {
    const w = tk[i];
    if (!(w in NUMEROS)) { out.push(w); continue; }
    let total = 0, atual = 0, ult, fim = i, j = i + 1;
    if (w === 'mil') { total = 1000; ult = 1000; } else { atual = NUMEROS[w]; ult = atual; }
    for (;;) {
      if (!esp(tk[j])) break;
      const prox = tk[j + 1];
      if (prox === 'mil' && w !== 'mil' && total === 0) { total = (atual || 1) * 1000; atual = 0; ult = 1000; fim = j + 1; j += 2; continue; }
      if (prox === 'e' && esp(tk[j + 2]) && (tk[j + 3] in NUMEROS) && tk[j + 3] !== 'mil') {
        const n = NUMEROS[tk[j + 3]];
        const cabe = (ult >= 1000 && n < 1000) || (ult >= 100 && ult < 1000 && n < 100) || (ult >= 20 && ult < 100 && ult % 10 === 0 && n < 10);
        if (cabe) { atual += n; ult = n; fim = j + 3; j += 4; continue; }
      }
      break;
    }
    if (fim === i && (w === 'um' || w === 'uma')) { out.push(w); continue; }
    out.push(String(total + atual));
    i = fim;
  }
  return out.join('');
}

const faixa = m => m ? { ini: m.index, fim: m.index + m[0].length } : null;
const DIAS_RE = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const MESES_RE = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function acharData(s) {
  const h = hoje();
  let m;
  if ((m = s.match(/\b(?:para |pra |de )?depois de amanha\b/))) return { iso: somaDias(h, 2), ...faixa(m) };
  if ((m = s.match(/\b(?:para |pra |de )?amanha\b/))) return { iso: somaDias(h, 1), ...faixa(m) };
  if ((m = s.match(/\b(?:para |pra |de )?hoje\b/))) return { iso: h, ...faixa(m) };
  if ((m = s.match(/\bontem\b/))) return { iso: somaDias(h, -1), ...faixa(m) };
  for (let i = 0; i < 7; i++) {
    m = s.match(new RegExp(`\\b(?:(?:para|pra|na|no|nesta|neste|essa|esse|proxim[ao])\\s+)*${DIAS_RE[i]}(?:[- ]?feira)?\\b`));
    if (m) { let d = (i - new Date().getDay() + 7) % 7; if (d === 0) d = 7; return { iso: somaDias(h, d), ...faixa(m) }; }
  }
  if ((m = s.match(/\b(?:(?:para|pra|no|em)\s+)?(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const a = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear();
    let iso = `${a}-${pad(+m[2])}-${pad(+m[1])}`;
    if (!m[3] && iso < h) iso = `${a + 1}-${pad(+m[2])}-${pad(+m[1])}`;
    return { iso, ...faixa(m) };
  }
  if ((m = s.match(new RegExp(`\\b(?:(?:para|pra|no|em)\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${MESES_RE.join('|')})\\b`)))) {
    const mes = MESES_RE.indexOf(m[2]) + 1, a = new Date().getFullYear();
    let iso = `${a}-${pad(mes)}-${pad(+m[1])}`;
    if (iso < h) iso = `${a + 1}-${pad(mes)}-${pad(+m[1])}`;
    return { iso, ...faixa(m) };
  }
  if ((m = s.match(/\b(?:(?:para|pra|no)\s+)?dia\s+(\d{1,2})\b/))) {
    const d = +m[1]; let mes = h.slice(0, 7);
    if (d < +h.slice(8)) mes = somaMes(mes, 1);
    return { iso: diaNoMes(mes, d), ...faixa(m) };
  }
  return null;
}

function acharHora(s) {
  let m;
  if ((m = s.match(/\b(?:ao |as |pro )?meio[- ]dia( e meia)?\b/))) return { hm: m[1] ? '12:30' : '12:00', ...faixa(m) };
  if ((m = s.match(/\b(?:a |pra )?meia[- ]noite\b/))) return { hm: '00:00', ...faixa(m) };
  // grupos: 1 hora · 2 minutos (":30"/"h30") · 3 "meia" ou minutos ("e 15") · 4 período ("da tarde")
  const PER = '(?:\\s+(da manha|da tarde|da noite|da madrugada))?';
  m = s.match(new RegExp(`\\b(?:as|pras?|para as|das|ate as)\\s+(\\d{1,2})(?:\\s*[:h]\\s*(\\d{2})|\\s+e\\s+(meia|\\d{1,2})|\\s*h(?:oras?)?\\b)?${PER}`))
    || s.match(new RegExp(`\\b(\\d{1,2})(?:\\s*[:h]\\s*(\\d{2})|\\s+e\\s+(meia)|\\s*h(?:oras?)?\\b)${PER}`));
  if (!m) return null;
  let hh = +m[1];
  const mm = m[2] ? +m[2] : m[3] ? (m[3] === 'meia' ? 30 : +m[3]) : 0;
  if ((m[4] === 'da tarde' || m[4] === 'da noite') && hh < 12) hh += 12;
  if (hh > 23 || mm > 59) return null;
  return { hm: `${pad(hh)}:${pad(mm)}`, ...faixa(m) };
}

function acharValor(s) {
  const conv = x => x.includes(',') ? parseFloat(x.replace(/\./g, '').replace(',', '.'))
    : /\.\d{3}\b/.test(x) ? parseFloat(x.replace(/\./g, '')) : parseFloat(x);
  const m = s.match(/r\$\s*(\d[\d.]*(?:,\d{1,2})?)(?:\s+e\s+(\d{1,2})\s+centavos?)?(?:\s*(?:reais|real))?/)
    || s.match(/(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|real|conto|contos|pila)(?:\s+e\s+(\d{1,2})\s+centavos?)?/)
    || s.match(/\b(\d[\d.]*(?:,\d{1,2})?)\b/);
  if (!m) return null;
  let v = conv(m[1]);
  if (m[2]) v += +m[2] / 100;
  return isFinite(v) && v > 0 ? { valor: Math.round(v * 100) / 100, ...faixa(m) } : null;
}

const CATEGORIA_PALAVRAS = [
  ['Alimentação', /mercado|padaria|restaurante|lanche|almoco|jantar|ifood|comida|pizza|acougue|feira|\bcafe\b|hamburguer|sushi|delivery|sorvete/],
  ['Transporte', /\buber\b|\b99\b|taxi|gasolina|combustivel|estacionamento|pedagio|onibus|metro|\bposto\b|alcool|etanol/],
  ['Saúde', /farmacia|remedio|medico|consulta|exame|dentista|academia|suplemento|nutricionista|plano de saude/],
  ['Assinaturas', /netflix|spotify|assinatura|\bprime\b|disney|youtube|icloud|google one|globoplay/],
  ['Contas', /\bluz\b|\bagua\b|energia|internet|telefone|celular|\bconta\b|\bgas\b|condominio|boleto|fatura/],
  ['Moradia', /aluguel|reforma|moveis|diarista|faxina/],
  ['Educação', /curso|livro|faculdade|escola|\baula\b|mensalidade/],
  ['Lazer', /cinema|\bshow\b|\bbar\b|cerveja|viagem|passeio|\bjogo\b|ingresso|balada/],
  ['Compras', /roupa|tenis|shopping|amazon|presente|eletronico|mercado livre|shopee/],
];
const categoriaDe = s => (CATEGORIA_PALAVRAS.find(([, re]) => re.test(s)) || ['Outros'])[0];

// Apaga de t as faixas já entendidas e as palavras de comando (procuradas em s) e devolve o assunto
function limpar(t, faixas, verbos) {
  const c = t.split('');
  const apagar = (i, f) => { for (let k = i; k < f; k++) c[k] = ' '; };
  for (const f of faixas.filter(Boolean)) apagar(f.ini, f.fim);
  if (verbos) for (const m of semAcento(c.join('')).matchAll(verbos)) apagar(m.index, m.index + m[0].length);
  let r = c.join('').replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  // tira preposições/artigos soltos nas pontas
  const PONTA = '(de|do|da|dos|das|no|na|em|com|para|pra|pro|um|uma|o|a|os|as|às|e|que|por)';
  for (let k = 0; k < 3; k++) r = r.replace(new RegExp(`^${PONTA}\\s+`, 'i'), '').replace(new RegExp(`\\s+${PONTA}$`, 'i'), '');
  if (/^(de|do|da|no|na|em|com|para|pra|um|uma|o|a|e|que|por)$/i.test(r)) r = '';
  return r ? r[0].toUpperCase() + r.slice(1) : '';
}

const falarValor = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const falarData = iso => iso === hoje() ? 'hoje' : iso === somaDias(hoje(), 1) ? 'amanhã'
  : deISO(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const falarHora = hm => { const [h, m] = hm.split(':').map(Number); return m ? `${h} e ${m}` : `${h} ${h === 1 ? 'hora' : 'horas'}`; };

// ---------- Clima (Open-Meteo, gratuito e sem chave) ----------
const Clima = {
  CODIGOS: { 0: 'céu limpo', 1: 'predomínio de sol', 2: 'parcialmente nublado', 3: 'nublado', 45: 'neblina', 48: 'neblina', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte',
    61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 80: 'pancadas de chuva', 81: 'pancadas de chuva', 82: 'pancadas fortes de chuva', 95: 'trovoadas', 96: 'trovoadas com granizo', 99: 'trovoadas com granizo' },
  coords() {
    try { const c = JSON.parse(localStorage.getItem('assistente.local')); if (c?.lat) return Promise.resolve(c); } catch (e) {}
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => {
        const c = { lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) };
        try { localStorage.setItem('assistente.local', JSON.stringify(c)); } catch (e) {}
        res(c);
      }, () => res(null), { timeout: 8000, maximumAge: 86400000 });
    });
  },
  async agora() {
    const c = await this.coords();
    if (!c) return null;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto`);
      const d = await r.json();
      return { temp: Math.round(d.current.temperature_2m), desc: this.CODIGOS[d.current.weather_code] || 'tempo variável',
        max: Math.round(d.daily.temperature_2m_max[0]), min: Math.round(d.daily.temperature_2m_min[0]), chuva: d.daily.precipitation_probability_max[0],
        chuvaAmanha: d.daily.precipitation_probability_max[1], maxAmanha: Math.round(d.daily.temperature_2m_max[1]) };
    } catch (e) { return null; }
  },
};

// ---------- Voz: ouvir e falar (navegador ou plugins do Android) ----------
const Voz = {
  rec: null, falando: false,
  get SR() { return window.SpeechRecognition || window.webkitSpeechRecognition; },
  podeOuvir() { return Nativo.ativo ? !!Nativo.P.SpeechRecognition : !!this.SR; },
  podeFalar() { return Nativo.ativo ? !!Nativo.P.TextToSpeech : 'speechSynthesis' in window; },
  async ouvir(aoParcial) {
    if (Nativo.ativo) {
      const S = Nativo.P.SpeechRecognition;
      const perm = await S.checkPermissions().catch(() => ({}));
      if (perm.speechRecognition !== 'granted') await S.requestPermissions();
      const { matches } = await S.start({ language: 'pt-BR', maxResults: 1, partialResults: false, popup: false });
      return matches?.[0] || '';
    }
    return new Promise((resolve, reject) => {
      const r = new this.SR();
      this.rec = r;
      r.lang = 'pt-BR'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      let final = '';
      r.onresult = e => {
        let parcial = '';
        for (const res of e.results) { if (res.isFinal) final = res[0].transcript; else parcial += res[0].transcript; }
        aoParcial?.(final || parcial);
      };
      r.onerror = e => { this.rec = null; e.error === 'no-speech' || e.error === 'aborted' ? resolve('') : reject(new Error(e.error)); };
      r.onend = () => { this.rec = null; resolve(final); };
      r.start();
    });
  },
  pararDeOuvir() {
    if (Nativo.ativo) Nativo.P.SpeechRecognition?.stop().catch(() => {});
    else this.rec?.abort();
  },
  // ----- Escolha da voz (cada aparelho tem as suas; a escolha fica salva só neste aparelho) -----
  // No Android a lista completa tem centenas de vozes e pode demorar: fica guardada no aparelho e
  // é atualizada em segundo plano, sem nunca atrasar a fala.
  lista: [], carregando: null, situacao: '', tentativas: 0, total: 0,
  lerCache() {
    try { const c = JSON.parse(localStorage.getItem('assistente.vozes')); if (Array.isArray(c) && c.length) this.lista = c; } catch (e) {}
    return this.lista;
  },
  // O mecanismo de voz do Android leva alguns segundos para ficar pronto depois que o app abre:
  // se a busca falhar (ou vier vazia), tenta de novo sozinha por até ~1 minuto.
  carregarVozes(manual = false) {
    if (this.carregando) return this.carregando;
    if (manual) this.tentativas = 0;
    this.situacao = 'carregando';
    this.carregando = (async () => {
      try {
        const brutas = Nativo.ativo ? (await Nativo.P.TextToSpeech.getSupportedVoices()).voices : speechSynthesis.getVoices();
        this.total = brutas?.length || 0;
        const lista = (brutas || []).map((v, idx) => ({ id: v.voiceURI || v.name, nome: v.name, lang: (v.lang || '').replace('_', '-'), idx }))
          .filter(v => /^pt/i.test(v.lang) && !/-language$/.test(v.id))
          .map(v => ({ ...v, rotulo: this.rotulo(v), nota: this.pontuar(v) }))
          .sort((a, b) => b.nota - a.nota);
        if (lista.length) {
          this.lista = lista;
          this.situacao = 'ok';
          this.tentativas = 0;
          if (Nativo.ativo) try { localStorage.setItem('assistente.vozes', JSON.stringify(lista)); } catch (e) {}
        } else this.situacao = this.total ? 'sem-portugues' : 'vazio';
      } catch (e) {
        this.situacao = 'erro: ' + (e?.message || e);
      }
      this.carregando = null;
      if (this.situacao !== 'ok' && this.situacao !== 'sem-portugues' && this.tentativas < 6) {
        this.tentativas++;
        setTimeout(() => this.carregarVozes(), 2500 * this.tentativas);
      }
      if (atual === 'geral' && !document.querySelector('dialog[open]')) render();
      return this.lista;
    })();
    return this.carregando;
  },
  // Texto para a tela de ajustes
  descricaoSituacao() {
    if (this.lista.length) return `${this.lista.length} vozes em português encontradas neste aparelho.`;
    if (this.situacao === 'carregando' || (!this.situacao && Nativo.ativo)) return 'Procurando as vozes do aparelho... (pode levar alguns segundos)';
    if (this.situacao === 'sem-portugues') return `O aparelho tem ${this.total} vozes, mas nenhuma em português. Instale as vozes em português nas configurações de "Saída de texto para fala".`;
    if (this.situacao === 'vazio') return 'O mecanismo de voz do aparelho ainda não respondeu.';
    if (this.situacao.startsWith('erro')) return 'O mecanismo de voz respondeu com erro: ' + this.situacao.slice(6);
    return '';
  },
  // Vozes masculinas e "naturais/neurais" (as mais humanas) primeiro
  pontuar(v) {
    const n = (v.nome + ' ' + v.id).toLowerCase();
    let p = /pt-br/i.test(v.lang) ? 50 : 0;
    if (/antonio|daniel|thiago|f[aá]bio|donato|humberto|julio|nicolau|valerio|ricardo|male\b|masculin|homem|-x-pte/.test(n)) p += 40;
    if (/-x-ptd/.test(n)) p += 10;
    if (/francisca|maria|luciana|vit[oó]ria|thalita|leila|brenda|elza|yara|female|feminin|mulher|-x-afs|google portugu/.test(n)) p -= 40;
    if (/natural|neural|online|enhanced|premium|network/.test(n)) p += 15;
    return p;
  },
  rotulo(v) {
    // Android/Google: o nome de exibição é igual para todas ("Portuguese Brazil"); o que muda é o identificador
    const g = v.id.match(/^pt-(br|pt)-x-(\w+)-(local|network)/i);
    if (g) return `Voz ${g[2].slice(-1).toUpperCase()}${g[1].toLowerCase() === 'pt' ? ' (Portugal)' : ''} · ${g[3] === 'network' ? 'online, mais natural' : 'offline'}`;
    return v.nome.replace(/ - Portuguese \((Brazil|Portugal)\)| \((Brazil|Portugal)\)/i, '');
  },
  escolhida() {
    let salvo = null;
    try { salvo = localStorage.getItem('assistente.voz'); } catch (e) {}
    return this.lista.find(v => v.id === salvo) || this.lista[0] || null;
  },
  escolher(id) { try { localStorage.setItem('assistente.voz', id); } catch (e) {} },
  ajustes() {
    const J = db.config.jarvis;
    return { rate: { devagar: 0.88, normal: 1.0, rapido: 1.15 }[J.velocidade || 'normal'], pitch: { grave: 0.85, normal: 1.0 }[J.tom || 'normal'] };
  },
  async falar(texto, forcar = false) {
    if ((!db.config.jarvis.voz && !forcar) || !texto || !this.podeFalar()) return;
    if (!this.lista.length) { this.lerCache(); if (!this.lista.length) this.carregarVozes(); }  // nunca espera a lista
    const v = this.escolhida(), { rate, pitch } = this.ajustes();
    this.falando = true;
    try {
      if (Nativo.ativo) {
        const pedido = { text: texto, lang: v?.lang || 'pt-BR', rate, pitch, volume: 1, ...(v ? { voice: v.idx } : {}) };
        try { await Nativo.P.TextToSpeech.speak(pedido); }
        catch (e) {
          // o mecanismo de voz do Android pode ainda estar iniciando (ou a voz escolhida sumiu): tenta de novo
          await new Promise(r => setTimeout(r, 1500));
          await Nativo.P.TextToSpeech.speak({ text: texto, lang: 'pt-BR', rate, pitch, volume: 1, ...(v ? { voice: v.idx } : {}) })
            .catch(() => Nativo.P.TextToSpeech.speak({ text: texto, lang: 'pt-BR', rate, pitch, volume: 1 }));
        }
      } else await new Promise(res => {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = v?.lang || 'pt-BR'; u.rate = rate; u.pitch = pitch;
        const obj = v && speechSynthesis.getVoices().find(x => (x.voiceURI || x.name) === v.id);
        if (obj) u.voice = obj;
        u.onend = u.onerror = res;
        speechSynthesis.speak(u);
      });
    } catch (e) { /* sem voz: o texto continua na tela */ }
    this.falando = false;
  },
  calar() {
    if (Nativo.ativo) Nativo.P.TextToSpeech?.stop().catch(() => {});
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.falando = false;
  },
};
// As vozes do navegador chegam depois de carregar a página
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => Voz.carregarVozes().then(() => { if (atual === 'geral' && !document.querySelector('dialog[open]')) render(); });
// Lista de vozes: usa a guardada na hora e atualiza em segundo plano (no Android, depois que o mecanismo de voz inicia)
Voz.lerCache();
setTimeout(() => Voz.carregarVozes(), window.Capacitor?.isNativePlatform?.() ? 4000 : 800);

// ---------- Palavra de ativação "Jarvis" ----------
const PALAVRA_RE = /\b(jarvis|jarv[ie]s|djarvis|j[áa]rvis|jarbas|jarvas)\b[\s,.:!]*/i;
const Escuta = {
  rec: null, ligada: false,
  pode() { return !Nativo.ativo && !!Voz.SR; },
  ligar() {
    if (!this.pode() || this.rec || !db.config.jarvis.palavra || document.hidden || Jarvis.ocupado()) return;
    const r = new Voz.SR();
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = false;
    r.onresult = e => {
      const t = e.results[e.results.length - 1][0].transcript;
      const m = t.match(PALAVRA_RE);
      if (!m) return;
      const comando = t.slice(m.index + m[0].length).trim();
      this.desligar();
      Jarvis.abrir({ comando: comando.length > 2 ? comando : null, ouvir: comando.length <= 2 });
    };
    r.onend = () => { this.rec = null; setTimeout(() => this.ligar(), 400); };
    r.onerror = e => { if (e.error === 'not-allowed') { db.config.jarvis.palavra = false; salvar(); aviso('Sem permissão do microfone para ouvir "Jarvis".'); } };
    try { r.start(); this.rec = r; this.ligada = true; } catch (e) { this.rec = null; }
  },
  desligar() {
    const r = this.rec; this.rec = null; this.ligada = false;
    if (r) { r.onend = null; try { r.abort(); } catch (e) {} }
  },
};
document.addEventListener('visibilitychange', () => { if (document.hidden) Escuta.desligar(); else Escuta.ligar(); });

// ---------- Reator (desenho) ----------
let _reatorN = 0;
function reator(cls = '') {
  const id = 'rg' + (++_reatorN);
  const raios = Array.from({ length: 10 }, (_, i) => `<rect x="96" y="44" width="8" height="16" rx="2" transform="rotate(${i * 36} 100 100)"/>`).join('');
  return `<svg class="reator ${cls}" viewBox="0 0 200 200" aria-hidden="true">
    <defs><radialGradient id="${id}"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="var(--reator-claro)"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>
    <circle class="r-aro" cx="100" cy="100" r="96"/>
    <circle class="r-seg r-gira" cx="100" cy="100" r="86" pathLength="100" stroke-dasharray="7 3"/>
    <circle class="r-seg2 r-gira-inv" cx="100" cy="100" r="74" pathLength="100" stroke-dasharray="1 2"/>
    <g class="r-raios">${raios}</g>
    <circle class="r-anel" cx="100" cy="100" r="36"/>
    <circle class="r-nucleo" cx="100" cy="100" r="30" fill="url(#${id})"/>
  </svg>`;
}

// ---------- O assistente ----------
const Jarvis = {
  estado: 'parado', // parado | ouvindo | pensando | falando
  conversa: [], historico: [], parcial: '',

  ocupado() { return this.estado !== 'parado' || $('#jarvis')?.classList.contains('aberto'); },
  tratamento() { return db.config.jarvis.tratamento === 'nome' && db.config.nome ? db.config.nome : 'senhor'; },

  // ----- Painel -----
  montar() {
    const el = document.createElement('div');
    el.id = 'jarvis';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Jarvis');
    el.innerHTML = `<div class="jv-caixa">
      <div class="jv-topo"><span class="jv-marca">J.A.R.V.I.S.</span><span class="sp"></span>
        <button class="icon" data-jv="fechar" aria-label="Fechar">${ic('x')}</button></div>
      <button class="jv-reator" data-jv="ouvir" aria-label="Falar com o Jarvis">${reator()}</button>
      <div class="jv-estado" aria-live="polite"></div>
      <div class="jv-conversa"></div>
      <div class="jv-sugestoes">${['Resumo do dia', 'O que tenho amanhã?', 'Quanto gastei este mês?', 'Minhas tarefas', 'Gastei 50 reais no mercado']
        .map(s => `<button class="mini" data-jv="sugestao">${s}</button>`).join('')}</div>
      <form class="jv-entrada"><input type="text" placeholder="Digite ou toque no reator para falar" aria-label="Mensagem para o Jarvis" autocomplete="off">
        <button class="icon" type="submit" aria-label="Enviar">${ic('navigation')}</button></form>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-jv]');
      if (e.target === el) return this.fechar();
      if (!b) return;
      const a = b.dataset.jv;
      if (a === 'fechar') this.fechar();
      else if (a === 'ouvir') this.estado === 'ouvindo' ? Voz.pararDeOuvir() : this.estado === 'falando' ? (Voz.calar(), this.definir('parado')) : this.ouvir();
      else if (a === 'sugestao') this.processar(b.textContent);
      else if (a === 'desfazer') { const fn = this.desfazeres[b.dataset.i]; if (fn) { fn(); delete this.desfazeres[b.dataset.i]; b.remove(); ok(); this.dizer('Desfeito.', false); } }
    });
    el.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const i = el.querySelector('input'), t = i.value.trim();
      if (t) { i.value = ''; this.processar(t); }
    };
  },
  abrir({ comando = null, ouvir = false } = {}) {
    if (!$('#jarvis')) this.montar();
    const el = $('#jarvis');
    el.classList.add('aberto');
    document.body.classList.add('jv-aberto');
    Escuta.desligar();
    this.renderConversa();
    if (!this.conversa.length && !comando) this.dizer(`Às suas ordens, ${this.tratamento()}.`, ouvir ? false : true);
    if (comando) this.processar(comando);
    else if (ouvir && Voz.podeOuvir()) this.ouvir();
    else if (!Voz.podeOuvir() || matchMedia('(min-width: 900px)').matches) el.querySelector('input').focus();
  },
  fechar() {
    $('#jarvis')?.classList.remove('aberto');
    document.body.classList.remove('jv-aberto');
    Voz.pararDeOuvir(); Voz.calar();
    this.definir('parado');
    setTimeout(() => Escuta.ligar(), 300);
  },
  definir(estado, texto) {
    this.estado = estado;
    const el = $('#jarvis');
    if (!el) return;
    el.dataset.estado = estado;
    el.querySelector('.jv-estado').textContent = texto ?? { parado: Voz.podeOuvir() ? 'Toque no reator para falar' : 'Digite sua mensagem', ouvindo: 'Ouvindo...', pensando: 'Processando...', falando: 'Falando...' }[estado];
  },
  desfazeres: {},
  renderConversa() {
    const c = $('#jarvis .jv-conversa');
    if (!c) return;
    c.innerHTML = this.conversa.slice(-12).map(m => `<div class="jv-msg ${m.de}">${esc(m.texto)}${m.desfazer != null && this.desfazeres[m.desfazer]
      ? ` <button class="mini" data-jv="desfazer" data-i="${m.desfazer}">${ic('undo-2', 'ic-sm')} Desfazer</button>` : ''}</div>`).join('');
    c.scrollTop = c.scrollHeight;
    this.definir(this.estado);
  },
  async ouvir() {
    Voz.calar();
    this.definir('ouvindo');
    try {
      const t = await Voz.ouvir(p => { this.definir('ouvindo', p || 'Ouvindo...'); });
      if (t) await this.processar(t); else this.definir('parado');
    } catch (e) {
      this.definir('parado', e.message === 'not-allowed' ? 'Permita o uso do microfone para falar comigo.' : 'Não consegui ouvir. Tente de novo ou digite.');
    }
  },
  async dizer(texto, falarTexto = true, desfazer) {
    let id = null;
    if (desfazer) { id = String(Date.now()); this.desfazeres[id] = desfazer; }
    this.conversa.push({ de: 'jv', texto, desfazer: id });
    this.historico.push({ role: 'assistant', content: texto });
    this.renderConversa();
    if (falarTexto && db.config.jarvis.voz) { this.definir('falando'); await Voz.falar(texto); }
    this.definir('parado');
  },

  // ----- Entender e agir -----
  async processar(textoOriginal) {
    const original = textoOriginal.trim();
    this.conversa.push({ de: 'eu', texto: original });
    this.historico.push({ role: 'user', content: original });
    this.renderConversa();
    this.definir('pensando');
    let r;
    try { r = await this.entender(original); } catch (e) { console.warn(e); r = null; }
    if (!r) r = await this.ia(original);
    await this.dizer(r.texto, true, r.desfazer);
  },

  // Texto normalizado: t (com acentos) e s (sem acentos, mesmo tamanho) para as regras
  async entender(original) {
    const t = numerosPorExtenso(original.normalize('NFC').toLowerCase().replace(PALAVRA_RE, '').replace(/[“”"]/g, '').trim());
    return this.regras(t, semAcento(t), original);
  },

  async regras(t, s, original) {
    const T = this.tratamento();
    let m;
    const remover = (lista, item) => () => { const i = lista.indexOf(item); if (i >= 0) lista.splice(i, 1); };

    // Conversa
    if (/^(bom dia|boa tarde|boa noite|resumo( do dia)?|briefing|como (esta|vai) (o )?meu dia|me atualiza|status)\b/.test(s)) return { texto: await this.briefing() };
    if (/\b(obrigad[oa]|valeu)\b/.test(s)) return { texto: `Sempre às ordens, ${T}.` };
    if (/que horas? (sao|e)\b/.test(s)) return { texto: `São ${falarHora(hhmm(agoraMin()))}, ${T}.` };
    if (/que dia e hoje|qual (e )?a data/.test(s)) return { texto: `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` };

    // Navegar
    if ((m = s.match(/^(abr[ae]|abrir|mostr[ae]|mostrar|va para|ir para|me leva para)\s+(?:a |o |as |os |minhas? |meus? )?([a-z-]+)/))) {
      const destinos = { inicio: 'inicio', agenda: 'agenda', tarefas: 'pessoal', trabalho: 'trabalho', pessoal: 'pessoal', financas: 'financas', gastos: 'financas',
        treinos: 'treinos', treino: 'treinos', nutricao: 'nutricao', alarmes: 'alarmes', alarme: 'alarmes', gmail: 'gmail', 'e-mails': 'gmail', emails: 'gmail', trajetos: 'trajetos', notas: 'geral', ajustes: 'geral' };
      const id = destinos[m[2]];
      if (id) { ir(id); setTimeout(() => this.fechar(), 1400); return { texto: `Abrindo ${Modulos[id].nome}.` }; }
    }

    // Gasto: "gastei 80 reais no mercado", "paguei 120 de luz ontem"
    const pergunta = /^(quanto|qual|quais|como|onde|quando|o que)\b|\?$/.test(s.trim());
    if (!pergunta && /\b(gastei|paguei|comprei|lanca(r)?( um| o)? gasto|anota(r)?( um| o)? gasto|registra(r)?( um| o)? gasto|novo gasto)\b/.test(s)) {
      const v = acharValor(s);
      if (!v) return { texto: `De quanto foi o gasto, ${T}?` };
      const d = acharData(s);
      const nome = limpar(t, [v, d], /\b(gastei|paguei|comprei|lancar?|anotar?|registrar?|novo|gasto|reais|real|por)\b/g) || 'Gasto';
      const g = { id: uid(), nome, valor: v.valor, categoria: categoriaDe(s), data: d && d.iso <= hoje() ? d.iso : hoje() };
      db.financas.variaveis.push(g); ok();
      return { texto: `Feito. Lancei ${falarValor(g.valor)} em ${g.categoria}: ${g.nome}${g.data !== hoje() ? ', ' + falarData(g.data) : ''}.`, desfazer: remover(db.financas.variaveis, g) };
    }

    // Alarme: "me acorda às 6 e meia", "alarme às 7 nos dias úteis"
    if (/\b(me acord[ae]|alarme|despertador|desperta(r)?)\b/.test(s)) {
      const h = acharHora(s) || ((m = s.match(/\b(\d{1,2})\b/)) && +m[1] < 24 ? { hm: `${pad(+m[1])}:00`, ...faixa(m) } : null);
      if (!h) return { texto: `Para que horas, ${T}?` };
      const dias = /todo(s os)? dias?|diariamente/.test(s) ? [0, 1, 2, 3, 4, 5, 6] : /dias uteis|segunda a sexta|durante a semana/.test(s) ? [1, 2, 3, 4, 5]
        : /fim de semana|fins de semana/.test(s) ? [0, 6] : [];
      const d = dias.length ? null : acharData(s);
      const rotulo = /acord/.test(s) ? 'Acordar' : limpar(t, [h, d],
        /\b(cria(r)?|coloca(r)?|poe|define|um|alarme|despertador|desperta(r)?|todo(s os)? dias?|diariamente|nos dias uteis|dias uteis|de segunda a sexta|durante a semana|nos fins de semana|no fim de semana|fins? de semana)\b/g) || 'Alarme';
      const a = { id: uid(), hora: h.hm, rotulo, dias, ativo: true, data: dias.length ? null : d?.iso || (minutos(h.hm) > agoraMin() ? hoje() : somaDias(hoje(), 1)) };
      db.alarmes.push(a); ok();
      return { texto: `Alarme ${rotulo !== 'Alarme' ? rotulo.toLowerCase() + ' ' : ''}às ${h.hm}${dias.length ? ', ' + Alarmes.descricaoDias(a).toLowerCase() : ''}. ${Alarmes.emQuanto(a)}.`, desfazer: remover(db.alarmes, a) };
    }

    // Lembrete: "me lembra de ligar pro banco às 15h" (com hora → alarme; sem hora → tarefa)
    if ((m = s.match(/\b(me lembr[ae]|lembrete)\b(\s+(de|para|pra|que))?/))) {
      const h = acharHora(s), d = acharData(s);
      const assunto = limpar(t, [h, d, faixa(m)]) || 'Lembrete';
      if (h) {
        const a = { id: uid(), hora: h.hm, rotulo: assunto, dias: [], ativo: true, data: d?.iso || (minutos(h.hm) > agoraMin() ? hoje() : somaDias(hoje(), 1)) };
        db.alarmes.push(a); ok();
        return { texto: `Vou lembrar ${falarData(a.data)} às ${h.hm}: ${a.rotulo}.`, desfazer: remover(db.alarmes, a) };
      }
      const tarefa = { id: uid(), area: 'pessoal', titulo: assunto, status: 'afazer', prioridade: 'media', prazo: d?.iso || '', projeto: '' };
      db.tarefas.push(tarefa); ok();
      return { texto: `Anotado como tarefa${tarefa.prazo ? ' para ' + falarData(tarefa.prazo) : ''}: ${tarefa.titulo}.`, desfazer: remover(db.tarefas, tarefa) };
    }

    // Evento: "marca dentista quinta às 10", "reunião com o cliente amanhã às 3 da tarde"
    const dEv = acharData(s), hEv = acharHora(s);
    if (/\b(marca(r)?|agenda(r)?|cria(r)? (um )?evento|novo evento|tenho (uma )?(reuniao|consulta|compromisso)|reuniao|consulta)\b/.test(s) && (dEv || hEv)
        && !/\b(o que|quais|que horas|qual)\b/.test(s)) {
      const titulo = limpar(t, [dEv, hEv], /\b(marca(r)?|agenda(r)?|cria(r)?|novo|evento|tenho|na agenda|um|uma)\b/g) || 'Compromisso';
      const v = { titulo, data: dEv?.iso || hoje(), inicio: hEv?.hm || '', fim: '', local: '', rotaId: '', alerta: hEv ? '15' : '', repetir: 'nao', ate: '',
        tipo: /reuniao|cliente|trabalho|projeto/.test(s) ? 'trabalho' : /medico|dentista|academia|consulta|exame/.test(s) ? 'saude' : 'pessoal', notas: '' };
      const quando = `${falarData(v.data)}${v.inicio ? ' às ' + v.inicio : ''}`;
      if (GAgenda.ativa()) {
        try {
          const ev = await Google.api(CAL, { metodo: 'POST', corpo: GAgenda.paraGoogle(v) });
          GAgenda.carregar().then(() => Google.render());
          return { texto: `Marcado no Google Agenda: ${titulo}, ${quando}.`,
            desfazer: () => { Google.api(`${CAL}/${encodeURIComponent(ev.id)}`, { metodo: 'DELETE' }).then(() => GAgenda.carregar()).then(() => Google.render()); } };
        } catch (e) { return { texto: `Não consegui falar com o Google Agenda agora, ${T}.` }; }
      }
      const ev = { id: uid(), ...v };
      db.eventos.push(ev); ok();
      return { texto: `Marcado: ${titulo}, ${quando}.`, desfazer: remover(db.eventos, ev) };
    }

    // Tarefa: "cria uma tarefa de trabalho revisar contrato até sexta", "preciso comprar ração amanhã"
    if ((m = s.match(/\b(cria(r)?|adiciona(r)?|anota(r)?|nova|coloca(r)?|poe)( uma)? tarefa\b|\b(preciso|tenho que|nao posso esquecer de)\b/))) {
      const d = acharData(s);
      const area = /\btrabalho\b|cliente|projeto/.test(s) ? 'trabalho' : 'pessoal';
      const titulo = limpar(t, [d, faixa(m)], /\b((de|do|no|para o|pro) )?trabalho\b|\b(pessoal|tarefa|ate)\b/g);
      if (!titulo) return { texto: `Qual é a tarefa, ${T}?` };
      const tarefa = { id: uid(), area, titulo, status: 'afazer', prioridade: /urgente|important/.test(s) ? 'alta' : 'media', prazo: d?.iso || '', projeto: '' };
      db.tarefas.push(tarefa); ok();
      return { texto: `Tarefa ${area === 'trabalho' ? 'do trabalho' : 'pessoal'} criada${tarefa.prazo ? ' para ' + falarData(tarefa.prazo) : ''}: ${titulo}.`, desfazer: remover(db.tarefas, tarefa) };
    }

    // ----- Consultas -----
    if (/(que horas|quando|a que horas) (eu )?(preciso |tenho que |devo )?sair/.test(s)) {
      const prox = [hoje(), somaDias(hoje(), 1)].flatMap(iso => Agenda.eventosDoDia(iso).map(ev => ({ iso, ev, s: Agenda.horaSaida(ev) })))
        .find(x => x.s && (x.iso > hoje() || x.s >= hhmm(agoraMin())));
      return { texto: prox ? `Para ${prox.ev.titulo}, ${falarData(prox.iso)} às ${prox.ev.inicio}, saia às ${prox.s}.` : `Não há deslocamentos programados, ${T}. Associe um trajeto ao evento para eu calcular.` };
    }
    if ((/\b(agenda|compromissos?|eventos?|reunioes)\b|o que (eu )?tenho\b|(tenho|ha) algo/.test(s)) && !/tarefa/.test(s)) {
      const iso = dEv?.iso || hoje();
      const evs = Agenda.eventosDoDia(iso).filter(e => iso !== hoje() || !e.inicio || e.inicio >= hhmm(agoraMin()));
      if (!evs.length) return { texto: `Nada na agenda ${falarData(iso)}, ${T}.` };
      const dia = falarData(iso);
      return { texto: `${dia[0].toUpperCase() + dia.slice(1)} você tem ${plural(evs.length, 'compromisso', 'compromissos')}: ` +
        evs.slice(0, 4).map(e => `${e.inicio ? 'às ' + e.inicio + ', ' : ''}${e.titulo}`).join('; ') + '.' };
    }
    if (/\b(tarefas?|pendencias?)\b|o que (eu )?(preciso|tenho que) fazer/.test(s)) {
      const area = /trabalho/.test(s) ? 'trabalho' : /pesso/.test(s) ? 'pessoal' : null;
      const pend = db.tarefas.filter(x => x.status !== 'feito' && (!area || x.area === area)).sort(Tarefas.ordenar);
      if (!pend.length) return { texto: `Nenhuma tarefa pendente${area ? ' no ' + area : ''}, ${T}. Impressionante.` };
      const atras = pend.filter(x => x.prazo && x.prazo < hoje()).length;
      return { texto: `${plural(pend.length, 'tarefa pendente', 'tarefas pendentes')}${atras ? `, ${atras} atrasada${atras > 1 ? 's' : ''}` : ''}. As principais: ${pend.slice(0, 3).map(x => x.titulo).join('; ')}.` };
    }
    if (/\b(contas?|boletos?|parcelas?)\b.*\b(pagar|vencend|vence|vencem)|o que vence/.test(s)) {
      const cs = Financas.aVencer(7);
      if (!cs.length) return { texto: `Nenhuma conta vencendo nos próximos 7 dias, ${T}.` };
      return { texto: `${plural(cs.length, 'conta', 'contas')} nos próximos dias: ` + cs.slice(0, 4).map(c => `${c.nome}, ${falarValor(c.valor)}, ${falarData(c.data)}`).join('; ') + '.' };
    }
    if (/quanto (eu )?gastei|meus gastos|\bsaldo\b|minhas financas|como (estao|anda|andam) (as |minhas )?financas|orcamento/.test(s)) {
      const r = Financas.resumo(chaveMes(new Date()));
      const cat = /quanto (eu )?gastei/.test(s) && CATEGORIA_PALAVRAS.find(([, re]) => re.test(s));
      if (cat) {
        const tot = soma([...r.fixos, ...r.vars].filter(g => g.categoria === cat[0]), 'valor');
        return { texto: `Este mês você gastou ${falarValor(tot)} em ${cat[0]}.` };
      }
      const top = Object.entries([...r.fixos, ...r.vars].reduce((o, g) => (o[g.categoria] = (o[g.categoria] || 0) + g.valor, o), {})).sort((a, b) => b[1] - a[1])[0];
      return { texto: `Este mês: ${falarValor(r.total)} em gastos${r.renda ? ` de uma renda de ${falarValor(r.renda)}. Saldo previsto de ${falarValor(r.saldo)}` : ''}.` +
        (top ? ` A maior categoria é ${top[0]}, com ${falarValor(top[1])}.` : '') + (r.saldo < 0 ? ` Atenção, ${T}: o mês está no negativo.` : '') };
    }
    if (/\btreino\b|academia hoje|treinar hoje/.test(s)) {
      const tr = Treinos.deHoje();
      return { texto: tr.andamento ? `${tr.modelo?.nome || 'O treino'} está em andamento.` : tr.feito ? `Treino de hoje concluído, ${T}. Excelente.`
        : tr.modelo ? `Hoje é ${tr.modelo.nome}, com ${plural(tr.modelo.exercicios.length, 'exercício', 'exercícios')}.` : `Hoje é dia de descanso, ${T}.` };
    }
    if (/\b(peso|gordura|bioimped|massa muscular|composicao corporal|musculo)\b/.test(s)) {
      const v = Nutricao.validas(), u = v[v.length - 1], a = v[v.length - 2];
      if (!u) return { texto: `Ainda não há avaliações de bioimpedância, ${T}.` };
      const num = x => String(x).replace('.', ',');
      const dif = (k, un) => a?.[k] != null && u[k] !== a[k] ? ` (${u[k] > a[k] ? 'subiu' : 'caiu'} ${num(Math.abs(+(u[k] - a[k]).toFixed(1)))} ${un})` : '';
      return { texto: `Última avaliação em ${fmtData(u.data)}: ${num(u.peso)} quilos${dif('peso', 'quilos')}, gordura de ${num(u.gorduraPct)} por cento${dif('gorduraPct', 'pontos')} e massa muscular de ${num(u.massaMuscularKg)} quilos.` };
    }
    if (/\b(tempo|clima|chover|chuva|temperatura|frio|calor)\b/.test(s)) {
      const c = await Clima.agora();
      if (!c) return { texto: `Preciso da sua localização para ver o clima, ${T}. Permita o acesso à localização.` };
      return /amanha/.test(s) ? { texto: `Amanhã, máxima de ${c.maxAmanha} graus e ${c.chuvaAmanha}% de chance de chuva.` }
        : { texto: `Agora faz ${c.temp} graus, ${c.desc}. Máxima de ${c.max}, mínima de ${c.min}, e ${c.chuva}% de chance de chuva.` };
    }
    void original;
    return null;
  },

  async briefing() {
    const T = this.tratamento(), h = hoje(), hr = new Date().getHours();
    const saud = hr >= 5 && hr < 12 ? 'Bom dia' : hr >= 12 && hr < 18 ? 'Boa tarde' : 'Boa noite';
    const partes = [`${saud}, ${T}. São ${falarHora(hhmm(agoraMin()))}.`];
    const c = await Promise.race([Clima.agora(), new Promise(r => setTimeout(() => r(null), 4000))]);
    if (c) partes.push(`Lá fora, ${c.temp} graus e ${c.desc}${c.chuva >= 50 ? `, com ${c.chuva}% de chance de chuva. Leve um guarda-chuva` : ''}.`);
    const evs = Agenda.eventosDoDia(h).filter(e => !e.inicio || e.inicio >= hhmm(agoraMin()));
    if (evs.length) {
      const p = evs[0], s = Agenda.horaSaida(p);
      partes.push(`Você tem ${plural(evs.length, 'compromisso', 'compromissos')} hoje. O próximo é ${p.titulo}${p.inicio ? ' às ' + p.inicio : ''}${s ? `; saia às ${s}` : ''}.`);
    } else partes.push('Sua agenda de hoje está livre.');
    const pend = db.tarefas.filter(x => x.status !== 'feito');
    const urg = pend.filter(x => x.prazo && x.prazo <= h);
    if (urg.length) partes.push(urg.length === 1 ? `Há uma tarefa para hoje ou atrasada: ${urg[0].titulo}.`
      : `Há ${urg.length} tarefas para hoje ou atrasadas, começando por ${urg.sort(Tarefas.ordenar)[0].titulo}.`);
    const contas = Financas.aVencer(2);
    if (contas.length) partes.push(`Vencendo: ${contas.map(x => `${x.nome}, ${falarValor(x.valor)}`).join(' e ')}.`);
    const tr = Treinos.deHoje();
    if (tr.modelo && !tr.feito) partes.push(`Hoje é dia de ${tr.modelo.nome.split(' — ')[0]}.`);
    return partes.join(' ');
  },

  // Resumo dos dados para a IA (o "R" do RAG): só o essencial, em texto curto
  contexto() {
    const h = hoje(), r = Financas.resumo(chaveMes(new Date()));
    const linhas = [`Agora: ${new Date().toLocaleString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (hoje = ${h}).`];
    for (const iso of [h, somaDias(h, 1)]) {
      const e = Agenda.eventosDoDia(iso);
      linhas.push(`Agenda ${iso === h ? 'hoje' : 'amanhã'}: ${e.length ? e.map(x => `${x.inicio || 'dia todo'} ${x.titulo}${x.local ? ' (' + x.local + ')' : ''}`).join('; ') : 'nada'}.`);
    }
    const pend = db.tarefas.filter(t => t.status !== 'feito').sort(Tarefas.ordenar).slice(0, 12);
    linhas.push(`Tarefas pendentes: ${pend.map(t => `${t.titulo} [${t.area}${t.prazo ? ', prazo ' + t.prazo : ''}]`).join('; ') || 'nenhuma'}.`);
    const cats = Object.entries([...r.fixos, ...r.vars].reduce((o, g) => (o[g.categoria] = (o[g.categoria] || 0) + g.valor, o), {})).sort((a, b) => b[1] - a[1]);
    linhas.push(`Finanças do mês: renda ${r.renda}, fixos ${r.tf}, variáveis ${r.tv}, parcelas ${r.td}, saldo previsto ${r.saldo}. Por categoria: ${cats.map(([c, v]) => c + ' ' + v).join(', ') || '—'}.`);
    linhas.push(`Contas a vencer (7 dias): ${Financas.aVencer(7).map(c => `${c.nome} ${c.valor} em ${c.data}`).join('; ') || 'nenhuma'}.`);
    linhas.push(`Dívidas: ${db.financas.dividas.map(d => `${d.nome} parcela ${d.parcela}${Financas.restante(d) != null ? ', falta ' + Financas.restante(d) : ''}`).join('; ') || 'nenhuma'}.`);
    const tr = Treinos.deHoje();
    linhas.push(`Treino de hoje: ${tr.feito ? 'concluído' : tr.modelo ? tr.modelo.nome : 'descanso'}. Treinos neste mês: ${db.treinos.sessoes.filter(s => s.data.startsWith(h.slice(0, 7))).length}.`);
    const b = Nutricao.validas().slice(-2);
    if (b.length) linhas.push(`Bioimpedância: ${b.map(x => `${x.data}: peso ${x.peso}kg, gordura ${x.gorduraPct}%, músculo ${x.massaMuscularKg}kg, visceral ${x.gorduraVisceral}`).join(' | ')}.`);
    linhas.push(`Alarmes: ${db.alarmes.filter(a => a.ativo).map(a => `${a.hora} ${a.rotulo || ''}`).join('; ') || 'nenhum'}.`);
    linhas.push(`Desejos: ${db.wishlist.filter(w => !w.comprado).map(w => `${w.nome}${w.preco ? ' ' + w.preco : ''}`).join('; ') || 'nenhum'}.`);
    return linhas.join('\n');
  },

  async ia(original) {
    const T = this.tratamento();
    if (!Sync.usuario) return { texto: `Não entendi, ${T}. Para conversas livres, entre com sua conta Google em Notas e ajustes.` };
    try {
      const { data, error } = await Sync.sb.functions.invoke('jarvis', { body: {
        pergunta: original, contexto: this.contexto(), historico: this.historico.slice(-7, -1), tratamento: T } });
      if (error) {
        let motivo = '';
        try { motivo = (await error.context.json()).erro; } catch (e) {}
        return { texto: motivo === 'nao_configurado' ? `Minha inteligência na nuvem ainda não foi configurada, ${T}. Por enquanto entendo comandos diretos, como "gastei 50 no mercado".`
          : motivo === 'cota' ? `Atingi o limite gratuito de hoje, ${T}. Comandos diretos continuam funcionando.`
          : `Não consegui pensar nisso agora, ${T}. Tente de novo em instantes.` };
      }
      const r = await this.executarAcao(data.acao);
      return { texto: [data.resposta, r?.texto].filter(Boolean).join(' ') || `Certo, ${T}.`, desfazer: r?.desfazer };
    } catch (e) { return { texto: `Estou sem conexão, ${T}. Comandos diretos continuam funcionando.` }; }
  },

  // Ações sugeridas pela IA: validadas antes de executar
  async executarAcao(a) {
    if (!a || typeof a !== 'object') return null;
    const data = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null, hora = s => /^\d{2}:\d{2}$/.test(s) ? s : null;
    if (a.tipo === 'gasto' && +a.valor > 0) {
      const g = { id: uid(), nome: String(a.descricao || 'Gasto').slice(0, 80), valor: Math.round(+a.valor * 100) / 100,
        categoria: CATEGORIAS.includes(a.categoria) ? a.categoria : 'Outros', data: data(a.data) || hoje() };
      db.financas.variaveis.push(g); ok();
      return { desfazer: () => { const i = db.financas.variaveis.indexOf(g); if (i >= 0) db.financas.variaveis.splice(i, 1); } };
    }
    if (a.tipo === 'tarefa' && a.titulo) {
      const t = { id: uid(), area: a.area === 'trabalho' ? 'trabalho' : 'pessoal', titulo: String(a.titulo).slice(0, 120), status: 'afazer', prioridade: 'media', prazo: data(a.prazo) || '', projeto: '' };
      db.tarefas.push(t); ok();
      return { desfazer: () => { const i = db.tarefas.indexOf(t); if (i >= 0) db.tarefas.splice(i, 1); } };
    }
    if (a.tipo === 'alarme' && hora(a.hora)) {
      const al = { id: uid(), hora: a.hora, rotulo: String(a.rotulo || 'Alarme').slice(0, 60), dias: [], ativo: true, data: minutos(a.hora) > agoraMin() ? hoje() : somaDias(hoje(), 1) };
      db.alarmes.push(al); ok();
      return { desfazer: () => { const i = db.alarmes.indexOf(al); if (i >= 0) db.alarmes.splice(i, 1); } };
    }
    if (a.tipo === 'evento' && a.titulo && data(a.data)) {
      const ev = { id: uid(), titulo: String(a.titulo).slice(0, 120), data: a.data, inicio: hora(a.inicio) || '', fim: '', local: '', rotaId: '', alerta: '15', repetir: 'nao', ate: '', tipo: 'pessoal', notas: '' };
      if (GAgenda.ativa()) {
        try { const g = await Google.api(CAL, { metodo: 'POST', corpo: GAgenda.paraGoogle(ev) }); GAgenda.carregar().then(() => Google.render());
          return { desfazer: () => { Google.api(`${CAL}/${encodeURIComponent(g.id)}`, { metodo: 'DELETE' }).then(() => GAgenda.carregar()).then(() => Google.render()); } };
        } catch (e) { return { texto: 'Mas não consegui salvar no Google Agenda.' }; }
      }
      db.eventos.push(ev); ok();
      return { desfazer: () => { const i = db.eventos.indexOf(ev); if (i >= 0) db.eventos.splice(i, 1); } };
    }
    return null;
  },
};

// Atalho no computador: Alt+J
document.addEventListener('keydown', e => {
  if (e.altKey && e.key.toLowerCase() === 'j') { e.preventDefault(); $('#jarvis')?.classList.contains('aberto') ? Jarvis.fechar() : Jarvis.abrir({ ouvir: true }); }
  if (e.key === 'Escape' && $('#jarvis')?.classList.contains('aberto')) Jarvis.fechar();
});
// Chamado pelos botões do app (data-acao="jarvis:abrir")
Modulos.jarvis = { id: 'jarvis', acoes: { abrir() { Jarvis.abrir({ ouvir: true }); } } };
