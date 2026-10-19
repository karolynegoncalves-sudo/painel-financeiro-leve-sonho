# -*- coding: utf-8 -*-
"""Consolida por mes os CSV de taxa medidos na Shopee e no Mercado Livre.
Uso:  python tools/consolidar_taxas.py <shopee_detalhe.csv> <ml_detalhe.csv>

POR QUE EM PYTHON E NAO NO PROPRIO .ps1. O PowerShell tem uma assimetria que
corrompe numero em silencio:

    ToString()      e SENSIVEL a cultura  -> escreve "13,49" em pt-BR
    [double]"13,49" e INVARIANTE          -> le a virgula como MILHAR -> 1349

Ou seja: o mesmo script escreve e le o mesmo arquivo e NAO volta o mesmo
numero. Medido em 19/10/2026: a consolidacao do ML deu R$ 347.942 de comissao
em dezembro/2025 para R$ 19.288 de venda real - inflado ~38x, porque valor
com uma casa decimal vira x10 e com duas vira x100, misturados.

A ironia: eu tinha isso anotado na memoria ("ler os CSV em Python, o
PowerShell erra a virgula decimal") e escrevi a consolidacao em PowerShell
assim mesmo. Anotar nao protege; o que protege e a ferramenta nao estar la.

O DETALHE MEDIDO ESTA CERTO - so a soma estava errada. Por isso isto
reconsolida em vez de remedir: sao ~6.000 chamadas de API que nao precisam
ser repetidas.
"""
import csv
import io
import sys
import collections


def num(t):
    """Decimal brasileiro ou americano, decidindo pela ULTIMA pontuacao.

    Os dois aparecem nestes arquivos porque quem escreveu foi o PowerShell
    sob culturas diferentes. Trocar um pelo outro muda o valor por 100."""
    s = str(t or '').strip().replace('R$', '').replace(' ', '')
    if not s:
        return 0.0
    uv, up = s.rfind(','), s.rfind('.')
    if uv > up:
        s = s.replace('.', '').replace(',', '.')
    else:
        s = s.replace(',', '')
    try:
        return float(s)
    except ValueError:
        return 0.0


def ler(caminho):
    with io.open(caminho, encoding='utf-8-sig', newline='') as fh:
        return list(csv.DictReader(fh, delimiter=';'))


def shopee(caminho):
    """taxa de PLATAFORMA, frete da loja e ads, separados de proposito."""
    por = collections.defaultdict(lambda: {'n': 0, 'taxa': 0.0, 'frete': 0.0,
                                           'ads': 0.0, 'bruto': 0.0})
    for r in ler(caminho):
        m = r.get('mes', '')
        o = por[m]
        o['n'] += 1
        o['taxa'] += (num(r.get('commission')) + num(r.get('service_fee'))
                      + num(r.get('transaction_fee')) + num(r.get('proc_por_pedido'))
                      + num(r.get('campanha')))
        o['frete'] += (num(r.get('frete_real')) - num(r.get('frete_comprador'))
                       - num(r.get('subsidio_frete')))
        o['ads'] += num(r.get('ads'))
        o['bruto'] += num(r.get('buyer_total'))
    return por


def ml(caminho):
    """So pedido PAGO: cancelado nao gera taxa, e isto vira conta a pagar."""
    por = collections.defaultdict(lambda: {'n': 0, 'taxa': 0.0, 'frete': 0.0,
                                           'ads': 0.0, 'bruto': 0.0})
    for r in ler(caminho):
        if (r.get('status') or '').strip() != 'paid':
            continue
        m = r.get('mes', '')
        o = por[m]
        o['n'] += 1
        o['taxa'] += num(r.get('comissao'))
        o['frete'] += num(r.get('frete_vendedor'))
        o['bruto'] += num(r.get('total'))
    return por


def mostrar(nome, por):
    print('')
    print('=== %s ===' % nome)
    print('%-9s %7s %12s %11s %10s %13s %7s' %
          ('mes', 'pedidos', 'taxa', 'frete', 'ads', 'bruto', 'taxa%'))
    tn = tt = tf = ta = tb = 0
    for m in sorted(por):
        o = por[m]
        pct = (o['taxa'] / o['bruto'] * 100) if o['bruto'] else 0
        print('%-9s %7d %12.2f %11.2f %10.2f %13.2f %6.1f%%' %
              (m, o['n'], o['taxa'], o['frete'], o['ads'], o['bruto'], pct))
        tn += o['n']; tt += o['taxa']; tf += o['frete']
        ta += o['ads']; tb += o['bruto']
    pct = (tt / tb * 100) if tb else 0
    print('%-9s %7d %12.2f %11.2f %10.2f %13.2f %6.1f%%' %
          ('TOTAL', tn, tt, tf, ta, tb, pct))
    return por


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    sh = mostrar('SHOPEE', shopee(sys.argv[1])) if len(sys.argv) > 1 else {}
    mm = mostrar('MERCADO LIVRE', ml(sys.argv[2])) if len(sys.argv) > 2 else {}

    print('')
    print('=== O QUE LANCAR (taxa + frete, por mes e por canal) ===')
    print('%-9s %14s %14s %14s' % ('mes', 'Shopee', 'Mercado Livre', 'soma'))
    meses = sorted(set(list(sh.keys()) + list(mm.keys())))
    gt = 0
    for m in meses:
        a = sh.get(m, {}).get('taxa', 0) + sh.get(m, {}).get('frete', 0)
        b = mm.get(m, {}).get('taxa', 0) + mm.get(m, {}).get('frete', 0)
        gt += a + b
        print('%-9s %14.2f %14.2f %14.2f' % (m, a, b, a + b))
    print('%-9s %44.2f' % ('TOTAL', gt))
    print('')
    print('ADS FICAM DE FORA do que lancar: nao sao taxa de canal, sao')
    print('despesa de marketing e tem categoria propria.')
