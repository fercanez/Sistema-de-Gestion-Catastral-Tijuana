/* Carta Urbana 2040 — consulta de zonificación y plano en popup predio */

const POPUP_CARTA_GEONODE_WMS = typeof POPUP_NUMOF_GEONODE_WMS !== "undefined"
  ? POPUP_NUMOF_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const POPUP_CARTA_CATASTRO_WMS = typeof POPUP_NUMOF_CATASTRO_WMS !== "undefined"
  ? POPUP_NUMOF_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const POPUP_CARTA_WMS_LAYER = (window.CARTA_URBANA_2040_CONFIG?.wmsLayer) || "usos_prop_au40";
const POPUP_CARTA_SECTORES_LAYER = (window.CARTA_URBANA_2040_CONFIG?.sectoresLayer) || "sectores";
const POPUP_CARTA_SECTORES_LAYERS = (window.CARTA_URBANA_2040_CONFIG?.sectoresLayers) || [
  "sectores",
  "geonode:sectores"
];
const POPUP_CARTA_WMS_LAYERS = (window.CARTA_URBANA_2040_CONFIG?.wmsLayers) || [
  "usos_prop_au40",
  "geonode:usos_prop_au40"
];

let popupCartaMap = null;
let popupCartaCapas = null;
let popupCartaClaveActual = "";
let popupCartaDatos = null;

const POPUP_CARTA_CAPA_ORDEN_DEF = {
  predio: 35,
  sectores: 28,
  zona: 18,
  carta: 12,
  prediosWms: 8,
  colonias: 5
};
let popupCartaCapaOrdenEstado = { ...POPUP_CARTA_CAPA_ORDEN_DEF };

const POPUP_CARTA_CAPA_PROP = {
  predio: "predioVector",
  sectores: "sectoresWms",
  zona: "zonaVector",
  carta: "cartaWms",
  prediosWms: "prediosWms",
  colonias: "coloniasWms"
};

function popupCartaEsc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function popupCartaVal(valor) {
  if (valor == null || valor === "") return "—";
  return String(valor);
}

function popupCartaEstiloPredio() {
  return [
    new ol.style.Style({
      zIndex: 40,
      stroke: new ol.style.Stroke({
        color: "rgba(255,255,255,0.92)",
        width: 6,
        lineDash: [8, 6]
      })
    }),
    new ol.style.Style({
      zIndex: 41,
      stroke: new ol.style.Stroke({
        color: "#111827",
        width: 4,
        lineDash: [6, 5]
      })
    })
  ];
}

function popupCartaEstiloZona() {
  return new ol.style.Style({
    zIndex: 20,
    stroke: new ol.style.Stroke({ color: "#b45309", width: 2, lineDash: [6, 4] }),
    fill: new ol.style.Fill({ color: "rgba(245, 158, 11, 0.18)" })
  });
}

