/*!
 * Herosaver 2 — exporta o personagem atual do Hero Forge como OBJ (com MTL, texturas PBR
 * e cores por vértice, tudo num .zip) ou STL.
 *
 * Funciona com o editor atual do Hero Forge (engine própria "RenderKit/CreationKit").
 * Ideia original: notnullgames/Herosaver (MIT). Esta versão foi reescrita do zero porque
 * o site mudou: o OBJExporter do three.js não reconhece mais a geometria do site
 * (saía um .obj vazio) e o skinning antigo não existe mais.
 *
 * Uso (no console ou via bookmarklet), com a página do Hero Forge aberta:
 *   Herosaver.open()          -> painel com as opções (é o que o bookmarklet faz)
 *   saveObj()                 -> <Nome>.zip com .obj + .mtl + texturas
 *   saveObj({ textures: false, vertexColors: true })
 *   saveStl()                 -> <Nome>.stl (binário, Z para cima, milímetros)
 *   saveJson()                -> configuração do personagem (.json)
 *
 * Opções (saveObj / saveStl):
 *   scale         fator de escala (padrão 10 -> milímetros; 1 unidade do Hero Forge = 1 cm)
 *   base          incluir a base/peanha (padrão true)
 *   noPrint       incluir peças que o Hero Forge marca como "não imprimíveis" (padrão false)
 *   textures      (OBJ) exportar texturas de cor/rugosidade/metal/normal/emissão (padrão true)
 *   vertexColors  (OBJ) gravar a cor em cada vértice "v x y z r g b" (padrão true)
 *   normals       (OBJ) gravar normais suaves "vn" (padrão true)
 *   zUp           girar para Z para cima (padrão: false no OBJ, true no STL)
 */
