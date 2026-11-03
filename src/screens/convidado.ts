import { compartilhar, entrar, estado, faseDoEvento, fasePublica, meuId, sortear, trocar, type Estado, type Fase } from '../api';
import { db, descarregar, enfileirar, pendente, totalNaFila } from '../fila';
import { preparar } from '../imagem';
import {
  diasAte, erroDeRede, mensagemErro, rotuloTrocas, textoContagem, textoFaltam, textoLimitesEsquenta, textoProgresso,
} from '../regras';
import { go, onShow, rotaAtual } from '../router';
import { $, esc, ICONES, ocupado, toast } from '../ui';

// Estado guardado no aparelho para a tela abrir mesmo sem internet
const CHAVE_ESTADO = 'cb.estado';
const CHAVE_CODIGO = 'cb.codigo';
const CHAVE_NOME = 'cb.nome';

const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* aba anônima */ } };
const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const novoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

let est: Estado | null = null;
function usar(e: Estado | null) {
  est = e;
  if (e) guardar(CHAVE_ESTADO, JSON.stringify(e));
  atualizarAbas(e?.fase ?? 'festa');
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
const telaDaFase = (e: Estado) => (e.fase === 'esquenta' ? 'esquenta' : 'desafio');

/** No esquenta a primeira aba é "Compartilhar"; na festa, "Meu desafio". */
function atualizarAbas(fase: Fase) {
  const a = $<HTMLAnchorElement>('aba-1');
  const esq = fase === 'esquenta';
  a.href = esq ? '#/esquenta' : '#/desafio';
  a.dataset.aba = esq ? 'esquenta' : 'desafio';
  $('aba-1-txt').textContent = esq ? 'Compartilhar' : 'Meu desafio';
  if (rotaAtual().view === a.dataset.aba) a.setAttribute('aria-current', 'page');
}

/* ---------- o que está sendo enviado (desafio ou esquenta) ---------- */
type Envio =
  | { tipo: 'desafio'; arquivo: File }
  | { tipo: 'esquenta'; arquivo: File; tema: string | null; legenda: string | null };
let envio: Envio | null = null;
let previa = '';
let ultimo: { url: string; titulo: string; nome: string; naFila: boolean; tipo: 'desafio' | 'esquenta' } | null = null;

/* ---------- esquenta: tema escolhido ---------- */
let temaEscolhido: string | null = null;

export function initConvidado() {
  /* ---------- início: sem código ---------- */
  // endereço puro do app: quem já entrou vai para a sua tela; no esquenta, abre a entrada sem código;
  // na festa, pede o QR da mesa
  onShow('inicio', async () => {
    const tela = $('v-inicio');
    tela.classList.add('carregando');
    try {
      const e = await atualizar();
      if (e) return go(telaDaFase(e), true);
    } catch { /* segue para o início */ }
    const codigo = ler(CHAVE_CODIGO);
    if (codigo) return go('e/' + codigo, true);
    try {
      if ((await fasePublica()) === 'esquenta') return go('e', true);
    } catch { /* sem rede: mostra o pedido do QR */ }
    tela.classList.remove('carregando');
  });

  /* ---------- entrada pelo QR ou pelo link ---------- */
  const nome = $<HTMLInputElement>('nome');
  let codigoAtual = '';
  let faseEntrada: Fase = 'festa';
  onShow('entrada', async (r) => {
    const tela = $('v-entrada');
    tela.classList.add('carregando');
    codigoAtual = (r.sub ?? '').toLowerCase();
    if (codigoAtual) guardar(CHAVE_CODIGO, codigoAtual);
    nome.value = ler(CHAVE_NOME) ?? '';
    try {
      const e = await atualizar();
      if (e) return go(telaDaFase(e), true);
    } catch { /* mostra o formulário */ }
    try {
      faseEntrada = (codigoAtual ? await faseDoEvento(codigoAtual) : await fasePublica()) ?? 'festa';
    } catch { /* sem rede: texto da festa */ }
    // sem código só se entra no esquenta
    if (!codigoAtual && faseEntrada !== 'esquenta') return go('inicio', true);
    textoEntrada(faseEntrada);
    tela.classList.remove('carregando');
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
        const e = await estado();
        if (e?.fase === 'esquenta') usar(e);
        else usar(await sortear());
        go(est ? telaDaFase(est) : 'inicio', true);
      } catch (e) {
        toast(mensagemErro(e), 'erro');
      }
    }, 'Entrando…');
  });

  /* ---------- arquivos da câmera e da galeria ---------- */
  const camera = $<HTMLInputElement>('in-camera');
  const galeria = $<HTMLInputElement>('in-galeria');
  const abrir = (inp: HTMLInputElement) => { inp.value = ''; inp.click(); };
  for (const inp of [camera, galeria]) {
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      if (!f) return;
      // o modo vem da tela em que a pessoa está ("Tirar outra" na prévia mantém o que já estava escolhido)
      const v = rotaAtual().view;
      if (v === 'envio' && envio) envio = { ...envio, arquivo: f };
      else if (v === 'esquenta') envio = { tipo: 'esquenta', arquivo: f, tema: temaEscolhido, legenda: $<HTMLTextAreaElement>('q-legenda').value.trim() || null };
      else envio = { tipo: 'desafio', arquivo: f };
      if (v === 'envio') return mostrarPrevia();
      go('envio');
    });
  }

  /* ---------- desafio (festa) ---------- */
  $('d-camera').innerHTML = ICONES.camera + 'Tirar foto';
  $('d-galeria').innerHTML = ICONES.galeria + 'Escolher da galeria';
  $('d-camera').addEventListener('click', () => abrir(camera));
  $('d-galeria').addEventListener('click', () => abrir(galeria));
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
    if (est!.fase === 'esquenta') return go('esquenta', true);
    await mostrarDesafio();
  });

  /* ---------- esquenta ---------- */
  const legenda = $<HTMLTextAreaElement>('q-legenda');
  $('q-aviso').innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '<span>Tudo que você compartilhar aqui aparece no mural para <b>todos os convidados</b> e para os noivos.</span>';
  $('q-camera').innerHTML = ICONES.camera + 'Tirar foto';
  $('q-galeria').innerHTML = ICONES.galeria + 'Escolher da galeria';
  $('q-camera').addEventListener('click', () => abrir(camera));
  $('q-galeria').addEventListener('click', () => abrir(galeria));
  legenda.addEventListener('input', () => {
    $('q-cont').textContent = legenda.value.length + '/280';
    botoesEsquenta();
  });
  $('q-temas').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-tema]');
    if (!b) return;
    temaEscolhido = temaEscolhido === b.dataset.tema ? null : b.dataset.tema!;
    $('q-temas').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tema === temaEscolhido)));
  });
  $('q-recado').addEventListener('click', () =>
    ocupado($<HTMLButtonElement>('q-recado'), async () => {
      const texto = legenda.value.trim();
      if (!texto) return toast('Escreva o recado antes de enviar.', 'erro');
      try {
        await compartilhar(novoId(), null, null, temaEscolhido, texto);
        legenda.value = '';
        $('q-cont').textContent = '0/280';
        limparTema();
        await atualizar();
        mostrarEsquenta();
        toast('Recado no mural!');
      } catch (e) {
        toast(mensagemErro(e), 'erro');
      }
    }, 'Enviando…'),
  );

  onShow('esquenta', async () => {
    try {
      if (!(await atualizar())) return go('inicio', true);
    } catch (e) {
      toast(mensagemErro(e), 'erro');
      if (!est) return go('inicio', true);
    }
    if (est!.fase !== 'esquenta') return go('desafio', true);
    mostrarEsquenta();
  });

  /* ---------- prévia e envio ---------- */
  const offline = $('e-offline');
  offline.innerHTML = ICONES.semRede + '<span>Sem internet agora. A foto fica guardada no celular e sobe sozinha quando a conexão voltar.</span>';
  const atualizaRede = () => (offline.hidden = navigator.onLine);
  window.addEventListener('online', atualizaRede);
  window.addEventListener('offline', atualizaRede);
  $('e-outra').addEventListener('click', () => abrir(camera));

  onShow('envio', () => mostrarPrevia());
  function mostrarPrevia() {
    if (!envio || !est) return go(est ? telaDaFase(est) : 'inicio', true);
    if (envio.tipo === 'desafio' && !est.sorteio) return go('desafio', true);
    if (previa) URL.revokeObjectURL(previa);
    previa = URL.createObjectURL(envio.arquivo);
    $<HTMLImageElement>('e-prev').src = previa;
    const leg = $('e-legenda');
    if (envio.tipo === 'esquenta') {
      $('e-rotulo').textContent = envio.tema ? 'Tema' : 'Esquenta';
      $('e-desafio').textContent = envio.tema ?? 'Momento livre';
      leg.hidden = !envio.legenda;
      leg.textContent = envio.legenda ?? '';
    } else {
      $('e-rotulo').textContent = 'Desafio';
      $('e-desafio').textContent = est.sorteio!.texto;
      leg.hidden = true;
    }
    atualizaRede();
  }

  $('e-enviar').addEventListener('click', () =>
    ocupado($<HTMLButtonElement>('e-enviar'), async () => {
      const e = envio;
      if (!e || !est) return go('inicio', true);
      const uid = await meuId();
      if (!uid) return go('inicio', true);
      try {
        const { foto, mini } = await preparar(e.arquivo);
        let id: string;
        let titulo: string;
        if (e.tipo === 'esquenta') {
          id = novoId();
          titulo = e.legenda || e.tema || 'Momento';
          await enfileirar({ sorteio: id, tipo: 'esquenta', tema: e.tema, legenda: e.legenda, evento: est.evento_id, uid, desafio: titulo, foto, mini });
        } else {
          if (!est.sorteio) return go('desafio', true);
          id = est.sorteio.id;
          titulo = est.sorteio.texto;
          await enfileirar({ sorteio: id, tipo: 'desafio', evento: est.evento_id, uid, desafio: titulo, foto, mini });
        }
        if (navigator.onLine) await descarregar();
        const p = await pendente(id);
        if (p?.erro) {
          // regra do banco (limite, fase encerrada): não adianta tentar de novo
          await db.fila.delete(id);
          throw { message: p.erro };
        }
        ultimo = { url: URL.createObjectURL(mini), titulo, nome: est.nome, naFila: !!p, tipo: e.tipo };
        if (e.tipo === 'esquenta') {
          $<HTMLTextAreaElement>('q-legenda').value = '';
          $('q-cont').textContent = '0/280';
          limparTema();
        }
        envio = null;
        go('cumprido', true);
      } catch (err) {
        toast(err instanceof Error && err.message.startsWith('Não deu') ? err.message : mensagemErro(err), 'erro');
      }
    }, 'Enviando…'),
  );

  /* ---------- cumprido / compartilhado ---------- */
  $('c-outro').addEventListener('click', () => {
    if (ultimo?.tipo === 'esquenta') return go('esquenta', true);
    sortearOutro($<HTMLButtonElement>('c-outro'));
  });
  $('v-cumprido').querySelector('.selo-ok')!.innerHTML = ICONES.check;
  onShow('cumprido', async () => {
    if (!ultimo) return go(est ? telaDaFase(est) : 'inicio', true);
    const esq = ultimo.tipo === 'esquenta';
    $('c-titulo').innerHTML = esq ? 'Momento <em>compartilhado</em>' : 'Desafio <em>cumprido</em>';
    $<HTMLImageElement>('c-img').src = ultimo.url;
    $('c-legenda').textContent = ultimo.titulo.replace(/\.$/, '') + ' · ' + ultimo.nome;
    $('c-msg').textContent = ultimo.naFila
      ? 'A foto está guardada no celular e entra no mural assim que a internet voltar.'
      : esq ? 'Já está no mural para todos os convidados verem.' : 'Sua foto já está no mural.';
    try { await atualizar(); } catch { /* sem rede: usa o último estado */ }
    const outro = $<HTMLButtonElement>('c-outro');
    if (esq) {
      const fotos = Math.max(0, (est?.max_fotos_esquenta ?? 0) - (est?.fotos_esquenta ?? 0) - (ultimo.naFila ? 1 : 0));
      const recados = Math.max(0, (est?.max_recados ?? 0) - (est?.recados ?? 0));
      $('c-faltam').textContent = textoLimitesEsquenta(fotos, recados);
      outro.textContent = 'Compartilhar outro momento';
      outro.hidden = fotos <= 0 && recados <= 0;
      return;
    }
    const feitos = (est?.feitos ?? 0) + (ultimo.naFila ? 1 : 0);
    const max = est?.max_desafios ?? 0;
    $('c-faltam').textContent = textoFaltam(feitos, max);
    outro.textContent = 'Sortear outro desafio';
    outro.hidden = feitos >= max || ultimo.naFila;
  });
}

