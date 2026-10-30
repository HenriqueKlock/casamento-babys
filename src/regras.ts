// Regras sem tela e sem rede: testadas em tests/regras.test.ts.

/** Tamanho final da foto mantendo a proporção, sem ampliar. */
export function medidas(w: number, h: number, max: number): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export const FOTO_MAX = 1600;
export const MINI_MAX = 480;

export function rotuloTrocas(restantes: number): string {
  if (restantes <= 0) return 'Sem trocas restantes';
  return 'Trocar desafio · ' + restantes + (restantes === 1 ? ' troca restante' : ' trocas restantes');
}

/** "Desafio 2 de 3" para quem está fazendo o desafio aberto. */
export function textoProgresso(feitos: number, max: number): string {
  return 'Desafio ' + Math.min(feitos + 1, max) + ' de ' + max;
}

export function textoFaltam(feitos: number, max: number): string {
  const n = Math.max(0, max - feitos);
  if (n === 0) return 'Você cumpriu todos os seus desafios';
  return n === 1 ? 'Falta 1 desafio para você' : 'Faltam ' + n + ' desafios para você';
}

/** Lista colada no painel: um por linha, sem numeração ou marcador, sem repetidos. */
export function lerLista(texto: string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const t = linha.replace(/^\s*(?:\d+\s*[.)\-–]\s*|[-•*]\s+)/, '').replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 200) continue;
    const chave = t.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(t);
  }
  return out;
}

/** Caminhos no Storage: <evento>/<uid>/<sorteio>.jpg e a miniatura. O banco confere exatamente isso. */
export function caminhos(evento: string, uid: string, sorteio: string): { foto: string; mini: string } {
  const pasta = evento + '/' + uid + '/' + sorteio;
  return { foto: pasta + '.jpg', mini: pasta + '-mini.jpg' };
}

/** Nome do arquivo no .zip do painel: "007 - Tire uma foto com o DJ - Ana.jpg". */
export function nomeArquivo(i: number, desafio: string, nome: string): string {
  const limpar = (s: string, max: number) =>
    s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, max).trim();
  return String(i).padStart(3, '0') + ' - ' + (limpar(desafio, 90) || 'desafio') + ' - ' + (limpar(nome, 40) || 'convidado') + '.jpg';
}

/** Código do evento na rota #/e/<código>. */
export function codigoDaRota(hash: string): string | null {
  const m = hash.replace(/^#\/?/, '').match(/^e\/([a-z0-9-]{6,40})\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

const MENSAGENS: Record<string, string> = {
  codigo_invalido: 'Esse QR não é do casamento. Leia o QR da placa da mesa.',
  evento_fechado: 'Os envios já foram encerrados. Obrigado por participar!',
  nome_invalido: 'Digite seu nome (até 40 letras).',
  outro_evento: 'Este celular já está em outro evento.',
  sem_convidado: 'Leia o QR da placa da mesa para começar.',
  limite_desafios: 'Você já cumpriu todos os seus desafios.',
  sem_desafios: 'Você já passou por todos os desafios da lista!',
  sem_trocas: 'Você já usou suas trocas.',
  sorteio_invalido: 'Esse desafio não está mais aberto. Atualize a tela.',
  caminho_invalido: 'Não deu para registrar a foto. Tente de novo.',
  arquivo_faltando: 'A foto não terminou de subir. Tente de novo.',
  anonymous_provider_disabled: 'O app ainda não foi liberado para convidados.',
};

/** Erro do banco ou da rede em uma frase para o convidado. */
export function mensagemErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  for (const k of Object.keys(MENSAGENS)) if (msg.includes(k) || code === k) return MENSAGENS[k];
  if (/Anonymous sign-ins are disabled/i.test(msg)) return MENSAGENS.anonymous_provider_disabled;
  if (/Invalid login credentials/i.test(msg) || code === 'invalid_credentials') return 'E-mail ou senha errados.';
  if (/Email not confirmed/i.test(msg)) return 'Conta sem confirmação: marque "Auto Confirm User" ao criar no Supabase.';
  if (/rate limit|too many/i.test(msg)) return 'Muita gente entrando ao mesmo tempo. Tente de novo em um minuto.';
  if (/fetch|network|offline|Failed to fetch|Load failed/i.test(msg)) return 'Sem internet agora. Tente de novo em instantes.';
  return 'Algo deu errado. Tente de novo.';
}

/** Erro de rede (a foto fica na fila) e não de regra (a foto não vai entrar). */
export function erroDeRede(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  return /fetch|network|offline|Load failed|timeout|ECONN|502|503|504/i.test(msg);
}
