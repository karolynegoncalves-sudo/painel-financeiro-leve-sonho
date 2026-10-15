# -*- coding: utf-8 -*-
"""Confere se todo handler do menu aponta pra uma funcao que existe.
Uso:  python tools/menu_handlers.py

Isto precisa existir porque o nome do handler no addItem e uma STRING: o
nomes_soltos.py nao ve dentro de string, entao um handler digitado errado
passa nos tres validadores e so quebra quando ela clica no item.
"""
import io
import re
import glob
import os

BASE = r'C:\Claude\painel-financeiro-leve-sonho\apps-script'
SRC = os.path.join(BASE, 'Code.gs')

s = io.open(SRC, encoding='utf-8').read()
ini = s.index('function onOpen')
fim = s.index('.addToUi()', ini)
bloco = s[ini:fim]

ITEM = re.compile(r"\.addItem\(\s*'([^']*)'\s*,\s*'([A-Za-z_$][\w$]*)'")
pares = ITEM.findall(bloco)

decl = set()
for caminho in glob.glob(os.path.join(BASE, '*.gs')):
    txt = io.open(caminho, encoding='utf-8').read()
    decl |= set(re.findall(r'^function\s+([A-Za-z_$][\w$]*)', txt, re.M))

faltam = [(l, f) for l, f in pares if f not in decl]

print('itens no menu ........: %d' % len(pares))
print('funcoes declaradas ...: %d' % len(decl))
print('HANDLERS SEM FUNCAO ..: %d' % len(faltam))
for l, f in faltam:
    print('   %-52s -> %s' % (l[:50], f))

raise SystemExit(1 if faltam else 0)
