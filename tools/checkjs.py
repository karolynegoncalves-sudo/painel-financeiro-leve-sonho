# Checagem de JS sem node: tira comentarios e strings, confere ( { [ e o
# fechamento de cada string, e confere a PONTUACAO entre itens de objeto.
# Nao substitui um parser, mas pega os dois erros que ja custaram caro aqui:
#
#   1. chave ou parentese orfao deixado ao remover um bloco - foi o que quebrou
#      o app.js e o que fez o Apps Script se recusar a salvar o projeto.
#   2. VIRGULA DOBRADA. Em 14/09/2026 eu inseri uma entrada com virgula na
#      frente num objeto cuja linha anterior JA terminava com virgula. O
#      balanceamento passou ("ok") e o Apps Script recusou com
#      "SyntaxError: Unexpected token ','". O checador dizia ok e estava errado,
#      que e pior do que nao ter checador. Por isso a checagem 2 existe.
import sys
BS = chr(92)
s = open(sys.argv[1], encoding='utf-8').read()
i, n = 0, len(s)
pilha, lin = [], 1
pares = {')': '(', '}': '{', ']': '['}
ultimo = None          # ultima pontuacao significativa vista: (char, linha)
erros = []
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
            ultimo = ('x', lin)
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
        ultimo = ('x', lin)
        i = j + 1; continue
    if c in ',{}()[];':
        dentro = pilha[-1][0] if pilha else None
        # ,, num objeto ou numa lista de argumentos e SyntaxError. Em array
    if c in ',{}()[];':
        dentro = pilha[-1][0] if pilha else None
        # ,, num objeto ou numa lista de argumentos e SyntaxError. Em array
        # literal ([1,,2]) e buraco valido - ali nao reclamo.
        if c == ',':
            if ultimo and ultimo[0] == ',' and dentro in ('{', '('):
                erros.append('virgula dobrada, linha %d (a de antes na linha %d)'
                             % (lin, ultimo[1]))
            elif ultimo and ultimo[0] in '{(':
                erros.append('virgula logo depois de "%s", linha %d' % (ultimo[0], lin))
        if c in ')}]' and ultimo and ultimo[0] == ',' and dentro == '(':
            erros.append('virgula sobrando antes de "%s", linha %d' % (c, lin))
        ultimo = (c, lin)
        if c in '({[':
            pilha.append((c, lin))
        elif c in ')}]':
            if not pilha: print('fecha "%s" sem abrir, linha %d' % (c, lin)); sys.exit(1)
            a, al = pilha.pop()
            if a != pares[c]:
                print('fecha "%s" na linha %d mas o aberto era "%s" da linha %d'
                      % (c, lin, a, al)); sys.exit(1)
    elif c not in ' ' + chr(9):
        # QUALQUER outro caractere e token: sem isto, o "a" de foo(a, b) nao
        # conta e a virgula parece colada no parentese. Foi o bug do patch de
        # 14/09/2026, que gerou 200 falsos positivos.
        ultimo = ('x', lin)
    i += 1
if pilha:
    a, al = pilha[-1]
    print('"%s" da linha %d nunca fecha' % (a, al)); sys.exit(1)
if erros:
    for e in erros:
        print(e)
    sys.exit(1)
print('balanceamento e pontuacao ok')
