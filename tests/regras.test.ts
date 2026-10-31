import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caminhos, codigoDaRota, diasAte, erroDeRede, lerLista, medidas, mensagemErro, nomeArquivo, rotuloTrocas, textoContagem, textoFaltam,
  textoLimitesEsquenta, textoProgresso, tituloPost,
} from '../src/regras.ts';

test('medidas: reduz pelo lado maior e nunca amplia', () => {
  assert.deepEqual(medidas(4032, 3024, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(medidas(3024, 4032, 1600), { w: 1200, h: 1600 });
  assert.deepEqual(medidas(800, 600, 1600), { w: 800, h: 600 });
  assert.deepEqual(medidas(0, 600, 1600), { w: 0, h: 0 });
  assert.deepEqual(medidas(10000, 3, 480), { w: 480, h: 1 });
});

test('trocas, progresso e o que falta', () => {
  assert.equal(rotuloTrocas(2), 'Trocar desafio · 2 trocas restantes');
  assert.equal(rotuloTrocas(1), 'Trocar desafio · 1 troca restante');
  assert.equal(rotuloTrocas(0), 'Sem trocas restantes');
  assert.equal(textoProgresso(0, 3), 'Desafio 1 de 3');
  assert.equal(textoProgresso(3, 3), 'Desafio 3 de 3');
  assert.equal(textoFaltam(1, 3), 'Faltam 2 desafios para você');
  assert.equal(textoFaltam(2, 3), 'Falta 1 desafio para você');
  assert.equal(textoFaltam(3, 3), 'Você cumpriu todos os seus desafios');
});

test('lerLista: tira numeração, marcadores, vazios e repetidos', () => {
  const texto = [
    'Tire uma foto com o DJ.',
    '42. Tire uma foto simulando um pedido de casamento.',
    '43) Tire uma foto como se fosse uma banda de rock.',
    '- Fotografe alguém que esteja dançando sozinho.',
    '• Fotografe o detalhe mais inusitado',
    '',
    '   ',
    'ok',
    'tire uma foto com o dj.',
    'Tire uma foto   com espaços   demais ',
  ].join('\n');
  assert.deepEqual(lerLista(texto), [
    'Tire uma foto com o DJ.',
    'Tire uma foto simulando um pedido de casamento.',
    'Tire uma foto como se fosse uma banda de rock.',
    'Fotografe alguém que esteja dançando sozinho.',
    'Fotografe o detalhe mais inusitado',
    'Tire uma foto com espaços demais',
  ]);
  assert.deepEqual(lerLista('x'.repeat(201)), []);
});

test('caminhos batem com o que o banco confere', () => {
  assert.deepEqual(caminhos('ev', 'uid', 's1'), { foto: 'ev/uid/s1.jpg', mini: 'ev/uid/s1-mini.jpg' });
});

test('nomeArquivo: ordenável e sem caracteres proibidos', () => {
  assert.equal(nomeArquivo(7, 'Tire uma foto com o DJ.', 'Ana'), '007 - Tire uma foto com o DJ - Ana.jpg');
  assert.equal(nomeArquivo(12, 'Foto: "3/3" <ok>?', 'Tio/Carlos'), '012 - Foto 3 3 ok - Tio Carlos.jpg');
  assert.equal(nomeArquivo(1, '', ''), '001 - desafio - convidado.jpg');
});

test('codigoDaRota', () => {
  assert.equal(codigoDaRota('#/e/babys-368717'), 'babys-368717');
  assert.equal(codigoDaRota('#/e/BABYS-368717/'), 'babys-368717');
  assert.equal(codigoDaRota('#/mural'), null);
  assert.equal(codigoDaRota('#/e/x'), null);
});

test('mensagens de erro em português e erro de rede separado de regra', () => {
  assert.equal(mensagemErro({ message: 'sem_trocas', code: 'P0001' }), 'Você já usou suas trocas.');
  assert.equal(mensagemErro(new Error('codigo_invalido')), 'Esse QR não é do casamento. Leia o QR da placa da mesa.');
  assert.match(mensagemErro(new TypeError('Failed to fetch')), /Sem internet/);
  assert.match(mensagemErro({ message: 'Anonymous sign-ins are disabled' }), /liberado/);
  assert.equal(mensagemErro({ message: 'Invalid login credentials', code: 'invalid_credentials' }), 'E-mail ou senha errados.');
  assert.equal(mensagemErro('qualquer coisa'), 'Algo deu errado. Tente de novo.');
  assert.equal(erroDeRede(new TypeError('Failed to fetch')), true);
  assert.equal(erroDeRede(new TypeError('Load failed')), true);
  assert.equal(erroDeRede({ message: 'evento_fechado' }), false);
});

test('esquenta: contagem regressiva, limites e título do post', () => {
  assert.equal(diasAte('2026-11-21', new Date(2026, 9, 30, 23, 50)), 22);
  assert.equal(diasAte('2026-11-21', new Date(2026, 10, 21, 0, 5)), 0);
  assert.equal(textoContagem(22), 'Faltam 22 dias');
  assert.equal(textoContagem(1), 'Falta 1 dia');
  assert.equal(textoContagem(0), 'É hoje!');
  assert.equal(textoContagem(-1), '');
  assert.equal(textoLimitesEsquenta(3, 3), 'Você ainda pode mandar 3 fotos e 3 recados.');
  assert.equal(textoLimitesEsquenta(1, 0), 'Recados esgotados. Você ainda pode mandar 1 foto.');
  assert.equal(textoLimitesEsquenta(0, 2), 'Fotos esgotadas. Você ainda pode mandar 2 recados.');
  assert.match(textoLimitesEsquenta(0, 0), /todas as suas/);
  assert.equal(tituloPost({ desafio_texto: 'Tire uma foto com o DJ.' }), 'Tire uma foto com o DJ.');
  assert.equal(tituloPost({ tema: 'O look em construção', caminho: 'x.jpg' }), 'O look em construção');
  assert.equal(tituloPost({ caminho: 'x.jpg' }), 'Momento');
  assert.equal(tituloPost({ caminho: null }), 'Recado');
  assert.equal(mensagemErro({ message: 'limite_recados' }), 'Você já mandou todos os seus recados.');
  assert.equal(mensagemErro({ message: 'fase_esquenta' }), 'Os desafios começam no dia do casamento!');
});
