import { entrar, estado, meuId, sortear, trocar, type Estado } from '../api';
import { descarregar, enfileirar, pendente, totalNaFila } from '../fila';
import { preparar } from '../imagem';
import { erroDeRede, mensagemErro, rotuloTrocas, textoFaltam, textoProgresso } from '../regras';
import { go, onShow } from '../router';
import { $, ICONES, ocupado, toast } from '../ui';

// Estado guardado no aparelho para a tela abrir mesmo sem internet
const CHAVE_ESTADO = 'cb.estado';
const CHAVE_CODIGO = 'cb.codigo';
const CHAVE_NOME = 'cb.nome';

const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* aba anônima */ } };
const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

let est: Estado | null = null;
function usar(e: Estado | null) {
  est = e;
  if (e) guardar(CHAVE_ESTADO, JSON.stringify(e));
}
function doCelular(): Estado | null {
  try { return JSON.parse(ler(CHAVE_ESTADO) || 'null'); } catch { return null; }
}
/** Estado do servidor; sem internet, o último guardado no aparelho. */
async function atualizar(): Promise<Estado | null> {
  try {
    usar(await estado());
  } catch (e) {
    if (!erroDeRede(e)) throw e;
    est = est ?? doCelular();
  }
  return est;
}

let arquivo: File | null = null;
let previa = '';
let ultimo: { url: string; texto: string; nome: string; naFila: boolean } | null = null;

export function initConvidado() {
  /* ---------- início: sem código ---------- */
  onShow('inicio', async () => {
    try {
      if (await atualizar()) return go('desafio', true);
    } catch { /* segue para o início */ }
    const codigo = ler(CHAVE_CODIGO);
    if (codigo) go('e/' + codigo, true);
  });

  /* ---------- entrada pelo QR ---------- */
  const nome = $<HTMLInputElement>('nome');
  $('b-entrar').querySelector('.ico')!.outerHTML = ICONES.dado;
  let codigoAtual = '';
  onShow('entrada', async (r) => {
    if (!r.sub) return go('inicio', true);
    codigoAtual = r.sub.toLowerCase();
    guardar(CHAVE_CODIGO, codigoAtual);
    nome.value = ler(CHAVE_NOME) ?? '';
    try {
      if (await atualizar()) return go('desafio', true);
    } catch { /* mostra o formulário */ }
  });
  $('f-entrada').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = nome.value.trim();
    if (!n) {
      toast('Digite seu nome para aparecer no mural.', 'erro');
      return nome.focus();
    }
    ocupado($<HTMLButtonElement>('b-entrar'), async () => {
      try {
        await entrar(codigoAtual, n);
        guardar(CHAVE_NOME, n);
        usar(await sortear());
        go('desafio', true);
      } catch (e) {
        toast(mensagemErro(e), 'erro');
      }
    }, 'Sorteando…');
  });

  /* ---------- desafio ---------- */
  const camera = $<HTMLInputElement>('in-camera');
  const galeria = $<HTMLInputElement>('in-galeria');
  $('d-camera').innerHTML = ICONES.camera + 'Tirar foto';
  $('d-galeria').innerHTML = ICONES.galeria + 'Escolher da galeria';
  $('d-camera').addEventListener('click', () => { camera.value = ''; camera.click(); });
  $('d-galeria').addEventListener('click', () => { galeria.value = ''; galeria.click(); });
  for (const inp of [camera, galeria]) {
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      if (!f) return;
      arquivo = f;
      go('envio');
    });
  }
  $('d-trocar').addEventListener('click', () => {
    if (!est?.sorteio) return;
    const id = est.sorteio.id;
    ocupado($<HTMLButtonElement>('d-trocar'), async () => {
      try {
        usar(await trocar(id));
        mostrarDesafio();
        toast('Novo desafio sorteado');
      } catch (e) {
        toast(mensagemErro(e), 'erro');
      }
    }, 'Sorteando…');
  });
  $('d-sortear').addEventListener('click', () => sortearOutro($<HTMLButtonElement>('d-sortear')));

  onShow('desafio', async () => {
    try {
      if (!(await atualizar())) return go('inicio', true);
    } catch (e) {
      toast(mensagemErro(e), 'erro');
      if (!est) return go('inicio', true);
    }
    await mostrarDesafio();
  });

  /* ---------- prévia e envio ---------- */
  const offline = $('e-offline');
  offline.innerHTML = ICONES.semRede + '<span>Sem internet agora. A foto fica guardada no celular e sobe sozinha quando a conexão voltar.</span>';
  const atualizaRede = () => (offline.hidden = navigator.onLine);
  window.addEventListener('online', atualizaRede);
  window.addEventListener('offline', atualizaRede);
  $('e-outra').addEventListener('click', () => { camera.value = ''; camera.click(); });

  onShow('envio', () => {
    if (!arquivo || !est?.sorteio) return go('desafio', true);
    if (previa) URL.revokeObjectURL(previa);
    previa = URL.createObjectURL(arquivo);
    $<HTMLImageElement>('e-prev').src = previa;
    $('e-desafio').textContent = est.sorteio.texto;
    atualizaRede();
  });

  $('e-enviar').addEventListener('click', () =>
    ocupado($<HTMLButtonElement>('e-enviar'), async () => {
      if (!arquivo || !est?.sorteio) return go('desafio', true);
      const uid = await meuId();
      if (!uid) return go('inicio', true);
      try {
        const { foto, mini } = await preparar(arquivo);
        const s = est.sorteio;
        await enfileirar({ sorteio: s.id, evento: est.evento_id, uid, desafio: s.texto, foto, mini });
        if (navigator.onLine) await descarregar();
        const p = await pendente(s.id);
        if (p?.erro) throw new Error(p.erro);
        ultimo = { url: URL.createObjectURL(mini), texto: s.texto, nome: est.nome, naFila: !!p };
        arquivo = null;
        go('cumprido', true);
      } catch (e) {
        toast(e instanceof Error && !('code' in e) && e.message.startsWith('Não deu') ? e.message : mensagemErro(e), 'erro');
      }
    }, 'Enviando…'),
  );

  /* ---------- cumprido ---------- */
  $('c-outro').addEventListener('click', () => sortearOutro($<HTMLButtonElement>('c-outro')));
  $('v-cumprido').querySelector('.selo-ok')!.innerHTML = ICONES.check;
  onShow('cumprido', async () => {
    if (!ultimo) return go('desafio', true);
    $<HTMLImageElement>('c-img').src = ultimo.url;
    $('c-legenda').textContent = ultimo.texto.replace(/\.$/, '') + ' · ' + ultimo.nome;
    $('c-msg').textContent = ultimo.naFila
      ? 'A foto está guardada no celular e entra no mural assim que a internet voltar.'
      : 'Sua foto já está no mural.';
    try { await atualizar(); } catch { /* sem rede: usa o último estado */ }
    const feitos = (est?.feitos ?? 0) + (ultimo.naFila ? 1 : 0);
    const max = est?.max_desafios ?? 0;
    $('c-faltam').textContent = textoFaltam(feitos, max);
    $('c-outro').hidden = feitos >= max || ultimo.naFila;
  });
}

