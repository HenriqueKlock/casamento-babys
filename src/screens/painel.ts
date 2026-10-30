import {
  admins, contarConvidados, desafios, evento, incluirAdmin, incluirDesafios, ligarDesafio, loginSenha, ocultar,
  ouvirFotos, removerAdmin, sair, salvarEvento, sessao, souAdmin, todasFotos, urlPublica, type Desafio, type Evento, type Foto,
} from '../api';
import { APP_URL } from '../config';
import { lerLista, mensagemErro, nomeArquivo } from '../regras';
import { go, onShow, rotaAtual } from '../router';
import { $, esc, ICONES, ocupado, toast } from '../ui';

export const linkDoEvento = (codigo: string) => APP_URL + '#/e/' + codigo;
// QR e .zip só carregam quando o painel ou o telão abrem: o convidado não baixa isso
export async function qrDoEvento(codigo: string, largura = 600) {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(linkDoEvento(codigo), { margin: 2, width: largura, color: { dark: '#3B342D', light: '#FFFFFF' } });
}

let ev: Evento | null = null;
let lista: Desafio[] = [];
let fotos: Foto[] = [];
let ouvindo = false;

export function initPainel() {
  onShow('painel', async () => {
    const login = $('p-login');
    const conteudo = $('p-conteudo');
    if (!(await souAdmin())) {
      conteudo.hidden = true;
      login.hidden = false;
      renderLogin();
      return;
    }
    login.hidden = true;
    conteudo.hidden = false;
    await carregar();
    if (!ouvindo) {
      ouvindo = true;
      let espera: number | undefined;
      ouvirFotos(() => {
        clearTimeout(espera);
        espera = window.setTimeout(async () => {
          if (rotaAtual().view !== 'painel') return;
          fotos = await todasFotos();
          renderNumeros();
          renderDesafios();
          renderModeracao();
        }, 800);
      });
    }
  });
}

async function renderLogin() {
  const box = $('p-login');
  const s = await sessao();
  const outro = s && !s.user.is_anonymous;
  box.innerHTML =
    '<h1 class="titulo-md">Painel dos noivos</h1>' +
    (outro
      ? '<div class="secao"><p class="caixa-texto">O e-mail <b>' + esc(s!.user.email) + '</b> não está entre os noivos e moderadores.</p><button id="p-sair" class="btn btn-2" type="button">Sair e entrar com outro e-mail</button></div>'
      : '<form id="p-form" class="secao" novalidate><label for="p-email" class="rotulo" style="margin-top:0">E-mail</label>' +
        '<input id="p-email" class="campo" type="email" inputmode="email" autocomplete="username" placeholder="voce@email.com" required>' +
        '<label for="p-senha" class="rotulo" style="margin-top:8px">Senha</label>' +
        '<input id="p-senha" class="campo" type="password" autocomplete="current-password" required>' +
        '<button class="btn" type="submit">Entrar</button>' +
        '<p class="nota" style="margin-top:4px">Só noivos e moderadores cadastrados veem o painel.' +
        (s?.user.is_anonymous ? ' Neste celular você também está como convidado; ao entrar aqui, ele deixa de ser o seu acesso de convidado.' : '') + '</p></form>');
  $('p-sair')?.addEventListener('click', async () => { await sair(); renderLogin(); });
  const form = document.getElementById('p-form') as HTMLFormElement | null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('p-email').value.trim().toLowerCase();
    const senha = $<HTMLInputElement>('p-senha').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Digite um e-mail válido.', 'erro');
    if (!senha) return toast('Digite a senha.', 'erro');
    ocupado(form.querySelector('button'), async () => {
      try {
        await loginSenha(email, senha);
        go('painel', true);
      } catch (err) {
        toast(mensagemErro(err), 'erro');
      }
    }, 'Entrando…');
  });
}

