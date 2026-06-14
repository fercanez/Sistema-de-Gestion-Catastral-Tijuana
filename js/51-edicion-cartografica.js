/* Módulo de edición cartográfica — predios almacenados (panel izq. + mapa der.) */

let edCartoMap = null;
let edCartoCapas = null;
let edCartoModify = null;
let edCartoDraw = null;
let edCartoSnaps = [];
let edCartoEditSource = null;
let edCartoEditFeature = null;
let edCartoClave = "";
let edCartoGeomOriginal = null;
let edCartoModo = "select";
let edCartoSnapActivo = true;
let edCartoDirty = false;
let edCartoSnapTimer = null;
let edCartoDesdePortal = false;
let edCartoProcedimiento = "EDICION";
let edCartoGuardadoOk = false;
let edCartoVerCambiosActivo = true;
let edCartoOriginalSource = null;
let edCartoSelect = null;
let edCartoTranslate = null;
let edCartoRotate = null;
let edCartoDrawLine = null;
let edCartoCutTargetFeature = null;
let edCartoCutLineSource = null;

const ED_CARTO_PROCEDIMIENTOS = {
  EDICION: {
    titulo: "Edición de contorno existente",
    movTipo: null,
    crearSiAusente: false,
    pasos: [
      "Capture la clave catastral o cargue el predio.",
      "Pulse «Dibujar polígono» (verde al trazar) o «Mover vértices» si ya hay contorno.",
      "Cierre el polígono en el primer vértice o con doble clic.",
      "Guarde en cartografía cuando el contorno azul sea correcto."
    ]
  },
  ALTA_CLAVE: {
    titulo: "Alta de nueva clave catastral",
    movTipo: "ALTA_CLAVE",
    crearSiAusente: true,
    pasos: [
      "Capture la clave catastral nueva.",
      "Dibuje el contorno del predio en el mapa.",
      "Guarde en cartografía (crea geometría si no existe).",
      "Continúe el trámite de alta en el padrón."
    ]
  },
  SUBDIVISION: {
    titulo: "Subdivisión predial",
    movTipo: "SUBDIVISION",
    crearSiAusente: false,
    pasos: [
      "Cargue la clave origen a subdividir.",
      "Pulse «Línea corte» (no hace falta seleccionar antes).",
      "Trace 2 clics en el mapa: inicio y fin de la línea atravesando el predio.",
      "Indique claves resultantes y guarde en cartografía."
    ]
  },
  FUSION: {
    titulo: "Fusión de predios",
    movTipo: "FUSION",
    crearSiAusente: true,
    pasos: [
      "Indique las claves origen y la clave destino.",
      "Cargue o dibuje el contorno del predio fusionado.",
      "Guarde en cartografía.",
      "Continúe el trámite de fusión en el padrón."
    ]
  }
};

function edCartoGetProcedimientoConfig() {
  return ED_CARTO_PROCEDIMIENTOS[edCartoProcedimiento] || ED_CARTO_PROCEDIMIENTOS.EDICION;
}

function edCartoActualizarPasosProcedimiento() {
  const ol = document.getElementById("edicionCartoPasos");
  if (!ol) return;
  const cfg = edCartoGetProcedimientoConfig();
  ol.innerHTML = (cfg.pasos || []).map(function(p) { return "<li>" + p + "</li>"; }).join("");
}

function edCartoActualizarBotonTramite() {
  const btn = document.getElementById("edicionCartoBtnTramite");
  const cfg = edCartoGetProcedimientoConfig();
  if (!btn) return;
  const visible = !!cfg.movTipo && edCartoGuardadoOk && !edCartoDirty;
  btn.classList.toggle("oculto", !visible);
}

function edCartoActualizarUiProcedimiento() {
  const cfg = edCartoGetProcedimientoConfig();
  const sub = document.getElementById("edicionCartoProcSubdivision");
  const fus = document.getElementById("edicionCartoProcFusion");
  const btnActual = document.getElementById("edicionCartoBtnPredioActual");
  if (sub) sub.classList.toggle("oculto", edCartoProcedimiento !== "SUBDIVISION");
  if (fus) fus.classList.toggle("oculto", edCartoProcedimiento !== "FUSION");
  if (btnActual) btnActual.style.display = edCartoProcedimiento === "ALTA_CLAVE" ? "none" : "";
  edCartoActualizarPasosProcedimiento();
  edCartoActualizarBotonTramite();
  edCartoSyncBotonesModo();
  const titulo = document.getElementById("edicionCartoTitulo");
  if (titulo && edCartoDesdePortal) titulo.textContent = "Módulo cartográfico · " + cfg.titulo;
}

function edCartoCambiarProcedimiento() {
  const sel = document.getElementById("edicionCartoProcedimiento");
  const nuevo = sel ? String(sel.value || "EDICION").toUpperCase() : "EDICION";
  if (nuevo === edCartoProcedimiento) return;
  if (edCartoDirty && !confirm("Hay cambios sin guardar. ¿Cambiar de procedimiento?")) {
    if (sel) sel.value = edCartoProcedimiento;
    return;
  }
  edCartoProcedimiento = ED_CARTO_PROCEDIMIENTOS[nuevo] ? nuevo : "EDICION";
  edCartoGuardadoOk = false;
  edCartoMarcarDirty(false);
  edCartoActualizarUiProcedimiento();
  if (edCartoProcedimiento === "ALTA_CLAVE") {
    edCartoClave = "";
    edCartoEstablecerGeometria(null, false);
    edCartoSetMensaje("Capture la clave nueva y dibuje el contorno.", "info");
    edCartoActivarModoDraw();
  } else if (edCartoProcedimiento === "FUSION") {
    edCartoSetMensaje("Indique claves origen y destino; seleccione 2+ polígonos y pulse Unir.", "info");
  } else if (edCartoProcedimiento === "SUBDIVISION") {
    if (edCartoEditSource?.getFeatures()?.length) {
      edCartoActivarModoCutLine();
    } else {
      edCartoSetMensaje("Cargue un predio y trace la línea de corte (2 clics).", "info");
    }
  } else {
    edCartoSetMensaje("Procedimiento: " + edCartoGetProcedimientoConfig().titulo + ".", "info");
  }
}

function edCartoClaveActivaParaGuardar() {
  if (edCartoProcedimiento === "FUSION") {
    const dest = String(document.getElementById("edicionCartoClaveDestino")?.value || edCartoClave || "").trim().toUpperCase();
    return dest;
  }
  return String(edCartoClave || document.getElementById("edicionCartoInputClave")?.value || "").trim().toUpperCase();
}

function edCartoValidarAntesGuardar() {
  const clave = edCartoClaveActivaParaGuardar();
  if (!clave) {
    if (edCartoProcedimiento === "ALTA_CLAVE") return "Indique la clave catastral nueva.";
    if (edCartoProcedimiento === "FUSION") return "Indique la clave destino del predio fusionado.";
    return "Cargue un predio antes de guardar.";
  }
  if (edCartoProcedimiento === "SUBDIVISION") {
    const res = String(document.getElementById("edicionCartoClavesResultantes")?.value || "").trim();
    if (!res) return "Indique las claves resultantes de la subdivisión.";
    const claves = edCartoParseClavesResultantes(res);
    const nFeats = edCartoEditSource?.getFeatures()?.length || 0;
    if (nFeats >= 2 && claves.length !== nFeats) {
      return "Indique " + nFeats + " claves resultantes (una por cada polígono azul).";
    }
  }
  if (edCartoProcedimiento === "FUSION") {
    const orig = String(document.getElementById("edicionCartoClavesOrigen")?.value || "").trim();
    if (!orig) return "Indique las claves origen a fusionar.";
  }
  return "";
}

function edCartoSetMensaje(texto, tipo) {
  const el = document.getElementById("edicionCartoMensaje");
  if (!el) return;
  el.textContent = texto || "";
  el.className = "edicion-carto-mensaje " + (tipo || "");
}

function edCartoMarcarDirty(flag) {
  edCartoDirty = !!flag;
  if (edCartoDirty) edCartoGuardadoOk = false;
  const badge = document.getElementById("edicionCartoBadgeDirty");
  if (badge) badge.classList.toggle("oculto", !edCartoDirty);
  edCartoActualizarBotonTramite();
}

function edCartoAsegurarProj4() {
  if (typeof asegurarProj4Utm11 === "function") return asegurarProj4Utm11();
  try {
    if (typeof proj4 === "undefined") return false;
    proj4.defs("EPSG:32611", "+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs");
    if (ol.proj.proj4 && typeof ol.proj.proj4.register === "function") ol.proj.proj4.register(proj4);
    else if (typeof ol.proj.register === "function") ol.proj.register(proj4);
    return true;
  } catch (e) {
    return false;
  }
}

