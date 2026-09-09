import * as THREE from 'three';
import { CONFIG, componentInfo, componentKeywordFallback } from './config.js';

// ============================================================
// components.js：零件点击说明 / 高亮 / 查看内部（外壳半透明）
// - 只读 GLB，不改模型；材质状态 изменя前先保存
// ============================================================

export function resolveComponent(object3D) {
  // 沿父链向上找第一个可识别的部件（点击子 Mesh 也能归属到翻斗组）
  let o = object3D;
  while (o) {
    if (o.name && componentInfo[o.name]) {
      return { key: o.name, object: o, ...componentInfo[o.name] };
    }
    o = o.parent;
  }
  // 关键字兜底
  o = object3D;
  while (o) {
    const n = o.name || '';
    if (n && !n.startsWith('__')) {
      for (const [kw, mappedKey] of componentKeywordFallback) {
        if (n.includes(kw) && componentInfo[mappedKey]) {
          return { key: mappedKey, object: o, ...componentInfo[mappedKey] };
        }
      }
    }
    o = o.parent;
  }
  return null;
}

export function createPicker(viewer) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let highlighted = []; // [{mesh, origEmissive, origEmissiveIntensity}]
  let downPos = null;
  let downTime = 0;

  function clearHighlight() {
    for (const h of highlighted) {
      if (h.mesh.material && h.mesh.material.emissive) {
        h.mesh.material.emissive.copy(h.origEmissive);
        h.mesh.material.emissiveIntensity = h.origEmissiveIntensity;
      }
    }
    highlighted = [];
  }

  function highlight(object3D) {
    clearHighlight();
    // 高亮该部件组下所有 Mesh（翻斗左右两半一起亮），但排除水体/雨滴
    const targets = [];
    object3D.traverse ? object3D.traverse((o) => {
      if (o.isMesh && !o.name.startsWith('Water_') && !o.name.startsWith('Rain_')) targets.push(o);
    }) : targets.push(object3D);
    const list = targets.length ? targets : [object3D];
    for (const m of list.slice(0, 24)) {
      const mat = m.material;
      if (mat && mat.emissive) {
        highlighted.push({
          mesh: m,
          origEmissive: mat.emissive.clone(),
          origEmissiveIntensity: mat.emissiveIntensity ?? 1
        });
        mat.emissive.setHex(0x2f7fd0);
        mat.emissiveIntensity = 0.28; // 轻微提亮，不破坏原色
      }
    }
  }

  function pick(clientX, clientY) {
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewer.camera);
    const hits = raycaster.intersectObjects(viewer.scene.children, true);
    for (const h of hits) {
      let o = h.object;
      // 跳过地面阴影盘与水体/雨滴辅助
      if (o.name === '__ground__') continue;
      if (/^(Water_|Rain_)/.test(o.name)) continue;
      return { object: o, point: h.point };
    }
    return null;
  }

  // 区分“点击”与“拖动旋转”：按下抬起位移 < 8px 且 < 400ms 才算点击
  function bind(onTap) {
    const el = viewer.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      downPos = [e.clientX, e.clientY];
      downTime = performance.now();
    });
    el.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const dx = e.clientX - downPos[0];
      const dy = e.clientY - downPos[1];
      const dt = performance.now() - downTime;
      downPos = null;
      if (Math.hypot(dx, dy) < 8 && dt < 400) onTap(e.clientX, e.clientY);
    });
  }

  return { pick, bind, highlight, clearHighlight, resolveComponent };
}

// ---- 查看内部：只处理 shellObjectNames，外壳 正常→半透明→恢复 ----
export function createShellToggle(viewer) {
  let active = false;
  const saved = []; // [{mesh, transparent, opacity, depthWrite}]

  function findShellMeshes() {
    const out = [];
    viewer.scene.traverse((o) => {
      if (o.isMesh && CONFIG.shellObjectNames.includes(o.name)) out.push(o);
    });
    return out;
  }

  function setTransparent(meshes, opacity) {
    for (const m of meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat || !('opacity' in mat)) continue;
        saved.push({ mat, transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite });
        mat.transparent = true;
        mat.opacity = opacity;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      }
    }
  }

  function restore() {
    for (const s of saved) {
      s.mat.transparent = s.transparent;
      s.mat.opacity = s.opacity;
      s.mat.depthWrite = s.depthWrite;
      s.mat.needsUpdate = true;
    }
    saved.length = 0;
  }

  return {
    get active() { return active; },
    toggle() {
      if (!active) {
        const meshes = findShellMeshes();
        if (!meshes.length) return { ok: false, reason: '未在 GLB 中找到可识别的外壳对象' };
        setTransparent(meshes, CONFIG.shellOpacity);
        active = true;
        return { ok: true, active: true, count: meshes.length };
      }
      restore();
      active = false;
      return { ok: true, active: false };
    }
  };
}

export function componentCenter(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}
