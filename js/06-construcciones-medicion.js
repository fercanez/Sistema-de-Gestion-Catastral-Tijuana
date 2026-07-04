/* Construcciones / Medidas — adaptado de consulta-medicion.php */

let popupConstrMap = null;
let popupConstrDraw = null;
let popupConstrMostrarVertices = true;
let popupConstrPanelMedicionVisible = true;
let popupConstrMedicionLibreVisible = true;
let popupConstrMedicionOpacidad = 1;
let popupConstrMedicionEscala = 1;
let popupConstrGeom3857 = null;
let popupConstrGeom32611 = null;
let popupConstrCapas = null;
let popupConstrCapasManager = null;
let popupConstrClaveActual = "";
let popupConstrProj4Ready = false;
let popupConstrSnapSnapping = false;
let popupConstrDrawSnapCleanup = null;
let popupConstrSnapReloadTimer = null;

const POPUP_CONSTR_CAPA_ORDEN_DEF = {
  vertices: 42,
  medidas: 38,
  medicion: 32,
  medicionEtiquetas: 32,
  predio: 35,
  constrVec: 26,
  construcciones: 18,
  predios: 12,
  colonias: 5
};

const POPUP_CONSTR_CAPA_PROP = {
  predio: "predioVector",
  vertices: "vertices",
  medidas: "medidasPredio",
  medicion: "medicionLibre",
  medicionEtiquetas: "medicionEtiquetas",
  constrVec: "construccionesVector",
  construcciones: "construccionesWms",
  predios: "prediosWms",
  colonias: "coloniasWms"
};

function popupConstrHtmlMenuCapas() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "popupConstrChkPredio", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "vertices", checkboxId: "popupConstrChkVertices", dotClass: "dot-cyan", label: "Vértices", checked: true, opacity: 100 },
        { id: "medidas", checkboxId: "popupConstrChkMedidas", dotClass: "dot-amber", label: "Medidas del predio", checked: true, opacity: 100 },
        { id: "medicion", checkboxId: "popupConstrChkMedicionLibre", dotClass: "dot-orange", label: "Medición libre", checked: true, opacity: 100 },
        { id: "constrVec", checkboxId: "popupConstrChkConstrVec", dotClass: "dot-purple", label: "Construcciones (vector)", checked: true, opacity: 100 },
        { id: "construcciones", checkboxId: "popupConstrChkConstrucciones", dotClass: "dot-green", label: "Construcciones (WMS)", checked: false, opacity: 85 },
        { id: "predios", checkboxId: "popupConstrChkPredios", dotClass: "dot-red", label: "Predios (WMS)", checked: true, opacity: 88 },
        { id: "colonias", checkboxId: "popupConstrChkColonias", dotClass: "dot-green", label: "Colonias", checked: false, opacity: 55 }
      ], {
        opPrefix: "popupConstrOp",
        toggleFn: "popupConstrToggleCapaLayer",
        opacityFn: "popupConstrCambiarOpacidadCapa",
        subirFn: "popupConstrSubirCapa",
        bajarFn: "popupConstrBajarCapa"
      })
    : "";

  const basemap = `<div class="popup-capas-seccion">
              <strong>Base mapas</strong>
              <label><input type="radio" name="popupConstrBase" value="googleHybrid" checked onchange="popupConstrSetBaseLayer(this.value)"> Google Satellite &amp; Roads</label>
              <label><input type="radio" name="popupConstrBase" value="googleSat" onchange="popupConstrSetBaseLayer(this.value)"> Google Satellite</label>
              <label><input type="radio" name="popupConstrBase" value="esri" onchange="popupConstrSetBaseLayer(this.value)"> ESRI Satellite</label>
              <label><input type="radio" name="popupConstrBase" value="osm" onchange="popupConstrSetBaseLayer(this.value)"> OpenStreetMap</label>
            </div>`;

  return typeof htmlPopupMapaCapasMenu === "function"
    ? htmlPopupMapaCapasMenu({
        menuId: "popupConstrCapasMenu",
        overlayListId: "popupConstrCapasOverlayList",
        menuClass: "popup-carta-capas-menu popup-constr-capas-menu",
        itemsHtml: capas,
        basemapHtml: basemap
      })
    : "";
}

function popupConstrInicializarCapasManager() {
  if (typeof crearFichaMapaCapasManager !== "function") return;
  popupConstrCapasManager = crearFichaMapaCapasManager({
    ordenDef: POPUP_CONSTR_CAPA_ORDEN_DEF,
    capaProp: POPUP_CONSTR_CAPA_PROP,
    chkMap: {
      predio: "popupConstrChkPredio",
      predios: "popupConstrChkPredios",
      colonias: "popupConstrChkColonias",
      construcciones: "popupConstrChkConstrucciones",
      constrVec: "popupConstrChkConstrVec",
      medidas: "popupConstrChkMedidas",
      medicion: "popupConstrChkMedicionLibre",
      vertices: "popupConstrChkVertices"
    },
    optionalIds: ["colonias", "construcciones", "constrVec"],
    linkedCapaIds: ["medicion", "medicionEtiquetas"],
    getCapas: () => popupConstrCapas,
    getMap: () => popupConstrMap,
    overlayListId: "popupConstrCapasOverlayList",
    opPrefix: "popupConstrOp"
  });
  popupConstrCapasManager.inicializar();
}

function popupConstrCambiarOpacidadCapa(id, valor) {
  popupConstrCapasManager?.cambiarOpacidad(id, valor);
}

function popupConstrSubirCapa(id) {
  popupConstrCapasManager?.subir(id);
}

function popupConstrBajarCapa(id) {
  popupConstrCapasManager?.bajar(id);
}

function popupConstrToggleCapaLayer(id) {
  if (id === "predio") {
    popupConstrCapasManager?.toggle("predio");
    return;
  }
  if (id === "constrVec") {
    if (popupConstrCapas?.construccionesVector) {
      popupConstrCapasManager?.toggle("constrVec");
    }
    return;
  }
  const legacy = {
    predios: "predios",
    colonias: "colonias",
    construcciones: "construcciones",
    medidas: "medidas",
    medicion: "medicionLibre",
    vertices: "vertices"
  };
  popupConstrToggleCapa(legacy[id] || id);
}

function asegurarProj4Utm11() {
  if (popupConstrProj4Ready) return true;
  try {
    if (typeof proj4 === "undefined") return false;
    proj4.defs("EPSG:32611", "+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs");
    if (ol.proj.proj4 && typeof ol.proj.proj4.register === "function") {
      ol.proj.proj4.register(proj4);
    } else if (typeof ol.proj.register === "function") {
      ol.proj.register(proj4);
    }
    popupConstrProj4Ready = true;
    return true;
  } catch (e) {
    console.warn("No se pudo registrar EPSG:32611:", e);
    return false;
  }
}

function popupConstrGetMainPolygon(geom) {
  if (!geom) return null;
  const type = geom.getType();
  if (type === "Polygon") return geom;
  if (type === "MultiPolygon") {
    const polys = geom.getPolygons();
    return polys.length ? polys[0] : null;
  }
  return null;
}

function popupConstrRad2deg(r) {
  return r * 180 / Math.PI;
}

function popupConstrDms(a) {
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${d}°${m}'${s.toFixed(0)}"`;
}

function popupConstrFormatUtm(value) {
  const s = Number(value).toFixed(3);
  const parts = s.split(".");
  let intPart = parts[0];
  const decPart = parts[1];
  let withSep = "";
  let count = 0;
  for (let i = intPart.length - 1; i >= 0; i--) {
    withSep = intPart[i] + withSep;
    count++;
    if (count === 3 && i !== 0) {
      withSep = "'" + withSep;
      count = 0;
    }
  }
  return `${withSep},${decPart}`;
}

function popupConstrTransformGeom(geom, from, to) {
  if (!geom) return null;
  const clone = geom.clone();
  clone.transform(from, to);
  return clone;
}

