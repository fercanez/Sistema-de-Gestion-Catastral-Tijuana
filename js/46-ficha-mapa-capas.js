/* Controles compartidos de opacidad y orden (z-index) en mapas de fichas y popups */

const FICHA_MAPA_CAPAS_PANEL_CSS = `
.ficha-capas-overlay .layer-item,.popup-capas-overlay .layer-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px;margin:7px 0;}
.ficha-capas-overlay .layer-top,.popup-capas-overlay .layer-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}
.ficha-capas-overlay .layer-name,.popup-capas-overlay .layer-name{display:flex;align-items:center;gap:6px;font-size:12px;color:#1f2937;}
.ficha-capas-overlay .layer-name input,.popup-capas-overlay .layer-name input{width:auto!important;margin:0!important;}
.ficha-capas-overlay .layer-dot,.popup-capas-overlay .layer-dot{width:9px;height:9px;display:inline-block;border-radius:999px;}
.ficha-capas-overlay .dot-red,.popup-capas-overlay .dot-red{background:#ef4444;}
.ficha-capas-overlay .dot-green,.popup-capas-overlay .dot-green{background:#22c55e;}
.ficha-capas-overlay .dot-purple,.popup-capas-overlay .dot-purple{background:#8b5cf6;}
.ficha-capas-overlay .dot-orange,.popup-capas-overlay .dot-orange{background:#f59e0b;}
.ficha-capas-overlay .dot-amber,.popup-capas-overlay .dot-amber{background:#d97706;}
.ficha-capas-overlay .dot-blue,.popup-capas-overlay .dot-blue{background:#3b82f6;}
.ficha-capas-overlay .dot-cyan,.popup-capas-overlay .dot-cyan{background:#06b6d4;}
.ficha-capas-overlay .layer-percent,.popup-capas-overlay .layer-percent{font-size:11px;color:#64748b;font-weight:700;}
.ficha-capas-overlay .layer-item input[type=range],.popup-capas-overlay .layer-item input[type=range]{width:100%;margin:0 0 6px;}
.ficha-capas-overlay .layer-actions,.popup-capas-overlay .layer-actions{display:flex;gap:6px;}
.ficha-capas-overlay .layer-actions button,.popup-capas-overlay .layer-actions button{flex:1;border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:4px 6px;font-size:11px;cursor:pointer;}
.ficha-capas-overlay .layer-actions button:hover,.popup-capas-overlay .layer-actions button:hover{background:#f1f5f9;}
`;

function fichaMapaCapasLayerItemHtml(opts) {
  const {
    id,
    checkboxId,
    dotClass,
    label,
    checked = true,
    opacity = 100,
    opPrefix = "fichaOp",
    toggleFn = "toggleFichaMapaCapa",
    opacityFn = "cambiarOpacidadFichaMapaCapa",
    subirFn = "subirFichaMapaCapa",
    bajarFn = "bajarFichaMapaCapa"
  } = opts;
  const chk = checked ? "checked" : "";
  return `
    <div class="layer-item" data-layer-id="${id}">
      <div class="layer-top">
        <label class="layer-name">
          <input type="checkbox" id="${checkboxId}" ${chk} onchange="${toggleFn}('${id}')">
          <span class="layer-dot ${dotClass}"></span>
          <b>${label}</b>
        </label>
        <span id="${opPrefix}${id}Txt" class="layer-percent">${opacity}%</span>
      </div>
      <input type="range" min="0" max="100" value="${opacity}" id="${opPrefix}${id}"
        oninput="${opacityFn}('${id}', this.value)">
      <div class="layer-actions">
        <button type="button" onclick="${subirFn}('${id}')">↑ Subir</button>
        <button type="button" onclick="${bajarFn}('${id}')">↓ Bajar</button>
      </div>
    </div>`;
}

function fichaMapaCapasItemsHtml(items, defaults) {
  const base = Object.assign({
    opPrefix: "fichaOp",
    toggleFn: "toggleFichaMapaCapa",
    opacityFn: "cambiarOpacidadFichaMapaCapa",
    subirFn: "subirFichaMapaCapa",
    bajarFn: "bajarFichaMapaCapa"
  }, defaults || {});
  return (items || []).map(item => fichaMapaCapasLayerItemHtml(Object.assign({}, base, item))).join("");
}

