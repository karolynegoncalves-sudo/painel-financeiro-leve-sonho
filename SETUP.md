# Setup — passo a passo

Marque cada etapa conforme for fazendo. As etapas 1–4 só a Karolyne consegue
fazer (exigem login na sua conta Google/Bling). Depois disso, o Claude
publica o site.

## 1) Rodar o probe do Bling (se ainda não rodou)

- [ ] Rode `financeiro_detalhe_dre_bling.ps1` (pasta `INTEGRAÇÃO BLING`) e
      mande pro Claude o resultado — confirma o formato exato de categoria
      e banco em cada lançamento antes de ligar a sincronização de verdade.

## 2) Criar a planilha e colar o Apps Script

- [ ] Crie uma planilha Google Sheets nova, chame de
      **"Leve Sonho — Painel Financeiro"**, salve na pasta `FINANCEIRO`.
- [ ] Extensões → Apps Script. Apague o `Code.gs` vazio padrão. Cole os 5
      arquivos da pasta `apps-script/` deste projeto (`appsscript.json` via
      ícone de engrenagem "Mostrar arquivo de manifesto", os outros como
      arquivos `.gs` normais — use o `+` ao lado de "Arquivos").
- [ ] No seletor de função (topo, ao lado de "Depurar"), escolha
      **setupWorkbook** e clique em ▶ Executar. Autorize quando pedir.
      Isso cria as abas `_Acesso`, `_Sync_Log`, `Fluxo de Caixa`, `DRE`,
      `_DRE_Mapa` (já vem com as 65 categorias reais do Bling) e as 5 abas
      `Precificação_<Canal>`.
- [ ] Abra cada aba `Precificação_<Canal>` na planilha — o Google vai pedir
      **"Permitir acesso"** pra cada FPV de origem (é o IMPORTRANGE pedindo
      autorização, uma vez só por arquivo). Clique em permitir em todas.
- [ ] Confira a aba `_Acesso`: seu e-mail já deve estar lá com `ativo=TRUE`.
      Adicione uma linha por pessoa convidada (`email`, `nome`, `papel`,
      `ativo=TRUE`).

## 3) Conectar o Bling (autorização própria deste Apps Script)

- [ ] No editor do Apps Script, na função `configurarClienteBling`, rode
      manualmente passando o `client_id` e `client_secret` do arquivo
      `bling_config.json` (visualização → executar função → cole os
      parâmetros, ou rode uma vez direto no editor:
      `configurarClienteBling('SEU_CLIENT_ID', 'SEU_CLIENT_SECRET')`).
- [ ] Rode **iniciarAutorizacaoBling**. Veja → Registros (Ctrl+Enter): vai
      aparecer um `redirect_uri` e uma URL de autorização.
- [ ] Cadastre esse `redirect_uri` no app do Bling em
      developer.bling.com.br/aplicativos (editar o app existente, adicionar
      essa URL na lista de redirect URIs autorizadas).
- [ ] Abra a URL de autorização (a última linha do Log) logada no Bling e
      clique em Autorizar. Deve aparecer "Bling conectado com sucesso".
- [ ] De volta ao editor, rode **syncBling** uma vez pra testar. Depois
      **criarGatilhoSync** pra deixar automático (a cada 2h).

## 4) Implantar o Web App

- [ ] No editor: Implantar → Nova implantação → tipo "App da Web".
      Executar como: **Eu**. Quem tem acesso: **Qualquer pessoa**.
- [ ] Copie a URL que termina em `/exec` — é o `APPS_SCRIPT_URL`.
- [ ] No mesmo editor, rode uma vez:
      `configurarClienteGoogle('SEU_GOOGLE_CLIENT_ID')` (ver passo 5 abaixo
      pra pegar esse ID antes).

## 5) Google Cloud — Client ID para o login

- [ ] console.cloud.google.com → crie um projeto (ou use um existente) →
      "APIs e serviços" → "Credenciais" → "Criar credenciais" → "ID do
      cliente OAuth" → tipo **Aplicativo da Web**.
- [ ] Em "Origens JavaScript autorizadas", adicione
      `https://<seu-usuario-github>.github.io` (sem barra no final).
- [ ] Copie o Client ID gerado.

## 6) Ligar o site ao backend

- [ ] Mande pro Claude o `APPS_SCRIPT_URL` (passo 4) e o `GOOGLE_CLIENT_ID`
      (passo 5) — ele preenche `site/js/config.js` e publica no GitHub.

## 7) Testar

- [ ] Abrir o site publicado, logar com seu e-mail (deve entrar).
- [ ] Pedir pra alguém **não convidado** tentar logar (deve ver a mensagem
      de acesso negado, sem dado nenhum).
- [ ] Conferir se os números de Fluxo de Caixa/DRE batem com o Bling.
