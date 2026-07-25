# Leve Sonho — Painel Financeiro

Dashboard único de **Precificação**, **Fluxo de Caixa**, **DRE** e **KPIs**,
sincronizado ao vivo com o Bling (financeiro) e as planilhas FPV 2026,
publicado no GitHub Pages e restrito a e-mails convidados via login Google.

## Como as peças se encaixam

```
GitHub Pages (docs/)         Google Apps Script (apps-script/)      Bling API v3
  index.html + js/app.js  <-> Web App (Code.gs) valida login e   <-> contas a pagar/receber,
  Login Google (GIS)          responde JSON por view                 depósitos, categorias
                               grava em "Fluxo de Caixa" e "DRE"
                               lê "Precificação_<Canal>" (espelho
                               ao vivo dos FPVs 2026 via IMPORTRANGE)
```

- **`docs/`** — o que vira o site publicado no GitHub Pages (nome exigido
  pelo GitHub para servir de uma subpasta). Puro HTML/CSS/JS, sem build step.
- **`apps-script/`** — cole estes arquivos no editor do Apps Script, dentro de
  uma planilha Google Sheets nova. É o backend: guarda os dados, fala com o
  Bling, e decide quem pode ver o quê.

Veja o passo a passo completo em [SETUP.md](SETUP.md).
