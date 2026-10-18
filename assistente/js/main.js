'use strict';
// ============ Inicialização ============
montarNav();
aplicarTema();
atual = Modulos[location.hash.slice(1)] ? location.hash.slice(1) : 'inicio';
render();

window.addEventListener('hashchange', () => {
  atual = Modulos[location.hash.slice(1)] ? location.hash.slice(1) : 'inicio';
  render();
  window.scrollTo(0, 0);
});

Sync.iniciar();
Sync.definirEstado(Sync.estado);

// Alarmes: verifica a cada 10 s; o áudio só pode ser liberado após uma interação do usuário
Alarmes.verificar();
setInterval(() => Alarmes.verificar(), 10000);
document.addEventListener('pointerdown', () => Alarmes.audio(), { once: true });
$('#alarmeOk').onclick = () => Alarmes.dispensar(false);
$('#alarmeSoneca').onclick = () => Alarmes.dispensar(true);

// Mantém horários do Início/Alarmes atualizados sem atrapalhar quem está digitando
setInterval(() => {
  if (!['inicio', 'alarmes'].includes(atual) || $('#modal').open) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  render();
}, 60000);

// Outra aba alterou os dados
window.addEventListener('storage', e => { if (e.key === CHAVE) { db = carregar(); render(); } });
