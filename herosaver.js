/*!
 * Herosaver 2 — exporta o personagem atual do Hero Forge como OBJ (com MTL, texturas PBR
 * e cores por vértice, tudo num .zip), GLB (glTF, com ou sem rig) ou STL.
 *
 * Funciona com o editor atual do Hero Forge (engine própria "RenderKit/CreationKit").
 * Ideia original: notnullgames/Herosaver (MIT). Esta versão foi reescrita do zero porque
 * o site mudou: o OBJExporter do three.js não reconhece mais a geometria do site
 * (saía um .obj vazio) e o skinning antigo não existe mais.
 *
 * Uso (no console ou via bookmarklet), com a página do Hero Forge aberta:
 *   Herosaver.open()          -> painel com as opções (é o que o bookmarklet faz)
 *   saveObj()                 -> <Nome>.zip com .obj + .mtl + texturas
 *   saveGlb()                 -> <Nome>.glb (metros, tamanho real); saveGlb({ rig: true }) com esqueleto + idle
 *   saveStl()                 -> <Nome>.stl (binário, Z para cima, milímetros)
 *   saveHdr()                 -> <Nome>_luz_editor.hdr (luz do editor, para Blender/Godot)
 *   saveJson()                -> configuração do personagem (.json)
 *
 * Opções (saveObj / saveGlb / saveStl):
 *   scale         fator de escala (padrão 10 -> milímetros; 1 unidade do Hero Forge = 1 cm; GLB: 0,01 = metros)
 *   base          incluir a base/peanha (padrão true)
 *   noPrint       incluir peças que o Hero Forge marca como "não imprimíveis" (padrão false)
 *   maxQuality    texturas UHD e oclusão 4K durante o export (padrão true)
 *   aoInColor     multiplicar a oclusão do editor na textura de cor (padrão true)
 *   sunInColor    multiplicar também a sombra do sol pré-calculada (padrão false)
 *   textures      (OBJ) exportar texturas de cor/rugosidade/metal/normal/emissão (padrão true)
 *   vertexColors  (OBJ) gravar a cor em cada vértice "v x y z r g b" (padrão true)
 *   normals       (OBJ) gravar normais suaves "vn" (padrão true)
 *   zUp           girar para Z para cima (padrão: false no OBJ, true no STL)
 *   rig           (GLB) esqueleto simplificado de 24 articulações + animação "Idle" em loop
 */