async function sortearOutro(btn: HTMLButtonElement) {
  await ocupado(btn, async () => {
    try {
      usar(await sortear());
      go('desafio', true);
    } catch (e) {
      toast(mensagemErro(e), 'erro');
    }
  }, 'Sorteando…');
}

async function mostrarDesafio() {
  if (!est) return;
  const s = est.sorteio;
  const naFila = s ? await pendente(s.id) : undefined;
  const filaQualquer = await totalNaFila();
  const feitos = est.feitos;
  $('d-oi').textContent = 'Oi, ' + est.nome;
  $('d-prog').textContent = s ? textoProgresso(feitos, est.max_desafios) : feitos + ' de ' + est.max_desafios + ' cumpridos';
  const aviso = $('d-aviso');
  aviso.className = 'aviso';

  if (!est.aberto) {
    $('d-texto').textContent = 'Os envios foram encerrados. Obrigado por participar!';
    aviso.textContent = 'As fotos continuam no mural.';
    $('d-acoes').hidden = true;
    $('d-outro').hidden = true;
    return;
  }
  if (s && !naFila) {
    $('d-texto').textContent = s.texto;
    aviso.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg><span>Cumpra e registre com uma foto. Ela vai direto para o mural.</span>';
    $('d-acoes').hidden = false;
    $('d-outro').hidden = true;
    const t = $<HTMLButtonElement>('d-trocar');
    t.innerHTML = ICONES.trocar + rotuloTrocas(est.trocas_restantes);
    t.disabled = est.trocas_restantes <= 0;
    return;
  }
  $('d-acoes').hidden = true;
  if (naFila || filaQualquer > 0) {
    $('d-texto').textContent = (naFila?.desafio ?? s?.texto ?? 'Sua foto') ;
    aviso.className = 'aviso aviso-alerta';
    aviso.innerHTML = ICONES.semRede + '<span>Sua foto está guardada no celular e entra no mural assim que a internet voltar. Depois disso você sorteia o próximo.</span>';
    $('d-outro').hidden = true;
    return;
  }
  if (feitos >= est.max_desafios) {
    $('d-texto').textContent = 'Você cumpriu todos os seus desafios!';
    aviso.textContent = 'Obrigado por entrar na brincadeira. Veja as fotos de todo mundo no mural.';
    $('d-outro').hidden = true;
    return;
  }
  $('d-texto').textContent = 'Pronto para o próximo?';
  aviso.textContent = textoFaltam(feitos, est.max_desafios) + '.';
  const b = $<HTMLButtonElement>('d-sortear');
  b.innerHTML = ICONES.dado + 'Sortear meu próximo desafio';
  $('d-outro').hidden = false;
}

/** Depois que a fila envia, a tela do desafio se atualiza sozinha. */
export async function aposEnvioDaFila() {
  try { usar(await estado()); } catch { /* ignora */ }
  if (location.hash.startsWith('#/desafio')) await mostrarDesafio();
}