function buildFichaMapaCapasRuntimeScript(cfg) {
  const ordenDef = JSON.stringify(cfg.ordenDef || {});
  const capaProp = JSON.stringify(cfg.capaProp || {});
  const chkMap = JSON.stringify(cfg.chkMap || {});
  const optionalIds = JSON.stringify(cfg.optionalIds || []);
  const linkedZIds = JSON.stringify(cfg.linkedZIndexIds || []);
  const capasVar = cfg.capasVar || "window.__fichaMapCapas";
  const mapVar = cfg.mapVar || "previewMap";
  const overlayListId = cfg.overlayListId || "fichaCapasOverlayList";
  const opPrefix = cfg.opPrefix || "fichaOp";
  const toggleFn = cfg.toggleFn || "toggleFichaMapaCapa";
  const opacityFn = cfg.opacityFn || "cambiarOpacidadFichaMapaCapa";
  const subirFn = cfg.subirFn || "subirFichaMapaCapa";
  const bajarFn = cfg.bajarFn || "bajarFichaMapaCapa";
  const initFn = cfg.initFn || "inicializarOrdenCapasFichaMapa";

  return `
  const fichaCapaOrdenDef=${ordenDef};
  let fichaCapaOrdenEstado=Object.assign({},fichaCapaOrdenDef);
  const fichaCapaProp=${capaProp};
  const fichaCapaChkMap=${chkMap};
  const fichaCapaOptionalIds=${optionalIds};
  const fichaCapaLinkedZIds=${linkedZIds};

  function obtenerCapaFichaMapa(id){
    const c=${capasVar};
    if(!c)return null;
    const k=fichaCapaProp[id];
    return k?c[k]:null;
  }

  function sincronizarZIndexEnlazado(id){
    if(!fichaCapaLinkedZIds.length)return;
    if(fichaCapaLinkedZIds.indexOf(id)<0)return;
    const z=fichaCapaOrdenEstado[id]||0;
    fichaCapaLinkedZIds.forEach(function(lid){fichaCapaOrdenEstado[lid]=z;});
  }

  function aplicarZIndexFichaMapaCapa(id){
    const capa=obtenerCapaFichaMapa(id);
    if(capa&&typeof capa.setZIndex==="function"){
      capa.setZIndex(fichaCapaOrdenEstado[id]??5);
    }
  }

  function actualizarOrdenVisualFichaMapaCapas(){
    const cont=document.getElementById("${overlayListId}");
    if(!cont)return;
    Array.from(cont.querySelectorAll(".layer-item"))
      .sort(function(a,b){
        const za=fichaCapaOrdenEstado[a.dataset.layerId]||0;
        const zb=fichaCapaOrdenEstado[b.dataset.layerId]||0;
        return zb-za;
      })
      .forEach(function(item){cont.appendChild(item);});
  }

  function ${initFn}(){
    Object.keys(fichaCapaProp).forEach(function(id){
      const capa=obtenerCapaFichaMapa(id);
      if(capa){
        capa.set("layerId",id);
        aplicarZIndexFichaMapaCapa(id);
      }
    });
    actualizarOrdenVisualFichaMapaCapas();
  }

  function ${opacityFn}(id,valor){
    const opacidad=Number(valor)/100;
    const txt=document.getElementById("${opPrefix}"+id+"Txt");
    if(txt)txt.innerText=valor+"%";
    const capa=obtenerCapaFichaMapa(id);
    if(capa&&typeof capa.setOpacity==="function")capa.setOpacity(opacidad);
    if(fichaCapaLinkedZIds.indexOf(id)>=0){
      fichaCapaLinkedZIds.forEach(function(lid){
        if(lid===id)return;
        const otra=obtenerCapaFichaMapa(lid);
        if(otra&&typeof otra.setOpacity==="function")otra.setOpacity(opacidad);
        const t=document.getElementById("${opPrefix}"+lid+"Txt");
        const r=document.getElementById("${opPrefix}"+lid);
        if(t)t.innerText=valor+"%";
        if(r)r.value=valor;
      });
    }
    ${mapVar}&&${mapVar}.render();
  }

  function ${subirFn}(id){
    fichaCapaOrdenEstado[id]=(fichaCapaOrdenEstado[id]||0)+10;
    sincronizarZIndexEnlazado(id);
    aplicarZIndexFichaMapaCapa(id);
    if(fichaCapaLinkedZIds.indexOf(id)>=0){
      fichaCapaLinkedZIds.forEach(function(lid){
        if(lid!==id)aplicarZIndexFichaMapaCapa(lid);
      });
    }
    actualizarOrdenVisualFichaMapaCapas();
    ${mapVar}&&${mapVar}.render();
  }

  function ${bajarFn}(id){
    fichaCapaOrdenEstado[id]=(fichaCapaOrdenEstado[id]||0)-10;
    sincronizarZIndexEnlazado(id);
    aplicarZIndexFichaMapaCapa(id);
    if(fichaCapaLinkedZIds.indexOf(id)>=0){
      fichaCapaLinkedZIds.forEach(function(lid){
        if(lid!==id)aplicarZIndexFichaMapaCapa(lid);
      });
    }
    actualizarOrdenVisualFichaMapaCapas();
    ${mapVar}&&${mapVar}.render();
  }

  function ${toggleFn}(id){
    const capa=obtenerCapaFichaMapa(id);
    const chkId=fichaCapaChkMap[id];
    if(!chkId)return;
    const esOpcional=fichaCapaOptionalIds.indexOf(id)>=0;
    const visible=esOpcional
      ?document.getElementById(chkId)?.checked===true
      :document.getElementById(chkId)?.checked!==false;
    if(capa)capa.setVisible(visible);
    ${mapVar}&&${mapVar}.render();
  }
  `;
}

