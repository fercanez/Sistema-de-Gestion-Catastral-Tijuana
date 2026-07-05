/* Números oficiales — colindantes y predios cercanos en mapa */

const POPUP_NUMOF_LIMITE_MISMA = 25;
const POPUP_NUMOF_LIMITE_OTRAS = 10;
const POPUP_NUMOF_GEONODE_WMS = "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const POPUP_NUMOF_CATASTRO_WMS = "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";

let popupNumofMap = null;
let popupNumofCapas = null;
let popupNumofClaveActual = "";
let popupNumofDatos = null;
let popupNumofFilaActiva = "";
let popupNumofCapasManager = null;

const POPUP_NUMOF_CAPA_ORDEN_DEF = {
  consultado: 35,
  codigos: 28,
  otra: 14,
  misma: 12,
  predios: 8,
  colonias: 5
};

const POPUP_NUMOF_CAPA_PROP = {
  consultado: "consultado",
  misma: "mismaCalle",
  otra: "otraCalle",
  predios: "prediosWms",
  codigos: "codigosWms",
  colonias: "coloniasWms"
};

function popupNumofSufijoValido(valor) {
  const v = String(valor ?? "").trim();
  if (!v) return "";
  const upper = v.toUpperCase();
  if (upper === "0" || upper === "00" || upper === "NULL" || upper === "—" || upper === "-") {
    return "";
  }
  if (/^\d+$/.test(v) && Number(v) === 0) return "";
  return v;
}

function popupNumofEtiqueta(props) {
  const num = String(props?.numof ?? "").trim();
  if (!num) return "";
  const letra = popupNumofSufijoValido(props?.letra);
  const numint = popupNumofSufijoValido(props?.numint);
  const sufijo = letra || numint;
  return sufijo ? `${num}-${sufijo}` : num;
}

function popupNumofEsc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function popupNumofFormatDistancia(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return "—";
  return n < 10 ? `${n.toFixed(1)} m` : `${Math.round(n)} m`;
}

function popupNumofEstiloVector(tipo, props) {
  const etiqueta = tipo === "consultado"
    ? (popupNumofEtiqueta(props) || "ESTE")
    : popupNumofEtiqueta(props);

  if (tipo === "consultado") {
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
        fill: new ol.style.Fill({ color: "rgba(37, 99, 235, 0.48)" }),
        text: new ol.style.Text({
          text: etiqueta,
          font: "bold 14px Arial",
          fill: new ol.style.Fill({ color: "#ffffff" }),
          stroke: new ol.style.Stroke({ color: "#1e3a8a", width: 4 }),
          overflow: true
        })
      })
    ];
  }

  let stroke = "#ea580c";
  let fill = "rgba(234, 88, 12, 0.22)";
  let width = 2;
  let zIndex = 12;
  let font = "bold 12px Arial";
  if (tipo === "misma") {
    stroke = "#15803d";
    fill = "rgba(21, 128, 61, 0.24)";
    zIndex = 10;
  }
  return new ol.style.Style({
    zIndex,
    stroke: new ol.style.Stroke({ color: stroke, width }),
    fill: new ol.style.Fill({ color: fill }),
    text: new ol.style.Text({
      text: etiqueta,
      font,
      fill: new ol.style.Fill({ color: "#111827" }),
      stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
      overflow: true
    })
  });
}

