import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export interface Sorteio { id: string; desafio_id: string; texto: string }
export type Fase = 'esquenta' | 'festa';
export interface Estado {
  nome: string; evento_id: string; evento: string; data: string; aberto: boolean; fase: Fase;
  sorteio: Sorteio | null; feitos: number; max_desafios: number; trocas_restantes: number;
  temas: string[]; fotos_esquenta: number; max_fotos_esquenta: number; recados: number; max_recados: number;
}
export interface Foto {
  id: string; evento_id: string; tipo: 'desafio' | 'esquenta';
  sorteio_id: string | null; convidado_id: string; desafio_id: string | null;
  nome: string; desafio_texto: string | null; tema: string | null; legenda: string | null;
  caminho: string | null; miniatura: string | null; oculta: boolean; criado_em: string;
}
export interface Evento {
  id: string; codigo: string; nome: string; data: string; aberto: boolean; max_trocas: number; max_desafios: number;
  fase: Fase; festa_a_partir: string | null; max_fotos_esquenta: number; max_recados: number; temas: string[];
  telao: 'ambos' | 'esquenta' | 'festa';
}
export interface Desafio { id: string; texto: string; ativo: boolean; ordem: number }

const FOTO_COLS = 'id,evento_id,tipo,sorteio_id,convidado_id,desafio_id,nome,desafio_texto,tema,legenda,caminho,miniatura,oculta,criado_em';

function ok<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

/* ---------- sessão ---------- */
export async function sessao() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export async function meuId(): Promise<string | null> {
  return (await sessao())?.user.id ?? null;
}
/** Convidado entra sem e-mail: sessão anônima guardada no aparelho. */
export async function garantirSessao(): Promise<string> {
  const s = await sessao();
  if (s) return s.user.id;
  const r = await supabase.auth.signInAnonymously();
  if (r.error) throw r.error;
  return r.data.user!.id;
}

/* ---------- convidado ---------- */
export async function entrar(codigo: string, nome: string) {
  await garantirSessao();
  return ok(await supabase.rpc('entrar', { p_codigo: codigo, p_nome: nome })) as { evento_id: string; evento: string };
}
export async function estado(): Promise<Estado | null> {
  if (!(await sessao())) return null;
  return ok(await supabase.rpc('estado')) as Estado | null;
}
export async function sortear(): Promise<Estado> {
  return ok(await supabase.rpc('sortear')) as Estado;
}
export async function trocar(sorteio: string): Promise<Estado> {
  return ok(await supabase.rpc('trocar', { p_sorteio: sorteio })) as Estado;
}
export async function enviarArquivo(caminho: string, blob: Blob) {
  const { error } = await supabase.storage.from('fotos').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  // já subiu numa tentativa anterior da fila
  if (error && !/exists|Duplicate|409/i.test(error.message + ' ' + ('statusCode' in error ? String(error.statusCode) : ''))) throw error;
}
export async function cumprir(sorteio: string, foto: string, mini: string): Promise<string> {
  return ok(await supabase.rpc('cumprir', { p_sorteio: sorteio, p_caminho: foto, p_miniatura: mini })) as string;
}
/** Esquenta: foto e/ou recado. O id vem do celular (nome do arquivo), para a fila reenviar sem duplicar. */
export async function compartilhar(id: string, foto: string | null, mini: string | null, tema: string | null, legenda: string | null): Promise<string> {
  return ok(await supabase.rpc('compartilhar', { p_id: id, p_caminho: foto, p_miniatura: mini, p_tema: tema, p_legenda: legenda })) as string;
}
/** Fase pelo código do QR, antes do login (só a fase; código inventado devolve nulo). */
export async function faseDoEvento(codigo: string): Promise<Fase | null> {
  return ok(await supabase.rpc('fase_do_evento', { p_codigo: codigo })) as Fase | null;
}
/** Fase sem código, para o endereço puro do app (só a fase). */
export async function fasePublica(): Promise<Fase | null> {
  return ok(await supabase.rpc('fase_publica')) as Fase | null;
}
export async function faseAtual(): Promise<Fase | null> {
  return ok(await supabase.rpc('fase_atual')) as Fase | null;
}