function edCartoGetMainPolygon(geom) {
  if (typeof popupConstrGetMainPolygon === "function") return popupConstrGetMainPolygon(geom);
  if (!geom) return null;
  const t = geom.getType();
  if (t === "Polygon") return geom;
  if (t === "MultiPolygon") {
    const ps = geom.getPolygons();
    return ps.length ? ps[0] : null;
  }
  return null;
}

function edCartoCalcularMedidas(geom3857) {
  if (!geom3857) return { area: null, perimetro: null };
  edCartoAsegurarProj4();
  const clone = geom3857.clone();
  clone.transform("EPSG:3857", "EPSG:32611");
  const poly = edCartoGetMainPolygon(clone);
  if (!poly) return { area: null, perimetro: null };
  let ring = poly.getCoordinates()[0].slice();
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
    ring = ring.slice(0, -1);
  }
  let per = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const dx = ring[j][0] - ring[i][0];
    const dy = ring[j][1] - ring[i][1];
    per += Math.sqrt(dx * dx + dy * dy);
  }
  return { area: Math.abs(poly.getArea()), perimetro: per };
}

function edCartoActualizarResumenPanel() {
  const feats = edCartoEditSource?.getFeatures() || [];
  let geom = edCartoEditFeature?.getGeometry?.();
  if (!geom && feats.length === 1) geom = feats[0].getGeometry();
  const m = edCartoCalcularMedidas(geom);
  const set = function(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const claveTxt = edCartoClave || (feats.length > 1 ? feats.length + " polígonos" : "—");
  set("edicionCartoClaveActiva", claveTxt);
  if (feats.length > 1) {
    let areaSum = 0;
    let perSum = 0;
    feats.forEach(function(f) {
      const mm = edCartoCalcularMedidas(f.getGeometry());
      if (mm.area != null) areaSum += mm.area;
      if (mm.perimetro != null) perSum += mm.perimetro;
    });
    set("edicionCartoArea", areaSum.toFixed(2) + " m² (Σ " + feats.length + ")");
    set("edicionCartoPerimetro", perSum.toFixed(2) + " m");
  } else {
    set("edicionCartoArea", m.area != null ? m.area.toFixed(2) + " m²" : "—");
    set("edicionCartoPerimetro", m.perimetro != null ? m.perimetro.toFixed(2) + " m" : "—");
  }
}

function edCartoCrearCapas() {
  const base = new ol.layer.Tile({
    visible: true,
    zIndex: 0,
    source: new ol.source.XYZ({
      url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      attributions: "Google"
    })
  });
  const coloniasWms = new ol.layer.Tile({
    visible: true,
    opacity: 0.62,
    zIndex: 8,
    source: new ol.source.TileWMS({
      url: "https://fcnarqnodo.hopto.org/geoserver/geonode/wms",
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
  });
  const prediosWms = new ol.layer.Tile({
    visible: false,
    opacity: 0.85,
    zIndex: 10,
    source: new ol.source.TileWMS({
      url: "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms",
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
  });
  const snapVector = new ol.layer.Vector({
    zIndex: 18,
    source: new ol.source.Vector(),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "rgba(100,116,139,0.55)", width: 1 }),
      fill: new ol.style.Fill({ color: "rgba(148,163,184,0.08)" })
    })
  });
  edCartoEditSource = new ol.source.Vector();
  edCartoOriginalSource = new ol.source.Vector();
  const originalLayer = new ol.layer.Vector({
    zIndex: 35,
    visible: false,
    source: edCartoOriginalSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#ea580c", width: 3, lineDash: [8, 6] }),
      fill: new ol.style.Fill({ color: "rgba(234, 88, 12, 0.12)" })
    })
  });
  const editLayer = new ol.layer.Vector({
    zIndex: 40,
    source: edCartoEditSource,
    style: function(feature) {
      return edCartoEstiloFeature(feature);
    }
  });
  const vertices = new ol.layer.Vector({
    zIndex: 50,
    source: new ol.source.Vector(),
    style: new ol.style.Style({
      image: new ol.style.Circle({
        radius: 6,
        fill: new ol.style.Fill({ color: "#fff" }),
        stroke: new ol.style.Stroke({ color: "#cc0000", width: 2 })
      })
    })
  });
  edCartoCutLineSource = new ol.source.Vector();
  const cutLineLayer = new ol.layer.Vector({
    zIndex: 55,
    source: edCartoCutLineSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#dc2626", width: 4, lineDash: [10, 6] }),
      image: new ol.style.Circle({
        radius: 6,
        fill: new ol.style.Fill({ color: "#fff" }),
        stroke: new ol.style.Stroke({ color: "#dc2626", width: 2 })
      })
    })
  });
  return {
    base,
    coloniasWms,
    prediosWms,
    snapVector,
    originalLayer,
    editLayer,
    vertices,
    cutLineLayer
  };
}

function edCartoEstiloContornoActivo() {
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: "#0050ff", width: 4, lineDash: [10, 6] }),
    fill: new ol.style.Fill({ color: "rgba(0, 80, 255, 0.35)" })
  });
}

function edCartoEstiloSeleccionado() {
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: "#facc15", width: 5 }),
    fill: new ol.style.Fill({ color: "rgba(250, 204, 21, 0.38)" })
  });
}

function edCartoEstiloCorteObjetivo() {
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: "#facc15", width: 5 }),
    fill: new ol.style.Fill({ color: "rgba(0, 80, 255, 0.32)" })
  });
}

function edCartoEstiloFeature(feature) {
  if (edCartoModo === "cutline" && edCartoCutTargetFeature && feature === edCartoCutTargetFeature) {
    return edCartoEstiloCorteObjetivo();
  }
  if (edCartoFeatureSeleccionada(feature)) return edCartoEstiloSeleccionado();
  return edCartoEstiloContornoActivo();
}

function edCartoFeatureSeleccionada(feature) {
  if (!edCartoSelect || !feature) return false;
  return edCartoSelect.getFeatures().getArray().indexOf(feature) >= 0;
}

function edCartoRefreshCapaEdicion() {
  edCartoCapas?.editLayer?.changed();
}

function edCartoJstsDisponible() {
  return typeof jsts !== "undefined" && jsts.io && jsts.io.OL3Parser;
}

function edCartoOcultarSelectDelMapa() {
  if (edCartoSelect && edCartoMap) {
    edCartoMap.removeInteraction(edCartoSelect);
    edCartoSelect = null;
  }
}

function edCartoOlGeomToJsts(geom3857) {
  if (!geom3857) return null;
  try {
    if (jsts.io && jsts.io.GeoJSONReader) {
      const fmt = new ol.format.GeoJSON();
      const obj = fmt.writeGeometryObject(geom3857, {
        featureProjection: "EPSG:3857",
        dataProjection: "EPSG:3857"
      });
      return new jsts.io.GeoJSONReader().read(obj);
    }
    return edCartoCrearParserJsts().read(geom3857.clone ? geom3857.clone() : geom3857);
  } catch (e) {
    console.warn("OL→JSTS:", e);
    return null;
  }
}

function edCartoJstsToOlGeom(jGeom) {
  if (!jGeom) return null;
  try {
    if (jsts.io && jsts.io.GeoJSONWriter) {
      const obj = new jsts.io.GeoJSONWriter().write(jGeom);
      const fmt = new ol.format.GeoJSON();
      return fmt.readGeometry(obj, {
        featureProjection: "EPSG:3857",
        dataProjection: "EPSG:3857"
      });
    }
    return edCartoCrearParserJsts().write(jGeom);
  } catch (e) {
    console.warn("JSTS→OL:", e);
    return null;
  }
}

function edCartoJstsPoligonoPrincipal(jGeom) {
  if (!jGeom || jGeom.isEmpty()) return null;
  const t = jGeom.getGeometryType ? jGeom.getGeometryType() : "";
  if (t === "Polygon") return jGeom;
  if (t === "MultiPolygon" && jGeom.getNumGeometries() > 0) {
    let best = jGeom.getGeometryN(0);
    let bestArea = best.getArea();
    for (let i = 1; i < jGeom.getNumGeometries(); i++) {
      const g = jGeom.getGeometryN(i);
      if (g.getArea() > bestArea) {
        best = g;
        bestArea = g.getArea();
      }
    }
    return best;
  }
  return jGeom;
}

