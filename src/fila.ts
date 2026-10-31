import Dexie, { type Table } from 'dexie';
import { compartilhar, cumprir, enviarArquivo } from './api';
import { caminhos, erroDeRede } from './regras';

// Fila de fotos no aparelho: a foto é guardada antes de subir e só sai daqui depois que o banco confirma.
export interface Pendente {
  /** id do sorteio (desafio) ou do post (esquenta): é também o nome do arquivo */
  sorteio: string;
  tipo?: 'desafio' | 'esquenta';
  tema?: string | null;
  legenda?: string | null;
  evento: string;
  uid: string;
  desafio: string;
  foto: Blob;
  mini: Blob;
  criado: number;
  erro?: string;
}

class Banco extends Dexie {
  fila!: Table<Pendente, string>;
  constructor() {
    super('casamento-babys');
    this.version(1).stores({ fila: 'sorteio, criado' });
  }
}
export const db = new Banco();

type Ouvinte = (n: number) => void;
const ouvintes = new Set<Ouvinte>();
export function aoMudarFila(fn: Ouvinte) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}
async function avisar() {
  const n = await totalNaFila();
  ouvintes.forEach((fn) => fn(n));
}

export async function enfileirar(p: Omit<Pendente, 'criado'>) {
  await db.fila.put({ ...p, criado: Date.now() });
  await avisar();
}
export const pendente = (sorteio: string) => db.fila.get(sorteio);
/** Só o que ainda pode entrar (itens recusados pelo banco ficam guardados, mas não contam nem travam a tela). */
export const totalNaFila = () => db.fila.filter((p) => !p.erro).count();

let rodando: Promise<number> | null = null;
/** Envia o que estiver na fila. Devolve quantas fotos entraram no mural. */
export function descarregar(): Promise<number> {
  if (!rodando) rodando = rodar().finally(() => (rodando = null));
  return rodando;
}
async function rodar(): Promise<number> {
  let enviadas = 0;
  for (const p of await db.fila.orderBy('criado').toArray()) {
    if (p.erro) continue;
    const c = caminhos(p.evento, p.uid, p.sorteio);
    try {
      await enviarArquivo(c.mini, p.mini);
      await enviarArquivo(c.foto, p.foto);
      if (p.tipo === 'esquenta') await compartilhar(p.sorteio, c.foto, c.mini, p.tema ?? null, p.legenda ?? null);
      else await cumprir(p.sorteio, c.foto, c.mini);
      await db.fila.delete(p.sorteio);
      enviadas++;
    } catch (e) {
      if (erroDeRede(e) || !navigator.onLine) break; // tenta de novo quando a internet voltar
      // regra do banco (evento fechado, sorteio trocado): guarda o motivo e segue com as outras
      await db.fila.update(p.sorteio, { erro: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) });
    }
  }
  await avisar();
  return enviadas;
}

/** Tenta de novo ao voltar a internet, ao abrir o app e a cada 20 s enquanto houver fila. */
export function iniciarFila(aoEnviar: (n: number) => void) {
  const tentar = async () => {
    if (!navigator.onLine || (await totalNaFila()) === 0) return;
    const n = await descarregar();
    if (n) aoEnviar(n);
  };
  window.addEventListener('online', tentar);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tentar());
  setInterval(tentar, 20_000);
  tentar();
}
