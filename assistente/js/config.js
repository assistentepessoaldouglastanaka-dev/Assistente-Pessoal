// Conexão com o Supabase (Project Settings → API). A chave "publishable" é pública e pode ficar no código.
// Enquanto estiver vazio, o app funciona só neste aparelho, como antes.
window.SUPABASE_URL = 'https://dcbjrjpbvyjavgwuchuf.supabase.co';
window.SUPABASE_KEY = 'sb_publishable_cVRvvTYIo0nje61TkA1leg_RIgza7GA';

// Permissões pedidas ao Google no login (usadas pelas integrações com Agenda, Tasks e Gmail)
window.GOOGLE_ESCOPOS = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');