function edCartoSplitPolygonizer(jPoly, jLine, parser, useBoundary) {
  const polygonizer = new jsts.operation.polygonize.Polygonizer();
  const ring = useBoundary ? jPoly.getBoundary() : jPoly.getExteriorRing();
  polygonizer.add(ring.union(jLine));
  const list = polygonizer.getPolygons();
  return edCartoJstsFiltrarPartesDentro(jPoly, list, parser);
}

function edCartoSplitBuffer(jPoly, jLine, parser, widthM) {
  const bufParams = new jsts.operation.buffer.BufferParameters();
  bufParams.setEndCapStyle(jsts.operation.buffer.BufferParameters.CAP_FLAT);
  bufParams.setJoinStyle(jsts.operation.buffer.BufferParameters.JOIN_MITRE);
  const cutter = jsts.operation.buffer.BufferOp.bufferOp(jLine, widthM, bufParams);
  const diff = jPoly.difference(cutter);
  const parts = edCartoJstsExtraerPoligonos(diff, parser);
  return edCartoFiltrarPartesDentroOl(jPoly, parts);
}

function edCartoFiltrarPartesDentroOl(jPoly, olParts) {
  return olParts.filter(function(olG) {
    const jp = edCartoOlGeomToJsts(olG);
    if (!jp || jp.isEmpty()) return false;
    const rep = jp.getRepresentativePoint();
    return jPoly.contains(rep) || jPoly.covers(jp);
  });
}

function edCartoJstsFiltrarPartesDentro(jPoly, list, parser) {
  const parts = [];
  for (let i = 0; i < list.size(); i++) {
    const p = list.get(i);
    if (!p || p.isEmpty()) continue;
    const rep = p.getRepresentativePoint();
    if (!jPoly.contains(rep) && !jPoly.covers(p)) continue;
    if (p.getArea() < 0.5) continue;
    parts.push(parser.write(p));
  }
  return parts;
}

function edCartoJstsExtraerPoligonos(geom, parser) {
  const parts = [];
  if (!geom || geom.isEmpty()) return parts;
  const n = geom.getNumGeometries ? geom.getNumGeometries() : 1;
  for (let i = 0; i < n; i++) {
    const g = n === 1 ? geom : geom.getGeometryN(i);
    if (!g || g.isEmpty()) continue;
    const t = g.getGeometryType ? g.getGeometryType() : "";
    if (t !== "Polygon" && t !== "MultiPolygon") continue;
    if (t === "Polygon") {
      if (g.getArea() >= 0.5) parts.push(parser.write(g));
    } else {
      for (let j = 0; j < g.getNumGeometries(); j++) {
        const p = g.getGeometryN(j);
        if (p && p.getArea() >= 0.5) parts.push(parser.write(p));
      }
    }
  }
  return parts;
}

function edCartoSplitConLinea(polygon3857, line3857) {
  if (!polygon3857 || !line3857) return null;

  let parts = edCartoSplitManualAnillos(polygon3857, line3857);
  if (parts && parts.length >= 2) return parts;

  if (!edCartoJstsDisponible()) return null;
  try {
    const parser = edCartoCrearParserJsts();
    const lineExt = edCartoExtenderLineaCorte(line3857, polygon3857);
    let jPoly = edCartoOlGeomToJsts(polygon3857);
    let jLine = edCartoOlGeomToJsts(lineExt);
    if (!jPoly || jPoly.isEmpty() || !jLine || jLine.isEmpty()) return null;

    jPoly = edCartoJstsPoligonoPrincipal(jPoly);
    try {
      const fixed = jPoly.buffer(0);
      if (fixed && !fixed.isEmpty()) jPoly = edCartoJstsPoligonoPrincipal(fixed);
    } catch (eFix) {}

    parts = edCartoSplitPolygonizer(jPoly, jLine, parser, false);
    if (parts.length >= 2) return parts;

    parts = edCartoSplitPolygonizer(jPoly, jLine, parser, true);
    if (parts.length >= 2) return parts;

    const anchos = [0.08, 0.2, 0.5, 1.0, 2.0, 4.0];
    for (let i = 0; i < anchos.length && parts.length < 2; i++) {
      parts = edCartoSplitBuffer(jPoly, jLine, parser, anchos[i]);
    }
    return parts.length >= 2 ? parts : null;
  } catch (e) {
    console.warn("JSTS split:", e);
    return null;
  }
}

function edCartoCrearParserJsts() {
  const parser = new jsts.io.OL3Parser();
  parser.inject(
    ol.geom.Point,
    ol.geom.LineString,
    ol.geom.LinearRing,
    ol.geom.Polygon,
    ol.geom.MultiPoint,
    ol.geom.MultiLineString,
    ol.geom.MultiPolygon
  );
  return parser;
}

function edCartoExtenderLineaCorte(line3857, polygon3857) {
  const ext = polygon3857.getExtent();
  const pad = Math.max(ext[2] - ext[0], ext[3] - ext[1], 50) * 2;
  const coords = line3857.getCoordinates();
  if (!coords || coords.length < 2) return line3857;
  const p1 = coords[0];
  const p2 = coords[coords.length - 1];
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return new ol.geom.LineString([
    [p1[0] - ux * pad, p1[1] - uy * pad],
    [p2[0] + ux * pad, p2[1] + uy * pad]
  ]);
}

function edCartoDist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function edCartoInterseccionSegmentos(a1, a2, b1, b2) {
  const x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1];
  const x3 = b1[0], y3 = b1[1], x4 = b2[0], y4 = b2[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function edCartoRingAbierto(poly) {
  let ring = poly.getCoordinates()[0].slice();
  if (ring.length > 1 && edCartoDist2(ring[0], ring[ring.length - 1]) < 1e-4) {
    ring = ring.slice(0, -1);
  }
  return ring;
}

function edCartoHitsLineaAnillo(ring, lineCoords) {
  const a = lineCoords[0];
  const b = lineCoords[lineCoords.length - 1];
  const hits = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const pt = edCartoInterseccionSegmentos(ring[i], ring[j], a, b);
    if (!pt) continue;
    const edgeLen = Math.sqrt(edCartoDist2(ring[i], ring[j])) || 1;
    const tEdge = Math.sqrt(edCartoDist2(ring[i], pt)) / edgeLen;
    hits.push({ pt: pt, edge: i, distAlong: i + tEdge });
  }
  const out = [];
  hits.forEach(function(h) {
    if (!out.some(function(o) { return edCartoDist2(o.pt, h.pt) < 0.25; })) out.push(h);
  });
  out.sort(function(x, y) { return x.distAlong - y.distAlong; });
  return out;
}

function edCartoPathAnillo(ring, hStart, hEnd) {
  const n = ring.length;
  const path = [hStart.pt.slice()];
  if (hStart.edge === hEnd.edge) {
    path.push(hEnd.pt.slice());
    return path;
  }
  let idx = (hStart.edge + 1) % n;
  let guard = 0;
  while (guard++ <= n + 2) {
    path.push(ring[idx].slice());
    if (idx === hEnd.edge) break;
    idx = (idx + 1) % n;
  }
  if (edCartoDist2(path[path.length - 1], hEnd.pt) > 0.25) {
    path.push(hEnd.pt.slice());
  }
  return path;
}

function edCartoPoligonoDesdeRuta(ruta) {
  if (!ruta || ruta.length < 3) return null;
  const coords = ruta.map(function(p) { return p.slice(); });
  coords.push(coords[0].slice());
  try {
    const poly = new ol.geom.Polygon([coords]);
    return poly.getArea() >= 0.5 ? poly : null;
  } catch (e) {
    return null;
  }
}

function edCartoSplitManualAnillos(polygon3857, line3857) {
  const poly = edCartoGetMainPolygon(polygon3857);
  if (!poly) return null;
  const lineExt = edCartoExtenderLineaCorte(line3857, polygon3857);
  const ring = edCartoRingAbierto(poly);
  const hits = edCartoHitsLineaAnillo(ring, lineExt.getCoordinates());
  if (hits.length < 2) return null;

  const h1 = hits[0];
  const h2 = hits[hits.length - 1];
  if (edCartoDist2(h1.pt, h2.pt) < 0.25) return null;

  const pathA = edCartoPathAnillo(ring, h1, h2);
  const pathB = edCartoPathAnillo(ring, h2, h1);
  const polyA = edCartoPoligonoDesdeRuta(pathA);
  const polyB = edCartoPoligonoDesdeRuta(pathB);
  if (!polyA || !polyB) return null;
  return [polyA, polyB];
}

function edCartoGetFeaturesSeleccionados() {
  if (edCartoSelect) return edCartoSelect.getFeatures().getArray().slice();
  return edCartoEditFeature ? [edCartoEditFeature] : edCartoEditSource?.getFeatures()?.slice() || [];
}

