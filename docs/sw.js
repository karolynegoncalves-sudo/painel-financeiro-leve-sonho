/*
 * Service worker do Painel Financeiro.
 *
 * EXISTE POR UM MOTIVO SÓ: sem ele o Chrome do Android não instala a página
 * como aplicativo de verdade (WebAPK) - fica um atalho de navegador, com barra
 * de endereço e sem ícone próprio. Ele NÃO existe para acelerar nada.
 *
 * REDE PRIMEIRO, SEMPRE. Nunca cache primeiro.
 *
 * Esta regra não é preferência de estilo, é a lição do dashboard de produção
 * (02/10/2026): com cache primeiro, a correção publicada fica no servidor e a
 * pessoa segue vendo a tela velha - e pior que ver errado é ver errado DEPOIS
 * de alguém dizer que consertou, porque aí ninguém procura mais o bug. Este
 * painel decide preço e mostra dinheiro: número velho exibido como atual é o
 * pior defeito possível aqui.
 *
 * O cache só é lido quando a rede FALHA, e serve para o painel abrir no tablet
 * dentro do ateliê, onde o wi-fi cai. Quando isso acontece a tela mostra o que
 * deu para guardar da última visita - e é por isso que o app.js carimba a
 * versão do backend na tela: dado velho com aviso é diferente de dado velho
 * disfarçado de novo.
 *
 * O ?v= do index.html continua sendo o que manda na atualização de js e css.
 * Este arquivo não substitui aquilo: ele só evita a tela em branco sem rede.
 */
const CACHE = 'painel-ls-v1';

/* Nada de precache de lista fixa: lista fixa desatualiza junto com o deploy e
   vira a origem do arquivo velho. O cache aqui é só o que já foi baixado com
   sucesso nesta instalação. */
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  /* Só GET do próprio site. POST para o Apps Script nunca pode ser servido de
     cache - seria gravar duas vezes ou responder gravação que não aconteceu. */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const resp = await fetch(req);
      /* Guarda uma cópia só do que veio bem. Resposta de erro em cache seria
         erro servido offline como se fosse a página. */
      if (resp && resp.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, resp.clone());
      }
      return resp;
    } catch (err) {
      const guardado = await caches.match(req);
      if (guardado) return guardado;
      /* Navegação sem rede e sem cache: devolve a última index que tiver. */
      if (req.mode === 'navigate') {
        const index = await caches.match('./');
        if (index) return index;
      }
      throw err;
    }
  })());
});