function textoEntrada(fase: Fase) {
  if (fase === 'esquenta') {
    $('n-titulo').innerHTML = 'Esquenta do <em>casamento</em>';
    $('n-texto').textContent = 'Até o grande dia, compartilhe fotos e recados com os noivos. No dia da festa, este mesmo app vai te dar desafios surpresa.';
    $('b-entrar').textContent = 'Entrar no esquenta';
  } else {
    $('n-titulo').innerHTML = 'Um desafio para você <em>nesta festa</em>';
    $('n-texto').textContent = 'Sorteamos um desafio, você cumpre e registra com uma foto. Tudo vai para o mural e, depois, para o nosso álbum.';
    $('b-entrar').innerHTML = ICONES.dado + 'Sortear meu desafio';
  }
}

function limparTema() {
  temaEscolhido = null;
  $('q-temas').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
}

function restantes() {
  return {
    fotos: Math.max(0, (est?.max_fotos_esquenta ?? 0) - (est?.fotos_esquenta ?? 0)),
    recados: Math.max(0, (est?.max_recados ?? 0) - (est?.recados ?? 0)),
  };
}

function botoesEsquenta() {
  const r = restantes();
  const texto = $<HTMLTextAreaElement>('q-legenda').value.trim();
  $<HTMLButtonElement>('q-camera').disabled = r.fotos <= 0;
  $<HTMLButtonElement>('q-galeria').disabled = r.fotos <= 0;
  $<HTMLButtonElement>('q-recado').disabled = r.recados <= 0 || !texto;
}

