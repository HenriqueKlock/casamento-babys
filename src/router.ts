// Navegação por endereço (#/desafio, #/mural, #/e/<código>): o voltar do celular funciona e o QR abre direto.
export type ViewId = 'inicio' | 'entrada' | 'desafio' | 'envio' | 'cumprido' | 'mural' | 'painel' | 'telao';
export interface Route { view: ViewId; sub: string | null }

const VIEWS: ViewId[] = ['inicio', 'entrada', 'desafio', 'envio', 'cumprido', 'mural', 'painel', 'telao'];
const COM_ABAS: ViewId[] = ['desafio', 'mural'];

export function parse(hash = location.hash): Route {
  const [v, sub] = hash.replace(/^#\/?/, '').split('/');
  if (v === 'e') return { view: 'entrada', sub: sub || null };
  return { view: (VIEWS as string[]).includes(v) ? (v as ViewId) : 'inicio', sub: sub || null };
}

const handlers = new Map<ViewId, (r: Route) => void>();
let atual: Route = parse();
export const rotaAtual = () => atual;

export function onShow(view: ViewId, fn: (r: Route) => void) {
  handlers.set(view, fn);
}

export function go(path: string, replace = false) {
  const h = '#/' + path.replace(/^#?\/?/, '');
  if (location.hash === h) return aplicar();
  if (replace) {
    history.replaceState(history.state, '', h);
    aplicar();
  } else location.hash = h;
}

function aplicar() {
  atual = parse();
  document.querySelectorAll<HTMLElement>('main > .view').forEach((s) => (s.hidden = s.id !== 'v-' + atual.view));
  const abas = document.getElementById('abas')!;
  abas.hidden = !COM_ABAS.includes(atual.view);
  abas.querySelectorAll<HTMLElement>('a').forEach((a) => {
    if (a.dataset.aba === atual.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  handlers.get(atual.view)?.(atual);
}

export function iniciarRotas() {
  window.addEventListener('hashchange', aplicar);
  aplicar();
}