async function carregar() {
  const box = $('p-conteudo');
  try {
    ev = await evento();
    [lista, fotos] = await Promise.all([desafios(ev.id), todasFotos()]);
  } catch (e) {
    box.innerHTML = '<p class="texto">' + esc(mensagemErro(e)) + '</p>';
    return;
  }
  const link = linkDoEvento(ev.codigo);
  box.innerHTML =
    '<div><p class="eyebrow">Painel · noivos e moderadores</p><h1 class="titulo-md">' + esc(ev.nome) + '</h1></div>' +
    '<section class="secao"><div id="p-numeros" class="numeros"></div></section>' +
    '<section class="secao"><h2>Evento</h2>' +
      '<label class="check"><input id="p-aberto" type="checkbox"' + (ev.aberto ? ' checked' : '') + '> Envios abertos</label>' +
      '<div class="campos"><label>Desafios por pessoa<input id="p-max" class="campo" type="number" min="1" max="30" value="' + ev.max_desafios + '"></label>' +
      '<label>Trocas por pessoa<input id="p-trocas" class="campo" type="number" min="0" max="10" value="' + ev.max_trocas + '"></label></div>' +
      '<button id="p-salvar" class="btn" type="button">Salvar</button></section>' +
    '<section class="secao"><h2>QR das mesas</h2><div class="qr"><img id="p-qr" alt="QR code que leva ao app">' +
      '<div><p class="link">' + esc(link) + '</p><div class="linha-flex" style="justify-content:flex-start">' +
      '<a id="p-baixar-qr" class="btn btn-2" download="qr-casamento-babys.png" href="#">' + ICONES.baixar + 'Baixar QR</a>' +
      '<button id="p-copiar" class="btn btn-2" type="button">Copiar link</button></div></div></div></section>' +
    '<section class="secao"><h2>Desafios</h2><p class="discreto" style="margin:0">Desligar tira o desafio dos próximos sorteios; quem já sorteou continua com ele.</p><div id="p-desafios"></div>' +
      '<label for="p-novos" class="rotulo" style="margin:8px 0 0">Incluir desafios (um por linha)</label>' +
      '<textarea id="p-novos" class="campo" rows="4"></textarea><button id="p-incluir" class="btn" type="button">Incluir</button></section>' +
    '<section class="secao"><h2>Moderação · mais novas primeiro</h2><div id="p-mod" style="display:flex;flex-direction:column;gap:12px"></div></section>' +
    '<section class="secao"><h2>Noivos e moderadores</h2><ul id="p-admins" class="admins"></ul>' +
      '<form id="p-novo-admin" class="inline-form"><label for="p-admin-email" class="arquivo">E-mail do moderador</label><input id="p-admin-email" class="campo" type="email" placeholder="e-mail do moderador" autocomplete="off"><button class="btn" type="submit">Incluir</button></form></section>' +
    '<section class="secao"><h2>Depois da festa</h2><button id="p-zip" class="btn" type="button">' + ICONES.baixar + 'Baixar todas as fotos (.zip)</button>' +
      '<p class="nota" style="margin:0">Melhor no computador: são todas as fotos em tamanho cheio. As ocultas vão numa pasta separada.</p></section>' +
    '<div class="linha-flex"><a class="btn btn-2" href="#/telao">Abrir o telão</a><button id="p-sair2" class="btn-texto" type="button">Sair</button></div>';

  qrDoEvento(ev.codigo, 900).then((url) => {
    $<HTMLImageElement>('p-qr').src = url;
    $<HTMLAnchorElement>('p-baixar-qr').href = url;
  });
  $('p-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { toast('Não deu para copiar; selecione o link.', 'erro'); }
  });
  $('p-salvar').addEventListener('click', () =>
    ocupado($<HTMLButtonElement>('p-salvar'), async () => {
      const campos = {
        aberto: $<HTMLInputElement>('p-aberto').checked,
        max_desafios: Math.max(1, Math.min(30, Number($<HTMLInputElement>('p-max').value) || 1)),
        max_trocas: Math.max(0, Math.min(10, Number($<HTMLInputElement>('p-trocas').value) || 0)),
      };
      try { await salvarEvento(ev!.id, campos); ev = { ...ev!, ...campos }; toast('Salvo'); } catch (e) { toast(mensagemErro(e), 'erro'); }
    }, 'Salvando…'),
  );
  $('p-incluir').addEventListener('click', () =>
    ocupado($<HTMLButtonElement>('p-incluir'), async () => {
      const novos = lerLista($<HTMLTextAreaElement>('p-novos').value);
      if (!novos.length) return toast('Escreva um desafio por linha.', 'erro');
      try {
        await incluirDesafios(ev!.id, novos, (lista.at(-1)?.ordem ?? 0) + 1);
        lista = await desafios(ev!.id);
        $<HTMLTextAreaElement>('p-novos').value = '';
        renderDesafios();
        renderNumeros();
        toast(novos.length === 1 ? '1 desafio incluído' : novos.length + ' desafios incluídos');
      } catch (e) { toast(mensagemErro(e), 'erro'); }
    }, 'Incluindo…'),
  );
  $('p-desafios').addEventListener('change', async (e) => {
    const inp = e.target as HTMLInputElement;
    const d = lista.find((x) => x.id === inp.dataset.id);
    if (!d) return;
    try { await ligarDesafio(d.id, inp.checked); d.ativo = inp.checked; renderDesafios(); renderNumeros(); }
    catch (err) { inp.checked = !inp.checked; toast(mensagemErro(err), 'erro'); }
  });
  $('p-mod').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    const f = b && fotos.find((x) => x.id === b.dataset.id);
    if (!f) return;
    await ocupado(b, async () => {
      try { await ocultar(f.id, !f.oculta); f.oculta = !f.oculta; renderModeracao(); renderNumeros(); }
      catch (err) { toast(mensagemErro(err), 'erro'); }
    });
  });
  $('p-novo-admin').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $<HTMLInputElement>('p-admin-email');
    const email = inp.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Digite um e-mail válido.', 'erro');
    ocupado((e.target as HTMLFormElement).querySelector('button'), async () => {
      try { await incluirAdmin(email); inp.value = ''; await renderAdmins(); toast('Moderador incluído'); } catch (err) { toast(mensagemErro(err), 'erro'); }
    });
  });
  $('p-admins').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-email]');
    if (!b || !confirm('Tirar ' + b.dataset.email + ' dos moderadores?')) return;
    ocupado(b, async () => {
      try { await removerAdmin(b.dataset.email!); await renderAdmins(); } catch (err) { toast(mensagemErro(err), 'erro'); }
    });
  });
  $('p-zip').addEventListener('click', () => baixarZip($<HTMLButtonElement>('p-zip')));
  $('p-sair2').addEventListener('click', async () => { await sair(); go('inicio', true); });

  renderNumeros();
  renderDesafios();
  renderModeracao();
  await renderAdmins();
}