(() => {
  'use strict';

  const VERSION = '2.1.0';
  const TAG = '[Herosaver]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // ------------------------------------------------------------------ status na tela
  let toastEl = null;
  let panelStatus = null; // (msg, sticky) -> bool; definido quando o painel está aberto
  function toast(msg, sticky) {
    if (panelStatus && panelStatus(msg, sticky)) return;
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);' +
          'background:#1d1d1d;color:#fff;font:14px/1.3 sans-serif;padding:10px 16px;border-radius:6px;' +
          'box-shadow:0 2px 10px rgba(0,0,0,.5);pointer-events:none;max-width:80vw;text-align:center';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = 'Herosaver: ' + msg;
      toastEl.style.display = 'block';
      clearTimeout(toastEl._t);
      if (!sticky) toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, 4000);
    } catch (e) { /* sem DOM */ }
  }
  const nextFrame = () => new Promise(r => setTimeout(r, 0));

  // ------------------------------------------------------------------ matemática (coluna-major, igual ao three.js)
  const M4 = {
    mul(a, b) {
      const o = new Float64Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    inv(m) {
      const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
      const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
      const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
      const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
      const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
      const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
      if (!det) return M4.ident();
      const d = 1 / det, o = new Float64Array(16);
      o[0] = t11 * d;
      o[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
      o[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
      o[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
      o[4] = t12 * d;
      o[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
      o[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
      o[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
      o[8] = t13 * d;
      o[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
      o[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
      o[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
      o[12] = t14 * d;
      o[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
      o[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
      o[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
      return o;
    },
    ident: () => Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
    scale: (x, y, z) => Float64Array.of(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1),
    rotX(t) { const c = Math.cos(t), s = Math.sin(t); return Float64Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1); },
    // 3x3 superior (coluna-major)
    upper3: m => Float64Array.of(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]),
    // matriz de normais = inversa-transposta do 3x3 superior (cofatores / det)
    normal3(m) {
      const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
      const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
      const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
      const det = a * A + d * D + g * G || 1;
      // inversa = adj/det, adj = transposta dos cofatores; inversa-transposta = cofatores/det
      return Float64Array.of(A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det);
    },
    mul3(a, b) {
      const o = new Float64Array(9);
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
      return o;
    },
  };

  // ------------------------------------------------------------------ acesso ao editor
  function editor() {
    const CK = window.CK;
    if (!CK || !CK.display || !CK.display.meshes) {
      throw new Error('editor do Hero Forge não encontrado. Abra heroforge.com e espere o personagem carregar.');
    }
    return CK;
  }

  function characterName() {
    const CK = window.CK;
    let n = '';
    try { n = (CK.data && CK.data.meta && CK.data.meta.character_name) || (CK.data && CK.data.name) || ''; } catch (e) { /* */ }
    n = String(n).trim().replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_');
    return n || 'Hero';
  }

  function glOf(CK) {
    const r = CK.renderManager && CK.renderManager.renderer;
    if (!r) return { renderer: null, gl: null };
    return { renderer: r, gl: r.getContext ? r.getContext() : r.context };
  }

  const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const rootOf = o => { while (o.parent) o = o.parent; return o; };

  // Todas as "displays" (personagem principal, montarias, pets...) que estão na cena.
  function collectDisplays(CK) {
    const out = [], seen = new Set();
    const add = d => {
      if (!d || seen.has(d) || !d.meshes) return;
      seen.add(d); out.push(d);
      for (const k in (d.displayChildren || {})) add(d.displayChildren[k]);
    };
    add(CK.display);
    for (const k in (CK.allDisplays || {})) add(CK.allDisplays[k]);
    const sceneRoot = rootOf(CK.display);
    return out.filter(d => rootOf(d) === sceneRoot);
  }

  // Malhas que o Hero Forge realmente desenha na vista 3D. Mesma regra do three.js: visível e com
  // alguma "layer" em comum com a câmera principal. Isso exclui as "aoSeamFins" (layer 0), cópias
  // de pedaços das peças usadas só no bake de oclusão — se entrarem, viram superfícies duplicadas.
  function collectMeshes(CK, opts) {
    const cam = CK.renderManager && CK.renderManager.camera;
    const camMask = cam && cam.layers ? cam.layers.mask : 1;
    const drawn = o => !o.layers || (o.layers.mask & camMask) !== 0;
    const displays = collectDisplays(CK);
    const parts = [];
    for (const d of displays) {
      const all = d.getFlattenedMeshes ? d.getFlattenedMeshes() : d.meshes;
      const printable = (!opts.noPrint && d.getForgeMeshes) ? d.getForgeMeshes() : all;
      for (const key of Object.keys(all)) {
        const m = all[key];
        if (!m || !printable[key]) continue;
        parts.push({ key, mesh: m });
      }
    }
    const partSet = new Set(parts.map(p => p.mesh));
    const list = [], seen = new Set();
    const walk = (o, key) => {
      if (!o.visible) return;
      if (o.isMesh && drawn(o) && !o.aoSeamFin && !seen.has(o) && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        seen.add(o);
        list.push({ key, mesh: o, fin: !partSet.has(o) });
      }
      for (const c of o.children || []) if (!partSet.has(c)) walk(c, key);
    };
    for (const p of parts.sort((a, b) => a.key < b.key ? -1 : 1)) {
      if (!opts.base && /^(base|baseRim)$/.test(p.key)) continue;
      if (visibleChain(p.mesh)) walk(p.mesh, p.key);
    }
    return list;
  }

  // ------------------------------------------------------------------ leitura de atributos
  function dense(attr, comps) {
    if (!attr) return null;
    const n = attr.count, out = new Float32Array(n * comps);
    const inter = attr.isInterleavedBufferAttribute;
    const src = inter ? attr.data.array : attr.array;
    const stride = inter ? attr.data.stride : attr.itemSize;
    const off = inter ? attr.offset : 0;
    const k = Math.min(comps, attr.itemSize);
    let norm = 1;
    if (attr.normalized) {
      if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) norm = 1 / 255;
      else if (src instanceof Int8Array) norm = 1 / 127;
      else if (src instanceof Uint16Array) norm = 1 / 65535;
      else if (src instanceof Int16Array) norm = 1 / 32767;
    }
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * comps + c] = src[i * stride + off + c] * norm;
    return out;
  }

  // O que o shader de vértice desta malha faz de fato (lido do programa GLSL compilado pelo site).
  function shaderInfo(mesh, mat, gl) {
    const opt = mat.options || {};
    let vs = null;
    try { if (gl && mat.program && mat.program.vertexShader) vs = gl.getShaderSource(mat.program.vertexShader); } catch (e) { /* */ }
    const info = { flipNormal: mat.uniforms && mat.uniforms.flipNormal ? +mat.uniforms.flipNormal.value : 0 };
    if (vs) {
      const mm = vs.match(/uniform\s+float\s+morphTargetInfluences\s*\[\s*(\d+)\s*\]/);
      info.morphSlots = mm ? +mm[1] : 0;
      info.packed = /\bmorphPacked0\b/.test(vs);
      info.morphNormals = /attribute\s+vec3\s+morphNormal0\b/.test(vs);
      info.skinSlots = (vs.match(/getBoneMatrix\s*\(\s*skin\d\.[xz]\s*\)/g) || []).length;
      info.skinned = info.skinSlots > 0 && /\bbindMatrix\b/.test(vs);
    } else {
      info.morphSlots = mat.morphTargets ? 7 : 0;
      info.packed = !!opt.morphPacked;
      info.morphNormals = !!mat.morphNormals;
      info.skinned = !!(mat.skinning && mesh.isSkinnedMesh && mesh.skeleton);
      info.skinSlots = info.skinned ? (opt.skinInfluenceCount || 4) : 0;
    }
    if (info.skinned && !(mesh.skeleton && mesh.bindMatrix)) info.skinned = false;
    return info;
  }

  // Mesma escolha de morphs do renderer do site: ordena por |peso| (estável) e usa os N primeiros.
  function activeMorphs(mesh, g, info) {
    const inf = mesh.morphTargetInfluences;
    if (!inf || !info.morphSlots) return [];
    const ma = g.morphAttributes || {};
    const src = info.packed ? ma.posNorm : ma.position;
    if (!src) return [];
    const order = [];
    for (let i = 0; i < inf.length; i++) order.push([i, inf[i]]);
    order.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const out = [];
    for (let l = 0; l < Math.min(8, info.morphSlots, order.length); l++) {
      const [idx, w] = order[l];
      if (!w || !src[idx]) continue;
      out.push({
        w,
        d: dense(src[idx], info.packed ? 4 : 3),
        n: (!info.packed && info.morphNormals && ma.normal && ma.normal[idx]) ? dense(ma.normal[idx], 3) : null,
      });
    }
    return out;
  }

  const SENTINEL = 1000;
  const gmod = (x, y) => x - y * Math.floor(x / y);
  const tri = w => Math.abs(gmod(w + 1, 2) - 1); // decodificação do peso de osso usada no shader
  function normalFromFloat(v, out) { // NormalFromFloat() do shader (normal compactada no .w do morph)
    const s = Math.sign(v); v = Math.abs(v);
    const range = (3 - s) / 2;
    out[2] = (gmod(Math.floor(v), 256) / 255 - 0.5) * 2 * range;
    out[1] = (gmod(Math.floor(v / 256), 256) / 255 - 0.5) * 2 * range;
    out[0] = (gmod(Math.floor(v / 65536), 256) / 255 - 0.5) * 2 * range;
    return out;
  }

  // Matrizes de osso exatamente como vão para a GPU (textura de ossos: 3 linhas x 4 por osso, a cada 16 floats).
  function boneData(skel) {
    if (skel.boneTexture && skel.boneTexture.image && skel.boneTexture.image.data) return skel.boneTexture.image.data;
    if (skel.boneMatrices && skel.boneMatrices.length >= skel.bones.length * 16 && skel.useVertexTexture !== false) return skel.boneMatrices;
    const out = new Float32Array(skel.bones.length * 16);
    skel.bones.forEach((b, i) => {
      if (!b) return;
      const e = M4.mul(b.matrixWorld.elements, skel.boneInverses[i].elements);
      out.set([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]], i * 16);
    });
    return out;
  }

  // ------------------------------------------------------------------ pose (réplica do shader de vértice na CPU)
  function poseMesh(entry, E, gl, wantRig) {
    const mesh = entry.mesh, g = mesh.geometry, A = g.attributes;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const info = shaderInfo(mesh, mats[0], gl);
    const n = A.position.count;
    const P = dense(A.position, 3);
    const N = A.normal ? dense(A.normal, 3) : null;
    const morphs = activeMorphs(mesh, g, info);
    const fs = info.flipNormal ? -1 : 1;
    const outP = new Float32Array(n * 3), outN = new Float32Array(n * 3), ok = new Uint8Array(n);
    const Mw = mesh.matrixWorld.elements;
    let A4, C3, Bm = null, bones = null, skins = null;
    if (info.skinned) {
      Bm = mesh.bindMatrix.elements;
      const Bmi = mesh.bindMatrixInverse.elements;
      A4 = M4.mul(E, M4.mul(Mw, Bmi));
      C3 = M4.mul3(M4.normal3(M4.mul(E, Mw)), M4.upper3(Bmi));
      bones = boneData(mesh.skeleton);
      skins = [];
      for (let s = 0; s < Math.ceil(info.skinSlots / 2); s++) skins.push(dense(A['skin' + s], 4));
      if (skins.some(x => !x)) info.skinned = false;
    }
    if (!info.skinned) { A4 = M4.mul(E, Mw); C3 = M4.normal3(A4); }
    const mn = [0, 0, 0], S = new Float64Array(12);
    const nb = bones ? bones.length : 0;
    const K = info.skinned ? info.skinSlots : 0;
    const skinRec = wantRig && K ? { k: K, idx: new Uint16Array(n * K), w: new Float32Array(n * K) } : null;
    for (let i = 0; i < n; i++) {
      let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      // O site esconde um cubo "sentinela" de ±3000 unidades em algumas peças (o personagem mede ~5): ignora.
      if (Math.abs(x) >= SENTINEL || Math.abs(y) >= SENTINEL || Math.abs(z) >= SENTINEL) continue;
      let nx = N ? N[i * 3] : 0, ny = N ? N[i * 3 + 1] : 1, nz = N ? N[i * 3 + 2] : 0;
      for (const m of morphs) {
        const w = m.w;
        if (info.packed) {
          x += m.d[i * 4] * w; y += m.d[i * 4 + 1] * w; z += m.d[i * 4 + 2] * w;
          normalFromFloat(m.d[i * 4 + 3], mn);
          nx += mn[0] * w; ny += mn[1] * w; nz += mn[2] * w; // (o shader aplica morphFlip, que cancela com o flip final)
        } else {
          x += m.d[i * 3] * w; y += m.d[i * 3 + 1] * w; z += m.d[i * 3 + 2] * w;
          if (m.n) { nx += fs * m.n[i * 3] * w; ny += fs * m.n[i * 3 + 1] * w; nz += fs * m.n[i * 3 + 2] * w; }
        }
      }
      if (info.skinned) {
        // skinVertex = bindMatrix * p
        const qx = Bm[0] * x + Bm[4] * y + Bm[8] * z + Bm[12];
        const qy = Bm[1] * x + Bm[5] * y + Bm[9] * z + Bm[13];
        const qz = Bm[2] * x + Bm[6] * y + Bm[10] * z + Bm[14];
        const tx = Bm[0] * nx + Bm[4] * ny + Bm[8] * nz;
        const ty = Bm[1] * nx + Bm[5] * ny + Bm[9] * nz;
        const tz = Bm[2] * nx + Bm[6] * ny + Bm[10] * nz;
        S.fill(0);
        let sum = 0;
        for (let s = 0; s < info.skinSlots; s++) {
          const a = skins[s >> 1], o = i * 4 + (s & 1) * 2;
          const w = tri(a[o + 1]);
          if (!w) continue;
          const b = a[o] * 16;
          if (b < 0 || b + 12 > nb) continue;
          for (let k = 0; k < 12; k++) S[k] += bones[b + k] * w;
          sum += w;
          if (skinRec) { skinRec.idx[i * K + s] = a[o]; skinRec.w[i * K + s] = w; }
        }
        if (!(sum > 0)) continue; // o shader geraria NaN: vértice some
        const inv = 1 / sum;
        const sx = (S[0] * qx + S[1] * qy + S[2] * qz + S[3]) * inv;
        const sy = (S[4] * qx + S[5] * qy + S[6] * qz + S[7]) * inv;
        const sz = (S[8] * qx + S[9] * qy + S[10] * qz + S[11]) * inv;
        x = A4[0] * sx + A4[4] * sy + A4[8] * sz + A4[12];
        y = A4[1] * sx + A4[5] * sy + A4[9] * sz + A4[13];
        z = A4[2] * sx + A4[6] * sy + A4[10] * sz + A4[14];
        const ux = S[0] * tx + S[1] * ty + S[2] * tz;
        const uy = S[4] * tx + S[5] * ty + S[6] * tz;
        const uz = S[8] * tx + S[9] * ty + S[10] * tz;
        nx = C3[0] * ux + C3[3] * uy + C3[6] * uz;
        ny = C3[1] * ux + C3[4] * uy + C3[7] * uz;
        nz = C3[2] * ux + C3[5] * uy + C3[8] * uz;
      } else {
        const px = x, py = y, pz = z;
        x = A4[0] * px + A4[4] * py + A4[8] * pz + A4[12];
        y = A4[1] * px + A4[5] * py + A4[9] * pz + A4[13];
        z = A4[2] * px + A4[6] * py + A4[10] * pz + A4[14];
        const qx = nx, qy = ny, qz = nz;
        nx = C3[0] * qx + C3[3] * qy + C3[6] * qz;
        ny = C3[1] * qx + C3[4] * qy + C3[7] * qz;
        nz = C3[2] * qx + C3[5] * qy + C3[8] * qz;
      }
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
      const l = Math.hypot(nx, ny, nz);
      if (l > 0 && Number.isFinite(l)) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
      outP[i * 3] = x; outP[i * 3 + 1] = y; outP[i * 3 + 2] = z;
      outN[i * 3] = nx; outN[i * 3 + 1] = ny; outN[i * 3 + 2] = nz;
      ok[i] = 1;
    }

    // triângulos (respeitando drawRange e grupos de material)
    const idxSrc = g.index ? g.index.array : null;
    const total = idxSrc ? g.index.count : n;
    const start = (g.drawRange && g.drawRange.start) || 0;
    const cnt = (g.drawRange && Number.isFinite(g.drawRange.count) && g.drawRange.count !== null) ? g.drawRange.count : Infinity;
    const end = Math.min(total, start + cnt);
    const groups = (Array.isArray(mesh.material) && g.groups && g.groups.length) ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    const tris = [];
    let vote = 0;
    for (const gr of groups) {
      const mat = mats[gr.materialIndex || 0];
      if (!mat || mat.visible === false) continue;
      const s0 = Math.max(start, gr.start), s1 = Math.min(end, gr.start + gr.count);
      const arr = [];
      for (let t = s0; t + 2 < s1 + 0.5 && t + 2 < end; t += 3) {
        const a = idxSrc ? idxSrc[t] : t, b = idxSrc ? idxSrc[t + 1] : t + 1, c = idxSrc ? idxSrc[t + 2] : t + 2;
        if (!ok[a] || !ok[b] || !ok[c] || a === b || b === c || a === c) continue;
        arr.push(a, b, c);
        // orientação: a normal geométrica deve concordar com as normais (que apontam para fora)
        const ux = outP[b * 3] - outP[a * 3], uy = outP[b * 3 + 1] - outP[a * 3 + 1], uz = outP[b * 3 + 2] - outP[a * 3 + 2];
        const vx = outP[c * 3] - outP[a * 3], vy = outP[c * 3 + 1] - outP[a * 3 + 1], vz = outP[c * 3 + 2] - outP[a * 3 + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        vote += cx * (outN[a * 3] + outN[b * 3] + outN[c * 3]) + cy * (outN[a * 3 + 1] + outN[b * 3 + 1] + outN[c * 3 + 1]) + cz * (outN[a * 3 + 2] + outN[b * 3 + 2] + outN[c * 3 + 2]);
      }
      tris.push({ mat, idx: arr });
    }
    if (vote < 0) for (const t of tris) for (let k = 0; k < t.idx.length; k += 3) { const tmp = t.idx[k + 1]; t.idx[k + 1] = t.idx[k + 2]; t.idx[k + 2] = tmp; }
    return { key: entry.key, fin: entry.fin, mesh, n, pos: outP, nrm: outN, uv: A.uv ? dense(A.uv, 2) : null, tris, info, flipped: vote < 0, skin: skinRec };
  }

  // Referencial de exportação: tira a rotação de "vitrine" do personagem, mas mantém o espelho (escala -1 em X)
  // que o Hero Forge aplica — senão o modelo sai espelhado (espada na outra mão etc.).
  function exportFrame(CK, opts) {
    const d = CK.display;
    const s = d.scale || { x: 1, y: 1, z: 1 };
    let E = M4.mul(M4.scale(s.x, s.y, s.z), M4.inv(d.matrixWorld.elements));
    const k = opts.scale;
    E = M4.mul(M4.scale(k, k, k), E);
    if (opts.zUp) E = M4.mul(M4.rotX(Math.PI / 2), E);
    return E;
  }

  function buildModel(opts) {
    const CK = editor();
    const { renderer, gl } = glOf(CK);
    const E = exportFrame(CK, opts);
    const entries = collectMeshes(CK, opts);
    if (!entries.length) throw new Error('nenhuma malha visível encontrada.');
    const meshes = entries.map(e => poseMesh(e, E, gl, !!opts.rig));
    let nt = 0, nv = 0;
    for (const m of meshes) { nv += m.n; for (const t of m.tris) nt += t.idx.length / 3; }
    log(`pose calculada: ${meshes.length} malhas, ${nv} vértices, ${nt} triângulos`);
    return { CK, renderer, gl, meshes, triCount: nt, E };
  }

  // ------------------------------------------------------------------ texturas (lidas direto da GPU)
  function texSize(tex, renderer) {
    const img = tex.image;
    let w = (img && (img.width || img.videoWidth)) || tex._width || 0;
    let h = (img && (img.height || img.videoHeight)) || tex._height || 0;
    if ((!w || !h) && renderer && renderer.properties) {
      const p = renderer.properties.get(tex);
      if (p && p.__width) { w = p.__width; h = p.__height; }
    }
    return [w | 0, h | 0];
  }

  // Lê a textura como está na GPU. Linha 0 = v=0 (convenção do WebGL), RGBA 8 bits.
  function readTexture(tex, renderer, gl, cache) {
    if (!tex) return null;
    if (cache.has(tex)) return cache.get(tex);
    let res = null;
    try {
      const [w, h] = texSize(tex, renderer);
      const props = renderer && renderer.properties && renderer.properties.get(tex);
      const glTex = props && props.__webglTexture;
      if (w && h && gl && glTex) {
        const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glTex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
          const data = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
          res = { w, h, data };
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
        gl.deleteFramebuffer(fb);
      }
      if (!res && tex.image && tex.image.data && w && h) { // DataTexture
        const src = tex.image.data, data = new Uint8Array(w * h * 4);
        const ch = Math.round(src.length / (w * h)) || 4, isF = !(src instanceof Uint8Array || src instanceof Uint8ClampedArray);
        for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) {
          const v = c < ch ? src[i * ch + c] : 255;
          data[i * 4 + c] = isF ? Math.max(0, Math.min(255, Math.round(v * 255))) : v;
        }
        res = { w, h, data };
      }
      if (!res && tex.image && w && h && (tex.image instanceof HTMLImageElement || tex.image instanceof HTMLCanvasElement || (window.ImageBitmap && tex.image instanceof ImageBitmap))) {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(tex.image, 0, 0, w, h);
        const id = cx.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h * 4);
        for (let r = 0; r < h; r++) { // flipY=true: topo da imagem = v=1
          const src = tex.flipY !== false ? (h - 1 - r) : r;
          data.set(id.subarray(src * w * 4, (src + 1) * w * 4), r * w * 4);
        }
        res = { w, h, data };
      }
    } catch (e) { warn('falha ao ler textura', e); }
    cache.set(tex, res);
    return res;
  }

  // Recorta a região da peça no atlas (uvPosScl = offset xy, escala zw) e devolve linhas de cima para baixo (PNG).
  function cropRegion(t, reg) {
    const x0 = Math.max(0, Math.min(t.w - 1, Math.round(reg[0] * t.w)));
    const y0 = Math.max(0, Math.min(t.h - 1, Math.round(reg[1] * t.h)));
    const w = Math.max(1, Math.min(t.w - x0, Math.round(reg[2] * t.w)));
    const h = Math.max(1, Math.min(t.h - y0, Math.round(reg[3] * t.h)));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) {
      const srcRow = y0 + h - 1 - r;
      out.set(t.data.subarray((srcRow * t.w + x0) * 4, (srcRow * t.w + x0 + w) * 4), r * w * 4);
    }
    return { w, h, data: out };
  }

  function flipRows(t) { // textura inteira (linha 0 = v=0) -> linhas de cima para baixo
    const out = new Uint8ClampedArray(t.w * t.h * 4);
    for (let r = 0; r < t.h; r++) out.set(t.data.subarray((t.h - 1 - r) * t.w * 4, (t.h - r) * t.w * 4), r * t.w * 4);
    return { w: t.w, h: t.h, data: out };
  }

  async function toPng(img) {
    const cv = document.createElement('canvas'); cv.width = img.w; cv.height = img.h;
    cv.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function mapPixels(img, fn) { // fn(r,g,b,a,out) -> escreve RGBA em out
    const out = new Uint8ClampedArray(img.data.length), px = [0, 0, 0, 255];
    for (let i = 0; i < img.data.length; i += 4) {
      fn(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3], px);
      out[i] = px[0]; out[i + 1] = px[1]; out[i + 2] = px[2]; out[i + 3] = px[3];
    }
    return { w: img.w, h: img.h, data: out };
  }

  // Normal map do site (RG = XY, B = oclusão pré-calculada) -> normal map tangente padrão (OpenGL / Blender).
  function convertNormalMap(img, flipNormalMap) {
    const s = flipNormalMap ? -1 : 1;
    return mapPixels(img, (r, g, b, a, o) => {
      let x = s * (r / 255 * 2 - 1), y = s * (g / 255 * 2 - 1);
      let z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      o[0] = Math.round((x * 0.5 + 0.5) * 255); o[1] = Math.round((y * 0.5 + 0.5) * 255); o[2] = Math.round((z * 0.5 + 0.5) * 255); o[3] = 255;
    });
  }

  function uniformTex(mat, name) { const u = mat.uniforms && mat.uniforms[name]; return u && u.value && u.value.isTexture ? u.value : null; }
  const uNum = (u, k, d) => (u[k] && typeof u[k].value === 'number' ? u[k].value : d);
  const uVec = (u, k) => { const v = u[k] && u[k].value; return v ? [v.x !== undefined ? v.x : v.r, v.y !== undefined ? v.y : v.g, v.z !== undefined ? v.z : v.b] : [0, 0, 0]; };

  // Prepara um registro por material: região no atlas, texturas (cor/física/emissão/oclusão/normal) e os
  // parâmetros que o shader do editor usa para combinar tudo.
  function collectMaterials(model) {
    const recs = new Map(), used = new Set();
    const blended = (window.CK && CK.display && CK.display._blendedNormalMaps) || new Map();
    // peças primeiro (o material ganha o nome da peça dona), depois as tiras de emenda
    const ordered = model.meshes.filter(m => !m.fin).concat(model.meshes.filter(m => m.fin));
    for (const m of ordered) for (const t of m.tris) {
      if (!t.idx.length || recs.has(t.mat)) continue;
      const mat = t.mat, u = mat.uniforms || {};
      let base = (m.fin ? m.key + '_sub' : m.key).replace(/[^A-Za-z0-9_-]+/g, '_') || 'part';
      let name = base, k = 2;
      while (used.has(name)) name = base + '_' + (k++);
      used.add(name);
      const r = u.uvPosScl && u.uvPosScl.value;
      const normal = uniformTex(mat, 'normalMap');
      let part = null;
      for (let o = m.mesh; o && !part; o = o.parent) part = o.part || null;
      const bl = blended.get && blended.get(m.key);
      const rec = {
        name, slot: m.key, part,
        region: r ? [r.x, r.y, r.z, r.w] : [0, 0, 1, 1],
        color: uniformTex(mat, 'colorAtlasMap'),
        phys: uniformTex(mat, 'physicalAtlasMap'),
        emis: uniformTex(mat, 'emissiveAtlasMap'),
        occ: uniformTex(mat, 'occlusionMap'),
        normal,
        blend: bl && normal && bl.normalMapBlendedTarget && normal === bl.normalMapBlendedTarget.texture && bl.normalMap1 && bl.normalMap2
          ? { n1: bl.normalMap1, n2: bl.normalMap2, t: uNum(u, 'normal2Blend', bl.normal2Blend || 0) } : null,
        flipNormalMap: u.flipNormalMap ? +u.flipNormalMap.value : 0,
        occStrength: uNum(u, 'occlusionStrength', 1),
        preStrength: uNum(u, 'preBakeOcclusionStrength', 1),
        shadowStrength: uNum(u, 'shadowStrength', 1),
        translucencyScale: uNum(u, 'translucencyScale', 1),
        refraction: uNum(u, 'refraction', 0),
        eye: null,
      };
      if (uniformTex(mat, 'irisAndDistanceTexture')) {
        rec.eye = {
          iris: uniformTex(mat, 'irisAndDistanceTexture'), sclera: uniformTex(mat, 'scleraTexture'),
          iris0: uVec(u, 'iris0'), iris1: uVec(u, 'iris1'), iris2: uVec(u, 'iris2'),
          sclera0: uVec(u, 'sclera0'), sclera1: uVec(u, 'sclera1'), sclera2: uVec(u, 'sclera2'), pupil: uVec(u, 'pupil'),
          irisSize: uNum(u, 'irisSize', 0.35), irisRotate: uNum(u, 'irisRotate', 0), limbus: uNum(u, 'limbus', 0.18),
          eyeGlow: uNum(u, 'eyeGlow', 0), scleraGlow: uNum(u, 'scleraGlow', 0), pupilGlow: uNum(u, 'pupilGlow', 0),
        };
      }
      recs.set(mat, rec);
    }
    return recs;
  }

  // ------------------------------------------------------------------ "bake" do material como o editor desenha
  // O shader do Hero Forge (lido do site) combina: cor do atlas (sRGB), física (R rugosidade, G metal, B opacidade,
  // A máscara das ilhas UV e um reflexo de borda "sheen"), emissão, oclusão calculada no navegador (atlas próprio:
  // R = oclusão ambiente, G = sombra do sol) e a oclusão pré-calculada da peça (canal B do normal map).
  // Aqui tudo vira texturas PBR comuns, na resolução do atlas (ou maior, no caso dos olhos, que são procedurais).
  const S2L = (() => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; t[i] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); } return t; })();
  const L2S = (() => { const n = 4096, t = new Uint8Array(n + 1); for (let i = 0; i <= n; i++) { const x = i / n; t[i] = Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); } return t; })();
  const lin2srgb = x => L2S[x <= 0 ? 0 : x >= 1 ? 4096 : Math.round(x * 4096)];
  const srgbToLinF = x => (x < 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

  // Amostragem numa textura em orientação GL (linha 0 = v=0), u/v normalizados, borda presa.
  function bilinear(t, u, v, out) {
    const fx = u * t.w - 0.5, fy = v * t.h - 0.5;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    const x1 = x0 + 1 > t.w - 1 ? t.w - 1 : x0 + 1 < 0 ? 0 : x0 + 1, y1 = y0 + 1 > t.h - 1 ? t.h - 1 : y0 + 1 < 0 ? 0 : y0 + 1;
    x0 = x0 < 0 ? 0 : x0 > t.w - 1 ? t.w - 1 : x0; y0 = y0 < 0 ? 0 : y0 > t.h - 1 ? t.h - 1 : y0;
    const d = t.data, a = (y0 * t.w + x0) * 4, b = (y0 * t.w + x1) * 4, c = (y1 * t.w + x0) * 4, e = (y1 * t.w + x1) * 4;
    for (let k = 0; k < 4; k++) out[k] = (d[a + k] * (1 - ax) + d[b + k] * ax) * (1 - ay) + (d[c + k] * (1 - ax) + d[e + k] * ax) * ay;
    return out;
  }
  function nearest(t, u, v, out) {
    const x = Math.max(0, Math.min(t.w - 1, Math.floor(u * t.w))), y = Math.max(0, Math.min(t.h - 1, Math.floor(v * t.h)));
    const o = (y * t.w + x) * 4, d = t.data;
    out[0] = d[o]; out[1] = d[o + 1]; out[2] = d[o + 2]; out[3] = d[o + 3];
    return out;
  }
  function resampleGL(t, w, h) { // bilinear, mantém orientação GL
    if (t.w === w && t.h === h) return t;
    const out = new Uint8ClampedArray(w * h * 4), px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      bilinear(t, (x + 0.5) / w, (y + 0.5) / h, px);
      const o = (y * w + x) * 4;
      out[o] = px[0]; out[o + 1] = px[1]; out[o + 2] = px[2]; out[o + 3] = px[3];
    }
    return { w, h, data: out };
  }

  // Imagem do site (webp/png) -> pixels RGBA em orientação GL. Usada para buscar normal maps maiores (modo UHD).
  async function loadImageGL(url) {
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + url);
    const bmp = await createImageBitmap(await resp.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const id = cx.getImageData(0, 0, bmp.width, bmp.height).data, w = bmp.width, h = bmp.height;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) data.set(id.subarray((h - 1 - r) * w * 4, (h - r) * w * 4), r * w * 4);
    if (bmp.close) bmp.close();
    return { w, h, data };
  }

  // Normal map do site em resolução UHD: o editor só troca os arquivos quando a peça é recriada, então o
  // Herosaver busca direto o arquivo "_nrml_<tamanho>" do tamanho que a peça tem no atlas UHD.
  async function upgradedNormal(tex, rec) {
    const src = tex && tex.image && tex.image.src;
    const m = src && /_nrml_(\d+)\.(webp|png|jpg)/.exec(src);
    if (!m) return null;
    const cur = +m[1];
    let want = cur;
    try { want = CK.display.atlas.getSize(rec.slot) || cur; } catch (e) { /* */ }
    const cap = rec.part && rec.part.maxRenderTextureSize;
    if (cap) want = Math.min(want, cap);
    if (!(want > cur)) return null;
    try { return await loadImageGL(src.replace(/_nrml_\d+\./, `_nrml_${want}.`)); } catch (e) { warn('normal map UHD indisponível', e); return null; }
  }

  async function normalSource(rec, rd, opts, cache) {
    const tex = rec.normal;
    if (!tex) return null;
    if (cache.has(tex)) return cache.get(tex);
    let res = null;
    if (opts.maxQuality) {
      if (rec.blend) { // corpo: o editor mistura dois normal maps (mix linear, como SK.BlendTextures)
        const a = (await upgradedNormal(rec.blend.n1, rec)) || rd(rec.blend.n1), b = rd(rec.blend.n2);
        if (a && b) {
          const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h), A = resampleGL(a, w, h), B = resampleGL(b, w, h), t = rec.blend.t;
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < data.length; i++) data[i] = A.data[i] * (1 - t) + B.data[i] * t;
          res = { w, h, data };
        }
      } else {
        res = await upgradedNormal(tex, rec);
      }
    }
    if (!res) res = rd(tex);
    if (res && (res.w <= 4 || res.h <= 4)) res = null;
    cache.set(tex, res);
    return res;
  }

  // Cor procedural do olho (mesma conta do shader "eye" do site): veias da esclera + íris + pupila + limbo.
  function eyeColor(e, sclera, iris, u, v, out, px) {
    let r = 0.9, g = 0.9, b = 0.9;
    if (sclera) {
      const s = bilinear(sclera, u, v, px)[0] / 255;
      const w0 = clamp01(1 - 2 * s), w1 = clamp01(1 - Math.abs(-2 * s + 1)), w2 = clamp01(2 * s - 1);
      r = e.sclera0[0] * w0 + e.sclera1[0] * w1 + e.sclera2[0] * w2;
      g = e.sclera0[1] * w0 + e.sclera1[1] * w1 + e.sclera2[1] * w2;
      b = e.sclera0[2] * w0 + e.sclera1[2] * w1 + e.sclera2[2] * w2;
    }
    let irisMask = 0, pupilMask = 0;
    const cr = Math.cos(e.irisRotate), sr = Math.sin(e.irisRotate);
    const x = u - 0.5, y = v - 0.5;
    const ix = (cr * x + sr * y) / e.irisSize + 0.5, iy = (-sr * x + cr * y) / e.irisSize + 0.5;
    if (iris && ix > 0 && iy > 0 && ix < 1 && iy < 1) {
      const radius = 1 - bilinear(iris, ix, iy * 0.5 + 0.5, px)[0] / 255 * 2;
      bilinear(iris, ix, iy * 0.5, px);
      const ir = px[0] / 255, ia0 = px[3] / 255;
      if (ia0 > 0.55) { r = e.pupil[0]; g = e.pupil[1]; b = e.pupil[2]; }
      irisMask = Math.min(ia0 * 2, 1);
      let irisA = clamp01(1 - Math.abs(1 - 2 * ia0));
      const lc = Math.max(e.limbus, 1e-3);
      const limbusBlend = clamp01(1 + (radius - 1) / lc), limbusShadow = clamp01(1 + (radius - 1) / (2 * lc));
      irisA *= 1 - limbusBlend; irisMask *= 1 - limbusBlend;
      const t = clamp01((ia0 - 0.55) / 0.05);
      pupilMask = t * t * (3 - 2 * t) * (1 - limbusBlend);
      const w0 = clamp01(1 - 2 * ir), w1 = clamp01(1 - Math.abs(-2 * ir + 1)), w2 = clamp01(2 * ir - 1), sh = 1 - limbusShadow;
      const R = (e.iris0[0] * w0 + e.iris1[0] * w1 + e.iris2[0] * w2) * sh;
      const G = (e.iris0[1] * w0 + e.iris1[1] * w1 + e.iris2[1] * w2) * sh;
      const B = (e.iris0[2] * w0 + e.iris1[2] * w1 + e.iris2[2] * w2) * sh;
      r += (R - r) * irisA; g += (G - g) * irisA; b += (B - b) * irisA;
    }
    out[0] = clamp01(r); out[1] = clamp01(g); out[2] = clamp01(b);
    const sg = e.scleraGlow + (e.eyeGlow - e.scleraGlow) * irisMask;
    out[3] = sg + (e.pupilGlow - sg) * pupilMask; // brilho do olho (emissão)
    return out;
  }

  // Preenche os texels fora das ilhas UV com a média dos vizinhos de dentro (evita bordas escuras com mipmap).
  function dilate(arr, inside, w, h, passes) {
    let known = inside.slice();
    for (let p = 0; p < passes; p++) {
      const next = known.slice();
      let changed = false;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || !known[yy * w + xx]) continue;
            s += arr[yy * w + xx]; c++;
          }
        }
        if (c) { arr[i] = s / c; next[i] = 1; changed = true; }
      }
      known = next;
      if (!changed) break;
    }
    for (let i = 0; i < arr.length; i++) if (!known[i]) arr[i] = 1;
  }

  async function bakeMaterial(rec, rd, opts, normalCache) {
    const reg = rec.region;
    const color = rd(rec.color), phys = rd(rec.phys), emis = rd(rec.emis), occ = rd(rec.occ);
    const nrm = await normalSource(rec, rd, opts, normalCache);
    const ref = color || phys;
    let w = ref ? Math.max(1, Math.round(reg[2] * ref.w)) : 64, h = ref ? Math.max(1, Math.round(reg[3] * ref.h)) : 64;
    const eye = rec.eye, sclera = eye && rd(eye.sclera), iris = eye && rd(eye.iris);
    if (eye) { const s = opts.maxQuality ? 1024 : 512; w = Math.max(w, s); h = Math.max(h, s); }
    const n = w * h;
    const col = new Uint8ClampedArray(n * 3), em = new Uint8ClampedArray(n * 3);
    const rough = new Uint8ClampedArray(n), metal = new Uint8ClampedArray(n), opac = new Uint8ClampedArray(n);
    const ao = new Float32Array(n), sun = new Float32Array(n), inside = new Uint8Array(n);
    const hybrid = !(window.CK && CK.Settings && CK.Settings.occlusionCombineHybrid === false);
    const px = [0, 0, 0, 0], px2 = [0, 0, 0, 0], ec = [0, 0, 0, 0];
    let transparent = false, lit = false, hasAO = false;
    for (let y = 0; y < h; y++) {
      const v = 1 - (y + 0.5) / h; // linha 0 da imagem = topo = v alto
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, i = y * w + x;
        const au = reg[0] + u * reg[2], av = reg[1] + v * reg[3]; // coordenada no atlas (uv * zw + xy)
        // ilha UV = texel que o editor pintou: alfa da cor > 0 ou algum canal da física > 0
        // (pele/cabelo têm alfa da física 0 dentro da ilha; fora dela os dois atlas ficam 0,0,0,0)
        let isIn = !phys && !color;
        if (phys) {
          nearest(phys, au, av, px);
          isIn = px[0] > 0 || px[1] > 0 || px[2] > 0 || px[3] > 0;
          rough[i] = px[0]; metal[i] = px[1]; opac[i] = px[2];
        } else { rough[i] = 204; metal[i] = 0; opac[i] = 255; }
        if (color && !isIn) isIn = nearest(color, au, av, px2)[3] > 0;
        inside[i] = isIn ? 1 : 0;
        if (eye) {
          eyeColor(eye, sclera, iris, u, v, ec, px2);
          col[i * 3] = ec[0] * 255; col[i * 3 + 1] = ec[1] * 255; col[i * 3 + 2] = ec[2] * 255;
          rough[i] = 204; metal[i] = 0; opac[i] = 255;
          if (ec[3] > 0) { lit = true; em[i * 3] = lin2srgb(S2L[col[i * 3]] * ec[3]); em[i * 3 + 1] = lin2srgb(S2L[col[i * 3 + 1]] * ec[3]); em[i * 3 + 2] = lin2srgb(S2L[col[i * 3 + 2]] * ec[3]); }
        } else if (color) {
          nearest(color, au, av, px); // mesma resolução do atlas: texel exato
          col[i * 3] = px[0]; col[i * 3 + 1] = px[1]; col[i * 3 + 2] = px[2];
          // translucidez (alfa da cor): aproximada como transparência parcial
          if (isIn && px[3] < 250) opac[i] = Math.min(opac[i], 255 - (255 - px[3]) * 0.6 * rec.translucencyScale);
        } else { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 200; }
        if (isIn && opac[i] < 250) transparent = true;
        if (emis && !eye) {
          nearest(emis, au, av, px);
          em[i * 3] = px[0]; em[i * 3 + 1] = px[1]; em[i * 3 + 2] = px[2];
          if (isIn && (px[0] > 3 || px[1] > 3 || px[2] > 3)) lit = true;
        }
        // oclusão: igual ao shader (mix com occlusionStrength, combinação "híbrida" com a pré-calculada, sRGB -> linear)
        let o = 1, s = 1;
        if (occ) {
          bilinear(occ, au, av, px);
          o = 1 + (px[0] / 255 - 1) * rec.occStrength;
          s = 1 + (px[1] / 255 - 1) * rec.shadowStrength;
        }
        if (nrm) {
          const pre = 1 + (bilinear(nrm, u, v, px2)[2] / 255 - 1) * rec.preStrength;
          const mn = Math.min(pre, o);
          o = hybrid ? mn + (pre * o - mn) * mn : pre * o;
        }
        ao[i] = srgbToLinF(clamp01(o));
        sun[i] = clamp01(s);
        if (occ || nrm) hasAO = true;
      }
    }
    if (occ) { dilate(ao, inside, w, h, 8); dilate(sun, inside, w, h, 8); }
    // O "sheen" do site (alfa da física) é só um fresnel fraco contra a luz; o sheen do glTF/Blender é bem mais largo e
    // deixava os tecidos escuros acinzentados (testado lado a lado com o editor), então ele não é exportado.
    return { rec, w, h, col, em, rough, metal, opac, ao, sun, inside, transparent, lit, hasAO, nrm, eye: !!eye };
  }

  // Imagens finais (linhas de cima para baixo, prontas para PNG)
  function bakedColor(b, opts, withAlpha) {
    const n = b.w * b.h, out = new Uint8ClampedArray(n * 4), useAO = opts.aoInColor && b.hasAO, useSun = opts.sunInColor;
    for (let i = 0; i < n; i++) {
      if (useAO || useSun) {
        const f = (useAO ? b.ao[i] : 1) * (useSun ? b.sun[i] : 1);
        out[i * 4] = lin2srgb(S2L[b.col[i * 3]] * f); out[i * 4 + 1] = lin2srgb(S2L[b.col[i * 3 + 1]] * f); out[i * 4 + 2] = lin2srgb(S2L[b.col[i * 3 + 2]] * f);
      } else { out[i * 4] = b.col[i * 3]; out[i * 4 + 1] = b.col[i * 3 + 1]; out[i * 4 + 2] = b.col[i * 3 + 2]; }
      out[i * 4 + 3] = withAlpha ? (b.inside[i] ? b.opac[i] : 255) : 255;
    }
    return { w: b.w, h: b.h, data: out };
  }
  function bakedGray(b, fn) {
    const n = b.w * b.h, out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { const g = fn(i); out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g; out[i * 4 + 3] = 255; }
    return { w: b.w, h: b.h, data: out };
  }
  function bakedORM(b) { // glTF: R = oclusão (linear), G = rugosidade, B = metal
    const n = b.w * b.h, out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = Math.round(b.ao[i] * 255); out[i * 4 + 1] = b.rough[i]; out[i * 4 + 2] = b.metal[i]; out[i * 4 + 3] = 255; }
    return { w: b.w, h: b.h, data: out };
  }
  function bakedEmissive(b) {
    const n = b.w * b.h, out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = b.em[i * 3]; out[i * 4 + 1] = b.em[i * 3 + 1]; out[i * 4 + 2] = b.em[i * 3 + 2]; out[i * 4 + 3] = 255; }
    return { w: b.w, h: b.h, data: out };
  }
  // amostra (nearest) da cor final num uv da peça, para a cor por vértice do OBJ
  function sampleBaked(img, u, v) {
    const x = Math.max(0, Math.min(img.w - 1, Math.floor(u * img.w))), y = Math.max(0, Math.min(img.h - 1, Math.floor((1 - v) * img.h)));
    const o = (y * img.w + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  }

  // ------------------------------------------------------------------ OBJ / MTL
  const f4 = x => { const s = (Math.abs(x) < 5e-5 ? 0 : x).toFixed(4); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
  const f5 = x => { const s = x.toFixed(5); return s.replace(/0+$/, '').replace(/\.$/, ''); };
  const c3 = x => (x / 255).toFixed(3);

  async function buildObjFiles(opts) {
    toast('calculando a pose…', true); await nextFrame();
    const model = buildModel(opts);
    const name = characterName();
    const files = [];
    const recs = collectMaterials(model);
    const cache = new Map();
    const rd = tex => readTexture(tex, model.renderer, model.gl, cache);

    // ---- materiais e texturas
    toast('lendo texturas…', true); await nextFrame();
    const mtl = [`# Herosaver ${VERSION} — ${name}`,
      '# map_Kd = cor' + (opts.aoInColor ? ' com a oclusão (AO) do editor' : '') + (opts.sunInColor ? ' e a sombra do sol' : '') + '; *_ao.png = oclusão separada (linear)', ''];
    const normalFiles = new Map(), normalCache = new Map();
    let ti = 0;
    for (const rec of recs.values()) {
      ti++;
      toast(`texturas ${ti}/${recs.size}…`, true); await nextFrame();
      const b = await bakeMaterial(rec, rd, opts, normalCache);
      const img = bakedColor(b, opts, false);
      rec.bakedColor = img;
      const lines = [`newmtl ${rec.name}`];
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let i = 0; i < b.w * b.h; i += 7) if (b.inside[i]) { sr += img.data[i * 4]; sg += img.data[i * 4 + 1]; sb += img.data[i * 4 + 2]; sn++; }
      const avg = sn ? [sr / sn, sg / sn, sb / sn] : [200, 200, 200];
      let rAvg = 0, mAvg = 0, cnt = 0;
      for (let i = 0; i < b.w * b.h; i++) if (b.inside[i]) { rAvg += b.rough[i]; mAvg += b.metal[i]; cnt++; }
      rAvg = cnt ? rAvg / cnt / 255 : 0.8; mAvg = cnt ? mAvg / cnt / 255 : 0;
      const T = f => `textures/${rec.name}_${f}.png`;
      lines.push('Ka 0 0 0', opts.textures ? 'Kd 1 1 1' : `Kd ${c3(avg[0])} ${c3(avg[1])} ${c3(avg[2])}`, 'Ks 0.5 0.5 0.5', 'Ns 100', 'illum 2');
      if (opts.textures) {
        files.push({ name: T('color'), data: await toPng(img) });
        files.push({ name: T('roughness'), data: await toPng(bakedGray(b, i => b.rough[i])) });
        files.push({ name: T('metallic'), data: await toPng(bakedGray(b, i => b.metal[i])) });
        lines.push(`map_Kd ${T('color')}`, 'Pr 1', `map_Pr ${T('roughness')}`, 'Pm 1', `map_Pm ${T('metallic')}`);
        if (b.hasAO) files.push({ name: T('ao'), data: await toPng(bakedGray(b, i => Math.round(b.ao[i] * 255))) });
        if (b.transparent) {
          files.push({ name: T('opacity'), data: await toPng(bakedGray(b, i => (b.inside[i] ? b.opac[i] : 255))) });
          lines.push('d 1', `map_d ${T('opacity')}`);
        }
        if (b.lit) {
          files.push({ name: T('emissive'), data: await toPng(bakedEmissive(b)) });
          lines.push('Ke 1 1 1', `map_Ke ${T('emissive')}`);
        }
      } else {
        lines.push(`Pr ${rAvg.toFixed(3)}`, `Pm ${mAvg.toFixed(3)}`);
      }
      if (b.eye) lines.push('Pc 1', 'Pcr 0.03'); // córnea brilhante sobre a íris fosca, como o shader do olho
      if (opts.textures && b.nrm) {
        const key = rec.normal.uuid + '|' + rec.flipNormalMap; // L e R dividem o arquivo, mas o L é invertido
        let fname = normalFiles.get(key);
        if (fname === undefined) {
          fname = T('normal');
          files.push({ name: fname, data: await toPng(convertNormalMap(flipRows(b.nrm), rec.flipNormalMap)) });
          normalFiles.set(key, fname);
        }
        lines.push(`map_Bump -bm 1 ${fname}`, `norm ${fname}`);
      }
      mtl.push(...lines, '');
    }

    // ---- geometria
    toast('gerando OBJ…', true); await nextFrame();
    const out = [`# Herosaver ${VERSION} — ${name}`, `# ${model.triCount} triângulos, unidades = ${({ 10: 'mm', 1: 'cm', [10 / 25.4]: 'polegadas' })[opts.scale] || ('cm x ' + opts.scale)}`, `mtllib ${name}.mtl`];
    let base = 1;
    const uvWarn = [];
    for (const m of model.meshes) {
      const keep = new Int32Array(m.n).fill(-1);
      let k = 0;
      for (const t of m.tris) for (const i of t.idx) if (keep[i] < 0) keep[i] = k++;
      if (!k) continue;
      const order = new Int32Array(k);
      for (let i = 0; i < m.n; i++) if (keep[i] >= 0) order[keep[i]] = i;
      out.push(`o ${m.fin ? m.key + '_sub' : m.key}`);
      const rec0 = recs.get(m.tris[0] && m.tris[0].mat);
      const vline = [], tline = [], nline = [];
      let uvOut = 0;
      for (let j = 0; j < k; j++) {
        const i = order[j];
        let col = '';
        if (opts.vertexColors && m.uv && rec0 && rec0.bakedColor) {
          const s = sampleBaked(rec0.bakedColor, m.uv[i * 2], m.uv[i * 2 + 1]);
          col = ` ${c3(s[0])} ${c3(s[1])} ${c3(s[2])}`;
        }
        vline.push(`v ${f4(m.pos[i * 3])} ${f4(m.pos[i * 3 + 1])} ${f4(m.pos[i * 3 + 2])}${col}`);
        if (m.uv) {
          const u = m.uv[i * 2], v = m.uv[i * 2 + 1];
          if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) uvOut++;
          tline.push(`vt ${f5(u)} ${f5(v)}`);
        }
        if (opts.normals) nline.push(`vn ${f4(m.nrm[i * 3])} ${f4(m.nrm[i * 3 + 1])} ${f4(m.nrm[i * 3 + 2])}`);
      }
      if (uvOut) uvWarn.push(`${m.key}: ${uvOut}`);
      out.push(vline.join('\n'));
      if (tline.length) out.push(tline.join('\n'));
      if (nline.length) out.push(nline.join('\n'));
      for (const t of m.tris) {
        if (!t.idx.length) continue;
        const rec = recs.get(t.mat);
        out.push(`usemtl ${rec ? rec.name : 'default'}`);
        const fl = [];
        const hasT = !!m.uv, hasN = !!opts.normals;
        for (let q = 0; q < t.idx.length; q += 3) {
          const a = keep[t.idx[q]] + base, b = keep[t.idx[q + 1]] + base, c = keep[t.idx[q + 2]] + base;
          const v = x => hasT && hasN ? `${x}/${x}/${x}` : hasT ? `${x}/${x}` : hasN ? `${x}//${x}` : `${x}`;
          fl.push(`f ${v(a)} ${v(b)} ${v(c)}`);
        }
        out.push(fl.join('\n'));
      }
      base += k;
    }
    if (uvWarn.length) warn('UVs fora de [0,1] (podem pegar cor da peça vizinha no atlas):', uvWarn.join(', '));
    const enc = new TextEncoder();
    files.unshift({ name: `${name}.mtl`, data: enc.encode(mtl.join('\n')), text: true });
    files.unshift({ name: `${name}.obj`, data: enc.encode(out.join('\n') + '\n'), text: true });
    return { name, files, model };
  }

  // ------------------------------------------------------------------ STL binário
  function buildStl(opts) {
    const model = buildModel(opts);
    const buf = new ArrayBuffer(84 + model.triCount * 50), dv = new DataView(buf);
    const head = `Herosaver ${VERSION} ${characterName()}`.slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
    dv.setUint32(80, model.triCount, true);
    let o = 84;
    for (const m of model.meshes) for (const t of m.tris) for (let q = 0; q < t.idx.length; q += 3) {
      const a = t.idx[q] * 3, b = t.idx[q + 1] * 3, c = t.idx[q + 2] * 3, P = m.pos;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      o += 12;
      for (const v of [a, b, c]) { dv.setFloat32(o, P[v], true); dv.setFloat32(o + 4, P[v + 1], true); dv.setFloat32(o + 8, P[v + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Uint8Array(buf);
  }

  // ------------------------------------------------------------------ RIG simplificado + GLB com animação idle
  // O esqueleto do Hero Forge tem ~2000 ossos (a maioria só ajusta proporções: fat, twist, legLength...).
  // Aqui eles são reduzidos a ~27 articulações humanoides e os pesos de pele são somados nelas.
  // Cada articulação fica na posição do osso correspondente na pose atual, com rotação identidade
  // (eixos do mundo: X direita, Y cima, Z frente) — assim a pose do personagem continua exatamente a da tela.
  // [nome, pai, [nomes dos ossos do Hero Forge (sem o sufixo _NNNN_bind_jnt)]]
  const RIG_DEF = [
    ['hips', 'root', ['main_hips']],
    ['spine', 'hips', ['main_spine_01']],
    ['spine1', 'spine', ['main_spine_02']],
    ['chest', 'spine1', ['main_spine_03']],
    ['neck', 'chest', ['main_neck_01']],
    ['head', 'neck', ['main_head_01']],
    ['jaw', 'head', ['main_jaw_01']],
    ['clavicle.L', 'chest', ['main_clavL_01']],
    ['upperArm.L', 'clavicle.L', ['main_armL_01']],
    ['lowerArm.L', 'upperArm.L', ['main_armL_02']],
    ['hand.L', 'lowerArm.L', ['main_handL_01']],
    ['clavicle.R', 'chest', ['main_clavR_01']],
    ['upperArm.R', 'clavicle.R', ['main_armR_01']],
    ['lowerArm.R', 'upperArm.R', ['main_armR_02']],
    ['hand.R', 'lowerArm.R', ['main_handR_01']],
    ['thigh.L', 'hips', ['main_legL_01', 'main_dgLeg_L_01']],
    ['shin.L', 'thigh.L', ['main_legL_02', 'main_dgLeg_L_02']],
    ['foot.L', 'shin.L', ['main_ankleL_01']],
    ['toe.L', 'foot.L', ['main_toeL_01']],
    ['thigh.R', 'hips', ['main_legR_01', 'main_dgLeg_R_01']],
    ['shin.R', 'thigh.R', ['main_legR_02', 'main_dgLeg_R_02']],
    ['foot.R', 'shin.R', ['main_ankleR_01']],
    ['toe.R', 'foot.R', ['main_toeR_01']],
  ];
  const hfBase = n => String(n || '').replace(/_\d+_bind_jnt$/, '');
  // peças da base (peanha, borda, plaquinha com nome/número)
  const isBasePart = key => /^(base|label$|tagNumber$)/i.test(String(key || ''));

  function buildRig(model) {
    const withSkel = model.meshes.find(m => m.mesh.skeleton && m.skin);
    if (!withSkel) throw new Error('esqueleto do personagem não encontrado.');
    const bones = withSkel.mesh.skeleton.bones, nb = bones.length;
    const index = new Map();
    bones.forEach((b, i) => { if (b) index.set(b, i); });
    const parentOf = i => { let o = bones[i].parent; while (o && !index.has(o)) o = o.parent; return o ? index.get(o) : -1; };
    const depthMemo = new Int16Array(nb).fill(-1);
    const depthOf = i => {
      if (depthMemo[i] >= 0) return depthMemo[i];
      const p = parentOf(i);
      return (depthMemo[i] = p < 0 ? 0 : depthOf(p) + 1);
    };
    const byBase = new Map();
    bones.forEach((b, i) => { if (!b) return; const k = hfBase(b.name); if (!byBase.has(k)) byBase.set(k, []); byBase.get(k).push(i); });

    const E = model.E;
    const joints = [{ name: 'root', parent: -1, pos: [0, 0, 0], aliases: [] }];
    const jIndex = { root: 0 };
    const keyOwner = new Map(); // índice do osso HF -> índice da articulação
    for (const [name, parent, aliases] of RIG_DEF) {
      const primary = (byBase.get(aliases[0]) || []).reduce((best, i) => best < 0 || depthOf(i) > depthOf(best) ? i : best, -1);
      if (primary < 0 || !(parent in jIndex)) continue; // osso não existe neste esqueleto: o filho cai na articulação do pai
      const w = bones[primary].matrixWorld.elements;
      const pos = [E[0] * w[12] + E[4] * w[13] + E[8] * w[14] + E[12], E[1] * w[12] + E[5] * w[13] + E[9] * w[14] + E[13], E[2] * w[12] + E[6] * w[13] + E[10] * w[14] + E[14]];
      jIndex[name] = joints.length;
      joints.push({ name, parent: jIndex[parent], pos, aliases });
      for (const a of aliases) for (const i of (byBase.get(a) || [])) keyOwner.set(i, jIndex[name]);
      keyOwner.set(primary, jIndex[name]);
    }
    if (!('hips' in jIndex)) throw new Error('osso do quadril não encontrado.');
    // chão: o root fica embaixo do quadril, na altura do plano da base
    joints[0].pos = [joints[jIndex.hips].pos[0], 0, joints[jIndex.hips].pos[2]];

    // dono de cada osso HF = articulação-chave mais próxima na árvore (sem ancestral-chave -> quadril)
    const owner = new Int16Array(nb).fill(-2);
    const ownerOf = i => {
      const path = [];
      let c = i;
      while (c >= 0 && owner[c] === -2) {
        if (keyOwner.has(c)) { owner[c] = keyOwner.get(c); break; }
        path.push(c); c = parentOf(c);
      }
      const res = c < 0 ? jIndex.hips : owner[c];
      for (const p of path) owner[p] = res;
      return res;
    };
    for (let i = 0; i < nb; i++) if (bones[i]) ownerOf(i);

    // pesos por vértice: soma por articulação, fica com as 4 maiores e normaliza
    const stats = new Float64Array(joints.length), hfStats = new Float64Array(nb);
    let nOver4 = 0;
    for (const m of model.meshes) {
      const J = new Uint8Array(m.n * 4), W = new Float32Array(m.n * 4);
      if (isBasePart(m.key)) { // base/peanha: presa no "root", que não é animado (senão balança junto com o quadril)
        for (let i = 0; i < m.n; i++) { J[i * 4] = 0; W[i * 4] = 1; }
        m.rigidJoint = 0;
        m.rigJ = J; m.rigW = W;
        continue;
      }
      if (m.skin) {
        const K = m.skin.k, jj = new Int16Array(K), ww = new Float64Array(K);
        for (let i = 0; i < m.n; i++) {
          let cnt = 0;
          for (let s = 0; s < K; s++) {
            const w = m.skin.w[i * K + s];
            if (!w) continue;
            const bi = m.skin.idx[i * K + s];
            const j = bi < nb && bones[bi] ? owner[bi] : jIndex.hips;
            let q = 0;
            while (q < cnt && jj[q] !== j) q++;
            if (q === cnt) { jj[cnt] = j; ww[cnt] = 0; cnt++; }
            ww[q] += w;
            hfStats[bi] += w;
          }
          if (!cnt) { J[i * 4] = jIndex.hips; W[i * 4] = 1; continue; }
          if (cnt > 4) nOver4++;
          const order = Array.from({ length: cnt }, (_, q) => q).sort((a, b) => ww[b] - ww[a]).slice(0, 4);
          let sum = 0;
          for (const q of order) sum += ww[q];
          order.forEach((q, k) => { J[i * 4 + k] = jj[q]; W[i * 4 + k] = ww[q] / sum; stats[jj[q]] += ww[q] / sum; });
        }
      } else {
        let o = m.mesh.parent;
        while (o && !index.has(o)) o = o.parent;
        const j = o ? owner[index.get(o)] : (/back|cape|cloak|wing/i.test(m.key) ? jIndex.chest : jIndex.hips);
        for (let i = 0; i < m.n; i++) { J[i * 4] = j; W[i * 4] = 1; }
        m.rigidJoint = j;
      }
      m.rigJ = J; m.rigW = W;
    }
    return { joints, jIndex, stats, nOver4, hfStats, owner, boneNames: bones.map(b => b && b.name) };
  }

  // Ciclo de respiração/idle de `secs` segundos, em graus por eixo do mundo [rx, ry, rz] de cada articulação.
  // Todas as ondas têm frequência inteira do ciclo, então o loop fecha sem salto.
  function idlePose(ph, side, amount) {
    const S = Math.sin, d = Math.PI / 180 * amount, o = {};
    const hips = [0.5 * S(2 * ph + 0.4), 0.9 * S(ph + 2.0), 1.2 * S(ph + 1.0)];
    o.hips = hips;
    o.spine = [-0.9 * S(ph - 0.1), -0.5 * S(ph + 2.0), -0.8 * S(ph + 1.0)];
    o.spine1 = [-1.3 * S(ph - 0.3), -0.4 * S(ph + 2.0), -0.4 * S(ph + 1.0)];
    o.chest = [-2.0 * S(ph - 0.5), 0.3 * S(ph + 1.5), 0.2 * S(ph + 0.5)];
    o.neck = [1.4 * S(ph - 0.9), 1.5 * S(ph - 0.7), 0.5 * S(ph + 1.5)];
    o.head = [1.2 * S(2 * ph + 0.3) + 0.8 * S(ph - 1.3), 3.5 * S(ph - 0.9), 1.0 * S(ph + 1.5)];
    for (const k of ['L', 'R']) {
      const s = side[k];
      o['clavicle.' + k] = [0.3 * S(ph - 0.5), 0, s * 2.0 * S(ph - 0.4)];
      o['upperArm.' + k] = [1.8 * S(ph - 1.0), 0, s * 1.2 * S(ph - 0.7)];
      o['lowerArm.' + k] = [-2.8 * S(ph - 1.5), 0, s * 0.6 * S(ph - 1.2)];
      o['hand.' + k] = [3.2 * S(ph - 2.1), 0, s * 1.6 * S(ph - 2.0)];
      o['thigh.' + k] = hips.map(v => -v);        // pernas ficam plantadas enquanto a bacia balança
    }
    for (const j in o) o[j] = o[j].map(v => v * d);
    return o;
  }

  const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qEuler = (x, y, z) => { // gira em X, depois Y, depois Z (eixos do mundo); [x y z w]
    const qx = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)], qy = [0, Math.sin(y / 2), 0, Math.cos(y / 2)], qz = [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
    return qMul(qz, qMul(qy, qx));
  };

  // escala 0,01: 1 unidade do Hero Forge = 1 cm e o glTF é em metros (miniatura no tamanho real, ~3,7 cm)
  const glbDefaults = { scale: 0.01, rig: false, animate: true, seconds: 4, fps: 30, amount: 1.5, zUp: false };

  async function buildGlb(opts) {
    toast('calculando a pose…', true); await nextFrame();
    const model = buildModel(opts);
    const name = characterName();
    const rig = opts.rig ? buildRig(model) : null;
    const joints = rig ? rig.joints : [], jIndex = rig ? rig.jIndex : {};
    const recs = collectMaterials(model);
    const cache = new Map();
    const rd = tex => readTexture(tex, model.renderer, model.gl, cache);

    // ---- buffer binário
    const chunks = [], bufferViews = [], accessors = [];
    let len = 0;
    const addView = (u8, target) => {
      const pad = (4 - (len % 4)) % 4;
      if (pad) { chunks.push(new Uint8Array(pad)); len += pad; }
      const v = { buffer: 0, byteOffset: len, byteLength: u8.byteLength };
      if (target) v.target = target;
      chunks.push(u8); len += u8.byteLength;
      bufferViews.push(v);
      return bufferViews.length - 1;
    };
    const bytes = ta => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    const addAcc = (ta, componentType, type, count, target, extra) => {
      accessors.push(Object.assign({ bufferView: addView(bytes(ta), target), componentType, count, type }, extra || {}));
      return accessors.length - 1;
    };
    const FLOAT = 5126, UBYTE = 5121, UINT = 5125, ARRAY = 34962, ELEM = 34963;

    // ---- materiais e texturas
    const images = [], textures = [], materials = [], normalTex = new Map(), normalCache = new Map(), extUsed = new Set();
    const addImage = async img => {
      images.push({ bufferView: addView(await toPng(img)), mimeType: 'image/png' });
      textures.push({ source: images.length - 1, sampler: 0 });
      return { index: textures.length - 1 };
    };
    let ti = 0;
    for (const rec of recs.values()) {
      ti++;
      toast(`texturas ${ti}/${recs.size}…`, true); await nextFrame();
      const b = await bakeMaterial(rec, rd, opts, normalCache);
      const mat = { name: rec.name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 1, roughnessFactor: 1 } };
      const pbr = mat.pbrMetallicRoughness;
      pbr.baseColorTexture = await addImage(bakedColor(b, opts, b.transparent)); // opacidade no alfa da cor
      if (b.transparent) mat.alphaMode = 'BLEND';
      // ORM numa textura só (o Godot reconhece e cria um ORMMaterial3D; o Blender separa os canais)
      const orm = await addImage(bakedORM(b));
      pbr.metallicRoughnessTexture = { index: orm.index };
      if (b.hasAO) mat.occlusionTexture = { index: orm.index };
      if (b.lit) { mat.emissiveTexture = await addImage(bakedEmissive(b)); mat.emissiveFactor = [1, 1, 1]; }
      if (b.nrm) {
        const key = rec.normal.uuid + '|' + rec.flipNormalMap;
        if (!normalTex.has(key)) normalTex.set(key, await addImage(convertNormalMap(flipRows(b.nrm), rec.flipNormalMap)));
        mat.normalTexture = { index: normalTex.get(key).index };
      }
      const ext = {};
      if (b.eye) ext.KHR_materials_clearcoat = { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.03 }; // córnea
      if (Object.keys(ext).length) { mat.extensions = ext; Object.keys(ext).forEach(k => extUsed.add(k)); }
      rec.glbMat = materials.length;
      materials.push(mat);
    }

    // ---- malhas
    toast('montando o GLB…', true); await nextFrame();
    const meshes = [], nodes = [];
    for (const j of joints) nodes.push({ name: j.name, translation: j.parent < 0 ? j.pos.slice() : j.pos.map((v, k) => v - joints[j.parent].pos[k]), children: [] });
    joints.forEach((j, i) => { if (j.parent >= 0) nodes[j.parent].children.push(i); });
    const jointCount = joints.length;
    const meshNodes = [];
    for (const m of model.meshes) {
      const keep = new Int32Array(m.n).fill(-1);
      let k = 0;
      for (const t of m.tris) for (const i of t.idx) if (keep[i] < 0) keep[i] = k++;
      if (!k) continue;
      const order = new Int32Array(k);
      for (let i = 0; i < m.n; i++) if (keep[i] >= 0) order[keep[i]] = i;
      const P = new Float32Array(k * 3), N = new Float32Array(k * 3), UV = m.uv ? new Float32Array(k * 2) : null;
      const Jt = rig ? new Uint8Array(k * 4) : null, Wt = rig ? new Float32Array(k * 4) : null;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let q = 0; q < k; q++) {
        const i = order[q];
        for (let c = 0; c < 3; c++) {
          const v = m.pos[i * 3 + c];
          P[q * 3 + c] = v; N[q * 3 + c] = m.nrm[i * 3 + c];
          if (v < mn[c]) mn[c] = v;
          if (v > mx[c]) mx[c] = v;
        }
        if (UV) { UV[q * 2] = m.uv[i * 2]; UV[q * 2 + 1] = 1 - m.uv[i * 2 + 1]; }
        if (rig) for (let c = 0; c < 4; c++) { Jt[q * 4 + c] = m.rigJ[i * 4 + c]; Wt[q * 4 + c] = m.rigW[i * 4 + c]; }
      }
      const attributes = {
        POSITION: addAcc(P, FLOAT, 'VEC3', k, ARRAY, { min: mn, max: mx }),
        NORMAL: addAcc(N, FLOAT, 'VEC3', k, ARRAY),
      };
      if (rig) {
        attributes.JOINTS_0 = addAcc(Jt, UBYTE, 'VEC4', k, ARRAY);
        attributes.WEIGHTS_0 = addAcc(Wt, FLOAT, 'VEC4', k, ARRAY);
      }
      if (UV) attributes.TEXCOORD_0 = addAcc(UV, FLOAT, 'VEC2', k, ARRAY);
      const primitives = [];
      for (const t of m.tris) {
        if (!t.idx.length) continue;
        const I = new Uint32Array(t.idx.length);
        for (let q = 0; q < I.length; q++) I[q] = keep[t.idx[q]];
        const rec = recs.get(t.mat);
        const prim = { attributes, indices: addAcc(I, UINT, 'SCALAR', I.length, ELEM), mode: 4 };
        if (rec && rec.glbMat !== undefined) prim.material = rec.glbMat;
        primitives.push(prim);
      }
      meshes.push({ name: m.fin ? m.key + '_sub' : m.key, primitives });
      const node = { name: m.fin ? m.key + '_sub' : m.key, mesh: meshes.length - 1 };
      if (rig) node.skin = 0;
      meshNodes.push(node);
    }

    // ---- skin (matrizes de bind = inversa da translação de cada articulação)
    let skin = null;
    if (rig) {
      const ibm = new Float32Array(jointCount * 16);
      joints.forEach((j, i) => { ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.pos[0], -j.pos[1], -j.pos[2], 1], i * 16); });
      skin = { name: 'Armature', skeleton: 0, joints: joints.map((_, i) => i), inverseBindMatrices: addAcc(ibm, FLOAT, 'MAT4', jointCount) };
    }

    // ---- animação idle
    const animations = [];
    let frames = 0;
    if (rig && opts.animate) {
      const fps = opts.fps, secs = opts.seconds;
      frames = Math.round(fps * secs);
      const xs = joints.map(j => j.pos[0]);
      const side = { L: Math.sign(xs[jIndex['upperArm.L']] || 1) || 1, R: Math.sign(xs[jIndex['upperArm.R']] || -1) || -1 };
      const times = new Float32Array(frames + 1);
      for (let f = 0; f <= frames; f++) times[f] = f / fps;
      const timeAcc = addAcc(times, FLOAT, 'SCALAR', frames + 1, null, { min: [0], max: [times[frames]] });
      const tracks = new Map();
      for (let f = 0; f <= frames; f++) {
        const pose = idlePose(2 * Math.PI * (f % frames) / frames, side, opts.amount);
        for (const jn in pose) {
          if (!(jn in jIndex)) continue;
          if (!tracks.has(jn)) tracks.set(jn, new Float32Array((frames + 1) * 4));
          tracks.get(jn).set(qEuler(...pose[jn]), f * 4);
        }
      }
      const samplers = [], channels = [];
      for (const [jn, arr] of tracks) {
        samplers.push({ input: timeAcc, output: addAcc(arr, FLOAT, 'VEC4', frames + 1), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: jIndex[jn], path: 'rotation' } });
      }
      animations.push({ name: 'Idle', samplers, channels });
    }

    const jointNodes = nodes.map(n => (n.children.length ? n : { name: n.name, translation: n.translation }));
    const allNodes = jointNodes.concat(meshNodes);
    const gltf = {
      asset: { version: '2.0', generator: `Herosaver ${VERSION}` },
      scene: 0,
      scenes: [{ name: name, nodes: (rig ? [0] : []).concat(meshNodes.map((_, i) => jointCount + i)) }],
      nodes: allNodes, meshes, materials, textures, images,
      // CLAMP: as ilhas UV de cada peça ficam dentro de [0,1]; repetir puxaria a borda oposta nos mipmaps
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
      accessors, bufferViews, buffers: [{ byteLength: (len + 3) & ~3 }],
    };
    if (skin) gltf.skins = [skin];
    if (extUsed.size) gltf.extensionsUsed = [...extUsed];
    if (animations.length) gltf.animations = animations;
    if (!textures.length) { delete gltf.textures; delete gltf.images; delete gltf.samplers; }
    if (!materials.length) delete gltf.materials;

    // ---- contêiner GLB
    const enc = new TextEncoder();
    let json = enc.encode(JSON.stringify(gltf));
    const jpad = (4 - (json.length % 4)) % 4;
    if (jpad) { const j2 = new Uint8Array(json.length + jpad).fill(0x20); j2.set(json); json = j2; }
    const binLen = (len + 3) & ~3;
    const total = 12 + 8 + json.length + 8 + binLen;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(json, 20);
    let o = 20 + json.length;
    dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004E4942, true); o += 8;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    log(`GLB: ${joints.length} articulações, ${meshes.length} malhas, ${materials.length} materiais, ${images.length} texturas, ${frames} quadros` + (rig ? `; vértices com >4 articulações: ${rig.nOver4}` : ''));
    return { name, glb: out, rig, triCount: model.triCount, frames, model };
  }

  // ------------------------------------------------------------------ ZIP (sem dependências)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  async function deflateRaw(u8) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch (e) { return null; }
  }

  async function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data);
      let method = 0, body = f.data;
      if (f.text) { const z = await deflateRaw(f.data); if (z && z.length < f.data.length) { method = 8; body = z; } }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
      ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 30000);
  }

  // ------------------------------------------------------------------ qualidade máxima: UHD + oclusão 4K só durante o export
  // O editor tem um modo "uhdTextures" (texturas com o dobro da resolução, as mesmas peças) e calcula a oclusão num
  // atlas próprio, de 512 px na maioria dos computadores. O export liga os dois, espera o editor refazer tudo,
  // exporta e devolve o editor como estava.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitUntil(cond, ms, what) {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) { warn('tempo esgotado esperando ' + what); return false; }
      await sleep(200);
    }
    return true;
  }
  function editorIdle() {
    const d = CK.display, cb = d.colorBake;
    return d.finished !== false && d.resourcesReady !== false && !(CK.character && CK.character.isLoading && CK.character.isLoading()) &&
      !(cb && cb.needsRefresh && Object.keys(cb.needsRefresh).length);
  }
  async function waitStable(ms, what) { // ocioso em 5 checagens seguidas (~1 s)
    let ok = 0;
    const t0 = performance.now();
    while (ok < 5) {
      if (performance.now() - t0 > ms) { warn('tempo esgotado esperando ' + what); return false; }
      ok = editorIdle() ? ok + 1 : 0;
      await sleep(200);
    }
    return true;
  }
  // A oclusão ambiente (canal R) e a sombra do sol (canal G) são dois passos que escrevem no mesmo alvo; ao mudar o
  // tamanho, os dois precisam ser refeitos juntos, senão a sombra do sol do editor some.
  const occlusionPasses = d => [d.sunOcclusion, d.occlusion].filter(p => p && p.initializeIO);
  function reinitOcclusion(d, width, samples) {
    for (const p of occlusionPasses(d)) {
      p.requestedOcclusionWidth = width;
      if (samples && samples.has(p)) p.sampleCount = samples.get(p);
      p.initializeIO(d);
      p.needsRefresh = true;
    }
  }
  // Estado original do editor, guardado no primeiro export e só apagado quando a restauração termina
  // (dois exports seguidos não podem tomar o estado "turbinado" do primeiro como original).
  let saved = null, restoreToken = 0;
  async function boostQuality() {
    const CK = editor(), S = CK.Settings, d = CK.display, passes = occlusionPasses(d);
    restoreToken++; // cancela uma restauração ainda pendente
    if (!saved || saved.display !== d) {
      saved = { display: d, uhd: !!S.uhdTextures, atlasW: d.atlas ? d.atlas.width : 0, occ: passes.map(p => [p, p.requestedOcclusionWidth || p.occlusionWidth, p.sampleCount]) };
    }
    const st = { changed: false };
    if (!saved.uhd && CK.character && CK.character.changeSettings) {
      toast('qualidade máxima: carregando texturas UHD…', true);
      const target = Math.min(2 * saved.atlasW, S.textureWidthMax || 4096);
      if (!S.uhdTextures) { S.uhdTextures = true; CK.character.changeSettings({}); }
      st.changed = true;
      await waitUntil(() => d.atlas && d.atlas.width >= target, 8000, 'atlas UHD');
      await waitStable(90000, 'texturas UHD');
    }
    if (passes.length && S.occlusion !== false) {
      toast('qualidade máxima: recalculando a oclusão em 4K…', true);
      const ra = d.modded && d.modded.resourceAtlas;
      const more = new Map(passes.map(p => [p, Math.max(p.sampleCount || 0, p === d.sunOcclusion ? 256 : 4096)]));
      reinitOcclusion(d, Math.min(4096, (ra && ra.width) || 4096), more);
      st.changed = true;
      await waitUntil(() => passes.some(p => p._isDone === false), 4000, 'início da oclusão'); // recomeça em ~0,2 s
      await waitUntil(() => passes.every(p => p._isDone !== false) && editorIdle(), 180000, 'oclusão 4K');
      await sleep(300);
    }
    return st;
  }
  function restoreQuality(st) {
    if (!st || !st.changed || !saved) return;
    const token = ++restoreToken, orig = saved;
    try {
      const S = CK.Settings, d = orig.display;
      if (!orig.uhd && S.uhdTextures) { S.uhdTextures = false; CK.character.changeSettings({}); }
      // refaz a oclusão e a sombra do sol no tamanho original depois que o atlas volta ao normal
      waitStable(60000, 'editor').then(() => {
        if (token !== restoreToken) return; // outro export começou: ele restaura no fim
        try {
          for (const [p, w, n] of orig.occ) { p.requestedOcclusionWidth = w || S.occlusionTextureSize || 512; if (n) p.sampleCount = n; p.initializeIO(d); p.needsRefresh = true; }
        } catch (e) { warn('falha ao refazer a oclusão do editor', e); }
        if (saved === orig) saved = null;
      });
    } catch (e) { warn('falha ao devolver o editor à qualidade normal', e); }
  }
  async function withQuality(opts, fn) {
    if (!opts.maxQuality) return fn();
    const st = await boostQuality();
    try { return await fn(); } finally { restoreQuality(st); }
  }

  // ------------------------------------------------------------------ luz do editor -> HDRI (.hdr, Radiance)
  // Decodifica o mapa de ambiente do editor (lat-long RGBD com mipmaps empacotados, como no shader do site),
  // aplica cor/intensidade/saturação da luz e acrescenta o sol (luz direcional) como um disco de 2,5°.
  // Orientação do Blender, no referencial do modelo exportado: importe o modelo e use o .hdr no World sem girar.
  function buildHdr() {
    const CK = editor(), L = CK.environment && CK.environment.lighting, el = L && L.envLight;
    if (!el || !el.map) throw new Error('mapa de ambiente do editor não encontrado.');
    const { renderer, gl } = glOf(CK);
    const env = readTexture(el.map, renderer, gl, new Map());
    if (!env) throw new Error('não consegui ler o mapa de ambiente do editor.');
    const reg = el.mapRegion ? [el.mapRegion.x, el.mapRegion.y, el.mapRegion.z, el.mapRegion.w] : [0, 0, 1, 1];
    const c = el.color || { r: 1, g: 1, b: 1 }, k = typeof el.intensity === 'number' ? el.intensity : 1;
    const scale = [c.r * k, c.g * k, c.b * k], sat = typeof el.saturationScale === 'number' ? el.saturationScale : 1;
    const rc = Math.cos(-(el.rotateY || 0)), rs = Math.sin(-(el.rotateY || 0));
    const E = exportFrame(CK, { scale: 1, zUp: false }), Ei = M4.inv(E);
    const W = Math.max(512, Math.min(2048, 2 * (el.mapWidth || 512))), H = W / 2;
    const rgb = new Float32Array(W * H * 3), px = [0, 0, 0, 0];
    const dirOf = (x, r) => { // pixel -> direção no Blender -> direção no referencial do modelo (Y para cima)
      const u = (x + 0.5) / W, v = 1 - (r + 0.5) / H;
      const ph = (0.5 - u) * 2 * Math.PI, th = (v - 0.5) * Math.PI;
      const bx = Math.cos(th) * Math.cos(ph), by = Math.cos(th) * Math.sin(ph), bz = Math.sin(th);
      return [bx, bz, -by];
    };
    for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
      const g = dirOf(x, r);
      let wx = Ei[0] * g[0] + Ei[4] * g[1] + Ei[8] * g[2], wy = Ei[1] * g[0] + Ei[5] * g[1] + Ei[9] * g[2], wz = Ei[2] * g[0] + Ei[6] * g[1] + Ei[10] * g[2];
      const l = Math.hypot(wx, wy, wz) || 1; wx /= l; wy /= l; wz /= l;
      const rx = rc * wx + rs * wz, rz = -rs * wx + rc * wz; // RotateY(-rotateY) do shader
      const uh = 1 - (Math.atan2(rx, rz) + Math.PI) / (2 * Math.PI), vh = (Math.asin(Math.max(-1, Math.min(1, wy))) + Math.PI / 2) / Math.PI;
      bilinear(env, reg[0] + uh * reg[2], reg[1] + (vh * 0.5 + 0.5) * reg[3], px); // mip 0
      const dd = Math.max(px[3] / 255, 1 / 255), f = 128 / 255 / dd / 255;
      let R = px[0] * f * scale[0], G = px[1] * f * scale[1], B = px[2] * f * scale[2];
      const m = (R + G + B) / 3;
      R = m + (R - m) * sat; G = m + (G - m) * sat; B = m + (B - m) * sat;
      const o = (r * W + x) * 3;
      rgb[o] = Math.max(0, R); rgb[o + 1] = Math.max(0, G); rgb[o + 2] = Math.max(0, B);
    }
    const sun = L.sunlight;
    if (sun && sun.intensity > 0 && sun.visible !== false) {
      sun.updateMatrixWorld && sun.updateMatrixWorld(true);
      const p = sun.matrixWorld ? sun.matrixWorld.elements : null, t = sun.target && sun.target.matrixWorld ? sun.target.matrixWorld.elements : null;
      let dx = p ? p[12] - (t ? t[12] : 0) : 1, dy = p ? p[13] - (t ? t[13] : 0) : 1, dz = p ? p[14] - (t ? t[14] : 0) : 1;
      let gx = E[0] * dx + E[4] * dy + E[8] * dz, gy = E[1] * dx + E[5] * dy + E[9] * dz, gz = E[2] * dx + E[6] * dy + E[10] * dz;
      const l = Math.hypot(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
      const cosR = Math.cos(2.5 * Math.PI / 180), hit = [];
      let omega = 0;
      for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
        const g = dirOf(x, r);
        if (g[0] * gx + g[1] * gy + g[2] * gz < cosR) continue;
        const th = (0.5 - (r + 0.5) / H) * Math.PI;
        const om = (2 * Math.PI / W) * (Math.PI / H) * Math.cos(th);
        omega += om; hit.push(r * W + x);
      }
      const sc = sun.color || { r: 1, g: 1, b: 1 }, Es = sun.intensity * Math.PI; // three.js (luz não física): irradiância = cor * intensidade * PI
      if (omega > 0) for (const i of hit) { rgb[i * 3] += sc.r * Es / omega; rgb[i * 3 + 1] += sc.g * Es / omega; rgb[i * 3 + 2] += sc.b * Es / omega; }
    }
    // Radiance RGBE com RLE "sem repetições" (blocos literais), aceito por Blender, Godot, stb_image etc.
    const head = new TextEncoder().encode(`#?RADIANCE\n# Herosaver ${VERSION}: luz do editor do Hero Forge\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`);
    const line = new Uint8Array(W * 4), chunks = [head];
    for (let r = 0; r < H; r++) {
      for (let x = 0; x < W; x++) {
        const o = (r * W + x) * 3, R = rgb[o], G = rgb[o + 1], B = rgb[o + 2], m = Math.max(R, G, B);
        if (m < 1e-32) { line[x] = line[W + x] = line[2 * W + x] = line[3 * W + x] = 0; continue; }
        let e = Math.floor(Math.log2(m)) + 1, f = m / Math.pow(2, e);
        if (f >= 1) { f /= 2; e++; } else if (f < 0.5) { f *= 2; e--; }
        const s = 256 / Math.pow(2, e);
        line[x] = Math.min(255, R * s); line[W + x] = Math.min(255, G * s); line[2 * W + x] = Math.min(255, B * s); line[3 * W + x] = e + 128;
      }
      const enc = [2, 2, W >> 8, W & 255];
      for (let ch = 0; ch < 4; ch++) for (let x = 0; x < W; x += 128) {
        const n = Math.min(128, W - x);
        enc.push(n);
        for (let q = 0; q < n; q++) enc.push(line[ch * W + x + q]);
      }
      chunks.push(Uint8Array.from(enc));
    }
    return { name: characterName(), data: new Blob(chunks, { type: 'image/vnd.radiance' }), w: W, h: H };
  }

  // ------------------------------------------------------------------ API pública
  const defaults = { scale: 10, base: true, noPrint: false, textures: true, vertexColors: true, normals: true, zUp: false, maxQuality: true, aoInColor: true, sunInColor: false };
  const withDefaults = (o, extra) => Object.assign({}, defaults, extra || {}, typeof o === 'object' && o ? o : {});

  async function run(label, fn) {
    try { return await fn(); } catch (e) {
      console.error(TAG, e);
      const shown = !!panelStatus;
      toast('erro: ' + (e && e.message || e));
      if (!shown) try { alert('Herosaver: ' + (e && e.message || e)); } catch (_) { /* */ }
      throw e;
    }
  }

  window.saveObj = opts => run('obj', async () => {
    const o = withDefaults(opts);
    const t0 = performance.now();
    const res = await withQuality(o, () => buildObjFiles(o));
    toast('compactando…', true); await nextFrame();
    const zip = await makeZip(res.files);
    download(zip, `${res.name}.zip`);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    toast(`pronto: ${res.name}.zip (${(zip.size / 1048576).toFixed(1)} MB, ${res.model.triCount} triângulos, ${secs}s)`);
    log('arquivos:', res.files.map(f => f.name).join(', '));
    return { name: res.name, files: res.files.length, triangles: res.model.triCount, bytes: zip.size };
  });

  window.saveStl = opts => run('stl', async () => {
    const o = withDefaults(opts, { zUp: true });
    toast('calculando a pose…', true); await nextFrame();
    const data = buildStl(o);
    const name = characterName();
    download(new Blob([data], { type: 'model/stl' }), `${name}.stl`);
    toast(`pronto: ${name}.stl (${((data.length - 84) / 50) | 0} triângulos)`);
    return { name, bytes: data.length };
  });

  // GLB estático por padrão; saveGlb({ rig: true }) inclui o esqueleto simplificado e a animação idle.
  window.saveGlb = opts => run('glb', async () => {
    const o = withDefaults(opts, glbDefaults);
    const t0 = performance.now();
    const res = await withQuality(o, () => buildGlb(o));
    const file = `${res.name}${res.rig ? '_rig' : ''}.glb`;
    download(new Blob([res.glb], { type: 'model/gltf-binary' }), file);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    toast(`pronto: ${file} (${(res.glb.length / 1048576).toFixed(1)} MB, ${res.triCount} triângulos${res.rig ? `, ${res.rig.joints.length} articulações` : ''}, ${secs}s)`);
    return { name: res.name, bytes: res.glb.length, joints: res.rig ? res.rig.joints.length : 0, triangles: res.triCount };
  });

  window.saveHdr = () => run('hdr', async () => {
    toast('lendo a luz do editor…', true); await nextFrame();
    const res = buildHdr();
    download(res.data, `${res.name}_luz_editor.hdr`);
    toast(`pronto: ${res.name}_luz_editor.hdr (${res.w}×${res.h})`);
    return { name: res.name, bytes: res.data.size };
  });

  window.saveJson = () => run('json', async () => {
    const CK = editor();
    const name = characterName();
    download(new Blob([JSON.stringify(CK.data.getJson())], { type: 'application/json' }), `${name}.json`);
    return { name };
  });

  // ------------------------------------------------------------------ painel de opções (aberto pelo bookmarklet)
  const STORE = 'herosaver2.options';
  const PANEL_ID = 'herosaver2-panel';
  const loadPrefs = () => {
    const d = { format: 'obj', base: true, textures: true, vertexColors: true, normals: true, zUp: false, noPrint: false, units: 'mm', maxQuality: true, aoInColor: true, sunInColor: false };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { return d; }
  };
  const savePrefs = p => { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch (e) { /* */ } };

  const PANEL_CSS = `
    :host { all: initial; }
    .p { position: fixed; top: 64px; right: 18px; z-index: 2147483647; width: 292px; box-sizing: border-box;
         background: #1c1c1c; color: #eee; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         border: 1px solid #3a3a3a; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.55); overflow: hidden; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #262626; border-bottom: 1px solid #333; }
    header b { font-size: 14px; flex: 1; }
    header small { color: #999; font-weight: normal; }
    button.x { all: unset; cursor: pointer; color: #aaa; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px; }
    button.x:hover { background: #3a3a3a; color: #fff; }
    .body { padding: 10px 12px 12px; display: grid; gap: 10px; }
    .name { color: #bbb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .name strong { color: #fff; }
    .seg { display: grid; grid-template-columns: repeat(4, 1fr); background: #111; border-radius: 7px; padding: 3px; gap: 3px; }
    .seg label { text-align: center; padding: 6px 0; border-radius: 5px; cursor: pointer; color: #bbb; white-space: nowrap; font-size: 12px; }
    .note { color: #999; font-size: 12px; }
    .sec { all: unset; box-sizing: border-box; width: 100%; text-align: center; cursor: pointer; padding: 7px 0; border-radius: 7px;
           background: #2a2a2a; color: #ddd; font-size: 12px; border: 1px solid #3a3a3a; }
    .sec:hover { background: #333; color: #fff; }
    .sec[disabled] { color: #777; cursor: progress; }
    [hidden] { display: none !important; }
    .seg input { display: none; }
    .seg label:has(input:checked) { background: #3c3c3c; color: #fff; }
    fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; }
    fieldset[disabled] { opacity: .4; }
    .row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .row input { margin: 0; accent-color: #3fa53f; width: 15px; height: 15px; }
    .row span small { color: #888; }
    select { background: #111; color: #eee; border: 1px solid #3a3a3a; border-radius: 6px; padding: 5px 6px; font: inherit; width: 100%; }
    .go { all: unset; box-sizing: border-box; width: 100%; text-align: center; cursor: pointer; padding: 9px 0; border-radius: 7px;
          background: #2f8f2f; color: #fff; font-weight: 600; font-size: 14px; }
    .go:hover { background: #37a337; }
    .go[disabled] { background: #3a3a3a; color: #999; cursor: progress; }
    .st { min-height: 18px; color: #ccc; font-size: 12px; }
    .st.err { color: #ff8a80; }
    .st.ok { color: #9be59b; }
    hr { border: 0; border-top: 1px solid #2e2e2e; margin: 0; }
  `;

  function openPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) { closePanel(); return; } // clicar de novo no bookmarklet fecha
    if (!window.CK || !window.CK.display) {
      alert('Herosaver: abra o editor em heroforge.com, espere o personagem carregar e clique de novo no favorito.');
      return;
    }
    const prefs = loadPrefs();
    const host = document.createElement('div');
    host.id = PANEL_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${PANEL_CSS}</style>
      <div class="p" role="dialog" aria-label="Herosaver">
        <header><b>Herosaver <small>v${VERSION}</small></b><button class="x" title="Fechar (Esc)">×</button></header>
        <div class="body">
          <div class="name">Personagem: <strong></strong></div>
          <div class="seg">
            <label title="Wavefront OBJ + MTL + texturas PBR, num .zip"><input type="radio" name="fmt" value="obj">OBJ</label>
            <label title="glTF binário: um arquivo com malha e materiais PBR"><input type="radio" name="fmt" value="glb">GLB</label>
            <label title="GLB com esqueleto simplificado e animação idle"><input type="radio" name="fmt" value="glbRig">GLB+rig</label>
            <label title="Só a geometria, para impressão"><input type="radio" name="fmt" value="stl">STL</label>
          </div>
          <fieldset class="common">
            <label class="row"><input type="checkbox" data-k="base"><span>Incluir a base</span></label>
            <label class="row" data-for="obj stl"><input type="checkbox" data-k="zUp"><span>Z para cima <small>(impressão / fatiador)</small></span></label>
            <label class="row"><input type="checkbox" data-k="noPrint"><span>Peças não imprimíveis <small>(efeitos etc.)</small></span></label>
          </fieldset>
          <fieldset class="look" data-for="obj glb glbRig">
            <label class="row"><input type="checkbox" data-k="maxQuality"><span>Qualidade máxima <small>(texturas UHD + oclusão 4K)</small></span></label>
            <label class="row"><input type="checkbox" data-k="aoInColor"><span>Oclusão na cor <small>(sombras de contato do editor)</small></span></label>
            <label class="row"><input type="checkbox" data-k="sunInColor"><span>Sombra do sol na cor</span></label>
          </fieldset>
          <fieldset class="objonly" data-for="obj">
            <label class="row"><input type="checkbox" data-k="textures"><span>Texturas <small>(cor, metal, rugosidade, normal)</small></span></label>
            <label class="row"><input type="checkbox" data-k="vertexColors"><span>Cor por vértice</span></label>
            <label class="row"><input type="checkbox" data-k="normals"><span>Normais suaves</span></label>
          </fieldset>
          <select class="units" title="Unidade" data-for="obj stl">
            <option value="mm">Milímetros (base de 25 mm)</option>
            <option value="cm">Centímetros (= unidades do Hero Forge)</option>
            <option value="in">Polegadas</option>
          </select>
          <div class="note" data-for="glb glbRig">Tamanho real da miniatura, em metros (Y para cima).</div>
          <hr>
          <button class="go">Exportar</button>
          <button class="sec hdr" title="Mapa de ambiente do editor + sol, em HDR, para o World do Blender ou o céu do Godot">Baixar a luz do editor (.hdr)</button>
          <div class="st" aria-live="polite"></div>
        </div>
      </div>`;
    const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    $('.name strong').textContent = (() => { try { return characterName(); } catch (e) { return '?'; } })();
    $$('input[name=fmt]').forEach(r => { r.checked = r.value === prefs.format; });
    $$('input[data-k]').forEach(c => { c.checked = !!prefs[c.dataset.k]; });
    $('.units').value = prefs.units;
    if (!$('input[name=fmt]:checked')) $('input[name=fmt][value=obj]').checked = true;
    const LABEL = { obj: 'Exportar OBJ (.zip)', glb: 'Exportar GLB', glbRig: 'Exportar GLB com rig', stl: 'Exportar STL' };
    const sync = () => {
      prefs.format = $('input[name=fmt]:checked').value;
      $$('input[data-k]').forEach(c => { prefs[c.dataset.k] = c.checked; });
      prefs.units = $('.units').value;
      $$('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(prefs.format); });
      $('.go').textContent = LABEL[prefs.format] || 'Exportar';
      savePrefs(prefs);
    };
    // STL costuma ir para o fatiador: ao trocar para STL liga Z para cima, ao voltar para OBJ desliga
    $$('input[name=fmt]').forEach(r => r.addEventListener('change', () => { $('input[data-k=zUp]').checked = r.value === 'stl'; sync(); }));
    root.addEventListener('change', sync);
    sync();
    const st = $('.st');
    panelStatus = (msg, sticky) => {
      st.textContent = msg;
      st.className = 'st' + (/^erro/.test(msg) ? ' err' : /^pronto/.test(msg) ? ' ok' : '');
      return true;
    };
    const go = $('.go'), hdr = $('.hdr');
    go.addEventListener('click', async () => {
      if (go.disabled) return;
      go.disabled = true; hdr.disabled = true;
      const scale = { mm: 10, cm: 1, in: 10 / 25.4 }[prefs.units] || 10;
      const look = { maxQuality: prefs.maxQuality, aoInColor: prefs.aoInColor, sunInColor: prefs.sunInColor };
      const opts = Object.assign({ scale, base: prefs.base, zUp: prefs.zUp, noPrint: prefs.noPrint, textures: prefs.textures, vertexColors: prefs.vertexColors, normals: prefs.normals }, look);
      const glbOpts = Object.assign({ base: prefs.base, noPrint: prefs.noPrint }, look);
      try {
        if (prefs.format === 'stl') await window.saveStl(opts);
        else if (prefs.format === 'glb') await window.saveGlb(glbOpts);
        else if (prefs.format === 'glbRig') await window.saveGlb(Object.assign({ rig: true }, glbOpts));
        else await window.saveObj(opts);
      } catch (e) { /* já mostrado */ }
      go.disabled = false; hdr.disabled = false;
    });
    hdr.addEventListener('click', async () => {
      if (hdr.disabled) return;
      hdr.disabled = true;
      try { await window.saveHdr(); } catch (e) { /* já mostrado */ }
      hdr.disabled = false;
    });
    $('.x').addEventListener('click', closePanel);
    host._onKey = e => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', host._onKey, true);
    document.body.appendChild(host);
    return host;
  }

  function closePanel() {
    const host = document.getElementById(PANEL_ID);
    if (!host) return;
    document.removeEventListener('keydown', host._onKey, true);
    host.remove();
    panelStatus = null;
  }

  window.Herosaver = {
    version: VERSION, open: openPanel, close: closePanel,
    // para depuração / testes
    buildObjFiles: o => buildObjFiles(withDefaults(o)), buildStl: o => buildStl(withDefaults(o, { zUp: true })), buildGlb: o => buildGlb(withDefaults(o, glbDefaults)), makeZip,
    buildHdr, boostQuality, restoreQuality, withQuality: (o, fn) => withQuality(withDefaults(o), fn),
  };
  log(`v${VERSION} carregado — Herosaver.open() abre o painel; ou use saveObj(), saveGlb(), saveStl(), saveHdr(), saveJson()`);
})();
