# Casamento Babys · Desafios

Duas fases. No **Esquenta**, até o dia, o convidado entra pelo link, compartilha fotos e recados (com temas sugeridos) e tudo vai para o mural. Na **Festa**, ele lê o QR da mesa, digita o nome e recebe um desafio sorteado. Ele cumpre, tira a foto e ela entra no mural e no telão. Depois da festa, os noivos baixam tudo num .zip.

- App: https://henriqueklock.github.io/casamento-babys/ (o convidado entra só pelo link do QR, que leva o código do evento).
- Plano e telas: documento "Casamento Babys — app de desafios" e o canvas "Casamento Babys — mockup".
- Segue os padrões do [Enche AI](https://github.com/HenriqueKlock/encheai).

## Como funciona

- **Celular (PWA):** Vite + TypeScript, sem framework. Telas em `src/screens/`, rotas por endereço em `src/router.ts` (`#/e/<código>`, `#/desafio`, `#/mural`, `#/painel`, `#/telao`).
  - Regras sem tela, testadas: `src/regras.ts`.
  - Fotos: reduzidas no aparelho para 1600 px e miniatura de 480 px em JPEG, giradas pelo EXIF (`src/imagem.ts`).
  - Fila offline: a foto fica no IndexedDB (Dexie) até o banco confirmar. Ela sobe sozinha ao voltar a internet, ao abrir o app e a cada 20 s (`src/fila.ts`).
  - O service worker guarda as fotos do mural (o caminho de cada uma nunca muda). Atualização automática, sem aviso ao convidado.
- **Supabase (projeto `casamento-babys`, São Paulo):**
  - Convidado entra com **login anônimo**. Noivos e moderadores entram com **e-mail e senha**, numa conta criada no painel do Supabase (nada depende de envio de e-mail), e precisam estar em `app_admins` (por e-mail, preenchida no banco ou pelo painel). `sou_admin()` só aceita conta com e-mail confirmado.
  - Tabelas: `eventos`, `convidados`, `desafios`, `sorteios`, `fotos`, todas com RLS. O convidado só vê os desafios que sorteou (a lista é surpresa), os próprios sorteios e as fotos não ocultas do evento.
  - Foto que entrou no mural fica: o convidado não apaga nem a própria (nem a linha, nem o arquivo). Só noivos e moderadores ocultam pelo painel, e só eles podem apagar.
  - Funções (`security definer`), o único caminho de escrita do convidado:
    - `entrar(código, nome)`: confere o código do QR e se o evento está aberto.
    - `sortear()`: um desafio aberto por vez. Escolhe, entre os ligados que a pessoa ainda não teve, o que menos gente está fazendo ou fez, com desempate aleatório.
    - `trocar(sorteio)`: até `max_trocas` por pessoa.
    - `cumprir(sorteio, foto, miniatura)`: confere que o sorteio é da pessoa, que os caminhos são `<evento>/<uid>/<sorteio>.jpg` e `-mini.jpg` e que os dois arquivos existem. Reenviar devolve a mesma foto, para a fila poder repetir sem duplicar.
    - `estado()`: a fase, o desafio aberto, quantos já cumpriu, as trocas que restam e o que ainda pode mandar no esquenta.
    - `compartilhar(id, foto, miniatura, tema, legenda)`: só no esquenta. Foto (até `max_fotos_esquenta`, padrão 3) ou recado sem foto (até `max_recados`, padrão 3); o tema precisa estar na lista do evento. O id vem do celular, para a fila reenviar sem duplicar.
    - `fase_do_evento(código)` e `fase_publica()`: liberadas sem login, devolvem só a fase. O endereço sem código usa `fase_publica()`: no esquenta abre a entrada e `entrar('', nome)` funciona; na festa pede o QR e `entrar` sem código recusa.
  - Fase: `eventos.fase` (esquenta ou festa, no painel) ou virada automática em `festa_a_partir`. No esquenta, `sortear()` recusa; na festa, `compartilhar()` recusa.
  - Telão: `eventos.telao` escolhe o que aparece (os dois, só o esquenta ou só os desafios).
  - Storage: bucket `fotos` público (caminhos com ids aleatórios, sem listagem), só JPEG até 3 MB. Cada um só envia na própria pasta e com o evento aberto.
  - Tempo real em `fotos` para o mural e o telão. O telão relê a lista a cada 60 s para tirar as que o moderador ocultou.
- **O evento e a lista de desafios ficam só no banco**, nunca no repositório (surpresa, e o código do QR não fica público). Mudanças de lista se fazem pelo painel.

## Painel (`#/painel`) e telão (`#/telao`)

- **Painel:** envios abertos ou fechados, desafios e trocas por pessoa, QR para imprimir, ligar e desligar desafios, incluir desafios (um por linha, aceita numeração), moderação (ocultar ou mostrar), moderadores e o .zip de todas as fotos (as ocultas numa pasta à parte).
- **Telão:** abrir num computador ligado à TV ou projetor, logado no painel. Foto nova entra na hora; sem novidade, passa pelas últimas 30 a cada 8 s.

## Desenvolvimento

```
npm ci
npm run dev        # http://localhost:5173/casamento-babys/
npm test           # regras
npm run check      # tipos
```

- `supabase/tests/regras.sql`: rodar no SQL do Supabase. Simula dois convidados e um admin e termina com um erro de propósito ("TESTES OK") que desfaz tudo.
- `tests/blackbox.mjs`: roda a cada deploy, só com o que é público.

## Configuração que só o dono do projeto faz

1. **Supabase › Authentication › Users › Add user › Create new user:** e-mail e senha de cada noivo ou moderador, com **Auto Confirm User** marcado. Depois, inclua o e-mail em "Noivos e moderadores" no painel (o seu já está).
2. **Supabase › Authentication:**
   - *Sign In / Providers*: ligar **Allow anonymous sign-ins**.
   - *Rate Limits*: **anonymous sign-ins** em 500 por hora. No Wi-Fi do salão, todos saem pelo mesmo IP.
   - *URL Configuration*: Site URL e Redirect URLs = `https://henriqueklock.github.io/casamento-babys/`.
3. **GitHub › Settings › Pages:** Source = GitHub Actions.

## Depois da festa

1. No painel, desmarcar "Envios abertos" e baixar o .zip (no computador).
2. Conferir o .zip e guardar.
3. Pausar ou apagar o projeto `casamento-babys` no Supabase (apagar tira as fotos do servidor).
