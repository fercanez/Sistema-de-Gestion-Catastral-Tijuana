/* Colonia / Fraccionamiento — ubicación del predio respecto al límite de colonia */

const POPUP_COLONIA_GEONODE_WMS = typeof POPUP_NUMOF_GEONODE_WMS !== "undefined"
  ? POPUP_NUMOF_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const POPUP_COLONIA_CATASTRO_WMS = typeof POPUP_NUMOF_CATASTRO_WMS !== "undefined"
  ? POPUP_NUMOF_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const POPUP_COLONIA_WMS_LAYER = "colonias";
const POPUP_COLONIA_WMS_LAYERS = ["colonias", "geonode:colonias"];

let popupColoniaMap = null;
let popupColoniaCapas = null;
let popupColoniaCapasManager = null;
let popupColoniaClaveActual = "";
let popupColoniaDatos = null;

const POPUP_COLONIA_CAPA_ORDEN_DEF = {
  predio: 35,
  colonia: 22,
  prediosWms: 8,
  coloniasWms: 6
};

const POPUP_COLONIA_CAPA_PROP = {
  predio: "predioVector",
  colonia: "coloniaVector",
  prediosWms: "prediosWms",
  coloniasWms: "coloniasWms"
};

function popupColoniaEsc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function popupColoniaVal(valor) {
  if (valor == null || valor === "") return "—";
  return String(valor);
}

function popupColoniaEstiloPredio() {
  return [
    new ol.style.Style({
      zIndex: 40,
      stroke: new ol.style.Stroke({
        color: "rgba(255, 255, 255, 0.98)",
        width: 8
      }),
      fill: new ol.style.Fill({ color: "rgba(30, 64, 175, 0.58)" })
    }),
    new ol.style.Style({
      zIndex: 41,
      stroke: new ol.style.Stroke({
        color: "#1e3a8a",
        width: 4
      }),
      fill: new ol.style.Fill({ color: "rgba(37, 99, 235, 0.52)" })
    })
  ];
}

function popupColoniaEstiloColonia() {
  return [
    new ol.style.Style({
      zIndex: 18,
      stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.85)", width: 5 })
    }),
    new ol.style.Style({
      zIndex: 19,
      stroke: new ol.style.Stroke({ color: "#7c3aed", width: 3 }),
      fill: new ol.style.Fill({ color: "rgba(124, 58, 237, 0.14)" })
    })
  ];
}