function popupConstrCrearCapasMapa() {
  const googleHybrid = new ol.layer.Tile({
    visible: true,
    source: new ol.source.XYZ({
      url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      attributions: "Google"
    })
  });
  const googleSat = new ol.layer.Tile({
    visible: false,
    source: new ol.source.XYZ({
      url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      attributions: "Google"
    })
  });
  const esri = new ol.layer.Tile({
    visible: false,
    source: new ol.source.XYZ({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attributions: "Esri"
    })
  });
  const osm = new ol.layer.Tile({
    visible: false,
    source: new ol.source.OSM()
  });
  const coloniasWms = new ol.layer.Tile({
    visible: false,
    opacity: 0.55,
    source: new ol.source.TileWMS({
      url: "https://fcnarqnodo.hopto.org/geoserver/geonode/wms",
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
  });
  const prediosWms = new ol.layer.Tile({
    visible: true,
    opacity: 0.88,
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
  });
  const construccionesWms = new ol.layer.Tile({
    visible: false,
    opacity: 0.85,
    source: new ol.source.TileWMS({
      url: "https://fcnarqnodo.hopto.org/geoserver/geonode/wms",
      params: {
        LAYERS: "geonode:construcciones_tijuana",
        TILED: true,
        VERSION: "1.1.1",
        FORMAT: "image/png",
        TRANSPARENT: true
      },
      serverType: "geoserver",
      crossOrigin: "anonymous"
    })
  });

  const predioVector = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#0050ff", width: 4, lineDash: [10, 6] }),
      fill: new ol.style.Fill({ color: "rgba(0, 80, 255, 0.18)" })
    })
  });

  const medidasPredio = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: function(f) {
      return new ol.style.Style({
        text: new ol.style.Text({
          text: f.get("texto"),
          font: "bold 12px Arial",
          fill: new ol.style.Fill({ color: "#cc0000" }),
          stroke: new ol.style.Stroke({ color: "#fff", width: 4 }),
          placement: "line"
        })
      });
    }
  });

  const vertices = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: function(feature) {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: "rgba(255,255,255,0)" }),
          stroke: new ol.style.Stroke({ color: "#cc0000", width: 2 })
        }),
        text: new ol.style.Text({
          text: feature.get("etiqueta"),
          font: "bold 12px Arial",
          fill: new ol.style.Fill({ color: "#cc0000" }),
          stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
          textAlign: "center",
          textBaseline: "middle",
          offsetY: -16
        })
      });
    }
  });

  const medicionLibre = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: function(feature) {
      const geom = feature.getGeometry();
      const op = popupConstrMedicionOpacidad;
      const w = 3 * popupConstrMedicionEscala;
      return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: `rgba(204, 0, 0, ${op})`, width: w }),
        fill: geom && geom.getType() === "Polygon"
          ? new ol.style.Fill({ color: `rgba(204, 0, 0, ${0.12 * op})` })
          : null
      });
    }
  });

  const medicionEtiquetas = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: function(f) {
      const fs = Math.max(9, Math.round(12 * popupConstrMedicionEscala));
      const op = popupConstrMedicionOpacidad;
      return new ol.style.Style({
        text: new ol.style.Text({
          text: f.get("texto"),
          font: `bold ${fs}px Arial`,
          fill: new ol.style.Fill({ color: `rgba(204, 0, 0, ${op})` }),
          stroke: new ol.style.Stroke({ color: `rgba(255, 255, 255, ${op})`, width: 4 }),
          placement: f.get("placement") || "point"
        })
      });
    }
  });

  const prediosSnapVector = new ol.layer.Vector({
    source: new ol.source.Vector(),
    visible: false
  });

  const construccionesVector = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#e65100", width: 2 }),
      fill: new ol.style.Fill({ color: "rgba(255, 152, 0, 0.35)" })
    })
  });

  return {
    googleHybrid, googleSat, esri, osm,
    coloniasWms, prediosWms, construccionesWms,
    predioVector, medidasPredio, vertices, medicionLibre, medicionEtiquetas,
    construccionesVector, prediosSnapVector
  };
}

function popupConstrSnapActivo() {
  return document.getElementById("popupConstrChkSnap")?.checked !== false;
}

function popupConstrSnapToleranciaPx(factor) {
  if (!popupConstrMap) return 15 * (factor || 1);
  return popupConstrMap.getView().getResolution() * (factor || 22);
}

function popupConstrSnapClaveVertice(v) {
  return `${Number(v[0]).toFixed(3)},${Number(v[1]).toFixed(3)}`;
}

function popupConstrRecolectarVertices(geom) {
  const verts = [];
  if (!geom) return verts;
  const tipo = geom.getType();
  if (tipo === "Point") {
    verts.push(geom.getCoordinates());
  } else if (tipo === "LineString") {
    verts.push(...geom.getCoordinates());
  } else if (tipo === "Polygon") {
    geom.getCoordinates().forEach(ring => {
      const lim = ring.length > 1 ? ring.length - 1 : ring.length;
      for (let i = 0; i < lim; i++) verts.push(ring[i]);
    });
  } else if (tipo === "MultiPolygon") {
    geom.getPolygons().forEach(poly => {
      poly.getCoordinates().forEach(ring => {
        const lim = ring.length > 1 ? ring.length - 1 : ring.length;
        for (let i = 0; i < lim; i++) verts.push(ring[i]);
      });
    });
  } else if (tipo === "MultiLineString") {
    geom.getLineStrings().forEach(ls => verts.push(...ls.getCoordinates()));
  }
  return verts;
}

function popupConstrFuentesSnap() {
  if (!popupConstrCapas) return [];
  return [
    popupConstrCapas.predioVector.getSource(),
    popupConstrCapas.construccionesVector.getSource(),
    popupConstrCapas.prediosSnapVector.getSource()
  ];
}

function popupConstrSnapCoordenada(coord) {
  if (!popupConstrSnapActivo() || !coord) return coord;

  const tolP = popupConstrSnapToleranciaPx(34);
  const tolVertice = popupConstrSnapToleranciaPx(26);
  const tolBorde = popupConstrSnapToleranciaPx(16);

  let mejor = null;
  let mejorDist = tolP;

  // 1) Vértices etiquetados P1, P2… (máxima prioridad)
  if (popupConstrCapas?.vertices) {
    popupConstrCapas.vertices.getSource().getFeatures().forEach(feature => {
      const geom = feature.getGeometry();
      if (!geom || geom.getType() !== "Point") return;
      const v = geom.getCoordinates();
      const d = ol.coordinate.distance(coord, v);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = v;
      }
    });
  }
  if (mejor) return mejor.slice();

  // 2) Esquinas de predios / construcciones (sin repetir)
  mejorDist = tolVertice;
  const vistos = new Set();
  popupConstrFuentesSnap().forEach(source => {
    source.getFeatures().forEach(feature => {
      popupConstrRecolectarVertices(feature.getGeometry()).forEach(v => {
        const key = popupConstrSnapClaveVertice(v);
        if (vistos.has(key)) return;
        vistos.add(key);
        const d = ol.coordinate.distance(coord, v);
        if (d < mejorDist) {
          mejorDist = d;
          mejor = v;
        }
      });
    });
  });
  if (mejor) return mejor.slice();

  // 3) Aristas / bordes (solo si no hay vértice cercano)
  mejor = coord;
  mejorDist = tolBorde;
  popupConstrFuentesSnap().forEach(source => {
    source.getFeatures().forEach(feature => {
      const geom = feature.getGeometry();
      if (!geom || geom.getType() === "Point") return;
      const cp = geom.getClosestPoint(coord);
      const d = ol.coordinate.distance(coord, cp);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = cp;
      }
    });
  });

  return Array.isArray(mejor) ? mejor.slice() : mejor;
}

