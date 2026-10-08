# -*- coding: utf-8 -*-
"""
Acha nome declarado DUAS VEZES no escopo global dos .gs.
Uso:  python tools/nomes_dup.py apps-script/*.gs

POR QUE EXISTE. Todos os .gs de um projeto Apps Script dividem UM escopo
global, e a ultima declaracao vence - sem erro, sem aviso, sem sublinhado no
editor. O codigo certo fica la, visivel, e nao roda.

Isso ja custou duas vezes:

  - funcao duplicada: comportamento velho com o codigo novo na tela, e horas
    procurando na implantacao em vez de no nome.
  - 07/10/2026, DAS_ESTIMADO_: eu declarei um segundo mapa 140 linhas acima
    de um que existia desde setembro. O meu nasceu morto, e setembro aparecia
    como "guia" no relatorio quando eu o tinha marcado como estimativa.

A checagem de funcao duplicada eu ja fazia. `var`/`const`/`let` nao - e foi
por ali que passou. Esta versao pega os tres, porque a armadilha e do ESCOPO,
nao da palavra-chave.

PAR COM O checkjs.py, que responde outra pergunta: ele olha a sintaxe de um
arquivo (balanceamento, string aberta, virgula dobrada) e nao enxerga o
projeto inteiro. Este olha o projeto e nao enxerga sintaxe. Rodar os dois.
"""
import re
import sys
import glob
import os
import collections

RE = re.compile(
    r'^(?:function\s+([A-Za-z_$][\w$]*)'
    r'|(?:var|const|let)\s+([A-Za-z_$][\w$]*)\s*=)'
)


def main(padroes):
    caminhos = []
    for p in padroes:
        caminhos.extend(sorted(glob.glob(p)))
    if not caminhos:
        print('nenhum arquivo casou com: ' + ' '.join(padroes))
        return 1

    onde = collections.defaultdict(list)
    for caminho in caminhos:
        nome = os.path.basename(caminho)
        with open(caminho, encoding='utf-8') as fh:
            for n, linha in enumerate(fh, 1):
                m = RE.match(linha)
                if m:
                    onde[m.group(1) or m.group(2)].append('%s:%d' % (nome, n))

    dup = dict((k, v) for k, v in onde.items() if len(v) > 1)
    print('%d arquivo(s), %d identificador(es) globais, DUPLICADOS: %d'
          % (len(caminhos), len(onde), len(dup)))
    for k in sorted(dup):
        print('  %-28s %s' % (k, '  |  '.join(dup[k])))
        print('  %-28s (vence o ultimo; os de cima nao rodam)' % '')
    return 1 if dup else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:] or ['apps-script/*.gs']))