function edCartoSyncFeaturePrimaria() {
  const sel = edCartoGetFeaturesSeleccionados();
  if (sel.length) edCartoEditFeature = sel[0];
  else {
    const all = edCartoEditSource?.getFeatures() || [];
    edCartoEditFeature = all.length ? all[0] : null;
  }
  edCartoRefreshCapaEdicion();
  edCartoActualizarResumenPanel();
  const g = edCartoEditFeature?.getGeometry?.();
  edCartoActualizarVertices(g);
}

function edCartoLimpiarSeleccion() {
  edCartoSelect?.getFeatures()?.clear();
  edCartoRefreshCapaEdicion();
}

function edCartoAsegurarSelect() {
  if (!edCartoMap) return;
  if (edCartoSelect && edCartoMap.getInteractions().getArray().indexOf(edCartoSelect) >= 0) return;
  edCartoSelect = null;
  edCartoSelect = new ol.interaction.Select({
    layers: function(layer) { return layer === edCartoCapas?.editLayer; },
    hitTolerance: 8,
    multi: true,
    toggleCondition: ol.events.condition.shiftKeyOnly,
    style: edCartoEstiloSeleccionado()
  });
  edCartoSelect.on("select", function() {
    edCartoSyncFeaturePrimaria();
  });
  edCartoMap.addInteraction(edCartoSelect);
}

function edCartoEstiloContornoDibujo() {
  return new ol.style.Style({
    stroke: new ol.style.Stroke({ color: "#16a34a", width: 3, lineDash: [6, 4] }),
    fill: new ol.style.Fill({ color: "rgba(22, 163, 74, 0.28)" }),
    image: new ol.style.Circle({
      radius: 5,
      fill: new ol.style.Fill({ color: "#fff" }),
      stroke: new ol.style.Stroke({ color: "#16a34a", width: 2 })
    })
  });
}

function edCartoSyncBotonesModo() {
  document.querySelectorAll(".edicion-carto-tool-modo, .edicion-carto-mapa-toolbar [data-modo]").forEach(function(btn) {
    btn.classList.toggle("activo", btn.dataset.modo === edCartoModo);
  });
  document.querySelectorAll(".edicion-carto-mapa-toolbar [data-proc]").forEach(function(btn) {
    btn.classList.toggle("activo", btn.dataset.proc === edCartoProcedimiento);
  });
}

function edCartoActualizarCapaOriginal() {
  if (!edCartoCapas?.originalLayer || !edCartoOriginalSource) return;
  edCartoOriginalSource.clear();
  if (!edCartoGeomOriginal) {
    edCartoCapas.originalLayer.setVisible(false);
    edCartoActualizarBotonVerCambios();
    return;
  }
  edCartoCapas.originalLayer.setVisible(true);
  edCartoOriginalSource.addFeature(new ol.Feature({ geometry: edCartoGeomOriginal.clone() }));
  edCartoActualizarBotonVerCambios();
}

function edCartoActualizarBotonVerCambios() {
  const hasOrig = !!edCartoGeomOriginal;
  const label = edCartoVerCambiosActivo ? "Cambios: ON" : "Cambios: OFF";
  ["edicionCartoBtnVerCambios", "edicionCartoMapBtnVerCambios"].forEach(function(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !hasOrig;
    btn.classList.toggle("activo", edCartoVerCambiosActivo && hasOrig);
    btn.textContent = "👁 " + label;
    btn.title = hasOrig
      ? "Mostrar u ocultar el contorno editado (azul). Naranja = original."
      : "Disponible al cargar un predio con geometría previa";
  });
}

function edCartoAplicarVisibilidadCambios() {
  const visible = edCartoVerCambiosActivo;
  if (edCartoCapas?.editLayer) edCartoCapas.editLayer.setVisible(visible);
  if (edCartoCapas?.vertices) edCartoCapas.vertices.setVisible(visible);
  edCartoActualizarBotonVerCambios();
}

function edCartoToggleVerCambios() {
  if (!edCartoGeomOriginal) {
    edCartoSetMensaje("No hay contorno original. Cargue un predio existente para comparar.", "info");
    return;
  }
  edCartoVerCambiosActivo = !edCartoVerCambiosActivo;
  edCartoAplicarVisibilidadCambios();
  edCartoSetMensaje(
    edCartoVerCambiosActivo
      ? "Contorno editado visible (azul). Original en naranja."
      : "Contorno editado oculto. Solo se muestra el original (naranja).",
    "info"
  );
}

function edCartoToolbarProcedimiento(proc) {
  const procNorm = String(proc || "EDICION").toUpperCase();
  if (!ED_CARTO_PROCEDIMIENTOS[procNorm]) return;
  const sel = document.getElementById("edicionCartoProcedimiento");
  const cambio = sel && sel.value !== procNorm;
  if (sel) sel.value = procNorm;
  if (cambio) {
    edCartoCambiarProcedimiento();
  } else {
    edCartoProcedimiento = procNorm;
    edCartoActualizarUiProcedimiento();
    edCartoSyncBotonesModo();
  }
  if (procNorm === "SUBDIVISION") {
    edCartoActivarModoCutLine();
  } else if (procNorm === "ALTA_CLAVE" && !cambio) {
    edCartoActivarModoDraw();
  }
}

function edCartoQuitarDoubleClickZoom() {
  if (!edCartoMap) return;
  edCartoMap.getInteractions().getArray().slice().forEach(function(ix) {
    if (ix instanceof ol.interaction.DoubleClickZoom) {
      edCartoMap.removeInteraction(ix);
    }
  });
}

function edCartoActualizarVertices(geom3857) {
  if (!edCartoCapas?.vertices) return;
  const src = edCartoCapas.vertices.getSource();
  src.clear();
  if (!geom3857) return;
  let coords = [];
  if (typeof popupConstrCoordsVerticesPredio === "function") {
    coords = popupConstrCoordsVerticesPredio(geom3857);
  } else {
    const poly = edCartoGetMainPolygon(geom3857);
    if (poly) {
      let ring = poly.getCoordinates()[0].slice();
      if (ring.length > 1) ring = ring.slice(0, -1);
      coords = ring;
    }
  }
  coords.forEach(function(c) {
    src.addFeature(new ol.Feature({ geometry: new ol.geom.Point(c) }));
  });
}

async function edCartoCargarSnapCercanos() {
  if (!edCartoMap || !edCartoCapas?.snapVector) return;
  const src = edCartoCapas.snapVector.getSource();
  src.clear();
  const extent = edCartoMap.getView().calculateExtent(edCartoMap.getSize());
  if (!extent || extent.some(function(v) { return !Number.isFinite(v); })) return;
  const center = ol.extent.getCenter(extent);
  const lonLat = ol.proj.toLonLat(center);
  const fmt = new ol.format.GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
  try {
    if (typeof API !== "undefined" && typeof authHeaders === "function") {
      const qs = new URLSearchParams({
        lon: String(lonLat[0]),
        lat: String(lonLat[1]),
        radio: "150"
      });
      const r = await fetch(API + "/predios/cercanos?" + qs, { headers: authHeaders(), cache: "no-store" });
      if (r.ok) {
        const geojson = await r.json();
        if (geojson?.features?.length) {
          src.addFeatures(fmt.readFeatures(geojson));
        }
      }
    }
  } catch (e) {}
}

function edCartoProgramarSnap() {
  clearTimeout(edCartoSnapTimer);
  edCartoSnapTimer = setTimeout(edCartoCargarSnapCercanos, 350);
}

function edCartoQuitarModoCorteClics() {
  edCartoCutLineSource?.clear();
}

function edCartoQuitarInteracciones() {
  if (!edCartoMap) return;
  edCartoQuitarModoCorteClics();
  [edCartoModify, edCartoDraw, edCartoDrawLine, edCartoTranslate, edCartoRotate].forEach(function(ix) {
    if (ix) edCartoMap.removeInteraction(ix);
  });
  edCartoSnaps.forEach(function(s) { edCartoMap.removeInteraction(s); });
  edCartoModify = null;
  edCartoDraw = null;
  edCartoDrawLine = null;
  edCartoTranslate = null;
  edCartoRotate = null;
  edCartoSnaps = [];
}

function edCartoQuitarInteraccionesSig() {
  edCartoQuitarInteracciones();
  if (edCartoSelect && edCartoMap) {
    edCartoMap.removeInteraction(edCartoSelect);
    edCartoSelect = null;
  }
}