function popupConstrCoordsIguales(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function popupConstrSnapGeometriaSketch(geom) {
  if (!geom || !popupConstrSnapActivo() || popupConstrSnapSnapping) return;

  const tipo = geom.getType();
  if (tipo === "LineString") {
    const orig = geom.getCoordinates();
    const snapped = orig.map(c => popupConstrSnapCoordenada(c));
    if (!snapped.some((c, i) => !popupConstrCoordsIguales(c, orig[i]))) return;
    popupConstrSnapSnapping = true;
    geom.setCoordinates(snapped);
    popupConstrSnapSnapping = false;
  } else if (tipo === "Polygon") {
    const orig = geom.getCoordinates();
    const snapped = orig.map(ring => ring.map(c => popupConstrSnapCoordenada(c)));
    const changed = snapped.some((ring, ri) =>
      ring.some((c, i) => !popupConstrCoordsIguales(c, orig[ri][i]))
    );
    if (!changed) return;
    popupConstrSnapSnapping = true;
    geom.setCoordinates(snapped);
    popupConstrSnapSnapping = false;
  }
}

function popupConstrObtenerSketchDraw() {
  const overlay = popupConstrDraw?.getOverlay?.();
  const feats = overlay?.getSource?.()?.getFeatures?.();
  return feats?.[0]?.getGeometry?.() || null;
}

function popupConstrDesinstalarSnapEnVivo() {
  if (typeof popupConstrDrawSnapCleanup === "function") {
    popupConstrDrawSnapCleanup();
  }
  popupConstrDrawSnapCleanup = null;
}

function popupConstrInstalarSnapEnVivo() {
  popupConstrDesinstalarSnapEnVivo();
  if (!popupConstrMap || !popupConstrDraw) return;

  const refrescarSketch = () => {
    const geom = popupConstrObtenerSketchDraw();
    if (geom) popupConstrSnapGeometriaSketch(geom);
  };

  const onPointerMove = () => refrescarSketch();
  const onClick = () => {
    setTimeout(refrescarSketch, 0);
    requestAnimationFrame(refrescarSketch);
  };

  popupConstrMap.on("pointermove", onPointerMove);
  popupConstrMap.on("click", onClick);

  const onDrawStart = evt => {
    refrescarSketch();
    const geom = evt.feature.getGeometry();
    const onChange = () => refrescarSketch();
    geom.on("change", onChange);
    evt.feature.set("popupConstrSnapChange", onChange);
  };

  const limpiarDraw = evt => {
    const geom = evt.feature?.getGeometry?.();
    const onChange = evt.feature?.get?.("popupConstrSnapChange");
    if (geom && onChange) geom.un("change", onChange);
    if (geom) popupConstrSnapGeometriaSketch(geom);
    popupConstrDesinstalarSnapEnVivo();
  };

  popupConstrDraw.on("drawstart", onDrawStart);
  popupConstrDraw.on("drawend", limpiarDraw);
  popupConstrDraw.on("drawabort", limpiarDraw);

  popupConstrDrawSnapCleanup = () => {
    popupConstrMap.un("pointermove", onPointerMove);
    popupConstrMap.un("click", onClick);
    popupConstrDraw.un("drawstart", onDrawStart);
    popupConstrDraw.un("drawend", limpiarDraw);
    popupConstrDraw.un("drawabort", limpiarDraw);
  };
}

function popupConstrSnapCoordsDibujo(coordinates, tipo) {
  if (!coordinates?.length || !popupConstrSnapActivo()) return;
  if (tipo === "LineString") {
    for (let i = 0; i < coordinates.length; i++) {
      coordinates[i] = popupConstrSnapCoordenada(coordinates[i]);
    }
  } else if (tipo === "Polygon") {
    coordinates.forEach(ring => {
      for (let i = 0; i < ring.length; i++) {
        ring[i] = popupConstrSnapCoordenada(ring[i]);
      }
    });
  }
}

function popupConstrCrearGeometryFunction(tipo) {
  return function(coordinates, geometry) {
    popupConstrSnapCoordsDibujo(coordinates, tipo);
    if (tipo === "LineString") {
      if (!geometry) geometry = new ol.geom.LineString(coordinates);
      else geometry.setCoordinates(coordinates);
    } else if (tipo === "Polygon") {
      if (!geometry) geometry = new ol.geom.Polygon(coordinates);
      else geometry.setCoordinates(coordinates);
    }
    return geometry;
  };
}

async function popupConstrCargarPrediosSnapCercanos() {
  if (!popupConstrMap || !popupConstrCapas?.prediosSnapVector) return;
  const src = popupConstrCapas.prediosSnapVector.getSource();
  src.clear();

  const extent = popupConstrMap.getView().calculateExtent(popupConstrMap.getSize());
  if (!extent || extent.some(v => !Number.isFinite(v))) return;

  const center = ol.extent.getCenter(extent);
  const [lon, lat] = ol.proj.toLonLat(center);

  let radio = 120;
  if (popupConstrProj4Ready || asegurarProj4Utm11()) {
    const c1 = ol.proj.transform([extent[0], extent[1]], "EPSG:3857", "EPSG:32611");
    const c2 = ol.proj.transform([extent[2], extent[3]], "EPSG:3857", "EPSG:32611");
    const ancho = Math.abs(c2[0] - c1[0]);
    const alto = Math.abs(c2[1] - c1[1]);
    radio = Math.max(60, Math.min(500, Math.max(ancho, alto) * 0.75));
  }

  const fmt4326 = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });
  const fmt3857 = new ol.format.GeoJSON({
    dataProjection: "EPSG:3857",
    featureProjection: "EPSG:3857"
  });

  // 1) API catastro (más confiable que WFS)
  try {
    if (typeof API !== "undefined" && typeof authHeaders === "function") {
      const qs = new URLSearchParams({
        lon: String(lon),
        lat: String(lat),
        radio: String(Math.round(radio))
      });
      const r = await fetch(`${API}/predios/cercanos?${qs}`, {
        headers: authHeaders(),
        cache: "no-store"
      });
      if (r.ok) {
        const geojson = await r.json();
        if (geojson?.features?.length) {
          src.addFeatures(fmt4326.readFeatures(geojson));
          return;
        }
      }
    }
  } catch (e) {}

  // 2) WFS GeoServer (respaldo)
  const pad = ol.extent.getWidth(extent) * 0.25;
  const minx = extent[0] - pad;
  const miny = extent[1] - pad;
  const maxx = extent[2] + pad;
  const maxy = extent[3] + pad;
  const urls = [
    `https://fcnarqnodo.hopto.org/geoserver/geonode/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=geonode:predios_tijuana&outputFormat=application/json&srsName=EPSG:3857&count=150&bbox=${minx},${miny},${maxx},${maxy},EPSG:3857`,
    `https://fcnarqnodo.hopto.org/geoserver/geonode/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=geonode:predios_tijuana&outputFormat=application/json&srsName=EPSG:3857&maxFeatures=150&BBOX=${minx},${miny},${maxx},${maxy},EPSG:3857`
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const geojson = await r.json();
      if (!geojson?.features?.length) continue;
      src.addFeatures(fmt3857.readFeatures(geojson));
      return;
    } catch (e) {}
  }
}

function popupConstrEsperarVistaMapa(msFallback) {
  return new Promise(resolve => {
    if (!popupConstrMap) return resolve();
    let listo = false;
    let key = null;
    const terminar = () => {
      if (listo) return;
      listo = true;
      if (key) ol.Observable.unByKey(key);
      clearTimeout(tid);
      resolve();
    };
    key = popupConstrMap.on("moveend", terminar);
    const tid = setTimeout(terminar, msFallback || 500);
  });
}

function popupConstrProgramarRecargaSnap() {
  clearTimeout(popupConstrSnapReloadTimer);
  popupConstrSnapReloadTimer = setTimeout(() => {
    popupConstrCargarPrediosSnapCercanos();
  }, 350);
}

function popupConstrEnlazarRecargaSnapVista() {
  if (!popupConstrMap) return;
  popupConstrMap.on("moveend", popupConstrProgramarRecargaSnap);
}

function popupConstrQuitarInteraccionDibujo() {
  popupConstrDesinstalarSnapEnVivo();
  if (popupConstrDraw && popupConstrMap) {
    popupConstrMap.removeInteraction(popupConstrDraw);
    popupConstrDraw = null;
  }
}

function popupConstrTogglePanelMedicion() {
  const panel = document.getElementById("popupConstrPanelMedicion");
  const chk = document.getElementById("popupConstrChkPanelMedicion");
  if (!panel || !chk) return;
  popupConstrPanelMedicionVisible = chk.checked;
  panel.classList.toggle("oculto", !popupConstrPanelMedicionVisible);
}

