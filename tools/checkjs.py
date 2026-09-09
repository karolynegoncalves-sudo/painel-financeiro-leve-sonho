# Checagem de balanceamento de JS sem node: tira comentarios e strings e
# confere ( { [ e o fechamento de cada string. Nao substitui um parser, mas pega
# o erro que ja custou caro aqui: chave ou parentese orfao deixado ao remover um
# bloco - foi o que quebrou o app.js e o que fez o Apps Script se recusar a
# salvar o projeto inteiro.
import sys
BS = chr(92)
s = open(sys.argv[1], encoding='utf-8').read()
i, n = 0, len(s)
pilha, lin = [], 1
pares = {')': '(', '}': '{', ']': '['}
while i < n:
    c = s[i]
    if c == chr(10):
        lin += 1; i += 1; continue
    if c == '/' and i + 1 < n and s[i+1] == '/':
        while i < n and s[i] != chr(10): i += 1
        continue
    if c == '/' and i + 1 < n and s[i+1] == '*':
        j = s.find('*/', i + 2)
        if j < 0: print('comentario /* nao fechado, linha', lin); sys.exit(1)
        lin += s.count(chr(10), i, j); i = j + 2; continue
    # regex literal: /[&<>"']/g abre uma string no meio se a gente ler o / como
    # divisao. Decide pelo token anterior - depois de valor vem divisao, depois
    # de operador/abertura vem regex.
    if c == '/':
        k = i - 1
        while k >= 0 and s[k] in ' ' + chr(9) + chr(10): k -= 1
        ant = s[k] if k >= 0 else '('
        palavra = ''
        if ant.isalnum() or ant == '_':
            p = k
            while p >= 0 and (s[p].isalnum() or s[p] == '_'): p -= 1
            palavra = s[p+1:k+1]
        ehRegex = ant in '(,=:[!&|?{};+' or palavra in ('return', 'typeof', 'case')
        if ehRegex:
            j = i + 1
            emClasse = False
            ok = False
            while j < n:
                if s[j] == BS: j += 2; continue
                if s[j] == '[': emClasse = True
                elif s[j] == ']': emClasse = False
                elif s[j] == '/' and not emClasse: ok = True; break
                elif s[j] == chr(10): break
                j += 1
            if not ok: print('regex nao fechada, linha', lin); sys.exit(1)
            i = j + 1; continue
    if c in '"' + chr(39) + chr(96):
        q, j = c, i + 1
        ok = False
        while j < n:
            if s[j] == BS: j += 2; continue
            if s[j] == q: ok = True; break
            if s[j] == chr(10):
                if q != chr(96): break
                lin += 1
            j += 1
        if not ok: print('string nao fechada, linha', lin); sys.exit(1)
        i = j + 1; continue
    if c in '({[':
        pilha.append((c, lin))
    elif c in ')}]':
        if not pilha: print('fecha "%s" sem abrir, linha %d' % (c, lin)); sys.exit(1)
        a, al = pilha.pop()
        if a != pares[c]:
            print('fecha "%s" na linha %d mas o aberto era "%s" da linha %d' % (c, lin, a, al)); sys.exit(1)
    i += 1
if pilha:
    a, al = pilha[-1]
    print('"%s" da linha %d nunca fecha' % (a, al)); sys.exit(1)
print('balanceamento ok')