function edCartoInstalarSnap() {
  if (!edCartoMap || !edCartoSnapActivo) return;
  edCartoSnaps = [];
  edCartoSnaps.push(new ol.interaction.Snap({ source: edCartoEditSource, pixelTolerance: 14 }));
  if (edCartoCapas?.snapVector) {
    edCartoSnaps.push(new ol.interaction.Snap({
      source: edCartoCapas.snapVector.getSource(),
      pixelTolerance: 14
    }));
  }
  edCartoSnaps.forEach(function(s) { edCartoMap.addInteraction(s); });
}

function edCartoAlCambiarGeometria() {
  edCartoMarcarDirty(true);
  edCartoSyncFeaturePrimaria();
}

function edCartoActivarModoSelect() {
  if (!edCartoMap || !edCartoEditSource) return;
  edCartoModo = "select";
  edCartoCutTargetFeature = null;
  edCartoQuitarInteracciones();
  edCartoCutLineSource?.clear();
  edCartoAsegurarSelect();
  edCartoRefreshCapaEdicion();
  edCartoSyncBotonesModo();
  edCartoSetMensaje("Seleccione polígonos en el mapa (Shift+clic = varios).", "info");
}

function edCartoActivarModoTranslate() {
  if (!edCartoMap || !edCartoEditSource) return;
  const feats = edCartoEditSource.getFeatures();
  if (!feats.length) {
    edCartoSetMensaje("No hay contorno. Dibuje o cargue un predio.", "info");
    return;
  }
  edCartoModo = "translate";
  edCartoQuitarInteracciones();
  edCartoAsegurarSelect();
  if (!edCartoSelect.getFeatures().getLength()) {
    edCartoSelect.getFeatures().push(edCartoEditFeature || feats[0]);
  }
  edCartoTranslate = new ol.interaction.Translate({
    features: edCartoSelect.getFeatures(),
    hitTolerance: 8
  });
  edCartoTranslate.on("translateend", edCartoAlCambiarGeometria);
  edCartoMap.addInteraction(edCartoTranslate);
  edCartoInstalarSnap();
  edCartoSyncBotonesModo();
  edCartoSetMensaje("Seleccione y arrastre el polígono para moverlo.", "info");
}

function edCartoActivarModoRotate() {
  if (!edCartoMap || !edCartoEditSource) return;
  if (!edCartoEditSource.getFeatures().length) {
    edCartoSetMensaje("No hay contorno. Dibuje o cargue un predio.", "info");
    return;
  }
  edCartoModo = "rotate";
  edCartoQuitarInteracciones();
  edCartoAsegurarSelect();
  if (!edCartoSelect.getFeatures().getLength()) {
    edCartoSelect.getFeatures().push(edCartoEditFeature || edCartoEditSource.getFeatures()[0]);
  }
  edCartoRotate = new ol.interaction.Rotate({
    features: edCartoSelect.getFeatures()
  });
  edCartoRotate.on("rotateend", edCartoAlCambiarGeometria);
  edCartoMap.addInteraction(edCartoRotate);
  edCartoInstalarSnap();
  edCartoSyncBotonesModo();
  edCartoSetMensaje("Seleccione el polígono y gire con el asa de rotación.", "info");
}

function edCartoResolverPoligonoCorte() {
  const sel = edCartoGetFeaturesSeleccionados();
  if (sel.length) return sel[0];
  if (edCartoEditFeature) return edCartoEditFeature;
  const all = edCartoEditSource?.getFeatures() || [];
  return all.length === 1 ? all[0] : null;
}

function edCartoEjecutarCorteConLinea(target, line3857) {
  const poly = target.getGeometry();
  const parts = edCartoSplitConLinea(poly, line3857);
  edCartoCutLineSource?.clear();
  if (!parts) {
    edCartoSetMensaje(
      "No se pudo dividir. Trace la línea de un borde al opuesto (2 clics bien separados).",
      "error"
    );
    edCartoActivarModoCutLine();
    return;
  }
  edCartoEditSource.clear();
  parts.forEach(function(g, idx) {
    const f = new ol.Feature({ geometry: g });
    f.set("parte", idx + 1);
    edCartoEditSource.addFeature(f);
  });
  edCartoCutTargetFeature = null;
  edCartoEditFeature = edCartoEditSource.getFeatures()[0];
  edCartoLimpiarSeleccion();
  edCartoAlCambiarGeometria();
  edCartoZoomPredio(edCartoEditFeature.getGeometry());
  edCartoSetMensaje("Corte OK: " + parts.length + " polígonos. Indique claves resultantes y guarde.", "ok");
  if (edCartoProcedimiento !== "SUBDIVISION") {
    const selProc = document.getElementById("edicionCartoProcedimiento");
    if (selProc) selProc.value = "SUBDIVISION";
    edCartoProcedimiento = "SUBDIVISION";
    edCartoActualizarUiProcedimiento();
  }
  edCartoActivarModoSelect();
}

function edCartoActivarModoCutLine() {
  if (!edCartoMap || !edCartoEditSource) return;
  const target = edCartoResolverPoligonoCorte();
  if (!target) {
    edCartoSetMensaje("Cargue un predio o selecciónelo (Sel) antes de cortar.", "error");
    return;
  }
  edCartoEditFeature = target;
  edCartoCutTargetFeature = target;
  edCartoModo = "cutline";
  edCartoQuitarInteracciones();
  edCartoOcultarSelectDelMapa();
  edCartoRefreshCapaEdicion();
  edCartoCutLineSource?.clear();

  edCartoDrawLine = new ol.interaction.Draw({
    source: edCartoCutLineSource,
    type: "LineString",
    maxPoints: 2,
    stopClick: true,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#dc2626", width: 4, lineDash: [10, 6] }),
      image: new ol.style.Circle({
        radius: 6,
        fill: new ol.style.Fill({ color: "#fff" }),
        stroke: new ol.style.Stroke({ color: "#dc2626", width: 2 })
      })
    })
  });
  edCartoDrawLine.on("drawstart", function() {
    edCartoCutLineSource?.clear();
    edCartoSetMensaje("1.er punto OK. 2.º clic: fin de la línea (atravesando el predio).", "info");
  });
  edCartoDrawLine.on("drawend", function(evt) {
    const line = evt.feature.getGeometry();
    if (edCartoDrawLine && edCartoMap) {
      edCartoMap.removeInteraction(edCartoDrawLine);
      edCartoDrawLine = null;
    }
    edCartoEjecutarCorteConLinea(target, line);
  });
  edCartoMap.addInteraction(edCartoDrawLine);

  edCartoSyncBotonesModo();
  edCartoSetMensaje(
    "Corte: 1.er clic inicio, 2.º clic fin. El predio en amarillo es el que se dividirá.",
    "info"
  );
}

function edCartoFusionarSeleccionados() {
  if (!edCartoJstsDisponible()) {
    edCartoSetMensaje("JSTS no cargado. Recargue con Ctrl+F5 (v148).", "error");
    return;
  }
  let feats = edCartoGetFeaturesSeleccionados();
  if (feats.length < 2) feats = edCartoEditSource.getFeatures();
  if (feats.length < 2) {
    edCartoSetMensaje("Seleccione al menos 2 polígonos (Shift+clic) para fusionar.", "error");
    return;
  }
  try {
    const parser = edCartoCrearParserJsts();
    let union = parser.read(feats[0].getGeometry());
    for (let i = 1; i < feats.length; i++) {
      union = union.union(parser.read(feats[i].getGeometry()));
    }
    const merged = parser.write(union);
    edCartoEditSource.clear();
    edCartoEditFeature = new ol.Feature({ geometry: merged });
    edCartoEditSource.addFeature(edCartoEditFeature);
    edCartoLimpiarSeleccion();
    edCartoAlCambiarGeometria();
    edCartoZoomPredio(merged);
    if (edCartoProcedimiento !== "FUSION") {
      const sel = document.getElementById("edicionCartoProcedimiento");
      if (sel) sel.value = "FUSION";
      edCartoProcedimiento = "FUSION";
      edCartoActualizarUiProcedimiento();
    }
    edCartoSetMensaje("Fusión cartográfica aplicada. Revise contorno y guarde.", "ok");
    edCartoActivarModoSelect();
  } catch (e) {
    edCartoSetMensaje("No se pudo fusionar: " + (e.message || e), "error");
  }
}