function popupNumofCrearCapas() {
  const capas = {
    googleHybrid: new ol.layer.Tile({
      visible: true,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        attributions: "Google"
      })
    }),
    googleSat: new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        attributions: "Google"
      })
    }),
    googleRoad: new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
        attributions: "Google"
      })
    }),
    esri: new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attributions: "Esri"
      })
    }),
    osm: new ol.layer.Tile({
      visible: false,
      source: new ol.source.OSM()
    }),
    prediosWms: new ol.layer.Tile({
      visible: true,
      opacity: 0.85,
      zIndex: POPUP_NUMOF_CAPA_ORDEN_DEF.predios,
      source: new ol.source.TileWMS({
        url: "https://fcnarqnodo.hopto.org/geoserver/geonode/wms",
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
    coloniasWms: new ol.layer.Tile({
      visible: false,
      opacity: 0.55,
      zIndex: POPUP_NUMOF_CAPA_ORDEN_DEF.colonias,
      source: new ol.source.TileWMS({
        url: POPUP_NUMOF_GEONODE_WMS,
        params: {
          LAYERS: "geonode:colonias_tij",
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    codigosWms: new ol.layer.Tile({
      visible: true,
      opacity: 1,
      zIndex: POPUP_NUMOF_CAPA_ORDEN_DEF.codigos,
      source: new ol.source.TileWMS({
        url: POPUP_NUMOF_GEONODE_WMS,
        params: {
          LAYERS: "codigos_postales_bc_utm1",
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    consultado: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_NUMOF_CAPA_ORDEN_DEF.consultado,
      source: new ol.source.Vector(),
      style: function(feature) {
        return popupNumofEstiloVector("consultado", feature.getProperties());
      }
    }),
    mismaCalle: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_NUMOF_CAPA_ORDEN_DEF.misma,
      source: new ol.source.Vector(),
      style: function(feature) {
        return popupNumofEstiloVector("misma", feature.getProperties());
      }
    }),
    otraCalle: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_NUMOF_CAPA_ORDEN_DEF.otra,
      source: new ol.source.Vector(),
      style: function(feature) {
        return popupNumofEstiloVector("otra", feature.getProperties());
      }
    })
  };
  return capas;
}

function htmlMenuCapasPopupNumof() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "consultado", checkboxId: "popupNumofChkConsultado", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "codigos", checkboxId: "popupNumofChkCodigosWms", dotClass: "dot-orange", label: "Códigos postales", checked: true, opacity: 100 },
        { id: "otra", checkboxId: "popupNumofChkOtraCalle", dotClass: "dot-amber", label: "Otras calles", checked: true, opacity: 100 },
        { id: "misma", checkboxId: "popupNumofChkMismaCalle", dotClass: "dot-green", label: "Misma calle", checked: true, opacity: 100 },
        { id: "predios", checkboxId: "popupNumofChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: true, opacity: 85 },
        { id: "colonias", checkboxId: "popupNumofChkColoniasWms", dotClass: "dot-purple", label: "Colonias", checked: false, opacity: 55 }
      ], {
        opPrefix: "popupNumofOp",
        toggleFn: "togglePopupNumofCapa",
        opacityFn: "popupNumofCambiarOpacidadCapa",
        subirFn: "popupNumofSubirCapa",
        bajarFn: "popupNumofBajarCapa"
      })
    : "";

  const basemap = `<div class="popup-capas-seccion">
        <strong>Base mapas</strong>
        <label><input type="radio" name="popupNumofBaseMap" value="googleHybrid" checked onchange="setPopupNumofBaseLayer(this.value)"> Google Satellite &amp; Roads</label>
        <label><input type="radio" name="popupNumofBaseMap" value="googleRoad" onchange="setPopupNumofBaseLayer(this.value)"> Google Road Map</label>
        <label><input type="radio" name="popupNumofBaseMap" value="esri" onchange="setPopupNumofBaseLayer(this.value)"> ESRI Satellite</label>
        <label><input type="radio" name="popupNumofBaseMap" value="osm" onchange="setPopupNumofBaseLayer(this.value)"> Open Street Map</label>
        <label><input type="radio" name="popupNumofBaseMap" value="googleSat" onchange="setPopupNumofBaseLayer(this.value)"> Google Satellite</label>
      </div>`;

  return typeof htmlPopupMapaCapasMenu === "function"
    ? htmlPopupMapaCapasMenu({
        menuId: "popupNumofCapasMenu",
        overlayListId: "popupNumofCapasOverlayList",
        menuClass: "popup-carta-capas-menu popup-numof-capas-menu",
        itemsHtml: capas,
        basemapHtml: basemap
      })
    : "";
}

function popupNumofInicializarCapasManager() {
  if (typeof crearFichaMapaCapasManager !== "function") return;
  popupNumofCapasManager = crearFichaMapaCapasManager({
    ordenDef: POPUP_NUMOF_CAPA_ORDEN_DEF,
    capaProp: POPUP_NUMOF_CAPA_PROP,
    chkMap: {
      consultado: "popupNumofChkConsultado",
      misma: "popupNumofChkMismaCalle",
      otra: "popupNumofChkOtraCalle",
      predios: "popupNumofChkPrediosWms",
      codigos: "popupNumofChkCodigosWms",
      colonias: "popupNumofChkColoniasWms"
    },
    optionalIds: ["colonias"],
    getCapas: () => popupNumofCapas,
    getMap: () => popupNumofMap,
    overlayListId: "popupNumofCapasOverlayList",
    opPrefix: "popupNumofOp"
  });
  popupNumofCapasManager.inicializar();
}

function popupNumofCambiarOpacidadCapa(id, valor) {
  popupNumofCapasManager?.cambiarOpacidad(id, valor);
}

function popupNumofSubirCapa(id) {
  popupNumofCapasManager?.subir(id);
}

function popupNumofBajarCapa(id) {
  popupNumofCapasManager?.bajar(id);
}

function togglePopupNumofCapasMenu(ev) {
  togglePopupMapaCapasMenu("popupNumofCapasMenu", ev);
}

function setPopupNumofBaseLayer(valor) {
  if (!popupNumofCapas) return;
  ["googleHybrid", "googleSat", "googleRoad", "esri", "osm"].forEach(id => {
    if (popupNumofCapas[id]) popupNumofCapas[id].setVisible(id === valor);
  });
  if (popupNumofMap) popupNumofMap.render();
}

function togglePopupNumofCapa(tipo) {
  if (popupNumofCapasManager) {
    popupNumofCapasManager.toggle(tipo);
    return;
  }
  if (!popupNumofCapas) return;
  if (tipo === "consultado") {
    popupNumofCapas.consultado.setVisible(
      document.getElementById("popupNumofChkConsultado")?.checked !== false
    );
  } else if (tipo === "misma") {
    popupNumofCapas.mismaCalle.setVisible(
      document.getElementById("popupNumofChkMismaCalle")?.checked !== false
    );
  } else if (tipo === "otra") {
    popupNumofCapas.otraCalle.setVisible(
      document.getElementById("popupNumofChkOtraCalle")?.checked !== false
    );
  } else if (tipo === "predios") {
    popupNumofCapas.prediosWms.setVisible(
      document.getElementById("popupNumofChkPrediosWms")?.checked !== false
    );
  } else if (tipo === "codigos") {
    popupNumofCapas.codigosWms.setVisible(
      document.getElementById("popupNumofChkCodigosWms")?.checked !== false
    );
  } else if (tipo === "colonias") {
    popupNumofCapas.coloniasWms.setVisible(
      document.getElementById("popupNumofChkColoniasWms")?.checked === true
    );
  }
  if (popupNumofMap) popupNumofMap.render();
}

function popupNumofExtraerCpDeProps(props) {
  if (!props) return "";
  const keys = ["cp", "codigo_postal", "d_cp", "d_codigo", "codigo", "CODIGO_POSTAL", "CP", "codpost"];
  for (const k of keys) {
    const v = String(props[k] ?? "").trim();
    if (v && v.toLowerCase() !== "null") return v;
  }
  for (const [k, v] of Object.entries(props)) {
    if (/cp|postal|codigo/i.test(k) && v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

async function consultarCodigoPostalPredio(lon, lat, mapInst) {
  if (lon == null || lat == null || Number.isNaN(Number(lon)) || Number.isNaN(Number(lat))) return "";
  try {
    const coord = ol.proj.fromLonLat([Number(lon), Number(lat)]);
    const view = mapInst?.getView?.();
    const resolution = view?.getResolution?.() || 1;
    const projection = view?.getProjection?.() || ol.proj.get("EPSG:3857");
    const source = popupNumofCapas?.codigosWms?.getSource?.() || new ol.source.TileWMS({
      url: POPUP_NUMOF_GEONODE_WMS,
      params: { LAYERS: "codigos_postales_bc_utm1", VERSION: "1.1.1" },
      serverType: "geoserver"
    });
    const url = source.getFeatureInfoUrl(coord, resolution, projection, {
      INFO_FORMAT: "application/json",
      FEATURE_COUNT: 5,
      QUERY_LAYERS: "codigos_postales_bc_utm1"
    });
    if (!url) return "";
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return "";
    const data = await r.json();
    for (const f of data.features || []) {
      const cp = popupNumofExtraerCpDeProps(f.properties);
      if (cp) return cp;
    }
  } catch (e) {
    console.warn("No se pudo consultar código postal WMS:", e);
  }
  return "";
}

async function popupNumofCompletarCodigoPostal(data, p) {
  if (!data?.consultado) return data;
  const cpActual = String(data.consultado.cp || p?.cp || "").trim();
  if (cpActual) {
    data.consultado.cp = cpActual;
    return data;
  }
  let lon = null;
  let lat = null;
  const featConsultado = (data.features || []).find(f => f.properties?.es_consultado);
  if (featConsultado?.geometry && typeof ol !== "undefined") {
    try {
      const format = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      const geom = format.readFeature(featConsultado).getGeometry();
      const c = ol.extent.getCenter(geom.getExtent());
      [lon, lat] = ol.proj.toLonLat(c);
    } catch (e) {}
  }
  if ((lon == null || lat == null) && typeof obtenerCentroidePredio === "function") {
    const c = obtenerCentroidePredio(data.clave_catastral);
    lon = c.lon;
    lat = c.lat;
  }
  const cp = await consultarCodigoPostalPredio(lon, lat, popupNumofMap);
  if (cp) data.consultado.cp = cp;
  return data;
}

function destruirPopupNumerosOficiales() {
  if (popupNumofMap) {
    popupNumofMap.setTarget(null);
    popupNumofMap = null;
  }
  popupNumofCapas = null;
  popupNumofCapasManager = null;
  popupNumofClaveActual = "";
  popupNumofDatos = null;
  popupNumofFilaActiva = "";
}

function popupNumofQueryLimites() {
  return `limite_misma_calle=${POPUP_NUMOF_LIMITE_MISMA}&limite_otras_calles=${POPUP_NUMOF_LIMITE_OTRAS}`;
}

function popupNumofAplicarLimitesCercanos(items, calleRef) {
  const calleNorm = String(calleRef || "").trim().toUpperCase();
  const pool = (items || []).map(it => ({
    ...it,
    misma_calle: calleNorm !== "" && String(it.calle || "").trim().toUpperCase() === calleNorm
  }));
  pool.sort((a, b) => (a.distancia_m || 0) - (b.distancia_m || 0));

  const misma = pool.filter(i => i.misma_calle).slice(0, POPUP_NUMOF_LIMITE_MISMA);
  const clavesMisma = new Set(misma.map(i => i.clave_catastral));
  const otras = pool
    .filter(i => !i.misma_calle && !clavesMisma.has(i.clave_catastral))
    .slice(0, POPUP_NUMOF_LIMITE_OTRAS);

  return [...misma, ...otras].sort((a, b) => (a.distancia_m || 0) - (b.distancia_m || 0));
}

function popupNumofArmarRespuesta(claveNorm, consultado, cercanos, features, origen) {
  const totalMisma = cercanos.filter(c => c.misma_calle).length;
  const totalOtras = cercanos.length - totalMisma;
  return {
    clave_catastral: claveNorm,
    limite_misma_calle: POPUP_NUMOF_LIMITE_MISMA,
    limite_otras_calles: POPUP_NUMOF_LIMITE_OTRAS,
    total_misma_calle: totalMisma,
    total_otras_calles: totalOtras,
    total: cercanos.length,
    consultado,
    cercanos,
    type: "FeatureCollection",
    features,
    origen: origen || null
  };
}

async function popupNumofFetchJson(url) {
  const r = await fetch(url, {
    headers: typeof authHeaders === "function" ? authHeaders() : {},
    cache: "no-store"
  });
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try {
      const err = await r.json();
      if (typeof err.detail === "string") msg = err.detail;
      else if (Array.isArray(err.detail)) msg = err.detail.map(d => d.msg || d).join("; ");
    } catch (e) {}
    const error = new Error(msg);
    error.status = r.status;
    throw error;
  }
  return r.json();
}

async function cargarNumerosOficialesCercanosFallback(claveNorm, p) {
  const featureConsultado = await popupNumofFetchJson(
    `${API}/predios/${encodeURIComponent(claveNorm)}/geojson?_=${Date.now()}`
  );
  if (!featureConsultado?.geometry) {
    throw new Error("Predio sin geometría cartográfica");
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });
  const geomConsultado = format.readFeature(featureConsultado).getGeometry();
  if (!geomConsultado) throw new Error("No se pudo leer la geometría del predio");

  const center3857 = ol.extent.getCenter(geomConsultado.getExtent());
  const [lon, lat] = ol.proj.toLonLat(center3857);
  const calleRef = String(p?.calle || "").trim();

  const consultado = {
    clave_catastral: claveNorm,
    numof: String(p?.numof || "").trim(),
    numint: String(p?.numint || "").trim(),
    letra: String(p?.letra || "").trim(),
    cp: String(p?.cp || "").trim(),
    calle: calleRef,
    colonia: String(p?.colonia || "").trim(),
    distancia_m: 0,
    misma_calle: true
  };

  let candidatos = [];
  for (const radio of [150, 250, 400, 500, 700]) {
    try {
      const fc = await popupNumofFetchJson(
        `${API}/predios/cercanos?lon=${lon}&lat=${lat}&radio=${radio}&_=${Date.now()}`
      );
      candidatos = fc?.features || [];
      if (candidatos.length >= 80) break;
    } catch (e) {
      if (radio >= 500) continue;
      throw e;
    }
  }

  const pool = [];
  for (const f of candidatos) {
    const props = f.properties || {};
    const cl = String(props.clave_catastral || "").trim().toUpperCase();
    if (!cl || cl === claveNorm) continue;

    let numof = String(props.numof || "").trim();
    let calle = String(props.calle || "").trim();
    let colonia = String(props.colonia || "").trim();
    let numint = String(props.numint || "").trim();
    let letra = String(props.letra || "").trim();
    let cp = String(props.cp || "").trim();

    if (!numof) {
      try {
        const ficha = await popupNumofFetchJson(
          `${API}/padron/${encodeURIComponent(cl)}/ficha?_=${Date.now()}`
        );
        numof = String(ficha.numof || "").trim();
        calle = calle || String(ficha.calle || "").trim();
        colonia = colonia || String(ficha.colonia || "").trim();
        numint = numint || String(ficha.numint || "").trim();
        letra = letra || String(ficha.letra || "").trim();
        cp = cp || String(ficha.cp || "").trim();
      } catch (e) {
        continue;
      }
    }
    if (!numof) continue;

    let distancia_m = Number(props.distancia_m);
    if (!Number.isFinite(distancia_m) && f.geometry) {
      try {
        const g2 = format.readFeature({ type: "Feature", geometry: f.geometry }).getGeometry();
        const c2 = ol.extent.getCenter(g2.getExtent());
        distancia_m = Math.round(ol.coordinate.dist(center3857, c2));
      } catch (e) {
        distancia_m = 0;
      }
    }

    pool.push({
      clave_catastral: cl,
      numof,
      numint,
      letra,
      cp,
      calle,
      colonia,
      distancia_m,
      geometry: f.geometry || null
    });
  }

  const cercanos = popupNumofAplicarLimitesCercanos(pool, calleRef);
  const features = [{
    type: "Feature",
    geometry: featureConsultado.geometry,
    properties: { ...consultado, es_consultado: true }
  }];

  cercanos.forEach(item => {
    if (!item.geometry) return;
    features.push({
      type: "Feature",
      geometry: item.geometry,
      properties: {
        clave_catastral: item.clave_catastral,
        numof: item.numof,
        numint: item.numint,
        letra: item.letra,
        cp: item.cp,
        calle: item.calle,
        colonia: item.colonia,
        distancia_m: item.distancia_m,
        misma_calle: item.misma_calle,
        es_consultado: false
      }
    });
  });

  return popupNumofArmarRespuesta(claveNorm, consultado, cercanos, features, "fallback");
}

async function cargarNumerosOficialesCercanos(clave, p) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;

  const qs = popupNumofQueryLimites();
  const urls = [
    `${API}/padron/${encodeURIComponent(claveNorm)}/numeros-oficiales-cercanos?${qs}`,
    `${API}/predios/${encodeURIComponent(claveNorm)}/numeros-oficiales-cercanos?${qs}`
  ];

  let ultimoError = null;
  for (const baseUrl of urls) {
    try {
      return await popupNumofFetchJson(`${baseUrl}&_=${Date.now()}`);
    } catch (e) {
      ultimoError = e;
    }
  }

  try {
    return await cargarNumerosOficialesCercanosFallback(claveNorm, p);
  } catch (e) {
    if (ultimoError && String(ultimoError.message || "").toLowerCase() === "not found") {
      throw new Error(
        "No se pudo consultar números oficiales. Despliegue routers/padron.py y reinicie: systemctl restart catastro-tijuana-api"
      );
    }
    throw e;
  }
}

function popupNumofHtmlTabla(cercanos) {
  if (!cercanos?.length) {
    return `<tr><td colspan="6" class="popup-numof-vacio">No hay otros predios con número oficial cercanos.</td></tr>`;
  }
  return cercanos.map((item, idx) => {
    const clave = popupNumofEsc(item.clave_catastral);
    const numof = popupNumofEsc(popupNumofEtiqueta(item) || item.numof || "—");
    const calle = popupNumofEsc(item.calle || "—");
    const colonia = popupNumofEsc(item.colonia || "—");
    const dist = popupNumofEsc(popupNumofFormatDistancia(item.distancia_m));
    const tipo = item.misma_calle
      ? `<span class="popup-numof-badge popup-numof-badge-misma">Misma calle</span>`
      : `<span class="popup-numof-badge popup-numof-badge-otra">Otra calle</span>`;
    return `
      <tr class="popup-numof-fila" data-clave="${clave}" onclick="popupNumofSeleccionarFila('${clave}')">
        <td>${idx + 1}</td>
        <td><strong>${numof}</strong></td>
        <td>${calle}</td>
        <td>${colonia}</td>
        <td>${dist}</td>
        <td>${tipo}</td>
      </tr>`;
  }).join("");
}

function popupNumofResumenTexto(data) {
  const misma = data?.total_misma_calle ?? (data?.cercanos || []).filter(c => c.misma_calle).length;
  const otras = data?.total_otras_calles ?? (data?.cercanos || []).filter(c => !c.misma_calle).length;
  const origen = data?.origen === "fallback" ? " · compatibilidad" : "";
  return `${misma} misma calle · ${otras} otras calles${origen}`;
}

function popupNumofActualizarMapa(data) {
  const target = document.getElementById("popupNumofMap");
  if (!target || !data?.features?.length) {
    if (target) {
      target.innerHTML = `<div class="popup-mini-map-vacio">Sin geometría para mostrar números oficiales.</div>`;
    }
    return;
  }

  if (!popupNumofMap) {
    target.innerHTML = `<div id="popupNumofMapCanvas" class="popup-numof-mapa-canvas"></div>`;
    popupNumofCapas = popupNumofCrearCapas();
    popupNumofMap = new ol.Map({
      target: "popupNumofMapCanvas",
      layers: [
        popupNumofCapas.googleHybrid,
        popupNumofCapas.googleSat,
        popupNumofCapas.googleRoad,
        popupNumofCapas.esri,
        popupNumofCapas.osm,
        popupNumofCapas.prediosWms,
        popupNumofCapas.coloniasWms,
        popupNumofCapas.mismaCalle,
        popupNumofCapas.otraCalle,
        popupNumofCapas.consultado,
        popupNumofCapas.codigosWms
      ],
      controls: (function() {
        if (ol.control?.defaults?.defaults) {
          return ol.control.defaults.defaults({ zoom: true, rotate: false, attribution: false });
        }
        if (typeof ol.control?.defaults === "function") {
          return ol.control.defaults({ zoom: true, rotate: false, attribution: false });
        }
        return [new ol.control.Zoom()];
      })()
    });
    popupNumofInicializarCapasManager();
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });

  popupNumofCapas.consultado.getSource().clear();
  popupNumofCapas.mismaCalle.getSource().clear();
  popupNumofCapas.otraCalle.getSource().clear();

  const grupos = { consultado: [], misma: [], otra: [] };
  (data.features || []).forEach(f => {
    const props = f.properties || {};
    if (props.es_consultado) grupos.consultado.push(f);
    else if (props.misma_calle) grupos.misma.push(f);
    else grupos.otra.push(f);
  });

  if (grupos.consultado.length) {
    popupNumofCapas.consultado.getSource().addFeatures(format.readFeatures({
      type: "FeatureCollection",
      features: grupos.consultado
    }));
  }
  if (grupos.misma.length) {
    popupNumofCapas.mismaCalle.getSource().addFeatures(format.readFeatures({
      type: "FeatureCollection",
      features: grupos.misma
    }));
  }
  if (grupos.otra.length) {
    popupNumofCapas.otraCalle.getSource().addFeatures(format.readFeatures({
      type: "FeatureCollection",
      features: grupos.otra
    }));
  }

  const extent = ol.extent.createEmpty();
  [popupNumofCapas.consultado, popupNumofCapas.mismaCalle, popupNumofCapas.otraCalle].forEach(layer => {
    ol.extent.extend(extent, layer.getSource().getExtent());
  });

  if (extent && Number.isFinite(extent[0])) {
    popupNumofMap.updateSize();
    popupNumofMap.getView().fit(extent, {
      padding: [36, 36, 36, 36],
      maxZoom: 19,
      duration: 280
    });
  }
}

function popupNumofSeleccionarFila(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  popupNumofFilaActiva = claveNorm;
  document.querySelectorAll(".popup-numof-fila").forEach(row => {
    row.classList.toggle("popup-numof-fila-activa", row.dataset.clave === claveNorm);
  });
  if (!popupNumofMap || !popupNumofCapas) return;

  const capas = [popupNumofCapas.consultado, popupNumofCapas.mismaCalle, popupNumofCapas.otraCalle];
  let feature = null;
  for (const layer of capas) {
    feature = layer.getSource().getFeatures().find(f =>
      String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
    );
    if (feature) break;
  }
  if (!feature) return;
  const geom = feature.getGeometry();
  if (!geom) return;
  popupNumofMap.getView().fit(geom.getExtent(), {
    padding: [48, 48, 48, 48],
    maxZoom: 20,
    duration: 250
  });
}

function popupNumofHtmlDatosConsultado(p, consultado) {
  const c = consultado || {};
  const val = typeof popupVal === "function" ? popupVal : (v) => (v == null || v === "" ? "—" : v);
  const campos = typeof popupCampo === "function"
    ? [
        popupCampo("Número oficial", c.numof || p?.numof),
        popupCampo("Número interior", c.numint || p?.numint),
        popupCampo("Letra", c.letra || p?.letra),
        popupCampo("Código postal", c.cp || p?.cp),
        popupCampo("Calle", c.calle || p?.calle),
        popupCampo("Colonia", c.colonia || p?.colonia)
      ].join("")
    : `
      <div><span>Número oficial</span><strong>${val(c.numof || p?.numof)}</strong></div>
      <div><span>Calle</span><strong>${val(c.calle || p?.calle)}</strong></div>
      <div><span>Colonia</span><strong>${val(c.colonia || p?.colonia)}</strong></div>`;

  return `
    <section class="popup-numof-datos">
      <h4>Predio consultado</h4>
      <div class="popup-datos-form popup-legacy-form">${campos}</div>
    </section>`;
}

async function pintarPopupTabNumerosOficiales(p) {
  const panel = document.getElementById("popupTabNumerosOficiales");
  if (!panel) return;

  const claveNorm = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  destruirPopupNumerosOficiales();
  popupNumofClaveActual = claveNorm;

  panel.innerHTML = `
    <div class="popup-numof-layout">
      <div class="popup-numof-panel-izq">
        ${popupNumofHtmlDatosConsultado(p, null)}
        <section class="popup-numof-lista">
          <div class="popup-numof-lista-head">
            <h4>Números oficiales cercanos</h4>
            <span id="popupNumofResumen">Consultando…</span>
          </div>
          <div class="popup-numof-tabla-wrap">
            <table class="popup-numof-tabla">
              <thead>
                <tr>
                  <th>#</th>
                  <th>No. of.</th>
                  <th>Calle</th>
                  <th>Colonia</th>
                  <th>Dist.</th>
                  <th>Ubicación</th>
                </tr>
              </thead>
              <tbody id="popupNumofTablaBody">
                <tr><td colspan="6" class="popup-numof-vacio">Cargando predios cercanos…</td></tr>
              </tbody>
            </table>
          </div>
          <div class="popup-numof-leyenda">
            <span><i class="popup-numof-swatch popup-numof-swatch-consultado"></i> Predio consultado</span>
            <span><i class="popup-numof-swatch popup-numof-swatch-misma"></i> Misma calle (hasta ${POPUP_NUMOF_LIMITE_MISMA})</span>
            <span><i class="popup-numof-swatch popup-numof-swatch-otra"></i> Otras calles (hasta ${POPUP_NUMOF_LIMITE_OTRAS})</span>
          </div>
        </section>
      </div>
      <div class="popup-numof-mapa-panel">
        <div class="popup-numof-mapa-head">
          <div class="popup-numof-mapa-head-text">
            <strong>Plano de números oficiales</strong>
            <span>Hasta ${POPUP_NUMOF_LIMITE_MISMA} en la misma calle y ${POPUP_NUMOF_LIMITE_OTRAS} repartidos en calles vecinas.</span>
          </div>
          <div class="popup-numof-mapa-head-actions">
            <button type="button" class="popup-btn-imprimir-ficha popup-btn-numof-ficha" onclick="abrirPreviewFichaNumeroOficial()">Imprimir / Ficha</button>
            <button type="button" class="popup-btn-capas" onclick="togglePopupNumofCapasMenu(event)">Capas</button>
          </div>
        </div>
        <div class="popup-numof-mapa-body">
          <div id="popupNumofMap" class="popup-numof-mapa">
            <div class="popup-mini-map-vacio">Cargando mapa…</div>
          </div>
          ${htmlMenuCapasPopupNumof()}
        </div>
      </div>
    </div>`;

  if (!claveNorm) {
    document.getElementById("popupNumofResumen").textContent = "Sin clave catastral.";
    return;
  }

  try {
    let data = await cargarNumerosOficialesCercanos(claveNorm, p);
    if (popupNumofClaveActual !== claveNorm) return;

    popupNumofActualizarMapa(data);
    data = await popupNumofCompletarCodigoPostal(data, p);
    popupNumofDatos = data;

    const tbody = document.getElementById("popupNumofTablaBody");
    const resumen = document.getElementById("popupNumofResumen");
    const datosWrap = panel.querySelector(".popup-numof-datos");
    if (datosWrap && data.consultado) {
      datosWrap.outerHTML = popupNumofHtmlDatosConsultado(p, data.consultado);
    }

    if (tbody) tbody.innerHTML = popupNumofHtmlTabla(data.cercanos || []);
    if (resumen) resumen.textContent = popupNumofResumenTexto(data);
  } catch (e) {
    if (popupNumofClaveActual !== claveNorm) return;
    const tbody = document.getElementById("popupNumofTablaBody");
    const resumen = document.getElementById("popupNumofResumen");
    const mapEl = document.getElementById("popupNumofMap");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="popup-numof-vacio">${popupNumofEsc(e.message || "No se pudieron cargar los números oficiales.")}</td></tr>`;
    }
    if (resumen) resumen.textContent = "Error al consultar";
    if (mapEl) {
      mapEl.innerHTML = `<div class="popup-mini-map-vacio">${popupNumofEsc(e.message || "Sin datos cartográficos.")}</div>`;
    }
  }
}

function popupNumofCapturarMapaInstancia(mapInst, timeoutMs) {
  timeoutMs = timeoutMs || 4500;
  if (!mapInst || typeof mapInst.once !== "function") {
    return Promise.resolve(null);
  }
  return new Promise(function(resolve) {
    let resuelto = false;
    function finalizar(img) {
      if (!resuelto) {
        resuelto = true;
        resolve(img);
      }
    }
    setTimeout(function() { finalizar(null); }, timeoutMs);
    try {
      const target = mapInst.getTargetElement ? mapInst.getTargetElement() : null;
      mapInst.once("rendercomplete", function() {
        try {
          const size = mapInst.getSize();
          if (!size || !size[0] || !size[1]) {
            finalizar(null);
            return;
          }
          const canvasFinal = document.createElement("canvas");
          canvasFinal.width = size[0];
          canvasFinal.height = size[1];
          const ctx = canvasFinal.getContext("2d");
          const scope = target || document;
          Array.prototype.forEach.call(scope.querySelectorAll(".ol-layer canvas, canvas.ol-layer"), function(canvas) {
            try {
              if (canvas.width > 0) {
                const opacity = canvas.parentNode.style.opacity || canvas.style.opacity;
                ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
                let matrix;
                const transform = canvas.style.transform;
                if (transform && transform.startsWith("matrix")) {
                  matrix = transform.match(/^matrix\(([^\(]*)\)$/)[1].split(",").map(Number);
                } else {
                  matrix = [1, 0, 0, 1, 0, 0];
                }
                CanvasRenderingContext2D.prototype.setTransform.apply(ctx, matrix);
                ctx.drawImage(canvas, 0, 0);
              }
            } catch (e) {}
          });
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          finalizar(canvasFinal.toDataURL("image/png"));
        } catch (e) {
          finalizar(null);
        }
      });
      mapInst.updateSize();
      try { mapInst.renderSync(); } catch (e) {}
    } catch (e) {
      finalizar(null);
    }
  });
}

function popupNumofCapturarMapaDataUrl(timeoutMs) {
  return popupNumofCapturarMapaInstancia(popupNumofMap, timeoutMs);
}

function popupNumofPoblarCapasDesdeData(capas, data) {
  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });
  capas.consultado.getSource().clear();
  capas.mismaCalle.getSource().clear();
  capas.otraCalle.getSource().clear();

  const grupos = { consultado: [], misma: [], otra: [] };
  (data?.features || []).forEach(function(f) {
    const props = f.properties || {};
    if (props.es_consultado) grupos.consultado.push(f);
    else if (props.misma_calle) grupos.misma.push(f);
    else grupos.otra.push(f);
  });

  if (grupos.consultado.length) {
    capas.consultado.getSource().addFeatures(format.readFeatures({
      type: "FeatureCollection",
      features: grupos.consultado
    }));
  }
  if (grupos.misma.length) {
    capas.mismaCalle.getSource().addFeatures(format.readFeatures({
      type: "FeatureCollection",
      features: grupos.misma
    }));
  }
  if (grupos.otra.length) {
    capas.otraCalle.getSource().addFeatures(format.readFeatures({
      type: "FeatureCollection",
      features: grupos.otra
    }));
  }

  const extent = ol.extent.createEmpty();
  [capas.consultado, capas.mismaCalle, capas.otraCalle].forEach(function(layer) {
    ol.extent.extend(extent, layer.getSource().getExtent());
  });
  return extent;
}

function popupNumofEsperarRenderMapa(mapInst, ciclos, pausaMs) {
  ciclos = ciclos || 4;
  pausaMs = pausaMs || 500;
  return new Promise(function(resolve) {
    if (!mapInst) {
      resolve();
      return;
    }
    let count = 0;
    function tick() {
      mapInst.updateSize();
      try { mapInst.renderSync(); } catch (e) {}
      mapInst.once("rendercomplete", function() {
        count++;
        if (count >= ciclos) {
          setTimeout(resolve, pausaMs);
        } else {
          setTimeout(tick, pausaMs);
        }
      });
    }
    tick();
  });
}

function popupNumofCentrarMapaEnExtent(mapInst, extent) {
  if (!mapInst || !extent || !Number.isFinite(extent[0])) return;
  mapInst.updateSize();
  mapInst.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 19, duration: 0 });
}

function popupNumofCrearHostMapaCedula() {
  const prev = document.getElementById("numofCedulaPdfHost");
  if (prev) prev.remove();

  const host = document.createElement("div");
  host.id = "numofCedulaPdfHost";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:0;top:0;width:920px;height:540px;opacity:0.02;pointer-events:none;z-index:2147483000;overflow:hidden;background:#cbd5e1;";
  const target = document.createElement("div");
  target.style.width = "100%";
  target.style.height = "100%";
  host.appendChild(target);
  document.body.appendChild(host);
  return { host, target };
}

function popupNumofDestruirMapaCedula(mapInst, host) {
  if (mapInst) {
    try {
      mapInst.setTarget(null);
      mapInst.dispose();
    } catch (e) {}
  }
  if (host) host.remove();
}

function popupNumofConfigurarBaseEsri(capas) {
  capas.googleHybrid.setVisible(false);
  capas.googleSat.setVisible(false);
  capas.googleRoad.setVisible(false);
  capas.osm.setVisible(false);
  capas.esri.setVisible(true);
}

async function popupNumofCapturarMapaCedula(mapInst) {
  if (typeof capturarMapaOlParaPDF === "function") {
    const imgOl = await capturarMapaOlParaPDF(mapInst, 12000);
    if (imgOl) return imgOl;
  }
  return popupNumofCapturarMapaInstancia(mapInst, 12000);
}

async function popupNumofRenderMapaCedulaEnHost(target, capas, extent, soloVectores) {
  if (soloVectores) {
    target.style.background = "#cbd5e1";
  } else {
    popupNumofConfigurarBaseEsri(capas);
  }

  const layers = soloVectores
    ? [capas.mismaCalle, capas.otraCalle, capas.consultado]
    : [
      capas.googleHybrid,
      capas.googleSat,
      capas.googleRoad,
      capas.esri,
      capas.osm,
      capas.prediosWms,
      capas.coloniasWms,
      capas.mismaCalle,
      capas.otraCalle,
      capas.consultado,
      capas.codigosWms
    ];

  const mapInst = new ol.Map({ target: target, layers: layers, controls: [] });
  popupNumofCentrarMapaEnExtent(mapInst, extent);
  await popupNumofEsperarRenderMapa(mapInst, soloVectores ? 2 : 5, soloVectores ? 350 : 650);
  const img = await popupNumofCapturarMapaCedula(mapInst);
  popupNumofDestruirMapaCedula(mapInst, null);
  return img;
}

async function generarMapaNumofCedulaPdf(clave, predioOpt) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm || typeof ol === "undefined" || !ol.Map) return null;

  if (popupNumofMap && popupNumofClaveActual === claveNorm && popupNumofDatos?.features?.length) {
    try {
      const ext = ol.extent.createEmpty();
      [popupNumofCapas.consultado, popupNumofCapas.mismaCalle, popupNumofCapas.otraCalle].forEach(function(layer) {
        ol.extent.extend(ext, layer.getSource().getExtent());
      });
      popupNumofCentrarMapaEnExtent(popupNumofMap, ext);
      await popupNumofEsperarRenderMapa(popupNumofMap, 3, 450);
      const imgPopup = await popupNumofCapturarMapaCedula(popupNumofMap);
      if (imgPopup) return imgPopup;
    } catch (e) {
      console.warn("Cédula numof: captura desde popup:", e);
    }
  }

  let data = null;
  const p = predioOpt || {};
  try {
    data = await cargarNumerosOficialesCercanos(claveNorm, p);
    if (typeof popupNumofCompletarCodigoPostal === "function") {
      data = await popupNumofCompletarCodigoPostal(data, p);
    }
  } catch (e) {
    console.warn("Cédula numof: no se pudo cargar plano:", e);
    return null;
  }
  if (!data?.features?.length) return null;

  const numofMov = String(p.numof || data.consultado?.numof || "").trim();
  if (numofMov) {
    data.features.forEach(function(f) {
      if (f.properties?.es_consultado) f.properties.numof = numofMov;
    });
    if (data.consultado) data.consultado.numof = numofMov;
  }

  const { host, target } = popupNumofCrearHostMapaCedula();
  try {
    const capas = popupNumofCrearCapas();
    const extent = popupNumofPoblarCapasDesdeData(capas, data);
    if (!Number.isFinite(extent[0])) return null;

    let img = await popupNumofRenderMapaCedulaEnHost(target, capas, extent, false);
    if (!img) {
      img = await popupNumofRenderMapaCedulaEnHost(target, capas, extent, true);
    }
    return img;
  } catch (e) {
    console.warn("Cédula numof: error al renderizar plano:", e);
    return null;
  } finally {
    popupNumofDestruirMapaCedula(null, host);
  }
}

window.pintarPopupTabNumerosOficiales = pintarPopupTabNumerosOficiales;
window.destruirPopupNumerosOficiales = destruirPopupNumerosOficiales;
window.popupNumofSeleccionarFila = popupNumofSeleccionarFila;
window.togglePopupNumofCapasMenu = togglePopupNumofCapasMenu;
window.setPopupNumofBaseLayer = setPopupNumofBaseLayer;
window.togglePopupNumofCapa = togglePopupNumofCapa;
window.consultarCodigoPostalPredio = consultarCodigoPostalPredio;
window.popupNumofExtraerCpDeProps = popupNumofExtraerCpDeProps;
window.popupNumofCapturarMapaDataUrl = popupNumofCapturarMapaDataUrl;
window.popupNumofCapturarMapaInstancia = popupNumofCapturarMapaInstancia;
window.generarMapaNumofCedulaPdf = generarMapaNumofCedulaPdf;