function popupColoniaCrearCapas() {
  return {
    googleHybrid: new ol.layer.Tile({
      visible: true,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        crossOrigin: "anonymous"
      })
    }),
    googleRoad: new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
        crossOrigin: "anonymous"
      })
    }),
    esri: new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        crossOrigin: "anonymous"
      })
    }),
    osm: new ol.layer.Tile({
      visible: false,
      source: new ol.source.OSM()
    }),
    coloniasWms: new ol.layer.Tile({
      visible: true,
      opacity: 0.72,
      zIndex: POPUP_COLONIA_CAPA_ORDEN_DEF.coloniasWms,
      source: new ol.source.TileWMS({
        url: POPUP_COLONIA_GEONODE_WMS,
        params: {
          LAYERS: POPUP_COLONIA_WMS_LAYER,
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    prediosWms: new ol.layer.Tile({
      visible: false,
      opacity: 0.45,
      zIndex: POPUP_COLONIA_CAPA_ORDEN_DEF.prediosWms,
      source: new ol.source.TileWMS({
        url: POPUP_COLONIA_CATASTRO_WMS,
        params: {
          LAYERS: "catastro_bc:predios_oficial",
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    coloniaVector: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_COLONIA_CAPA_ORDEN_DEF.colonia,
      source: new ol.source.Vector(),
      style: popupColoniaEstiloColonia()
    }),
    predioVector: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_COLONIA_CAPA_ORDEN_DEF.predio,
      source: new ol.source.Vector(),
      style: popupColoniaEstiloPredio()
    })
  };
}

function popupColoniaAsegurarCanvasMapa() {
  const target = document.getElementById("popupColoniaMap");
  if (!target) return null;
  target.querySelector(".popup-mini-map-vacio")?.remove();
  let canvas = document.getElementById("popupColoniaMapCanvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.id = "popupColoniaMapCanvas";
    canvas.className = "popup-colonia-mapa-canvas";
    target.appendChild(canvas);
  }
  return canvas;
}

function htmlMenuCapasPopupColonia() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "popupColoniaChkPredio", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "colonia", checkboxId: "popupColoniaChkColonia", dotClass: "dot-purple", label: "Límite de colonia", checked: true, opacity: 100 },
        { id: "coloniasWms", checkboxId: "popupColoniaChkColoniasWms", dotClass: "dot-green", label: "Colonias (WMS)", checked: true, opacity: 72 },
        { id: "prediosWms", checkboxId: "popupColoniaChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: false, opacity: 45 }
      ], {
        opPrefix: "popupColoniaOp",
        toggleFn: "togglePopupColoniaCapa",
        opacityFn: "popupColoniaCambiarOpacidadCapa",
        subirFn: "popupColoniaSubirCapa",
        bajarFn: "popupColoniaBajarCapa"
      })
    : "";

  const basemap = `<div class="popup-capas-seccion">
        <strong>Base mapas</strong>
        <label><input type="radio" name="popupColoniaBaseMap" value="googleHybrid" checked onchange="setPopupColoniaBaseLayer(this.value)"> Google Hybrid</label>
        <label><input type="radio" name="popupColoniaBaseMap" value="googleRoad" onchange="setPopupColoniaBaseLayer(this.value)"> Google Road</label>
        <label><input type="radio" name="popupColoniaBaseMap" value="esri" onchange="setPopupColoniaBaseLayer(this.value)"> ESRI Satellite</label>
        <label><input type="radio" name="popupColoniaBaseMap" value="osm" onchange="setPopupColoniaBaseLayer(this.value)"> OpenStreetMap</label>
      </div>`;

  return typeof htmlPopupMapaCapasMenu === "function"
    ? htmlPopupMapaCapasMenu({
        menuId: "popupColoniaCapasMenu",
        overlayListId: "popupColoniaCapasOverlayList",
        menuClass: "popup-carta-capas-menu popup-colonia-capas-menu",
        itemsHtml: capas,
        basemapHtml: basemap
      })
    : "";
}

function popupColoniaInicializarCapasManager() {
  if (typeof crearFichaMapaCapasManager !== "function") return;
  popupColoniaCapasManager = crearFichaMapaCapasManager({
    ordenDef: POPUP_COLONIA_CAPA_ORDEN_DEF,
    capaProp: POPUP_COLONIA_CAPA_PROP,
    chkMap: {
      predio: "popupColoniaChkPredio",
      colonia: "popupColoniaChkColonia",
      coloniasWms: "popupColoniaChkColoniasWms",
      prediosWms: "popupColoniaChkPrediosWms"
    },
    optionalIds: ["prediosWms"],
    getCapas: () => popupColoniaCapas,
    getMap: () => popupColoniaMap,
    overlayListId: "popupColoniaCapasOverlayList",
    opPrefix: "popupColoniaOp"
  });
  popupColoniaCapasManager.inicializar();
}

function popupColoniaCambiarOpacidadCapa(id, valor) {
  popupColoniaCapasManager?.cambiarOpacidad(id, valor);
}

function popupColoniaSubirCapa(id) {
  popupColoniaCapasManager?.subir(id);
}

function popupColoniaBajarCapa(id) {
  popupColoniaCapasManager?.bajar(id);
}

function togglePopupColoniaCapasMenu(ev) {
  togglePopupMapaCapasMenu("popupColoniaCapasMenu", ev);
}

function togglePopupColoniaCapa(tipo) {
  popupColoniaCapasManager?.toggle(tipo);
}

function setPopupColoniaBaseLayer(valor) {
  if (!popupColoniaCapas) return;
  ["googleHybrid", "googleRoad", "esri", "osm"].forEach(function(id) {
    if (popupColoniaCapas[id]) popupColoniaCapas[id].setVisible(id === valor);
  });
  popupColoniaMap?.render();
}

function popupColoniaCentrarMapa() {
  if (!popupColoniaMap || !popupColoniaCapas) return;
  const ext = ol.extent.createEmpty();
  [popupColoniaCapas.coloniaVector, popupColoniaCapas.predioVector].forEach(function(layer) {
    ol.extent.extend(ext, layer.getSource().getExtent());
  });
  if (!Number.isFinite(ext[0])) {
    const data = popupColoniaDatos;
    if (data?.centroide?.lon != null && data?.centroide?.lat != null) {
      popupColoniaMap.updateSize();
      popupColoniaMap.getView().setCenter(
        ol.proj.fromLonLat([data.centroide.lon, data.centroide.lat])
      );
      popupColoniaMap.getView().setZoom(16);
    }
    return;
  }
  popupColoniaMap.updateSize();
  popupColoniaMap.getView().fit(ext, { padding: [48, 48, 48, 48], maxZoom: 17, duration: 280 });
}

function popupColoniaNormalizarAtributos(props) {
  if (!props) return {};
  const claves = {};
  Object.keys(props).forEach(function(k) {
    claves[String(k).toLowerCase()] = k;
  });
  function tomar() {
    const candidatos = Array.prototype.slice.call(arguments);
    for (let i = 0; i < candidatos.length; i++) {
      const cand = String(candidatos[i]).toLowerCase();
      for (const kl in claves) {
        if (kl.indexOf(cand) >= 0) {
          const val = props[claves[kl]];
          if (val != null && String(val).trim() !== "" && String(val).toUpperCase() !== "NULL") {
            return String(val).trim();
          }
        }
      }
    }
    return "";
  }
  return {
    nombre: tomar("nombre", "nombre_colonia", "colonia", "nom_colonia", "descripcion", "desc"),
    tipo: tomar("tipo", "clasific", "categoria", "clase"),
    fraccionamiento: tomar("fraccion", "fraccionamiento", "frac"),
    delegacion: tomar("delegacion", "municipio"),
    observaciones: tomar("observ", "nota", "coment"),
    codigo: tomar("codigo", "clave", "id_colonia", "cve_colonia")
  };
}

async function popupColoniaWmsGetFeatureInfo(lon, lat, layers) {
  if (lon == null || lat == null || Number.isNaN(Number(lon)) || Number.isNaN(Number(lat))) {
    return null;
  }
  const delta = 0.00045;
  const bbox = (lon - delta) + "," + (lat - delta) + "," + (lon + delta) + "," + (lat + delta);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetFeatureInfo",
      LAYERS: layer,
      QUERY_LAYERS: layer,
      STYLES: "",
      BBOX: bbox,
      WIDTH: "101",
      HEIGHT: "101",
      X: "50",
      Y: "50",
      SRS: "EPSG:4326",
      INFO_FORMAT: "application/json",
      FEATURE_COUNT: "5"
    });
    try {
      const r = await fetch(POPUP_COLONIA_GEONODE_WMS + "?" + params.toString(), { cache: "no-store" });
      if (!r.ok) continue;
      const data = await r.json();
      const features = data.features || [];
      if (!features.length) continue;
      const props = features[0].properties || {};
      return {
        origen: "wms",
        layer: layer,
        properties: props,
        geometry: features[0].geometry || null,
        atributos: popupColoniaNormalizarAtributos(props)
      };
    } catch (e) {
      console.warn("Colonia WMS:", layer, e);
    }
  }
  return null;
}