function edCartoBorrarSeleccion() {
  const sel = edCartoGetFeaturesSeleccionados();
  const borrar = sel.length ? sel : (edCartoEditFeature ? [edCartoEditFeature] : []);
  if (!borrar.length) {
    edCartoSetMensaje("Seleccione un polígono para borrar.", "info");
    return;
  }
  if (!confirm("¿Eliminar " + borrar.length + " polígono(s) del lienzo de edición?")) return;
  borrar.forEach(function(f) { edCartoEditSource.removeFeature(f); });
  edCartoLimpiarSeleccion();
  edCartoSyncFeaturePrimaria();
  if (!edCartoEditSource.getFeatures().length) {
    edCartoEditFeature = null;
    edCartoActualizarVertices(null);
  }
  edCartoAlCambiarGeometria();
  edCartoSetMensaje("Polígono(s) eliminados del lienzo.", "info");
}

function edCartoActivarModoModify() {
  if (!edCartoMap || !edCartoEditSource) return;
  const tieneContorno = edCartoEditFeature || edCartoEditSource.getFeatures().length > 0;
  if (!tieneContorno) {
    edCartoSetMensaje("No hay contorno. Activando modo dibujo…", "info");
    edCartoActivarModoDraw();
    return;
  }
  edCartoModo = "modify";
  edCartoQuitarInteracciones();
  edCartoAsegurarSelect();
  edCartoModify = new ol.interaction.Modify({ source: edCartoEditSource, style: edCartoEstiloContornoActivo() });
  edCartoModify.on("modifyend", edCartoAlCambiarGeometria);
  edCartoMap.addInteraction(edCartoModify);
  edCartoInstalarSnap();
  edCartoSyncBotonesModo();
  edCartoSetMensaje("Arrastre los vértices del contorno azul para ajustar el predio.", "info");
}

function edCartoActivarModoDraw() {
  edCartoModo = "draw";
  edCartoQuitarInteracciones();
  if (!edCartoMap || !edCartoEditSource) return;
  edCartoLimpiarSeleccion();
  edCartoEditSource.clear();
  edCartoEditFeature = null;
  edCartoActualizarVertices(null);
  edCartoActualizarResumenPanel();
  edCartoDraw = new ol.interaction.Draw({
    source: edCartoEditSource,
    type: "Polygon",
    style: edCartoEstiloContornoDibujo()
  });
  edCartoDraw.on("drawstart", function() {
    edCartoSetMensaje("Dibujando… clic en cada vértice; cierre en el primer punto o doble clic.", "info");
  });
  edCartoDraw.on("drawabort", function() {
    edCartoSetMensaje("Dibujo cancelado. Vuelva a pulsar «Dibujar polígono».", "info");
  });
  edCartoDraw.on("drawend", function(evt) {
    const geom = evt.feature.getGeometry()?.clone?.();
    if (!geom) {
      edCartoSetMensaje("No se pudo cerrar el polígono. Intente de nuevo con al menos 3 vértices.", "error");
      edCartoActivarModoDraw();
      return;
    }
    edCartoEditSource.clear();
    edCartoEditFeature = new ol.Feature({ geometry: geom });
    edCartoEditSource.addFeature(edCartoEditFeature);
    edCartoAlCambiarGeometria();
    edCartoZoomPredio(geom);
    edCartoSetMensaje("Contorno listo (azul). Revise área y guarde, o ajuste vértices.", "ok");
    edCartoActivarModoSelect();
  });
  edCartoMap.addInteraction(edCartoDraw);
  edCartoInstalarSnap();
  edCartoSyncBotonesModo();
  edCartoSetMensaje("Modo dibujo: clic en cada vértice; cierre en el primer punto o doble clic.", "info");
}

function edCartoToggleSnap() {
  edCartoSnapActivo = !edCartoSnapActivo;
  ["edicionCartoBtnSnap", "edicionCartoMapBtnSnap"].forEach(function(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("activo", edCartoSnapActivo);
    btn.textContent = edCartoSnapActivo ? "Snap: ON" : "Snap: OFF";
  });
  if (edCartoModo === "modify") edCartoActivarModoModify();
  else if (edCartoModo === "draw") edCartoActivarModoDraw();
  else if (edCartoModo === "translate") edCartoActivarModoTranslate();
  else if (edCartoModo === "rotate") edCartoActivarModoRotate();
  else if (edCartoModo === "cutline") edCartoActivarModoCutLine();
}

function edCartoZoomPredio(geom3857) {
  if (!edCartoMap || !geom3857) return;
  const ext = geom3857.getExtent();
  if (!ext || !Number.isFinite(ext[0])) return;
  edCartoMap.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 20, duration: 400 });
}

function edCartoEstablecerGeometria(geom3857, clonarOriginal) {
  if (!edCartoEditSource) {
    edCartoInitMapa(true);
  }
  if (!edCartoEditSource) return;
  edCartoEditSource.clear();
  edCartoEditFeature = null;
  if (!geom3857) {
    edCartoGeomOriginal = null;
    edCartoActualizarCapaOriginal();
    edCartoActualizarVertices(null);
    edCartoActualizarResumenPanel();
    edCartoMarcarDirty(false);
    edCartoVerCambiosActivo = true;
    edCartoAplicarVisibilidadCambios();
    edCartoActivarModoDraw();
    return;
  }
  const g = geom3857.clone ? geom3857.clone() : geom3857;
  edCartoEditFeature = new ol.Feature({ geometry: g });
  edCartoEditSource.addFeature(edCartoEditFeature);
  if (clonarOriginal !== false) edCartoGeomOriginal = g.clone();
  edCartoActualizarCapaOriginal();
  edCartoVerCambiosActivo = true;
  edCartoAplicarVisibilidadCambios();
  edCartoActualizarVertices(g);
  edCartoZoomPredio(g);
  edCartoMarcarDirty(false);
  edCartoActualizarResumenPanel();
  edCartoActivarModoSelect();
}

async function edCartoResolverGeometria(clave) {
  if (typeof resolverGeometriaPredioPopup === "function") {
    return resolverGeometriaPredioPopup(clave);
  }
  try {
    const r = await fetch(API + "/predios/" + encodeURIComponent(clave) + "/geojson", {
      headers: typeof authHeaders === "function" ? authHeaders() : {},
      cache: "no-store"
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.geometry) return null;
    const fmt = new ol.format.GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
    return fmt.readGeometry(data.geometry);
  } catch (e) {
    return null;
  }
}

async function edCartoCargarPredio(claveOpt) {
  const clave = String(claveOpt || document.getElementById("edicionCartoInputClave")?.value || "").trim().toUpperCase();
  if (!clave) {
    edCartoSetMensaje("Indique la clave catastral.", "error");
    return;
  }
  edCartoSetMensaje("Cargando predio…", "info");
  edCartoClave = clave;
  edCartoGuardadoOk = false;
  edCartoActualizarBotonTramite();
  const input = document.getElementById("edicionCartoInputClave");
  if (input) input.value = clave;
  if (edCartoProcedimiento === "FUSION") {
    const dest = document.getElementById("edicionCartoClaveDestino");
    if (dest && !String(dest.value || "").trim()) dest.value = clave;
  }

  let geom = await edCartoResolverGeometria(clave);
  if (!geom) {
    edCartoEstablecerGeometria(null, false);
    edCartoSetMensaje("Sin geometría. Use «Dibujar polígono» para crear el contorno.", "info");
    edCartoActivarModoDraw();
    return;
  }
  edCartoEstablecerGeometria(geom, true);
  edCartoSetMensaje("Predio cargado. Modifique vértices o guarde cambios.", "ok");
  await edCartoCargarSnapCercanos();
}

async function edCartoCargarPredioActual() {
  const clave = String(typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "").trim().toUpperCase();
  if (!clave) {
    edCartoSetMensaje("Seleccione un predio en consulta o escriba la clave.", "error");
    return;
  }
  document.getElementById("edicionCartoInputClave").value = clave;
  await edCartoCargarPredio(clave);
}

function edCartoDescartar() {
  if (!edCartoClave) return;
  if (edCartoGeomOriginal) {
    edCartoEstablecerGeometria(edCartoGeomOriginal.clone(), true);
    edCartoSetMensaje("Cambios descartados.", "info");
  } else {
    edCartoEstablecerGeometria(null, false);
    edCartoSetMensaje("Geometría eliminada del lienzo.", "info");
  }
}

function edCartoParseClavesResultantes(texto) {
  const raw = String(
    texto != null ? texto : document.getElementById("edicionCartoClavesResultantes")?.value || ""
  ).trim();
  if (!raw) return [];
  return raw.split(/[,;\n]+/).map(function(c) { return c.trim().toUpperCase(); }).filter(Boolean);
}

function edCartoFeatureGeometriaA4326(feature) {
  if (!feature?.getGeometry) return null;
  const fmt = new ol.format.GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
  const geom = fmt.writeGeometryObject(feature.getGeometry().clone());
  if (geom?.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geom.coordinates] };
  }
  return geom;
}

