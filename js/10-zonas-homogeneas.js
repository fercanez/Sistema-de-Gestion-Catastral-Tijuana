/* Zona homogénea — ubicación del predio, evolución 2024–2026 e impresión */

const POPUP_ZONA_GEONODE_WMS = typeof POPUP_NUMOF_GEONODE_WMS !== "undefined"
  ? POPUP_NUMOF_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const POPUP_ZONA_CATASTRO_WMS = typeof POPUP_NUMOF_CATASTRO_WMS !== "undefined"
  ? POPUP_NUMOF_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const POPUP_ZONA_WMS_LAYER = "geonode:zonashomo2026_tij";
const POPUP_ZONA_WMS_LAYERS = ["geonode:zonashomo2026_tij", "zonashomo2026_tij"];
const POPUP_ZONA_WFS_URL = (typeof POPUP_ZONA_GEONODE_WMS !== "undefined"
  ? POPUP_ZONA_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms").replace("/wms", "/wfs");
const POPUP_ZONA_NATIVE_SRID = "EPSG:32611";

let popupZonaMap = null;
let popupZonaCapas = null;
let popupZonaCapasManager = null;
let popupZonaClaveActual = "";
let popupZonaDatos = null;
let popupZonaOverlay = null;
let popupZonaOverlayEl = null;
let popupZonaClickHandler = null;

const POPUP_ZONA_CAPA_ORDEN_DEF = {
  predio: 38,
  zona: 50,
  prediosWms: 8,
  zonasWms: 6
};

const POPUP_ZONA_CAPA_PROP = {
  predio: "predioVector",
  zona: "zonaVector",
  prediosWms: "prediosWms",
  zonasWms: "zonasWms"
};

function popupZonaEsc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function popupZonaVal(valor) {
  if (valor == null || valor === "") return "—";
  return String(valor);
}

function popupZonaFormatMoneda(valor) {
  if (typeof formatoMoneda === "function") return formatoMoneda(valor);
  if (valor == null || valor === "") return "—";
  return "$" + Number(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function popupZonaEstiloPredio() {
  return [
    new ol.style.Style({
      zIndex: 38,
      stroke: new ol.style.Stroke({
        color: "rgba(255,255,255,0.92)",
        width: 6,
        lineDash: [8, 6]
      })
    }),
    new ol.style.Style({
      zIndex: 39,
      stroke: new ol.style.Stroke({
        color: "#111827",
        width: 4,
        lineDash: [6, 5]
      })
    })
  ];
}

function popupZonaEstiloZona() {
  return [
    new ol.style.Style({
      zIndex: 49,
      stroke: new ol.style.Stroke({
        color: "rgba(255,255,255,0.9)",
        width: 6,
        lineDash: [8, 5]
      })
    }),
    new ol.style.Style({
      zIndex: 50,
      stroke: new ol.style.Stroke({
        color: "#dc2626",
        width: 4,
        lineDash: [8, 5]
      })
    })
  ];
}

function popupZonaCrearCapas() {
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
    zonasWms: new ol.layer.Tile({
      visible: true,
      opacity: 0.72,
      zIndex: POPUP_ZONA_CAPA_ORDEN_DEF.zonasWms,
      source: new ol.source.TileWMS({
        url: POPUP_ZONA_GEONODE_WMS,
        params: {
          LAYERS: POPUP_ZONA_WMS_LAYER,
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
      zIndex: POPUP_ZONA_CAPA_ORDEN_DEF.prediosWms,
      source: new ol.source.TileWMS({
        url: POPUP_ZONA_CATASTRO_WMS,
        params: {
          LAYERS: "geonode:predios_tijuana",
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
      zIndex: POPUP_ZONA_CAPA_ORDEN_DEF.zona,
      source: new ol.source.Vector(),
      style: popupZonaEstiloZona()
    }),
    predioVector: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_ZONA_CAPA_ORDEN_DEF.predio,
      source: new ol.source.Vector(),
      style: popupZonaEstiloPredio()
    })
  };
}

function popupZonaAsegurarCanvasMapa() {
  const target = document.getElementById("popupZonaMap");
  if (!target) return null;
  target.querySelector(".popup-mini-map-vacio")?.remove();
  let canvas = document.getElementById("popupZonaMapCanvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.id = "popupZonaMapCanvas";
    canvas.className = "popup-zona-mapa-canvas";
    target.appendChild(canvas);
  }
  return canvas;
}

function htmlMenuCapasPopupZona() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "popupZonaChkPredio", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "zona", checkboxId: "popupZonaChkZona", dotClass: "dot-amber", label: "Límite zona homogénea", checked: true, opacity: 100 },
        { id: "zonasWms", checkboxId: "popupZonaChkZonasWms", dotClass: "dot-green", label: "Zonas homogéneas (WMS)", checked: true, opacity: 72 },
        { id: "prediosWms", checkboxId: "popupZonaChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: false, opacity: 45 }
      ], {
        opPrefix: "popupZonaOp",
        toggleFn: "togglePopupZonaCapa",
        opacityFn: "popupZonaCambiarOpacidadCapa",
        subirFn: "popupZonaSubirCapa",
        bajarFn: "popupZonaBajarCapa"
      })
    : "";

  const basemap = `<div class="popup-capas-seccion">
        <strong>Base mapas</strong>
        <label><input type="radio" name="popupZonaBaseMap" value="googleHybrid" checked onchange="setPopupZonaBaseLayer(this.value)"> Google Hybrid</label>
        <label><input type="radio" name="popupZonaBaseMap" value="googleRoad" onchange="setPopupZonaBaseLayer(this.value)"> Google Road</label>
        <label><input type="radio" name="popupZonaBaseMap" value="esri" onchange="setPopupZonaBaseLayer(this.value)"> ESRI Satellite</label>
        <label><input type="radio" name="popupZonaBaseMap" value="osm" onchange="setPopupZonaBaseLayer(this.value)"> OpenStreetMap</label>
      </div>`;

  return typeof htmlPopupMapaCapasMenu === "function"
    ? htmlPopupMapaCapasMenu({
        menuId: "popupZonaCapasMenu",
        overlayListId: "popupZonaCapasOverlayList",
        menuClass: "popup-carta-capas-menu popup-zona-capas-menu",
        itemsHtml: capas,
        basemapHtml: basemap
      })
    : "";
}

function popupZonaInicializarCapasManager() {
  if (typeof crearFichaMapaCapasManager !== "function") return;
  popupZonaCapasManager = crearFichaMapaCapasManager({
    ordenDef: POPUP_ZONA_CAPA_ORDEN_DEF,
    capaProp: POPUP_ZONA_CAPA_PROP,
    chkMap: {
      predio: "popupZonaChkPredio",
      zona: "popupZonaChkZona",
      zonasWms: "popupZonaChkZonasWms",
      prediosWms: "popupZonaChkPrediosWms"
    },
    optionalIds: ["prediosWms"],
    getCapas: () => popupZonaCapas,
    getMap: () => popupZonaMap,
    overlayListId: "popupZonaCapasOverlayList",
    opPrefix: "popupZonaOp"
  });
  popupZonaCapasManager.inicializar();
}

function popupZonaCambiarOpacidadCapa(id, valor) {
  popupZonaCapasManager?.cambiarOpacidad(id, valor);
}

function popupZonaSubirCapa(id) {
  popupZonaCapasManager?.subir(id);
}

function popupZonaBajarCapa(id) {
  popupZonaCapasManager?.bajar(id);
}

function togglePopupZonaCapasMenu(ev) {
  togglePopupMapaCapasMenu("popupZonaCapasMenu", ev);
}

function togglePopupZonaCapa(tipo) {
  popupZonaCapasManager?.toggle(tipo);
}

function setPopupZonaBaseLayer(valor) {
  if (!popupZonaCapas) return;
  ["googleHybrid", "googleRoad", "esri", "osm"].forEach(function(id) {
    if (popupZonaCapas[id]) popupZonaCapas[id].setVisible(id === valor);
  });
  popupZonaMap?.render();
}

function popupZonaRefrescarMapaVisible() {
  if (!popupZonaMap) return;
  function tick() {
    popupZonaMap.updateSize();
    try {
      popupZonaMap.renderSync();
    } catch (e) {
      popupZonaMap.render();
    }
  }
  tick();
  requestAnimationFrame(tick);
  [120, 350, 700, 1200].forEach(function(ms) {
    setTimeout(function() {
      tick();
      if (typeof popupZonaCentrarMapa === "function") popupZonaCentrarMapa(true);
    }, ms);
  });
}

function extentCentradoPredioYZona(extPredio, extZona, opts) {
  opts = opts || {};
  const bufferM = opts.bufferMetros != null ? opts.bufferMetros : 240;
  const ratioMax = opts.ratioZonaPredio != null ? opts.ratioZonaPredio : 5;

  if (!extPredio || !Number.isFinite(extPredio[0])) {
    if (extZona && Number.isFinite(extZona[0])) return extZona.slice();
    return null;
  }

  let ext = extPredio.slice();
  if (extZona && Number.isFinite(extZona[0])) {
    const ap = ol.extent.getWidth(extPredio) * ol.extent.getHeight(extPredio);
    const az = ol.extent.getWidth(extZona) * ol.extent.getHeight(extZona);
    if (ap > 0 && az <= ap * ratioMax) {
      ext = ol.extent.createEmpty();
      ol.extent.extend(ext, extPredio);
      ol.extent.extend(ext, extZona);
    }
  }

  if (typeof ol.extent.buffer === "function") {
    ext = ol.extent.buffer(ext, bufferM);
  }
  return ext;
}

function popupZonaCentrarMapa(forzar) {
  if (!popupZonaMap || !popupZonaCapas) return;
  popupZonaMap.updateSize();
  const extPredio = popupZonaCapas.predioVector.getSource().getExtent();
  const extZona = popupZonaCapas.zonaVector.getSource().getExtent();
  const ext = extentCentradoPredioYZona(extPredio, extZona);

  if (ext && Number.isFinite(ext[0])) {
    popupZonaMap.getView().fit(ext, {
      padding: [52, 52, 52, 52],
      maxZoom: 18,
      duration: forzar ? 0 : 280
    });
    return;
  }

  const data = popupZonaDatos;
  if (data?.centroide?.lon != null && data?.centroide?.lat != null) {
    popupZonaMap.getView().setCenter(
      ol.proj.fromLonLat([data.centroide.lon, data.centroide.lat])
    );
    popupZonaMap.getView().setZoom(17);
  }
}

function popupZonaNormalizarAtributos(props) {
  if (!props) return {};
  const claves = {};
  Object.keys(props).forEach(function(k) {
    claves[String(k).toLowerCase()] = k;
  });
  function tomarExacto() {
    const nombres = Array.prototype.slice.call(arguments);
    for (let i = 0; i < nombres.length; i++) {
      const k = claves[String(nombres[i]).toLowerCase()];
      if (!k) continue;
      const val = props[k];
      if (val != null && String(val).trim() !== "" && String(val).toUpperCase() !== "NULL") {
        return String(val).trim();
      }
    }
    return "";
  }
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
  return {
    codigo: tomarExacto("zh", "secsub", "subsector", "codigo_zona_homogenea", "zonah")
      || tomar("zonashomo", "zonahom", "secsub"),
    descripcion: tomarExacto("referencia", "descripcion_col_fracc")
      || tomar("descripcion", "nombre", "desc", "colonia"),
    zona: tomarExacto("zona") || tomar("zona", "nom_zona"),
    sector: tomarExacto("sector") || tomar("sector", "nom_sector"),
    subsector: tomarExacto("subsector") || tomar("subsector", "nom_subsector"),
    homoclave: tomarExacto("homoclave", "homoclave_col_fracc") || tomar("homoclave", "fraccion"),
    seccion: tomarExacto("seccion", "sec") || tomar("seccion"),
    valor_m2: tomarExacto("valor_2026", "valor_m2") || tomar("valor", "valorm2"),
    observaciones: tomar("observ", "nota", "coment")
  };
}

function popupZonaLeerZh(props) {
  if (!props) return "";
  const directo = props.zh ?? props.ZH ?? props.Zh;
  if (directo != null && String(directo).trim() !== "") {
    return String(directo).trim().toUpperCase();
  }
  return "";
}

function popupZonaAreaFeature(props) {
  const area = Number(props?.shape_area ?? props?.SHAPE_AREA ?? 0);
  return Number.isFinite(area) ? area : 0;
}

function popupZonaSeleccionarFeatureGfi(features, lon, lat) {
  if (!features || !features.length) return null;
  const porPunto = popupZonaSeleccionarFeaturePorPunto(features, lon, lat);
  if (porPunto) return porPunto;
  if (features.length === 1) return features[0];

  let mejor = null;
  let mejorArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < features.length; i++) {
    const props = features[i].properties || {};
    const zh = popupZonaLeerZh(props);
    if (!zh) continue;
    const area = popupZonaAreaFeature(props);
    if (area > 0 && area < mejorArea) {
      mejor = features[i];
      mejorArea = area;
    }
  }
  return mejor || features[0];
}

function popupZonaSeleccionarFeaturePorPunto(features, lon, lat) {
  if (!features || !features.length || lon == null || lat == null || typeof ol === "undefined") {
    return null;
  }
  const click = [Number(lon), Number(lat)];
  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:4326"
  });
  const candidatos = [];
  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const props = feat.properties || {};
    const zh = popupZonaLeerZh(props);
    if (!zh || !feat.geometry) continue;
    try {
      const olFeat = format.readFeature(feat);
      const geom = olFeat.getGeometry();
      if (!geom || !geom.intersectsCoordinate(click)) continue;
      candidatos.push({
        feat: feat,
        area: popupZonaAreaFeature(props) || Number.POSITIVE_INFINITY,
        zhLen: zh.length
      });
    } catch (e) {}
  }
  if (!candidatos.length) return null;
  candidatos.sort(function(a, b) {
    if (a.area !== b.area) return a.area - b.area;
    return b.zhLen - a.zhLen;
  });
  return candidatos[0].feat;
}

