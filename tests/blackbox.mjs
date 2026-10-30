// Teste de caixa preta: faz o que um estranho faria só com o que está público no site
// (a URL do Supabase e a chave publicável) e confere que nada vaza. Roda a cada deploy.
// Uso: node tests/blackbox.mjs [pasta-do-build]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const cfg = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
const URL_ = cfg.match(/SUPABASE_URL = '([^']+)'/)[1];
const KEY = cfg.match(/SUPABASE_PUBLISHABLE_KEY = '([^']+)'/)[1];
const TABLES = ['eventos', 'app_admins', 'convidados', 'desafios', 'sorteios', 'fotos'];
const RPCS = [['entrar', { p_codigo: 'x', p_nome: 'x' }], ['estado', {}], ['sortear', {}], ['trocar', { p_sorteio: '00000000-0000-4000-8000-000000000000' }],
  ['cumprir', { p_sorteio: '00000000-0000-4000-8000-000000000000', p_caminho: 'x', p_miniatura: 'x' }], ['sou_admin', {}], ['meu_evento', {}]];
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYWFhYWFhYS0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMGEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDEwMjQ0NDgwMH0.assinatura-falsa';

let fails = 0;
const ok = (m) => console.log('ok     ' + m);
const bad = (m) => { fails++; console.log('FALHOU ' + m); };
const skip = (m) => console.log('pulei  ' + m);

async function call(path, { method = 'GET', body, auth, headers: extra } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (auth) headers.Authorization = auth;
  let r;
  for (let i = 0; i < 4; i++) {
    r = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    if (r.status < 502 || r.status > 504) break;
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  let data = null;
  try { data = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, data };
}
const closed = (r) => r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0);

// 1) Tabelas e funções sem login (e com um login forjado)
for (const t of TABLES) {
  for (const [who, auth] of [['sem login', undefined], ['com token forjado', 'Bearer ' + FAKE_JWT]]) {
    const r = await call(`/rest/v1/${t}?select=*&limit=5`, { auth });
    closed(r) ? ok(`${t}: leitura ${who} bloqueada (${r.status})`) : bad(`${t}: leitura ${who} devolveu ${r.data.length} linha(s)`);
  }
  const ins = await call(`/rest/v1/${t}`, { method: 'POST', body: {} });
  ins.status >= 400 ? ok(`${t}: criação sem login bloqueada (${ins.status})`) : bad(`${t}: criou linha sem login`);
}
for (const [fn, args] of RPCS) {
  const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
  r.status >= 400 ? ok(`${fn}(): sem login bloqueada (${r.status})`) : bad(`${fn}(): respondeu sem login (${r.status})`);
}

// 2) Storage: listar e enviar sem login
const lista = await call('/storage/v1/object/list/fotos', { method: 'POST', body: { prefix: '', limit: 10 } });
closed(lista) ? ok(`fotos: listagem sem login bloqueada (${lista.status})`) : bad('fotos: listagem sem login devolveu arquivos');
const up = await call('/storage/v1/object/fotos/teste/teste.jpg', { method: 'POST', body: 'x', headers: { 'Content-Type': 'image/jpeg' } });
up.status >= 400 ? ok(`fotos: envio sem login bloqueado (${up.status})`) : bad('fotos: aceitou envio sem login');

// 3) Convidado anônimo sem o código do QR: não vê nada, não sorteia, não envia
const anon = await call('/auth/v1/signup', { method: 'POST', body: {} });
if (anon.status === 200 && anon.data?.access_token) {
  const auth = 'Bearer ' + anon.data.access_token;
  const uid = anon.data.user.id;
  for (const t of TABLES) {
    const r = await call(`/rest/v1/${t}?select=*&limit=5`, { auth });
    closed(r) ? ok(`${t}: anônimo sem código não lê`) : bad(`${t}: anônimo sem código leu ${r.data.length} linha(s)`);
  }
  const s = await call('/rest/v1/rpc/sortear', { method: 'POST', body: {}, auth });
  s.status >= 400 ? ok('sortear(): anônimo sem código bloqueado') : bad('sortear(): anônimo sem código sorteou');
  const e = await call('/rest/v1/rpc/entrar', { method: 'POST', body: { p_codigo: 'codigo-inventado', p_nome: 'Teste' }, auth });
  e.status >= 400 ? ok('entrar(): código inventado recusado') : bad('entrar(): aceitou código inventado');
  const adm = await call('/rest/v1/rpc/sou_admin', { method: 'POST', body: {}, auth });
  adm.data === false ? ok('sou_admin(): anônimo não é admin') : bad('sou_admin(): anônimo respondeu ' + JSON.stringify(adm.data));
  const u = await call(`/storage/v1/object/fotos/x/${uid}/teste.jpg`, { method: 'POST', body: 'x', auth, headers: { 'Content-Type': 'image/jpeg' } });
  u.status >= 400 ? ok(`fotos: anônimo sem código não envia (${u.status})`) : bad('fotos: anônimo sem código enviou arquivo');
} else {
  skip(`login anônimo desligado no projeto (${anon.status}); ligue em Authentication › Sign In / Providers`);
}

// 4) O site publicado não carrega segredos
const dir = process.argv[2];
if (dir) {
  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
  walk(dir);
  const texto = files.filter((f) => /\.(js|html|json|webmanifest)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  /sb_secret_|service_role/.test(texto) ? bad('build contém chave secreta') : ok('build sem chave secreta');
  /babys-[0-9a-z]{6}/.test(texto) ? bad('build contém o código do evento') : ok('build sem o código do evento (só o QR o carrega)');
}

console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
