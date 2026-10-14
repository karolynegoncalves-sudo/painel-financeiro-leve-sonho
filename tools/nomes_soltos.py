# -*- coding: utf-8 -*-
"""
Acha nome do PROJETO usado e nunca declarado.
Uso:  python tools/nomes_soltos.py "apps-script/*.gs"

POR QUE EXISTE. Em 14/10/2026 eu escrevi `ABA_FLUXO` achando que era o nome
da constante da aba Fluxo de Caixa. O nome certo e `ABA_FLUXO_CAIXA`. O
codigo passou no checkjs (sintaxe perfeita) e no nomes_dup (nenhum nome
repetido), foi commitado, foi pra ela colar - e quebrou na cara dela, em
tempo de execucao: "ReferenceError: ABA_FLUXO is not defined".

Os outros dois nao tinham como pegar. O checkjs olha a FORMA de um arquivo;
o nomes_dup olha COLISAO entre arquivos. Nenhum pergunta se o nome usado
existe em algum lugar.

O QUE ELE CHECA, e so isso de proposito: identificadores que seguem as
convencoes DESTE projeto, onde todo nome e nosso e nao da linguagem:
  - CONSTANTE_EM_CAIXA_ALTA  (ABA_VENDAS, COLS_FLUXO_, TETO_TOTAL_MS)
  - nomeTerminandoEm_        (custoDoSku_, mostrarRelatorio_, ehRecebimento_)

Nao e um resolvedor de escopo. Variavel local, propriedade e nome de
biblioteca ficam de fora por construcao.

OS DOIS FALSOS POSITIVOS QUE ELE JA TEVE, e que estao tratados, porque
validador que acusa 16 nomes bons ensina a ignorar validador:
  1. UMA LINHA DECLARANDO VARIOS: `const COL_A = 3, COL_B = 4, COL_C = 5`.
     A primeira versao so via COL_A e acusava os outros dois. Eram 14 dos 16.
  2. CHAVE DE OBJETO LITERAL: `XGG: 1` dentro do TAMANHOS_SKU_. Chave nao e
     referencia.
  3. DECLARACAO QUEBRADA EM VARIAS LINHAS:
         const COL_SITUACAO = 3, COL_CAT_ID = 4, COL_CAT_NOME = 5, COL_GRUPO = 6,
               COL_PORT_ID = 7, COL_PORT_NOME = 8,
               COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
     Lendo linha a linha, a segunda e a terceira nao tem `const` e os nomes
     delas pareciam soltos. Agora a leitura carrega o estado "estou dentro de
     uma declaracao" ate o `;`.
"""
import re
import sys
import glob
import os

BARRA = chr(92)
ASPAS = (chr(39), chr(34), chr(96))

# da linguagem, mas casa com o padrao de CAIXA ALTA
BUILTINS = set(['JSON', 'NaN', 'Infinity'])

# nosso: CAIXA_ALTA(_) com 3+ caracteres, ou qualquer coisa terminando em _
NOSSO = re.compile(r'\b([A-Z][A-Z0-9_]{2,}_?|[A-Za-z$][\w$]*_)\b')

# primeiro nome depois de var/const/let/function
DECL_1 = re.compile(r'\b(?:var|const|let|function)\s+([A-Za-z_$][\w$]*)')
# a cauda de uma declaracao, pra pegar os demais nomes da mesma linha
DECL_CAUDA = re.compile(r'\b(?:var|const|let)\s+(.*)$')
DECL_NOMES = re.compile(r'(?:^|[,{\[])\s*([A-Za-z_$][\w$]*)\s*(?==|,|;|\}|\]|$)')
PARAMS = re.compile(r'function\s*[\w$]*\s*\(([^)]*)\)')


def limpar(linha, dentro_bloco):
    """Tira strings e comentarios, pra nao cacar nome dentro de texto."""
    out, i, n, aspa = [], 0, len(linha), ''
    while i < n:
        c = linha[i]
        if dentro_bloco:
            if c == '*' and i + 1 < n and linha[i + 1] == '/':
                dentro_bloco = False
                i += 2
                continue
            i += 1
            continue
        if aspa:
            if c == BARRA:
                i += 2
                continue
            if c == aspa:
                aspa = ''
            i += 1
            continue
        if c == '/' and i + 1 < n and linha[i + 1] == '*':
            dentro_bloco = True
            i += 2
            continue
        if c == '/' and i + 1 < n and linha[i + 1] == '/':
            break
        if c in ASPAS:
            aspa = c
            i += 1
            continue
        out.append(c)
        i += 1
    return ''.join(out), dentro_bloco


def main(padroes):
    caminhos = []
    for p in padroes:
        caminhos.extend(sorted(glob.glob(p)))
    if not caminhos:
        print('nenhum arquivo casou com: ' + ' '.join(padroes))
        return 1

    declarados = set()
    usos = {}

    for caminho in caminhos:
        nome_arq = os.path.basename(caminho)
        dentro = False
        em_decl = False          # dentro de uma declaracao que atravessa linhas
        with open(caminho, encoding='utf-8') as fh:
            for n, linha in enumerate(fh, 1):
                limpa, dentro = limpar(linha.rstrip(chr(10)), dentro)

                for d in DECL_1.finditer(limpa):
                    declarados.add(d.group(1))
                achou_decl = False
                for d in DECL_CAUDA.finditer(limpa):
                    achou_decl = True
                    for a in DECL_NOMES.finditer(d.group(1)):
                        declarados.add(a.group(1))
                if em_decl and not achou_decl:
                    for a in DECL_NOMES.finditer(limpa.lstrip()):
                        declarados.add(a.group(1))
                if achou_decl or em_decl:
                    em_decl = (';' not in limpa)
                for d in PARAMS.finditer(limpa):
                    for arg in d.group(1).split(','):
                        arg = arg.strip()
                        if arg:
                            declarados.add(arg)

                for u in NOSSO.finditer(limpa):
                    ident = u.group(1)
                    if ident in BUILTINS:
                        continue
                    if u.start() > 0 and limpa[u.start() - 1] == '.':
                        continue
                    resto = limpa[u.end():].lstrip()
                    if resto[:1] == ':':
                        continue
                    usos.setdefault(ident, '%s:%d' % (nome_arq, n))

    soltos = sorted(k for k in usos if k not in declarados)
    print('%d arquivo(s), %d nome(s) do projeto usados, SOLTOS: %d'
          % (len(caminhos), len(usos), len(soltos)))
    for k in soltos:
        print('  %-34s usado em %s, nunca declarado' % (k, usos[k]))
    return 1 if soltos else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:] or ['apps-script/*.gs']))
