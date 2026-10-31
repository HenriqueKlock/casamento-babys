import { meuId, mural, ouvirFotos, urlPublica, type Foto } from '../api';
import { mensagemErro, tituloPost } from '../regras';
import { onShow } from '../router';
import { $, esc, ocupado, toast } from '../ui';

type Filtro = 'todas' | 'esquenta' | 'desafios' | 'minhas';
let fotos: Foto[] = [];
let filtro: Filtro = 'todas';
let fim = false;
let uid: string | null = null;
let ouvindo = false;

const tipoDoFiltro = (f: Filtro): Foto['tipo'] | undefined => (f === 'esquenta' ? 'esquenta' : f === 'desafios' ? 'desafio' : undefined);
function entraNoFiltro(f: Partial<Foto>) {
  if (filtro === 'minhas') return f.convidado_id === uid;
  const t = tipoDoFiltro(filtro);
  return !t || f.tipo === t;
}

export function initMural() {
  const grade = $('m-grade');
  const mais = $<HTMLButtonElement>('m-mais');
  const dialog = $<HTMLDialogElement>('foto');

  document.querySelectorAll<HTMLButtonElement>('.pilula').forEach((b) =>
    b.addEventListener('click', () => {
      filtro = b.dataset.filtro as Filtro;
      document.querySelectorAll('.pilula').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      carregar(true);
    }),
  );
  mais.addEventListener('click', () => ocupado(mais, () => carregar(false), 'Carregando…'));

  grade.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-id]');
    const f = el && fotos.find((x) => x.id === el.dataset.id);
    if (!f) return;
    const img = $<HTMLImageElement>('f-img');
    const recado = $('f-recado');
    const texto = $('f-texto');
    if (f.caminho) {
      img.hidden = false;
      img.crossOrigin = 'anonymous';
      img.src = urlPublica(f.caminho);
      img.alt = 'Foto de ' + f.nome + ': ' + tituloPost(f);
      recado.hidden = true;
      texto.hidden = !f.legenda;
      texto.textContent = f.legenda ?? '';
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      recado.hidden = false;
      recado.textContent = f.legenda ?? '';
      texto.hidden = true;
    }
    $('f-legenda').textContent = f.caminho || f.tema ? tituloPost(f) : 'Recado';
    $('f-nome').textContent = f.nome;
    dialog.showModal();
  });
  $('f-fechar').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });

  onShow('mural', async () => {
    uid = await meuId();
    if (!ouvindo && uid) {
      ouvindo = true;
      ouvirFotos((tipo, f) => {
        if (tipo === 'INSERT' && f.id && !f.oculta && !fotos.some((x) => x.id === f.id)) {
          if (!entraNoFiltro(f)) return;
          fotos.unshift(f as Foto);
        } else if (tipo === 'DELETE' || (tipo === 'UPDATE' && f.oculta)) {
          fotos = fotos.filter((x) => x.id !== f.id);
        } else return;
        render();
      });
    }
    await carregar(true);
  });
}

async function carregar(doZero: boolean) {
  try {
    const antes = doZero ? undefined : fotos.at(-1)?.criado_em;
    const novas = await mural({ antes, soMinhas: filtro === 'minhas', tipo: tipoDoFiltro(filtro), limite: 30 });
    fotos = doZero ? novas : fotos.concat(novas);
    fim = novas.length < 30;
  } catch (e) {
    toast(mensagemErro(e), 'erro');
  }
  render();
}

function item(f: Foto): string {
  const titulo = tituloPost(f);
  const etiqueta = f.tipo === 'esquenta' ? '<span class="etiqueta">Esquenta</span>' : '';
  const visual = f.miniatura
    ? '<img crossorigin="anonymous" loading="lazy" decoding="async" alt="" src="' + esc(urlPublica(f.miniatura)) + '">'
    : '<div class="recado-card"><span>' + esc(f.legenda) + '</span></div>';
  const leg = f.miniatura ? (f.legenda ? f.legenda : titulo) : f.tema ? f.tema : 'Recado';
  return '<button type="button" class="item" data-id="' + esc(f.id) + '" aria-label="' + esc((f.miniatura ? 'Foto' : 'Recado') + ' de ' + f.nome + ': ' + (f.legenda || titulo)) + '">' +
    visual + '<p class="leg">' + etiqueta + (etiqueta ? '<br>' : '') + esc(leg) + '</p><p class="quem">' + esc(f.nome) + '</p></button>';
}

function render() {
  $('m-grade').innerHTML = fotos.map(item).join('');
  const vazio = $('m-vazio');
  vazio.hidden = fotos.length > 0;
  vazio.textContent =
    filtro === 'minhas' ? 'Você ainda não mandou nada.'
    : filtro === 'esquenta' ? 'Nenhum momento do esquenta ainda.'
    : filtro === 'desafios' ? 'Os desafios aparecem aqui no dia da festa.'
    : 'Nada no mural ainda. Seja a primeira pessoa a mandar algo!';
  $('m-mais').hidden = fim || fotos.length === 0;
}