async function popupZonaWfsPorPunto(lon, lat, layers) {
  if (lon == null || lat == null || typeof ol === "undefined") return null;
  let xy;
  try {
    xy = ol.proj.transform([Number(lon), Number(lat)], "EPSG:4326", POPUP_ZONA_NATIVE_SRID);
  } catch (e) {
    return null;
  }
  const x = Number(xy[0]);
  const y = Number(xy[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const typeName = layer.indexOf(":") >= 0 ? layer : ("geonode:" + layer);
    const cql = "DWITHIN(geom,POINT(" + x + " " + y + "),30,meters)";
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.1.0",
      request: "GetFeature",
      typeName: typeName,
      outputFormat: "application/json",
      srsName: POPUP_ZONA_NATIVE_SRID,
      CQL_FILTER: cql,
      maxFeatures: "15"
    });
    try {
      const r = await fetch(POPUP_ZONA_WFS_URL + "?" + params.toString(), { cache: "no-store" });
      if (!r.ok) continue;
      const data = await r.json();
      const features = data.features || [];
      if (!features.length) continue;
      const feat = popupZonaSeleccionarFeaturePorPunto(features, lon, lat)
        || popupZonaSeleccionarFeatureGfi(features, lon, lat);
      if (!feat) continue;
      const props = feat.properties || {};
      return {
        origen: "wfs",
        layer: layer,
        properties: props,
        geometry: feat.geometry || null,
        atributos: popupZonaNormalizarAtributos(props)
      };
    } catch (e) {
      console.warn("Zona homogénea WFS:", layer, e);
    }
  }
  return null;
}