/* ---------- mural ---------- */
export const urlPublica = (caminho: string) => supabase.storage.from('fotos').getPublicUrl(caminho).data.publicUrl;

export async function mural(opts: { antes?: string; soMinhas?: boolean; limite?: number; incluirOcultas?: boolean; tipo?: Foto['tipo'] }): Promise<Foto[]> {
  let q = supabase.from('fotos').select(FOTO_COLS).order('criado_em', { ascending: false }).limit(opts.limite ?? 30);
  if (opts.tipo) q = q.eq('tipo', opts.tipo);
  if (opts.antes) q = q.lt('criado_em', opts.antes);
  if (!opts.incluirOcultas) q = q.eq('oculta', false);
  if (opts.soMinhas) {
    const uid = await meuId();
    if (!uid) return [];
    q = q.eq('convidado_id', uid);
  }
  return ok(await q) as Foto[];
}
/** Fotos novas e removidas, ao vivo (o RLS decide o que chega a cada um). */
export function ouvirFotos(cb: (tipo: 'INSERT' | 'UPDATE' | 'DELETE', f: Partial<Foto>) => void): RealtimeChannel {
  return supabase
    .channel('fotos-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fotos' }, (p) => {
      cb(p.eventType as 'INSERT' | 'UPDATE' | 'DELETE', (p.eventType === 'DELETE' ? p.old : p.new) as Partial<Foto>);
    })
    .subscribe();
}

/* ---------- noivos e moderadores ---------- */
/** Noivos e moderadores: conta criada no painel do Supabase (Authentication › Users), sem depender de envio de e-mail. */
export async function loginSenha(email: string, senha: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
}
export async function sair() {
  await supabase.auth.signOut();
}
export async function souAdmin(): Promise<boolean> {
  const s = await sessao();
  if (!s || s.user.is_anonymous) return false;
  return (ok(await supabase.rpc('sou_admin')) as boolean) === true;
}
export async function evento(): Promise<Evento> {
  return ok(await supabase.from('eventos').select('id,codigo,nome,data,aberto,max_trocas,max_desafios,fase,festa_a_partir,max_fotos_esquenta,max_recados,temas,telao').order('criado_em').limit(1).single()) as Evento;
}
export async function salvarEvento(id: string, campos: Partial<Omit<Evento, 'id' | 'codigo' | 'nome' | 'data'>>) {
  ok(await supabase.from('eventos').update(campos).eq('id', id));
}
export async function desafios(eventoId: string): Promise<Desafio[]> {
  return ok(await supabase.from('desafios').select('id,texto,ativo,ordem').eq('evento_id', eventoId).order('ordem').order('criado_em')) as Desafio[];
}
export async function incluirDesafios(eventoId: string, textos: string[], ordemInicial: number) {
  if (!textos.length) return;
  const linhas = textos.map((texto, i) => ({ evento_id: eventoId, texto, ordem: ordemInicial + i }));
  ok(await supabase.from('desafios').upsert(linhas, { onConflict: 'evento_id,texto', ignoreDuplicates: true }));
}
export async function ligarDesafio(id: string, ativo: boolean) {
  ok(await supabase.from('desafios').update({ ativo }).eq('id', id));
}
export async function contarConvidados(): Promise<number> {
  const r = await supabase.from('convidados').select('id', { count: 'exact', head: true });
  if (r.error) throw r.error;
  return r.count ?? 0;
}
export async function todasFotos(): Promise<Foto[]> {
  const out: Foto[] = [];
  for (let de = 0; ; de += 1000) {
    const page = ok(await supabase.from('fotos').select(FOTO_COLS).order('criado_em').range(de, de + 999)) as Foto[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
export async function ocultar(id: string, oculta: boolean) {
  ok(await supabase.from('fotos').update({ oculta }).eq('id', id));
}
export async function admins(): Promise<string[]> {
  return (ok(await supabase.from('app_admins').select('email').order('criado_em')) as { email: string }[]).map((a) => a.email);
}
export async function incluirAdmin(email: string) {
  ok(await supabase.from('app_admins').insert({ email: email.trim().toLowerCase() }));
}
export async function removerAdmin(email: string) {
  ok(await supabase.from('app_admins').delete().eq('email', email));
}