function popupColoniaCentroideDesdeGeometry(geometry) {
  if (!geometry || typeof ol === "undefined") return { lon: null, lat: null };
  try {
    const format = new ol.format.GeoJSON({
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    const geom = format.readFeature({ type: "Feature", geometry }).getGeometry();
    if (!geom) return { lon: null, lat: null };
    const center = ol.extent.getCenter(geom.getExtent());
    const lonLat = ol.proj.toLonLat(center);
    return { lon: lonLat[0], lat: lonLat[1] };
  } catch (e) {
    return { lon: null, lat: null };
  }
}

async function popupColoniaEnriquecerDatos(data, p) {
  if (!data) return data;
  const centro = data.centroide || popupColoniaCentroideDesdeGeometry(data.geometry);
  if (!data.colonia_carto && centro.lon != null && centro.lat != null) {
    try {
      const hit = await popupColoniaWmsGetFeatureInfo(centro.lon, centro.lat, POPUP_COLONIA_WMS_LAYERS);
      if (hit) data.colonia_carto = hit;
    } catch (e) {
      console.warn("Colonia: WMS fallback:", e);
    }
  }
  if (data.colonia_carto?.properties) {
    const attrs = popupColoniaNormalizarAtributos(data.colonia_carto.properties);
    data.colonia_carto.atributos = Object.assign({}, attrs, data.colonia_carto.atributos || {});
  }
  if (!data.centroide && centro.lon != null) data.centroide = centro;
  if (!data.colonia && p?.colonia) data.colonia = String(p.colonia).trim();
  if (!data.delegacion && p?.delegacion) data.delegacion = String(p.delegacion).trim();
  return data;
}

async function cargarColoniaFraccionamientoFallback(claveNorm, p) {
  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  let geometry = null;
  let colonia = String(p?.colonia || "").trim();
  let delegacion = String(p?.delegacion || "").trim();
  let calle = String(p?.calle || "").trim();
  let numof = String(p?.numof || "").trim();
  let usoPadron = String(p?.descripcion_uso || "").trim();

  const geoUrls = [
    `${API}/predios/${encodeURIComponent(claveNorm)}/geojson?_=${Date.now()}`,
    `${API}/geo/predios/${encodeURIComponent(claveNorm)}?_=${Date.now()}`
  ];

  for (let i = 0; i < geoUrls.length; i++) {
    try {
      const r = await fetch(geoUrls[i], { headers, cache: "no-store" });
      if (!r.ok) continue;
      const geo = await r.json();
      geometry = geo?.geometry || geo?.features?.[0]?.geometry || null;
      if (geometry) break;
    } catch (e) {}
  }

  if (!geometry) {
    throw new Error("Sin geometría cartográfica del predio.");
  }

  const centro = popupColoniaCentroideDesdeGeometry(geometry);
  let coloniaCarto = null;
  if (centro.lon != null && centro.lat != null) {
    coloniaCarto = await popupColoniaWmsGetFeatureInfo(centro.lon, centro.lat, POPUP_COLONIA_WMS_LAYERS);
  }

  return {
    clave_catastral: claveNorm,
    uso_padron: usoPadron,
    colonia: colonia,
    delegacion: delegacion,
    calle: calle,
    numof: numof,
    centroide: centro,
    geometry: geometry,
    colonia_carto: coloniaCarto,
    wms_url: POPUP_COLONIA_GEONODE_WMS,
    wms_layer: POPUP_COLONIA_WMS_LAYER,
    mensaje: coloniaCarto ? "" : "No se detectó intersección con la capa de colonias (WMS)."
  };
}

async function cargarColoniaFraccionamiento(clave, p) {
  const claveNorm = String(clave || p?.clave_catastral || "").trim().toUpperCase();
  if (!claveNorm) throw new Error("Clave catastral requerida.");

  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  const urls = [
    `${API}/padron/${encodeURIComponent(claveNorm)}/colonia-fraccionamiento?_=${Date.now()}`,
    `${API}/predios/${encodeURIComponent(claveNorm)}/colonia-fraccionamiento?_=${Date.now()}`
  ];

  let ultimoError = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await fetch(urls[i], { headers, cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        return popupColoniaEnriquecerDatos(data, p);
      }
      const err = await r.json().catch(function() { return {}; });
      const detail = String(err.detail || err.message || "").trim();
      if (r.status === 404 && (detail === "Not Found" || detail === "Not found")) {
        return cargarColoniaFraccionamientoFallback(claveNorm, p);
      }
      throw new Error(detail || ("HTTP " + r.status));
    } catch (e) {
      ultimoError = e;
    }
  }
  try {
    const data = await cargarColoniaFraccionamientoFallback(claveNorm, p);
    return popupColoniaEnriquecerDatos(data, p);
  } catch (e) {
    throw ultimoError || e || new Error("No se pudo consultar colonia/fraccionamiento.");
  }
}

function popupColoniaHtmlCampo(label, valor, destacado) {
  const cls = destacado ? " popup-colonia-campo-destacado" : "";
  return `<div class="popup-colonia-campo${cls}">
    <span class="popup-colonia-label">${popupColoniaEsc(label)}</span>
    <strong class="popup-colonia-valor">${popupColoniaEsc(popupColoniaVal(valor))}</strong>
  </div>`;
}

function popupColoniaHtmlCampoNombre(valor) {
  return `<div class="popup-colonia-campo popup-colonia-campo-nombre">
    <span class="popup-colonia-label">Colonia cartográfica</span>
    <strong class="popup-colonia-valor popup-colonia-valor-nombre">${popupColoniaEsc(popupColoniaVal(valor))}</strong>
  </div>`;
}

function popupColoniaResumenTexto(data) {
  const attrs = data?.colonia_carto?.atributos || {};
  const nombre = attrs.nombre || data?.colonia || "";
  if (nombre) return "Colonia: " + nombre;
  return data?.mensaje || "Consultando capa geonode:colonias…";
}

function popupColoniaHtmlAtributos(data, p) {
  const attrs = data?.colonia_carto?.atributos || {};
  const origen = data?.colonia_carto?.origen || "";
  const capa = data?.colonia_carto?.tabla || data?.colonia_carto?.layer || data?.wms_layer || "—";
  const nombreCarto = attrs.nombre || popupColoniaVal(
    Object.values(data?.colonia_carto?.properties || {}).find(function(v) {
      return v != null && String(v).trim() !== "";
    })
  );

  let html = `
    <section class="popup-colonia-seccion">
      <h4>Predio consultado</h4>
      ${popupColoniaHtmlCampo("Clave catastral", data?.clave_catastral)}
      ${popupColoniaHtmlCampo("Colonia (padrón)", data?.colonia || p?.colonia)}
      ${popupColoniaHtmlCampo("Calle y número", [data?.calle || p?.calle, data?.numof || p?.numof].filter(Boolean).join(" ") || "—")}
      ${popupColoniaHtmlCampo("Delegación", data?.delegacion || p?.delegacion)}
      ${popupColoniaHtmlCampo("Uso en padrón", data?.uso_padron || p?.descripcion_uso)}
    </section>
    <section class="popup-colonia-seccion popup-colonia-seccion-carto">
      <h4>Colonia / fraccionamiento (cartografía)</h4>`;

  if (data?.colonia_carto) {
    html += popupColoniaHtmlCampoNombre(nombreCarto !== "—" ? nombreCarto : data?.colonia);
    html += popupColoniaHtmlCampo("Tipo / clasificación", attrs.tipo);
    html += popupColoniaHtmlCampo("Fraccionamiento", attrs.fraccionamiento);
    html += popupColoniaHtmlCampo("Delegación (capa)", attrs.delegacion);
    html += popupColoniaHtmlCampo("Código / clave", attrs.codigo);
    html += popupColoniaHtmlCampo("Observaciones", attrs.observaciones);
    html += popupColoniaHtmlCampo("Fuente", origen === "geonode" ? `GeoNode · ${capa}` : `WMS · ${capa}`);
  } else {
    html += `<div class="popup-colonia-aviso">${popupColoniaEsc(data?.mensaje || "Sin polígono de colonia intersectado para este predio.")}</div>`;
    html += `<div class="popup-colonia-meta">Capa WMS: ${popupColoniaEsc(data?.wms_layer || POPUP_COLONIA_WMS_LAYER)}</div>`;
  }

  html += `</section>`;
  return html;
}

function popupColoniaActualizarMapa(data) {
  const target = document.getElementById("popupColoniaMap");
  if (!target || !data?.geometry) {
    if (target) {
      target.querySelector("#popupColoniaMapCanvas")?.remove();
      let vacio = target.querySelector(".popup-mini-map-vacio");
      if (!vacio) {
        vacio = document.createElement("div");
        vacio.className = "popup-mini-map-vacio";
        target.appendChild(vacio);
      }
      vacio.textContent = "Sin geometría cartográfica del predio.";
    }
    return;
  }

  if (!popupColoniaMap) {
    popupColoniaAsegurarCanvasMapa();
    popupColoniaCapas = popupColoniaCrearCapas();
    popupColoniaMap = new ol.Map({
      target: "popupColoniaMapCanvas",
      layers: [
        popupColoniaCapas.googleHybrid,
        popupColoniaCapas.googleRoad,
        popupColoniaCapas.esri,
        popupColoniaCapas.osm,
        popupColoniaCapas.coloniasWms,
        popupColoniaCapas.prediosWms,
        popupColoniaCapas.coloniaVector,
        popupColoniaCapas.predioVector
      ],
      view: new ol.View({ center: ol.proj.fromLonLat([-115.468, 32.624]), zoom: 15 }),
      controls: []
    });
    popupColoniaInicializarCapasManager();
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });

  popupColoniaCapas.predioVector.getSource().clear();
  popupColoniaCapas.coloniaVector.getSource().clear();

  const predioFeats = format.readFeatures({
    type: "Feature",
    geometry: data.geometry,
    properties: { clave_catastral: data.clave_catastral, es_consultado: true }
  });
  popupColoniaCapas.predioVector.getSource().addFeatures(predioFeats);

  const coloniaGeom = data?.colonia_carto?.geometry;
  if (coloniaGeom) {
    try {
      const coloniaFeats = format.readFeatures({
        type: "Feature",
        geometry: coloniaGeom,
        properties: data.colonia_carto?.atributos || {}
      });
      popupColoniaCapas.coloniaVector.getSource().addFeatures(coloniaFeats);
    } catch (e) {
      console.warn("Colonia: no se pudo dibujar polígono:", e);
    }
  }

  popupColoniaCentrarMapa();
  setTimeout(function() {
    popupColoniaMap?.updateSize();
    popupColoniaMap?.render();
  }, 120);
  const btnImp = document.getElementById("popupColoniaBtnImprimir");
  if (btnImp) {
    btnImp.disabled = false;
    btnImp.textContent = "Imprimir / PDF";
  }
}