async function renderNumeros() {
  let convidados = 0;
  try { convidados = await contarConvidados(); } catch { /* mostra 0 */ }
  const visiveis = fotos.filter((f) => !f.oculta).length;
  const el = document.getElementById('p-numeros');
  if (!el) return;
  el.innerHTML =
    '<div class="numero"><b>' + convidados + '</b><span>convidados</span></div>' +
    '<div class="numero"><b>' + visiveis + '</b><span>fotos no mural</span></div>' +
    '<div class="numero"><b>' + lista.filter((d) => d.ativo).length + '</b><span>desafios ligados</span></div>';
}

function renderDesafios() {
  const el = document.getElementById('p-desafios');
  if (!el) return;
  const porDesafio = new Map<string, number>();
  for (const f of fotos) if (!f.oculta) porDesafio.set(f.desafio_id, (porDesafio.get(f.desafio_id) ?? 0) + 1);
  el.innerHTML = lista
    .map((d) => {
      const n = porDesafio.get(d.id) ?? 0;
      return '<label class="desafio-linha' + (d.ativo ? '' : ' off') + '"><input type="checkbox" data-id="' + esc(d.id) + '"' + (d.ativo ? ' checked' : '') +
        ' aria-label="Desafio ligado"><span class="t">' + esc(d.texto) + '</span><span class="n">' + (n === 1 ? '1 foto' : n + ' fotos') + '</span></label>';
    })
    .join('');
}

function renderModeracao() {
  const el = document.getElementById('p-mod');
  if (!el) return;
  const recentes = fotos.slice().reverse().slice(0, 60);
  el.innerHTML = recentes.length
    ? recentes
        .map((f) =>
          '<div class="mod' + (f.oculta ? ' oculta' : '') + '"><img crossorigin="anonymous" loading="lazy" alt="" src="' + esc(urlPublica(f.miniatura)) + '">' +
          '<div><p>' + esc(f.desafio_texto) + '</p><p class="quem">' + esc(f.nome) + (f.oculta ? ' · oculta' : '') + '</p></div>' +
          '<button type="button" data-id="' + esc(f.id) + '">' + (f.oculta ? 'Mostrar' : 'Ocultar') + '</button></div>')
        .join('')
    : '<p class="discreto" style="margin:0">Nenhuma foto ainda.</p>';
}

async function renderAdmins() {
  const el = document.getElementById('p-admins');
  if (!el) return;
  const eu = (await sessao())?.user.email?.toLowerCase();
  const emails = await admins().catch(() => [] as string[]);
  el.innerHTML = emails
    .map((e) => '<li><span>' + esc(e) + (e === eu ? ' (você)' : '') + '</span>' + (e === eu ? '' : '<button class="btn-perigo" type="button" data-email="' + esc(e) + '">Tirar</button>') + '</li>')
    .join('');
}

async function baixarZip(btn: HTMLButtonElement) {
  await ocupado(btn, async () => {
    try {
      const todas = await todasFotos();
      if (!todas.length) return toast('Nenhuma foto ainda.', 'erro');
      const arquivos: Record<string, [Uint8Array, { level: 0 }]> = {};
      let feitas = 0;
      const fila = todas.map((f, i) => ({ f, i }));
      const trabalhar = async () => {
        for (let item = fila.shift(); item; item = fila.shift()) {
          const r = await fetch(urlPublica(item.f.caminho));
          if (!r.ok) continue;
          const nome = (item.f.oculta ? 'ocultas/' : '') + nomeArquivo(item.i + 1, item.f.desafio_texto, item.f.nome);
          arquivos[nome] = [new Uint8Array(await r.arrayBuffer()), { level: 0 }];
          btn.textContent = 'Baixando ' + ++feitas + ' de ' + todas.length + '…';
        }
      };
      await Promise.all([trabalhar(), trabalhar(), trabalhar(), trabalhar()]);
      const { zipSync } = await import('fflate');
      const zip = zipSync(arquivos);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'casamento-babys-fotos.zip';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast(feitas + ' fotos no .zip');
    } catch (e) {
      toast(mensagemErro(e), 'erro');
    }
  }, 'Preparando…');
}