(() => {
  'use strict';

  const VERSION = '2.0.0';
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
  function poseMesh(entry, E, gl) {
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
    return { key: entry.key, fin: entry.fin, mesh, n, pos: outP, nrm: outN, uv: A.uv ? dense(A.uv, 2) : null, tris, info, flipped: vote < 0 };
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
    const meshes = entries.map(e => poseMesh(e, E, gl));
    let nt = 0, nv = 0;
    for (const m of meshes) { nv += m.n; for (const t of m.tris) nt += t.idx.length / 3; }
    log(`pose calculada: ${meshes.length} malhas, ${nv} vértices, ${nt} triângulos`);
    return { CK, renderer, gl, meshes, triCount: nt };
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

  // Prepara um registro por material: região no atlas e as texturas de cor/física/emissão/normal.
  function collectMaterials(model) {
    const recs = new Map(), used = new Set();
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
      recs.set(mat, {
        name,
        region: r ? [r.x, r.y, r.z, r.w] : [0, 0, 1, 1],
        color: uniformTex(mat, 'colorAtlasMap'),
        phys: uniformTex(mat, 'physicalAtlasMap'),
        emis: uniformTex(mat, 'emissiveAtlasMap'),
        normal: uniformTex(mat, 'normalMap'),
        flipNormalMap: u.flipNormalMap ? +u.flipNormalMap.value : 0,
      });
    }
    return recs;
  }

  function sampleRegion(t, reg, u, v) { // amostra (nearest) no atlas como o shader: uv * zw + xy
    const x = Math.max(0, Math.min(t.w - 1, Math.floor((u * reg[2] + reg[0]) * t.w)));
    const y = Math.max(0, Math.min(t.h - 1, Math.floor((v * reg[3] + reg[1]) * t.h)));
    const o = (y * t.w + x) * 4;
    return [t.data[o], t.data[o + 1], t.data[o + 2], t.data[o + 3]];
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
    const mtl = [`# Herosaver ${VERSION} — ${name}`, ''];
    const normalFiles = new Map();
    let ti = 0;
    for (const rec of recs.values()) {
      ti++;
      if (ti % 4 === 0) { toast(`texturas ${ti}/${recs.size}…`, true); await nextFrame(); }
      const color = rd(rec.color), phys = rd(rec.phys), emis = rd(rec.emis);
      rec.colorPx = color;
      const lines = [`newmtl ${rec.name}`];
      let avg = [200, 200, 200];
      if (color) {
        const c = cropRegion(color, rec.region);
        let sr = 0, sg = 0, sb = 0, sn = 0;
        for (let i = 0; i < c.data.length; i += 4 * 7) { sr += c.data[i]; sg += c.data[i + 1]; sb += c.data[i + 2]; sn++; }
        if (sn) avg = [sr / sn, sg / sn, sb / sn];
        if (opts.textures) {
          const png = await toPng(mapPixels(c, (r, g, b, a, o) => { o[0] = r; o[1] = g; o[2] = b; o[3] = 255; }));
          files.push({ name: `textures/${rec.name}_color.png`, data: png });
        }
      }
      lines.push('Ka 0 0 0', opts.textures && color ? 'Kd 1 1 1' : `Kd ${c3(avg[0])} ${c3(avg[1])} ${c3(avg[2])}`, 'Ks 0.04 0.04 0.04', 'Ns 100', 'illum 2');
      if (opts.textures && color) lines.push(`map_Kd textures/${rec.name}_color.png`);
      if (phys) {
        const p = cropRegion(phys, rec.region);
        let rough = 0, metal = 0, cnt = 0, transparent = false;
        for (let i = 0; i < p.data.length; i += 4) {
          if (p.data[i + 3] === 0) continue; // texel fora da ilha UV
          rough += p.data[i]; metal += p.data[i + 1]; cnt++;
          if (p.data[i + 2] < 250) transparent = true;
        }
        rough = cnt ? rough / cnt / 255 : 0.8; metal = cnt ? metal / cnt / 255 : 0;
        if (opts.textures) {
          files.push({ name: `textures/${rec.name}_roughness.png`, data: await toPng(mapPixels(p, (r, g, b, a, o) => { o[0] = o[1] = o[2] = r; o[3] = 255; })) });
          files.push({ name: `textures/${rec.name}_metallic.png`, data: await toPng(mapPixels(p, (r, g, b, a, o) => { o[0] = o[1] = o[2] = g; o[3] = 255; })) });
          lines.push('Pr 1', `map_Pr textures/${rec.name}_roughness.png`, 'Pm 1', `map_Pm textures/${rec.name}_metallic.png`);
          if (transparent) {
            files.push({ name: `textures/${rec.name}_opacity.png`, data: await toPng(mapPixels(p, (r, g, b, a, o) => { o[0] = o[1] = o[2] = b; o[3] = 255; })) });
            lines.push('d 1', `map_d textures/${rec.name}_opacity.png`);
          }
        } else {
          lines.push(`Pr ${rough.toFixed(3)}`, `Pm ${metal.toFixed(3)}`);
        }
      }
      if (emis && opts.textures) {
        const e = cropRegion(emis, rec.region);
        let lit = false;
        for (let i = 0; i < e.data.length && !lit; i += 4) if (e.data[i] > 3 || e.data[i + 1] > 3 || e.data[i + 2] > 3) lit = true;
        if (lit) {
          files.push({ name: `textures/${rec.name}_emissive.png`, data: await toPng(mapPixels(e, (r, g, b, a, o) => { o[0] = r; o[1] = g; o[2] = b; o[3] = 255; })) });
          lines.push('Ke 1 1 1', `map_Ke textures/${rec.name}_emissive.png`);
        }
      }
      if (opts.textures && rec.normal) {
        let fname = normalFiles.get(rec.normal);
        if (fname === undefined) {
          fname = null;
          const nt = rd(rec.normal);
          if (nt && nt.w > 4 && nt.h > 4) {
            fname = `textures/${rec.name}_normal.png`;
            files.push({ name: fname, data: await toPng(convertNormalMap(flipRows(nt), rec.flipNormalMap)) });
          }
          normalFiles.set(rec.normal, fname);
        }
        if (fname) lines.push(`map_Bump -bm 1 ${fname}`, `norm ${fname}`);
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
        if (opts.vertexColors && m.uv && rec0 && rec0.colorPx) {
          const s = sampleRegion(rec0.colorPx, rec0.region, m.uv[i * 2], m.uv[i * 2 + 1]);
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

  // ------------------------------------------------------------------ API pública
  const defaults = { scale: 10, base: true, noPrint: false, textures: true, vertexColors: true, normals: true, zUp: false };
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
    const res = await buildObjFiles(o);
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
    const d = { format: 'obj', base: true, textures: true, vertexColors: true, normals: true, zUp: false, noPrint: false, units: 'mm' };
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
    .seg { display: grid; grid-template-columns: 1fr 1fr; background: #111; border-radius: 7px; padding: 3px; gap: 3px; }
    .seg label { text-align: center; padding: 6px 0; border-radius: 5px; cursor: pointer; color: #bbb; }
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
            <label><input type="radio" name="fmt" value="obj">OBJ + texturas</label>
            <label><input type="radio" name="fmt" value="stl">STL</label>
          </div>
          <fieldset class="common">
            <label class="row"><input type="checkbox" data-k="base"><span>Incluir a base</span></label>
            <label class="row"><input type="checkbox" data-k="zUp"><span>Z para cima <small>(impressão / fatiador)</small></span></label>
            <label class="row"><input type="checkbox" data-k="noPrint"><span>Peças não imprimíveis <small>(efeitos etc.)</small></span></label>
          </fieldset>
          <fieldset class="objonly">
            <label class="row"><input type="checkbox" data-k="textures"><span>Texturas <small>(cor, metal, rugosidade, normal)</small></span></label>
            <label class="row"><input type="checkbox" data-k="vertexColors"><span>Cor por vértice</span></label>
            <label class="row"><input type="checkbox" data-k="normals"><span>Normais suaves</span></label>
          </fieldset>
          <select class="units" title="Unidade">
            <option value="mm">Milímetros (base de 25 mm)</option>
            <option value="cm">Centímetros (= unidades do Hero Forge)</option>
            <option value="in">Polegadas</option>
          </select>
          <hr>
          <button class="go">Exportar</button>
          <div class="st" aria-live="polite"></div>
        </div>
      </div>`;
    const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    $('.name strong').textContent = (() => { try { return characterName(); } catch (e) { return '?'; } })();
    $$('input[name=fmt]').forEach(r => { r.checked = r.value === prefs.format; });
    $$('input[data-k]').forEach(c => { c.checked = !!prefs[c.dataset.k]; });
    $('.units').value = prefs.units;
    const sync = () => {
      prefs.format = $('input[name=fmt]:checked').value;
      $$('input[data-k]').forEach(c => { prefs[c.dataset.k] = c.checked; });
      prefs.units = $('.units').value;
      $('.objonly').disabled = prefs.format !== 'obj';
      $('.go').textContent = prefs.format === 'obj' ? 'Exportar OBJ (.zip)' : 'Exportar STL';
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
    const go = $('.go');
    go.addEventListener('click', async () => {
      if (go.disabled) return;
      go.disabled = true;
      const scale = { mm: 10, cm: 1, in: 10 / 25.4 }[prefs.units] || 10;
      const opts = { scale, base: prefs.base, zUp: prefs.zUp, noPrint: prefs.noPrint, textures: prefs.textures, vertexColors: prefs.vertexColors, normals: prefs.normals };
      try { await (prefs.format === 'stl' ? window.saveStl(opts) : window.saveObj(opts)); } catch (e) { /* já mostrado */ }
      go.disabled = false;
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
    buildObjFiles: o => buildObjFiles(withDefaults(o)), buildStl: o => buildStl(withDefaults(o, { zUp: true })), makeZip,
  };
  log(`v${VERSION} carregado — Herosaver.open() abre o painel; ou use saveObj(), saveStl(), saveJson()`);
})();