function crearFichaMapaCapasManager(opts) {
  const ordenDef = Object.assign({}, opts.ordenDef || {});
  let ordenEstado = Object.assign({}, ordenDef);
  const capaProp = opts.capaProp || {};
  const chkMap = opts.chkMap || {};
  const optionalIds = opts.optionalIds || [];
  const linkedCapaIds = opts.linkedCapaIds || [];
  const getCapas = opts.getCapas || (() => null);
  const getMap = opts.getMap || (() => null);
  const overlayListId = opts.overlayListId || "";
  const opPrefix = opts.opPrefix || "fichaOp";

  function idsEnlazados(id) {
    if (!linkedCapaIds.length || linkedCapaIds.indexOf(id) < 0) return [id];
    return linkedCapaIds.slice();
  }

  function obtenerCapa(id) {
    const capas = getCapas();
    if (!capas) return null;
    const key = capaProp[id];
    return key ? capas[key] : null;
  }

  function sincronizarEnlace(id, campo) {
    if (!linkedCapaIds.length || linkedCapaIds.indexOf(id) < 0) return;
    const val = campo === "z" ? ordenEstado[id] : null;
    linkedCapaIds.forEach(lid => {
      if (campo === "z") ordenEstado[lid] = val;
    });
  }

  function aplicarZIndex(id) {
    idsEnlazados(id).forEach(lid => {
      const capa = obtenerCapa(lid);
      if (capa && typeof capa.setZIndex === "function") {
        capa.setZIndex(ordenEstado[id] ?? ordenEstado[lid] ?? 5);
      }
    });
  }

  function actualizarOrdenVisual() {
    const cont = document.getElementById(overlayListId);
    if (!cont) return;
    Array.from(cont.querySelectorAll(".layer-item"))
      .sort((a, b) => {
        const za = ordenEstado[a.dataset.layerId] || 0;
        const zb = ordenEstado[b.dataset.layerId] || 0;
        return zb - za;
      })
      .forEach(item => cont.appendChild(item));
  }

  function inicializar() {
    Object.keys(capaProp).forEach(id => {
      const capa = obtenerCapa(id);
      if (capa) {
        capa.set("layerId", id);
        aplicarZIndex(id);
      }
    });
    actualizarOrdenVisual();
  }

  function cambiarOpacidad(id, valor) {
    const opacidad = Number(valor) / 100;
    idsEnlazados(id).forEach(lid => {
      const txt = document.getElementById(`${opPrefix}${lid}Txt`);
      if (txt) txt.innerText = `${valor}%`;
      const rng = document.getElementById(`${opPrefix}${lid}`);
      if (rng && lid !== id) rng.value = valor;
      const capa = obtenerCapa(lid);
      if (capa && typeof capa.setOpacity === "function") capa.setOpacity(opacidad);
    });
    getMap()?.render();
  }

  function subir(id) {
    ordenEstado[id] = (ordenEstado[id] || 0) + 10;
    sincronizarEnlace(id, "z");
    aplicarZIndex(id);
    actualizarOrdenVisual();
    getMap()?.render();
  }

  function bajar(id) {
    ordenEstado[id] = (ordenEstado[id] || 0) - 10;
    sincronizarEnlace(id, "z");
    aplicarZIndex(id);
    actualizarOrdenVisual();
    getMap()?.render();
  }

  function toggle(id) {
    const capa = obtenerCapa(id);
    const chkId = chkMap[id];
    if (!chkId) return;
    const esOpcional = optionalIds.indexOf(id) >= 0;
    const visible = esOpcional
      ? document.getElementById(chkId)?.checked === true
      : document.getElementById(chkId)?.checked !== false;
    if (capa) capa.setVisible(visible);
    getMap()?.render();
  }

  function reset() {
    ordenEstado = Object.assign({}, ordenDef);
  }

  return {
    ordenDef,
    ordenEstado,
    obtenerCapa,
    aplicarZIndex,
    actualizarOrdenVisual,
    inicializar,
    cambiarOpacidad,
    subir,
    bajar,
    toggle,
    reset
  };
}