function edCartoGeometriaA4326() {
  edCartoSyncFeaturePrimaria();
  const geom = edCartoEditFeature?.getGeometry?.();
  if (!geom) return null;
  const fmt = new ol.format.GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
  const obj = fmt.writeGeometryObject(geom.clone());
  if (obj?.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [obj.coordinates] };
  }
  return obj;
}

function edCartoOrdenarFeaturesEdicion(feats) {
  return feats.slice().sort(function(a, b) {
    const pa = Number(a.get("parte") || 0);
    const pb = Number(b.get("parte") || 0);
    if (pa && pb && pa !== pb) return pa - pb;
    return (b.getGeometry()?.getArea?.() || 0) - (a.getGeometry()?.getArea?.() || 0);
  });
}

async function edCartoGuardarGeometriaPredio(clave, geometry, opciones) {
  const cfg = opciones?.cfg || edCartoGetProcedimientoConfig();
  const motivo = opciones?.motivo || (document.getElementById("edicionCartoMotivo")?.value || "").trim() || cfg.titulo;
  const crearSi = opciones?.crearSiAusente != null ? !!opciones.crearSiAusente : !!cfg.crearSiAusente;
  const r = await fetch(API + "/predios/" + encodeURIComponent(clave) + "/geometria", {
    method: "PUT",
    headers: Object.assign(
      { "Content-Type": "application/json" },
      typeof authHeaders === "function" ? authHeaders() : {}
    ),
    body: JSON.stringify({
      geometry: geometry,
      motivo: motivo,
      procedimiento: edCartoProcedimiento,
      crear_si_ausente: crearSi
    })
  });
  const data = await r.json().catch(function() { return {}; });
  if (!r.ok) throw new Error(data.detail || ("No se pudo guardar " + clave));
  return data;
}

async function edCartoGuardar() {
  const errVal = edCartoValidarAntesGuardar();
  if (errVal) {
    edCartoSetMensaje(errVal, "error");
    return;
  }
  const cfg = edCartoGetProcedimientoConfig();
  const motivo = (document.getElementById("edicionCartoMotivo")?.value || "").trim();
  const feats = edCartoOrdenarFeaturesEdicion(edCartoEditSource?.getFeatures() || []);

  if (edCartoProcedimiento === "SUBDIVISION" && feats.length >= 2) {
    const claves = edCartoParseClavesResultantes();
    edCartoSetMensaje("Guardando " + feats.length + " geometrías de subdivisión…", "info");
    try {
      const guardados = [];
      for (let i = 0; i < feats.length; i++) {
        const geometry = edCartoFeatureGeometriaA4326(feats[i]);
        if (!geometry) throw new Error("Polígono " + (i + 1) + " sin geometría válida");
        const data = await edCartoGuardarGeometriaPredio(claves[i], geometry, {
          cfg: cfg,
          motivo: motivo || cfg.titulo,
          crearSiAusente: true
        });
        guardados.push({ clave: claves[i], area: data.area_m2 });
      }
      edCartoClave = claves[0];
      edCartoEditFeature = feats[0];
      edCartoMarcarDirty(false);
      edCartoGuardadoOk = true;
      edCartoGeomOriginal = feats[0].getGeometry().clone();
      edCartoActualizarCapaOriginal();
      edCartoActualizarResumenPanel();
      edCartoActualizarBotonTramite();
      const resumen = guardados.map(function(g) {
        return g.clave + " (" + (g.area || "—") + " m²)";
      }).join(" · ");
      edCartoSetMensaje("Subdivisión guardada: " + resumen, "ok");
      return;
    } catch (e) {
      edCartoGuardadoOk = false;
      edCartoActualizarBotonTramite();
      edCartoSetMensaje(e.message, "error");
      return;
    }
  }

  const claveGuardar = edCartoClaveActivaParaGuardar();
  const geometry = edCartoGeometriaA4326();
  if (!geometry) {
    edCartoSetMensaje("No hay geometría para guardar.", "error");
    return;
  }
  edCartoSetMensaje("Guardando en cartografía…", "info");
  try {
    const data = await edCartoGuardarGeometriaPredio(claveGuardar, geometry, {
      cfg: cfg,
      motivo: motivo || cfg.titulo,
      crearSiAusente: !!cfg.crearSiAusente
    });
    edCartoClave = claveGuardar;
    edCartoMarcarDirty(false);
    edCartoGuardadoOk = true;
    edCartoGeomOriginal = edCartoEditFeature.getGeometry().clone();
    edCartoActualizarCapaOriginal();
    edCartoActualizarResumenPanel();
    edCartoActualizarBotonTramite();
    edCartoSetMensaje("Geometría guardada · Área " + (data.area_m2 || "—") + " m²", "ok");
    if (typeof claveSeleccionadaActual !== "undefined") {
      window.claveSeleccionadaActual = claveGuardar;
    }
    if (typeof pintarGeoJSON === "function" && claveGuardar) {
      try {
        const r2 = await fetch(API + "/predios/" + encodeURIComponent(claveGuardar) + "/geojson", {
          headers: typeof authHeaders === "function" ? authHeaders() : {}
        });
        if (r2.ok) {
          const feat = await r2.json();
          pintarGeoJSON(feat, claveGuardar);
        }
      } catch (e) {}
    }
    if (cfg.movTipo) {
      edCartoSetMensaje(
        "Geometría guardada · Área " + (data.area_m2 || "—") + " m². Puede continuar el trámite en padrón.",
        "ok"
      );
    }
  } catch (e) {
    edCartoGuardadoOk = false;
    edCartoActualizarBotonTramite();
    edCartoSetMensaje(e.message, "error");
  }
}

async function edCartoAbrirTramitePadron() {
  const cfg = edCartoGetProcedimientoConfig();
  if (!cfg.movTipo) {
    edCartoSetMensaje("Este procedimiento no requiere trámite de padrón.", "info");
    return;
  }
  if (edCartoDirty) {
    edCartoSetMensaje("Guarde la geometría antes de abrir el trámite.", "error");
    return;
  }
  if (!edCartoGuardadoOk) {
    edCartoSetMensaje("Guarde primero la geometría en cartografía.", "error");
    return;
  }
  const clave = edCartoClaveActivaParaGuardar();
  if (cfg.movTipo !== "ALTA_CLAVE" && !clave) {
    edCartoSetMensaje("Cargue la clave del predio.", "error");
    return;
  }
  if (typeof claveSeleccionadaActual !== "undefined") {
    window.claveSeleccionadaActual = clave;
  }
  if (typeof abrirModalMovimientoPadron !== "function") {
    alert("El módulo de movimientos no está disponible. Recargue con Ctrl+F5.");
    return;
  }
  await abrirModalMovimientoPadron(cfg.movTipo);
  if (cfg.movTipo === "ALTA_CLAVE") {
    const inp = document.getElementById("movPadron_clave_catastral");
    if (inp && clave) inp.value = clave;
  }
  if (cfg.movTipo === "SUBDIVISION") {
    const extra = document.getElementById("edicionCartoClavesResultantes")?.value || "";
    const inp = document.getElementById("movPadron_claves_resultantes");
    if (inp && extra) inp.value = extra;
    const claveInp = document.getElementById("movPadronClave");
    if (claveInp && edCartoClave) claveInp.value = edCartoClave;
  }
  if (cfg.movTipo === "FUSION") {
    const orig = document.getElementById("edicionCartoClavesOrigen")?.value || "";
    const dest = document.getElementById("edicionCartoClaveDestino")?.value || clave;
    const inpO = document.getElementById("movPadron_claves_origen");
    const inpD = document.getElementById("movPadron_clave_destino");
    if (inpO && orig) inpO.value = orig;
    if (inpD && dest) inpD.value = dest;
  }
}

function edCartoInstalarClickMapa() {
  if (!edCartoMap) return;
  edCartoMap.un("singleclick", edCartoOnMapClick);
  edCartoMap.on("singleclick", edCartoOnMapClick);
}

async function edCartoOnMapClick(evt) {
  if (["draw", "cutline", "translate", "rotate", "modify"].includes(edCartoModo)) return;
  if (edCartoEditSource?.getFeatures()?.length) return;
  const lonLat = ol.proj.toLonLat(evt.coordinate);
  try {
    const qs = new URLSearchParams({ lon: String(lonLat[0]), lat: String(lonLat[1]) });
    const r = await fetch(API + "/predios/intersecta?" + qs, {
      headers: typeof authHeaders === "function" ? authHeaders() : {},
      cache: "no-store"
    });
    if (!r.ok) return;
    const data = await r.json();
    const clave = typeof extraerClavePredioProps === "function"
      ? extraerClavePredioProps(data.properties || data)
      : (data?.properties?.clave_catastral || data?.clave_catastral || "");
    if (!clave) return;
    if (edCartoDirty && !confirm("Hay cambios sin guardar. ¿Cargar otro predio?")) return;
    document.getElementById("edicionCartoInputClave").value = clave;
    await edCartoCargarPredio(clave);
  } catch (e) {}
}

