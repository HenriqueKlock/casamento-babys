import { evento, mural, ouvirFotos, souAdmin, urlPublica, type Foto } from '../api';
import { onShow, rotaAtual } from '../router';
import { $, esc } from '../ui';
import { qrDoEvento } from './painel';

// Telão: a foto mais recente entra na hora; sem novidade, passa pelas últimas 30 a cada 8 s.
const GIRO_MS = 8000;
let fotos: Foto[] = [];
let i = 0;
let qr = '';
let giro: number | undefined;
let recarga: number | undefined;
let ouvindo = false;

export function initTelao() {
  onShow('telao', async () => {
    const box = $('v-telao');
    clearInterval(giro);
    clearInterval(recarga);
    if (!(await souAdmin())) {
      box.innerHTML = '<p class="vazio-t">Entre no <a href="#/painel">painel</a> neste aparelho para abrir o telão.</p>';
      return;
    }
    try {
      qr = await qrDoEvento((await evento()).codigo, 400);
      fotos = await mural({ limite: 30 });
    } catch {
      fotos = [];
    }
    i = 0;
    desenhar();
    giro = window.setInterval(() => {
      if (rotaAtual().view !== 'telao' || fotos.length < 2) return;
      i = (i + 1) % fotos.length;
      desenhar();
    }, GIRO_MS);
    // pega fotos ocultadas pelo moderador
    recarga = window.setInterval(async () => {
      if (rotaAtual().view !== 'telao') return;
      try {
        const atual = fotos[i]?.id;
        fotos = await mural({ limite: 30 });
        const j = fotos.findIndex((f) => f.id === atual);
        i = j >= 0 ? j : 0;
        if (j < 0) desenhar();
      } catch { /* mantém o que tem */ }
    }, 60_000);
    if (!ouvindo) {
      ouvindo = true;
      ouvirFotos((tipo, f) => {
        if (tipo === 'INSERT' && f.id && !f.oculta) {
          fotos.unshift(f as Foto);
          fotos = fotos.slice(0, 30);
          i = 0;
        } else if (tipo === 'DELETE' || (tipo === 'UPDATE' && f.oculta)) {
          const atual = fotos[i]?.id;
          fotos = fotos.filter((x) => x.id !== f.id);
          if (atual !== f.id) i = Math.max(0, fotos.findIndex((x) => x.id === atual));
          else i = 0;
        } else return;
        if (rotaAtual().view === 'telao') desenhar();
      });
    }
  });
}

function desenhar() {
  const box = $('v-telao');
  const cheia = document.fullscreenElement ? '' : '<button class="cheia" type="button" id="t-cheia">Tela cheia</button>';
  const entrar = qr ? '<div class="entrar"><p>Leia o QR<br>e receba o seu desafio</p><img alt="QR code do app" src="' + qr + '"></div>' : '';
  if (!fotos.length) {
    box.innerHTML = '<p class="vazio-t">As fotos dos desafios aparecem aqui.</p>' + cheia;
  } else {
    const f = fotos[i];
    const proximas = [1, 2, 3].map((k) => fotos[(i + k) % fotos.length]).filter((x, k, arr) => fotos.length > k + 1 && arr.indexOf(x) === k);
    box.innerHTML =
      '<div class="moldura"><img crossorigin="anonymous" alt="' + esc('Foto de ' + f.nome) + '" src="' + esc(urlPublica(f.caminho)) + '"></div>' +
      '<div class="lado"><p class="eyebrow">Casamento Babys · desafio cumprido</p>' +
      '<p class="t-desafio">' + esc(f.desafio_texto) + '</p><p class="t-nome">por ' + esc(f.nome) + '</p>' +
      '<div class="rodape"><div class="tiras">' +
      proximas.map((p) => '<img crossorigin="anonymous" alt="" src="' + esc(urlPublica(p.miniatura)) + '">').join('') +
      '</div>' + entrar + '</div></div>' + cheia;
    // pré-carrega a próxima para a troca não piscar
    const prox = fotos[(i + 1) % fotos.length];
    if (prox) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = urlPublica(prox.caminho); }
  }
  document.getElementById('t-cheia')?.addEventListener('click', () => document.documentElement.requestFullscreen?.().then(desenhar).catch(() => {}));
}
