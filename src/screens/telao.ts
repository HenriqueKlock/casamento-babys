import { evento, mural, ouvirFotos, souAdmin, urlPublica, type Evento, type Foto } from '../api';
import { tituloPost } from '../regras';
import { onShow, rotaAtual } from '../router';
import { $, esc } from '../ui';
import { qrDoEvento } from './painel';

// Telão: o post mais recente entra na hora; sem novidade, passa pelos últimos 30 a cada 8 s.
// O painel escolhe o que aparece: esquenta, desafios ou os dois.
const GIRO_MS = 8000;
let fotos: Foto[] = [];
let i = 0;
let qr = '';
let mostra: Evento['telao'] = 'ambos';
let giro: number | undefined;
let recarga: number | undefined;
let ouvindo = false;

const tipoMostrado = (): Foto['tipo'] | undefined => (mostra === 'esquenta' ? 'esquenta' : mostra === 'festa' ? 'desafio' : undefined);
const entra = (f: Partial<Foto>) => !f.oculta && (!tipoMostrado() || f.tipo === tipoMostrado());

async function buscar() {
  const ev = await evento();
  mostra = ev.telao;
  fotos = await mural({ limite: 30, tipo: tipoMostrado() });
  return ev;
}

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
      const ev = await buscar();
      qr = await qrDoEvento(ev.codigo, 400);
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
    // pega o que o moderador ocultou e a troca do que o telão mostra
    recarga = window.setInterval(async () => {
      if (rotaAtual().view !== 'telao') return;
      try {
        const atual = fotos[i]?.id;
        await buscar();
        const j = fotos.findIndex((f) => f.id === atual);
        i = j >= 0 ? j : 0;
        if (j < 0) desenhar();
      } catch { /* mantém o que tem */ }
    }, 60_000);
    if (!ouvindo) {
      ouvindo = true;
      ouvirFotos((tipo, f) => {
        if (tipo === 'INSERT' && f.id && entra(f)) {
          fotos.unshift(f as Foto);
          fotos = fotos.slice(0, 30);
          i = 0;
        } else if (tipo === 'DELETE' || (tipo === 'UPDATE' && f.oculta)) {
          const atual = fotos[i]?.id;
          fotos = fotos.filter((x) => x.id !== f.id);
          i = atual !== f.id ? Math.max(0, fotos.findIndex((x) => x.id === atual)) : 0;
        } else return;
        if (rotaAtual().view === 'telao') desenhar();
      });
    }
  });
}

function desenhar() {
  const box = $('v-telao');
  const cheia = document.fullscreenElement ? '' : '<button class="cheia" type="button" id="t-cheia">Tela cheia</button>';
  const entrar = qr ? '<div class="entrar"><p>Leia o QR<br>e participe</p><img alt="QR code do app" src="' + qr + '"></div>' : '';
  if (!fotos.length) {
    box.innerHTML = '<p class="vazio-t">As fotos e os recados aparecem aqui.</p>' + cheia;
  } else {
    const f = fotos[i];
    const esq = f.tipo === 'esquenta';
    const visual = f.caminho
      ? '<img crossorigin="anonymous" alt="' + esc('Foto de ' + f.nome) + '" src="' + esc(urlPublica(f.caminho)) + '">'
      : '<div class="recado-t">' + esc(f.legenda) + '</div>';
    const titulo = f.caminho || f.tema ? tituloPost(f) : 'Recado para os noivos';
    const legenda = f.caminho && f.legenda ? '<p class="t-legenda">“' + esc(f.legenda) + '”</p>' : '';
    const proximas = [1, 2, 3]
      .map((k) => fotos[(i + k) % fotos.length])
      .filter((x, k, arr) => fotos.length > k + 1 && arr.indexOf(x) === k && x.miniatura);
    box.innerHTML =
      '<div class="moldura">' + visual + '</div>' +
      '<div class="lado"><p class="eyebrow">Casamento Babys · ' + (esq ? 'esquenta' : 'desafio cumprido') + '</p>' +
      '<p class="t-desafio">' + esc(titulo) + '</p>' + legenda + '<p class="t-nome">por ' + esc(f.nome) + '</p>' +
      '<div class="rodape"><div class="tiras">' +
      proximas.map((p) => '<img crossorigin="anonymous" alt="" src="' + esc(urlPublica(p.miniatura!)) + '">').join('') +
      '</div>' + entrar + '</div></div>' + cheia;
    // pré-carrega a próxima para a troca não piscar
    const prox = fotos[(i + 1) % fotos.length];
    if (prox?.caminho) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = urlPublica(prox.caminho); }
  }
  document.getElementById('t-cheia')?.addEventListener('click', () => document.documentElement.requestFullscreen?.().then(desenhar).catch(() => {}));
}