function htmlPopupMapaCapasMenu(cfg) {
  const {
    menuId,
    overlayListId,
    menuClass = "popup-carta-capas-menu",
    title = "Capas del plano",
    closeFn = "cerrarPopupMapaCapasMenu",
    itemsHtml = "",
    basemapHtml = ""
  } = cfg;
  return `
    <div class="popup-capas-menu ${menuClass}" id="${menuId}" onclick="event.stopPropagation()">
      <div class="popup-capas-menu-head">
        <strong>${title}</strong>
        <button type="button" class="popup-capas-cerrar" onclick="${closeFn}('${menuId}')" title="Ocultar capas">−</button>
      </div>
      <div class="popup-capas-seccion popup-capas-overlay" id="${overlayListId}">
        ${itemsHtml}
      </div>
      ${basemapHtml}
    </div>`;
}

function togglePopupMapaCapasMenu(menuId, ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  document.getElementById(menuId)?.classList.toggle("popup-carta-capas-visible");
}

function cerrarPopupMapaCapasMenu(menuId) {
  document.getElementById(menuId)?.classList.remove("popup-carta-capas-visible");
}

function htmlFichaPreviewLayerPanel(panelId, innerHtml, extraClass) {
  const cls = extraClass ? ` ${extraClass}` : "";
  return `<div id="${panelId}" class="ficha-preview-layer-panel oculto${cls}">${innerHtml}</div>`;
}

function htmlFichaPreviewBasemapRadios(name, onchangeFn, options) {
  const opts = options || [
    ["googleHybrid", "Google Hybrid", true],
    ["googleRoad", "Google Road", false],
    ["esri", "ESRI Satellite", false],
    ["osm", "OpenStreetMap", false]
  ];
  return `<div class="grupo ficha-preview-basemap">
    <strong>Base mapas</strong>
    ${opts.map(([val, label, checked]) =>
      `<label><input type="radio" name="${name}" value="${val}"${checked ? " checked" : ""} onchange="${onchangeFn}()"> ${label}</label>`
    ).join("")}
  </div>`;
}

const FICHA_PREVIEW_LAYER_PANEL_CSS = `
.ficha-preview-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(220px,1fr);gap:10px;font-size:12px;}
.ficha-preview-layer-panel.oculto{display:none!important;}
.ficha-preview-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.ficha-preview-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
`;