function popupConstrAplicarEstiloMedicion() {
  if (!popupConstrCapas) return;
  popupConstrCapas.medicionLibre.changed();
  popupConstrCapas.medicionEtiquetas.changed();
  popupConstrMap?.render();
}

function popupConstrActualizarBotonMedicionVisible() {
  const btn = document.getElementById("popupConstrBtnOcultarMedicion");
  if (!btn) return;
  btn.textContent = popupConstrMedicionLibreVisible ? "👁 Ocultar medición" : "👁 Mostrar medición";
  btn.classList.toggle("popup-construcciones-tool-active", !popupConstrMedicionLibreVisible);
}

function popupConstrCalcularMedidasPredio(geom32611) {
  if (!popupConstrCapas || !geom32611) return;
  const src = popupConstrCapas.medidasPredio.getSource();
  src.clear();
  // Para el módulo de Construcción usamos una geometría temporal simplificada
  // solamente para mediciones/etiquetas. No se modifica PostGIS ni el GeoJSON original.
  const geomMedicion = popupConstrGeomCuadroSimplificado(geom32611) || geom32611;
  const poly = popupConstrGetMainPolygon(geomMedicion);
  if (!poly) return;

  let coordsUtm = poly.getCoordinates()[0].slice();
  if (coordsUtm.length > 1 &&
    coordsUtm[0][0] === coordsUtm[coordsUtm.length - 1][0] &&
    coordsUtm[0][1] === coordsUtm[coordsUtm.length - 1][1]) {
    coordsUtm = coordsUtm.slice(0, -1);
  }

  const coords3857 = coordsUtm.map(c => ol.proj.transform(c, "EPSG:32611", "EPSG:3857"));

  for (let i = 0; i < coordsUtm.length; i++) {
    const j = (i + 1) % coordsUtm.length;
    const dx = coordsUtm[j][0] - coordsUtm[i][0];
    const dy = coordsUtm[j][1] - coordsUtm[i][1];
    const d = Math.sqrt(dx * dx + dy * dy);
    src.addFeature(new ol.Feature({
      geometry: new ol.geom.LineString([coords3857[i], coords3857[j]]),
      texto: `${d.toFixed(2)} m`
    }));
  }
}

function popupConstrCoordsAnillo(ring) {
  if (!ring?.length) return [];
  let coords = ring.slice();
  if (coords.length > 1 &&
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1]) {
    coords = coords.slice(0, -1);
  }
  return coords;
}

/*
 * SGC-BC · Cuadro de construcción simplificado
 * ------------------------------------------------------------
 * Estas funciones NO modifican la geometría original del predio.
 * Solo generan una versión temporal del anillo exterior para:
 *   - cuadro de construcción,
 *   - etiquetas de distancia,
 *   - numeración visible de vértices en la pestaña Construcción.
 *
 * Objetivo:
 * Evitar que vértices intermedios provenientes de AutoCAD/MapInfo
 * aparezcan como P1, P2, P3... cuando pertenecen al mismo lindero recto.
 */
const POPUP_CONSTR_SIMPLIFICAR_CUADRO = {
  activo: true,

  // Distancia mínima entre vértices consecutivos para conservarlos.
  distanciaMinima: 0.03,

  // Desviación perpendicular máxima respecto al segmento anterior-siguiente.
  // Si el punto está dentro de esta distancia y no forma esquina, se elimina.
  desviacionLateral: 0.08,

  // Si el cambio de dirección es menor a este valor, se considera mismo lindero.
  cambioDireccionGrados: 5.0,

  // Evita dejar polígonos demasiado reducidos.
  minimoVertices: 4
};

