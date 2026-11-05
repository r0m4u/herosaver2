# Herosaver 2

Exporta o personagem aberto no editor do [Hero Forge](https://www.heroforge.com) como
**GLB** (com ou sem esqueleto e animação), **OBJ com texturas** ou **STL**, com a mesma pose,
proporções, pintura e sombreado da tela. Funciona por um favorito (bookmarklet) no Chrome, Edge ou Brave.

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
   canto: escolha **OBJ**, **GLB**, **GLB+rig** ou **STL** e as opções, depois clique em **Exportar**.
   Se o favorito antigo já foi usado nesta aba, recarregue a página para pegar a versão nova.

O favorito é só um carregador pequeno: a cada clique ele baixa o `herosaver.js` mais
recente do seu GitHub Pages. Com a sincronização do navegador ligada, ele aparece sozinho
nos outros computadores, e toda atualização que você publicar chega a todos.

Na primeira vez que você exportar duas vezes seguidas, o Chrome pode perguntar se o site
pode **baixar vários arquivos**. Clique em *Permitir*; ele lembra a escolha.

**Sem internet / sem GitHub:** a página também oferece o botão **Herosaver (offline)**,
com o script inteiro dentro do favorito. O mesmo conteúdo está em `bookmarklet.txt`, para
colar como URL de um favorito. Ele não se atualiza sozinho.

## O que sai

- **GLB** (glTF binário), um arquivo só:
  - materiais PBR completos: cor, oclusão + rugosidade + metal numa textura ORM, normal map,
    emissão e transparência; os olhos saem com esclera, íris, pupila e córnea brilhante
    (`KHR_materials_clearcoat`);
  - tamanho real da miniatura, em metros (≈ 3,7 cm de altura), Y para cima, de frente para +Z;
  - **GLB+rig**: esqueleto simplificado de 24 ossos e a animação "Idle" (4 s em loop).
- **OBJ** num `.zip`:
  - `Nome.obj`: normais suaves, UVs e cor por vértice (`v x y z r g b`), útil em fatiadores
    de impressão colorida;
  - `Nome.mtl`: materiais PBR (`map_Kd`, `map_Pr`, `map_Pm`, `map_Bump`/`norm`, `map_Ke`, `map_d`);
  - `textures/*.png`: cor, rugosidade, metal, normal map, emissão e `*_ao.png` (oclusão, linear).
  - Escala em milímetros (a base padrão mede 25 mm). Também há centímetros (1 unidade do
    Hero Forge = 1 cm) e polegadas.
- **STL** binário; a opção "Z para cima" é ligada automaticamente.
- **Luz do editor (.hdr)**, num botão à parte: o mapa de ambiente do editor mais o sol, em HDR.

### Para ficar igual ao editor

- **Qualidade máxima** (padrão): durante o export o Herosaver liga o modo UHD do editor
  (texturas com o dobro da resolução, até 1024 px por peça), busca os normal maps nesse
  tamanho e recalcula a oclusão em 4096 px (o editor usa 512). No fim, o editor volta ao
  normal sozinho. Leva uns 20 s a mais e o arquivo fica cerca de 2 vezes maior.
- **Oclusão na cor** (padrão): o editor escurece dobras e cantos com uma oclusão calculada no
  navegador e outra que vem pronta em cada peça. As duas vão multiplicadas na textura de cor,
  e no GLB também vão como mapa de oclusão. No Godot, se preferir só o mapa, desligue a opção.
- **Sombra do sol na cor** (desligada): a sombra pré-calculada do sol do editor. Só faz sentido
  se a sua cena não tiver luz que faça sombra.
- **Blender**: importe o **GLB** (*File → Import → glTF 2.0*). Em *Render Properties → Color
  Management*, use *View Transform: Standard* (o padrão *AgX* desbota as cores). Para a luz do
  editor, no *World* ligue uma *Environment Texture* com o `.hdr` (sem girar).
  - Com o OBJ, o importador do Blender abre todas as texturas como cor: nas texturas
    `_roughness`, `_metallic` e `_normal`, mude *Color Space* para *Non-Color*.
- **Godot 4**: arraste o GLB para o projeto; os materiais vêm com oclusão, rugosidade, metal e
  normal map. Para a luz do editor, use o `.hdr` num *PanoramaSkyMaterial* e ponha
  *Environment → Sky → Rotation Y* em **90°**. O Godot não importa o verniz dos olhos.

## Usar pelo console (sem favorito)

F12 → Console → cole o conteúdo de `herosaver.js` → Enter. Depois:

```js
Herosaver.open()                 // painel
saveObj()                        // zip com OBJ + MTL + texturas
saveObj({ base: false, textures: false, scale: 1 })
saveStl()                        // STL (mm, Z para cima)
saveJson()                       // configuração do personagem
```

```js
saveGlb()                        // GLB estático, qualidade máxima
saveGlb({ rig: true })           // GLB com esqueleto + animação idle
saveGlb({ maxQuality: false, aoInColor: false })
saveHdr()                        // luz do editor (.hdr)
```

Opções: `scale` (10 = mm; no GLB, 0.01 = metros), `base`, `noPrint`, `maxQuality`, `aoInColor`,
`sunInColor`, `textures`, `vertexColors`, `normals`, `zUp`, `rig`.

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
lê da GPU os atlas de cor/física/emissão/oclusão e os normal maps e refaz a conta do shader
de pintura do site para gerar texturas PBR comuns (inclusive a cor procedural dos olhos).
Ficam de fora as peças marcadas como não imprimíveis (há uma opção para incluí-las) e as
malhas que a câmera não desenha.

- A malha é a mesma que o editor mostra. A versão de alta resolução usada na impressão é o
  produto que o Hero Forge vende, e o Herosaver não a busca.
- O "sheen" do site (um reflexo fraco nas bordas) não é exportado: o sheen do glTF e do
  Blender é bem mais largo e deixava os tecidos escuros acinzentados.
- A profundidade da íris (efeito de paralaxe do shader do olho) não tem equivalente em PBR.
- A translucidez (pedras, gelo etc.) vira transparência parcial; a refração não é exportada.
- O normal map do rosto fica na resolução do editor (ele é montado na GPU a partir das
  expressões).
- No Blender o modelo sai um pouco mais claro que no editor nas áreas escuras: o editor
  reduz o reflexo do ambiente onde há oclusão, e o Cycles/Eevee não.
- `map_Bump` com normal map é a convenção do Blender; alguns programas antigos leem
  `map_Bump` como mapa de altura.
- Se o Hero Forge mudar a engine de novo, os nomes internos (`CK.display`, `colorAtlasMap`
  etc.) podem mudar.

Ideia original: [notnullgames/Herosaver](https://github.com/notnullgames/Herosaver), que
parou de funcionar com o site atual (gera um `.obj` vazio). O Hero Forge vende o download
oficial dos modelos; use para uso pessoal.
