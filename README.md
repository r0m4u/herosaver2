# Herosaver 2

Exporta o personagem aberto no editor do [Hero Forge](https://www.heroforge.com) como
**OBJ com cores e texturas** ou **STL**, com a mesma pose, proporções e pintura da tela.
Funciona por um favorito (bookmarklet) no Chrome, Edge ou Brave.

A página de instalação (`index.html`) fica no GitHub Pages. Nos outros computadores,
basta abrir essa página e arrastar o botão para a barra de favoritos, ou nem isso, se
você usa a sincronização da conta do navegador.

## Publicar no seu GitHub (uma vez)

1. Crie um repositório **público** no GitHub, por exemplo `herosaver2`. O GitHub Pages
   gratuito exige repositório público.
2. Envie os arquivos desta pasta, de um destes jeitos:
   - **Pelo site:** no repositório novo, *Add file → Upload files* e arraste tudo desta
     pasta (inclusive `src/` e o arquivo `.nojekyll`).
   - **Pelo git:**
     ```
     git add -A
     git commit -m "Herosaver 2"
     git remote add origin https://github.com/SEU_USUARIO/herosaver2.git
     git push -u origin main
     ```
3. No repositório: *Settings → Pages → Build and deployment → Source: Deploy from a branch*,
   escolha `main` e `/ (root)` e clique em *Save*. Em 1 ou 2 minutos a página fica em
   `https://SEU_USUARIO.github.io/herosaver2/`.

## Instalar em cada computador

1. Abra `https://SEU_USUARIO.github.io/herosaver2/` no Chrome, Edge ou Brave.
2. Mostre a barra de favoritos (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>) e arraste o botão **⬇ Herosaver** para ela.
3. No heroforge.com, espere o personagem carregar e clique no favorito. Um painel abre no
   canto: escolha **OBJ + texturas** ou **STL** e as opções, depois clique em **Exportar**.

O favorito é só um carregador pequeno: a cada clique ele baixa o `herosaver.js` mais
recente do seu GitHub Pages. Com a sincronização do navegador ligada, ele aparece sozinho
nos outros computadores, e toda atualização que você publicar chega a todos.

Na primeira vez que você exportar duas vezes seguidas, o Chrome pode perguntar se o site
pode **baixar vários arquivos**. Clique em *Permitir*; ele lembra a escolha.

**Sem internet / sem GitHub:** a página também oferece o botão **Herosaver (offline)**,
com o script inteiro dentro do favorito. O mesmo conteúdo está em `bookmarklet.txt`, para
colar como URL de um favorito. Ele não se atualiza sozinho.

## O que sai

- **OBJ** num `.zip`:
  - `Nome.obj`: normais suaves, UVs e cor por vértice (`v x y z r g b`), útil em fatiadores
    de impressão colorida;
  - `Nome.mtl`: materiais PBR (`map_Kd`, `map_Pr`, `map_Pm`, `map_Bump`/`norm`, `map_Ke`, `map_d`);
  - `textures/*.png`: cor com decalques, rugosidade, metal, normal map e emissão.
- **STL** binário.
- Escala em milímetros (a base padrão mede 25 mm). Também há centímetros (1 unidade do
  Hero Forge = 1 cm) e polegadas. OBJ com Y para cima e o personagem de frente para +Z;
  a opção "Z para cima" é ligada automaticamente para STL.
- No Blender: *File → Import → Wavefront (.obj)*, nas configurações padrão. Os materiais
  já vêm com Base Color, Metallic, Roughness e Normal ligados.

## Usar pelo console (sem favorito)

F12 → Console → cole o conteúdo de `herosaver.js` → Enter. Depois:

```js
Herosaver.open()                 // painel
saveObj()                        // zip com OBJ + MTL + texturas
saveObj({ base: false, textures: false, scale: 1 })
saveStl()                        // STL (mm, Z para cima)
saveJson()                       // configuração do personagem
```

Opções: `scale` (10 = mm), `base`, `noPrint`, `textures`, `vertexColors`, `normals`, `zUp`.

## Atualizar o código

1. Edite `herosaver.js` (o modelo da página fica em `src/index.template.html`).
2. Rode `python3 build.py`. Ele regenera `index.html` e `bookmarklet.txt`.
3. Envie para o GitHub. Os favoritos carregadores passam a usar a versão nova no próximo clique.

## Arquivos

| arquivo | o que é |
|---|---|
| `herosaver.js` | o exportador (é o que o favorito baixa) |
| `index.html` | página de instalação, gerada pelo `build.py` |
| `bookmarklet.txt` | favorito offline, gerado pelo `build.py` |
| `build.py` | gera os dois acima |
| `src/index.template.html` | modelo da página de instalação |
| `.nojekyll` | faz o GitHub Pages servir os arquivos como estão |

## Como funciona e limitações

O Hero Forge usa uma engine própria (fork do three.js). O script reproduz na CPU o shader
de vértice do site: ossos lidos da mesma textura da GPU, os mesmos morphs e normais. Ele
lê da GPU os atlas de cor/física/emissão e os normal maps. Ficam de fora as peças marcadas
como não imprimíveis (há uma opção para incluí-las) e as malhas que a câmera não desenha.

- Translucidez, sheen e a oclusão pré-calculada do site não têm equivalente no `.mtl`.
- `map_Bump` com normal map é a convenção do Blender; alguns programas antigos leem
  `map_Bump` como mapa de altura.
- Se o Hero Forge mudar a engine de novo, os nomes internos (`CK.display`, `colorAtlasMap`
  etc.) podem mudar.

Ideia original: [notnullgames/Herosaver](https://github.com/notnullgames/Herosaver), que
parou de funcionar com o site atual (gera um `.obj` vazio). O Hero Forge vende o download
oficial dos modelos; use para uso pessoal.
