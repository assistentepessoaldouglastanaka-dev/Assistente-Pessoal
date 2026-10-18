'use strict';
// ============ Inicialização ============
montarNav();
aplicarTema();
atual = Modulos[location.hash.slice(1)] ? location.hash.slice(1) : 'inicio';
render();

// Animação de entrada só ao trocar de tela (não nas atualizações automáticas)
function animarEntrada() {
  const m = $('#conteudo');
  m.classList.remove('entrando'); void m.offsetWidth; m.classList.add('entrando');
  clearTimeout(animarEntrada.t); animarEntrada.t = setTimeout(() => m.classList.remove('entrando'), 600);
}
animarEntrada();

window.addEventListener('hashchange', () => {
  atual = Modulos[location.hash.slice(1)] ? location.hash.slice(1) : 'inicio';
  render();
  animarEntrada();
  window.scrollTo(0, 0);
});

// PWA: service worker (offline + notificações) e botão "Instalar app"
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.instalar = e; render(); });
window.addEventListener('appinstalled', () => { App.instalar = null; App.instalado = true; render(); aviso('App instalado'); });

Sync.iniciar();
Nativo.iniciar();
setTimeout(() => Escuta.ligar(), 1500);
Sync.definirEstado(Sync.estado);

// Alarmes: verifica a cada 10 s; o áudio só pode ser liberado após uma interação do usuário
Alarmes.verificar();
setInterval(() => Alarmes.verificar(), 10000);
document.addEventListener('pointerdown', () => Alarmes.audio(), { once: true });
$('.alarme-ic').innerHTML = ic('bell-ring');
$('#alarmeOk').onclick = () => Alarmes.dispensar(false);
$('#alarmeSoneca').onclick = () => Alarmes.dispensar(true);

// Mantém horários do Início/Alarmes atualizados sem atrapalhar quem está digitando
setInterval(() => {
  if (!['inicio', 'alarmes'].includes(atual) || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  render();
}, 60000);

// Barra superior do celular ganha borda ao rolar
window.addEventListener('scroll', () => $('#barra').classList.toggle('rolou', scrollY > 4), { passive: true });

// Outra aba alterou os dados
window.addEventListener('storage', e => { if (e.key === CHAVE) { db = carregar(); render(); } });
