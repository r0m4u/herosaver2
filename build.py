#!/usr/bin/env python3
"""Gera os arquivos publicados a partir de herosaver.js:

  bookmarklet.txt  favorito "offline" (o script inteiro embutido)
  index.html       página de instalação (GitHub Pages) com os botões para arrastar

uso: python3 build.py     (rode de novo sempre que editar herosaver.js)
"""
import json
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p), encoding='utf-8') as f:
        return f.read()


def write(name, text):
    with open(os.path.join(HERE, name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


src = read('herosaver.js')
version = re.search(r"const VERSION = '([^']+)'", src).group(1)

# compacta sem mudar o significado: tira o comentário do topo, linhas que são só comentário e a indentação
# (o código não tem template strings com quebra de linha significativa nem "//" no começo de linha dentro de strings)
body = re.sub(r'^/\*!.*?\*/\s*', '', src, flags=re.S)
lines = [s for s in (l.strip() for l in body.split('\n')) if s and not s.startswith('//')]
code = '\n'.join(lines) + '\nvoid Herosaver.open();'
inline = 'javascript:' + urllib.parse.quote(code, safe="()*!'~;,/?:@&=+$-_.")
write('bookmarklet.txt', inline + '\n')

page = read('src', 'index.template.html')
page = (page.replace('{{VERSION}}', version)
            .replace('{{INLINE_KB}}', str(round(len(inline) / 1024)))
            .replace('{{INLINE_JSON}}', json.dumps(inline).replace('</', '<\\/')))
write('index.html', page)

print(f'Herosaver {version}: bookmarklet.txt ({len(inline)} caracteres), index.html')