function popupColoniaCapturarMapaDataUrl(timeoutMs) {
  if (typeof popupNumofCapturarMapaInstancia === "function") {
    return popupNumofCapturarMapaInstancia(popupColoniaMap, timeoutMs || 8000);
  }
  return Promise.resolve(null);
}

function popupColoniaImprimirPlano() {
  if (typeof abrirPreviewFichaColonia === "function") {
    abrirPreviewFichaColonia();
    return;
  }
  alert("No se pudo abrir la vista previa de la ficha de ubicación.");
}

function destruirPopupColonia() {
  cerrarPopupMapaCapasMenu("popupColoniaCapasMenu");
  if (popupColoniaMap) {
    popupColoniaMap.setTarget(null);
    popupColoniaMap = null;
  }
  popupColoniaCapas = null;
  popupColoniaCapasManager = null;
  popupColoniaClaveActual = "";
  popupColoniaDatos = null;
}

async function pintarPopupTabColonia(p) {
  const panel = document.getElementById("popupTabColonia");
  if (!panel) return;

  const claveNorm = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  destruirPopupColonia();
  popupColoniaClaveActual = claveNorm;

  panel.innerHTML = `
    <div class="popup-colonia-layout">
      <div class="popup-colonia-panel-izq" id="popupColoniaPanelIzq">
        <div class="popup-colonia-cargando">Consultando colonia / fraccionamiento…</div>
      </div>
      <div class="popup-colonia-mapa-panel">
        <div class="popup-colonia-mapa-head">
          <div class="popup-colonia-mapa-head-text">
            <strong>Plano de ubicación en colonia</strong>
            <span id="popupColoniaResumenMapa">Cargando capa geonode:colonias…</span>
          </div>
          <div class="popup-colonia-mapa-head-actions">
            <button type="button" class="popup-btn-imprimir-ficha popup-btn-colonia-ficha" id="popupColoniaBtnImprimir" disabled onclick="popupColoniaImprimirPlano()">Cargando mapa…</button>
            <button type="button" class="popup-btn-capas" id="popupColoniaBtnCapas">Capas</button>
          </div>
        </div>
        <div class="popup-colonia-mapa-body">
          <div id="popupColoniaMap" class="popup-colonia-mapa">
            <div class="popup-mini-map-vacio">Cargando mapa…</div>
          </div>
          ${htmlMenuCapasPopupColonia()}
        </div>
        <div class="popup-colonia-leyenda">
          <span><i class="popup-colonia-swatch popup-colonia-swatch-predio"></i> Predio consultado</span>
          <span><i class="popup-colonia-swatch popup-colonia-swatch-colonia"></i> Límite de colonia</span>
          <span><i class="popup-colonia-swatch popup-colonia-swatch-wms"></i> Colonias (WMS)</span>
        </div>
      </div>
    </div>`;

  document.getElementById("popupColoniaBtnCapas")?.addEventListener("click", function(e) {
    togglePopupColoniaCapasMenu(e);
  });

  if (!claveNorm) {
    const izq = document.getElementById("popupColoniaPanelIzq");
    if (izq) izq.innerHTML = `<div class="popup-colonia-aviso">Sin clave catastral.</div>`;
    return;
  }

  try {
    const data = await cargarColoniaFraccionamiento(claveNorm, p);
    if (popupColoniaClaveActual !== claveNorm) return;
    popupColoniaDatos = data;

    const izq = document.getElementById("popupColoniaPanelIzq");
    if (izq) izq.innerHTML = popupColoniaHtmlAtributos(data, p);

    const resumen = document.getElementById("popupColoniaResumenMapa");
    if (resumen) resumen.textContent = popupColoniaResumenTexto(data);

    popupColoniaActualizarMapa(data);
  } catch (e) {
    const izq = document.getElementById("popupColoniaPanelIzq");
    if (izq) {
      izq.innerHTML = `<div class="popup-colonia-aviso">${popupColoniaEsc(e.message || "Error al consultar colonia.")}</div>`;
    }
    const resumen = document.getElementById("popupColoniaResumenMapa");
    if (resumen) resumen.textContent = "Error en la consulta.";
  }
}

window.pintarPopupTabColonia = pintarPopupTabColonia;
window.destruirPopupColonia = destruirPopupColonia;
window.cargarColoniaFraccionamiento = cargarColoniaFraccionamiento;
window.popupColoniaCapturarMapaDataUrl = popupColoniaCapturarMapaDataUrl;
window.popupColoniaImprimirPlano = popupColoniaImprimirPlano;
window.togglePopupColoniaCapasMenu = togglePopupColoniaCapasMenu;
window.togglePopupColoniaCapa = togglePopupColoniaCapa;
window.popupColoniaCambiarOpacidadCapa = popupColoniaCambiarOpacidadCapa;
window.popupColoniaSubirCapa = popupColoniaSubirCapa;
window.popupColoniaBajarCapa = popupColoniaBajarCapa;
window.setPopupColoniaBaseLayer = setPopupColoniaBaseLayer;
window.popupColoniaNormalizarAtributos = popupColoniaNormalizarAtributos;