function popupConstrDist2d(a, b) {
  const dx = Number(b?.[0] || 0) - Number(a?.[0] || 0);
  const dy = Number(b?.[1] || 0) - Number(a?.[1] || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function popupConstrDistPuntoLinea(p, a, b) {
  const ax = Number(a?.[0] || 0);
  const ay = Number(a?.[1] || 0);
  const bx = Number(b?.[0] || 0);
  const by = Number(b?.[1] || 0);
  const px = Number(p?.[0] || 0);
  const py = Number(p?.[1] || 0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return popupConstrDist2d(p, a);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(len2);
}

function popupConstrCambioDireccionGrados(a, b, c) {
  const v1x = Number(b?.[0] || 0) - Number(a?.[0] || 0);
  const v1y = Number(b?.[1] || 0) - Number(a?.[1] || 0);
  const v2x = Number(c?.[0] || 0) - Number(b?.[0] || 0);
  const v2y = Number(c?.[1] || 0) - Number(b?.[1] || 0);
  const l1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const l2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (l1 <= 1e-12 || l2 <= 1e-12) return 0;
  let cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  cos = Math.max(-1, Math.min(1, cos));
  return popupConstrRad2deg(Math.acos(cos));
}

function popupConstrAreaCoords(coords) {
  if (!Array.isArray(coords) || coords.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i][0] * coords[j][1] - coords[j][0] * coords[i][1];
  }
  return Math.abs(area) / 2;
}

function popupConstrSimplificarCoordsCuadro(coordsEntrada, opciones) {
  const cfg = Object.assign({}, POPUP_CONSTR_SIMPLIFICAR_CUADRO, opciones || {});
  let coords = (coordsEntrada || [])
    .filter(c => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
    .map(c => [Number(c[0]), Number(c[1])]);

  if (!cfg.activo || coords.length <= cfg.minimoVertices) return coords;

  // 1) Quitar cierre explícito si viene repetido.
  coords = popupConstrCoordsAnillo(coords);

  if (coords.length <= cfg.minimoVertices) return coords;

  // 2) Quitar duplicados consecutivos o microsegmentos.
  let depurada = [];
  for (const c of coords) {
    if (!depurada.length || popupConstrDist2d(depurada[depurada.length - 1], c) >= cfg.distanciaMinima) {
      depurada.push(c);
    }
  }
  if (depurada.length > 2 && popupConstrDist2d(depurada[0], depurada[depurada.length - 1]) < cfg.distanciaMinima) {
    depurada.pop();
  }
  coords = depurada;

  if (coords.length <= cfg.minimoVertices) return coords;

  // 3) Eliminar vértices intermedios casi colineales.
  // Se hace por iteraciones porque al eliminar un punto pueden quedar otros
  // nuevos claramente redundantes.
  let cambio = true;
  let guard = 0;
  while (cambio && guard < 20 && coords.length > cfg.minimoVertices) {
    cambio = false;
    guard++;

    const siguiente = [];
    const n = coords.length;

    for (let i = 0; i < n; i++) {
      const prev = coords[(i - 1 + n) % n];
      const curr = coords[i];
      const next = coords[(i + 1) % n];

      const dPrev = popupConstrDist2d(prev, curr);
      const dNext = popupConstrDist2d(curr, next);
      const desviacion = popupConstrDistPuntoLinea(curr, prev, next);
      const cambioDir = popupConstrCambioDireccionGrados(prev, curr, next);

      const esRedundante =
        (dPrev < cfg.distanciaMinima || dNext < cfg.distanciaMinima) ||
        (desviacion <= cfg.desviacionLateral && cambioDir <= cfg.cambioDireccionGrados);

      if (esRedundante && (n - 1) >= cfg.minimoVertices) {
        cambio = true;
        continue;
      }
      siguiente.push(curr);
    }

    // Protección: si el algoritmo se vuelve demasiado agresivo, conservar original.
    if (siguiente.length < cfg.minimoVertices) break;
    coords = siguiente;
  }

  // 4) Seguridad: si la variación de área es grande, volver a la geometría original.
  const areaOriginal = popupConstrAreaCoords(coordsEntrada || []);
  const areaNueva = popupConstrAreaCoords(coords);
  const difArea = Math.abs(areaOriginal - areaNueva);
  const toleranciaArea = Math.max(0.50, areaOriginal * 0.002); // 0.2% o 0.50 m²
  if (areaOriginal > 0 && difArea > toleranciaArea) {
    console.warn("Cuadro simplificado cancelado por variación de área:", { areaOriginal, areaNueva, difArea });
    return popupConstrCoordsAnillo(coordsEntrada || []);
  }

  return coords;
}

function popupConstrGeomCuadroSimplificado(geom32611) {
  const poly = popupConstrGetMainPolygon(geom32611);
  if (!poly) return null;
  const rings = poly.getCoordinates();
  if (!rings?.length) return null;

  const exterior = popupConstrCoordsAnillo(rings[0]);
  const exteriorSimple = popupConstrSimplificarCoordsCuadro(exterior);
  if (!exteriorSimple.length) return null;

  const cerrado = exteriorSimple.slice();
  cerrado.push(exteriorSimple[0]);
  return new ol.geom.Polygon([cerrado]);
}

function popupConstrGeomCuadroSimplificado3857(geom3857) {
  if (!geom3857 || !asegurarProj4Utm11()) return geom3857;
  try {
    const geom32611 = popupConstrTransformGeom(geom3857, "EPSG:3857", "EPSG:32611");
    const simple32611 = popupConstrGeomCuadroSimplificado(geom32611);
    if (!simple32611) return geom3857;
    return popupConstrTransformGeom(simple32611, "EPSG:32611", "EPSG:3857");
  } catch (e) {
    console.warn("No se pudo simplificar geometría de cuadro en EPSG:3857:", e);
    return geom3857;
  }
}

function popupConstrCoordsVerticesPredio(geom3857) {
  const unicos = [];
  const vistos = new Set();
  if (!geom3857) return unicos;

  const agregar = coords => {
    coords.forEach(c => {
      const key = popupConstrSnapClaveVertice(c);
      if (vistos.has(key)) return;
      vistos.add(key);
      unicos.push(c);
    });
  };

  const tipo = geom3857.getType();
  if (tipo === "Polygon") {
    geom3857.getCoordinates().forEach(ring => agregar(popupConstrCoordsAnillo(ring)));
  } else if (tipo === "MultiPolygon") {
    geom3857.getPolygons().forEach(poly => {
      poly.getCoordinates().forEach(ring => agregar(popupConstrCoordsAnillo(ring)));
    });
  } else {
    const poly = popupConstrGetMainPolygon(geom3857);
    if (poly) agregar(popupConstrCoordsAnillo(poly.getCoordinates()[0]));
  }
  return unicos;
}

function popupConstrActualizarVertices(geom3857) {
  if (!popupConstrCapas) return;
  const src = popupConstrCapas.vertices.getSource();
  src.clear();
  if (!geom3857 || !popupConstrMostrarVertices) return;

  const coords = popupConstrCoordsVerticesPredio(geom3857);
  coords.forEach((c, i) => {
    src.addFeature(new ol.Feature({
      geometry: new ol.geom.Point(c),
      etiqueta: `P${i + 1}`
    }));
  });
}

function popupConstrCalcularCuadro(geom32611) {
  // El cuadro se calcula con una copia simplificada para evitar P1..Pn
  // redundantes sobre linderos rectos.
  const geomCuadro = popupConstrGeomCuadroSimplificado(geom32611) || geom32611;
  const poly = popupConstrGetMainPolygon(geomCuadro);
  if (!poly) return { filas: [], area: 0, perimetro: 0 };

  let coordsUtm = poly.getCoordinates()[0].slice();
  if (coordsUtm.length > 1 &&
    coordsUtm[0][0] === coordsUtm[coordsUtm.length - 1][0] &&
    coordsUtm[0][1] === coordsUtm[coordsUtm.length - 1][1]) {
    coordsUtm = coordsUtm.slice(0, -1);
  }

  const utm = coordsUtm.slice();
  utm.push(utm[0]);

  let area = 0;
  for (let i = 0; i < utm.length - 1; i++) {
    area += utm[i][0] * utm[i + 1][1] - utm[i + 1][0] * utm[i][1];
  }
  area = Math.abs(area) / 2;

  const filas = [];
  let perimetro = 0;

  for (let i = 0; i < coordsUtm.length; i++) {
    const n = i + 1;
    const sig = (i + 1 > coordsUtm.length - 1 ? 1 : i + 2);
    const p1 = utm[i];
    const p2 = utm[i + 1];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    perimetro += dist;
    const ang = (popupConstrRad2deg(Math.atan2(dx, dy)) + 360) % 360;
    filas.push({ n, sig, dist, ang, este: p1[0], norte: p1[1] });
  }

  return { filas, area, perimetro };
}

function popupConstrHtmlCuadro(clave, cuadro, p) {
  const supDoc = typeof formatoNumero === "function" ? formatoNumero(p?.sup_documental) : p?.sup_documental;
  const supConst = typeof formatoNumero === "function" ? formatoNumero(p?.sup_const) : p?.sup_const;
  const tieneConst = p?.tiene_construccion === true || Number(p?.sup_const || 0) > 0;

  const filasHtml = (cuadro.filas || []).map(f => `
    <tr>
      <td>P${f.n}</td>
      <td>P${f.n} - P${f.sig}</td>
      <td>${f.dist.toFixed(2)}</td>
      <td>${popupConstrDms(f.ang)}</td>
      <td>${popupConstrFormatUtm(f.este)}</td>
      <td>${popupConstrFormatUtm(f.norte)}</td>
    </tr>
  `).join("");

  return `
    <div class="popup-construcciones-resumen">
      <div><span>Sup. documental</span><b>${supDoc ? supDoc + " m²" : "—"}</b></div>
      <div><span>Sup. construcción (padrón)</span><b>${supConst ? supConst + " m²" : "—"}</b></div>
      <div><span>Área UTM calculada</span><b>${cuadro.area ? cuadro.area.toFixed(2) + " m²" : "—"}</b></div>
      <div><span>Perímetro UTM</span><b>${cuadro.perimetro ? cuadro.perimetro.toFixed(2) + " m" : "—"}</b></div>
      <div><span>Construcción registrada</span><b>${tieneConst ? "Sí" : "No"}</b></div>
    </div>
    <div class="popup-construcciones-cuadro-scroll">
      <table class="popup-construcciones-cuadro">
        <thead>
          <tr>
            <th>Vértice</th>
            <th>Lado</th>
            <th>Dist. (m)</th>
            <th>Ángulo</th>
            <th>Este</th>
            <th>Norte</th>
          </tr>
        </thead>
        <tbody>${filasHtml || `<tr><td colspan="6">Sin geometría para cuadro de construcción.</td></tr>`}</tbody>
        <tfoot>
          <tr>
            <td colspan="6">
              Área: ${cuadro.area.toFixed(2)} m² — Perímetro: ${cuadro.perimetro.toFixed(2)} m · EPSG:32611 (UTM 11N)
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div id="popupConstrCapaBody" class="popup-construcciones-capa-wrap">
      <div class="popup-construcciones-vacio">Consultando construcciones cartográficas…</div>
    </div>
  `;
}

function popupConstrFormatTipo(tipo) {
  const t = String(tipo || "").trim();
  if (!t) return "—";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function popupConstrHtmlCapaConstrucciones(data) {
  const lista = data?.construcciones || [];
  if (!lista.length) {
    return `
      <div class="popup-construcciones-capa-head">Construcciones de la clave (capa cartográfica)</div>
      <div class="popup-construcciones-vacio">No se encontraron construcciones en la capa para esta clave.</div>
    `;
  }

  if (lista.length === 1) {
    const c = lista[0];
    const sup = c.suphor != null ? Number(c.suphor).toFixed(3) : "—";
    const per = c.perimetro != null ? Number(c.perimetro).toFixed(4) : "—";
    return `
      <div class="popup-construcciones-capa-head">Construcciones de la clave (capa cartográfica)</div>
      <div class="popup-construcciones-capa-resumen">
        <div><span>Niveles</span><b>${c.niveles ?? "—"}</b></div>
        <div><span>Superficie horizontal</span><b>${sup !== "—" ? sup + " m²" : "—"}</b></div>
        <div><span>Tipo de construcción</span><b>${popupConstrFormatTipo(c.tipo)}</b></div>
        <div><span>Clave construcción</span><b>${c.claveconst ?? "—"}</b></div>
        <div><span>Perímetro</span><b>${per !== "—" ? per + " m" : "—"}</b></div>
        <div><span>Colonia</span><b>${escapeHtml(String(c.colonia || "—"))}</b></div>
      </div>
    `;
  }

  const filas = lista.map(c => {
    const sup = c.suphor != null ? Number(c.suphor).toFixed(3) : "—";
    const per = c.perimetro != null ? Number(c.perimetro).toFixed(4) : "—";
    return `
      <tr>
        <td>${c.claveconst ?? "—"}</td>
        <td>${c.niveles ?? "—"}</td>
        <td>${sup !== "—" ? sup : "—"}</td>
        <td>${popupConstrFormatTipo(c.tipo)}</td>
        <td>${per !== "—" ? per : "—"}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="popup-construcciones-capa-head">Construcciones de la clave (capa cartográfica) — ${lista.length} registros</div>
    <div class="popup-construcciones-capa-scroll">
      <table class="popup-construcciones-capa-tabla">
        <thead>
          <tr>
            <th>Clave const.</th>
            <th>Niveles</th>
            <th>Sup. hor. (m²)</th>
            <th>Tipo</th>
            <th>Perímetro (m)</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}

async function popupConstrFetchConstruccionesWfs(clave) {
  const cql = encodeURIComponent(`clavecatas='${clave}' OR claveorig='${clave}'`);
  const url = `https://fcnarqnodo.hopto.org/geoserver/geonode/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=geonode:construcciones_tijuana&outputFormat=application/json&srsName=EPSG:3857&CQL_FILTER=${cql}&maxFeatures=100`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("WFS construcciones no disponible");
  const geojson = await r.json();
  const construcciones = (geojson.features || []).map(f => {
    const p = f.properties || {};
    return {
      fid: p.fid,
      clavecatas: p.clavecatas,
      claveconst: p.claveconst,
      claveorig: p.claveorig,
      niveles: p.niveles,
      suphor: p.suphor != null ? Number(p.suphor) : null,
      colonia: p.colonia,
      perimetro: p.perimetro != null ? Number(p.perimetro) : null,
      tipo: p.tipo
    };
  });
  return { clave_catastral: clave, total: construcciones.length, construcciones, _geojson: geojson };
}

async function popupConstrFetchConstrucciones(clave) {
  if (!clave) return null;
  try {
    if (typeof API !== "undefined" && typeof authHeaders === "function") {
      const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/construcciones`, {
        headers: authHeaders(),
        cache: "no-store"
      });
      if (r.ok) return await r.json();
    }
  } catch (e) {}
  return popupConstrFetchConstruccionesWfs(clave);
}

async function popupConstrPintarVectorConstrucciones(clave, geojsonPrecargado) {
  if (!popupConstrCapas?.construccionesVector) return;
  const src = popupConstrCapas.construccionesVector.getSource();
  src.clear();
  let geojson = geojsonPrecargado;
  if (!geojson) {
    try {
      const data = await popupConstrFetchConstruccionesWfs(clave);
      geojson = data._geojson;
    } catch (e) {
      return;
    }
  }
  if (!geojson?.features?.length) return;
  const fmt = new ol.format.GeoJSON();
  const feats = fmt.readFeatures(geojson, {
    dataProjection: "EPSG:3857",
    featureProjection: "EPSG:3857"
  });
  src.addFeatures(feats);
  const chkConstrVec = document.getElementById("popupConstrChkConstrVec");
  if (chkConstrVec) chkConstrVec.disabled = false;
}

async function popupConstrCargarCapaConstrucciones(clave) {
  const el = document.getElementById("popupConstrCapaBody");
  if (!el || !clave) return;

  try {
    const data = await popupConstrFetchConstrucciones(clave);
    el.innerHTML = popupConstrHtmlCapaConstrucciones(data);

    if (data?.total > 0) {
      const chk = document.getElementById("popupConstrChkConstrucciones");
      if (chk && !chk.checked) {
        chk.checked = true;
        popupConstrToggleCapa("construcciones");
      }
      await popupConstrPintarVectorConstrucciones(clave, data._geojson);
    }
  } catch (e) {
    el.innerHTML = `
      <div class="popup-construcciones-capa-head">Construcciones de la clave (capa cartográfica)</div>
      <div class="popup-construcciones-vacio">No fue posible consultar la capa de construcciones.</div>
    `;
  }

  await popupConstrEsperarVistaMapa(80);
  await popupConstrCargarPrediosSnapCercanos();
  popupConstrMap?.render();
}

async function popupConstrActivarDibujo(tipo) {
  if (!popupConstrMap || !popupConstrCapas) return;
  popupConstrQuitarInteraccionDibujo();

  await popupConstrEsperarVistaMapa(80);
  await popupConstrCargarPrediosSnapCercanos();

  popupConstrDraw = new ol.interaction.Draw({
    source: popupConstrCapas.medicionLibre.getSource(),
    type: tipo,
    geometryFunction: popupConstrCrearGeometryFunction(tipo)
  });
  popupConstrMap.addInteraction(popupConstrDraw);
  popupConstrInstalarSnapEnVivo();

  document.querySelectorAll(".popup-construcciones-tool-draw").forEach(btn => {
    btn.classList.toggle("popup-construcciones-tool-active", btn.dataset.drawType === tipo);
  });

  popupConstrDraw.on("drawend", function(evt) {
    const geom3857 = evt.feature.getGeometry();
    if (popupConstrSnapActivo() && geom3857) {
      const tipoGeom = geom3857.getType();
      if (tipoGeom === "LineString") {
        geom3857.setCoordinates(geom3857.getCoordinates().map(c => popupConstrSnapCoordenada(c)));
      } else if (tipoGeom === "Polygon") {
        geom3857.setCoordinates(
          geom3857.getCoordinates().map(ring => ring.map(c => popupConstrSnapCoordenada(c)))
        );
      }
    }
    const geom32611 = geom3857.clone();
    geom32611.transform("EPSG:3857", "EPSG:32611");

    if (geom32611.getType() === "LineString") {
      const coords = geom32611.getCoordinates();
      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const d = Math.sqrt(dx * dx + dy * dy);
        const seg3857 = new ol.geom.LineString([
          ol.proj.transform(p1, "EPSG:32611", "EPSG:3857"),
          ol.proj.transform(p2, "EPSG:32611", "EPSG:3857")
        ]);
        popupConstrCapas.medicionEtiquetas.getSource().addFeature(new ol.Feature({
          geometry: seg3857,
          texto: `${d.toFixed(2)} m`,
          placement: "line"
        }));
      }
    } else if (geom32611.getType() === "Polygon") {
      const ring = geom32611.getCoordinates()[0];
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const d = Math.sqrt(dx * dx + dy * dy);
        const seg3857 = new ol.geom.LineString([
          ol.proj.transform(p1, "EPSG:32611", "EPSG:3857"),
          ol.proj.transform(p2, "EPSG:32611", "EPSG:3857")
        ]);
        popupConstrCapas.medicionEtiquetas.getSource().addFeature(new ol.Feature({
          geometry: seg3857,
          texto: `${d.toFixed(2)} m`,
          placement: "line"
        }));
      }
      let per = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const dx = ring[i + 1][0] - ring[i][0];
        const dy = ring[i + 1][1] - ring[i][1];
        per += Math.sqrt(dx * dx + dy * dy);
      }
      const area = Math.abs(geom32611.getArea());
      popupConstrCapas.medicionEtiquetas.getSource().addFeature(new ol.Feature({
        geometry: geom3857.getInteriorPoint(),
        texto: `Área: ${area.toFixed(2)} m²\nPerím.: ${per.toFixed(2)} m`,
        placement: "point"
      }));
    }
    popupConstrAplicarEstiloMedicion();
  });
}

function popupConstrToggleMedicionLibre() {
  if (!popupConstrCapas) return;
  popupConstrMedicionLibreVisible = !popupConstrMedicionLibreVisible;
  popupConstrCapas.medicionLibre.setVisible(popupConstrMedicionLibreVisible);
  popupConstrCapas.medicionEtiquetas.setVisible(popupConstrMedicionLibreVisible);
  const chk = document.getElementById("popupConstrChkMedicionLibre");
  if (chk) chk.checked = popupConstrMedicionLibreVisible;
  popupConstrActualizarBotonMedicionVisible();
  popupConstrMap?.render();
}

function popupConstrAjustarMedicion(delta) {
  if (delta < 0) {
    popupConstrMedicionOpacidad = Math.max(0.35, +(popupConstrMedicionOpacidad - 0.15).toFixed(2));
    popupConstrMedicionEscala = Math.max(0.65, +(popupConstrMedicionEscala - 0.1).toFixed(2));
  } else {
    popupConstrMedicionOpacidad = Math.min(1, +(popupConstrMedicionOpacidad + 0.15).toFixed(2));
    popupConstrMedicionEscala = Math.min(1.45, +(popupConstrMedicionEscala + 0.1).toFixed(2));
  }
  popupConstrAplicarEstiloMedicion();
  const bar = document.getElementById("popupConstrMedicionNivel");
  if (bar) {
    bar.textContent = `${Math.round(popupConstrMedicionOpacidad * 100)}%`;
  }
}

function popupConstrSetBaseLayer(valor) {
  if (!popupConstrCapas) return;
  ["googleHybrid", "googleSat", "esri", "osm"].forEach(id => {
    if (popupConstrCapas[id]) popupConstrCapas[id].setVisible(id === valor);
  });
  popupConstrMap?.render();
}

function popupConstrToggleCapa(tipo) {
  if (!popupConstrCapas) return;
  if (tipo === "predios") {
    popupConstrCapas.prediosWms.setVisible(document.getElementById("popupConstrChkPredios")?.checked !== false);
  } else if (tipo === "colonias") {
    popupConstrCapas.coloniasWms.setVisible(document.getElementById("popupConstrChkColonias")?.checked === true);
  } else if (tipo === "construcciones") {
    popupConstrCapas.construccionesWms.setVisible(document.getElementById("popupConstrChkConstrucciones")?.checked === true);
  } else if (tipo === "medidas") {
    const visible = document.getElementById("popupConstrChkMedidas")?.checked !== false;
    popupConstrCapas.medidasPredio.setVisible(visible);
  } else if (tipo === "medicionLibre") {
    const visible = document.getElementById("popupConstrChkMedicionLibre")?.checked !== false;
    popupConstrMedicionLibreVisible = visible;
    popupConstrCapas.medicionLibre.setVisible(visible);
    popupConstrCapas.medicionEtiquetas.setVisible(visible);
    popupConstrActualizarBotonMedicionVisible();
  } else if (tipo === "vertices") {
    popupConstrMostrarVertices = document.getElementById("popupConstrChkVertices")?.checked !== false;
    popupConstrCapas.vertices.setVisible(popupConstrMostrarVertices);
    if (popupConstrMostrarVertices && popupConstrGeom3857) {
      popupConstrActualizarVertices(popupConstrGeom3857);
    } else {
      popupConstrCapas.vertices.getSource().clear();
    }
  }
  popupConstrMap?.render();
}

function popupConstrBorrarMedicion() {
  if (!popupConstrCapas) return;
  popupConstrCapas.medicionLibre.getSource().clear();
  popupConstrCapas.medicionEtiquetas.getSource().clear();
  popupConstrQuitarInteraccionDibujo();
  document.querySelectorAll(".popup-construcciones-tool-draw").forEach(btn => {
    btn.classList.remove("popup-construcciones-tool-active");
  });
  popupConstrMedicionLibreVisible = true;
  popupConstrCapas.medicionLibre.setVisible(true);
  popupConstrCapas.medicionEtiquetas.setVisible(true);
  const chkLibre = document.getElementById("popupConstrChkMedicionLibre");
  if (chkLibre) chkLibre.checked = true;
  popupConstrActualizarBotonMedicionVisible();
  popupConstrMap?.render();
}

function popupConstrDeshacerPunto() {
  if (popupConstrDraw) popupConstrDraw.removeLastPoint();
}

function popupConstrToggleCapasMenu(ev) {
  togglePopupMapaCapasMenu("popupConstrCapasMenu", ev);
}

function destruirPopupConstruccionesMedicion() {
  popupConstrQuitarInteraccionDibujo();
  clearTimeout(popupConstrSnapReloadTimer);
  popupConstrSnapReloadTimer = null;
  if (popupConstrMap) {
    popupConstrMap.setTarget(null);
    popupConstrMap = null;
  }
  popupConstrCapas = null;
  popupConstrCapasManager = null;
  popupConstrGeom3857 = null;
  popupConstrGeom32611 = null;
  popupConstrClaveActual = "";
  popupConstrMedicionLibreVisible = true;
  popupConstrMedicionOpacidad = 1;
  popupConstrMedicionEscala = 1;
}

async function cargarGeometriaEnMapaConstrucciones(clave, p) {
  if (!popupConstrMap || !popupConstrCapas) return;

  const geom3857 = typeof resolverGeometriaPredioPopup === "function"
    ? await resolverGeometriaPredioPopup(clave)
    : null;

  popupConstrCapas.predioVector.getSource().clear();
  popupConstrCapas.prediosSnapVector?.getSource()?.clear();
  popupConstrCapas.construccionesVector?.getSource()?.clear();
  popupConstrCapas.medidasPredio.getSource().clear();
  popupConstrCapas.vertices.getSource().clear();
  popupConstrCapas.medicionLibre.getSource().clear();
  popupConstrCapas.medicionEtiquetas.getSource().clear();

  if (!geom3857) {
    popupConstrGeom3857 = null;
    popupConstrGeom32611 = null;
    const el = document.getElementById("popupConstrCuadroBody");
    if (el) {
      el.innerHTML = `
        <div class="popup-construcciones-vacio">El predio no tiene geometría cartográfica para medición.</div>
        <div id="popupConstrCapaBody" class="popup-construcciones-capa-wrap">
          <div class="popup-construcciones-vacio">Consultando construcciones cartográficas…</div>
        </div>
      `;
    }
    await popupConstrCargarCapaConstrucciones(clave);
    return;
  }

  popupConstrGeom3857 = geom3857.clone ? geom3857.clone() : geom3857;
  popupConstrGeom32611 = asegurarProj4Utm11()
    ? popupConstrTransformGeom(popupConstrGeom3857, "EPSG:3857", "EPSG:32611")
    : null;

  if (popupConstrGeom3857) {
    const geomPredio = popupConstrGeom3857.clone ? popupConstrGeom3857.clone() : popupConstrGeom3857;
    popupConstrCapas.predioVector.getSource().addFeature(new ol.Feature({ geometry: geomPredio }));
    const ext = geomPredio.getExtent ? geomPredio.getExtent() : null;
    if (ext) {
      popupConstrMap.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 20, duration: 400 });
      await popupConstrEsperarVistaMapa(500);
    }
  }

  if (popupConstrGeom32611) {
    popupConstrCalcularMedidasPredio(popupConstrGeom32611);
    const cuadro = popupConstrCalcularCuadro(popupConstrGeom32611);
    const el = document.getElementById("popupConstrCuadroBody");
    if (el) el.innerHTML = popupConstrHtmlCuadro(clave, cuadro, p);
  }

  // Mostrar numeración P1..Pn con la misma geometría simplificada del cuadro.
  // El contorno azul del predio conserva la geometría real.
  const geomVertices3857 = popupConstrGeomCuadroSimplificado3857(popupConstrGeom3857) || popupConstrGeom3857;
  popupConstrActualizarVertices(geomVertices3857);
  await popupConstrCargarCapaConstrucciones(clave);
  setTimeout(() => popupConstrMap?.updateSize(), 120);
}

function inicializarMapaConstrucciones() {
  const target = document.getElementById("popupConstruccionesMap");
  if (!target) return;

  asegurarProj4Utm11();
  popupConstrCapas = popupConstrCrearCapasMapa();

  popupConstrMap = new ol.Map({
    target: "popupConstruccionesMap",
    layers: [
      popupConstrCapas.googleHybrid,
      popupConstrCapas.googleSat,
      popupConstrCapas.esri,
      popupConstrCapas.osm,
      popupConstrCapas.coloniasWms,
      popupConstrCapas.prediosWms,
      popupConstrCapas.construccionesWms,
      popupConstrCapas.construccionesVector,
      popupConstrCapas.prediosSnapVector,
      popupConstrCapas.predioVector,
      popupConstrCapas.medidasPredio,
      popupConstrCapas.vertices,
      popupConstrCapas.medicionLibre,
      popupConstrCapas.medicionEtiquetas
    ],
    controls: (function() {
      try {
        if (ol.control?.defaults?.defaults) {
          return ol.control.defaults.defaults({ zoom: true, rotate: false, attribution: false });
        }
      } catch (e) {}
      return [new ol.control.Zoom()];
    })(),
    view: new ol.View({
      projection: "EPSG:3857",
      center: ol.proj.fromLonLat([-116.97845271015251, 32.49868744466041]),
      zoom: 12
    })
  });

  popupConstrMap.on("pointermove", function(evt) {
    const c = ol.proj.toLonLat(evt.coordinate);
    const bar = document.getElementById("popupConstrCoordBar");
    if (bar) bar.textContent = `Lon: ${c[0].toFixed(6)} | Lat: ${c[1].toFixed(6)}`;
  });

  popupConstrEnlazarRecargaSnapVista();
  popupConstrInicializarCapasManager();
  const chkConstrVec = document.getElementById("popupConstrChkConstrVec");
  if (chkConstrVec && !popupConstrCapas?.construccionesVector) chkConstrVec.disabled = true;
}

async function pintarPopupTabConstrucciones(p) {
  const panel = document.getElementById("popupTabConstrucciones");
  if (!panel) return;

  destruirPopupConstruccionesMedicion();

  const clave = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  popupConstrClaveActual = clave;
  popupConstrMostrarVertices = true;

  panel.innerHTML = `
    <div class="popup-construcciones-layout">
      <div class="popup-construcciones-cuadro-panel">
        <div class="popup-construcciones-cuadro-head">
          <strong>Cuadro de construcción — ${escapeHtml(clave || "—")}</strong>
        </div>
        <div id="popupConstrCuadroBody" class="popup-construcciones-cuadro-body">
          <div class="popup-construcciones-vacio">Cargando geometría…</div>
        </div>
      </div>
      <div class="popup-construcciones-mapa-panel">
        <div class="popup-construcciones-mapa-head">
          <span>Medición cartográfica</span>
          <div class="popup-construcciones-mapa-head-actions">
            <button type="button" class="popup-btn-imprimir-ficha" onclick="exportarPdfFichaCartografia()" title="Abrir ficha cartográfica e imprimir o guardar PDF (Oficio)">🖨️ Imprimir / PDF</button>
            <label class="popup-construcciones-head-toggle" title="Mostrar u ocultar cuadro de medición">
              <input type="checkbox" id="popupConstrChkPanelMedicion" checked onchange="popupConstrTogglePanelMedicion()">
              <span>Medición</span>
            </label>
            <button type="button" class="popup-btn-capas" onclick="popupConstrToggleCapasMenu(event)">Capas</button>
          </div>
        </div>
        <div class="popup-construcciones-mapa-wrap">
          <div id="popupConstruccionesMap" class="popup-construcciones-map"></div>
          ${popupConstrHtmlMenuCapas()}
          <div id="popupConstrPanelMedicion" class="popup-construcciones-medicion">
            <div class="popup-construcciones-medicion-title">Medición</div>
            <label class="popup-construcciones-snap">
              <input type="checkbox" id="popupConstrChkSnap" checked> Snap a predios/vértices
            </label>
            <button type="button" class="popup-construcciones-tool popup-construcciones-tool-draw" data-draw-type="LineString" onclick="popupConstrActivarDibujo('LineString')">📏 Línea</button>
            <button type="button" class="popup-construcciones-tool popup-construcciones-tool-draw" data-draw-type="Polygon" onclick="popupConstrActivarDibujo('Polygon')">📐 Polígono</button>
            <button type="button" class="popup-construcciones-tool" onclick="popupConstrDeshacerPunto()">↶ Deshacer punto</button>
            <button type="button" class="popup-construcciones-tool" id="popupConstrBtnOcultarMedicion" onclick="popupConstrToggleMedicionLibre()">👁 Ocultar medición</button>
            <div class="popup-construcciones-medicion-ajuste">
              <button type="button" class="popup-construcciones-tool popup-construcciones-tool-mini" onclick="popupConstrAjustarMedicion(-1)" title="Reducir tamaño/opacidad">➖</button>
              <span id="popupConstrMedicionNivel">100%</span>
              <button type="button" class="popup-construcciones-tool popup-construcciones-tool-mini" onclick="popupConstrAjustarMedicion(1)" title="Aumentar tamaño/opacidad">➕</button>
            </div>
            <button type="button" class="popup-construcciones-tool popup-construcciones-tool-danger" onclick="popupConstrBorrarMedicion()">🗑 Quitar medición</button>
          </div>
          <div id="popupConstrCoordBar" class="popup-construcciones-coord">Lon: — | Lat: —</div>
        </div>
      </div>
    </div>
  `;

  inicializarMapaConstrucciones();
  await cargarGeometriaEnMapaConstrucciones(clave, p);
}

async function popupConstrRecopilarDatosFichaCartografia(clave, p) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  let cuadro = { filas: [], area: 0, perimetro: 0 };
  let construcciones = [];
  let featureGeoJSON = null;
  let construccionesGeoJSON = null;

  const geom3857 = typeof resolverGeometriaPredioPopup === "function"
    ? await resolverGeometriaPredioPopup(claveNorm)
    : null;

  if (geom3857 && asegurarProj4Utm11()) {
    const geom32611 = popupConstrTransformGeom(
      geom3857.clone ? geom3857.clone() : geom3857,
      "EPSG:3857",
      "EPSG:32611"
    );
    if (geom32611) cuadro = popupConstrCalcularCuadro(geom32611);
  }

  try {
    const data = await popupConstrFetchConstrucciones(claveNorm);
    construcciones = data?.construcciones || [];
    construccionesGeoJSON = data?._geojson || null;
    if (!construccionesGeoJSON) {
      try {
        const wfs = await popupConstrFetchConstruccionesWfs(claveNorm);
        if (!construcciones.length) construcciones = wfs.construcciones || [];
        construccionesGeoJSON = wfs._geojson || null;
      } catch (e2) {}
    }
  } catch (e) {
    console.warn("No se pudieron cargar construcciones para ficha cartografía:", e);
  }

  if (geom3857) {
    try {
      const geom = geom3857.clone ? geom3857.clone() : geom3857;
      featureGeoJSON = new ol.format.GeoJSON().writeFeatureObject(
        new ol.Feature({ geometry: geom }),
        { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }
      );
    } catch (e) {
      console.warn("No se pudo serializar geometría para ficha cartografía:", e);
    }
  }

  return { cuadro, construcciones, featureGeoJSON, construccionesGeoJSON, p: p || null };
}

window.popupConstrRecopilarDatosFichaCartografia = popupConstrRecopilarDatosFichaCartografia;

window.pintarPopupTabConstrucciones = pintarPopupTabConstrucciones;
window.destruirPopupConstruccionesMedicion = destruirPopupConstruccionesMedicion;
window.popupConstrActivarDibujo = popupConstrActivarDibujo;
window.popupConstrDeshacerPunto = popupConstrDeshacerPunto;
window.popupConstrBorrarMedicion = popupConstrBorrarMedicion;
window.popupConstrToggleMedicionLibre = popupConstrToggleMedicionLibre;
window.popupConstrAjustarMedicion = popupConstrAjustarMedicion;
window.popupConstrTogglePanelMedicion = popupConstrTogglePanelMedicion;
window.popupConstrToggleCapa = popupConstrToggleCapa;
window.popupConstrSetBaseLayer = popupConstrSetBaseLayer;
window.popupConstrToggleCapasMenu = popupConstrToggleCapasMenu;
window.popupConstrCambiarOpacidadCapa = popupConstrCambiarOpacidadCapa;
window.popupConstrSubirCapa = popupConstrSubirCapa;
window.popupConstrBajarCapa = popupConstrBajarCapa;
window.popupConstrToggleCapaLayer = popupConstrToggleCapaLayer;