function popupCartaCrearCapas(wmsLayerName) {
  const layerName = String(wmsLayerName || POPUP_CARTA_WMS_LAYER).trim();
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
    cartaWms: new ol.layer.Tile({
      visible: true,
      opacity: 0.88,
      zIndex: 12,
      source: new ol.source.TileWMS({
        url: POPUP_CARTA_GEONODE_WMS,
        params: {
          LAYERS: layerName,
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    sectoresWms: new ol.layer.Tile({
      visible: true,
      opacity: 1,
      zIndex: POPUP_CARTA_CAPA_ORDEN_DEF.sectores,
      source: new ol.source.TileWMS({
        url: POPUP_CARTA_GEONODE_WMS,
        params: {
          LAYERS: POPUP_CARTA_SECTORES_LAYER,
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
      zIndex: 8,
      source: new ol.source.TileWMS({
        url: POPUP_CARTA_CATASTRO_WMS,
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
    coloniasWms: new ol.layer.Tile({
      visible: false,
      opacity: 0.45,
      zIndex: 5,
      source: new ol.source.TileWMS({
        url: POPUP_CARTA_GEONODE_WMS,
        params: {
          LAYERS: "colonias",
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    zonaVector: new ol.layer.Vector({
      visible: true,
      zIndex: 15,
      source: new ol.source.Vector(),
      style: popupCartaEstiloZona()
    }),
    predioVector: new ol.layer.Vector({
      visible: true,
      zIndex: 30,
      source: new ol.source.Vector(),
      style: popupCartaEstiloPredio()
    })
  };
}

function popupCartaAsegurarCanvasMapa() {
  const target = document.getElementById("popupCartaMap");
  if (!target) return null;
  target.querySelector(".popup-mini-map-vacio")?.remove();
  let canvas = document.getElementById("popupCartaMapCanvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.id = "popupCartaMapCanvas";
    canvas.className = "popup-carta-mapa-canvas";
    target.appendChild(canvas);
  }
  return canvas;
}

function popupCartaHtmlLayerItem(id, opts) {
  const { checkboxId, dotClass, label, checked, opacity } = opts;
  const chk = checked ? "checked" : "";
  const op = opacity == null ? 100 : opacity;
  return `
    <div class="layer-item popup-carta-layer-item" data-layer-id="${id}">
      <div class="layer-top">
        <label class="layer-name">
          <input type="checkbox" id="${checkboxId}" ${chk} onchange="togglePopupCartaCapa('${id}')">
          <span class="layer-dot ${dotClass}"></span>
          <b>${label}</b>
        </label>
        <span id="popupCartaOp${id}Txt" class="layer-percent">${op}%</span>
      </div>
      <input type="range" min="0" max="100" value="${op}" id="popupCartaOp${id}"
        oninput="popupCartaCambiarOpacidadCapa('${id}', this.value)">
      <div class="layer-actions">
        <button type="button" onclick="popupCartaSubirCapa('${id}')">↑ Subir</button>
        <button type="button" onclick="popupCartaBajarCapa('${id}')">↓ Bajar</button>
      </div>
    </div>`;
}

function htmlMenuCapasPopupCarta() {
  const capas = [
    popupCartaHtmlLayerItem("predio", {
      checkboxId: "popupCartaChkPredio",
      dotClass: "dot-amber",
      label: "Predio consultado",
      checked: true,
      opacity: 100
    }),
    popupCartaHtmlLayerItem("sectores", {
      checkboxId: "popupCartaChkSectores",
      dotClass: "dot-blue",
      label: "Sectores (WMS)",
      checked: true,
      opacity: 100
    }),
    popupCartaHtmlLayerItem("zona", {
      checkboxId: "popupCartaChkZona",
      dotClass: "dot-orange",
      label: "Polígono de zona",
      checked: true,
      opacity: 100
    }),
    popupCartaHtmlLayerItem("carta", {
      checkboxId: "popupCartaChkCarta",
      dotClass: "dot-green",
      label: "Usos propuestos 2040 (WMS)",
      checked: true,
      opacity: 88
    }),
    popupCartaHtmlLayerItem("prediosWms", {
      checkboxId: "popupCartaChkPrediosWms",
      dotClass: "dot-red",
      label: "Predios (WMS)",
      checked: false,
      opacity: 45
    }),
    popupCartaHtmlLayerItem("colonias", {
      checkboxId: "popupCartaChkColoniasWms",
      dotClass: "dot-purple",
      label: "Colonias",
      checked: false,
      opacity: 45
    })
  ].join("");

  return `
    <div class="popup-capas-menu popup-carta-capas-menu" id="popupCartaCapasMenu" onclick="event.stopPropagation()">
      <div class="popup-capas-menu-head">
        <strong>Capas del plano</strong>
        <button type="button" class="popup-capas-cerrar" onclick="cerrarPopupCartaCapasMenu()" title="Ocultar capas">−</button>
      </div>
      <div class="popup-capas-seccion popup-carta-capas-overlay" id="popupCartaCapasOverlayList">
        ${capas}
      </div>
      <div class="popup-capas-seccion">
        <strong>Base mapas</strong>
        <label><input type="radio" name="popupCartaBaseMap" value="googleHybrid" checked onchange="setPopupCartaBaseLayer(this.value)"> Google Hybrid</label>
        <label><input type="radio" name="popupCartaBaseMap" value="googleRoad" onchange="setPopupCartaBaseLayer(this.value)"> Google Road</label>
        <label><input type="radio" name="popupCartaBaseMap" value="esri" onchange="setPopupCartaBaseLayer(this.value)"> ESRI Satellite</label>
        <label><input type="radio" name="popupCartaBaseMap" value="osm" onchange="setPopupCartaBaseLayer(this.value)"> OpenStreetMap</label>
      </div>
    </div>`;
}

function popupCartaObtenerCapaPorId(id) {
  if (!popupCartaCapas) return null;
  const prop = POPUP_CARTA_CAPA_PROP[id];
  return prop ? popupCartaCapas[prop] : null;
}

function popupCartaAplicarZIndexCapa(id) {
  const capa = popupCartaObtenerCapaPorId(id);
  if (capa && typeof capa.setZIndex === "function") {
    capa.setZIndex(popupCartaCapaOrdenEstado[id] ?? 5);
  }
}

function popupCartaCambiarOpacidadCapa(id, valor) {
  const opacidad = Number(valor) / 100;
  const txt = document.getElementById(`popupCartaOp${id}Txt`);
  if (txt) txt.innerText = `${valor}%`;
  const capa = popupCartaObtenerCapaPorId(id);
  if (capa && typeof capa.setOpacity === "function") {
    capa.setOpacity(opacidad);
  }
  popupCartaMap?.render();
}

function popupCartaSubirCapa(id) {
  popupCartaCapaOrdenEstado[id] = (popupCartaCapaOrdenEstado[id] || 0) + 10;
  popupCartaAplicarZIndexCapa(id);
  popupCartaActualizarOrdenVisualCapas();
  popupCartaMap?.render();
}

function popupCartaBajarCapa(id) {
  popupCartaCapaOrdenEstado[id] = (popupCartaCapaOrdenEstado[id] || 0) - 10;
  popupCartaAplicarZIndexCapa(id);
  popupCartaActualizarOrdenVisualCapas();
  popupCartaMap?.render();
}

function popupCartaActualizarOrdenVisualCapas() {
  const contenedor = document.getElementById("popupCartaCapasOverlayList");
  if (!contenedor) return;
  const items = Array.from(contenedor.querySelectorAll(".layer-item"));
  items
    .sort((a, b) => {
      const za = popupCartaCapaOrdenEstado[a.dataset.layerId] || 0;
      const zb = popupCartaCapaOrdenEstado[b.dataset.layerId] || 0;
      return zb - za;
    })
    .forEach(item => contenedor.appendChild(item));
}

function popupCartaInicializarOrdenCapas() {
  Object.keys(POPUP_CARTA_CAPA_PROP).forEach(id => {
    const capa = popupCartaObtenerCapaPorId(id);
    if (capa) {
      capa.set("layerId", id);
      popupCartaAplicarZIndexCapa(id);
    }
  });
  popupCartaActualizarOrdenVisualCapas();
}

function cerrarPopupCartaCapasMenu() {
  document.getElementById("popupCartaCapasMenu")?.classList.remove("popup-carta-capas-visible");
}

function togglePopupCartaCapasMenu(ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const menu = document.getElementById("popupCartaCapasMenu");
  if (!menu) return;
  menu.classList.toggle("popup-carta-capas-visible");
}

function togglePopupCartaCapa(tipo) {
  if (!popupCartaCapas) return;
  const chkMap = {
    carta: "popupCartaChkCarta",
    sectores: "popupCartaChkSectores",
    predio: "popupCartaChkPredio",
    zona: "popupCartaChkZona",
    prediosWms: "popupCartaChkPrediosWms",
    colonias: "popupCartaChkColoniasWms"
  };
  const capa = popupCartaObtenerCapaPorId(tipo);
  if (!capa) return;
  const chkId = chkMap[tipo];
  const visible = tipo === "colonias" || tipo === "prediosWms"
    ? document.getElementById(chkId)?.checked === true
    : document.getElementById(chkId)?.checked !== false;
  capa.setVisible(visible);
  popupCartaMap?.render();
}

function setPopupCartaBaseLayer(valor) {
  if (!popupCartaCapas) return;
  popupCartaCapas.googleHybrid.setVisible(valor === "googleHybrid");
  popupCartaCapas.googleRoad.setVisible(valor === "googleRoad");
  popupCartaCapas.esri.setVisible(valor === "esri");
  popupCartaCapas.osm.setVisible(valor === "osm");
  popupCartaMap?.render();
}

function popupCartaZoomMas() {
  if (!popupCartaMap) return;
  const v = popupCartaMap.getView();
  v.setZoom((v.getZoom() || 17) + 1);
}

function popupCartaZoomMenos() {
  if (!popupCartaMap) return;
  const v = popupCartaMap.getView();
  v.setZoom((v.getZoom() || 17) - 1);
}

function popupCartaCentrarMapa() {
  if (!popupCartaMap || !popupCartaCapas) return;
  const ext = ol.extent.createEmpty();
  [popupCartaCapas.predioVector, popupCartaCapas.zonaVector].forEach(function(layer) {
    ol.extent.extend(ext, layer.getSource().getExtent());
  });
  if (!Number.isFinite(ext[0])) return;
  popupCartaMap.updateSize();
  popupCartaMap.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 18, duration: 280 });
}

function popupCartaCentroideDesdeGeometry(geometry) {
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

function popupCartaNormalizarAtributos(props) {
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
    zona: tomar("zona", "zonific", "clave_zona", "simbolo", "simbol", "clave", "codigo", "cod_uso"),
    uso_permitido: tomar("usoprop_40", "usoprop", "uso", "uso_suelo", "usos_prop", "prop_au40", "destino", "clasific", "descripcion", "desc_uso"),
    densidad: tomar("densidad", "hab_ha", "viviendas", "dens"),
    nivel: tomar("nivel", "altura", "plantas", "niveles"),
    instrumento: tomar("instrumento", "programa", "pdu", "plan", "carta", "au40"),
    observaciones: tomar("observ", "nota", "leyenda", "coment"),
    nombre_zona: tomar("nombre", "nom_zona", "desc_zona", "etiqueta", "desc", "descripcion")
  };
}

function popupCartaExtraerSector(props) {
  if (!props) return "";
  const claves = {};
  Object.keys(props).forEach(function(k) {
    claves[String(k).toLowerCase()] = k;
  });
  function tomar() {
    const candidatos = Array.prototype.slice.call(arguments);
    for (let i = 0; i < candidatos.length; i++) {
      const cand = String(candidatos[i]).toLowerCase();
      for (const kl in claves) {
        if (kl === cand || kl.indexOf(cand) >= 0) {
          const val = props[claves[kl]];
          if (val != null && String(val).trim() !== "" && String(val).toUpperCase() !== "NULL") {
            return String(val).trim();
          }
        }
      }
    }
    return "";
  }
  return tomar("sector", "sectores", "letra", "clave_sector", "simbolo", "simbol", "codigo", "cod_sector", "id_sector");
}

async function popupCartaWmsGetFeatureInfo(lon, lat, layers) {
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
      const r = await fetch(POPUP_CARTA_GEONODE_WMS + "?" + params.toString(), { cache: "no-store" });
      if (!r.ok) continue;
      const data = await r.json();
      const features = data.features || [];
      if (!features.length) continue;
      const props = features[0].properties || {};
      return {
        origen: "wms",
        layer: layer,
        properties: props,
        geometry: features[0].geometry || null
      };
    } catch (e) {
      console.warn("Carta urbana WMS:", layer, e);
    }
  }
  return null;
}

async function popupCartaConsultarSector(lon, lat) {
  const hit = await popupCartaWmsGetFeatureInfo(lon, lat, POPUP_CARTA_SECTORES_LAYERS);
  if (!hit) return null;
  const codigo = popupCartaExtraerSector(hit.properties);
  if (!codigo) return null;
  return {
    codigo: codigo,
    nombre: String(hit.properties?.nombre || hit.properties?.nom_sector || "").trim(),
    origen: hit.origen,
    layer: hit.layer,
    properties: hit.properties
  };
}

async function popupCartaConsultarWmsGetFeatureInfo(lon, lat) {
  const hit = await popupCartaWmsGetFeatureInfo(lon, lat, POPUP_CARTA_WMS_LAYERS);
  if (!hit) return null;
  return {
    origen: hit.origen,
    layer: hit.layer,
    properties: hit.properties,
    geometry: hit.geometry,
    atributos: popupCartaNormalizarAtributos(hit.properties)
  };
}

async function popupCartaEnriquecerDatos(data, p) {
  if (!data) return data;
  const centro = data.centroide || popupCartaCentroideDesdeGeometry(data.geometry);
  if (!data.sector?.codigo && centro.lon != null && centro.lat != null) {
    try {
      const sector = await popupCartaConsultarSector(centro.lon, centro.lat);
      if (sector) data.sector = sector;
    } catch (e) {
      console.warn("Carta urbana: sector WMS:", e);
    }
  }
  if (data.carta_urbana?.properties) {
    const attrs = popupCartaNormalizarAtributos(data.carta_urbana.properties);
    data.carta_urbana.atributos = Object.assign({}, attrs, data.carta_urbana.atributos || {});
  }
  if (!data.centroide && centro.lon != null) data.centroide = centro;
  return data;
}

async function cargarCartaUrbana2040Fallback(claveNorm, p) {
  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  let geometry = null;
  let usoPadron = String(p?.descripcion_uso || "").trim();
  let colonia = String(p?.colonia || "").trim();
  let delegacion = String(p?.delegacion || "").trim();

  const geoUrls = [
    `${API}/predios/${encodeURIComponent(claveNorm)}/geojson?_=${Date.now()}`,
    `${API}/padron/${encodeURIComponent(claveNorm)}/ficha?_=${Date.now()}`
  ];

  for (let i = 0; i < geoUrls.length; i++) {
    try {
      const r = await fetch(geoUrls[i], { cache: "no-store", headers });
      if (!r.ok) continue;
      const feat = await r.json();
      geometry = feat.geometry || feat.properties?.geometry || null;
      if (geometry) break;
    } catch (e) {}
  }

  if (!geometry) {
    throw new Error("Predio sin geometría cartográfica.");
  }

  const centro = popupCartaCentroideDesdeGeometry(geometry);
  const carta = await popupCartaConsultarWmsGetFeatureInfo(centro.lon, centro.lat);
  const sector = await popupCartaConsultarSector(centro.lon, centro.lat);

  return {
    clave_catastral: claveNorm,
    uso_padron: usoPadron,
    colonia: colonia,
    delegacion: delegacion,
    centroide: centro,
    geometry: geometry,
    carta_urbana: carta,
    sector: sector,
    wms_url: POPUP_CARTA_GEONODE_WMS,
    wms_layer: POPUP_CARTA_WMS_LAYER,
    wms_layers_intentadas: POPUP_CARTA_WMS_LAYERS,
    tablas_geonode_detectadas: ["usos_prop_au40"],
    mensaje: carta
      ? ""
      : "Sin atributos WMS en el centroide. El plano usos_prop_au40 sí debe verse en el mapa.",
    origen_respuesta: "fallback_cliente"
  };
}

async function cargarCartaUrbana2040(clave, p) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  const urls = [
    `${API}/padron/${encodeURIComponent(claveNorm)}/carta-urbana-2040?_=${Date.now()}`,
    `${API}/predios/${encodeURIComponent(claveNorm)}/carta-urbana-2040?_=${Date.now()}`
  ];
  let ultimoError = null;
  for (let u = 0; u < urls.length; u++) {
    try {
      const r = await fetch(urls[u], { cache: "no-store", headers });
      if (r.ok) {
        const data = await r.json();
        return popupCartaEnriquecerDatos(data, p);
      }
      const err = await r.json().catch(function() { return {}; });
      const detail = String(err.detail || err.message || "").trim();
      if (r.status === 404 && (detail === "Not Found" || detail === "Not found")) {
        return cargarCartaUrbana2040Fallback(claveNorm, p);
      }
      throw new Error(detail || ("HTTP " + r.status));
    } catch (e) {
      ultimoError = e;
    }
  }
  try {
    const data = await cargarCartaUrbana2040Fallback(claveNorm, p);
    return popupCartaEnriquecerDatos(data, p);
  } catch (e) {
    throw ultimoError || e || new Error("No se pudo consultar la carta urbana 2040.");
  }
}

function popupCartaHtmlCampo(label, valor, destacado) {
  const cls = destacado ? " popup-carta-campo-destacado" : "";
  return `<div class="popup-carta-campo${cls}">
    <span class="popup-carta-label">${popupCartaEsc(label)}</span>
    <strong class="popup-carta-valor">${popupCartaEsc(popupCartaVal(valor))}</strong>
  </div>`;
}

function popupCartaHtmlCampoSector(valor) {
  return `<div class="popup-carta-campo popup-carta-campo-sector">
    <span class="popup-carta-label">Sector</span>
    <strong class="popup-carta-valor popup-carta-valor-sector">${popupCartaEsc(popupCartaVal(valor))}</strong>
  </div>`;
}

function popupCartaResumenTexto(data) {
  const partes = [];
  if (data?.sector?.codigo) partes.push("Sector " + data.sector.codigo);
  const uso = data?.carta_urbana?.atributos?.uso_permitido;
  if (uso) partes.push(uso);
  if (partes.length) return partes.join(" · ");
  return data?.mensaje || "Consultando capas usos_prop_au40 y sectores…";
}

function popupCartaPropiedadesExtras(props, attrs) {
  if (!props) return "";
  const mostrados = new Set([
    "sector", "sectores", "usoprop_40", "usoprop", "uso", "descripcion", "nombre", "nom_sector"
  ]);
  Object.keys(attrs || {}).forEach(function(k) {
    const v = attrs[k];
    if (v) mostrados.add(String(k).toLowerCase());
  });
  let html = "";
  Object.keys(props).filter(function(k) {
    if (/^(gid|fid|geom|the_geom|shape_leng|shape_area)$/i.test(k)) return false;
    if (mostrados.has(String(k).toLowerCase())) return false;
    return String(props[k] ?? "").trim() !== "";
  }).slice(0, 4).forEach(function(k) {
    html += popupCartaHtmlCampo(k, props[k]);
  });
  return html;
}

function popupCartaHtmlAtributos(data, p) {
  const attrs = data?.carta_urbana?.atributos || {};
  const usoPadron = data?.uso_padron || p?.descripcion_uso || "";
  const origen = data?.carta_urbana?.origen || "";
  const capa = data?.carta_urbana?.tabla || data?.carta_urbana?.layer || data?.wms_layer || "—";
  const sectorCodigo = data?.sector?.codigo
    || popupCartaExtraerSector(data?.sector?.properties)
    || popupCartaExtraerSector(data?.carta_urbana?.properties)
    || "";

  let html = `
    <section class="popup-carta-seccion">
      <h4>Predio consultado</h4>
      ${popupCartaHtmlCampo("Clave catastral", data?.clave_catastral)}
      ${popupCartaHtmlCampo("Uso en padrón", usoPadron)}
      ${popupCartaHtmlCampo("Colonia", data?.colonia || p?.colonia)}
      ${popupCartaHtmlCampo("Delegación", data?.delegacion || p?.delegacion)}
    </section>
    <section class="popup-carta-seccion popup-carta-seccion-zona">
      <h4>Carta Urbana 2040</h4>
      ${popupCartaHtmlCampoSector(sectorCodigo)}`;

  if (data?.carta_urbana) {
    html += popupCartaHtmlCampo("Uso permitido (plan)", attrs.uso_permitido, true);
    html += popupCartaHtmlCampo("Zona / clave", attrs.zona || attrs.nombre_zona);
    html += popupCartaHtmlCampo("Nombre de zona", attrs.nombre_zona);
    html += popupCartaHtmlCampo("Densidad", attrs.densidad);
    html += popupCartaHtmlCampo("Nivel / altura", attrs.nivel);
    html += popupCartaHtmlCampo("Instrumento / plan", attrs.instrumento);
    html += popupCartaHtmlCampo("Observaciones", attrs.observaciones);
    html += popupCartaHtmlCampo("Fuente usos", origen === "geonode" ? `GeoNode · ${capa}` : `WMS · ${capa}`);
    if (data.sector?.layer || data.sector?.origen) {
      html += popupCartaHtmlCampo("Fuente sector", `WMS · ${data.sector.layer || POPUP_CARTA_SECTORES_LAYER}`);
    }
    html += popupCartaPropiedadesExtras(data.carta_urbana.properties, attrs);
  } else {
    html += `<div class="popup-carta-aviso">${popupCartaEsc(data?.mensaje || "Sin datos de uso de suelo 2040 para este predio.")}</div>`;
    html += `<div class="popup-carta-meta">Capa usos: ${popupCartaEsc(data?.wms_layer || POPUP_CARTA_WMS_LAYER)}</div>`;
  }

  html += `</section>`;
  return html;
}

function popupCartaActualizarMapa(data) {
  const target = document.getElementById("popupCartaMap");
  if (!target || !data?.geometry) {
    if (target) {
      target.querySelector("#popupCartaMapCanvas")?.remove();
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

  const wmsLayer = data.wms_layer || POPUP_CARTA_WMS_LAYER;
  if (!popupCartaMap) {
    popupCartaAsegurarCanvasMapa();
    popupCartaCapas = popupCartaCrearCapas(wmsLayer);
    popupCartaMap = new ol.Map({
      target: "popupCartaMapCanvas",
      layers: [
        popupCartaCapas.googleHybrid,
        popupCartaCapas.googleRoad,
        popupCartaCapas.esri,
        popupCartaCapas.osm,
        popupCartaCapas.cartaWms,
        popupCartaCapas.sectoresWms,
        popupCartaCapas.coloniasWms,
        popupCartaCapas.prediosWms,
        popupCartaCapas.zonaVector,
        popupCartaCapas.predioVector
      ],
      view: new ol.View({ center: ol.proj.fromLonLat([-115.468, 32.624]), zoom: 17 }),
      controls: []
    });
    popupCartaInicializarOrdenCapas();
  } else if (popupCartaCapas?.cartaWms) {
    popupCartaCapas.cartaWms.getSource().updateParams({ LAYERS: wmsLayer });
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });

  popupCartaCapas.predioVector.getSource().clear();
  popupCartaCapas.zonaVector.getSource().clear();

  const predioFeats = format.readFeatures({
    type: "Feature",
    geometry: data.geometry,
    properties: { clave_catastral: data.clave_catastral, es_consultado: true }
  });
  popupCartaCapas.predioVector.getSource().addFeatures(predioFeats);

  const zonaGeom = data?.carta_urbana?.geometry;
  if (zonaGeom) {
    try {
      const zonaFeats = format.readFeatures({
        type: "Feature",
        geometry: zonaGeom,
        properties: data.carta_urbana?.atributos || {}
      });
      popupCartaCapas.zonaVector.getSource().addFeatures(zonaFeats);
    } catch (e) {
      console.warn("Carta urbana: no se pudo dibujar polígono de zona:", e);
    }
  }

  popupCartaCentrarMapa();
  const btnImp = document.getElementById("popupCartaBtnImprimir");
  if (btnImp) {
    btnImp.disabled = false;
    btnImp.textContent = "Imprimir / PDF";
  }
}

function popupCartaCapturarMapaDataUrl(timeoutMs) {
  if (typeof popupNumofCapturarMapaInstancia === "function") {
    return popupNumofCapturarMapaInstancia(popupCartaMap, timeoutMs || 8000);
  }
  return Promise.resolve(null);
}

function popupCartaImprimirPlano() {
  if (typeof abrirPreviewFichaCartaUrbana === "function") {
    abrirPreviewFichaCartaUrbana();
    return;
  }
  alert("No se pudo abrir la vista previa de la ficha.");
}

function destruirPopupCartaUrbana() {
  cerrarPopupCartaCapasMenu();
  if (popupCartaMap) {
    popupCartaMap.setTarget(null);
    popupCartaMap = null;
  }
  popupCartaCapas = null;
  popupCartaCapaOrdenEstado = { ...POPUP_CARTA_CAPA_ORDEN_DEF };
  popupCartaClaveActual = "";
  popupCartaDatos = null;
}

async function pintarPopupTabCartaUrbana(p) {
  const panel = document.getElementById("popupTabCartaUrbana");
  if (!panel) return;

  const claveNorm = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  destruirPopupCartaUrbana();
  popupCartaClaveActual = claveNorm;

  panel.innerHTML = `
    <div class="popup-carta-layout">
      <div class="popup-carta-panel-izq" id="popupCartaPanelIzq">
        <div class="popup-carta-cargando">Consultando carta urbana 2040…</div>
      </div>
      <div class="popup-carta-mapa-panel">
        <div class="popup-carta-mapa-head">
          <div class="popup-carta-mapa-head-text">
            <strong>Plano Carta Urbana 2040</strong>
            <span id="popupCartaResumenMapa">Cargando capa de zonificación…</span>
          </div>
          <div class="popup-carta-mapa-head-actions">
            <button type="button" class="popup-btn-imprimir-ficha popup-btn-carta-ficha" id="popupCartaBtnImprimir" disabled onclick="popupCartaImprimirPlano()">Cargando mapa…</button>
            <button type="button" class="popup-btn-capas" id="popupCartaBtnCapas">Capas</button>
          </div>
        </div>
        <div class="popup-carta-mapa-body">
          <div id="popupCartaMap" class="popup-carta-mapa">
            <div class="popup-mini-map-vacio">Cargando mapa…</div>
          </div>
          ${htmlMenuCapasPopupCarta()}
        </div>
        <div class="popup-carta-leyenda">
          <span><i class="popup-carta-swatch popup-carta-swatch-predio"></i> Predio consultado</span>
          <span><i class="popup-carta-swatch popup-carta-swatch-zona"></i> Polígono de zona (intersección)</span>
          <span><i class="popup-carta-swatch popup-carta-swatch-wms"></i> Usos propuestos 2040</span>
          <span><i class="popup-carta-swatch popup-carta-swatch-sectores"></i> Sectores</span>
        </div>
      </div>
    </div>`;

  document.getElementById("popupCartaBtnCapas")?.addEventListener("click", function(e) {
    togglePopupCartaCapasMenu(e);
  });

  if (!claveNorm) {
    document.getElementById("popupCartaPanelIzq").innerHTML =
      `<div class="popup-carta-aviso">Seleccione un predio con clave catastral.</div>`;
    return;
  }

  try {
    const data = await cargarCartaUrbana2040(claveNorm, p);
    if (popupCartaClaveActual !== claveNorm) return;
    popupCartaDatos = data;

    const izq = document.getElementById("popupCartaPanelIzq");
    const resumen = document.getElementById("popupCartaResumenMapa");
    if (izq) izq.innerHTML = popupCartaHtmlAtributos(data, p);
    if (resumen) resumen.textContent = popupCartaResumenTexto(data);

    popupCartaActualizarMapa(data);
  } catch (e) {
    if (popupCartaClaveActual !== claveNorm) return;
    const izq = document.getElementById("popupCartaPanelIzq");
    const mapEl = document.getElementById("popupCartaMap");
    const resumen = document.getElementById("popupCartaResumenMapa");
    if (izq) {
      izq.innerHTML = `<div class="popup-carta-aviso">${popupCartaEsc(e.message || "Error al consultar carta urbana.")}</div>`;
    }
    if (mapEl) {
      mapEl.querySelector("#popupCartaMapCanvas")?.remove();
      let vacio = mapEl.querySelector(".popup-mini-map-vacio");
      if (!vacio) {
        vacio = document.createElement("div");
        vacio.className = "popup-mini-map-vacio";
        mapEl.appendChild(vacio);
      }
      vacio.textContent = e.message || "Sin datos.";
    }
    if (resumen) resumen.textContent = "Error al consultar";
  }
}

window.pintarPopupTabCartaUrbana = pintarPopupTabCartaUrbana;
window.destruirPopupCartaUrbana = destruirPopupCartaUrbana;
window.togglePopupCartaCapasMenu = togglePopupCartaCapasMenu;
window.cerrarPopupCartaCapasMenu = cerrarPopupCartaCapasMenu;
window.togglePopupCartaCapa = togglePopupCartaCapa;
window.setPopupCartaBaseLayer = setPopupCartaBaseLayer;
window.popupCartaZoomMas = popupCartaZoomMas;
window.popupCartaZoomMenos = popupCartaZoomMenos;
window.popupCartaCentrarMapa = popupCartaCentrarMapa;
window.popupCartaImprimirPlano = popupCartaImprimirPlano;
window.popupCartaCapturarMapaDataUrl = popupCartaCapturarMapaDataUrl;
window.cargarCartaUrbana2040 = cargarCartaUrbana2040;