async function mostrarEsquenta() {
  if (!est) return;
  $('q-oi').textContent = 'Oi, ' + est.nome;
  $('q-conta').textContent = textoContagem(diasAte(est.data, new Date()));
  const temas = est.temas ?? [];
  if (temaEscolhido && !temas.includes(temaEscolhido)) temaEscolhido = null;
  $('q-temas').innerHTML = temas
    .map((t) => '<button type="button" class="tema" data-tema="' + esc(t) + '" aria-pressed="' + (t === temaEscolhido) + '">' + esc(t) + '</button>')
    .join('');
  $('q-temas-rotulo').hidden = temas.length === 0;
  const r = restantes();
  const naFila = await totalNaFila();
  $('q-limites').textContent = (naFila ? 'Há foto na fila, esperando a internet. ' : '') + textoLimitesEsquenta(r.fotos, r.recados);
  botoesEsquenta();
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
    aviso.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg><span>Cumpra e registre com uma foto. Ela vai para o mural, visível para todos os convidados.</span>';
    $('d-acoes').hidden = false;
    $('d-outro').hidden = true;
    const t = $<HTMLButtonElement>('d-trocar');
    t.innerHTML = ICONES.trocar + rotuloTrocas(est.trocas_restantes);
    t.disabled = est.trocas_restantes <= 0;
    return;
  }
  $('d-acoes').hidden = true;
  if (naFila || filaQualquer > 0) {
    $('d-texto').textContent = naFila?.desafio ?? s?.texto ?? 'Sua foto';
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
  $('d-texto').textContent = feitos === 0 ? 'Os desafios começaram!' : 'Pronto para o próximo?';
  aviso.textContent = textoFaltam(feitos, est.max_desafios) + '.';
  const b = $<HTMLButtonElement>('d-sortear');
  b.innerHTML = ICONES.dado + (feitos === 0 ? 'Sortear meu desafio' : 'Sortear meu próximo desafio');
  $('d-outro').hidden = false;
}

/** Depois que a fila envia, a tela se atualiza sozinha. */
export async function aposEnvioDaFila() {
  try { usar(await estado()); } catch { /* ignora */ }
  const v = rotaAtual().view;
  if (v === 'desafio') await mostrarDesafio();
  if (v === 'esquenta') await mostrarEsquenta();
}