function edCartoInitMapa(forzarReinicio) {
  const target = document.getElementById("edicionCartoMap");
  if (!target) return false;
  if (forzarReinicio && edCartoMap) edCartoDestruirMapa();
  if (edCartoMap) return true;
  if (typeof ol === "undefined") {
    edCartoSetMensaje("OpenLayers no está disponible. Recargue la página con Ctrl+F5.", "error");
    return false;
  }
  edCartoCapas = edCartoCrearCapas();
  edCartoMap = new ol.Map({
    target: target,
    layers: [
      edCartoCapas.base,
      edCartoCapas.coloniasWms,
      edCartoCapas.prediosWms,
      edCartoCapas.snapVector,
      edCartoCapas.originalLayer,
      edCartoCapas.editLayer,
      edCartoCapas.vertices,
      edCartoCapas.cutLineLayer
    ],
    interactions: (function() {
      try {
        if (ol.interaction?.defaults?.defaults) {
          return ol.interaction.defaults.defaults({ doubleClickZoom: false, altShiftDragRotate: false });
        }
        if (typeof ol.interaction?.defaults === "function") {
          return ol.interaction.defaults({ doubleClickZoom: false, altShiftDragRotate: false });
        }
      } catch (e) {}
      return undefined;
    })(),
    view: new ol.View({
      center: ol.proj.fromLonLat([-115.468, 32.624]),
      zoom: 14
    })
  });
  edCartoQuitarDoubleClickZoom();
  edCartoMap.on("moveend", edCartoProgramarSnap);
  edCartoInstalarClickMapa();
  edCartoAsegurarSelect();
  edCartoActivarModoSelect();
  setTimeout(function() { edCartoCargarSnapCercanos(); }, 300);
  setTimeout(function() { edCartoMap?.updateSize(); }, 120);
  setTimeout(function() { edCartoMap?.updateSize(); }, 420);
  return true;
}

function edCartoDestruirMapa() {
  edCartoQuitarInteraccionesSig();
  if (edCartoMap) {
    edCartoMap.un("singleclick", edCartoOnMapClick);
    edCartoMap.un("moveend", edCartoProgramarSnap);
    edCartoMap.setTarget(null);
    edCartoMap = null;
  }
  edCartoCapas = null;
  edCartoEditSource = null;
  edCartoOriginalSource = null;
  edCartoCutLineSource = null;
  edCartoCutTargetFeature = null;
  edCartoEditFeature = null;
  clearTimeout(edCartoSnapTimer);
}

function abrirModuloCartograficoDesdePortal() {
  const overlay = document.getElementById("overlayEdicionCartografica");
  if (!overlay) {
    alert(
      "Falta el HTML del módulo cartográfico en el servidor.\n\n" +
      "Suba index.html (overlay #overlayEdicionCartografica), css/58-edicion-cartografica.css " +
      "y js/51-edicion-cartografica.js, luego recargue con Ctrl+F5."
    );
    if (typeof mostrarSelectorModulos === "function") {
      mostrarSelectorModulos(typeof obtenerUsuarioSesion === "function" ? obtenerUsuarioSesion() : null);
    }
    return false;
  }
  abrirEdicionCartografica({ desdePortal: true });
  return true;
}

function abrirEdicionCartografica(opciones) {
  let claveOpt = "";
  let desdePortal = false;
  if (typeof opciones === "string") {
    claveOpt = opciones;
  } else if (opciones && typeof opciones === "object") {
    claveOpt = opciones.clave || "";
    desdePortal = !!opciones.desdePortal;
  }

  const overlay = document.getElementById("overlayEdicionCartografica");
  if (!overlay) {
    alert("No se encontró el editor cartográfico (#overlayEdicionCartografica). Actualice index.html en el servidor.");
    return false;
  }

  overlay.classList.remove("oculto");
  document.body.classList.add("edicion-carto-activo");
  edCartoDesdePortal = desdePortal;
  edCartoProcedimiento = "EDICION";
  edCartoGuardadoOk = false;
  edCartoVerCambiosActivo = true;
  const selProc = document.getElementById("edicionCartoProcedimiento");
  if (selProc) selProc.value = "EDICION";
  document.getElementById("edicionCartoBtnModulos")?.classList.toggle("oculto", !desdePortal);
  edCartoActualizarUiProcedimiento();
  edCartoSetMensaje("", "");
  edCartoMarcarDirty(false);
  edCartoClave = "";

  try {
    edCartoInitMapa(true);
    const clave = claveOpt || String(typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "").trim().toUpperCase();
    if (clave && !desdePortal) {
      const inputClave = document.getElementById("edicionCartoInputClave");
      if (inputClave) inputClave.value = clave;
      edCartoCargarPredio(clave);
    } else if (desdePortal) {
      const inputClave = document.getElementById("edicionCartoInputClave");
      if (inputClave) inputClave.value = "";
      edCartoEstablecerGeometria(null, false);
      edCartoSetMensaje("Use la barra sobre el mapa: Edición, Crear, Corte o Fusión.", "info");
    }
    edCartoAplicarVisibilidadCambios();
    edCartoSyncBotonesModo();
  } catch (e) {
    console.error("Error al abrir módulo cartográfico:", e);
    edCartoSetMensaje("Error al iniciar el mapa: " + (e.message || e), "error");
  }
  return true;
}

function cerrarEdicionCartograficaSilencioso() {
  edCartoDestruirMapa();
  document.getElementById("overlayEdicionCartografica")?.classList.add("oculto");
  document.body.classList.remove("edicion-carto-activo", "modo-modulo-cartografico");
  document.getElementById("edicionCartoBtnModulos")?.classList.add("oculto");
  edCartoDesdePortal = false;
  edCartoClave = "";
  edCartoGeomOriginal = null;
  edCartoGuardadoOk = false;
  edCartoMarcarDirty(false);
}

function edCartoVolverModulos() {
  if (edCartoDirty && !confirm("Hay cambios sin guardar. ¿Volver al selector de módulos?")) return;
  cerrarEdicionCartograficaSilencioso();
  if (typeof mostrarSelectorModulos === "function") {
    mostrarSelectorModulos(typeof obtenerUsuarioSesion === "function" ? obtenerUsuarioSesion() : null);
  }
}

function cerrarEdicionCartografica() {
  if (edCartoDirty && !confirm("Hay cambios sin guardar. ¿Cerrar el editor?")) return;
  if (edCartoDesdePortal) {
    edCartoVolverModulos();
    return;
  }
  cerrarEdicionCartograficaSilencioso();
}

window.abrirModuloCartograficoDesdePortal = abrirModuloCartograficoDesdePortal;
window.abrirEdicionCartografica = abrirEdicionCartografica;
window.cerrarEdicionCartografica = cerrarEdicionCartografica;
window.cerrarEdicionCartograficaSilencioso = cerrarEdicionCartograficaSilencioso;
window.edCartoVolverModulos = edCartoVolverModulos;
window.edCartoCambiarProcedimiento = edCartoCambiarProcedimiento;
window.edCartoAbrirTramitePadron = edCartoAbrirTramitePadron;
window.edCartoToolbarProcedimiento = edCartoToolbarProcedimiento;
window.edCartoToggleVerCambios = edCartoToggleVerCambios;
window.edCartoCargarPredio = edCartoCargarPredio;
window.edCartoCargarPredioActual = edCartoCargarPredioActual;
window.edCartoActivarModoSelect = edCartoActivarModoSelect;
window.edCartoActivarModoTranslate = edCartoActivarModoTranslate;
window.edCartoActivarModoRotate = edCartoActivarModoRotate;
window.edCartoActivarModoCutLine = edCartoActivarModoCutLine;
window.edCartoFusionarSeleccionados = edCartoFusionarSeleccionados;
window.edCartoBorrarSeleccion = edCartoBorrarSeleccion;
window.edCartoActivarModoModify = edCartoActivarModoModify;
window.edCartoActivarModoDraw = edCartoActivarModoDraw;
window.edCartoToggleSnap = edCartoToggleSnap;
window.edCartoGuardar = edCartoGuardar;
window.edCartoDescartar = edCartoDescartar;
