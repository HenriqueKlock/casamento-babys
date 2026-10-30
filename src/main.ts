import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-400-italic.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import './styles.css';

import { registerSW } from 'virtual:pwa-register';
import { supabase } from './api';
import { iniciarFila } from './fila';
import { iniciarRotas } from './router';
import { aposEnvioDaFila, initConvidado } from './screens/convidado';
import { initMural } from './screens/mural';
import { initPainel } from './screens/painel';
import { initTelao } from './screens/telao';
import { toast } from './ui';

registerSW({ immediate: true });

initConvidado();
initMural();
initPainel();
initTelao();

async function iniciar() {
  // volta do link de login dos noivos (?code=…&depois=painel): a sessão é trocada antes de abrir as telas
  await supabase.auth.getSession();
  const p = new URLSearchParams(location.search);
  if (p.has('depois') || p.has('code') || p.has('error_description')) {
    if (p.has('error_description')) toast('O link de acesso expirou. Peça outro.', 'erro');
    history.replaceState(null, '', location.pathname + '#/' + (p.get('depois') === 'painel' ? 'painel' : ''));
  }
  iniciarRotas();
  iniciarFila((n) => {
    toast(n === 1 ? 'Sua foto entrou no mural' : n + ' fotos entraram no mural');
    aposEnvioDaFila();
  });
}
iniciar();