async function popupZonaConsultarEnPunto(lon, lat, layers) {
  let hit = await popupZonaWfsPorPunto(lon, lat, layers);
  if (hit) return hit;
  return popupZonaWmsGetFeatureInfo(lon, lat, layers);
}

async function popupZonaWmsGetFeatureInfo(lon, lat, layers) {
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
      FEATURE_COUNT: "10"
    });
    try {
      const r = await fetch(POPUP_ZONA_GEONODE_WMS + "?" + params.toString(), { cache: "no-store" });
      if (!r.ok) continue;
      const data = await r.json();
      const features = data.features || [];
      if (!features.length) continue;
      const feat = popupZonaSeleccionarFeatureGfi(features, lon, lat);
      const props = feat.properties || {};
      return {
        origen: "wms",
        layer: layer,
        properties: props,
        geometry: feat.geometry || null,
        atributos: popupZonaNormalizarAtributos(props)
      };
    } catch (e) {
      console.warn("Zona homogénea WMS:", layer, e);
    }
  }
  return null;
}

function popupZonaNormalizarCodigo(codigo) {
  return String(codigo || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function popupZonaCodigosCoinciden(a, b) {
  const ca = popupZonaNormalizarCodigo(a);
  const cb = popupZonaNormalizarCodigo(b);
  if (!ca || !cb) return false;
  return ca === cb;
}

function popupZonaEsEtiquetaLegacy(texto) {
  return /=\s*\$\s*[\d,.]+/i.test(String(texto || ""));
}

function popupZonaLimpiarEtiquetaLegacy(texto) {
  return String(texto || "").replace(/\s*=\s*\$\s*[\d,.]+.*$/i, "").trim();
}

function popupZonaFormatearZonaSector(attrs, cat) {
  if (cat?.zona || cat?.sector) {
    return [cat.zona, cat.sector].filter(Boolean).join(" · ");
  }
  const z = popupZonaLimpiarEtiquetaLegacy(attrs?.zona);
  const s = popupZonaLimpiarEtiquetaLegacy(attrs?.sector);
  if (z && s && z === s) return z;
  const joined = [z, s].filter(Boolean).join(" · ");
  if (joined && !popupZonaEsEtiquetaLegacy(joined)) return joined;
  return attrs?.codigo || "";
}

function popupZonaDescripcionZona(attrs, cat) {
  const descCat = cat?.descripcion_col_fracc || "";
  if (descCat) return descCat;
  const desc = attrs?.descripcion || "";
  if (desc && !popupZonaEsEtiquetaLegacy(desc)) return desc;
  return "";
}

function popupZonaValorCatalogo2026(cat) {
  if (!cat) return null;
  if (cat.valor_2026 != null) return cat.valor_2026;
  const ev = (cat.evolucion || []).find(function(e) { return e.anio === 2026; });
  return ev?.valor_m2 != null ? ev.valor_m2 : null;
}

function popupZonaCodigoEfectivo(data, p) {
  return String(
    data?.zonah
    || p?.zonah
    || p?.zona_homogenea
    || data?.catalogo?.clave_zonah
    || data?.catalogo?.codigo_zona_homogenea
    || ""
  ).trim().toUpperCase();
}

function popupZonaCodigoCarto(data) {
  const attrs = data?.zona_carto?.atributos || {};
  const props = data?.zona_carto?.properties || {};
  return popupZonaLeerZh(props)
    || attrs.codigo
    || String(data?.zonah_carto || "").trim().toUpperCase();
}

function popupZonaCalcularValorPredio2026(data, p) {
  const directo = data?.valor2026 ?? p?.valor2026;
  if (directo != null && directo !== "" && !Number.isNaN(Number(directo)) && Number(directo) > 0) {
    return Number(directo);
  }
  const estimado = data?.valor2026_estimado;
  if (estimado != null && !Number.isNaN(Number(estimado)) && Number(estimado) > 0) {
    return Number(estimado);
  }
  const sup = Number(p?.sup_documental || p?.sup_fisica || data?.sup_documental || data?.sup_fisica || 0);
  if (sup <= 0) return null;
  let vUnit = data?.valor_m2_2026;
  if (vUnit == null) vUnit = popupZonaValorCatalogo2026(data?.catalogo);
  if (vUnit == null) {
    const props = data?.zona_padron?.properties || data?.zona_carto?.properties || {};
    vUnit = popupZonaParseValor2026(
      props.valor_2026 ?? data?.zona_padron?.atributos?.valor_m2 ?? data?.zona_carto?.atributos?.valor_m2
    );
  }
  if (vUnit == null || Number.isNaN(Number(vUnit))) return null;
  return Math.round(Number(vUnit) * sup * 100) / 100;
}

function popupZonaEtiquetaValorPredio2026(data, p) {
  const valor = popupZonaCalcularValorPredio2026(data, p);
  const texto = popupZonaFormatMoneda(valor);
  const padronNum = Number(data?.valor2026_padron ?? p?.valor2026 ?? 0);
  const esEstimado = (!Number.isFinite(padronNum) || padronNum <= 0) && valor != null;
  return esEstimado ? texto + " (estimado)" : texto;
}

function popupZonaCatalogoDesdeCapa(data) {
  const anios = typeof obtenerAniosAnalisisZonas === "function"
    ? obtenerAniosAnalisisZonas()
    : [2024, 2025, 2026];
  const zonas = [data?.zona_padron, data?.zona_carto].filter(Boolean);
  if (!zonas.length) return null;

  const valores = {};
  zonas.forEach(function(zona) {
    const props = zona.properties || {};
    const attrs = zona.atributos || {};
    anios.forEach(function(an) {
      if (valores[an] != null) return;
      const v = popupZonaParseValor2026(props["valor_" + an] ?? attrs["valor_" + an]);
      if (v != null) valores[an] = v;
    });
    if (valores[2026] == null) {
      const v26 = popupZonaParseValor2026(props.valor_2026 ?? attrs.valor_m2);
      if (v26 != null) valores[2026] = v26;
    }
  });
  if (!Object.keys(valores).length) return null;

  const base = data.zona_padron || data.zona_carto;
  const attrs = base?.atributos || {};
  const cod = popupZonaCodigoEfectivo(data, null);
  const evolucion = anios.map(function(an) {
    return { anio: an, valor_m2: valores[an] ?? null, presente: valores[an] != null };
  });
  const cat = {
    clave_zonah: cod,
    codigo_zona_homogenea: cod,
    zona: attrs.zona,
    sector: attrs.sector,
    subsector: attrs.subsector,
    descripcion_col_fracc: attrs.descripcion,
    evolucion: evolucion,
    tipo_zona: "CARTOGRAFIA"
  };
  anios.forEach(function(an) {
    cat["valor_" + an] = valores[an] ?? null;
  });
  if (typeof recalcularVariacionZona === "function") {
    return recalcularVariacionZona(cat);
  }
  return cat;
}

async function popupZonaAsegurarCatalogo(data) {
  if (data?.catalogo) return data.catalogo;
  const zonahPadron = String(data?.zonah || "").trim().toUpperCase();
  const candidatos = zonahPadron
    ? [
        zonahPadron,
        data?.catalogo?.clave_zonah,
        data?.catalogo?.codigo_zona_homogenea,
        popupZonaLeerZh(data?.zona_padron?.properties)
      ]
    : [
        data?.zonah,
        popupZonaLeerZh(data?.zona_padron?.properties),
        popupZonaLeerZh(data?.zona_carto?.properties),
        data?.zona_carto?.atributos?.codigo,
        data?.zonah_carto
      ];
  for (let i = 0; i < candidatos.length; i++) {
    const cod = String(candidatos[i] || "").trim();
    if (!cod) continue;
    const cat = await cargarCatalogoZonaHomogenea(cod);
    if (cat) {
      data.catalogo = cat;
      return cat;
    }
  }
  const desdeCapa = popupZonaCatalogoDesdeCapa(data);
  if (desdeCapa) {
    data.catalogo = desdeCapa;
    return desdeCapa;
  }
  return null;
}

function popupZonaExtraerCodigoDesdeProps(props, attrs) {
  const zh = popupZonaLeerZh(props);
  if (zh) return zh;
  const directo = props?.codigo_zona_homogenea || props?.zonah || props?.ZONAH;
  if (directo) return String(directo).trim().toUpperCase();
  if (attrs?.codigo) {
    return String(attrs.codigo).trim().toUpperCase();
  }
  return "";
}

function popupZonaParseValor2026(valor) {
  if (valor == null || String(valor).trim() === "") return null;
  const n = Number(String(valor).replace(/[$,\s]/g, ""));
  return Number.isNaN(n) ? null : n;
}

async function popupZonaResolverValor2026(codigo, attrs, props) {
  const cod = popupZonaExtraerCodigoDesdeProps(props, attrs) || codigo;
  const capaVal = popupZonaParseValor2026(props?.valor_2026 ?? attrs?.valor_m2);
  if (capaVal != null) return capaVal;

  if (cod) {
    const remoto = await cargarCatalogoZonaHomogenea(cod);
    const vRemoto = popupZonaValorCatalogo2026(remoto);
    if (vRemoto != null) return vRemoto;
  }

  const catLocal = popupZonaDatos?.catalogo;
  if (catLocal && cod) {
    const catCod = catLocal.clave_zonah || catLocal.codigo_zona_homogenea || "";
    if (popupZonaCodigosCoinciden(catCod, cod)) {
      const vLocal = popupZonaValorCatalogo2026(catLocal);
      if (vLocal != null) return vLocal;
    }
  }
  return null;
}

function popupZonaOcultarTooltip() {
  if (popupZonaOverlayEl) popupZonaOverlayEl.classList.add("oculto");
  if (popupZonaOverlay) popupZonaOverlay.setPosition(undefined);
}

function popupZonaHtmlTooltip(codigo, descripcion, valor2026) {
  const valTxt = valor2026 != null ? popupZonaFormatMoneda(valor2026) : "—";
  return `<div class="popup-zona-tooltip-inner">
    <button type="button" class="popup-zona-tooltip-cerrar" onclick="popupZonaOcultarTooltip()" title="Cerrar">×</button>
    <strong class="popup-zona-tooltip-codigo">${popupZonaEsc(codigo || "Zona homogénea")}</strong>
    ${descripcion ? `<span class="popup-zona-tooltip-desc">${popupZonaEsc(descripcion)}</span>` : ""}
    <span class="popup-zona-tooltip-valor">Valor unitario suelo 2026: <b>${popupZonaEsc(valTxt)}</b></span>
    <span class="popup-zona-tooltip-nota">Fuente: catálogo fiscal (valor/m²)</span>
  </div>`;
}

function popupZonaMostrarTooltip(coordinate, html) {
  if (!popupZonaMap || !popupZonaOverlay || !popupZonaOverlayEl) return;
  popupZonaOverlayEl.innerHTML = html;
  popupZonaOverlayEl.classList.remove("oculto");
  popupZonaOverlay.setPosition(coordinate);
}

function popupZonaInicializarMapaInteraccion() {
  if (!popupZonaMap || popupZonaClickHandler) return;
  if (!popupZonaOverlayEl) {
    popupZonaOverlayEl = document.createElement("div");
    popupZonaOverlayEl.className = "popup-zona-map-tooltip oculto";
  }
  if (!popupZonaOverlay) {
    popupZonaOverlay = new ol.Overlay({
      element: popupZonaOverlayEl,
      offset: [0, -14],
      positioning: "bottom-center",
      stopEvent: true
    });
    popupZonaMap.addOverlay(popupZonaOverlay);
  }
  popupZonaClickHandler = async function(evt) {
    if (!popupZonaMap) return;
    const coord = evt.coordinate;
    const lonLat = ol.proj.toLonLat(coord);
    popupZonaMostrarTooltip(coord, '<div class="popup-zona-tooltip-inner"><span class="popup-zona-tooltip-cargando">Consultando zona…</span></div>');
    try {
      let hit = await popupZonaConsultarEnPunto(lonLat[0], lonLat[1], POPUP_ZONA_WMS_LAYERS);
      if (!hit && popupZonaDatos?.zona_carto) {
        hit = {
          properties: popupZonaDatos.zona_carto.properties || {},
          atributos: popupZonaDatos.zona_carto.atributos || popupZonaNormalizarAtributos(popupZonaDatos.zona_carto.properties)
        };
      }
      if (!hit) {
        popupZonaOcultarTooltip();
        return;
      }
      const attrs = hit.atributos || popupZonaNormalizarAtributos(hit.properties);
      const props = hit.properties || {};
      const codigo = popupZonaExtraerCodigoDesdeProps(props, attrs);
      const descripcion = popupZonaDescripcionZona(attrs, null)
        || popupZonaLimpiarEtiquetaLegacy(attrs?.zona || attrs?.sector);
      const valor2026 = await popupZonaResolverValor2026(codigo, attrs, props);
      popupZonaMostrarTooltip(coord, popupZonaHtmlTooltip(codigo, descripcion, valor2026));
    } catch (e) {
      console.warn("Zona homogénea: clic mapa:", e);
      popupZonaOcultarTooltip();
    }
  };
  popupZonaMap.on("singleclick", popupZonaClickHandler);
}

function popupZonaCentroideDesdeGeometry(geometry) {
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

async function popupZonaEnriquecerDatos(data, p) {
  if (!data) return data;
  const centro = data.centroide || popupZonaCentroideDesdeGeometry(data.geometry);
  if (!data.zona_carto && centro.lon != null && centro.lat != null) {
    try {
      const hit = await popupZonaConsultarEnPunto(centro.lon, centro.lat, POPUP_ZONA_WMS_LAYERS);
      if (hit) data.zona_carto = hit;
    } catch (e) {
      console.warn("Zona homogénea: WMS fallback:", e);
    }
  }
  if (data.zona_carto?.properties) {
    const attrs = popupZonaNormalizarAtributos(data.zona_carto.properties);
    data.zona_carto.atributos = Object.assign({}, attrs, data.zona_carto.atributos || {});
  }
  if (!data.centroide && centro.lon != null) data.centroide = centro;
  if (!data.zonah && p?.zonah) data.zonah = String(p.zonah).trim().toUpperCase();
  if (!data.zonah && p?.zona_homogenea) data.zonah = String(p.zona_homogenea).trim().toUpperCase();
  return data;
}

async function cargarZonaHomogeneaFallback(claveNorm, p) {
  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  let geometry = null;
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

  if (!geometry) throw new Error("Sin geometría cartográfica del predio.");

  const centro = popupZonaCentroideDesdeGeometry(geometry);
  let zonaCarto = null;
  if (centro.lon != null && centro.lat != null) {
    zonaCarto = await popupZonaConsultarEnPunto(centro.lon, centro.lat, POPUP_ZONA_WMS_LAYERS);
  }

  return {
    clave_catastral: claveNorm,
    uso_padron: String(p?.descripcion_uso || "").trim(),
    colonia: String(p?.colonia || "").trim(),
    delegacion: String(p?.delegacion || "").trim(),
    calle: String(p?.calle || "").trim(),
    numof: String(p?.numof || "").trim(),
    zonah: String(p?.zonah || p?.zona_homogenea || "").trim().toUpperCase(),
    id_tasa: p?.id_tasa || "",
    porcentaje_tasa: p?.porcentaje_tasa,
    valor2026: p?.valor2026,
    centroide: centro,
    geometry: geometry,
    zona_carto: zonaCarto,
    catalogo: null,
    wms_url: POPUP_ZONA_GEONODE_WMS,
    wms_layer: POPUP_ZONA_WMS_LAYER,
    mensaje: zonaCarto ? "" : "No se detectó intersección con la capa de zonas homogéneas (WMS)."
  };
}

async function cargarCatalogoZonaHomogenea(codigo) {
  const cod = String(codigo || "").trim().toUpperCase();
  if (!cod) return null;
  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  try {
    const r = await fetch(
      `${API}/padron/analisis/zonas-homogeneas/evolucion?codigo=${encodeURIComponent(cod)}&limite=1&_=${Date.now()}`,
      { headers, cache: "no-store" }
    );
    if (!r.ok) return null;
    const data = await r.json();
    if (data.anios && data.anios.length && typeof _analisisZonasState !== "undefined") {
      _analisisZonasState.anios = data.anios.slice();
    }
    return data.registro || (data.resultados && data.resultados[0]) || null;
  } catch (e) {
    console.warn("Zona homogénea: catálogo evolución:", e);
    return null;
  }
}

async function cargarZonaHomogenea(clave, p) {
  const claveNorm = String(clave || p?.clave_catastral || "").trim().toUpperCase();
  if (!claveNorm) throw new Error("Clave catastral requerida.");

  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  const urls = [
    `${API}/padron/${encodeURIComponent(claveNorm)}/zona-homogenea?_=${Date.now()}`,
    `${API}/predios/${encodeURIComponent(claveNorm)}/zona-homogenea?_=${Date.now()}`
  ];

  let ultimoError = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await fetch(urls[i], { headers, cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (data.anios && data.anios.length && typeof _analisisZonasState !== "undefined") {
          _analisisZonasState.anios = data.anios.slice();
        }
        const enriquecido = await popupZonaEnriquecerDatos(data, p);
        await popupZonaAsegurarCatalogo(enriquecido);
        return enriquecido;
      }
      const err = await r.json().catch(function() { return {}; });
      const detail = String(err.detail || err.message || "").trim();
      if (r.status === 404 && (detail === "Not Found" || detail === "Not found")) {
        return cargarZonaHomogeneaFallback(claveNorm, p);
      }
      throw new Error(detail || ("HTTP " + r.status));
    } catch (e) {
      ultimoError = e;
    }
  }
  try {
    const data = await cargarZonaHomogeneaFallback(claveNorm, p);
    const enriquecido = await popupZonaEnriquecerDatos(data, p);
    await popupZonaAsegurarCatalogo(enriquecido);
    return enriquecido;
  } catch (e) {
    throw ultimoError || e || new Error("No se pudo consultar zona homogénea.");
  }
}

function popupZonaHtmlCampo(label, valor, destacado) {
  const cls = destacado ? " popup-zona-campo-destacado" : "";
  return `<div class="popup-zona-campo${cls}">
    <span class="popup-zona-label">${popupZonaEsc(label)}</span>
    <strong class="popup-zona-valor">${popupZonaEsc(popupZonaVal(valor))}</strong>
  </div>`;
}

function popupZonaHtmlCampoCodigo(valor) {
  return `<div class="popup-zona-campo popup-zona-campo-codigo">
    <span class="popup-zona-label">Código zonah</span>
    <strong class="popup-zona-valor popup-zona-valor-codigo">${popupZonaEsc(popupZonaVal(valor))}</strong>
  </div>`;
}

function popupZonaResumenTexto(data) {
  const cod = popupZonaCodigoEfectivo(data, popupZonaDatos) || "";
  const attrs = data?.zona_carto?.atributos || {};
  const desc = data?.catalogo?.descripcion_col_fracc || attrs.descripcion || "";
  if (cod && desc) return cod + " · " + desc;
  if (cod) return "Zona homogénea: " + cod;
  return data?.mensaje || "Consultando capa geonode:zonashomo2026_tij…";
}

function popupZonaRenderLeyendaGrafica() {
  const el = document.getElementById("popupZonaGraficaLeyenda");
  if (!el) return;
  const anios = typeof obtenerAniosAnalisisZonas === "function"
    ? obtenerAniosAnalisisZonas()
    : [2024, 2025, 2026];
  el.innerHTML = anios.map(function(an, idx) {
    const color = typeof colorAnioAnalisisZona === "function"
      ? colorAnioAnalisisZona(an, idx)
      : "#64748b";
    return `<span><i style="background:${color}"></i>${an}</span>`;
  }).join("");
}

function popupZonaRenderGrafica(catalogo) {
  popupZonaRenderLeyendaGrafica();
  const canvas = document.getElementById("popupZonaCanvas");
  const variacion = document.getElementById("popupZonaVariacion");
  let reg = catalogo;
  if (reg && typeof recalcularVariacionZona === "function") {
    reg = recalcularVariacionZona(Object.assign({}, reg));
  }
  if (typeof dibujarGraficaEvolucionZona === "function" && canvas) {
    dibujarGraficaEvolucionZona(reg, canvas, {
      titulo: "ZONA HOMOGÉNEA · VALOR × AÑO",
      fondo: "#ffffff"
    });
  }
  if (variacion) {
    if (reg?.variacion_pct != null) {
      const signo = reg.variacion_abs >= 0 ? "+" : "";
      const anios = typeof obtenerAniosAnalisisZonas === "function"
        ? obtenerAniosAnalisisZonas()
        : [2024, 2025, 2026];
      const desde = reg.variacion_desde || anios[0];
      const hasta = reg.variacion_hasta || anios[anios.length - 1];
      const absTxt = typeof formatValorM2 === "function"
        ? formatValorM2(reg.variacion_abs).replace(" / m²", "")
        : popupZonaFormatMoneda(reg.variacion_abs);
      variacion.innerHTML = `Variación ${desde}→${hasta}: <b>${signo}${reg.variacion_pct}%</b> (${signo}${absTxt})`;
    } else {
      variacion.textContent = reg ? "Sin variación calculada para los ejercicios disponibles." : "";
    }
  }
}

function popupZonaHtmlAtributos(data, p) {
  const cat = data?.catalogo || {};
  const catCarto = data?.catalogo_carto || null;
  const codZonah = popupZonaCodigoEfectivo(data, p);
  const codCarto = popupZonaCodigoCarto(data);
  const tasa = data?.porcentaje_tasa != null ? data.porcentaje_tasa : p?.porcentaje_tasa;
  const origen = data?.zona_carto?.origen || "";
  const capa = data?.zona_carto?.tabla || data?.zona_carto?.layer || data?.wms_layer || "—";
  const attrsCarto = data?.zona_carto?.atributos || {};
  const coincide = data?.zonah_coincide;
  const vUnitPadron = popupZonaValorCatalogo2026(cat);

  let html = `
    <section class="popup-zona-seccion">
      <h4>Predio consultado (padrón)</h4>
      ${popupZonaHtmlCampo("Clave catastral", data?.clave_catastral)}
      ${popupZonaHtmlCampoCodigo(codZonah)}
      ${popupZonaHtmlCampo("ID tasa", data?.id_tasa || p?.id_tasa)}
      ${popupZonaHtmlCampo("Tasa", tasa != null ? tasa + "%" : "—")}
      ${popupZonaHtmlCampo("Valor catastral predio 2026", popupZonaEtiquetaValorPredio2026(data, p))}
      ${popupZonaHtmlCampo("Colonia / calle", [data?.colonia || p?.colonia, data?.calle || p?.calle, data?.numof || p?.numof].filter(Boolean).join(" · ") || "—")}
      ${popupZonaHtmlCampo("Delegación", data?.delegacion || p?.delegacion)}`;

  if (cat && (cat.valor_2024 != null || cat.valor_2025 != null || cat.valor_2026 != null || (cat.evolucion || []).length)) {
    html += `<div class="popup-zona-valores-anio popup-zona-valores-padron">`;
    html += `<div class="popup-zona-meta">Tabla fiscal · zona padrón ${popupZonaEsc(codZonah || "—")}</div>`;
    const anios = typeof obtenerAniosAnalisisZonas === "function"
      ? obtenerAniosAnalisisZonas()
      : [2024, 2025, 2026];
    anios.forEach(function(an) {
      const val = cat["valor_" + an] != null
        ? cat["valor_" + an]
        : ((cat.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
      html += `<div class="popup-zona-valor-line"><span>Valor ${an}</span><b>${val != null ? popupZonaFormatMoneda(val) : "—"}</b></div>`;
    });
    if (vUnitPadron != null) {
      html += popupZonaHtmlCampo("Valor unitario suelo 2026", popupZonaFormatMoneda(vUnitPadron) + " / m²");
    }
    html += `</div>`;
  }

  html += `</section>
    <section class="popup-zona-seccion popup-zona-seccion-carto">
      <h4>Zona homogénea (cartografía)</h4>`;

  if (data?.zona_carto) {
    html += popupZonaHtmlCampo("Zona intersectada (WMS/WFS)", codCarto || "—");
    if (coincide === false && codZonah && codCarto) {
      html += `<div class="popup-zona-aviso popup-zona-aviso-diff">El padrón asigna zona <b>${popupZonaEsc(codZonah)}</b> y la cartografía intersecta zona <b>${popupZonaEsc(codCarto)}</b>. Se prioriza el padrón para valores y evolución.</div>`;
    } else if (coincide === true) {
      html += `<div class="popup-zona-meta">Coincide con la zona del padrón.</div>`;
    }
    html += popupZonaHtmlCampo("Zona / sector", popupZonaFormatearZonaSector(attrsCarto, catCarto || cat) || codCarto);
    html += popupZonaHtmlCampo("Subsector", attrsCarto.subsector || (catCarto || cat).subsector);
    const vUnitCarto = popupZonaValorCatalogo2026(catCarto);
    if (vUnitCarto != null && coincide === false) {
      html += popupZonaHtmlCampo("Valor unitario cartografía 2026", popupZonaFormatMoneda(vUnitCarto) + " / m²");
    }
    const etiquetaWms = [attrsCarto.zona, attrsCarto.sector].find(function(t) { return popupZonaEsEtiquetaLegacy(t); });
    if (etiquetaWms) {
      html += popupZonaHtmlCampo("Etiqueta WMS (cartografía)", popupZonaVal(etiquetaWms));
    }
    html += popupZonaHtmlCampo("Fuente", origen === "geonode" ? `GeoNode · ${capa}` : `WMS · ${capa}`);
  } else {
    html += `<div class="popup-zona-aviso">${popupZonaEsc(data?.mensaje || "Sin polígono de zona homogénea intersectado para este predio.")}</div>`;
    html += `<div class="popup-zona-meta">Capa WMS: ${popupZonaEsc(data?.wms_layer || POPUP_ZONA_WMS_LAYER)}</div>`;
  }

  html += `</section>
    <section class="popup-zona-seccion popup-zona-seccion-grafica">
      <h4>Evolución del valor unitario · zona padrón ${popupZonaEsc(codZonah || "")}</h4>
      <div class="popup-zona-grafica-wrap">
        <div class="popup-zona-grafica-leyenda" id="popupZonaGraficaLeyenda"></div>
        <canvas id="popupZonaCanvas" class="popup-zona-canvas" width="400" height="200"></canvas>
        <div class="popup-zona-variacion" id="popupZonaVariacion"></div>
      </div>
    </section>`;

  return html;
}

function popupZonaActualizarMapa(data) {
  const target = document.getElementById("popupZonaMap");
  if (!target || !data?.geometry) {
    if (target) {
      target.querySelector("#popupZonaMapCanvas")?.remove();
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

  if (!popupZonaMap) {
    popupZonaAsegurarCanvasMapa();
    popupZonaCapas = popupZonaCrearCapas();
    popupZonaMap = new ol.Map({
      target: "popupZonaMapCanvas",
      layers: [
        popupZonaCapas.googleHybrid,
        popupZonaCapas.googleRoad,
        popupZonaCapas.esri,
        popupZonaCapas.osm,
        popupZonaCapas.zonasWms,
        popupZonaCapas.prediosWms,
        popupZonaCapas.zonaVector,
        popupZonaCapas.predioVector
      ],
      view: new ol.View({ center: ol.proj.fromLonLat([-116.97845271015251, 32.49868744466041]), zoom: 15 }),
      controls: []
    });
    popupZonaInicializarCapasManager();
    popupZonaInicializarMapaInteraccion();
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });

  popupZonaCapas.predioVector.getSource().clear();
  popupZonaCapas.zonaVector.getSource().clear();

  const predioFeats = format.readFeatures({
    type: "Feature",
    geometry: data.geometry,
    properties: { clave_catastral: data.clave_catastral, es_consultado: true }
  });
  popupZonaCapas.predioVector.getSource().addFeatures(predioFeats);

  const zonaGeom = data?.zona_padron?.geometry || data?.zona_carto?.geometry;
  if (zonaGeom) {
    try {
      const zonaFeats = format.readFeatures({
        type: "Feature",
        geometry: zonaGeom,
        properties: (data.zona_padron || data.zona_carto)?.atributos || {}
      });
      popupZonaCapas.zonaVector.getSource().addFeatures(zonaFeats);
    } catch (e) {
      console.warn("Zona homogénea: no se pudo dibujar polígono:", e);
    }
  }

  popupZonaCentrarMapa();
  popupZonaRefrescarMapaVisible();

  const btnImp = document.getElementById("popupZonaBtnImprimir");
  if (btnImp) {
    btnImp.disabled = false;
    btnImp.textContent = "Imprimir / PDF";
  }
}

function popupZonaCapturarMapaDataUrl(timeoutMs) {
  if (typeof popupNumofCapturarMapaInstancia === "function") {
    return popupNumofCapturarMapaInstancia(popupZonaMap, timeoutMs || 8000);
  }
  return Promise.resolve(null);
}

function popupZonaImprimirPlano() {
  if (typeof abrirPreviewFichaZonaHomogenea === "function") {
    abrirPreviewFichaZonaHomogenea();
    return;
  }
  alert("No se pudo abrir la vista previa de la ficha de zona homogénea.");
}

function destruirPopupZonaHomogenea() {
  cerrarPopupMapaCapasMenu("popupZonaCapasMenu");
  popupZonaOcultarTooltip();
  if (popupZonaMap && popupZonaClickHandler) {
    popupZonaMap.un("singleclick", popupZonaClickHandler);
  }
  if (popupZonaMap) {
    popupZonaMap.setTarget(null);
    popupZonaMap = null;
  }
  popupZonaCapas = null;
  popupZonaCapasManager = null;
  popupZonaOverlay = null;
  popupZonaOverlayEl = null;
  popupZonaClickHandler = null;
  popupZonaClaveActual = "";
  popupZonaDatos = null;
}

async function pintarPopupTabZonaHomogenea(p) {
  const panel = document.getElementById("popupTabZonaHomogenea");
  if (!panel) return;

  const claveNorm = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  destruirPopupZonaHomogenea();
  popupZonaClaveActual = claveNorm;

  panel.innerHTML = `
    <div class="popup-zona-layout">
      <div class="popup-zona-panel-izq" id="popupZonaPanelIzq">
        <div class="popup-zona-cargando">Consultando zona homogénea…</div>
      </div>
      <div class="popup-zona-mapa-panel">
        <div class="popup-zona-mapa-head">
          <div class="popup-zona-mapa-head-text">
            <strong>Plano de ubicación en zona homogénea</strong>
          <span id="popupZonaResumenMapa">Cargando capa geonode:zonashomo2026_tij…</span>
          </div>
          <div class="popup-zona-mapa-head-actions">
            <button type="button" class="popup-btn-imprimir-ficha popup-btn-zona-ficha" id="popupZonaBtnImprimir" disabled onclick="popupZonaImprimirPlano()">Cargando mapa…</button>
            <button type="button" class="popup-btn-capas" id="popupZonaBtnCapas">Capas</button>
          </div>
        </div>
        <div class="popup-zona-mapa-body">
          <div id="popupZonaMap" class="popup-zona-mapa">
            <div class="popup-mini-map-vacio">Cargando mapa…</div>
          </div>
          ${htmlMenuCapasPopupZona()}
        </div>
        <div class="popup-zona-leyenda">
          <span><i class="popup-zona-swatch popup-zona-swatch-predio"></i> Predio consultado (negro punteado)</span>
          <span><i class="popup-zona-swatch popup-zona-swatch-zona"></i> Límite zona homogénea (rojo punteado)</span>
          <span><i class="popup-zona-swatch popup-zona-swatch-wms"></i> Zonas homogéneas (WMS) · clic para consultar</span>
        </div>
      </div>
    </div>`;

  document.getElementById("popupZonaBtnCapas")?.addEventListener("click", function(e) {
    togglePopupZonaCapasMenu(e);
  });

  if (!claveNorm) {
    const izq = document.getElementById("popupZonaPanelIzq");
    if (izq) izq.innerHTML = `<div class="popup-zona-aviso">Sin clave catastral.</div>`;
    return;
  }

  try {
    const data = await cargarZonaHomogenea(claveNorm, p);
    if (popupZonaClaveActual !== claveNorm) return;
    popupZonaDatos = data;

    const izq = document.getElementById("popupZonaPanelIzq");
    if (izq) izq.innerHTML = popupZonaHtmlAtributos(data, p);

    popupZonaRenderGrafica(data.catalogo);
    setTimeout(function() {
      popupZonaRenderGrafica(data.catalogo);
    }, 50);

    const resumen = document.getElementById("popupZonaResumenMapa");
    if (resumen) resumen.textContent = popupZonaResumenTexto(data);

    popupZonaActualizarMapa(data);
    popupZonaRefrescarMapaVisible();
  } catch (e) {
    const izq = document.getElementById("popupZonaPanelIzq");
    if (izq) {
      izq.innerHTML = `<div class="popup-zona-aviso">${popupZonaEsc(e.message || "Error al consultar zona homogénea.")}</div>`;
    }
    const resumen = document.getElementById("popupZonaResumenMapa");
    if (resumen) resumen.textContent = "Error en la consulta.";
  }
}

window.pintarPopupTabZonaHomogenea = pintarPopupTabZonaHomogenea;
window.destruirPopupZonaHomogenea = destruirPopupZonaHomogenea;
window.cargarZonaHomogenea = cargarZonaHomogenea;
window.popupZonaCapturarMapaDataUrl = popupZonaCapturarMapaDataUrl;
window.popupZonaImprimirPlano = popupZonaImprimirPlano;
window.togglePopupZonaCapasMenu = togglePopupZonaCapasMenu;
window.togglePopupZonaCapa = togglePopupZonaCapa;
window.popupZonaCambiarOpacidadCapa = popupZonaCambiarOpacidadCapa;
window.popupZonaSubirCapa = popupZonaSubirCapa;
window.popupZonaBajarCapa = popupZonaBajarCapa;
window.setPopupZonaBaseLayer = setPopupZonaBaseLayer;
window.popupZonaNormalizarAtributos = popupZonaNormalizarAtributos;
window.popupZonaRenderGrafica = popupZonaRenderGrafica;
window.extentCentradoPredioYZona = extentCentradoPredioYZona;
window.popupZonaOcultarTooltip = popupZonaOcultarTooltip;
