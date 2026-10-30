import { apagarFoto, meuId, mural, ouvirFotos, urlPublica, type Foto } from '../api';
import { mensagemErro } from '../regras';
import { onShow } from '../router';
import { $, esc, ocupado, toast } from '../ui';

let fotos: Foto[] = [];
let filtro: 'todas' | 'minhas' = 'todas';
let fim = false;
let uid: string | null = null;
let ouvindo = false;
let aberta: Foto | null = null;

export function initMural() {
  const grade = $('m-grade');
  const mais = $<HTMLButtonElement>('m-mais');
  const dialog = $<HTMLDialogElement>('foto');

  document.querySelectorAll<HTMLButtonElement>('.pilula').forEach((b) =>
    b.addEventListener('click', () => {
      filtro = b.dataset.filtro as 'todas' | 'minhas';
      document.querySelectorAll('.pilula').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      carregar(true);
    }),
  );
  mais.addEventListener('click', () => ocupado(mais, () => carregar(false), 'Carregando…'));

  grade.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-id]');
    const f = el && fotos.find((x) => x.id === el.dataset.id);
    if (!f) return;
    aberta = f;
    const img = $<HTMLImageElement>('f-img');
    img.crossOrigin = 'anonymous';
    img.src = urlPublica(f.caminho);
    img.alt = 'Foto de ' + f.nome + ': ' + f.desafio_texto;
    $('f-legenda').textContent = f.desafio_texto;
    $('f-nome').textContent = f.nome;
    $('f-apagar').hidden = f.convidado_id !== uid;
    dialog.showModal();
  });
  $('f-fechar').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  $('f-apagar').addEventListener('click', () => {
    const f = aberta;
    if (!f || !confirm('Apagar esta foto do mural? O desafio continua contando como cumprido.')) return;
    ocupado($<HTMLButtonElement>('f-apagar'), async () => {
      try {
        await apagarFoto(f);
        fotos = fotos.filter((x) => x.id !== f.id);
        render();
        dialog.close();
        toast('Foto apagada');
      } catch (e) {
        toast(mensagemErro(e), 'erro');
      }
    });
  });

  onShow('mural', async () => {
    uid = await meuId();
    if (!ouvindo && uid) {
      ouvindo = true;
      ouvirFotos((tipo, f) => {
        if (tipo === 'INSERT' && f.id && !f.oculta && !fotos.some((x) => x.id === f.id)) {
          if (filtro === 'minhas' && f.convidado_id !== uid) return;
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
    const novas = await mural({ antes, soMinhas: filtro === 'minhas', limite: 30 });
    fotos = doZero ? novas : fotos.concat(novas);
    fim = novas.length < 30;
  } catch (e) {
    toast(mensagemErro(e), 'erro');
  }
  render();
}

function render() {
  $('m-grade').innerHTML = fotos
    .map(
      (f) =>
        '<button type="button" class="item" data-id="' + esc(f.id) + '" aria-label="' + esc('Foto de ' + f.nome + ': ' + f.desafio_texto) + '">' +
        '<img crossorigin="anonymous" loading="lazy" decoding="async" alt="" src="' + esc(urlPublica(f.miniatura)) + '">' +
        '<p class="leg">' + esc(f.desafio_texto) + '</p><p class="quem">' + esc(f.nome) + '</p></button>',
    )
    .join('');
  const vazio = $('m-vazio');
  vazio.hidden = fotos.length > 0;
  vazio.textContent = filtro === 'minhas' ? 'Você ainda não enviou nenhuma foto.' : 'Nenhuma foto ainda. Seja a primeira pessoa a cumprir um desafio!';
  $('m-mais').hidden = fim || fotos.length === 0;
}
