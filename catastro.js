
/* --- v21: Login institucional JWT --- */
const TOKEN_KEY_CATASTRO = "catastro_bc_token";
const USER_KEY_CATASTRO = "catastro_bc_usuario";

function obtenerTokenInstitucional() {
  return localStorage.getItem(TOKEN_KEY_CATASTRO) || "";
}

function obtenerUsuarioSesion() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY_CATASTRO) || "null");
  } catch (e) {
    return null;
  }
}

function obtenerRolSesion() {
  return (obtenerUsuarioSesion()?.rol || "consulta").trim().toLowerCase();
}

function puedeEditarCatastro(rol) {
  return ["admin", "supervisor", "catastro"].includes(String(rol || obtenerRolSesion()).trim().toLowerCase());
}

function guardarSesionInstitucional(data) {
  localStorage.setItem(TOKEN_KEY_CATASTRO, data.access_token);
  localStorage.setItem(USER_KEY_CATASTRO, JSON.stringify({
    usuario: data.usuario,
    nombre: data.nombre,
    rol: data.rol,
    expira_minutos: data.expira_minutos
  }));
}

function limpiarSesionInstitucional() {
  localStorage.removeItem(TOKEN_KEY_CATASTRO);
  localStorage.removeItem(USER_KEY_CATASTRO);
}

function mostrarLoginInstitucional() {
  const overlay = document.getElementById("loginOverlay");
  const barra = document.getElementById("barraSesion");
  const app = document.getElementById("appInstitucional");
  if (overlay) overlay.classList.remove("oculto");
  if (barra) barra.classList.add("oculto");
  if (app) app.classList.add("oculto");
  document.body.classList.remove("portal-institucional-activo");
}

function mostrarSistemaInstitucional(usuario) {
  const overlay = document.getElementById("loginOverlay");
  const barra = document.getElementById("barraSesion");
  const app = document.getElementById("appInstitucional");

  if (overlay) overlay.classList.add("oculto");
  if (app) app.classList.remove("oculto");
  document.body.classList.add("portal-institucional-activo");

  if (barra) {
    barra.classList.remove("oculto");
    document.getElementById("sesionNombre").innerText = usuario?.nombre || usuario?.usuario || "Usuario";
    document.getElementById("sesionRol").innerText = usuario?.rol ? `Rol: ${usuario.rol}` : "";
  }

  aplicarPermisosVisuales(usuario?.rol || "consulta");
  iniciarRelojInstitucional();
  actualizarBreadcrumbModulo("tabConsulta");

  // Los dashboards consultan endpoints protegidos: se cargan aquí, ya con
  // sesión válida (tanto al validar token como al iniciar sesión), para que
  // siempre viajen con el token y no devuelvan 401.
  setTimeout(() => {
    if (typeof cargarDashboardCartografico === "function") cargarDashboardCartografico();
    if (typeof cargarDashboardFiscal === "function") cargarDashboardFiscal();
  }, 200);

  if (String(usuario?.rol || "").toLowerCase() === "admin") {
    setTimeout(() => {
      if (typeof cargarUsuariosAdmin === "function") cargarUsuariosAdmin();
      if (typeof cargarAuditoriaAdmin === "function") cargarAuditoriaAdmin();
    }, 400);
  }

  actualizarLeyendaDinamica();
  if (document.getElementById("chkLeyenda")?.checked !== false) {
    aplicarVisibilidadLeyendaIntegrada(true);
  }
  actualizarLayoutPrincipal();
}

function setLoginMensaje(texto, tipo = "") {
  const msg = document.getElementById("loginMensaje");
  if (!msg) return;
  msg.innerText = texto || "";
  msg.className = "login-mensaje " + tipo;
}

async function loginInstitucional() {
  const usuario = document.getElementById("loginUsuario")?.value.trim();
  const password = document.getElementById("loginPassword")?.value || "";
  const btn = document.getElementById("btnLogin");

  if (!usuario || !password) {
    setLoginMensaje("Captura usuario y contraseña.", "error");
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerText = "Validando...";
    }

    setLoginMensaje("Validando acceso institucional...", "info");

    const r = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password })
    });

    const data = await r.json();

    if (!r.ok) {
      throw new Error(data.detail || "Usuario o contraseña incorrectos.");
    }

    guardarSesionInstitucional(data);
    setLoginMensaje("Acceso correcto.", "ok");
    mostrarSistemaInstitucional(data);

  } catch (e) {
    console.error("Error login:", e);
    limpiarSesionInstitucional();
    setLoginMensaje(e.message || "No se pudo iniciar sesión.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "Ingresar";
    }
  }
}

async function validarSesionInstitucional() {
  const token = obtenerTokenInstitucional();

  if (!token) {
    mostrarLoginInstitucional();
    return false;
  }

  try {
    const r = await fetch(`${API}/me`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!r.ok) {
      throw new Error("Sesión expirada");
    }

    const data = await r.json();

    const usuario = {
      usuario: data.usuario,
      nombre: data.nombre,
      rol: data.rol
    };

    localStorage.setItem(USER_KEY_CATASTRO, JSON.stringify(usuario));
    mostrarSistemaInstitucional(usuario);
    return true;

  } catch (e) {
    console.warn("Sesión inválida:", e);
    limpiarSesionInstitucional();
    mostrarLoginInstitucional();
    return false;
  }
}

function cerrarSesionInstitucional() {
  limpiarSesionInstitucional();
  mostrarLoginInstitucional();
}

function aplicarPermisosVisuales(rol) {
  const rolNorm = String(rol || "").trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  const puedeHerramientas = ["admin", "cartografia", "catastro", "supervisor"].includes(rolNorm);
  const puedeEditarCatastroRol = ["admin", "supervisor", "catastro"].includes(rolNorm);

  document.querySelectorAll(".solo-admin").forEach(el => {
    el.style.display = esAdmin ? "" : "none";
  });

  document.querySelectorAll(".requiere-herramientas").forEach(el => {
    el.style.display = puedeHerramientas ? "" : "none";
  });

  document.querySelectorAll(".requiere-movimientos").forEach(el => {
    el.style.display = puedeEditarCatastroRol ? "" : "none";
  });

  document.querySelectorAll(".perm-editar-catastro").forEach(el => {
    el.style.display = puedeEditarCatastroRol ? "" : "none";
  });

  document.querySelectorAll(".solo-lectura-catastro").forEach(el => {
    el.style.display = puedeEditarCatastroRol ? "none" : "";
  });

  const puedeAnalisisZonas = ["admin", "supervisor", "catastro", "fiscalizacion", "cartografia", "consulta"].includes(rolNorm);
  document.querySelectorAll(".requiere-analisis-zonas").forEach(el => {
    el.style.display = puedeAnalisisZonas ? "" : "none";
  });
  document.querySelectorAll(".requiere-analisis-condominios").forEach(el => {
    el.style.display = puedeAnalisisZonas ? "" : "none";
  });

  const tabAdmin = document.getElementById("tabAdministracion");
  if (tabAdmin && tabAdmin.classList.contains("active")) {
    tabAdmin.style.display = "";
  }
}

function prepararEventosLoginInstitucional() {
  const usuario = document.getElementById("loginUsuario");
  const pass = document.getElementById("loginPassword");

  [usuario, pass].forEach(el => {
    if (!el) return;
    el.addEventListener("keyup", e => {
      if (e.key === "Enter") loginInstitucional();
    });
  });
}


/* --- v10: administrador de opacidad y orden de capas --- */
const capaOrdenEstado = {
  predios: 30,
  fiscal: 60,
  colonias: 20,
  codigos: 25,
  auditoria: 70
};

function obtenerCapaPorId(id) {
  const candidatos = {
    predios: ["prediosWmsLayer", "prediosLayer", "wmsPrediosLayer", "layerPredios", "prediosWMS"],
    colonias: ["coloniasWmsLayer", "coloniasLayer", "wmsColoniasLayer", "layerColonias"],
    codigos: ["codigosWmsLayer", "codigosLayer", "codigosPostalesWmsLayer", "wmsCodigosLayer", "layerCodigos"],
    auditoria: ["cambiosGeomLayer", "cambiosGeometricosLayer", "auditoriaLayer", "layerCambiosGeom"],
    fiscal: ["vectorLayer", "prediosVectorLayer", "seleccionLayer", "layerVector"]
  };

  for (const nombre of (candidatos[id] || [])) {
    try {
      if (typeof window[nombre] !== "undefined" && window[nombre]) return window[nombre];
      if (eval("typeof " + nombre + " !== 'undefined'")) {
        const lyr = eval(nombre);
        if (lyr) return lyr;
      }
    } catch (e) {}
  }

  // fallback: buscar por nombre interno si fue asignado
  try {
    const layers = map.getLayers().getArray();
    return layers.find(l => l.get && (l.get("layerId") === id || l.get("name") === id)) || null;
  } catch (e) {
    return null;
  }
}

function cambiarOpacidadCapa(id, valor) {
  const opacidad = Number(valor) / 100;
  const capa = obtenerCapaPorId(id);

  const txtMap = {
    predios: "opPrediosTxt",
    fiscal: "opFiscalTxt",
    colonias: "opColoniasTxt",
    codigos: "opCodigosTxt",
    auditoria: "opAuditoriaTxt"
  };

  const txt = document.getElementById(txtMap[id]);
  if (txt) txt.innerText = `${valor}%`;

  if (capa && typeof capa.setOpacity === "function") {
    capa.setOpacity(opacidad);
  }

  // En el fiscal local, la capa vectorial es la selección/temático local.
  // Si no encuentra capa, no rompe el visor.
}

function aplicarZIndexCapa(id) {
  const capa = obtenerCapaPorId(id);
  if (capa && typeof capa.setZIndex === "function") {
    capa.setZIndex(capaOrdenEstado[id]);
  }
}

function subirCapa(id) {
  capaOrdenEstado[id] = (capaOrdenEstado[id] || 0) + 10;
  aplicarZIndexCapa(id);
  actualizarOrdenVisualCapas();
}

function bajarCapa(id) {
  capaOrdenEstado[id] = (capaOrdenEstado[id] || 0) - 10;
  aplicarZIndexCapa(id);
  actualizarOrdenVisualCapas();
}

function actualizarOrdenVisualCapas() {
  const contenedor = document.querySelector("#tabCapas .card-panel:nth-of-type(2)");
  if (!contenedor) return;

  const items = Array.from(contenedor.querySelectorAll(".layer-item"));
  items
    .sort((a, b) => {
      const za = capaOrdenEstado[a.dataset.layerId] || 0;
      const zb = capaOrdenEstado[b.dataset.layerId] || 0;
      return zb - za;
    })
    .forEach(item => contenedor.insertBefore(item, contenedor.querySelector(".dashboard-toggle-row")));
}

function inicializarAdministradorCapas() {
  Object.keys(capaOrdenEstado).forEach(aplicarZIndexCapa);

  // Intentar nombrar capas por referencia conocida.
  try { if (typeof prediosWmsLayer !== "undefined") prediosWmsLayer.set("layerId", "predios"); } catch(e) {}
  try { if (typeof coloniasWmsLayer !== "undefined") coloniasWmsLayer.set("layerId", "colonias"); } catch(e) {}
  try { if (typeof codigosWmsLayer !== "undefined") codigosWmsLayer.set("layerId", "codigos"); } catch(e) {}
  try { if (typeof cambiosGeomLayer !== "undefined") cambiosGeomLayer.set("layerId", "auditoria"); } catch(e) {}
  try { if (typeof vectorLayer !== "undefined") vectorLayer.set("layerId", "fiscal"); } catch(e) {}

  actualizarOrdenVisualCapas();
}



const MODULOS_INSTITUCIONALES = {
  tabConsulta: "Consulta catastral",
  tabCapas: "Capas del mapa",
  tabHerramientas: "Herramientas",
  tabAnalisisZonas: "Análisis zonas homogéneas",
  tabCondominios: "Régimen en condominio",
  tabMovimientos: "Movimientos catastrales",
  tabAdministracion: "Administración"
};

let relojInstitucionalTimer = null;

function iniciarRelojInstitucional() {
  const tick = () => {
    const el = document.getElementById("headerRelojInstitucional");
    if (!el) return;
    const ahora = new Date();
    el.innerHTML =
      `${ahora.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}` +
      `<br>${ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
  };
  tick();
  if (relojInstitucionalTimer) clearInterval(relojInstitucionalTimer);
  relojInstitucionalTimer = setInterval(tick, 30000);
}

function actualizarBreadcrumbModulo(tabId) {
  const mod = document.getElementById("breadcrumbModulo");
  if (mod) mod.textContent = MODULOS_INSTITUCIONALES[tabId] || "Consulta catastral";
}

function actualizarBreadcrumbPredio(clave, ficha = null) {
  const wrap = document.getElementById("breadcrumbPredioWrap");
  const txt = document.getElementById("breadcrumbPredio");
  const estado = document.getElementById("estadoPredioInstitucional");
  if (!clave) {
    wrap?.classList.add("oculto");
    estado?.classList.add("oculto");
    if (txt) txt.textContent = "—";
    return;
  }
  const claveNorm = String(clave).trim().toUpperCase();
  if (txt) txt.textContent = claveNorm;
  wrap?.classList.remove("oculto");
  if (estado) {
    const adeudo = Number(ficha?.adeudo_total || 0) > 0;
    const dibujado = !!(ficha?.dibujado);
    estado.textContent = `Predio ${claveNorm} · ${dibujado ? "Dibujado" : "Sin geometría"} · ${adeudo ? "Con adeudo" : "Sin adeudo"}`;
    estado.classList.remove("oculto");
  }
}

function irBreadcrumbInicioInstitucional() {
  const btn = document.querySelector('.tab-btn[onclick*="tabConsulta"]');
  if (typeof mostrarTab === "function") mostrarTab("tabConsulta", btn);
  if (typeof cerrarFichaFlotante === "function") cerrarFichaFlotante();
  return false;
}

function actualizarLayoutPrincipal() {
  const panel = document.getElementById("panel");
  const tabla = document.getElementById("tablaResultadosFlotante");
  const ficha = document.getElementById("fichaFlotante");
  const oculto = panel?.classList.contains("panel-oculto");
  const tablaVisible = tabla && !tabla.classList.contains("oculto");
  const fichaVisible = ficha && !ficha.classList.contains("oculto");
  document.body.classList.toggle("panel-oculto-activo", !!oculto);
  document.body.classList.toggle("tabla-resultados-visible", !!tablaVisible);
  document.body.classList.toggle("ficha-dock-oculta", !fichaVisible);
  marcarIgnorarClickMapa(450);
  setTimeout(() => {
    if (typeof map !== "undefined" && map) map.updateSize();
  }, 320);
}

function inicializarBotonOcultarPanel() {
  const header = document.querySelector("#panel .panel-header");
  if (!header || document.getElementById("btnOcultarPanel")) return;

  const btn = document.createElement("button");
  btn.id = "btnOcultarPanel";
  btn.type = "button";
  btn.innerHTML = "×";
  btn.title = "Ocultar panel";
  btn.className = "panel-close-btn";
  btn.onclick = ocultarPanelPrincipal;
  header.appendChild(btn);
}

function ocultarPanelPrincipal() {
  const panel = document.getElementById("panel");
  const btn = document.getElementById("btnMostrarPanel");
  if (panel) panel.classList.add("panel-oculto");
  if (btn) btn.classList.remove("oculto");
  actualizarLayoutPrincipal();
}

function mostrarPanelPrincipal() {
  const panel = document.getElementById("panel");
  const btn = document.getElementById("btnMostrarPanel");
  if (panel) panel.classList.remove("panel-oculto");
  if (btn) btn.classList.add("oculto");
  actualizarLayoutPrincipal();
}

const API = "https://fcnarqnodo.hopto.org/api/catastro";
const COLOR_CONTORNO_SELECCION = "#0000ff";

const vectorSource = new ol.source.Vector();

function coloresFiscalesPredio(feature) {
  const tieneInfoFiscal = feature.get("info_fiscal") === true;
  const tieneAdeudo = Number(feature.get("adeudo_total") || 0) > 0;

  if (tieneInfoFiscal || feature.get("adeudo_total") !== undefined) {
    if (tieneAdeudo) {
      return {
        strokeColor: "#c62828",
        fillColor: "rgba(198, 40, 40, 0.22)"
      };
    }
    return {
      strokeColor: "#15803d",
      fillColor: "rgba(21, 128, 61, 0.20)"
    };
  }

  return {
    strokeColor: "#64748b",
    fillColor: "rgba(100, 116, 139, 0.12)"
  };
}

function estiloEtiquetaPredio(etiqueta, destacado = false) {
  if (!etiqueta) return undefined;
  return new ol.style.Text({
    text: etiqueta,
    font: destacado ? "bold 13px Arial" : "11px Arial",
    fill: new ol.style.Fill({ color: "#000000" }),
    stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
    overflow: true
  });
}

function estiloPredio(feature) {
  const seleccionado = feature.get("seleccionado");
  const etiqueta = feature.get("clave_catastral") || "";
  const { strokeColor, fillColor } = coloresFiscalesPredio(feature);

  if (seleccionado) {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: strokeColor,
        width: 2
      }),
      fill: new ol.style.Fill({ color: fillColor }),
      text: estiloEtiquetaPredio(etiqueta, true)
    });
  }

  const tieneInfoFiscal = feature.get("info_fiscal") === true;
  return new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: strokeColor,
      width: tieneInfoFiscal ? 3 : 2
    }),
    fill: new ol.style.Fill({ color: fillColor }),
    text: estiloEtiquetaPredio(etiqueta, false)
  });
}

function estiloResultadoBusqueda(feature) {
  const seleccionado = feature.get("seleccionado");
  const etiqueta = feature.get("clave_catastral") || "";
  const { strokeColor, fillColor } = coloresFiscalesPredio(feature);

  return new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: strokeColor,
      width: seleccionado ? 2 : 2
    }),
    fill: new ol.style.Fill({ color: fillColor }),
    text: estiloEtiquetaPredio(etiqueta, seleccionado)
  });
}

function estiloCambiosGeometricos(feature) {
  const tipo = feature.get("tipo_cambio");
  const prioridad = feature.get("prioridad");
  let color = "#fdd835";

  if (prioridad === "ALTA" || tipo === "CAMBIO_CRITICO") {
    color = "#e53935";
  } else if (prioridad === "MEDIA" || tipo === "CAMBIO_GEOMETRIA_Y_AREA") {
    color = "#fb8c00";
  } else if (tipo === "GEOMETRIA_INVALIDA") {
    color = "#000000";
  }

  return new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: color,
      width: 4
    }),
    fill: new ol.style.Fill({
      color: "rgba(255, 0, 0, 0.12)"
    }),
    text: new ol.style.Text({
      text: feature.get("clave_catastral") || "",
      font: "bold 11px Arial",
      fill: new ol.style.Fill({ color: "#000000" }),
      stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
      overflow: true
    })
  });
}

const vectorLayer = new ol.layer.Vector({
  source: vectorSource,
  style: estiloPredio,
  zIndex: 90
});

const seleccionContornoSource = new ol.source.Vector();
const seleccionContornoLayer = new ol.layer.Vector({
  source: seleccionContornoSource,
  zIndex: 9999,
  style: new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: COLOR_CONTORNO_SELECCION,
      width: 4,
      lineCap: "round",
      lineJoin: "round"
    })
  })
});

function limpiarContornoSeleccion() {
  seleccionContornoSource.clear();
}

function mostrarContornoSeleccion(geometry) {
  limpiarContornoSeleccion();
  if (!geometry) return;
  const geom = typeof geometry.clone === "function" ? geometry.clone() : geometry;
  seleccionContornoSource.addFeature(new ol.Feature(geom));
}

function marcarPredioSeleccionEnCapas(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  vectorSource.getFeatures().forEach(f => {
    const activo = String(f.get("clave_catastral") || "").toUpperCase() === claveNorm;
    f.set("seleccionado", activo);
    f.changed();
  });
  if (resultadosSource) {
    resultadosSource.getFeatures().forEach(f => {
      const activo = String(f.get("clave_catastral") || "").toUpperCase() === claveNorm;
      f.set("seleccionado", activo);
      f.set("info_fiscal", true);
      f.changed();
    });
  }
}

function obtenerGeometriaPredioSeleccionado(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (resultadosSource) {
    const fRes = resultadosSource.getFeatures().find(
      f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
    );
    if (fRes) return fRes.getGeometry();
  }
  const fVec = vectorSource.getFeatures().find(
    f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
  );
  return fVec ? fVec.getGeometry() : null;
}

let seleccionPredioSeq = 0;
let claveSeleccionadaActual = "";
let ignorarClickMapaHasta = 0;

function obtenerPaddingMapaFit() {
  const ficha = document.getElementById("fichaFlotante");
  const mapEl = document.getElementById("map");
  const margen = 24;

  let top = margen;
  let left = margen;
  let right = margen;
  let bottom = margen;

  // Solo reservar espacio para elementos que flotan SOBRE el canvas del mapa (p. ej. la ficha).
  // El panel lateral y la tabla ya reducen el tamaño del mapa vía flex; no sumar su ancho aquí.
  const fichaVisible = ficha && !ficha.classList.contains("oculto");
  if (fichaVisible && mapEl) {
    const mapRect = mapEl.getBoundingClientRect();
    const fichaRect = ficha.getBoundingClientRect();
    if (mapRect.width > 0 && fichaRect.width > 0) {
      const solapeDerecho = Math.max(0, mapRect.right - fichaRect.left);
      right = Math.max(right, solapeDerecho + 32);
    } else {
      right = ficha.classList.contains("minimizada") ? 360 : 430;
    }
  }

  return [top, right, bottom, left];
}

function expandirExtentGeometria(geometry, factor = 0.45, minMetros = 28) {
  if (!geometry?.getExtent) return null;
  const extent = geometry.getExtent();
  if (!extent || ol.extent.isEmpty(extent)) return null;
  const w = ol.extent.getWidth(extent);
  const h = ol.extent.getHeight(extent);
  const buf = Math.max(w * factor, h * factor, minMetros);
  return ol.extent.buffer(extent, buf);
}

function marcarIgnorarClickMapa(ms = 900) {
  ignorarClickMapaHasta = Date.now() + ms;
}

function extraerClavePredioProps(props) {
  if (!props) return "";
  return String(
    props.clave_catastral ||
    props.clavecatas ||
    props.CLAVE_CATASTRAL ||
    props.ClaveCatas ||
    props.clave ||
    ""
  ).trim().toUpperCase();
}

function elegirPredioWmsEnClick(features, coordinate) {
  if (!Array.isArray(features) || features.length === 0) return null;
  if (features.length === 1) return features[0];

  const format = new ol.format.GeoJSON();
  let mejor = null;
  let mejorDist = Infinity;

  for (const f of features) {
    if (!f?.geometry) continue;
    try {
      const olFeature = format.readFeature(f, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      const geom = olFeature.getGeometry();
      if (!geom) continue;
      if (typeof geom.intersectsCoordinate === "function" && geom.intersectsCoordinate(coordinate)) {
        return f;
      }
      const centro = ol.extent.getCenter(geom.getExtent());
      const dist = ol.coordinate.squaredDistanceTo(centro, coordinate);
      if (dist < mejorDist) {
        mejorDist = dist;
        mejor = f;
      }
    } catch (e) {
      /* probar siguiente feature */
    }
  }
  return mejor || features[0];
}

function aplicarSeleccionVisualPredio(clave, geometry = null) {
  marcarPredioSeleccionEnCapas(clave);
  mostrarContornoSeleccion(geometry || obtenerGeometriaPredioSeleccionado(clave));
  refrescarLeyendaDespuesDeCambio();
}

// Indica si la geometría ya está (prácticamente) dentro de la vista actual,
// para evitar el "brinco" de recentrar el mapa al hacer clic en un predio visible.
function geometriaVisibleEnVista(geometry) {
  if (!geometry || typeof map === "undefined" || !map) return false;
  try {
    const ext = geometry.getExtent ? geometry.getExtent() : null;
    if (!ext || ol.extent.isEmpty(ext)) return false;
    const vista = map.getView().calculateExtent(map.getSize());
    return ol.extent.containsExtent(vista, ext);
  } catch (e) {
    return false;
  }
}

function hacerZoomAGeometria(geometry, options = {}) {
  if (!geometry || typeof map === "undefined" || !map) return false;

  let extent = geometry.getExtent ? geometry.getExtent() : null;
  if (!extent || ol.extent.isEmpty(extent)) return false;

  if (options.expandir !== false) {
    const factor = options.factorExpansion ?? 0.45;
    const minM = options.minExpansionMetros ?? 28;
    extent = expandirExtentGeometria(geometry, factor, minM) || extent;
  }

  const duration = options.duration ?? 650;
  marcarIgnorarClickMapa(duration + 300);

  map.getView().fit(extent, {
    padding: options.padding || obtenerPaddingMapaFit(),
    maxZoom: options.maxZoom ?? 18,
    duration
  });
  return true;
}

function hacerZoomAPredio(clave, geometry = null, options = {}) {
  const geom = geometry || obtenerGeometriaPredioSeleccionado(clave);
  return hacerZoomAGeometria(geom, {
    maxZoom: 18,
    factorExpansion: 0.55,
    minExpansionMetros: 32,
    ...options
  });
}

function programarZoomPredioSeleccionado(geometry, options = {}, seqCheck = null) {
  const geom = geometry || (claveSeleccionadaActual
    ? obtenerGeometriaPredioSeleccionado(claveSeleccionadaActual)
    : null);
  if (!geom) return;

  const opts = {
    maxZoom: 18,
    factorExpansion: 0.55,
    minExpansionMetros: 32,
    duration: 650,
    ...options
  };

  requestAnimationFrame(function() {
    setTimeout(function() {
      if (seqCheck !== null && seqCheck !== seleccionPredioSeq) return;
      hacerZoomAGeometria(geom, opts);
    }, 380);
  });
}

const sourceCambiosGeometricos = new ol.source.Vector({
  format: new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  }),
  // Loader propio para poder enviar el token (OpenLayers no usa authHeaders).
  loader: function(extent, resolution, projection, success, failure) {
    const src = this;
    fetch(`${API}/cambios-geometricos`, { headers: authHeaders() })
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(data => {
        const features = src.getFormat().readFeatures(data, { featureProjection: projection });
        src.addFeatures(features);
        if (success) success(features);
      })
      .catch(err => {
        console.warn("No se pudieron cargar cambios geométricos:", err);
        src.removeLoadedExtent(extent);
        if (failure) failure();
      });
  }
});

const capaCambiosGeometricos = new ol.layer.Vector({
  source: sourceCambiosGeometricos,
  style: estiloCambiosGeometricos,
  visible: false
});

const prediosWmsLayer = new ol.layer.Tile({
  visible: true,
  opacity: 0.85,
  source: new ol.source.TileWMS({
    url: "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms",
    params: {
      "LAYERS": "catastro_bc:predios_oficial",
      "TILED": true,
      "VERSION": "1.1.1",
      "FORMAT": "image/png",
      "TRANSPARENT": true
    },
    serverType: "geoserver",
    crossOrigin: "anonymous"
  })
});

const coloniasWmsLayer = new ol.layer.Tile({
  visible: false,
  opacity: 0.55,
  source: new ol.source.TileWMS({
    url: "https://fcnarqnodo.hopto.org/geoserver/geonode/wms",
    params: {
      "LAYERS": "colonias",
      "TILED": true,
      "VERSION": "1.1.1",
      "FORMAT": "image/png",
      "TRANSPARENT": true
    },
    serverType: "geoserver",
    crossOrigin: "anonymous"
  })
});

const codigosWmsLayer = new ol.layer.Tile({
  visible: false,
  opacity: 0.45,
  source: new ol.source.TileWMS({
    url: "https://fcnarqnodo.hopto.org/geoserver/geonode/wms",
    params: {
      "LAYERS": "codigos_postales_bc_utm1",
      "TILED": true,
      "VERSION": "1.1.1",
      "FORMAT": "image/png",
      "TRANSPARENT": true
    },
    serverType: "geoserver",
    crossOrigin: "anonymous"
  })
});

const osmLayer = new ol.layer.Tile({
  visible: false,
  source: new ol.source.OSM()
});

const esriLayer = new ol.layer.Tile({
  visible: false,
  source: new ol.source.XYZ({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attributions: "Tiles © Esri"
  })
});

const googleSatLayer = new ol.layer.Tile({
  visible: false,
  source: new ol.source.XYZ({
    url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    attributions: "Google Satellite"
  })
});

const googleHybridLayer = new ol.layer.Tile({
  visible: true,
  source: new ol.source.XYZ({
    url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    attributions: "Google Hybrid"
  })
});

function controlesMapaSinZoom() {
  try {
    if (ol.control?.defaults?.defaults) {
      return ol.control.defaults.defaults({ zoom: false, rotate: false });
    }
    if (typeof ol.control?.defaults === "function") {
      return ol.control.defaults({ zoom: false, rotate: false });
    }
  } catch (e) {
    console.warn("No se pudieron configurar controles del mapa:", e);
  }
  return undefined;
}

const map = new ol.Map({
  target: "map",
  layers: [
    osmLayer,
    esriLayer,
    googleSatLayer,
    googleHybridLayer,
    codigosWmsLayer,
    coloniasWmsLayer,
    prediosWmsLayer,
    capaCambiosGeometricos,
    vectorLayer,
    seleccionContornoLayer
  ],
  controls: controlesMapaSinZoom(),
  view: new ol.View({
    projection: "EPSG:3857",
    center: ol.proj.fromLonLat([-115.4683, 32.6245]),
    zoom: 12
  })
});

function cambiarCapaBase() {
  const valor = document.getElementById("baseLayerSelect").value;
  osmLayer.setVisible(valor === "osm");
  esriLayer.setVisible(valor === "esri");
  googleSatLayer.setVisible(valor === "googleSat");
  googleHybridLayer.setVisible(valor === "googleHybrid");
}

function togglePrediosWms() {
  prediosWmsLayer.setVisible(document.getElementById("chkPrediosWms").checked);
  refrescarLeyendaDespuesDeCambio();
}

function toggleColoniasWms() {
  coloniasWmsLayer.setVisible(document.getElementById("chkColoniasWms").checked);
  refrescarLeyendaDespuesDeCambio();
}

function toggleCodigosWms() {
  codigosWmsLayer.setVisible(document.getElementById("chkCodigosWms").checked);
  refrescarLeyendaDespuesDeCambio();
}

function toggleCambiosGeom() {
  capaCambiosGeometricos.setVisible(document.getElementById("chkCambiosGeom").checked);
  refrescarLeyendaDespuesDeCambio();
}

function toggleDashboardVisible() {
  const dashboard = document.getElementById("dashboardCartografico");
  const chk = document.getElementById("chkDashboard");
  if (!dashboard || !chk) return;
  dashboard.classList.toggle("oculto", !chk.checked);
}

function toggleDashboard() {
  const dashboard = document.getElementById("dashboardCartografico");
  const contenido = document.getElementById("dashboardContenido");
  const indicador = document.getElementById("dashboardToggleIcon");
  if (!dashboard || !contenido) return;

  const minimizado = dashboard.classList.toggle("minimizado");
  contenido.style.display = minimizado ? "none" : "block";
  if (indicador) indicador.textContent = minimizado ? "▸" : "▾";
}

function inicializarDashboardMinimizado() {
  const dashboard = document.getElementById("dashboardCartografico");
  const contenido = document.getElementById("dashboardContenido");
  const indicador = document.getElementById("dashboardToggleIcon");
  if (!dashboard || !contenido) return;

  dashboard.classList.add("minimizado");
  contenido.style.display = "none";
  if (indicador) indicador.textContent = "▸";
}


/* --- v19: Leyenda dinámica flotante tipo MapStore --- */
function capaVisibleSegura(capa) {
  try {
    return capa && typeof capa.getVisible === "function" ? capa.getVisible() : false;
  } catch (e) {
    return false;
  }
}

function obtenerContenedorLeyendaActivo() {
  return document.getElementById("leyendaContenido");
}

function toggleLeyendaIntegradaPanel() {
  const wrap = document.getElementById("panelLeyendaIntegrada");
  const toggle = document.getElementById("panelLeyendaToggle");
  if (!wrap) return;
  wrap.classList.toggle("colapsada");
  if (toggle) toggle.textContent = wrap.classList.contains("colapsada") ? "▸" : "▾";
}

function aplicarVisibilidadLeyendaIntegrada(visible) {
  const wrap = document.getElementById("panelLeyendaIntegrada");
  const flotante = document.getElementById("leyendaDinamica");
  const btn = document.getElementById("btnMostrarLeyenda");
  const toggle = document.getElementById("panelLeyendaToggle");
  if (wrap) {
    wrap.classList.toggle("oculto", !visible);
    if (visible) {
      wrap.classList.remove("colapsada");
      if (toggle) toggle.textContent = "▾";
    }
  }
  if (flotante) flotante.classList.add("oculto");
  if (btn) btn.classList.add("oculto");
  actualizarLeyendaDinamica();
}

function toggleLeyendaDinamica() {
  const chk = document.getElementById("chkLeyenda");
  const visible = document.getElementById("panelLeyendaIntegrada")?.classList.contains("oculto");
  aplicarVisibilidadLeyendaIntegrada(!!visible);
  if (chk) chk.checked = !!visible;
}

function toggleLeyendaDesdePanel() {
  const chk = document.getElementById("chkLeyenda");
  if (!chk) return;
  aplicarVisibilidadLeyendaIntegrada(chk.checked);
}

function minimizarLeyendaDinamica() {
  toggleLeyendaIntegradaPanel();
}

function toggleTablaResultadosMinimizada() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  if (!tabla || tabla.classList.contains("oculto")) return;
  tabla.classList.toggle("minimizada");
  document.body.classList.toggle("tabla-resultados-minimizada", tabla.classList.contains("minimizada"));
  setTimeout(() => {
    if (typeof map !== "undefined" && map) map.updateSize();
  }, 200);
}

function itemLeyenda(colorClass, titulo, detalle = "") {
  return `
    <div class="leyenda-item">
      <span class="leyenda-simbolo ${colorClass}"></span>
      <div>
        <b>${titulo}</b>
        ${detalle ? `<small>${detalle}</small>` : ""}
      </div>
    </div>
  `;
}

function grupoLeyenda(titulo, contenido) {
  if (!contenido || contenido.trim() === "") return "";
  return `
    <div class="leyenda-grupo">
      <div class="leyenda-grupo-title">${titulo}</div>
      ${contenido}
    </div>
  `;
}

function actualizarLeyendaDinamica() {
  const cont = obtenerContenedorLeyendaActivo();
  if (!cont) return;

  let html = "";

  const fiscalActivo = document.getElementById("chkAdeudosFiscal")?.checked || vectorSource.getFeatures().some(f => f.get("info_fiscal") === true);

  if (fiscalActivo) {
    html += grupoLeyenda("Fiscal", `
      ${itemLeyenda("simbolo-verde", "Sin adeudo", "Relleno verde en consulta de manzana")}
      ${itemLeyenda("simbolo-rojo", "Con adeudo", "Relleno rojo en consulta de manzana")}
      ${itemLeyenda("simbolo-seleccion", "Predio seleccionado", "Contorno azul continuo sobre todas las capas")}
    `);
  } else if (capaVisibleSegura(prediosWmsLayer) || vectorSource.getFeatures().length || (resultadosSource && resultadosSource.getFeatures().length)) {
    html += grupoLeyenda("Consulta", `
      ${itemLeyenda("simbolo-seleccion", "Predio seleccionado", "Contorno azul #0000ff")}
    `);
  }

  if (capaVisibleSegura(prediosWmsLayer)) {
    html += grupoLeyenda("Predios", `
      ${itemLeyenda("simbolo-predios", "Predios oficiales", "Capa WMS institucional")}
    `);
  }

  if (capaVisibleSegura(coloniasWmsLayer)) {
    html += grupoLeyenda("Colonias", `
      ${itemLeyenda("simbolo-colonias", "Colonias", "Límite de colonia WMS")}
    `);
  }

  if (capaVisibleSegura(codigosWmsLayer)) {
    html += grupoLeyenda("Códigos postales", `
      ${itemLeyenda("simbolo-codigos", "Códigos postales", "Límite CP WMS")}
    `);
  }

  if (capaVisibleSegura(capaCambiosGeometricos)) {
    html += grupoLeyenda("Auditoría geométrica", `
      ${itemLeyenda("simbolo-aud-alta", "Prioridad alta", "Cambio crítico / revisar")}
      ${itemLeyenda("simbolo-aud-media", "Prioridad media", "Cambio geométrico")}
      ${itemLeyenda("simbolo-aud-baja", "Prioridad baja", "Observación menor")}
    `);
  }

  if (!html.trim()) {
    html = `
      <div class="leyenda-vacia">
        Activa una capa para ver su simbología.
      </div>
    `;
  }

  cont.innerHTML = html;
}

function refrescarLeyendaDespuesDeCambio() {
  setTimeout(actualizarLeyendaDinamica, 80);
}

async function cargarDashboardCartografico() {
  try {
    const r = await fetch(`${API}/dashboard-cartografico?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });

    if (!r.ok) {
      console.error("Dashboard cartográfico HTTP:", r.status);
      return;
    }

    const d = await r.json();

    const setTxt = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.innerText = valor;
    };

    setTxt("dashTotal", Number(d.total_predios || 0).toLocaleString("es-MX"));
    setTxt("dashDibujados", Number(d.dibujados || 0).toLocaleString("es-MX"));
    setTxt("dashSinGeom", Number(d.sin_geometria || 0).toLocaleString("es-MX"));
    setTxt("dashCobertura", `${d.cobertura || 0}%`);
    setTxt("dashCambios", Number(d.cambios_geometricos || 0).toLocaleString("es-MX"));
    setTxt("headerDashTotal", Number(d.total_predios || 0).toLocaleString("es-MX"));
    setTxt("headerDashCobertura", `${d.cobertura || 0}%`);
    setTxt("headerDashCambios", Number(d.cambios_geometricos || 0).toLocaleString("es-MX"));

  } catch (e) {
    console.error("No se pudo cargar dashboard cartográfico", e);
  }
}


async function cargarDashboardFiscal() {
  try {
    const r = await fetch(`${API}/dashboard-fiscal?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });

    if (!r.ok) {
      console.warn("Dashboard fiscal HTTP:", r.status);
      return;
    }

    const d = await r.json();

    const setTxt = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.innerText = valor;
    };

    setTxt("dashConAdeudo", Number(d.con_adeudo || 0).toLocaleString("es-MX"));
    setTxt("dashSinAdeudo", Number(d.sin_adeudo || 0).toLocaleString("es-MX"));
    setTxt("dashAdeudoTotal", formatoMoneda(d.adeudo_total || 0));
    setTxt("dashValorTotal", formatoMoneda(d.valor_catastral_total || 0));
    setTxt("dashConDocs", Number((d.expediente && d.expediente.con_documentos) || 0).toLocaleString("es-MX"));
    setTxt("dashSinDocs", Number((d.expediente && d.expediente.sin_documentos) || 0).toLocaleString("es-MX"));

  } catch (e) {
    console.warn("No se pudo cargar dashboard fiscal", e);
  }
}

function formatoMoneda(valor) {
  if (valor === null || valor === undefined || valor === "" || isNaN(Number(valor))) {
    return "Sin dato";
  }
  return Number(valor).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN"
  });
}

function formatoNumero(valor, decimales = 2) {
  if (valor === null || valor === undefined || valor === "" || isNaN(Number(valor))) {
    return "Sin dato";
  }
  return Number(valor).toLocaleString("es-MX", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  });
}

function val(v) {
  return (v === null || v === undefined || v === "") ? "Sin dato" : v;
}

function indicador(valor) {
  return valor
    ? `<span class="badge-ok">SI</span>`
    : `<span class="badge-warn">NO</span>`;
}

function porcentajeExpediente(p) {
  const campos = [
    p.tiene_documentos,
    p.tiene_cartografia,
    p.tiene_construccion,
    p.tiene_avaluo,
    p.tiene_inspeccion,
    p.tiene_rppc,
    p.tiene_fotografia,
    p.tiene_cedula,
    p.tiene_historial
  ];
  const completos = campos.filter(Boolean).length;
  return Math.round((completos / campos.length) * 100);
}

function claseAvanceExpediente(porcentaje) {
  if (porcentaje >= 80) return "badge-ok";
  if (porcentaje >= 40) return "badge-warn";
  return "badge-danger";
}

function textoAvanceExpediente(porcentaje) {
  if (porcentaje >= 80) return "COMPLETO";
  if (porcentaje >= 40) return "EN PROCESO";
  return "CRÍTICO";
}

function toggleSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === "none" ? "block" : "none";
}

function toggleHistorial() {
  toggleSection("timeline-expediente");
}


function abrirFichaFlotante() {
  const ficha = document.getElementById("fichaFlotante");
  if (!ficha) return;
  ficha.classList.remove("oculto");
  ficha.classList.remove("minimizada");
  ficha.style.left = "";
  ficha.style.top = "";
  ficha.style.right = "";
  ficha.style.bottom = "";
  actualizarLayoutPrincipal();
}

function cerrarFichaFlotante() {
  const ficha = document.getElementById("fichaFlotante");
  if (!ficha) return;
  ficha.classList.add("oculto");
  ficha.classList.remove("minimizada");
  ficha.style.left = "";
  ficha.style.top = "";
  ficha.style.right = "";
  ficha.style.bottom = "";
  actualizarBreadcrumbPredio(null);
  actualizarLayoutPrincipal();
}

function minimizarFichaFlotante() {
  const ficha = document.getElementById("fichaFlotante");
  if (!ficha) return;
  ficha.classList.toggle("minimizada");
  if (ficha.classList.contains("minimizada")) {
    ficha.style.bottom = "auto";
    ficha.style.height = "auto";
  } else {
    ficha.style.left = "";
    ficha.style.top = "";
    ficha.style.right = "";
    ficha.style.bottom = "";
    ficha.style.height = "";
  }
  setTimeout(() => {
    if (typeof map !== "undefined" && map) map.updateSize();
  }, 150);
}

function mostrarFichaTab(tabId, boton) {
  document.querySelectorAll(".ficha-tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".ficha-tab-btn").forEach(b => b.classList.remove("active"));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add("active");
  if (boton) boton.classList.add("active");
}

function inicializarFichaDraggable() {
  const ficha = document.getElementById("fichaFlotante");
  const header = document.getElementById("fichaFlotanteHeader");
  if (!ficha || !header || ficha.dataset.dragReady === "1") return;
  ficha.dataset.dragReady = "1";

  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  header.addEventListener("mousedown", function(e) {
    if (e.target.tagName === "BUTTON") return;
    dragging = true;
    const rect = ficha.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    const maxX = window.innerWidth - ficha.offsetWidth - 8;
    const maxY = window.innerHeight - 45;
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    x = Math.max(8, Math.min(x, maxX));
    y = Math.max(8, Math.min(y, maxY));
    ficha.style.left = x + "px";
    ficha.style.top = y + "px";
    ficha.style.right = "auto";
  });

  document.addEventListener("mouseup", function() {
    dragging = false;
    document.body.style.userSelect = "";
  });
}

function htmlAdministrarCopropietariosFicha(clave, styleExtra = "margin-top:8px;") {
  const c = String(clave || "").replace(/'/g, "\\'");
  return `
    <button type="button" class="btn-expediente-externo perm-editar-catastro" style="${styleExtra}" onclick="abrirModalCopropietarios('${c}')">
      👥 Administrar propietarios / copropietarios
    </button>
    <div class="solo-lectura-catastro" style="${styleExtra}font-size:12px;color:#64748b;padding:6px 8px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;">
      Solo consulta. Para modificar titularidad utilice la pestaña Movimientos o solicite apoyo al área de catastro.
    </div>
  `;
}

function pintarFichaFlotante(p) {
  const contenedor = document.getElementById("fichaFlotanteBody");
  const claveHeader = document.getElementById("fichaFlotanteClave");
  if (!contenedor) return;

  const fichaBox = document.getElementById("fichaFlotante");
  if (fichaBox) {
    fichaBox.classList.remove("estado-adeudo", "estado-sin-adeudo");
    fichaBox.classList.add(Number(p.adeudo_total || 0) > 0 ? "estado-adeudo" : "estado-sin-adeudo");
  }

  if (claveHeader) claveHeader.innerText = val(p.clave_catastral);
  actualizarBreadcrumbPredio(p.clave_catastral, p);

  const adeudoTotal = Number(p.adeudo_total || 0);
  const adeudoBadge = adeudoTotal > 0
    ? `<span class="badge-warn">CON ADEUDO</span>`
    : `<span class="badge-ok">SIN ADEUDO</span>`;

  const avance = porcentajeExpediente(p);

  contenedor.innerHTML = `
    <div class="ficha-status-box">
      <div class="big">${val(p.clave_catastral)}</div>
      <div>${val(p.nombre_completo || p.propietario)}</div>
      <div style="margin-top:5px;">
        ${p.dibujado ? '<span class="badge-ok">DIBUJADO</span>' : '<span class="badge-warn">SIN GEOMETRÍA DIRECTA</span>'}
        ${Number(p.adeudo_total || 0) > 0 ? '<span class="badge-fiscal-adeudo">CON ADEUDO</span>' : '<span class="badge-fiscal-ok">SIN ADEUDO</span>'}
      </div>
    </div>

    <div class="ficha-tabs">
      <button type="button" class="ficha-tab-btn active" onclick="mostrarFichaTab('fichaTabIdentificacion', this)">Identificación</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabValores', this)">Valores</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabExpediente', this)">Expediente</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabUbicacion', this)">Ubicación</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabAdeudos', this)">Adeudos</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabDocumentos', this)">Docs</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabTitularidad', this); cargarTitularidadFicha('${p.clave_catastral || ''}')">Titularidad</button>
    </div>

    <div id="fichaTabIdentificacion" class="ficha-tab-panel active">
      <div class="ficha-mini-row"><div class="label">Clave</div><div class="value">${val(p.clave_catastral)}</div></div>
      <div class="ficha-mini-row"><div class="label">Nombre / Razón social</div><div class="value">${val(p.nombre_completo || p.propietario)}</div></div>
      <div class="ficha-mini-row"><div class="label">Tipo persona</div><div class="value">${val(p.tipo_persona)}</div></div>
      <div class="ficha-mini-row"><div class="label">RFC</div><div class="value">${val(p.rfc)}</div></div>
      <div class="ficha-mini-row"><div class="label">Titularidad</div><div class="value">${val(p.tipo_titularidad)}</div></div>
      <div class="ficha-mini-row"><div class="label">% Propiedad</div><div class="value">${val(p.porcentaje_propiedad)}</div></div>
      ${htmlAdministrarCopropietariosFicha(p.clave_catastral, "margin-top:10px;width:100%;")}
    </div>

    <div id="fichaTabTitularidad" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Nombre visible</div><div class="value">${val(p.nombre_completo || p.propietario)}</div></div>
      <div class="ficha-mini-row"><div class="label">Titulares</div><div class="value">${val(p.total_titulares || 1)}</div></div>
      <div class="ficha-mini-row"><div class="label">Suma propiedad</div><div class="value">${val(p.suma_porcentaje || p.porcentaje_propiedad || 100)}%</div></div>
      <div id="fichaTitularidadDetalle" style="margin-top:8px;">Cargando titularidad...</div>
      ${htmlAdministrarCopropietariosFicha(p.clave_catastral)}
    </div>

    <div id="fichaTabUbicacion" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Delegación</div><div class="value">${val(p.delegacion)}</div></div>
      <div class="ficha-mini-row"><div class="label">Colonia</div><div class="value">${val(p.colonia)}</div></div>
      <div class="ficha-mini-row"><div class="label">Calle</div><div class="value">${val(p.calle)}</div></div>
      <div class="ficha-mini-row"><div class="label">Número oficial</div><div class="value">${val(p.numof)}</div></div>
      <div class="ficha-mini-row"><div class="label">Interior</div><div class="value">${val(p.numint)}</div></div>
      <div class="ficha-mini-row"><div class="label">CP</div><div class="value">${val(p.cp)}</div></div>
    </div>

    <div id="fichaTabValores" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Zona homogénea</div><div class="value">${val(p.zona_homogenea || p.zonah)}</div></div>
      <div class="ficha-mini-row"><div class="label">Uso predial</div><div class="value">${val(p.descripcion_uso)}</div></div>
      <div class="ficha-mini-row"><div class="label">ID tasa</div><div class="value">${val(p.id_tasa)}</div></div>
      <div class="ficha-mini-row"><div class="label">Tasa</div><div class="value">${val(p.porcentaje_tasa)}%</div></div>
      <div class="ficha-mini-row"><div class="label">Sup. documental</div><div class="value">${formatoNumero(p.sup_documental)} m²</div></div>
      <div class="ficha-mini-row"><div class="label">Sup. física</div><div class="value">${formatoNumero(p.sup_fisica)} m²</div></div>
      <div class="ficha-mini-row"><div class="label">Sup. construcción</div><div class="value">${formatoNumero(p.sup_const)} m²</div></div>
      <div class="ficha-mini-row"><div class="label">Valor 2026</div><div class="value">${formatoMoneda(p.valor2026)}</div></div>
    </div>

    <div id="fichaTabAdeudos" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Adeudo 2026</div><div class="value">${formatoMoneda(p.adeudo_2026)}</div></div>
      <div class="ficha-mini-row"><div class="label">Adeudo total</div><div class="value">${formatoMoneda(p.adeudo_total)}</div></div>
      <div class="ficha-mini-row"><div class="label">Estado</div><div class="value">${adeudoBadge}</div></div>
      <div class="ficha-mini-row"><div class="label">Dibujado</div><div class="value">${p.dibujado ? "Sí" : "No / padrón sin geometría directa"}</div></div>
      <div class="ficha-mini-row"><div class="label">Condominio</div><div class="value">${val(p.condominio)}</div></div>
    </div>

    <div id="fichaTabExpediente" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Avance</div><div class="value"><span class="${claseAvanceExpediente(avance)}">${avance}% - ${textoAvanceExpediente(avance)}</span></div></div>
      <div class="ficha-mini-row"><div class="label">Documentos</div><div class="value">${indicador(p.tiene_documentos)}</div></div>
      <div class="ficha-mini-row"><div class="label">Cartografía</div><div class="value">${indicador(p.tiene_cartografia)}</div></div>
      <div class="ficha-mini-row"><div class="label">Construcción</div><div class="value">${indicador(p.tiene_construccion)}</div></div>
      <div class="ficha-mini-row"><div class="label">Avalúo</div><div class="value">${indicador(p.tiene_avaluo)}</div></div>
      <div class="ficha-mini-row"><div class="label">Inspección</div><div class="value">${indicador(p.tiene_inspeccion)}</div></div>
      <div class="ficha-mini-row"><div class="label">RPPC</div><div class="value">${indicador(p.tiene_rppc)}</div></div>
      <div class="ficha-mini-row"><div class="label">Fotografía</div><div class="value">${indicador(p.tiene_fotografia)}</div></div>
      <div class="ficha-mini-row"><div class="label">Cédula</div><div class="value">${indicador(p.tiene_cedula)}</div></div>
    </div>

    <div id="fichaTabDocumentos" class="ficha-tab-panel">
      <a class="btn-expediente-externo" href="${urlExpedienteExterno(p.clave_catastral)}" target="_blank" rel="noopener noreferrer">
        📂 Abrir expediente documental externo
      </a>
      <div class="ficha-mini-row"><div class="label">Repositorio</div><div class="value">Mexicali / Documentación</div></div>
      <div class="ficha-mini-row"><div class="label">Clave enviada</div><div class="value">${val(p.clave_catastral)}</div></div>
      <div class="ficha-mini-row"><div class="label">Historial</div><div class="value">Disponible en ficha institucional</div></div>
    </div>
  `;

  abrirFichaFlotante();
  aplicarPermisosVisuales(obtenerRolSesion());
}

function pintarFicha(p) {
  pintarFichaFlotante(p);
  const adeudoTotal = Number(p.adeudo_total || 0);
  const adeudoBadge = adeudoTotal > 0
    ? `<span class="badge-warn">CON ADEUDO</span>`
    : `<span class="badge-ok">SIN ADEUDO</span>`;

  document.getElementById("ficha").innerHTML = `
    <div class="ficha-title" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Ficha predial institucional</span>
      <span style="font-style:italic; font-size:14px;">${val(p.clave_catastral)}</span>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-identificacion')" style="cursor:pointer;">Identificación ▼</div>
      <div id="sec-identificacion" style="display:none;">
        <div class="ficha-row"><b>Clave:</b><span>${val(p.clave_catastral)}</span></div>
        <div class="ficha-row"><b>Propietario:</b><span>${val(p.nombre_completo || p.propietario)}</span></div>
        <div class="ficha-row"><b>Tipo persona:</b><span>${val(p.tipo_persona)}</span></div>
        <div class="ficha-row"><b>RFC:</b><span>${val(p.rfc)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-ubicacion')" style="cursor:pointer;">Ubicación ▼</div>
      <div id="sec-ubicacion" style="display:none;">
        <div class="ficha-row"><b>Delegación:</b><span>${val(p.delegacion)}</span></div>
        <div class="ficha-row"><b>Colonia:</b><span>${val(p.colonia)}</span></div>
        <div class="ficha-row"><b>Calle:</b><span>${val(p.calle)}</span></div>
        <div class="ficha-row"><b>Número oficial:</b><span>${val(p.numof)}</span></div>
        <div class="ficha-row"><b>Número interior:</b><span>${val(p.numint)}</span></div>
        <div class="ficha-row"><b>Letra:</b><span>${val(p.letra)}</span></div>
        <div class="ficha-row"><b>CP:</b><span>${val(p.cp)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-catastral')" style="cursor:pointer;">Información catastral ▼</div>
      <div id="sec-catastral" style="display:none;">
        <div class="ficha-row"><b>Zona homogénea:</b><span>${val(p.zona_homogenea || p.zonah)}</span></div>
        <div class="ficha-row"><b>Uso predial:</b><span>${val(p.descripcion_uso)}</span></div>
        <div class="ficha-row"><b>ID tasa:</b><span>${val(p.id_tasa)}</span></div>
        <div class="ficha-row"><b>Tasa:</b><span>${val(p.porcentaje_tasa)}%</span></div>
        <div class="ficha-row"><b>Condominio:</b><span>${val(p.condominio)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-superficies')" style="cursor:pointer;">Superficies y valores ▼</div>
      <div id="sec-superficies" style="display:none;">
        <div class="ficha-row"><b>Sup. documental:</b><span>${formatoNumero(p.sup_documental)} m²</span></div>
        <div class="ficha-row"><b>Sup. física:</b><span>${formatoNumero(p.sup_fisica)} m²</span></div>
        <div class="ficha-row"><b>Sup. construcción:</b><span>${formatoNumero(p.sup_const)} m²</span></div>
        <div class="ficha-row"><b>Valor 2026:</b><span>${formatoMoneda(p.valor2026)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-adeudos')" style="cursor:pointer;">Adeudos y cartografía ▼</div>
      <div id="sec-adeudos" style="display:none;">
        <div class="ficha-row"><b>Adeudo 2026:</b><span>${formatoMoneda(p.adeudo_2026)}</span></div>
        <div class="ficha-row"><b>Adeudo total:</b><span>${formatoMoneda(p.adeudo_total)}</span></div>
        <div class="ficha-row"><b>Estado:</b><span>${adeudoBadge}</span></div>
        <div class="ficha-row"><b>Dibujado:</b><span>${p.dibujado ? "Sí" : "No / padrón sin geometría directa"}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-expediente')" style="cursor:pointer;">Expediente integral ▼</div>
      <div id="sec-expediente" style="display:none;">
        <div class="ficha-row"><b>Avance expediente:</b><span><span class="${claseAvanceExpediente(porcentajeExpediente(p))}">${porcentajeExpediente(p)}% - ${textoAvanceExpediente(porcentajeExpediente(p))}</span></span></div>
        <div class="ficha-row"><b>Documentos:</b><span>${indicador(p.tiene_documentos)}</span></div>
        <div class="ficha-row"><b>Cartografía:</b><span>${indicador(p.tiene_cartografia)}</span></div>
        <div class="ficha-row"><b>Construcción:</b><span>${indicador(p.tiene_construccion)}</span></div>
        <div class="ficha-row"><b>Avalúo:</b><span>${indicador(p.tiene_avaluo)}</span></div>
        <div class="ficha-row"><b>Inspección:</b><span>${indicador(p.tiene_inspeccion)}</span></div>
        <div class="ficha-row"><b>RPPC:</b><span>${indicador(p.tiene_rppc)}</span></div>
        <div class="ficha-row"><b>Fotografía:</b><span>${indicador(p.tiene_fotografia)}</span></div>
        <div class="ficha-row"><b>Cédula:</b><span>${indicador(p.tiene_cedula)}</span></div>
        <div class="ficha-row"><b>Historial:</b><span>${indicador(p.tiene_historial)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-titularidad'); cargarTitularidadFicha('${p.clave_catastral || ''}')" style="cursor:pointer;">Titularidad / copropietarios ▼</div>
      <div id="sec-titularidad" style="display:none; padding-top: 5px;">
        <div class="ficha-row"><b>Nombre visible:</b><span>${val(p.nombre_completo || p.propietario)}</span></div>
        <div class="ficha-row"><b>Total titulares:</b><span>${val(p.total_titulares || 1)}</span></div>
        <div class="ficha-row"><b>Suma propiedad:</b><span>${val(p.suma_porcentaje || p.porcentaje_propiedad || 100)}%</span></div>
        <div id="fichaTitularidadDetallePanel">Cargando titularidad...</div>
        ${htmlAdministrarCopropietariosFicha(p.clave_catastral)}
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-documentos')" style="cursor:pointer;">Documentos del expediente ▼</div>
      <div id="sec-documentos" style="display:none; padding-top: 5px;">
        <a class="btn-expediente-externo" href="${urlExpedienteExterno(p.clave_catastral)}" target="_blank" rel="noopener noreferrer">
          📂 Abrir expediente documental externo
        </a>
        <div>Cargando documentos locales...</div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleHistorial()" style="cursor:pointer;">Historial institucional ▼</div>
      <div id="timeline-expediente" style="display:none; padding-top: 5px;">Cargando historial...</div>
    </div>
  `;

  cargarHistorial(p.clave_catastral);
  cargarDocumentos(p.clave_catastral);
  aplicarPermisosVisuales(obtenerRolSesion());
}

async function cargarHistorial(clave) {
  const contenedor = document.getElementById("timeline-expediente");
  if (!contenedor || !clave) return;

  try {
    const r = await fetch(`${API}/expediente/${clave}/historial`, { headers: authHeaders() });
    if (!r.ok) {
      contenedor.innerHTML = "No fue posible cargar historial.";
      return;
    }

    const data = await r.json();
    const historial = data.historial || [];

    if (historial.length === 0) {
      contenedor.innerHTML = "Sin movimientos registrados.";
      return;
    }

    let html = "";
    historial.forEach(item => {
      const fecha = item.fecha_modificacion
        ? new Date(item.fecha_modificacion).toLocaleString("es-MX")
        : "Sin fecha";

      html += `
        <div class="timeline-item">
          <div class="timeline-fecha">${fecha}</div>
          <div class="timeline-mov">${item.tipo_movimiento || item.accion || "MOVIMIENTO"}</div>
          <div class="timeline-user">Usuario: ${item.usuario_modifico || "Sin usuario"}</div>
          <div class="timeline-obs">${item.observaciones || "Sin observaciones"}</div>
        </div>
      `;
    });
    contenedor.innerHTML = html;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = "No fue posible cargar historial.";
  }
}

async function cargarDocumentos(clave) {
  const contenedor = document.getElementById("sec-documentos");
  if (!contenedor || !clave) return;

  try {
    const r = await fetch(`${API}/expediente/${clave}/documentos`, { headers: authHeaders() });
    if (!r.ok) {
      contenedor.innerHTML = "No fue posible cargar documentos.";
      return;
    }

    const data = await r.json();
    const documentos = data.documentos || [];

    if (documentos.length === 0) {
      contenedor.innerHTML += "<div>Sin documentos locales registrados.</div>";
      return;
    }

    let html = "";
    documentos.forEach(doc => {
      const urlDoc = `${API}/documentos/${clave}/${doc.nombre_archivo}`;
      html += `
        <div class="timeline-item">
          <div class="timeline-fecha">${doc.tipo_documento || "DOCUMENTO"}</div>
          <div class="timeline-user">${doc.nombre_archivo || ""}</div>
          <div class="timeline-obs">${doc.descripcion || "Sin descripción"}</div>
          <div class="timeline-obs">Año: ${doc.anio || "Sin dato"}</div>
          <button style="margin-top:5px; padding:4px;" onclick="window.open('${urlDoc}', '_blank')">Abrir documento</button>
        </div>
      `;
    });
    contenedor.innerHTML = html;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = "No fue posible cargar documentos.";
  }
}

function pintarMensajeNoDibujado(p) {
  vectorSource.clear();
  limpiarContornoSeleccion();
  document.getElementById("ficha").innerHTML = `
    <div style="background:#fff3cd; border:2px solid #ff9800; color:#7a4a00; padding:10px; border-radius:8px; margin-bottom:10px; font-weight:bold;">
      ⚠ PREDIO NO DIBUJADO EN CARTOGRAFÍA<br>
      La clave existe en el padrón institucional, pero aún no tiene geometría ligada.
    </div>

    <div class="ficha-title">Ficha predial institucional</div>
    <div class="ficha-row"><b>Clave:</b><span>${val(p.clave_catastral)}</span></div>
    <div class="ficha-row"><b>Propietario:</b><span>${val(p.nombre_completo || p.propietario)}</span></div>
    <div class="ficha-row"><b>Delegación:</b><span>${val(p.delegacion)}</span></div>
    <div class="ficha-row"><b>Colonia:</b><span>${val(p.colonia)}</span></div>
    <div class="ficha-row"><b>Calle:</b><span>${val(p.calle)}</span></div>
    <div class="ficha-row"><b>Número:</b><span>${val(p.numof)}</span></div>
    <div class="ficha-row"><b>Zona homogénea:</b><span>${val(p.zona_homogenea || p.zonah)}</span></div>
    <div class="ficha-row"><b>Uso:</b><span>${val(p.descripcion_uso)}</span></div>
    <div class="ficha-row"><b>Sup. documental:</b><span>${formatoNumero(p.sup_documental)} m²</span></div>
    <div class="ficha-row"><b>Valor 2026:</b><span>${formatoMoneda(p.valor2026)}</span></div>
    <div class="ficha-section"><div class="ficha-row"><b>Estatus cartográfico:</b><span class="badge-warn">NO DIBUJADO</span></div></div>
  `;
}


function aplicarFiscalAFeature(feature, ficha) {
  if (!feature || !ficha) return;

  feature.set("adeudo_total", Number(ficha.adeudo_total || 0));
  feature.set("adeudo_2026", Number(ficha.adeudo_2026 || 0));
  feature.set("info_fiscal", true);
  feature.set("seleccionado", true);
}

function aplicarFiscalFeatureCollection(features, fichaSeleccionada = null) {
  features.forEach(f => {
    f.set("info_fiscal", false);
    f.set("seleccionado", false);

    if (
      fichaSeleccionada &&
      String(f.get("clave_catastral")) === String(fichaSeleccionada.clave_catastral)
    ) {
      aplicarFiscalAFeature(f, fichaSeleccionada);
    }
  });
}

function toggleAdeudosFiscal() {
  const chk = document.getElementById("chkAdeudosFiscal");
  if (!chk) return;

  vectorSource.getFeatures().forEach(f => {
    if (!chk.checked) {
      f.set("info_fiscal", false);
    } else if (f.get("adeudo_total") !== undefined) {
      f.set("info_fiscal", true);
    }
    f.changed();
  });
}

function urlExpedienteExterno(clave) {
  return `https://www.mexicali.gob.mx/webpub/consultacatastro/Documentacion.aspx?${encodeURIComponent(clave || "")}`;
}

function abrirExpedienteExterno(clave) {
  if (!clave) return;
  window.open(urlExpedienteExterno(clave), "_blank", "noopener,noreferrer");
}

function pintarGeoJSON(featureGeojson, hacerZoom = true) {
  vectorSource.clear();
  if (!featureGeojson) {
    limpiarContornoSeleccion();
    return;
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });

  const feature = format.readFeature(featureGeojson);
  const clave = featureGeojson.properties?.clave_catastral || feature.get("clave_catastral");
  if (clave) feature.set("clave_catastral", clave);
  feature.set("seleccionado", true);
  if (featureGeojson.properties) {
    aplicarFiscalAFeature(feature, featureGeojson.properties);
  }
  vectorSource.addFeature(feature);
  aplicarSeleccionVisualPredio(clave, feature.getGeometry());

  if (hacerZoom) {
    hacerZoomAPredio(clave, feature.getGeometry());
  }
}

async function obtenerFichaPorClave(clave) {
  const resExp = await fetch(`${API}/expediente/${clave}`, { headers: authHeaders() });
  if (!resExp.ok) return null;
  const expedienteGeojson = await resExp.json();
  return expedienteGeojson.properties || null;
}

async function cargarDesdeBusqueda(registro) {
  const resFicha = await fetch(`${API}/expediente/${registro.clave_catastral}`, { headers: authHeaders() });

  if (!resFicha.ok) {
    if (registro.dibujado) {
      document.getElementById("ficha").innerHTML = `
        <div class="ficha-title">Ficha predial institucional</div>
        <div class="ficha-row"><b>Clave:</b><span>${val(registro.clave_catastral)}</span></div>
        <div class="ficha-row"><b>Propietario:</b><span>${val(registro.nombre_completo || registro.propietario)}</span></div>
        <div class="ficha-row"><b>Estatus:</b><span class="badge-ok">DIBUJADO EN CARTOGRAFÍA</span></div>
        <div class="ficha-section">El predio está dibujado, pero no se pudo cargar la ficha integral.</div>
      `;
      return;
    }

    pintarMensajeNoDibujado(registro);
    return;
  }

  const fichaGeojson = await resFicha.json();
  const ficha = fichaGeojson.properties || registro;

  if (fichaGeojson.geometry) {
    await seleccionarPorClave(ficha.clave_catastral || registro.clave_catastral);
    return;
  }

  const claveNorm = String(ficha.clave_catastral || registro.clave_catastral || "").trim().toUpperCase();
  claveSeleccionadaActual = claveNorm;
  document.getElementById("claveInput").value = claveNorm;
  sincronizarClavesMovimientoConPredioActivo();

  if (ficha.dibujado || registro.dibujado) {
    pintarFicha(ficha);
    return;
  }

  vectorSource.clear();
  pintarMensajeNoDibujado(ficha);
}


function mostrarTab(tabId, boton) {
  document.querySelectorAll(".tab-content").forEach(t => {
    t.classList.remove("active");
    t.style.display = "none";
  });

  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));

  const tab = document.getElementById(tabId);
  if (tab) {
    tab.classList.add("active");
    tab.style.display = tabId === "tabConsulta" ? "flex" : "block";
    tab.scrollTop = 0;
  }

  if (boton) boton.classList.add("active");
  actualizarBreadcrumbModulo(tabId);

  if (tabId === "tabAdministracion") {
    setTimeout(() => {
      if (typeof cargarUsuariosAdmin === "function") cargarUsuariosAdmin();
      if (typeof cargarAuditoriaAdmin === "function") cargarAuditoriaAdmin();
    }, 150);
  }

  if (tabId === "tabMovimientos" && typeof sincronizarClavesMovimientoConPredioActivo === "function") {
    sincronizarClavesMovimientoConPredioActivo();
  }

  if (tabId === "tabAnalisisZonas" && typeof abrirModuloAnalisisZonas === "function") {
    setTimeout(function() { abrirModuloAnalisisZonas(); }, 120);
  }

  if (tabId === "tabCondominios" && typeof abrirModuloAnalisisCondominios === "function") {
    setTimeout(function() {
      cargarResumenCondominiosTab();
      abrirModuloAnalisisCondominios();
    }, 120);
  }

  setTimeout(() => {
    if (typeof map !== "undefined" && map) map.updateSize();
  }, 150);
}


/* --- v11: zoom automático a uno o varios resultados --- */
let resultadosLayer = null;
let resultadosSource = null;

function inicializarLayerResultadosBusqueda() {
  if (resultadosLayer) return;

  resultadosSource = new ol.source.Vector();

  resultadosLayer = new ol.layer.Vector({
    source: resultadosSource,
    zIndex: 85,
    style: estiloResultadoBusqueda
  });

  map.addLayer(resultadosLayer);
}

async function obtenerGeojsonPorClaveParaZoom(clave, dibujado) {
  if (!clave) return null;
  if (dibujado === false || dibujado === 0 || String(dibujado).toLowerCase() === "false") {
    return null;
  }

  try {
    const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });

    if (r.ok) {
      const data = await r.json();
      if (data && data.geometry) return data;
      if (data && data.geojson && data.geojson.geometry) return data.geojson;
      if (data && data.feature && data.feature.geometry) return data.feature;
      return null;
    }
  } catch (e) {
    /* sin geometría disponible */
  }

  return null;
}

function esPredioDibujadoBusqueda(p) {
  return p?.dibujado === true || p?.dibujado === 1 || String(p?.dibujado || "").toLowerCase() === "true";
}

async function zoomAResultadosBusqueda(resultados) {
  if (!Array.isArray(resultados) || resultados.length === 0) return;

  inicializarLayerResultadosBusqueda();
  resultadosSource.clear();

  const format = new ol.format.GeoJSON();

  const dibujados = resultados.filter(esPredioDibujadoBusqueda);
  const limite = Math.min(dibujados.length || resultados.length, 50);
  const candidatos = (dibujados.length ? dibujados : resultados).slice(0, limite);

  const promesas = candidatos.map(async (p, idx) => {
    const clave = p.clave_catastral;
    const geo = await obtenerGeojsonPorClaveParaZoom(clave, p.dibujado);
    if (!geo || !geo.geometry) return null;

    const feature = format.readFeature(geo, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });

    feature.set("clave_catastral", clave);
    feature.set("adeudo_total", Number(p.adeudo_total || geo.properties?.adeudo_total || 0));
    feature.set("info_fiscal", true);
    feature.set("seleccionado", false);
    feature.set("principal", idx === 0 && resultados.length === 1);

    resultadosSource.addFeature(feature);
    return feature;
  });

  await Promise.all(promesas);

  const features = resultadosSource.getFeatures();
  if (features.length === 0) return;

  // Si es un solo resultado, también lo manda al flujo normal de selección/ficha.
  if (resultados.length === 1 && resultados[0].clave_catastral) {
    await cargarDesdeBusqueda(resultados[0]);
    return;
  }

  const extent = resultadosSource.getExtent();

  if (extent && !ol.extent.isEmpty(extent)) {
    const w = ol.extent.getWidth(extent);
    const h = ol.extent.getHeight(extent);
    const buf = Math.max(w * 0.14, h * 0.14, 48);
    const extentManzana = ol.extent.buffer(extent, buf);

    marcarIgnorarClickMapa(900);
    map.getView().fit(extentManzana, {
      padding: obtenerPaddingMapaFit(),
      duration: 650,
      maxZoom: 16.5
    });
  }

  const chkFiscal = document.getElementById("chkAdeudosFiscal");
  if (chkFiscal && resultados.length > 1) {
    chkFiscal.checked = true;
    toggleAdeudosFiscal();
  }
  aplicarVisibilidadLeyendaIntegrada(document.getElementById("chkLeyenda")?.checked !== false);
  refrescarLeyendaDespuesDeCambio();
}

function limpiarResultadosZoom() {
  if (resultadosSource) resultadosSource.clear();
  limpiarContornoSeleccion();
}

/* --- v7 OK DataGrid institucional --- */
const gridEstado = {
  todos: [],
  filtrados: [],
  pagina: 1,
  pageSize: 25,
  sortCampo: "clave_catastral",
  sortDir: "asc",
  totalReal: 0
};

const gridColumnasResultados = [
  { campo: "clave_catastral", titulo: "Clave" },
  { campo: "nombre_completo", titulo: "Nombre / Razón social" },
  { campo: "colonia", titulo: "Colonia" },
  { campo: "calle", titulo: "Calle" },
  { campo: "numof", titulo: "# Oficial" },
  { campo: "zona_homogenea", titulo: "Zona H." },
  { campo: "valor2026", titulo: "Valor", tipo: "moneda" },
  { campo: "descripcion_uso", titulo: "Uso" },
  { campo: "dibujado", titulo: "Cartografía", tipo: "booleano" }
];

function cerrarTablaResultados() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  if (tabla) {
    tabla.classList.add("oculto");
    tabla.classList.remove("minimizada");
  }
  document.body.classList.remove("tabla-resultados-minimizada");
  actualizarLayoutPrincipal();
}

function toggleTablaCompacta() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  if (tabla) tabla.classList.toggle("compacta");
}

function renderizarTablaResultados(resultados, totalReal = null) {
  gridEstado.todos = resultados || [];
  gridEstado.filtrados = [...gridEstado.todos];
  gridEstado.totalReal = Number(totalReal ?? gridEstado.todos.length ?? 0);
  gridEstado.pagina = 1;
  ordenarResultadosInterno();
  pintarDataGridResultados();
}

// Actualiza en caliente la fila de la tabla de resultados con los datos
// frescos de la ficha (p. ej. tras aplicar un cambio de nombre/RFC), para
// que la tabla no quede mostrando el dato anterior.
function actualizarFilaResultadoEnGrid(clave, ficha) {
  if (!clave || !ficha) return;
  if (!gridEstado || !Array.isArray(gridEstado.todos) || gridEstado.todos.length === 0) return;

  const claveNorm = String(clave).trim().toUpperCase();
  let cambiado = false;

  gridEstado.todos.forEach(row => {
    if (String(row.clave_catastral || "").trim().toUpperCase() !== claveNorm) return;

    gridColumnasResultados.forEach(col => {
      let v = ficha[col.campo];
      if (col.campo === "nombre_completo") {
        v = ficha.nombre_completo || ficha.propietario;
      } else if (col.campo === "zona_homogenea") {
        v = (ficha.zona_homogenea !== undefined && ficha.zona_homogenea !== null)
          ? ficha.zona_homogenea
          : ficha.zonah;
      }
      if (v !== undefined && v !== null) row[col.campo] = v;
    });

    if (ficha.rfc !== undefined && ficha.rfc !== null) row.rfc = ficha.rfc;
    if (ficha.tipo_persona !== undefined && ficha.tipo_persona !== null) row.tipo_persona = ficha.tipo_persona;

    cambiado = true;
  });

  if (cambiado) {
    ordenarResultadosInterno();
    pintarDataGridResultados();
  }
}

function ordenarResultadosInterno() {
  gridEstado.filtrados.sort((a, b) => {
    let va = a[gridEstado.sortCampo];
    let vb = b[gridEstado.sortCampo];

    if (va === null || va === undefined) va = "";
    if (vb === null || vb === undefined) vb = "";

    const na = Number(va);
    const nb = Number(vb);

    if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== "" && String(vb).trim() !== "") {
      return gridEstado.sortDir === "asc" ? na - nb : nb - na;
    }

    va = String(va).toUpperCase();
    vb = String(vb).toUpperCase();

    if (va < vb) return gridEstado.sortDir === "asc" ? -1 : 1;
    if (va > vb) return gridEstado.sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

function ordenarResultados(campo) {
  if (gridEstado.sortCampo === campo) {
    gridEstado.sortDir = gridEstado.sortDir === "asc" ? "desc" : "asc";
  } else {
    gridEstado.sortCampo = campo;
    gridEstado.sortDir = "asc";
  }

  ordenarResultadosInterno();
  pintarDataGridResultados();
}

function pintarDataGridResultados() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  const titulo = document.getElementById("tablaTitulo");
  const contenido = document.getElementById("tablaResultadosContenido");
  const resumen = document.getElementById("tablaResumen");
  const pagina = document.getElementById("tablaPagina");

  if (!tabla || !titulo || !contenido) return;

  titulo.innerText = "Resultados catastrales";

  if (gridEstado.filtrados.length === 0) {
    contenido.innerHTML = "<div style='padding:12px;'>Sin resultados.</div>";
    if (resumen) resumen.innerText = "0 de 0 registros";
    if (pagina) pagina.innerText = "1 / 1";
    tabla.classList.remove("oculto");
    if (document.getElementById("chkLeyenda")?.checked) aplicarVisibilidadLeyendaIntegrada(true);
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(gridEstado.filtrados.length / gridEstado.pageSize));
  if (gridEstado.pagina > totalPaginas) gridEstado.pagina = totalPaginas;

  const ini = (gridEstado.pagina - 1) * gridEstado.pageSize;
  const fin = ini + gridEstado.pageSize;
  const paginaDatos = gridEstado.filtrados.slice(ini, fin);

  let html = `
    <div class="resultados-table-wrap">
      <table class="resultados-table">
        <thead>
          <tr>
  `;

  gridColumnasResultados.forEach(col => {
    const sortClass =
      gridEstado.sortCampo === col.campo
        ? (gridEstado.sortDir === "asc" ? "sort-asc" : "sort-desc")
        : "";

    html += `<th class="sortable ${sortClass}" onclick="ordenarResultados('${col.campo}')">${col.titulo}</th>`;
  });

  html += `
          </tr>
        </thead>
        <tbody>
  `;

  paginaDatos.forEach((p, i) => {
    const idxGlobal = ini + i;
    html += `<tr data-idx="${idxGlobal}" onclick="seleccionarResultadoTabla(${idxGlobal})">`;

    gridColumnasResultados.forEach(col => {
      let valor = p[col.campo];

      if (col.tipo === "moneda") {
        valor = formatoMoneda(valor);
        html += `<td class="money">${valor}</td>`;
      } else if (col.tipo === "booleano") {
        valor = valor
          ? '<span class="badge-grid badge-grid-ok">DIBUJADO</span>'
          : '<span class="badge-grid badge-grid-warn">SIN GEOM.</span>';
        html += `<td class="center">${valor}</td>`;
      } else {
        html += `<td>${valor || ""}</td>`;
      }
    });

    html += "</tr>";
  });

  html += "</tbody></table></div>";
  contenido.innerHTML = html;

  if (resumen) {
    const totalReal = gridEstado.totalReal || gridEstado.filtrados.length;
    const cargados = gridEstado.todos.length;
    if (totalReal > cargados) {
      resumen.innerText = `${ini + 1}-${Math.min(fin, gridEstado.filtrados.length)} de ${cargados.toLocaleString("es-MX")} cargados · Total encontrado: ${totalReal.toLocaleString("es-MX")}`;
    } else {
      resumen.innerText = `${ini + 1}-${Math.min(fin, gridEstado.filtrados.length)} de ${gridEstado.filtrados.length.toLocaleString("es-MX")} registros`;
    }
  }
  if (pagina) pagina.innerText = `${gridEstado.pagina} / ${totalPaginas}`;

  tabla.classList.remove("oculto");
  tabla.classList.remove("minimizada");
  document.body.classList.remove("tabla-resultados-minimizada");
  if (document.getElementById("chkLeyenda")?.checked) {
    aplicarVisibilidadLeyendaIntegrada(true);
  }
  actualizarLayoutPrincipal();
}

async function seleccionarResultadoTabla(idx) {
  const p = gridEstado.filtrados[idx];
  if (!p) return;

  document.querySelectorAll(".resultados-table tr").forEach(tr => tr.classList.remove("resultado-activo"));
  const tr = document.querySelector(`.resultados-table tr[data-idx="${idx}"]`);
  if (tr) tr.classList.add("resultado-activo");

  document.getElementById("claveInput").value = p.clave_catastral;
  await cargarDesdeBusqueda(p);
}

function filtrarTablaResultados() {
  const filtro = (document.getElementById("filtroTablaResultados")?.value || "").toUpperCase();

  gridEstado.filtrados = gridEstado.todos.filter(p =>
    Object.values(p).some(v => String(v ?? "").toUpperCase().includes(filtro))
  );

  gridEstado.pagina = 1;
  ordenarResultadosInterno();
  pintarDataGridResultados();
}

function cambiarPageSizeResultados() {
  gridEstado.pageSize = Number(document.getElementById("pageSizeResultados")?.value || 25);
  gridEstado.pagina = 1;
  pintarDataGridResultados();
}

function paginaResultadosAnterior() {
  if (gridEstado.pagina > 1) {
    gridEstado.pagina--;
    pintarDataGridResultados();
  }
}

function paginaResultadosSiguiente() {
  const totalPaginas = Math.max(1, Math.ceil(gridEstado.filtrados.length / gridEstado.pageSize));
  if (gridEstado.pagina < totalPaginas) {
    gridEstado.pagina++;
    pintarDataGridResultados();
  }
}



/* --- v20: PDF institucional del predio seleccionado --- */
function obtenerClaveSeleccionadaPDF() {
  const fichaClave = document.getElementById("fichaClave")?.innerText?.trim();
  if (fichaClave) return fichaClave;

  const inputClave = document.getElementById("claveInput")?.value?.trim();
  if (inputClave) return inputClave;

  try {
    const f = vectorSource.getFeatures().find(x => x.get("seleccionado") === true);
    return f ? (f.get("clave_catastral") || "") : "";
  } catch (e) {
    return "";
  }
}

function obtenerPropiedadesFichaPDF() {
  const clave = obtenerClaveSeleccionadaPDF();
  if (!clave) return null;

  try {
    const f = vectorSource.getFeatures().find(x => (x.get("clave_catastral") || "").toUpperCase() === clave.toUpperCase());
    if (f) return f.getProperties();
  } catch (e) {}

  return {
    clave_catastral: clave,
    nombre_completo: document.querySelector(".ficha-status-box .big + div")?.innerText || ""
  };
}

function formatoPdfMoneda(v) {
  const n = Number(v || 0);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function textoPdf(v) {
  if (v === null || v === undefined || v === "") return "Sin dato";
  return String(v);
}

function obtenerImagenMapaPDF() {
  return new Promise(resolve => {
    let resuelto = false;

    const finalizar = (img) => {
      if (!resuelto) {
        resuelto = true;
        resolve(img);
      }
    };

    // Timeout de seguridad: si el mapa tarda o falla, continúa sin croquis capturado.
    setTimeout(() => finalizar(null), 2500);

    try {
      map.once("rendercomplete", function () {
        try {
          const size = map.getSize();
          const canvasFinal = document.createElement("canvas");
          canvasFinal.width = size[0];
          canvasFinal.height = size[1];
          const ctx = canvasFinal.getContext("2d");

          Array.prototype.forEach.call(
            document.querySelectorAll(".ol-layer canvas, canvas.ol-layer"),
            function (canvas) {
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
              } catch (canvasError) {
                console.warn("Una capa no pudo capturarse para PDF:", canvasError);
              }
            }
          );

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;

          // Esta línea puede fallar con Google/tiles externos por CORS.
          const data = canvasFinal.toDataURL("image/png");
          finalizar(data);
        } catch (e) {
          console.warn("No se pudo capturar el mapa para PDF; se generará sin imagen de mapa.", e);
          finalizar(null);
        }
      });

      map.renderSync();
    } catch (e) {
      console.warn("No se pudo iniciar captura del mapa:", e);
      finalizar(null);
    }
  });
}

async function generarQRPDF(clave) {
  try {
    const canvas = document.getElementById("qrPdfTemp") || document.createElement("canvas");
    const url = `${location.origin}${location.pathname}?clave=${encodeURIComponent(clave)}`;
    await QRCode.toCanvas(canvas, url, { width: 120, margin: 1 });
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("No se pudo generar QR:", e);
    return null;
  }
}


/* --- v20c: croquis institucional WMS para PDF cuando Google bloquea captura --- */
function obtenerFeatureSeleccionadaPDF() {
  try {
    const clave = obtenerClaveSeleccionadaPDF();
    return vectorSource.getFeatures().find(f =>
      (f.get("clave_catastral") || "").toUpperCase() === (clave || "").toUpperCase()
    ) || vectorSource.getFeatures().find(f => f.get("seleccionado") === true) || null;
  } catch (e) {
    return null;
  }
}

function expandirExtentPDF(extent, factor = 1.25) {
  const w = extent[2] - extent[0];
  const h = extent[3] - extent[1];
  const cx = (extent[0] + extent[2]) / 2;
  const cy = (extent[1] + extent[3]) / 2;
  const maxDim = Math.max(w, h, 80);
  const half = (maxDim * factor) / 2;
  return [cx - half, cy - half, cx + half, cy + half];
}

function cargarImagenPDF(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function dibujarGeometriaPDF(ctx, geom, bbox, width, height) {
  if (!geom) return;

  const extent = bbox;
  const minx = extent[0], miny = extent[1], maxx = extent[2], maxy = extent[3];

  function px(coord) {
    const x = ((coord[0] - minx) / (maxx - minx)) * width;
    const y = height - ((coord[1] - miny) / (maxy - miny)) * height;
    return [x, y];
  }

  function dibujarRing(coords) {
    if (!coords || coords.length === 0) return;
    ctx.beginPath();
    coords.forEach((c, i) => {
      const p = px(c);
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  const type = geom.getType();

  ctx.save();
  ctx.fillStyle = "rgba(21, 128, 61, 0.28)";
  ctx.strokeStyle = "#15803d";
  ctx.lineWidth = 6;

  if (type === "Polygon") {
    const rings = geom.getCoordinates();
    rings.forEach(r => dibujarRing(r));
  }

  if (type === "MultiPolygon") {
    const polys = geom.getCoordinates();
    polys.forEach(poly => poly.forEach(r => dibujarRing(r)));
  }

  ctx.restore();
}

async function generarCroquisWMSPDF() {
  try {
    const feature = obtenerFeatureSeleccionadaPDF();
    if (!feature || !feature.getGeometry()) return null;

    const width = 1100;
    const height = 620;

    const geom = feature.getGeometry();
    const extentOriginal = geom.getExtent();
    const bbox = expandirExtentPDF(extentOriginal, 3.0);

    const wmsUrl =
      "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms?" +
      "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap" +
      "&LAYERS=catastro_bc:predios_oficial" +
      "&STYLES=" +
      "&FORMAT=image/png" +
      "&TRANSPARENT=false" +
      "&SRS=EPSG:3857" +
      `&BBOX=${bbox.join(",")}` +
      `&WIDTH=${width}&HEIGHT=${height}`;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Fondo institucional claro
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    const img = await cargarImagenPDF(wmsUrl);
    if (img) {
      try {
        ctx.drawImage(img, 0, 0, width, height);
      } catch (e) {
        console.warn("No se pudo dibujar WMS en croquis PDF:", e);
      }
    } else {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#64748b";
      ctx.font = "bold 26px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Croquis institucional WMS", width / 2, height / 2 - 14);
      ctx.font = "20px Arial";
      ctx.fillText("No se pudo cargar imagen WMS, se dibuja la geometría seleccionada.", width / 2, height / 2 + 22);
    }

    // Rejilla ligera
    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,0.22)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.restore();

    // Predio seleccionado
    dibujarGeometriaPDF(ctx, geom, bbox, width, height);

    // Etiqueta
    const clave = feature.get("clave_catastral") || obtenerClaveSeleccionadaPDF();
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "#15803d";
    ctx.lineWidth = 2;
    ctx.roundRect(width - 270, 24, 235, 54, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(clave, width - 152, 59);
    ctx.restore();

    // Norte
    ctx.save();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(50, 50, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px Arial";
    ctx.textAlign = "center";
    ctx.fillText("N", 50, 60);
    ctx.restore();

    // Escala referencial
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(50, height - 45);
    ctx.lineTo(250, height - 45);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.font = "18px Arial";
    ctx.fillText("Escala gráfica referencial", 50, height - 18);
    ctx.restore();

    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("No se pudo generar croquis WMS PDF:", e);
    return null;
  }
}

async function generarPDFInstitucional() {
  const btn = document.getElementById("btnPdfInstitucional");
  const estado = document.getElementById("estadoPdfInstitucional");

  const setEstado = (txt, tipo = "") => {
    if (!estado) return;
    estado.innerText = txt;
    estado.className = "estado-pdf " + tipo;
  };

  try {
    const clave = obtenerClaveSeleccionadaPDF();

    if (!clave) {
      alert("Primero selecciona o busca un predio para generar el PDF.");
      return;
    }

    if (typeof window.jspdf === "undefined") {
      alert("No se cargó la librería jsPDF. Revisa conexión a internet o bloqueo de CDN.");
      setEstado("No se cargó jsPDF.", "error");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerText = "⏳ Generando PDF...";
    }
    setEstado("Generando ficha institucional...", "procesando");

    let feature = null;
    try {
      const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, { cache: "no-store", headers: authHeaders() });
      if (r.ok) feature = await r.json();
    } catch (e) {
      console.warn("No se pudo cargar ficha para PDF:", e);
    }

    const p = feature?.properties || obtenerPropiedadesFichaPDF() || {};
    setEstado("Capturando mapa...", "procesando");
    let mapaImg = await obtenerImagenMapaPDF();
    if (!mapaImg) {
      setEstado("Google bloqueó captura; generando croquis WMS institucional...", "procesando");
      mapaImg = await generarCroquisWMSPDF();
    }

    setEstado("Generando QR...", "procesando");
    const qrImg = await generarQRPDF(clave);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "letter");

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const guinda = [112, 51, 65];
    const grisTexto = [40, 48, 60];
    const grisClaro = [245, 247, 250];
    const rojo = [198, 40, 40];
    const verde = [21, 128, 61];

    // Header
    doc.setFillColor(...guinda);
    doc.rect(0, 0, pageW, 25, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Sistema de Gestión Catastral", 14, 10);
    doc.setFontSize(10);
    doc.text("Ficha predial institucional · Catastro Mexicali", 14, 17);

    doc.setFontSize(9);
    const fecha = new Date().toLocaleString("es-MX");
    doc.text(`Fecha: ${fecha}`, pageW - 14, 10, { align: "right" });
    doc.text(`Clave: ${clave}`, pageW - 14, 17, { align: "right" });

    // Title block
    doc.setTextColor(...grisTexto);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Ficha predial: ${clave}`, 14, 36);

    const tieneAdeudo = Number(p.adeudo_total || 0) > 0;
    doc.setFillColor(...(tieneAdeudo ? rojo : verde));
    doc.roundedRect(pageW - 62, 29, 48, 10, 2, 2, "F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(8);
    doc.text(tieneAdeudo ? "CON ADEUDO" : "SIN ADEUDO", pageW - 38, 35.5, { align: "center" });

    // Croquis
    doc.setDrawColor(220, 225, 232);
    doc.setFillColor(...grisClaro);
    doc.roundedRect(14, 43, pageW - 28, 78, 2, 2, "FD");

    if (mapaImg) {
      try {
        doc.addImage(mapaImg, "PNG", 16, 45, pageW - 32, 74);
      } catch (imgErr) {
        console.warn("No se pudo insertar la imagen del mapa en PDF:", imgErr);
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        doc.text("Croquis no disponible; no se pudo capturar Google ni generar WMS.", pageW / 2, 80, { align: "center" });
        doc.text("El PDF se genera con la información predial institucional.", pageW / 2, 87, { align: "center" });
      }
    } else {
      doc.setFontSize(10);
      doc.setTextColor(120, 120, 120);
      doc.text("Croquis no disponible; no se pudo capturar Google ni generar WMS.", pageW / 2, 80, { align: "center" });
      doc.text("El PDF se genera con la información predial institucional.", pageW / 2, 87, { align: "center" });
    }

    // Norte y escala visual simple
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(0, 0, 0);
    doc.circle(pageW - 27, 54, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("N", pageW - 27, 57, { align: "center" });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.7);
    doc.line(22, 113, 62, 113);
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text("Escala gráfica referencial", 22, 117);

    // Datos principales
    let y = 132;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...guinda);
    doc.text("Información del predio", 14, y);

    y += 6;

    function row(label, value, x1, x2, yy) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...guinda);
      doc.setFontSize(8);
      doc.text(label, x1, yy);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...grisTexto);
      doc.text(doc.splitTextToSize(textoPdf(value), x2 - x1 - 4), x1 + 35, yy);
    }

    doc.setDrawColor(230, 234, 240);
    doc.setFillColor(252, 252, 253);
    doc.roundedRect(14, y, pageW - 28, 58, 2, 2, "FD");

    row("Clave", p.clave_catastral || clave, 18, pageW/2, y + 9);
    row("Propietario", p.nombre_completo || p.propietario, 18, pageW - 18, y + 18);
    row("Delegación", p.delegacion, 18, pageW/2, y + 27);
    row("Colonia", p.colonia, pageW/2 + 2, pageW - 18, y + 27);
    row("Calle", p.calle, 18, pageW/2, y + 36);
    row("# Oficial", p.numof, pageW/2 + 2, pageW - 18, y + 36);
    row("Zona H.", p.zona_homogenea || p.zonah, 18, pageW/2, y + 45);
    row("Uso", p.descripcion_uso, pageW/2 + 2, pageW - 18, y + 45);

    y += 68;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...guinda);
    doc.text("Valores, superficies y estado fiscal", 14, y);

    y += 6;
    doc.setDrawColor(230, 234, 240);
    doc.setFillColor(252, 252, 253);
    doc.roundedRect(14, y, pageW - 28, 42, 2, 2, "FD");

    row("Valor 2026", formatoPdfMoneda(p.valor2026), 18, pageW/2, y + 10);
    row("Sup. doc.", `${textoPdf(p.sup_documental)} m²`, pageW/2 + 2, pageW - 18, y + 10);
    row("Sup. física", `${textoPdf(p.sup_fisica)} m²`, 18, pageW/2, y + 20);
    row("Sup. const.", `${textoPdf(p.sup_const)} m²`, pageW/2 + 2, pageW - 18, y + 20);
    row("Adeudo 2026", formatoPdfMoneda(p.adeudo_2026), 18, pageW/2, y + 30);
    row("Adeudo total", formatoPdfMoneda(p.adeudo_total), pageW/2 + 2, pageW - 18, y + 30);

    if (qrImg) {
      try {
        doc.addImage(qrImg, "PNG", pageW - 42, pageH - 42, 28, 28);
        doc.setFontSize(7);
        doc.setTextColor(80, 80, 80);
        doc.text("Consulta digital", pageW - 28, pageH - 10, { align: "center" });
      } catch(e) {
        console.warn("QR no insertado:", e);
      }
    }

    doc.setDrawColor(...guinda);
    doc.setLineWidth(0.5);
    doc.line(14, pageH - 18, pageW - 48, pageH - 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    doc.text("Documento generado automáticamente por el Sistema de Gestión Catastral. Información sujeta a validación institucional.", 14, pageH - 12);

    setEstado("PDF generado correctamente.", "ok");
    doc.save(`ficha_predial_${clave}.pdf`);

  } catch (e) {
    console.error("Error generando PDF:", e);
    alert("No se pudo generar el PDF. Abre la consola del navegador para ver el detalle.");
    setEstado("Error al generar PDF.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "📄 Generar ficha PDF";
    }
  }
}

function exportarResultadosExcel() {
  const datos = gridEstado.filtrados && gridEstado.filtrados.length
    ? gridEstado.filtrados
    : (gridEstado.todos || []);

  if (!datos.length) {
    alert("No hay resultados para exportar.");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("No se pudo cargar la librería de Excel. Revisa tu conexión a internet.");
    return;
  }

  const columnas = [
    { campo: "clave_catastral", titulo: "Clave catastral" },
    { campo: "nombre_completo", titulo: "Nombre / Razón social" },
    { campo: "delegacion", titulo: "Delegación" },
    { campo: "colonia", titulo: "Colonia" },
    { campo: "calle", titulo: "Calle" },
    { campo: "numof", titulo: "Número oficial" },
    { campo: "zona_homogenea", titulo: "Zona homogénea" },
    { campo: "valor2026", titulo: "Valor 2026" },
    { campo: "sup_documental", titulo: "Superficie documental" },
    { campo: "id_tasa", titulo: "ID tasa" },
    { campo: "porcentaje_tasa", titulo: "Porcentaje tasa" },
    { campo: "condominio", titulo: "Condominio" },
    { campo: "descripcion_uso", titulo: "Uso predial" },
    { campo: "dibujado", titulo: "Dibujado en cartografía" }
  ];

  const filas = datos.map(p => {
    const fila = {};
    columnas.forEach(col => {
      let valor = p[col.campo];

      if (col.campo === "dibujado") {
        valor = valor ? "DIBUJADO" : "SIN GEOMETRÍA";
      }

      if (valor === null || valor === undefined) {
        valor = "";
      }

      fila[col.titulo] = valor;
    });
    return fila;
  });

  const ws = XLSX.utils.json_to_sheet(filas);

  ws["!cols"] = columnas.map(col => ({
    wch: Math.max(14, col.titulo.length + 2)
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");

  // Hoja de resumen para conservar el total real del backend
  const resumen = [{
    "Total encontrado": gridEstado.totalReal || datos.length,
    "Registros cargados/exportados": datos.length,
    "Nota": (gridEstado.totalReal && gridEstado.totalReal > datos.length)
      ? "El total real es mayor que los registros cargados en la tabla."
      : "Exportación completa de los registros cargados."
  }];
  const wsResumen = XLSX.utils.json_to_sheet(resumen);
  wsResumen["!cols"] = [{ wch: 20 }, { wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const fecha = new Date();
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  const hh = String(fecha.getHours()).padStart(2, "0");
  const mi = String(fecha.getMinutes()).padStart(2, "0");

  XLSX.writeFile(wb, `resultados_catastro_${yyyy}${mm}${dd}_${hh}${mi}.xlsx`);
}

// Alias para compatibilidad con botones anteriores
function exportarResultadosCSV() {
  exportarResultadosExcel();
}



/* --- v16: contador + búsqueda con fallback seguro --- */
function deduplicarResultadosPadron(resultados) {
  const vistos = new Map();
  (resultados || []).forEach(r => {
    const clave = String(r.clave_catastral || "").trim().toUpperCase();
    if (!clave) return;
    if (!vistos.has(clave)) vistos.set(clave, r);
  });
  return Array.from(vistos.values());
}

function detectarTipoBusquedaActiva() {
  const clave = (document.getElementById("claveInput")?.value || "").trim();
  const nombre = (document.getElementById("nombreInput")?.value || "").trim();
  const calle = (document.getElementById("calleInput")?.value || "").trim();
  const numero = (document.getElementById("numeroInput")?.value || "").trim();
  const colonia = (document.getElementById("coloniaInput")?.value || "").trim();

  if (clave) return "clave";
  if (nombre) return "nombre";
  if (calle || numero || colonia) return "direccion";
  return "general";
}

function actualizarContadorBusqueda(total, tipo = null, cargados = null) {
  const totalNum = Number(total || 0);
  const cargadosNum = Number(cargados ?? totalNum);

  let texto = totalNum === 1
    ? "1 predio encontrado"
    : `${totalNum.toLocaleString("es-MX")} predios encontrados`;

  if (totalNum > cargadosNum) {
    texto += ` · cargados ${cargadosNum.toLocaleString("es-MX")}`;
  }

  const general = document.getElementById("contadorBusquedaGeneral");
  if (general) {
    general.innerText = texto;
    general.classList.toggle("contador-ok", totalNum > 0);
    general.classList.toggle("contador-warn", totalNum === 0);
  }

  ["contadorClave", "contadorNombre", "contadorDireccion"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = texto;
    el.classList.toggle("contador-ok", totalNum > 0);
    el.classList.toggle("contador-warn", totalNum === 0);
  });
}

function mostrarAvisoTotalResultados(total, cargados, limiteUsado = null) {
  const contenedorResultados = document.getElementById("resultadosBusqueda");
  if (!contenedorResultados) return;

  let aviso = document.getElementById("avisoTotalResultados");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "avisoTotalResultados";
    aviso.className = "aviso-total-resultados";
    contenedorResultados.parentNode.insertBefore(aviso, contenedorResultados);
  }

  const totalNum = Number(total || 0);
  const cargadosNum = Number(cargados || 0);

  if (totalNum <= 0) {
    aviso.style.display = "none";
    aviso.innerHTML = "";
    return;
  }

  aviso.style.display = "block";
  let extra = limiteUsado ? ` · límite usado: <b>${Number(limiteUsado).toLocaleString("es-MX")}</b>` : "";

  if (totalNum > cargadosNum) {
    aviso.innerHTML = `Total encontrado: <b>${totalNum.toLocaleString("es-MX")}</b> · cargados en tabla: <b>${cargadosNum.toLocaleString("es-MX")}</b>${extra}.`;
  } else {
    aviso.innerHTML = `Total encontrado: <b>${totalNum.toLocaleString("es-MX")}</b>${extra}.`;
  }
}

function construirUrlBusqueda(clave, nombre, colonia, calle, numero, limite) {
  return `${API}/padron/busqueda-avanzada?` +
    `clave=${encodeURIComponent(clave)}` +
    `&nombre=${encodeURIComponent(nombre)}` +
    `&colonia=${encodeURIComponent(colonia)}` +
    `&calle=${encodeURIComponent(calle)}` +
    `&numero=${encodeURIComponent(numero)}` +
    `&limite=${limite}`;
}

async function pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, limite) {
  const url = construirUrlBusqueda(clave, nombre, colonia, calle, numero, limite);
  const r = await fetch(url, { cache: "no-store", headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  data.__limite_usado = limite;
  return data;
}

async function buscarAvanzado() {
  const clave = document.getElementById("claveInput").value.trim();
  const nombre = document.getElementById("nombreInput").value.trim();
  const colonia = document.getElementById("coloniaInput").value.trim();
  const calle = document.getElementById("calleInput").value.trim();
  const numero = document.getElementById("numeroInput").value.trim();

  const tipoBusqueda = detectarTipoBusquedaActiva();
  limpiarContornoSeleccion();

  try {
    let data = null;

    try {
      data = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, 5000);
    } catch (e5000) {
      console.warn("Búsqueda con límite 5000 falló; reintentando con 100.", e5000);
      data = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, 100);
    }

    let resultados = deduplicarResultadosPadron(data.resultados || []);
    let total = Number(data.total ?? resultados.length ?? 0);
    if (resultados.length < total && clave && !nombre && !colonia && !calle && !numero) {
      total = resultados.length;
    }

    // Si el backend respondió 0 con 5000, reintenta con 100 para evitar falso negativo.
    if (data.__limite_usado === 5000 && total === 0 && resultados.length === 0) {
      try {
        const data100 = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, 100);
        if ((data100.resultados || []).length > 0 || Number(data100.total || 0) > 0) {
          data = data100;
          resultados = deduplicarResultadosPadron(data100.resultados || []);
          total = Number(data100.total ?? resultados.length ?? 0);
          if (resultados.length < total && clave && !nombre && !colonia && !calle && !numero) {
            total = resultados.length;
          }
        }
      } catch (e100) {
        console.warn("Reintento con 100 también falló.", e100);
      }
    }

    actualizarContadorBusqueda(total, tipoBusqueda, resultados.length);
    mostrarAvisoTotalResultados(total, resultados.length, data.__limite_usado);

    const div = document.getElementById("resultadosBusqueda");
    div.innerHTML = "";

    if (!resultados || resultados.length === 0) {
      div.innerHTML = "<p>Sin resultados.</p>";
      renderizarTablaResultados([], total);
      return;
    }

    renderizarTablaResultados(resultados, total);
    await zoomAResultadosBusqueda(resultados);

    const LIMITE_LISTA_LATERAL = 3;
    resultados.slice(0, LIMITE_LISTA_LATERAL).forEach(p => {
      const item = document.createElement("div");
      item.className = "resultado-item";
      item.innerHTML = `
        <b>${p.clave_catastral}</b><br>
        <strong>${p.nombre_completo || ""}</strong><br>
        <small>${p.colonia || ""}${p.calle ? " · " + p.calle : ""}${p.numof ? " #" + p.numof : ""}</small>
      `;

      item.onclick = async () => {
        document.getElementById("claveInput").value = p.clave_catastral;
        await cargarDesdeBusqueda(p);
      };

      div.appendChild(item);
    });

    if (resultados.length > LIMITE_LISTA_LATERAL) {
      const nota = document.createElement("div");
      nota.className = "aviso-total-resultados";
      nota.style.display = "block";
      nota.innerHTML = `Mostrando <b>${LIMITE_LISTA_LATERAL}</b> de <b>${resultados.length.toLocaleString("es-MX")}</b> en el panel. Usa la tabla inferior para ver todos.`;
      div.appendChild(nota);
    }

    if (document.getElementById("chkLeyenda")?.checked !== false) {
      aplicarVisibilidadLeyendaIntegrada(true);
    }

  } catch(e) {
    console.error("Error en búsqueda avanzada:", e);
    actualizarContadorBusqueda(0, tipoBusqueda, 0);
    mostrarAvisoTotalResultados(0, 0);
  }
}

function registrarEnterBusquedas() {
  ["claveInput", "nombreInput", "coloniaInput", "calleInput", "numeroInput"].forEach(function(id) {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("keyup", function(e) {
        if (e.key === "Enter") buscarAvanzado();
      });
    }
  });
}

async function seleccionarPorClave(clave, origen = "programa", opciones = {}) {
  if (!clave) return;

  const claveNorm = String(clave).trim().toUpperCase();
  const claveAnterior = claveSeleccionadaActual;
  const seq = ++seleccionPredioSeq;

  // Feedback visual inmediato: si el clic en el mapa ya trajo la geometría
  // (vía /predios/intersecta), pintamos el contorno y reencuadramos sin esperar
  // a que termine de cargar la ficha (/expediente), que es lo que se sentía lento.
  let zoomYaAplicado = false;
  const geojsonPrefetch = opciones?.geojsonPrefetch;
  if (geojsonPrefetch?.geometry && origen === "mapa") {
    try {
      const formatPre = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      const geomPre = formatPre.readFeature(geojsonPrefetch).getGeometry();
      if (geomPre) {
        const enResultadosPre = resultadosSource?.getFeatures().some(
          f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
        );
        if (!enResultadosPre) pintarGeoJSON(geojsonPrefetch, false);
        aplicarSeleccionVisualPredio(claveNorm, geomPre);
        claveSeleccionadaActual = claveNorm;
        const debeZoomPre = claveNorm !== claveAnterior && !geometriaVisibleEnVista(geomPre);
        if (debeZoomPre) {
          programarZoomPredioSeleccionado(geomPre, {}, seq);
          zoomYaAplicado = true;
        }
      }
    } catch (e) {
      /* si falla, seguimos con el flujo normal */
    }
  }

  const fichaGeojsonResponse = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}?_=${Date.now()}`, {
    cache: "no-store",
    headers: authHeaders()
  });

  if (seq !== seleccionPredioSeq) return;

  if (!fichaGeojsonResponse.ok) {
    console.warn("No se pudo cargar expediente:", claveNorm);
    return;
  }

  const featureGeojson = await fichaGeojsonResponse.json();
  if (seq !== seleccionPredioSeq) return;

  const ficha = featureGeojson.properties || {};

  const enResultados = resultadosSource?.getFeatures().some(
    f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
  );

  let debeHacerZoom = origen !== "mapa" || claveNorm !== claveSeleccionadaActual;
  let geomParaZoom = null;

  if (enResultados) {
    vectorSource.clear();
    const fRes = resultadosSource.getFeatures().find(
      f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
    );
    if (fRes) {
      fRes.set("adeudo_total", Number(ficha.adeudo_total || fRes.get("adeudo_total") || 0));
      fRes.set("info_fiscal", true);
    }

    let geomSeleccion = fRes ? fRes.getGeometry() : null;
    if (featureGeojson.geometry) {
      const format = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      geomSeleccion = format.readFeature(featureGeojson).getGeometry();
    }

    geomParaZoom = geomSeleccion;
    aplicarSeleccionVisualPredio(claveNorm, geomSeleccion);
  } else if (featureGeojson.geometry) {
    pintarGeoJSON(featureGeojson, false);
    const format = new ol.format.GeoJSON({
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    geomParaZoom = format.readFeature(featureGeojson).getGeometry();
  } else {
    limpiarContornoSeleccion();
  }

  if (seq !== seleccionPredioSeq) return;

  claveSeleccionadaActual = claveNorm;
  await pintarFicha(ficha);
  document.getElementById("claveInput").value = claveNorm;
  sincronizarClavesMovimientoConPredioActivo();
  actualizarBreadcrumbPredio(claveNorm, window.predioSeleccionado || ficha);

  try { actualizarFilaResultadoEnGrid(claveNorm, window.predioSeleccionado || ficha); } catch (e) {}

  // Si la selección viene del mapa y el predio ya está visible, no recentramos
  // (evita el "brinco"). Solo se reencuadra si el predio queda fuera de la vista.
  if (debeHacerZoom && origen === "mapa" && geometriaVisibleEnVista(geomParaZoom)) {
    debeHacerZoom = false;
  }

  // Si ya reencuadramos con la geometría del clic, no repetimos el zoom.
  if (zoomYaAplicado) {
    debeHacerZoom = false;
  }

  if (debeHacerZoom && geomParaZoom) {
    programarZoomPredioSeleccionado(geomParaZoom, {}, seq);
  }
}

map.on("click", async function(evt) {
  if (Date.now() < ignorarClickMapaHasta) return;
  if (evt.dragging) return;

  try {
    // 1) Selección exacta por coordenada (punto-en-polígono en PostGIS).
    //    Es la fuente más precisa: evita que el WMS (con tolerancia de píxeles)
    //    devuelva un predio vecino equivocado.
    const lonlat = ol.proj.toLonLat(evt.coordinate);
    const lon = lonlat[0];
    const lat = lonlat[1];

    try {
      const res = await fetch(`${API}/predios/intersecta?lon=${lon}&lat=${lat}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });

      if (res.ok) {
        const featureGeojson = await res.json();
        const clave = extraerClavePredioProps(featureGeojson.properties);
        if (clave) {
          // Pasamos la geometría ya obtenida para feedback visual inmediato.
          await seleccionarPorClave(clave, "mapa", { geojsonPrefetch: featureGeojson });
          return;
        }
      }
    } catch (eInt) {
      console.warn("Fallo /predios/intersecta, se intenta WMS:", eInt);
    }

    // 2) Respaldo: WMS GetFeatureInfo (solo si la consulta exacta no respondió).
    const view = map.getView();
    const resolution = view.getResolution();
    const projection = view.getProjection();

    const wmsUrl = prediosWmsLayer.getSource().getFeatureInfoUrl(
      evt.coordinate,
      resolution,
      projection,
      {
        "INFO_FORMAT": "application/json",
        "FEATURE_COUNT": 10
      }
    );

    if (wmsUrl) {
      const rWms = await fetch(wmsUrl, { cache: "no-store" });

      if (rWms.ok) {
        const dataWms = await rWms.json();
        const features = dataWms.features || [];

        if (features.length > 0) {
          const elegido = elegirPredioWmsEnClick(features, evt.coordinate);
          const clave = extraerClavePredioProps(elegido?.properties);

          if (clave) {
            await seleccionarPorClave(clave, "mapa");
            return;
          }
        }
      }
    }

  } catch (err) {
    console.error("Error al seleccionar predio por click:", err);
  }
});

const popup = document.getElementById("popup");

map.on("pointermove", function(evt) {
  const feature = map.forEachFeatureAtPixel(evt.pixel, function(feature) {
    return feature;
  });

  if (feature) {
    const clave = feature.get("clave_catastral") || "";
    const superficie = feature.get("superficie") || feature.get("sup_documental") || "";
    const colonia = feature.get("colonia") || "";

    popup.innerHTML = `
      <b>${clave}</b><br>
      Colonia: ${colonia}<br>
      Sup: ${superficie} m²
    `;

    popup.style.left = evt.originalEvent.pageX + 12 + "px";
    popup.style.top = evt.originalEvent.pageY + 12 + "px";
    popup.style.display = "block";
    map.getTargetElement().style.cursor = "pointer";
  } else {
    popup.style.display = "none";
    map.getTargetElement().style.cursor = "";
  }
});



/* ============================================================
   v22 - Administración institucional de usuarios
============================================================ */
let adminUsuariosCache = [];

function setAdminMensaje(texto, tipo = "") {
  const el = document.getElementById("adminMensaje");
  if (!el) return;
  el.innerText = texto || "";
  el.className = "admin-mensaje " + tipo;
}

async function fetchAdmin(url, options = {}) {
  const token = obtenerTokenInstitucional();

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...(options.headers || {})
  };

  return fetch(`${API}${url}`, {
    ...options,
    headers
  });
}

function formatearFechaAdmin(fecha) {
  if (!fecha) return "-";
  try {
    return new Date(fecha).toLocaleString("es-MX");
  } catch (e) {
    return fecha;
  }
}

async function cargarUsuariosAdmin() {
  const cont = document.getElementById("adminUsuariosTabla");
  if (!cont) return;

  cont.innerHTML = "<div style='padding:10px;'>Cargando usuarios...</div>";

  try {
    const r = await fetchAdmin("/admin/usuarios");

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || "No se pudieron cargar usuarios");
    }

    const data = await r.json();
    adminUsuariosCache = data.usuarios || [];

    pintarUsuariosAdmin(adminUsuariosCache);

  } catch (e) {
    console.error(e);
    cont.innerHTML = `<div style="padding:10px;color:#991b1b;">${e.message}</div>`;
  }
}

function filtrarUsuariosAdmin() {
  const filtro = (document.getElementById("adminFiltroUsuarios")?.value || "").toUpperCase();

  const filtrados = adminUsuariosCache.filter(u =>
    Object.values(u).some(v => String(v ?? "").toUpperCase().includes(filtro))
  );

  pintarUsuariosAdmin(filtrados);
}

function pintarUsuariosAdmin(usuarios) {
  const cont = document.getElementById("adminUsuariosTabla");
  if (!cont) return;

  const total = usuarios.length;
  const activos = usuarios.filter(u => u.activo).length;
  const inactivos = total - activos;

  const setTxt = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.innerText = Number(v || 0).toLocaleString("es-MX");
  };

  setTxt("adminTotalUsuarios", total);
  setTxt("adminUsuariosActivos", activos);
  setTxt("adminUsuariosInactivos", inactivos);

  if (usuarios.length === 0) {
    cont.innerHTML = "<div style='padding:10px;'>Sin usuarios.</div>";
    return;
  }

  let html = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Usuario</th>
          <th>Nombre</th>
          <th>Rol</th>
          <th>Estado</th>
          <th>Último acceso</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
  `;

  usuarios.forEach(u => {
    const estado = u.activo
      ? '<span class="badge-admin-activo">ACTIVO</span>'
      : '<span class="badge-admin-inactivo">INACTIVO</span>';

    const rol = u.rol_principal || (Array.isArray(u.roles) ? u.roles.join(", ") : "");

    html += `
      <tr>
        <td><b>${u.usuario || ""}</b></td>
        <td>${u.nombre_completo || ""}</td>
        <td>${rol || ""}</td>
        <td>${estado}</td>
        <td>${formatearFechaAdmin(u.ultimo_acceso)}</td>
        <td>
          <button type="button" onclick="editarUsuarioAdmin(${u.id})">✏️ Editar</button>
          <button type="button" onclick="resetPasswordAdmin(${u.id})">🔑 Reset</button>
          <button type="button" onclick="toggleActivoAdmin(${u.id}, ${u.activo ? "true" : "false"})">
            ${u.activo ? "⛔ Desactivar" : "✅ Activar"}
          </button>
        </td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  cont.innerHTML = html;
}

async function cargarAuditoriaAdmin() {
  const cont = document.getElementById("adminAuditoriaTabla");
  if (!cont) return;

  cont.innerHTML = "<div style='padding:10px;'>Cargando auditoría...</div>";

  try {
    const r = await fetchAdmin("/admin/auditoria?limite=200");

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || "No se pudo cargar auditoría");
    }

    const data = await r.json();
    const rows = data.auditoria || [];

    if (rows.length === 0) {
      cont.innerHTML = "<div style='padding:10px;'>Sin movimientos.</div>";
      return;
    }

    let html = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Acción</th>
            <th>Módulo</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
    `;

    rows.forEach(a => {
      html += `
        <tr>
          <td>${formatearFechaAdmin(a.fecha)}</td>
          <td>${a.usuario || ""}</td>
          <td>${a.accion || ""}</td>
          <td>${a.modulo || ""}</td>
          <td>${a.detalle || ""}</td>
        </tr>
      `;
    });

    html += "</tbody></table>";
    cont.innerHTML = html;

  } catch (e) {
    console.error(e);
    cont.innerHTML = `<div style="padding:10px;color:#991b1b;">${e.message}</div>`;
  }
}

async function crearUsuarioAdmin() {
  const usuario = document.getElementById("adminNuevoUsuario")?.value.trim();
  const nombre = document.getElementById("adminNuevoNombre")?.value.trim();
  const password = document.getElementById("adminNuevoPassword")?.value || "";
  const rol = document.getElementById("adminNuevoRol")?.value || "consulta";

  if (!usuario || !nombre || !password) {
    setAdminMensaje("Captura usuario, nombre y contraseña.", "error");
    return;
  }

  try {
    setAdminMensaje("Creando usuario...", "ok");

    const r = await fetchAdmin("/admin/usuarios", {
      method: "POST",
      body: JSON.stringify({
        usuario,
        nombre_completo: nombre,
        password,
        rol
      })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data.detail || "No se pudo crear usuario");
    }

    document.getElementById("adminNuevoUsuario").value = "";
    document.getElementById("adminNuevoNombre").value = "";
    document.getElementById("adminNuevoPassword").value = "";
    document.getElementById("adminNuevoRol").value = "consulta";

    setAdminMensaje("Usuario creado correctamente.", "ok");
    await cargarUsuariosAdmin();
    await cargarAuditoriaAdmin();

  } catch (e) {
    console.error(e);
    setAdminMensaje(e.message, "error");
  }
}

async function editarUsuarioAdmin(id) {
  const u = adminUsuariosCache.find(x => Number(x.id) === Number(id));
  if (!u) return;

  const nombre = prompt("Nombre completo:", u.nombre_completo || "");
  if (nombre === null) return;

  const rolActual = u.rol_principal || "consulta";
  const rol = prompt("Rol (admin, supervisor, catastro, cartografia, fiscalizacion, consulta):", rolActual);
  if (rol === null) return;

  try {
    const r = await fetchAdmin(`/admin/usuarios/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        nombre_completo: nombre,
        rol: rol
      })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data.detail || "No se pudo actualizar usuario");
    }

    setAdminMensaje("Usuario actualizado correctamente.", "ok");
    await cargarUsuariosAdmin();
    await cargarAuditoriaAdmin();

  } catch (e) {
    console.error(e);
    setAdminMensaje(e.message, "error");
  }
}

async function resetPasswordAdmin(id) {
  const password = prompt("Nueva contraseña:");
  if (!password) return;

  try {
    const r = await fetchAdmin(`/admin/usuarios/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data.detail || "No se pudo actualizar contraseña");
    }

    setAdminMensaje("Contraseña actualizada correctamente.", "ok");
    await cargarAuditoriaAdmin();

  } catch (e) {
    console.error(e);
    setAdminMensaje(e.message, "error");
  }
}

async function toggleActivoAdmin(id, activoActual) {
  try {
    const r = await fetchAdmin(`/admin/usuarios/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        activo: !activoActual
      })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data.detail || "No se pudo cambiar estado");
    }

    setAdminMensaje("Estado actualizado correctamente.", "ok");
    await cargarUsuariosAdmin();
    await cargarAuditoriaAdmin();

  } catch (e) {
    console.error(e);
    setAdminMensaje(e.message, "error");
  }
}


window.addEventListener("load", function() {
  prepararEventosLoginInstitucional();
  validarSesionInstitucional();

  registrarEnterBusquedas();
  inicializarFichaDraggable();
  inicializarBotonOcultarPanel();
  inicializarAdministradorCapas();
  inicializarDashboardMinimizado();
  actualizarLayoutPrincipal();
  actualizarLeyendaDinamica();
  if (document.getElementById("chkLeyenda")?.checked !== false) {
    aplicarVisibilidadLeyendaIntegrada(true);
  }
});


/* ============================================================
   v28 - Catálogo de propietarios y copropietarios
   - Busca propietarios en catalogos.personas
   - Lista propietarios vigentes del predio
   - Agrega propietarios al predio con porcentaje
   - Valida suma 100%
============================================================ */
const copropEstado = {
  clave: "",
  propietarios: [],
  seleccionCatalogo: null,
  catalogoResultados: [],
  titularPadron: null,
  padronSincronizado: false,
  condominio: null
};

const MODALIDADES_CONDOMINIO_UI = {
  VERTICAL: { codigo: "VERTICAL", nombre: "Vertical", desc: "Unidades en pisos (edificio, torre)." },
  HORIZONTAL: { codigo: "HORIZONTAL", nombre: "Horizontal", desc: "Unidades contiguas en fila (townhouses)." }
};

function extraerPersonaApi(data) {
  if (!data || typeof data !== "object") return null;
  return data.propietario || data.persona || (data.id_persona ? data : null);
}

function normalizarTextoPersonaInput(valor) {
  return String(valor || "").replace(/\s+/g, " ").toUpperCase();
}

function normalizarPersonaCatalogo(valor) {
  return normalizarTextoPersonaInput(valor).trim();
}

function nombreCompletoDesdeFormularioCoprop() {
  const tipo = document.getElementById("copropTipoPersona")?.value || "FISICA";
  if (tipo === "MORAL") {
    return normalizarPersonaCatalogo(document.getElementById("copropRazonSocial")?.value);
  }
  return [
    document.getElementById("copropApellidoPaterno")?.value,
    document.getElementById("copropApellidoMaterno")?.value,
    document.getElementById("copropNombres")?.value
  ].map(v => normalizarPersonaCatalogo(v)).filter(Boolean).join(" ");
}

function actualizarVistaNombreCompletoCoprop() {
  const destino = document.getElementById("copropNombreCompletoPreview");
  if (!destino) return;
  destino.value = nombreCompletoDesdeFormularioCoprop();
}

let copropCatalogoTimer = null;
let copropBuscarCatalogoTimer = null;

function renderSugerenciasCatalogo(contenedorId, valores, campoId, modo = "reemplazar") {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  if (!valores?.length) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML = valores.map(v => `
    <button type="button" class="coprop-sug-item" data-campo="${escapeHtml(campoId)}" data-modo="${escapeHtml(modo)}" data-valor="${escapeHtml(v)}">${escapeHtml(v)}</button>
  `).join("");
  cont.querySelectorAll(".coprop-sug-item").forEach(btn => {
    btn.addEventListener("click", () => {
      aplicarSugerenciaCatalogoCoprop(btn.dataset.campo, btn.dataset.valor, btn.dataset.modo);
    });
  });
}

function aplicarSugerenciaCatalogoCoprop(campoId, valor, modo = "reemplazar") {
  const el = document.getElementById(campoId);
  if (!el) return;
  if (modo === "agregar") {
    const partes = normalizarTextoPersonaInput(el.value).split(" ").filter(Boolean);
    if (!partes.length) el.value = valor;
    else {
      partes[partes.length - 1] = valor;
      el.value = partes.join(" ");
    }
  } else {
    el.value = valor;
  }
  document.querySelectorAll(".coprop-sugerencias").forEach(n => n.innerHTML = "");
  actualizarVistaNombreCompletoCoprop();
}

async function buscarCatalogoApellidosCoprop(tipo, valor) {
  const contId = tipo === "materno" ? "copropSugApMat" : "copropSugApPat";
  const campoId = tipo === "materno" ? "copropApellidoMaterno" : "copropApellidoPaterno";
  const texto = normalizarTextoPersonaInput(valor);
  actualizarVistaNombreCompletoCoprop();
  clearTimeout(copropCatalogoTimer);
  if (texto.length < 2) {
    renderSugerenciasCatalogo(contId, [], campoId);
    return;
  }
  copropCatalogoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/propietarios/catalogo/apellidos?q=${encodeURIComponent(texto)}&tipo=${encodeURIComponent(tipo)}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo consultar apellidos."));
      renderSugerenciasCatalogo(contId, data.valores || [], campoId, "reemplazar");
    } catch (e) {
      renderSugerenciasCatalogo(contId, [], campoId);
    }
  }, 220);
}

async function buscarCatalogoNombresCoprop(valor) {
  const texto = normalizarTextoPersonaInput(valor);
  actualizarVistaNombreCompletoCoprop();
  clearTimeout(copropCatalogoTimer);
  if (texto.length < 2) {
    renderSugerenciasCatalogo("copropSugNombres", [], "copropNombres");
    return;
  }
  const token = texto.split(" ").pop() || texto;
  copropCatalogoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/propietarios/catalogo/nombres?q=${encodeURIComponent(token)}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo consultar nombres."));
      renderSugerenciasCatalogo("copropSugNombres", data.valores || [], "copropNombres", "agregar");
    } catch (e) {
      renderSugerenciasCatalogo("copropSugNombres", [], "copropNombres");
    }
  }, 220);
}

async function buscarCatalogoRazonSocialCoprop(valor) {
  const texto = normalizarTextoPersonaInput(valor);
  actualizarVistaNombreCompletoCoprop();
  clearTimeout(copropCatalogoTimer);
  if (texto.length < 2) {
    renderSugerenciasCatalogo("copropSugRazon", [], "copropRazonSocial");
    return;
  }
  copropCatalogoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/propietarios/catalogo/razones-sociales?q=${encodeURIComponent(texto)}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo consultar razones sociales."));
      renderSugerenciasCatalogo("copropSugRazon", data.valores || [], "copropRazonSocial", "reemplazar");
    } catch (e) {
      renderSugerenciasCatalogo("copropSugRazon", [], "copropRazonSocial");
    }
  }, 220);
}

function configurarEntradasPersonaCoprop(modal) {
  const camposNombre = [
    { id: "copropApellidoPaterno", fn: v => buscarCatalogoApellidosCoprop("paterno", v) },
    { id: "copropApellidoMaterno", fn: v => buscarCatalogoApellidosCoprop("materno", v) },
    { id: "copropNombres", fn: buscarCatalogoNombresCoprop },
    { id: "copropRazonSocial", fn: buscarCatalogoRazonSocialCoprop }
  ];

  camposNombre.forEach(({ id, fn }) => {
    const el = modal.querySelector(`#${id}`);
    if (!el) return;
    el.addEventListener("input", () => {
      el.value = normalizarTextoPersonaInput(el.value);
      fn(el.value);
    });
    el.addEventListener("blur", () => {
      el.value = normalizarPersonaCatalogo(el.value);
      actualizarVistaNombreCompletoCoprop();
    });
  });

  ["copropRFC", "copropCURP"].forEach(id => {
    const el = modal.querySelector(`#${id}`);
    if (!el) return;
    el.addEventListener("input", () => { el.value = normalizarPersonaCatalogo(el.value); });
  });

  const buscar = modal.querySelector("#copropBuscarTexto");
  if (buscar) {
    buscar.addEventListener("input", () => {
      buscar.value = normalizarTextoPersonaInput(buscar.value);
      if (copropBuscarCatalogoTimer) clearTimeout(copropBuscarCatalogoTimer);
      const texto = normalizarPersonaCatalogo(buscar.value);
      if (texto.length >= 2) {
        copropBuscarCatalogoTimer = setTimeout(() => buscarPropietariosCatalogo(), 400);
      }
    });
  }
}

function idsCatalogoPropietario(ctx) {
  if (ctx === "cambioNombre") {
    return {
      buscar: "modalMovBuscarTexto",
      tipo: "modalMovTipoPersona",
      paterno: "modalMovPrimerApellido",
      materno: "modalMovSegundoApellido",
      nombre: "modalMovNombres",
      razon: "modalMovRazonSocial",
      rfc: "modalMovRFC",
      curp: "modalMovCURP"
    };
  }
  return {
    buscar: "copropBuscarTexto",
    tipo: "copropTipoPersona",
    paterno: "copropApellidoPaterno",
    materno: "copropApellidoMaterno",
    nombre: "copropNombres",
    razon: "copropRazonSocial",
    rfc: "copropRFC",
    curp: "copropCURP"
  };
}

function obtenerCriteriosBusquedaCatalogo(ctx) {
  const ids = idsCatalogoPropietario(ctx || "coprop");
  const val = (id) => normalizarPersonaCatalogo(document.getElementById(id)?.value);
  const qCampo = val(ids.buscar);
  const paterno = val(ids.paterno);
  const materno = val(ids.materno);
  const nombre = val(ids.nombre);
  const razonSocial = val(ids.razon);
  const rfc = val(ids.rfc);
  const curp = val(ids.curp);
  const tipo = document.getElementById(ids.tipo)?.value || "FISICA";

  if (qCampo) {
    if (tipo === "MORAL") {
      return { q: "", paterno: "", materno: "", nombre: "", razon_social: qCampo, rfc: "", curp: "", tipo };
    }
    return { q: qCampo, paterno: "", materno: "", nombre: "", razon_social: "", rfc: "", curp: "", tipo };
  }
  if (rfc) {
    return { q: rfc, paterno: "", materno: "", nombre: "", razon_social: "", rfc: "", curp: "", tipo };
  }
  if (curp) {
    return { q: curp, paterno: "", materno: "", nombre: "", razon_social: "", rfc: "", curp: "", tipo };
  }
  if (tipo === "MORAL" && razonSocial) {
    return { q: "", paterno: "", materno: "", nombre: "", razon_social: razonSocial, rfc: "", curp: "", tipo };
  }
  if (paterno || materno || nombre) {
    return { q: "", paterno, materno, nombre, razon_social: "", rfc: "", curp: "", tipo };
  }
  if (razonSocial) {
    return { q: "", paterno: "", materno: "", nombre: "", razon_social: razonSocial, rfc: "", curp: "", tipo };
  }
  return null;
}

function obtenerTextoBusquedaCatalogoPropietarios(ctx) {
  const criterios = obtenerCriteriosBusquedaCatalogo(ctx || "coprop");
  if (!criterios) return "";
  if (criterios.q) return criterios.q;
  if (criterios.razon_social) return criterios.razon_social;
  return [criterios.paterno, criterios.materno, criterios.nombre].filter(Boolean).join(" ");
}

function esResultadoMoral(p) {
  return String(p?.tipo_persona || "").toUpperCase() === "MORAL" || !!p?.razon_social;
}

function desplazarResultadosCatalogo(destino) {
  const el = document.getElementById("copropResultadosScroll");
  if (!el) return;
  const paso = Math.max(el.clientHeight * 0.75, 100);
  if (destino === "arriba") el.scrollTop -= paso;
  else if (destino === "abajo") el.scrollTop += paso;
  else if (destino === "inicio") el.scrollTop = 0;
  else if (destino === "fin") el.scrollTop = el.scrollHeight;
}

function columnasPersonaResultado(p) {
  if (String(p?.tipo_persona || "").toUpperCase() === "MORAL") {
    return {
      paterno: "",
      materno: "",
      nombres: normalizarPersonaCatalogo(p.razon_social || p.nombre_completo || p.nombre)
    };
  }
  if (p?.apellido_paterno || p?.apellido_materno || p?.nombre) {
    return {
      paterno: normalizarPersonaCatalogo(p.apellido_paterno),
      materno: normalizarPersonaCatalogo(p.apellido_materno),
      nombres: normalizarPersonaCatalogo(p.nombre)
    };
  }
  const partes = String(p?.nombre_completo || "").split(" ").filter(Boolean);
  if (partes.length >= 3) {
    return {
      paterno: partes[0],
      materno: partes[1],
      nombres: partes.slice(2).join(" ")
    };
  }
  if (partes.length === 2) {
    return { paterno: partes[0], materno: "", nombres: partes[1] };
  }
  return { paterno: partes[0] || "", materno: "", nombres: "" };
}

function coincideTitularPredioPadron(p) {
  const tit = normalizarPersonaCatalogo(copropEstado.titularPadron);
  if (!tit) return false;
  const nom = normalizarPersonaCatalogo(nombrePersonaCatalogo(p));
  return nom === tit || nom.includes(tit) || tit.includes(nom);
}

function etiquetaModalidadCondominio(modalidad) {
  const key = String(modalidad || "").toUpperCase();
  return MODALIDADES_CONDOMINIO_UI[key] || null;
}

function renderCondominioInfoCoprop(data = null) {
  const box = document.getElementById("copropCondominioInfo");
  if (!box) return;

  const info = data?.condominio || copropEstado.condominio;
  if (!info || !info.en_padron) {
    box.innerHTML = "";
    return;
  }

  const regimenPadron = info.regimen_padron || info.regimen || {};
  const regimenEfectivo = info.regimen || regimenPadron;
  const tipoPadron = String(regimenPadron.tipo || "NULL").toUpperCase();
  const tipoPadronUi = etiquetaTipoCondominio(tipoPadron);
  const tipoEfectivo = String(regimenEfectivo.tipo || tipoPadron).toUpperCase();
  const tipoEfectivoUi = etiquetaTipoCondominio(tipoEfectivo);
  const esCondominio = !!info.en_regimen_condominio;
  const porCatastro = !!info.condominio_por_catastro;
  const modalidadActual = info.modalidad || "";
  const modalidadUi = info.modalidad_etiqueta || etiquetaModalidadCondominio(modalidadActual);
  const sugerencia = info.sugerencia_modalidad || "";
  const sugerenciaUi = info.sugerencia_modalidad_etiqueta || etiquetaModalidadCondominio(sugerencia);
  const unidades = Array.isArray(info.unidades_relacionadas) ? info.unidades_relacionadas : [];
  const claveActual = copropEstado.clave || info.clave_catastral || "";
  const nombreActual = info.nombre_condominio || "";
  const tieneClasifCatastro = !!(modalidadActual || nombreActual);

  const badgeRegimen = esCondominio
    ? `<span class="coprop-cond-badge condo">Condominio (${escapeHtml(regimenEfectivo.tipo_codigo || "C")})${porCatastro ? " · catastro" : ""}</span>`
    : `<span class="coprop-cond-badge normal">${escapeHtml(tipoPadronUi.nombre)}</span>`;

  const tenenciaActual = TIPOS_TENENCIA_UI[tipoPadron]
    ? tipoPadron
    : (String(regimenPadron.valor_padron || regimenPadron.tipo_codigo || "P").toUpperCase());
  const opcionesTenencia = htmlOpcionesTenenciaPadron(tenenciaActual, false);

  const avisoPadronHtml = porCatastro && tenenciaActual !== "C"
    ? `<div class="coprop-cond-info">Catastro tiene clasificación vertical/horizontal; el padrón indica <b>${escapeHtml(tipoPadronUi.nombre)}</b>.</div>`
    : !esCondominio && !tieneClasifCatastro && tenenciaActual === "C"
      ? `<div class="coprop-cond-aviso">Tenencia <b>Condominio (C)</b>. Defina vertical u horizontal en catastro.</div>`
      : "";

  const opcionesModalidad = [
    `<option value="">Sin clasificar</option>`,
    ...Object.values(MODALIDADES_CONDOMINIO_UI).map(m =>
      `<option value="${m.codigo}"${modalidadActual === m.codigo ? " selected" : ""}>${escapeHtml(m.nombre)}</option>`
    )
  ].join("");

  const sugerenciaHtml = !modalidadActual && sugerencia && sugerenciaUi
    ? `<div class="coprop-cond-sugerencia">
        Sugerencia: <b>${escapeHtml(sugerenciaUi.nombre)}</b> — ${escapeHtml(sugerenciaUi.desc)}
        ${unidades.length ? ` (${unidades.length + 1} unidades con mismo domicilio en padrón).` : "."}
        <button type="button" class="coprop-btn sec" style="margin-left:6px;font-size:11px;padding:3px 8px;" onclick="aplicarSugerenciaModalidadCondominio('${escapeHtml(sugerencia)}')">Aplicar sugerencia</button>
      </div>`
    : "";

  const unidadesHtml = unidades.length
    ? `<div class="coprop-cond-unidades">
        <div class="coprop-cond-unidades-tit">Unidades relacionadas (${unidades.length + 1} en total)</div>
        <div class="coprop-cond-chips">
          <span class="coprop-cond-chip activo">${escapeHtml(claveActual)} · actual</span>
          ${unidades.map(u => {
            const mod = u.modalidad ? etiquetaModalidadCondominio(u.modalidad)?.nombre : "";
            const extra = mod ? ` · ${mod}` : "";
            return `<button type="button" class="coprop-cond-chip" onclick="abrirModalCopropietarios('${escapeHtml(u.clave_catastral)}')" title="Abrir copropietarios">${escapeHtml(u.clave_catastral)}${escapeHtml(extra)}</button>`;
          }).join("")}
        </div>
      </div>`
    : "";

  const clasificacionHtml = `<div class="coprop-cond-clasif">
        ${avisoPadronHtml}
        <label for="copropTenenciaPadron"><b>Tipo de tenencia</b></label>
        <div class="coprop-row" style="margin-bottom:6px;flex-wrap:wrap;">
          <select id="copropTenenciaPadron" onchange="toggleCopropTenenciaCondominio()">${opcionesTenencia}</select>
          <button type="button" class="coprop-btn ok" onclick="guardarTenenciaPredio()">Guardar tenencia</button>
        </div>
        <div id="copropBloqueCondominioC" class="${tenenciaActual === "C" || tieneClasifCatastro ? "" : "oculto"}">
        <label for="copropNombreCondominio"><b>Nombre del condominio</b></label>
        <div class="coprop-row" style="margin-bottom:6px;">
          <input id="copropNombreCondominio" type="text" list="copropNombresCondominioLista" placeholder="EJ: TORRES DEL MAR, CONDOMINIO CETYS..." value="${escapeHtml(nombreActual)}">
        </div>
        <datalist id="copropNombresCondominioLista"></datalist>
        <label for="copropModalidadCondominio"><b>Tipo de condominio</b></label>
        <div class="coprop-row" style="margin-bottom:4px;">
          <select id="copropModalidadCondominio">${opcionesModalidad}</select>
          <button type="button" class="coprop-btn ok" onclick="guardarClasificacionCondominioPredio()">Guardar clasificación</button>
        </div>
        ${unidades.length ? `<label class="coprop-cond-propagar"><input type="checkbox" id="copropPropagarGrupo" checked> Al guardar, aplicar también a las ${unidades.length} unidad(es) relacionadas del mismo domicilio</label>` : ""}
        <div class="coprop-row" style="margin-bottom:4px;flex-wrap:wrap;">
          <button type="button" class="coprop-btn sec" onclick="abrirClasificacionCondominioMasivaDesdeCoprop()">Clasificación masiva…</button>
        </div>
        <small>${modalidadUi ? `Clasificado como <b>${escapeHtml(modalidadUi.nombre)}</b>.` : "Defina vertical u horizontal para aplicar reglas distintas en catastro."}${nombreActual ? ` · Nombre: <b>${escapeHtml(nombreActual)}</b>` : ""}</small>
        ${sugerenciaHtml}
        </div>
      </div>`;

  box.innerHTML = `
    <div class="coprop-cond-panel">
      <div class="coprop-cond-head">
        <span>Régimen / condominio</span>
        ${badgeRegimen}
      </div>
      <div class="coprop-cond-detalle">
        <div><b>Tipo de tenencia (padrón):</b> ${escapeHtml(tipoPadronUi.nombre)} (${escapeHtml(tenenciaActual)}) — ${escapeHtml(regimenPadron.tipo_descripcion || tipoPadronUi.desc || "")}</div>
        <div><b>Régimen catastro:</b> ${escapeHtml(tipoEfectivoUi.nombre)} (${escapeHtml(regimenEfectivo.tipo_codigo || "—")})${modalidadUi ? ` · ${escapeHtml(modalidadUi.nombre)}` : ""}${nombreActual ? ` · ${escapeHtml(nombreActual)}` : ""}</div>
        ${info.grupo_domicilio ? `<div><b>Domicilio padrón:</b> ${escapeHtml(info.grupo_domicilio)}</div>` : ""}
      </div>
      ${clasificacionHtml}
      ${unidadesHtml}
      <div id="copropMsgCondominio" class="coprop-msg"></div>
    </div>
  `;
  cargarSugerenciasNombreCondominio();
}

async function cargarSugerenciasNombreCondominio() {
  const list = document.getElementById("copropNombresCondominioLista");
  const datalistMasivo = document.getElementById("clasifMasivaNombresLista");
  if (!list && !datalistMasivo) return;
  try {
    const r = await fetch(`${API}/condominios/nombres?limite=100&_=${Date.now()}`, { headers: authHeaders() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const opts = (data.nombres || []).map(n =>
      `<option value="${escapeHtml(n.nombre_condominio || "")}"></option>`
    ).join("");
    if (list) list.innerHTML = opts;
    if (datalistMasivo) datalistMasivo.innerHTML = opts;
  } catch (_) { /* noop */ }
}

async function guardarTenenciaPredio() {
  const clave = copropEstado.clave;
  if (!clave) return;
  const tenencia = document.getElementById("copropTenenciaPadron")?.value || "";
  if (!tenencia) {
    msgCoprop("copropMsgCondominio", "Seleccione un tipo de tenencia.", false);
    return;
  }
  const etiq = etiquetaTipoCondominio(tenencia).nombre;
  if (!confirm(`¿Asignar tenencia ${etiq} (${tenencia}) al predio ${clave}?`)) return;
  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/tenencia`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ tenencia, confirmar: true })
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 404) {
      throw new Error("Endpoint de tenencia no disponible en el servidor. Actualice propietarios.py y padron.py y reinicie catastro-api.");
    }
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo guardar la tenencia."));
    msgCoprop("copropMsgCondominio", data.mensaje || "Tenencia actualizada.", true);
    if (data.condominio) {
      copropEstado.condominio = data.condominio;
      renderCondominioInfoCoprop({ condominio: data.condominio });
    } else {
      await cargarCopropietariosPredio(clave);
    }
  } catch (e) {
    msgCoprop("copropMsgCondominio", e.message || "Error al guardar tenencia.", false);
  }
}
window.guardarTenenciaPredio = guardarTenenciaPredio;

function toggleCopropTenenciaCondominio() {
  const val = document.getElementById("copropTenenciaPadron")?.value || "";
  document.getElementById("copropBloqueCondominioC")?.classList.toggle("oculto", val !== "C");
}
window.toggleCopropTenenciaCondominio = toggleCopropTenenciaCondominio;

async function guardarClasificacionCondominioPredio() {
  const clave = copropEstado.clave;
  if (!clave) return;
  const modalidad = document.getElementById("copropModalidadCondominio")?.value || "";
  const nombre_condominio = document.getElementById("copropNombreCondominio")?.value?.trim() || "";
  const propagar_grupo = document.getElementById("copropPropagarGrupo")?.checked !== false;
  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/condominio`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        modalidad: modalidad || null,
        nombre_condominio: nombre_condominio || null,
        propagar_grupo
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo guardar la clasificación."));
    copropEstado.condominio = data.condominio || null;
    renderCondominioInfoCoprop({ condominio: copropEstado.condominio });
    msgCoprop("copropMsgCondominio", data.mensaje || "Clasificación guardada.", true);
  } catch (e) {
    msgCoprop("copropMsgCondominio", e.message || "Error al guardar clasificación.", false);
  }
}

async function guardarModalidadCondominioPredio() {
  return guardarClasificacionCondominioPredio();
}

async function aplicarClasificacionGrupoCoprop() {
  const info = copropEstado.condominio;
  if (!info) return;
  const claveActual = copropEstado.clave;
  const relacionadas = (info.unidades_relacionadas || []).map(u => u.clave_catastral).filter(Boolean);
  const claves = [claveActual, ...relacionadas].filter(Boolean);
  if (claves.length <= 1) {
    alert("No hay otras unidades relacionadas en el mismo domicilio.");
    return;
  }
  const modalidad = document.getElementById("copropModalidadCondominio")?.value || "";
  const nombre_condominio = document.getElementById("copropNombreCondominio")?.value?.trim() || "";
  if (!modalidad && !nombre_condominio) {
    alert("Capture modalidad y/o nombre de condominio antes de aplicar al grupo.");
    return;
  }
  if (!confirm(`¿Aplicar clasificación a ${claves.length} predios del mismo domicilio?`)) return;
  try {
    const body = { claves };
    if (modalidad) body.modalidad = modalidad;
    if (nombre_condominio) body.nombre_condominio = nombre_condominio;
    const r = await fetch(`${API}/condominios/clasificacion/masiva`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo aplicar al grupo."));
    msgCoprop("copropMsgCondominio", data.mensaje || "Clasificación aplicada al grupo.", true);
    await cargarCopropietariosPredio(claveActual);
  } catch (e) {
    msgCoprop("copropMsgCondominio", e.message || "Error al aplicar al grupo.", false);
  }
}

function aplicarSugerenciaModalidadCondominio(modalidad) {
  const sel = document.getElementById("copropModalidadCondominio");
  if (sel) sel.value = modalidad || "";
  guardarClasificacionCondominioPredio();
}

function renderPadronInfoCoprop(data = null) {
  const box = document.getElementById("copropPadronInfo");
  if (!box) return;

  const titular = data?.titular_padron || copropEstado.titularPadron;
  if (!titular) {
    box.innerHTML = "";
    return;
  }

  const ok = data?.padron_sincronizado ?? copropEstado.padronSincronizado;
  if (ok) {
    box.innerHTML = `<div class="coprop-padron-ok">✓ Titular en padrón: ${escapeHtml(titular)}</div>`;
    return;
  }

  const vacio = !(copropEstado.propietarios || []).length;
  box.innerHTML = `
    <div class="coprop-padron-alerta">
      <div><b>Titular en padrón:</b> ${escapeHtml(titular)}</div>
      <small>${vacio ? "Aún no está registrado en catastro para este predio." : "Difiere de los titulares registrados a la izquierda."}</small>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="coprop-btn ok" style="font-size:11px;padding:4px 8px;" onclick="sincronizarTitularDesdePadron()">Aplicar a este predio</button>
        <button type="button" class="coprop-btn sec" style="font-size:11px;padding:4px 8px;" onclick="aplicarTitularPadronMasivo()" title="Asigna el titular del padrón a todos los predios que aún no tienen propietario en el catálogo">Aplicar a TODOS los pendientes…</button>
      </div>
    </div>
  `;
}

// Confirmación propia (no usa window.confirm, que Chrome bloquea cuando se invoca
// después de un await). Devuelve Promise<boolean> resuelta por el clic del usuario.
function mostrarConfirmacionAsync(titulo, mensajeHtml, opciones = {}) {
  const textoOk = opciones.textoOk || "Continuar";
  const textoCancel = opciones.textoCancel || "Cancelar";
  const soloInfo = !!opciones.soloInfo;
  return new Promise((resolve) => {
    const previo = document.getElementById("confirmAsyncOverlay");
    if (previo) previo.remove();
    const overlay = document.createElement("div");
    overlay.id = "confirmAsyncOverlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;";
    overlay.innerHTML = `
      <div style="background:#fff;max-width:540px;width:92%;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.35);overflow:hidden;">
        <div style="background:#7a1f2b;color:#fff;padding:10px 14px;font-weight:bold;font-size:14px;">${escapeHtml(titulo)}</div>
        <div style="padding:14px;max-height:55vh;overflow:auto;font-size:13px;color:#222;line-height:1.45;">${mensajeHtml}</div>
        <div style="padding:10px 14px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #eee;">
          ${soloInfo ? "" : `<button type="button" id="confirmAsyncCancel" class="coprop-btn sec">${escapeHtml(textoCancel)}</button>`}
          <button type="button" id="confirmAsyncOk" class="coprop-btn ok">${escapeHtml(soloInfo ? "Aceptar" : textoOk)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector("#confirmAsyncOk").onclick = () => cerrar(true);
    const btnCancel = overlay.querySelector("#confirmAsyncCancel");
    if (btnCancel) btnCancel.onclick = () => cerrar(false);
    overlay.onclick = (e) => { if (e.target === overlay) cerrar(soloInfo ? true : false); };
  });
}
window.mostrarConfirmacionAsync = mostrarConfirmacionAsync;

async function aplicarTitularPadronMasivo() {
  if (!puedeEditarCatastro()) {
    await mostrarConfirmacionAsync("Sin permiso", "Su rol no tiene permiso para administrar titularidad.", { soloInfo: true });
    return;
  }

  try {
    // 1) Vista previa: cuántos predios se verían afectados.
    const rPrev = await fetch(`${API}/predios/propietarios/sincronizar-padron-masivo?confirmar=false&_=${Date.now()}`, {
      method: "POST",
      headers: authHeaders()
    });
    const prev = await rPrev.json().catch(() => ({}));
    if (!rPrev.ok) throw new Error(extraerMensajeApi(prev, "No se pudo obtener la vista previa."));

    const pendientes = Number(prev.pendientes || 0);
    if (!pendientes) {
      await mostrarConfirmacionAsync(
        "Sin pendientes",
        escapeHtml(prev.mensaje || "No hay predios pendientes: todos los predios con titular en el padrón ya tienen propietario en el catálogo."),
        { soloInfo: true }
      );
      return;
    }

    const muestra = (prev.muestra || [])
      .slice(0, 8)
      .map(m => `${escapeHtml(m.clave_catastral)} — ${escapeHtml(m.titular_padron)}`)
      .join("<br>");
    const procesara = Number(prev.procesara || pendientes);
    const msgHtml = [
      `Se asignará como titular (<b>propietario al 100%</b>) el nombre del padrón a <b>${formatoNumeroEntero(pendientes)}</b> predio(s) que aún <b>NO</b> tienen propietario en el catálogo.`,
      procesara < pendientes ? `<br><br>En esta ejecución se procesarán <b>${formatoNumeroEntero(procesara)}</b>; podrás repetir para continuar.` : "",
      muestra ? `<br><br><b>Ejemplos:</b><br>${muestra}` : "",
      `<br><br>Esta acción crea propietarios en el catálogo. ¿Desea continuar?`
    ].filter(Boolean).join("");

    const confirmado = await mostrarConfirmacionAsync("Aplicar titular del padrón a todos", msgHtml, {
      textoOk: "Sí, aplicar a todos",
      textoCancel: "Cancelar"
    });
    if (!confirmado) return;

    // 2) Aplicar por LOTES chicos para no exceder el timeout del proxy (evita 502).
    //    El backend procesa hasta ~1500 por petición y avisa con hay_mas si quedan más.
    const LOTE = 1500;
    const progreso = mostrarProgresoOverlay("Aplicando titular del padrón");
    let aplicadosTotal = 0;
    let sinResolverTotal = 0;
    let pasadas = 0;
    const MAX_PASADAS = 5000;
    let hayMas = true;
    let errorFatal = null;

    try {
      while (hayMas && pasadas < MAX_PASADAS) {
        pasadas++;
        let data;
        try {
          const r = await fetch(`${API}/predios/propietarios/sincronizar-padron-masivo?confirmar=true&limite=${LOTE}&_=${Date.now()}`, {
            method: "POST",
            headers: authHeaders()
          });
          data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(extraerMensajeApi(data, `Error HTTP ${r.status} al aplicar el lote.`));
        } catch (eLote) {
          // Un lote puede fallar puntualmente (p. ej. 502). Reintenta una vez antes de abortar.
          await new Promise(res => setTimeout(res, 1200));
          const r2 = await fetch(`${API}/predios/propietarios/sincronizar-padron-masivo?confirmar=true&limite=${LOTE}&_=${Date.now()}`, {
            method: "POST",
            headers: authHeaders()
          }).catch(() => null);
          if (!r2 || !r2.ok) { errorFatal = eLote; break; }
          data = await r2.json().catch(() => ({}));
        }

        aplicadosTotal += Number(data.aplicados || 0);
        sinResolverTotal += Number(data.sin_resolver || 0);
        hayMas = !!data.hay_mas;

        const pct = pendientes > 0 ? Math.min(100, Math.round((aplicadosTotal / pendientes) * 100)) : 100;
        progreso.update(
          `Procesados <b>${formatoNumeroEntero(aplicadosTotal)}</b> de ~${formatoNumeroEntero(pendientes)} predio(s) (${pct}%).` +
          `<br><br><div style="background:#eee;border-radius:6px;height:14px;overflow:hidden;"><div style="background:#2e7d32;height:100%;width:${pct}%;transition:width .2s;"></div></div>` +
          `<br><small>No cierres esta ventana. Lote ${formatoNumeroEntero(pasadas)}.</small>`
        );

        // Corte de seguridad: si un lote no aplicó NADA, ya no hay progreso posible
        // (quedan solo predios con conflicto irresoluble). Terminamos para no ciclar.
        if (Number(data.aplicados || 0) === 0) break;
      }
    } finally {
      progreso.close();
    }

    if (errorFatal) {
      await mostrarConfirmacionAsync(
        "Proceso interrumpido",
        `Se alcanzó a aplicar el titular del padrón a <b>${formatoNumeroEntero(aplicadosTotal)}</b> predio(s) antes de un error de red.` +
        `<br><br>${escapeHtml(errorFatal.message || "Error de conexión")}<br><br>Puedes volver a ejecutar para continuar con los restantes.`,
        { soloInfo: true }
      );
    } else {
      await mostrarConfirmacionAsync(
        "Proceso terminado",
        `Se aplicó el titular del padrón a <b>${formatoNumeroEntero(aplicadosTotal)}</b> predio(s).` +
        (sinResolverTotal > 0 ? `<br><br><b>${formatoNumeroEntero(sinResolverTotal)}</b> no se pudieron resolver (nombre vacío o inválido en el padrón).` : ""),
        { soloInfo: true }
      );
    }

    if (copropEstado.clave) {
      await cargarCopropietariosPredio(copropEstado.clave);
      await refrescarVistaPredioActivo(copropEstado.clave);
    }
  } catch (e) {
    await mostrarConfirmacionAsync("Error", escapeHtml(e.message || "Error al aplicar el titular del padrón de forma masiva."), { soloInfo: true });
  }
}
window.aplicarTitularPadronMasivo = aplicarTitularPadronMasivo;

// Overlay de progreso NO bloqueante (sin botones); se actualiza por código.
function mostrarProgresoOverlay(titulo) {
  const previo = document.getElementById("progresoOverlay");
  if (previo) previo.remove();
  const overlay = document.createElement("div");
  overlay.id = "progresoOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:#fff;max-width:480px;width:90%;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.35);overflow:hidden;">
      <div style="background:#7a1f2b;color:#fff;padding:10px 14px;font-weight:bold;font-size:14px;">${escapeHtml(titulo)}</div>
      <div id="progresoOverlayBody" style="padding:16px;font-size:13px;color:#222;line-height:1.45;">Iniciando…</div>
    </div>`;
  document.body.appendChild(overlay);
  return {
    update(html) {
      const body = document.getElementById("progresoOverlayBody");
      if (body) body.innerHTML = html;
    },
    close() {
      const el = document.getElementById("progresoOverlay");
      if (el) el.remove();
    }
  };
}
window.mostrarProgresoOverlay = mostrarProgresoOverlay;

async function sincronizarTitularDesdePadron(reemplazar = false) {
  const clave = copropEstado.clave;
  if (!clave) return;

  try {
    const params = new URLSearchParams({
      reemplazar: reemplazar ? "true" : "false",
      _: String(Date.now())
    });
    const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/propietarios/sincronizar-padron?${params.toString()}`, {
      method: "POST",
      headers: authHeaders()
    });
    const data = await r.json().catch(() => ({}));

    if (r.status === 409) {
      if (confirm(`${extraerMensajeApi(data, "El predio ya tiene titulares distintos.")}\n\n¿Reemplazar por el titular del padrón al 100%?`)) {
        await sincronizarTitularDesdePadron(true);
      }
      return;
    }
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo sincronizar titular del padrón."));

    msgCoprop("copropMsgPredio", data.mensaje || "Titular del padrón aplicado.", true);
    await cargarCopropietariosPredio(clave);
    await refrescarVistaPredioActivo(clave);
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al sincronizar titular del padrón.", false);
  }
}

function renderResultadosCatalogoCoprop(resultados, meta = {}) {
  const cont = document.getElementById("copropResultadosCatalogo");
  if (!cont) return;

  if (!resultados.length) {
    cont.innerHTML = `<div class="coprop-item">Sin resultados en catálogo ni padrón. Puedes crear un nuevo propietario abajo.</div>`;
    return;
  }

  const criterios = obtenerCriteriosBusquedaCatalogo("coprop");
  const modoMoral = criterios?.tipo === "MORAL" || !!criterios?.razon_social;
  const totalPadron = Number(meta.total_padron || 0);
  const truncado = !!meta.truncado;
  const pie = truncado && totalPadron > resultados.length
    ? `Mostrando ${resultados.length} de ${totalPadron} en el padrón. Refine la búsqueda. La columna izquierda muestra titulares YA ASIGNADOS a este predio.`
    : `${resultados.length} resultado(s). Click en fila para agregar. Use ▲▼ para desplazarse. La izquierda = titulares de ESTE predio.`;

  const filas = resultados.map((p, idx) => {
    const origen = p.origen === "padron" || !p.id_persona ? "Padrón" : "Catálogo";
    const badge = coincideTitularPredioPadron(p) ? `<span class="coprop-badge-predio">Este predio</span>` : "";
    if (modoMoral || esResultadoMoral(p)) {
      const razon = normalizarPersonaCatalogo(p.razon_social || p.nombre_completo || nombrePersonaCatalogo(p));
      return `
        <tr data-idx="${idx}" onclick="seleccionarResultadoCatalogoCoprop(${idx})" title="Click para agregar al predio">
          <td colspan="3">${escapeHtml(razon || "—")}${badge}</td>
          <td><span class="coprop-origen">${escapeHtml(origen)}</span></td>
        </tr>
      `;
    }
    const cols = columnasPersonaResultado(p);
    return `
      <tr data-idx="${idx}" onclick="seleccionarResultadoCatalogoCoprop(${idx})" title="Click para agregar al predio">
        <td>${escapeHtml(cols.paterno || "—")}</td>
        <td>${escapeHtml(cols.materno || "—")}</td>
        <td>${escapeHtml(cols.nombres || "—")}${badge}</td>
        <td><span class="coprop-origen">${escapeHtml(origen)}</span></td>
      </tr>
    `;
  }).join("");

  const encabezado = modoMoral
    ? `<tr><th colspan="3">Razón social</th><th>Origen</th></tr>`
    : `<tr><th>Paterno</th><th>Materno</th><th>Nombre(s)</th><th>Origen</th></tr>`;

  cont.innerHTML = `
    <div class="coprop-resultados-head">Resultados · click para escoger y agregar al predio</div>
    <div class="coprop-resultados-wrap">
      <div id="copropResultadosScroll" class="coprop-lista-scroll">
        <table class="coprop-table coprop-tabla-resultados">
          <thead>${encabezado}</thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="coprop-scroll-nav" aria-label="Desplazamiento de resultados">
        <button type="button" class="coprop-scroll-btn" onclick="desplazarResultadosCatalogo('inicio')" title="Ir al inicio">⤒</button>
        <button type="button" class="coprop-scroll-btn" onclick="desplazarResultadosCatalogo('arriba')" title="Subir">▲</button>
        <button type="button" class="coprop-scroll-btn" onclick="desplazarResultadosCatalogo('abajo')" title="Bajar">▼</button>
        <button type="button" class="coprop-scroll-btn" onclick="desplazarResultadosCatalogo('fin')" title="Ir al final">⤓</button>
      </div>
    </div>
    <div class="coprop-resultados-pie">${escapeHtml(pie)}</div>
  `;
}

function nombrePersonaCatalogo(p) {
  if (!p) return "";
  if (String(p.tipo_persona || "").toUpperCase() === "MORAL") {
    return normalizarPersonaCatalogo(p.razon_social || p.nombre_completo || p.nombre);
  }
  return normalizarPersonaCatalogo(
    p.nombre_completo ||
    [p.apellido_paterno, p.apellido_materno, p.nombre].filter(Boolean).join(" ") ||
    p.nombre
  );
}

function porcentajeDefaultNuevoCopropietario() {
  const nActual = Array.isArray(copropEstado.propietarios) ? copropEstado.propietarios.length : 0;
  const n = nActual + 1;
  if (n <= 1) return 100;
  const base = Math.floor((100 / n) * 100) / 100;
  return Number(base.toFixed(2));
}

function sumaCopropiedadLocal() {
  return (copropEstado.propietarios || []).reduce((s, p) => s + Number(p.porcentaje_propiedad || 0), 0);
}

function asegurarModalCopropietarios() {
  const versionModal = "v50";
  const existente = document.getElementById("modalCopropietarios");
  if (existente && existente.dataset.version !== versionModal) {
    existente.remove();
  }
  if (document.getElementById("modalCopropietarios")) return;

  const style = document.createElement("style");
  style.textContent = `
    .coprop-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;}
    .coprop-overlay.oculto{display:none;}
    .coprop-modal{width:min(1080px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 45px rgba(0,0,0,.35);border:3px solid #703341;}
    .coprop-head{background:#703341;color:white;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;}
    .coprop-head h3{margin:0;font-size:17px;flex:1;min-width:0;}
    .coprop-overlay button{width:auto;margin-bottom:0;}
    .coprop-close-btn{
      width:30px!important;min-width:30px!important;height:30px!important;padding:0!important;
      margin:0!important;border-radius:50%!important;background:#fff!important;color:#703341!important;
      border:2px solid #fff!important;font-size:20px!important;font-weight:bold!important;line-height:1!important;
      box-shadow:0 2px 10px rgba(0,0,0,.28)!important;cursor:pointer!important;flex-shrink:0!important;
      display:inline-flex!important;align-items:center;justify-content:center;
    }
    .coprop-close-btn:hover{background:#ffe4e6!important;color:#b91c1c!important;border-color:#fecdd3!important;}
    .coprop-acciones-predio{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px;}
    .coprop-acciones-predio .coprop-btn{font-size:12px;padding:6px 10px;}
    .coprop-padron-ok{background:#ecfdf5;border:1px solid #86efac;color:#166534;border-radius:8px;padding:8px;font-size:11px;margin-bottom:8px;}
    .coprop-padron-alerta{background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:8px;padding:8px;font-size:11px;margin-bottom:8px;}
    .coprop-padron-alerta small{display:block;margin-top:3px;color:#7c2d12;}
    .coprop-badge-predio{display:inline-block;background:#15803d;color:#fff;border-radius:999px;padding:1px 6px;font-size:10px;margin-left:4px;}
    .coprop-body{padding:12px;display:grid;grid-template-columns:1.1fr .9fr;gap:12px;}
    .coprop-card{border:1px solid #d1d5db;border-radius:10px;padding:10px;background:#f8fafc;}
    .coprop-card h4{margin:0 0 8px;color:#703341;}
    .coprop-row{display:flex;gap:6px;align-items:center;margin-bottom:7px;}
    .coprop-row input,.coprop-row select{padding:6px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;}
    .coprop-row input{flex:1;}
    .coprop-btn{background:#703341;color:white;border:0;border-radius:7px;padding:7px 10px;cursor:pointer;font-weight:bold;}
    .coprop-btn.sec{background:#475569;}
    .coprop-btn.danger{background:#b91c1c;}
    .coprop-btn.ok{background:#15803d;}
    .coprop-table{width:100%;border-collapse:collapse;font-size:12px;background:white;}
    .coprop-table th{background:#703341;color:#fff;text-align:left;padding:6px;}
    .coprop-table td{border-bottom:1px solid #e5e7eb;padding:6px;vertical-align:middle;}
    .coprop-table input{width:75px;padding:4px;border:1px solid #cbd5e1;border-radius:5px;text-align:right;}
    .coprop-lista{max-height:360px;overflow:auto;border:1px solid #e5e7eb;background:white;border-radius:8px;}
    .coprop-lista-resultados{border:none;max-height:none;overflow:visible;}
    .coprop-resultados-wrap{display:flex;gap:6px;align-items:stretch;border:1px solid #e5e7eb;border-radius:8px;background:white;padding:4px;}
    .coprop-lista-scroll{flex:1;max-height:360px;overflow:auto;}
    .coprop-scroll-nav{display:flex;flex-direction:column;gap:4px;justify-content:center;padding:2px 0;}
    .coprop-scroll-btn{width:30px;min-width:30px;height:30px;padding:0;border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;cursor:pointer;font-size:13px;line-height:1;color:#334155;}
    .coprop-scroll-btn:hover{background:#e0ecff;border-color:#93c5fd;}
    .coprop-resultados-head{font-size:11px;font-weight:bold;color:#475569;margin:8px 0 6px;}
    .coprop-resultados-pie{font-size:11px;color:#64748b;margin-top:6px;}
    .coprop-tabla-resultados{margin:0;}
    .coprop-tabla-resultados tbody tr{cursor:pointer;}
    .coprop-tabla-resultados tbody tr:hover,.coprop-tabla-resultados tbody tr.activo{background:#e0ecff;}
    .coprop-tabla-resultados td{font-size:12px;}
    .coprop-origen{font-size:10px;color:#64748b;}
    .coprop-origen-leyenda{display:block;font-size:10px;color:#64748b;margin:4px 0 6px;line-height:1.35;}
    .coprop-item{padding:8px;border-bottom:1px solid #e5e7eb;cursor:pointer;}
    .coprop-item:hover,.coprop-item.activo{background:#e0ecff;}
    .coprop-item b{display:block;color:#111827;}
    .coprop-item small{color:#475569;}
    .coprop-total{padding:8px;border-radius:8px;margin-top:8px;font-weight:bold;}
    .coprop-total.ok{background:#dcfce7;color:#166534;border:1px solid #86efac;}
    .coprop-total.error{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;}
    .coprop-msg{min-height:18px;font-size:12px;margin-top:6px;font-weight:bold;}
    .coprop-msg.ok{color:#15803d;}.coprop-msg.error{color:#b91c1c;}
    .coprop-campo-catalogo{margin-bottom:8px;}
    .coprop-campo-catalogo label{display:block;font-size:11px;font-weight:bold;color:#475569;margin-bottom:4px;}
    .coprop-campo-catalogo small{display:block;font-size:10px;color:#64748b;margin-top:3px;}
    .coprop-sugerencias{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}
    .coprop-sug-item{background:#e0ecff;border:1px solid #93c5fd;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;cursor:pointer;}
    .coprop-sug-item:hover{background:#bfdbfe;}
    .coprop-preview-nombre{background:#f8fafc;font-weight:bold;}
    .coprop-cond-panel{background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:10px;margin-bottom:8px;font-size:11px;color:#1e3a8a;}
    .coprop-cond-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-weight:bold;color:#703341;}
    .coprop-cond-badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:bold;}
    .coprop-cond-badge.condo{background:#dcfce7;color:#166534;border:1px solid #86efac;}
    .coprop-cond-badge.normal{background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;}
    .coprop-cond-detalle{margin-bottom:8px;line-height:1.45;color:#334155;}
    .coprop-cond-clasif{margin-top:6px;padding-top:6px;border-top:1px dashed #bfdbfe;}
    .coprop-cond-nota{color:#64748b;font-style:italic;}
    .coprop-cond-sugerencia{margin-top:6px;background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:6px;color:#854d0e;}
    .coprop-cond-unidades{margin-top:8px;}
    .coprop-cond-unidades-tit{font-weight:bold;margin-bottom:4px;color:#475569;}
    .coprop-cond-chips{display:flex;flex-wrap:wrap;gap:4px;}
    .coprop-cond-chip{background:#fff;border:1px solid #cbd5e1;border-radius:999px;padding:2px 8px;font-size:10px;color:#334155;cursor:pointer;}
    .coprop-cond-chip.activo{background:#703341;color:#fff;border-color:#703341;cursor:default;}
    .coprop-cond-chip:hover:not(.activo){background:#e0ecff;border-color:#93c5fd;}
    .coprop-cond-propagar{display:block;margin:6px 0 4px;font-size:11px;color:#334155;}
    .coprop-cond-propagar input{margin-right:6px;vertical-align:middle;}
    .coprop-cond-aviso{background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:11px;line-height:1.4;}
    .coprop-cond-info{background:#ecfdf5;border:1px solid #86efac;color:#166534;border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:11px;line-height:1.4;}
    @media(max-width:900px){.coprop-body{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement("div");
  modal.id = "modalCopropietarios";
  modal.dataset.version = versionModal;
  modal.className = "coprop-overlay oculto";
  modal.innerHTML = `
    <div class="coprop-modal">
      <div class="coprop-head">
        <h3>👥 Propietarios y copropietarios del predio <span id="copropClaveHeader">---</span></h3>
        <button type="button" class="coprop-close-btn" onclick="cerrarModalCopropietariosConRefresh()" title="Cerrar y actualizar ficha" aria-label="Cerrar">×</button>
      </div>
      <div class="coprop-body">
        <div class="coprop-card">
          <h4>Titulares vigentes del predio</h4>
          <div id="copropCondominioInfo"></div>
          <div id="copropPadronInfo"></div>
          <div id="copropTablaPredio">Cargando...</div>
          <div id="copropTotal" class="coprop-total">TOTAL: 0%</div>
          <div class="coprop-acciones-predio">
            <button type="button" class="coprop-btn sec" onclick="repartirPorcentajesCopropiedad()">Repartir automático</button>
            <button type="button" class="coprop-btn ok" onclick="guardarPorcentajesCopropiedad()">Guardar porcentajes</button>
          </div>
          <div id="copropMsgPredio" class="coprop-msg"></div>
        </div>

        <div class="coprop-card">
          <h4>Catálogo de propietarios</h4>
          <small class="coprop-origen-leyenda"><b>Origen:</b> <b>Catálogo</b> = ya tiene ficha en el sistema · <b>Padrón</b> = nombre del padrón fiscal (se crea ficha al agregar)</small>
          <div class="coprop-row">
            <input id="copropBuscarTexto" type="text" placeholder="APELLIDO, NOMBRE, RFC O RAZÓN SOCIAL..." onkeyup="if(event.key==='Enter') buscarPropietariosCatalogo()">
            <button type="button" class="coprop-btn" onclick="buscarPropietariosCatalogo()">Buscar</button>
          </div>
          <div id="copropResultadosCatalogo" class="coprop-lista-resultados"><div class="coprop-item">Captura criterios y presiona buscar.</div></div>

          <h4 style="margin-top:12px;">Nuevo / editar propietario</h4>
          <div class="coprop-row">
            <select id="copropTipoPersona" onchange="cambiarTipoPersonaCoprop()">
              <option value="FISICA">FÍSICA</option>
              <option value="MORAL">MORAL</option>
            </select>
            <input id="copropRFC" type="text" placeholder="RFC">
          </div>
          <div id="copropFisica">
            <div class="coprop-campo-catalogo">
              <label>Apellido paterno</label>
              <input id="copropApellidoPaterno" type="text" placeholder="APELLIDO PATERNO">
              <div id="copropSugApPat" class="coprop-sugerencias"></div>
            </div>
            <div class="coprop-campo-catalogo">
              <label>Apellido materno</label>
              <input id="copropApellidoMaterno" type="text" placeholder="APELLIDO MATERNO">
              <div id="copropSugApMat" class="coprop-sugerencias"></div>
            </div>
            <div class="coprop-campo-catalogo">
              <label>Nombre(s)</label>
              <input id="copropNombres" type="text" placeholder="NOMBRE(S) - EJ: GENARO FERNANDO">
              <small>Puede capturar varios nombres separados por espacio.</small>
              <div id="copropSugNombres" class="coprop-sugerencias"></div>
            </div>
            <div class="coprop-row"><input id="copropCURP" type="text" placeholder="CURP"></div>
          </div>
          <div id="copropMoral" style="display:none;">
            <div class="coprop-campo-catalogo">
              <label>Razón social</label>
              <input id="copropRazonSocial" type="text" placeholder="RAZÓN SOCIAL">
              <div id="copropSugRazon" class="coprop-sugerencias"></div>
            </div>
          </div>
          <div class="coprop-campo-catalogo">
            <label>Nombre completo generado</label>
            <input id="copropNombreCompletoPreview" type="text" class="coprop-preview-nombre" readonly placeholder="SE GENERA AUTOMÁTICAMENTE">
          </div>
          <div class="coprop-row">
            <button type="button" class="coprop-btn ok" onclick="crearPropietarioCatalogo(false)">Crear propietario</button>
            <button type="button" class="coprop-btn" onclick="crearPropietarioCatalogo(true)">Crear y agregar al predio</button>
            <button type="button" class="coprop-btn sec" onclick="limpiarFormularioPropietarioCatalogo()">Limpiar</button>
          </div>
          <div id="copropMsgCatalogo" class="coprop-msg"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  configurarEntradasPersonaCoprop(modal);
}

function cerrarModalCopropietarios() {
  const modal = document.getElementById("modalCopropietarios");
  if (modal) modal.classList.add("oculto");
}

async function cerrarModalCopropietariosConRefresh() {
  const clave = copropEstado.clave;
  cerrarModalCopropietarios();
  if (!clave) return;

  try {
    await refrescarVistaPredioActivo(clave);
    const claveInput = (document.getElementById("claveInput")?.value || "").trim().toUpperCase();
    if (claveInput === clave.toUpperCase() && typeof buscarAvanzado === "function") {
      await buscarAvanzado();
    }
  } catch (e) {
    console.warn("Al cerrar copropietarios:", e);
  }
}

function extraerMensajeApi(data, fallback = "Error en el servidor.") {
  const d = data?.detail ?? data?.message;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map(e => {
      if (typeof e === "string") return e;
      const campo = Array.isArray(e.loc) ? e.loc.filter(x => x !== "body").join(".") : "";
      const msg = e.msg || String(e);
      return campo ? `${campo}: ${msg}` : msg;
    }).join(" · ");
  }
  if (typeof d === "object") return d.msg || JSON.stringify(d);
  return String(d);
}

function msgCoprop(id, texto, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto || "";
  el.className = ok ? "coprop-msg ok" : "coprop-msg error";
}

function abrirCopropietariosDesdeMovimientos() {
  const clave = normalizarPersonaCatalogo(
    typeof obtenerClaveParaMovimiento === "function" ? obtenerClaveParaMovimiento() : ""
  );
  if (!clave) {
    alert("Capture la clave en «Clave catastral origen» o seleccione un predio en la consulta.");
    return;
  }
  const movTipo = document.getElementById("movTipo");
  if (movTipo) movTipo.value = "CAMBIO_TITULARIDAD";
  abrirModalCopropietarios(clave);
}

async function abrirModalCopropietarios(clave) {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para administrar titularidad. Consulte la ficha en la pestaña Titularidad o solicite un movimiento catastral.");
    return;
  }

  const claveFinal = normalizarPersonaCatalogo(clave || obtenerClaveSeleccionadaActual() || document.getElementById("claveInput")?.value);
  if (!claveFinal) {
    alert("Primero selecciona o busca un predio.");
    return;
  }

  asegurarModalCopropietarios();
  copropEstado.clave = claveFinal;
  copropEstado.seleccionCatalogo = null;
  document.getElementById("copropClaveHeader").textContent = claveFinal;
  document.getElementById("modalCopropietarios").classList.remove("oculto");
  await cargarCopropietariosPredio(claveFinal);
}

async function cargarCopropietariosPredio(clave = copropEstado.clave) {
  const cont = document.getElementById("copropTablaPredio");
  if (cont) cont.innerHTML = "Cargando propietarios...";

  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/propietarios?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json();
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudieron cargar propietarios del predio."));

    copropEstado.propietarios = data.propietarios || [];
    copropEstado.titularPadron = data.titular_padron || null;
    copropEstado.padronSincronizado = !!data.padron_sincronizado;
    copropEstado.condominio = data.condominio || null;
    renderCopropietariosPredio(data);
    renderCondominioInfoCoprop(data);
    renderPadronInfoCoprop(data);

    // Antes se preguntaba con un confirm() predio por predio (molesto). Ahora solo se
    // muestra la alerta con los botones (aplicar a este predio o a todos los pendientes).
    return data;
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="coprop-msg error">${escapeHtml(e.message)}</div>`;
  }
}

function renderCopropietariosPredio(data = null) {
  const cont = document.getElementById("copropTablaPredio");
  const totalBox = document.getElementById("copropTotal");
  if (!cont) return;

  const props = copropEstado.propietarios || [];
  if (!props.length) {
    cont.innerHTML = "Sin propietarios registrados.";
  } else {
    cont.innerHTML = `
      <table class="coprop-table">
        <thead><tr><th>Propietario</th><th>Tipo</th><th>RFC</th><th>%</th><th>Acciones</th></tr></thead>
        <tbody>
          ${props.map((p, i) => `
            <tr>
              <td><b>${escapeHtml(nombrePersonaCatalogo(p))}</b><br><small>ID persona: ${escapeHtml(p.id_persona)}</small></td>
              <td>${escapeHtml(p.tipo_titularidad || "")}</td>
              <td>${escapeHtml(p.rfc || "")}</td>
              <td><input type="number" step="0.01" min="0" max="100" value="${Number(p.porcentaje_propiedad || 0)}" onchange="actualizarPorcentajeLocalCoprop(${i}, this.value)"></td>
              <td><button type="button" class="coprop-btn danger" onclick="quitarCopropietarioPredio(${p.id_persona})">Quitar</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  const suma = data?.suma_porcentaje ?? sumaCopropiedadLocal();
  const valido = Math.abs(Number(suma || 0) - 100) < 0.01;
  if (totalBox) {
    totalBox.textContent = `TOTAL COPROPIEDAD: ${Number(suma || 0).toFixed(2)}% ${valido ? "✓" : "⚠ DEBE SER 100%"}`;
    totalBox.className = valido ? "coprop-total ok" : "coprop-total error";
  }
}

function actualizarPorcentajeLocalCoprop(idx, valor) {
  if (!copropEstado.propietarios[idx]) return;
  copropEstado.propietarios[idx].porcentaje_propiedad = Number(valor || 0);
  renderCopropietariosPredio();
}

function repartirPorcentajesCopropiedad() {
  const props = copropEstado.propietarios || [];
  if (!props.length) return;
  const base = Math.floor((100 / props.length) * 100) / 100;
  let acumulado = 0;
  props.forEach((p, i) => {
    if (i < props.length - 1) {
      p.porcentaje_propiedad = base;
      acumulado += base;
    } else {
      p.porcentaje_propiedad = Number((100 - acumulado).toFixed(2));
    }
  });
  renderCopropietariosPredio();
}

async function obtenerIdsPropietariosServidor(clave = copropEstado.clave) {
  const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/propietarios?_=${Date.now()}`, {
    cache: "no-store",
    headers: authHeaders()
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudieron consultar propietarios del predio."));
  return new Set((data.propietarios || []).map(p => Number(p.id_persona)));
}

async function sincronizarCopropietariosPredio() {
  const clave = copropEstado.clave;
  const suma = sumaCopropiedadLocal();
  if (Math.abs(suma - 100) >= 0.01) {
    throw new Error("La suma de copropiedad debe ser exactamente 100%.");
  }

  const propietarios = (copropEstado.propietarios || []).map((p, idx) => ({
    id_persona: Number(p.id_persona),
    porcentaje_propiedad: Number(p.porcentaje_propiedad || 0),
    tipo_titularidad: p.tipo_titularidad || (idx === 0 ? "PROPIETARIO" : "COPROPIETARIO")
  }));

  if (!propietarios.length) {
    throw new Error("Debe haber al menos un titular en el predio.");
  }

  const r = await fetch(`${API}/predios/${encodeURIComponent(clave)}/propietarios/reemplazar`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ propietarios })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo sincronizar la titularidad del predio."));
}

async function guardarPorcentajesCopropiedad() {
  try {
    await sincronizarCopropietariosPredio();
    msgCoprop("copropMsgPredio", "Porcentajes guardados correctamente.", true);
    await cargarCopropietariosPredio(copropEstado.clave);
    await refrescarVistaPredioActivo(copropEstado.clave);
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al guardar porcentajes.", false);
  }
}

async function buscarPropietariosCatalogo() {
  const campoBuscar = document.getElementById("copropBuscarTexto");
  const criterios = obtenerCriteriosBusquedaCatalogo("coprop");
  const cont = document.getElementById("copropResultadosCatalogo");
  if (!criterios) {
    if (cont) {
      cont.innerHTML = `<div class="coprop-item">Captura criterios arriba, apellidos/nombre o razón social abajo y presiona Buscar.</div>`;
    }
    return;
  }

  const q = obtenerTextoBusquedaCatalogoPropietarios();
  if (campoBuscar && !normalizarPersonaCatalogo(campoBuscar.value) && criterios.q) {
    campoBuscar.value = criterios.q;
  }

  if (cont) cont.innerHTML = `<div class="coprop-item">Buscando en catálogo y padrón: "${escapeHtml(q)}"...</div>`;

  try {
    const params = new URLSearchParams({
      limite: "200",
      _: String(Date.now())
    });
    if (criterios.q) params.set("q", criterios.q);
    if (criterios.paterno) params.set("paterno", criterios.paterno);
    if (criterios.materno) params.set("materno", criterios.materno);
    if (criterios.nombre) params.set("nombre", criterios.nombre);
    if (criterios.razon_social) params.set("razon_social", criterios.razon_social);

    const r = await fetch(`${API}/propietarios/buscar?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json();
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar propietario."));

    const resultados = Array.isArray(data) ? data : (data.resultados || data.propietarios || []);
    copropEstado.catalogoResultados = resultados;
    renderResultadosCatalogoCoprop(resultados, {
      total_padron: data.total_padron,
      truncado: data.truncado
    });
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="coprop-item"><span class="coprop-msg error">${escapeHtml(e.message)}</span></div>`;
  }
}

function seleccionarResultadoCatalogoCoprop(idx) {
  const p = (copropEstado.catalogoResultados || [])[idx];
  if (!p) {
    msgCoprop("copropMsgPredio", "No se encontró el propietario en los resultados.", false);
    return;
  }

  document.querySelectorAll("#copropResultadosCatalogo tr[data-idx]").forEach(el => el.classList.remove("activo"));
  const fila = document.querySelector(`#copropResultadosCatalogo tr[data-idx="${idx}"]`);
  if (fila) fila.classList.add("activo");

  if (!p.id_persona || p.origen === "padron") {
    importarPropietarioPadronCoprop(idx);
    return;
  }
  seleccionarPropietarioCatalogo(p);
}

function agregarDesdeCatalogoCoprop(idPersona) {
  const p = (copropEstado.catalogoResultados || []).find(x => Number(x.id_persona) === Number(idPersona));
  if (!p) {
    msgCoprop("copropMsgPredio", "No se encontró el propietario en el catálogo.", false);
    return;
  }
  seleccionarPropietarioCatalogo(p);
}

async function importarPropietarioPadronCoprop(idx) {
  const p = (copropEstado.catalogoResultados || [])[idx];
  if (!p) {
    msgCoprop("copropMsgPredio", "No se encontró el propietario en los resultados.", false);
    return;
  }

  const nombre = nombrePersonaCatalogo(p);
  if (!confirm(`¿Importar del padrón y agregar al predio ${copropEstado.clave}?\n\n${nombre}\n\nSe creará una ficha de propietario en el catálogo.`)) {
    return;
  }

  const tipoForm = document.getElementById("copropTipoPersona")?.value || "FISICA";
  const payload = (esResultadoMoral(p) || tipoForm === "MORAL")
    ? {
      tipo_persona: "MORAL",
      razon_social: normalizarPersonaCatalogo(p.razon_social || p.nombre_completo || nombrePersonaCatalogo(p))
    }
    : {
      tipo_persona: "FISICA",
      apellido_paterno: p.apellido_paterno || null,
      apellido_materno: p.apellido_materno || null,
      nombre: p.nombre || null
    };

  try {
    const r = await fetch(`${API}/propietarios`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo importar propietario del padrón."));

    const persona = extraerPersonaApi(data);
    if (!persona?.id_persona) {
      throw new Error("El servidor creó el propietario pero no devolvió su ID.");
    }

    copropEstado.seleccionCatalogo = persona;
    await agregarCopropietarioPredio(persona.id_persona);
    msgCoprop("copropMsgCatalogo", "Propietario importado del padrón y agregado al predio.", true);
    await buscarPropietariosCatalogo();
  } catch (e) {
    msgCoprop("copropMsgCatalogo", e.message || "Error al importar propietario del padrón.", false);
  }
}

function seleccionarPropietarioCatalogo(p) {
  copropEstado.seleccionCatalogo = p;
  const idx = (copropEstado.catalogoResultados || []).findIndex(x => Number(x.id_persona) === Number(p.id_persona));
  document.querySelectorAll("#copropResultadosCatalogo tr[data-idx]").forEach(el => el.classList.remove("activo"));
  if (idx >= 0) {
    const item = document.querySelector(`#copropResultadosCatalogo tr[data-idx="${idx}"]`);
    if (item) item.classList.add("activo");
  }

  const nombre = nombrePersonaCatalogo(p);
  const repartira = sumaCopropiedadLocal() >= 99.99 && (copropEstado.propietarios || []).length > 0;
  const detalle = repartira
    ? "Se repartirá el 100% entre todos los titulares."
    : `Porcentaje sugerido: ${porcentajeDefaultNuevoCopropietario()}%`;

  if (!confirm(`¿Agregar al predio ${copropEstado.clave}?\n\n${nombre}\n${detalle}`)) return;

  agregarCopropietarioPredio(p.id_persona);
}

async function resolverPersonaCatalogo(idPersona) {
  const id = Number(idPersona);
  const cat = copropEstado.seleccionCatalogo;
  if (cat && Number(cat.id_persona) === id) return cat;

  try {
    const r = await fetch(`${API}/propietarios/${encodeURIComponent(id)}?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return extraerPersonaApi(data) || data;
  } catch (e) {}

  return { id_persona: id };
}

async function agregarCopropietarioPredio(idPersona, porcentaje = null) {
  try {
    const id = Number(idPersona);
    if ((copropEstado.propietarios || []).some(p => Number(p.id_persona) === id)) {
      msgCoprop("copropMsgPredio", "Esta persona ya está asignada al predio.", false);
      return;
    }

    const sumaActual = sumaCopropiedadLocal();
    const yaHayTitularAl100 = sumaActual >= 99.99 && (copropEstado.propietarios || []).length > 0;

    if (yaHayTitularAl100) {
      const prev = [...(copropEstado.propietarios || [])];
      const persona = await resolverPersonaCatalogo(id);
      copropEstado.seleccionCatalogo = persona;
      const nuevo = { ...persona };
      nuevo.id_persona = id;
      nuevo.tipo_titularidad = "COPROPIETARIO";
      nuevo.porcentaje_propiedad = 0;
      copropEstado.propietarios.push(nuevo);
      repartirPorcentajesCopropiedad();
      try {
        await sincronizarCopropietariosPredio();
      } catch (syncErr) {
        copropEstado.propietarios = prev;
        renderCopropietariosPredio();
        throw syncErr;
      }
      msgCoprop("copropMsgPredio", "Copropietario agregado. Porcentajes repartidos automáticamente al 100%.", true);
      await cargarCopropietariosPredio(copropEstado.clave);
      await refrescarVistaPredioActivo(copropEstado.clave);
      return;
    }

    const pct = porcentaje ?? porcentajeDefaultNuevoCopropietario();
    const tipo = (copropEstado.propietarios || []).length === 0 ? "PROPIETARIO" : "COPROPIETARIO";

    const r = await fetch(`${API}/predios/${encodeURIComponent(copropEstado.clave)}/propietarios`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        id_persona: id,
        porcentaje_propiedad: Number(pct),
        tipo_titularidad: tipo
      })
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo agregar propietario al predio."));

    msgCoprop("copropMsgPredio", "Propietario agregado. Revisa que el total sea 100%.", true);
    await cargarCopropietariosPredio(copropEstado.clave);
    await refrescarVistaPredioActivo(copropEstado.clave);
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al agregar propietario.", false);
  }
}

async function quitarCopropietarioPredio(idPersona) {
  if (!confirm("¿Quitar este propietario del predio?")) return;

  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(copropEstado.clave)}/propietarios/${encodeURIComponent(idPersona)}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo quitar propietario."));

    msgCoprop("copropMsgPredio", "Propietario quitado. Revisa porcentajes.", true);
    await cargarCopropietariosPredio(copropEstado.clave);
    await refrescarVistaPredioActivo(copropEstado.clave);
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al quitar propietario.", false);
  }
}

function cambiarTipoPersonaCoprop() {
  const tipo = document.getElementById("copropTipoPersona")?.value || "FISICA";
  const fisica = document.getElementById("copropFisica");
  const moral = document.getElementById("copropMoral");
  if (tipo === "MORAL") {
    if (fisica) fisica.style.display = "none";
    if (moral) moral.style.display = "block";
  } else {
    if (moral) moral.style.display = "none";
    if (fisica) fisica.style.display = "block";
  }
  document.querySelectorAll(".coprop-sugerencias").forEach(n => n.innerHTML = "");
  actualizarVistaNombreCompletoCoprop();
}

function limpiarFormularioPropietarioCatalogo() {
  ["copropRFC", "copropApellidoPaterno", "copropApellidoMaterno", "copropNombres", "copropCURP", "copropRazonSocial", "copropNombreCompletoPreview"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const tipo = document.getElementById("copropTipoPersona");
  if (tipo) tipo.value = "FISICA";
  cambiarTipoPersonaCoprop();
  document.querySelectorAll(".coprop-sugerencias").forEach(n => n.innerHTML = "");
  msgCoprop("copropMsgCatalogo", "", true);
}

async function crearPropietarioCatalogo(agregarAlPredio = false) {
  const tipo = document.getElementById("copropTipoPersona")?.value || "FISICA";
  const rfc = normalizarPersonaCatalogo(document.getElementById("copropRFC")?.value);
  const curp = normalizarPersonaCatalogo(document.getElementById("copropCURP")?.value);
  const apellidoPaterno = normalizarPersonaCatalogo(document.getElementById("copropApellidoPaterno")?.value);
  const apellidoMaterno = normalizarPersonaCatalogo(document.getElementById("copropApellidoMaterno")?.value);
  const nombres = normalizarPersonaCatalogo(document.getElementById("copropNombres")?.value);
  const razonSocial = normalizarPersonaCatalogo(document.getElementById("copropRazonSocial")?.value);

  if (tipo === "FISICA" && !apellidoPaterno && !apellidoMaterno && !nombres) {
    msgCoprop("copropMsgCatalogo", "Para persona física captura al menos apellido paterno, materno o nombre(s).", false);
    return;
  }
  if (tipo === "MORAL" && !razonSocial) {
    msgCoprop("copropMsgCatalogo", "Para persona moral captura razón social.", false);
    return;
  }

  const payload = tipo === "MORAL"
    ? { tipo_persona: "MORAL", razon_social: razonSocial, ...(rfc ? { rfc } : {}), ...(curp ? { curp } : {}) }
    : {
      tipo_persona: "FISICA",
      apellido_paterno: apellidoPaterno || null,
      apellido_materno: apellidoMaterno || null,
      nombre: nombres || null,
      ...(rfc ? { rfc } : {}),
      ...(curp ? { curp } : {})
    };

  try {
    const r = await fetch(`${API}/propietarios`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo crear propietario."));

    const persona = extraerPersonaApi(data);
    if (!persona?.id_persona) {
      throw new Error("El servidor creó el propietario pero no devolvió su ID.");
    }

    copropEstado.seleccionCatalogo = persona;
    msgCoprop("copropMsgCatalogo", "Propietario creado correctamente.", true);
    limpiarFormularioPropietarioCatalogo();

    const debeAgregar = agregarAlPredio === true
      || confirm("¿Agregar este nuevo propietario al predio seleccionado?");

    if (debeAgregar) {
      await agregarCopropietarioPredio(persona.id_persona);
    }
  } catch (e) {
    msgCoprop("copropMsgCatalogo", e.message || "Error al crear propietario.", false);
  }
}

async function cargarTitularidadFicha(clave) {
  const claveFinal = normalizarPersonaCatalogo(clave || document.getElementById("claveInput")?.value);
  const destinos = [
    document.getElementById("fichaTitularidadDetalle"),
    document.getElementById("fichaTitularidadDetallePanel")
  ].filter(Boolean);

  if (!claveFinal || !destinos.length) return;
  destinos.forEach(d => d.innerHTML = "Cargando titularidad...");

  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(claveFinal)}/propietarios?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "No se pudo cargar titularidad.");

    const props = data.propietarios || [];
    const html = props.length ? `
      <table class="coprop-table">
        <thead><tr><th>Nombre</th><th>RFC</th><th>%</th></tr></thead>
        <tbody>
          ${props.map(p => `
            <tr>
              <td>${escapeHtml(nombrePersonaCatalogo(p))}</td>
              <td>${escapeHtml(p.rfc || "")}</td>
              <td>${Number(p.porcentaje_propiedad || 0).toFixed(2)}%</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="coprop-total ${data.valido ? "ok" : "error"}">TOTAL: ${Number(data.suma_porcentaje || 0).toFixed(2)}%</div>
    ` : "Sin propietarios registrados.";

    destinos.forEach(d => d.innerHTML = html);
  } catch (e) {
    destinos.forEach(d => d.innerHTML = `<div class="coprop-msg error">${escapeHtml(e.message)}</div>`);
  }
}

async function refrescarFichaClaveActual(clave) {
  if (!clave) return;
  try {
    if (typeof abrirFichaPredioPorClave === "function") {
      await abrirFichaPredioPorClave(clave);
    } else if (typeof seleccionarPorClave === "function") {
      await seleccionarPorClave(clave);
    }
  } catch (e) {
    console.warn("No se pudo refrescar ficha:", e);
  }
}

async function refrescarVistaPredioActivo(clave) {
  const claveNorm = String(clave || document.getElementById("claveInput")?.value || "").trim().toUpperCase();
  if (!claveNorm) return;
  await sincronizarNombrePadronDesdeCatalogo(claveNorm);
  await refrescarFichaClaveActual(claveNorm);
  const claveInput = (document.getElementById("claveInput")?.value || "").trim().toUpperCase();
  if (claveInput === claveNorm && typeof buscarAvanzado === "function") {
    await buscarAvanzado();
  }
}
window.refrescarVistaPredioActivo = refrescarVistaPredioActivo;

window.abrirModalCopropietarios = abrirModalCopropietarios;
window.guardarModalidadCondominioPredio = guardarModalidadCondominioPredio;
window.guardarClasificacionCondominioPredio = guardarClasificacionCondominioPredio;
window.aplicarClasificacionGrupoCoprop = aplicarClasificacionGrupoCoprop;
window.aplicarSugerenciaModalidadCondominio = aplicarSugerenciaModalidadCondominio;
window.abrirCopropietariosDesdeMovimientos = abrirCopropietariosDesdeMovimientos;
window.cerrarModalCopropietarios = cerrarModalCopropietarios;
window.cerrarModalCopropietariosConRefresh = cerrarModalCopropietariosConRefresh;
window.cargarCopropietariosPredio = cargarCopropietariosPredio;
window.buscarPropietariosCatalogo = buscarPropietariosCatalogo;
window.seleccionarResultadoCatalogoCoprop = seleccionarResultadoCatalogoCoprop;
window.sincronizarTitularDesdePadron = sincronizarTitularDesdePadron;
window.desplazarResultadosCatalogo = desplazarResultadosCatalogo;
window.importarPropietarioPadronCoprop = importarPropietarioPadronCoprop;
window.seleccionarPropietarioCatalogo = seleccionarPropietarioCatalogo;
window.agregarDesdeCatalogoCoprop = agregarDesdeCatalogoCoprop;
window.agregarCopropietarioPredio = agregarCopropietarioPredio;
window.quitarCopropietarioPredio = quitarCopropietarioPredio;
window.repartirPorcentajesCopropiedad = repartirPorcentajesCopropiedad;
window.guardarPorcentajesCopropiedad = guardarPorcentajesCopropiedad;
window.actualizarPorcentajeLocalCoprop = actualizarPorcentajeLocalCoprop;
window.crearPropietarioCatalogo = crearPropietarioCatalogo;
window.limpiarFormularioPropietarioCatalogo = limpiarFormularioPropietarioCatalogo;
window.cambiarTipoPersonaCoprop = cambiarTipoPersonaCoprop;
window.cargarTitularidadFicha = cargarTitularidadFicha;

setTimeout(asegurarModalCopropietarios, 800);


/* ============================================================
   v28b - RESTAURACIÓN SEGURA FICHA + MODAL CAMBIO DE NOMBRE
   - No elimina copropietarios.
   - Si la ficha llega sin RFC/tipo/titularidad, consulta /padron/{clave}/ficha.
   - Fuerza que el botón Abrir ventana: Cambio de nombre vuelva a funcionar.
============================================================ */
async function sincronizarNombrePadronDesdeCatalogo(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;
  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(claveNorm)}/propietarios/refrescar-nombre-padron`, {
      method: "POST",
      headers: authHeaders(),
      cache: "no-store"
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    return data;
  } catch (e) {
    console.warn("No se pudo sincronizar nombre del padrón:", e);
    return null;
  }
}

async function titularCatalogoPredio(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;
  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(claveNorm)}/propietarios?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) return null;
    const data = await r.json();
    const rows = data.propietarios || [];
    if (!rows.length) return null;
    const principal = rows.find(x => String(x.tipo_titularidad || "").toUpperCase() === "PROPIETARIO") || rows[0];
    return principal || null;
  } catch (e) {
    console.warn("No se pudo leer titular del catálogo:", e);
    return null;
  }
}

async function fichaEnriquecidaPadronV28b(p) {
  const base = { ...(p || {}) };
  const clave = String(base.clave_catastral || base.clave || document.getElementById('claveInput')?.value || '').trim().toUpperCase();
  if (!clave) return base;

  let merged = { ...base };

  // Ambas consultas son independientes: se lanzan en paralelo para no encadenar
  // latencia (antes se hacían en secuencia y eso retrasaba la ficha).
  const fichaPadronPromise = fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
    cache: 'no-store',
    headers: authHeaders()
  })
    .then(r => (r.ok ? r.json() : null))
    .catch(e => { console.warn('No se pudo enriquecer ficha con padrón:', e); return null; });

  const [titular, dataPadron] = await Promise.all([
    titularCatalogoPredio(clave),
    fichaPadronPromise
  ]);

  // 1) Datos del padrón (geometría, valores, ubicación, etc.).
  let nombrePadron = "";
  if (dataPadron) {
    const props = dataPadron?.properties || dataPadron || {};
    merged = { ...merged, ...props };
    nombrePadron = (props.nombre_completo || props.propietario || "").trim();
  }

  // 2) Titular del catálogo (prioritario para el nombre visible).
  let nombreCatalogo = "";
  if (titular) {
    nombreCatalogo = (titular.nombre_completo || titular.razon_social || "").trim();
    if (titular.tipo_persona) merged.tipo_persona = titular.tipo_persona;
    if (titular.rfc) merged.rfc = titular.rfc;
    if (titular.tipo_titularidad) merged.tipo_titularidad = titular.tipo_titularidad;
    if (titular.porcentaje_propiedad !== undefined && titular.porcentaje_propiedad !== null) {
      merged.porcentaje_propiedad = titular.porcentaje_propiedad;
    }
    if (titular.id_persona) merged.id_persona = titular.id_persona;
  }

  const nombreFinal = nombreCatalogo || nombrePadron;
  if (nombreFinal) {
    merged.nombre_completo = nombreFinal;
    merged.propietario = nombreFinal;
  }

  return merged;
}

if (typeof pintarFichaFlotante === 'function' && !window.__pintarFichaFlotanteBaseV28b) {
  window.__pintarFichaFlotanteBaseV28b = pintarFichaFlotante;
  pintarFichaFlotante = async function(p) {
    const enriquecida = await fichaEnriquecidaPadronV28b(p);
    window.predioSeleccionado = enriquecida;
    return window.__pintarFichaFlotanteBaseV28b(enriquecida);
  };
  window.pintarFichaFlotante = pintarFichaFlotante;
}

if (typeof pintarFicha === 'function' && !window.__pintarFichaBaseV28b) {
  window.__pintarFichaBaseV28b = pintarFicha;
  pintarFicha = async function(p) {
    const enriquecida = await fichaEnriquecidaPadronV28b(p);
    window.predioSeleccionado = enriquecida;
    return window.__pintarFichaBaseV28b(enriquecida);
  };
  window.pintarFicha = pintarFicha;
}

function obtenerNombreSeleccionadoActualV28b() {
  try {
    const fichaNombre = document.querySelector('.ficha-status-box .big + div')?.textContent?.trim();
    if (fichaNombre) return fichaNombre;
  } catch(e) {}

  try {
    if (window.predioSeleccionado) {
      return window.predioSeleccionado.nombre_completo || window.predioSeleccionado.propietario || window.predioSeleccionado.nombre || '';
    }
  } catch(e) {}

  try {
    const fila = gridEstado?.filtrados?.find(x => String(x.clave_catastral || '').toUpperCase() === String(document.getElementById('claveInput')?.value || '').toUpperCase());
    if (fila) return fila.nombre_completo || fila.propietario || '';
  } catch(e) {}

  return '';
}

const cambioNombreEstado = { catalogoResultados: [], idPersona: null };
let cambioNombreBuscarTimer = null;
let cambioNombreCatalogoTimer = null;
let cambioNombreEntradasConfiguradas = false;

function msgCambioNombreCatalogo(texto, ok) {
  const el = document.getElementById("modalMovMsgCatalogo");
  if (!el) return;
  el.textContent = texto || "";
  el.className = "mov-cat-msg " + (ok ? "ok" : texto ? "error" : "");
}

function mostrarTitularSeleccionadoCambioNombre(p) {
  const box = document.getElementById("modalMovTitularSeleccionado");
  if (!box) return;
  const nombre = nombrePersonaCatalogo(p);
  const origen = p?.id_persona ? `Catálogo · ID ${p.id_persona}` : "Padrón / captura manual";
  box.innerHTML = `<b>Nuevo titular seleccionado:</b> ${escapeHtml(nombre)}<br><small>${escapeHtml(origen)}</small>`;
  box.classList.remove("oculto");
}

function limpiarSeleccionTitularCambioNombre() {
  cambioNombreEstado.idPersona = null;
  const idEl = document.getElementById("modalMovIdPersona");
  if (idEl) idEl.value = "";
  const box = document.getElementById("modalMovTitularSeleccionado");
  if (box) {
    box.innerHTML = "";
    box.classList.add("oculto");
  }
  document.querySelectorAll("#modalMovResultadosCatalogo tr[data-idx]").forEach(el => el.classList.remove("activo"));
}

function llenarFormularioPropietarioCambioNombre(p) {
  if (!p) return;
  const tipo = esResultadoMoral(p) ? "MORAL" : "FISICA";
  const tipoEl = document.getElementById("modalMovTipoPersona");
  if (tipoEl) tipoEl.value = tipo;
  cambiarTipoPersonaModal();

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
  if (tipo === "MORAL") {
    setVal("modalMovRazonSocial", p.razon_social || p.nombre_completo || nombrePersonaCatalogo(p));
    setVal("modalMovPrimerApellido", "");
    setVal("modalMovSegundoApellido", "");
    setVal("modalMovNombres", "");
  } else {
    const cols = columnasPersonaResultado(p);
    setVal("modalMovPrimerApellido", cols.paterno);
    setVal("modalMovSegundoApellido", cols.materno);
    setVal("modalMovNombres", cols.nombres);
    setVal("modalMovRazonSocial", "");
  }
  setVal("modalMovRFC", p.rfc || "");
  setVal("modalMovCURP", p.curp || "");
  setVal("modalMovIdPersona", p.id_persona || "");
  cambioNombreEstado.idPersona = p.id_persona || null;
  generarNombreCambioNombreModal();
  mostrarTitularSeleccionadoCambioNombre(p);
  msgCambioNombreCatalogo("", true);
}

function limpiarFormularioCambioNombreTitular() {
  ["modalMovPrimerApellido", "modalMovSegundoApellido", "modalMovNombres", "modalMovRazonSocial",
    "modalMovNombreNuevo", "modalMovRFC", "modalMovCURP", "modalMovBuscarTexto"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const tipo = document.getElementById("modalMovTipoPersona");
  if (tipo) tipo.value = "FISICA";
  cambiarTipoPersonaModal();
  limpiarSeleccionTitularCambioNombre();
  document.querySelectorAll(".mov-cat-sugerencias").forEach(n => n.innerHTML = "");
  const cont = document.getElementById("modalMovResultadosCatalogo");
  if (cont) cont.innerHTML = `<div class="mov-cat-item">Captura criterios y presiona buscar, o use el formulario abajo.</div>`;
  msgCambioNombreCatalogo("", true);
}
window.limpiarFormularioCambioNombreTitular = limpiarFormularioCambioNombreTitular;

function desplazarResultadosCatalogoCambioNombre(destino) {
  const el = document.getElementById("modalMovResultadosScroll");
  if (!el) return;
  const paso = Math.max(el.clientHeight * 0.75, 80);
  if (destino === "arriba") el.scrollTop -= paso;
  else if (destino === "abajo") el.scrollTop += paso;
  else if (destino === "inicio") el.scrollTop = 0;
  else if (destino === "fin") el.scrollTop = el.scrollHeight;
}

function renderResultadosCatalogoCambioNombre(resultados, meta) {
  const cont = document.getElementById("modalMovResultadosCatalogo");
  if (!cont) return;

  if (!resultados.length) {
    cont.innerHTML = `<div class="mov-cat-item">Sin resultados. Puede crear un nuevo propietario abajo.</div>`;
    return;
  }

  const criterios = obtenerCriteriosBusquedaCatalogo("cambioNombre");
  const modoMoral = criterios?.tipo === "MORAL" || !!criterios?.razon_social;
  const totalPadron = Number(meta?.total_padron || 0);
  const truncado = !!meta?.truncado;
  const pie = truncado && totalPadron > resultados.length
    ? `Mostrando ${resultados.length} de ${totalPadron}. Refine la búsqueda.`
    : `${resultados.length} resultado(s). Click en fila para usar como nuevo titular.`;

  const filas = resultados.map((p, idx) => {
    const origen = p.origen === "padron" || !p.id_persona ? "Padrón" : "Catálogo";
    if (modoMoral || esResultadoMoral(p)) {
      const razon = normalizarPersonaCatalogo(p.razon_social || p.nombre_completo || nombrePersonaCatalogo(p));
      return `
        <tr data-idx="${idx}" onclick="seleccionarPropietarioCambioNombre(${idx})" title="Usar como nuevo titular">
          <td colspan="3">${escapeHtml(razon || "—")}</td>
          <td><span class="mov-cat-origen">${escapeHtml(origen)}</span></td>
        </tr>`;
    }
    const cols = columnasPersonaResultado(p);
    return `
      <tr data-idx="${idx}" onclick="seleccionarPropietarioCambioNombre(${idx})" title="Usar como nuevo titular">
        <td>${escapeHtml(cols.paterno || "—")}</td>
        <td>${escapeHtml(cols.materno || "—")}</td>
        <td>${escapeHtml(cols.nombres || "—")}</td>
        <td><span class="mov-cat-origen">${escapeHtml(origen)}</span></td>
      </tr>`;
  }).join("");

  const encabezado = modoMoral
    ? `<tr><th colspan="3">Razón social</th><th>Origen</th></tr>`
    : `<tr><th>Paterno</th><th>Materno</th><th>Nombre(s)</th><th>Origen</th></tr>`;

  cont.innerHTML = `
    <div class="mov-cat-resultados-head">Resultados · click para seleccionar nuevo titular</div>
    <div class="mov-cat-resultados-wrap">
      <div id="modalMovResultadosScroll" class="mov-cat-lista-scroll">
        <table class="mov-cat-table">
          <thead>${encabezado}</thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="mov-cat-scroll-nav">
        <button type="button" class="mov-cat-scroll-btn" onclick="desplazarResultadosCatalogoCambioNombre('inicio')" title="Inicio">▲</button>
        <button type="button" class="mov-cat-scroll-btn" onclick="desplazarResultadosCatalogoCambioNombre('arriba')" title="Subir">↑</button>
        <button type="button" class="mov-cat-scroll-btn" onclick="desplazarResultadosCatalogoCambioNombre('abajo')" title="Bajar">↓</button>
        <button type="button" class="mov-cat-scroll-btn" onclick="desplazarResultadosCatalogoCambioNombre('fin')" title="Fin">▼</button>
      </div>
    </div>
    <div class="mov-cat-resultados-pie">${escapeHtml(pie)}</div>`;
}

async function buscarPropietariosCatalogoCambioNombre() {
  const campoBuscar = document.getElementById("modalMovBuscarTexto");
  const criterios = obtenerCriteriosBusquedaCatalogo("cambioNombre");
  const cont = document.getElementById("modalMovResultadosCatalogo");
  if (!criterios) {
    if (cont) cont.innerHTML = `<div class="mov-cat-item">Captura criterios arriba, apellidos/nombre abajo o RFC/CURP y presiona Buscar.</div>`;
    return;
  }

  const q = obtenerTextoBusquedaCatalogoPropietarios("cambioNombre");
  if (campoBuscar && !normalizarPersonaCatalogo(campoBuscar.value) && criterios.q) {
    campoBuscar.value = criterios.q;
  }
  if (cont) cont.innerHTML = `<div class="mov-cat-item">Buscando: "${escapeHtml(q)}"...</div>`;

  try {
    const params = new URLSearchParams({ limite: "200", _: String(Date.now()) });
    if (criterios.q) params.set("q", criterios.q);
    if (criterios.paterno) params.set("paterno", criterios.paterno);
    if (criterios.materno) params.set("materno", criterios.materno);
    if (criterios.nombre) params.set("nombre", criterios.nombre);
    if (criterios.razon_social) params.set("razon_social", criterios.razon_social);

    const r = await fetch(`${API}/propietarios/buscar?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json();
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar propietario."));

    const resultados = Array.isArray(data) ? data : (data.resultados || data.propietarios || []);
    cambioNombreEstado.catalogoResultados = resultados;
    renderResultadosCatalogoCambioNombre(resultados, {
      total_padron: data.total_padron,
      truncado: data.truncado
    });
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="mov-cat-item"><span class="mov-cat-msg error">${escapeHtml(e.message)}</span></div>`;
  }
}
window.buscarPropietariosCatalogoCambioNombre = buscarPropietariosCatalogoCambioNombre;

async function importarPropietarioPadronCambioNombre(idx) {
  const p = (cambioNombreEstado.catalogoResultados || [])[idx];
  if (!p) return;
  const nombre = nombrePersonaCatalogo(p);
  const tipoForm = document.getElementById("modalMovTipoPersona")?.value || "FISICA";
  const payload = (esResultadoMoral(p) || tipoForm === "MORAL")
    ? { tipo_persona: "MORAL", razon_social: normalizarPersonaCatalogo(p.razon_social || p.nombre_completo || nombre) }
    : {
      tipo_persona: "FISICA",
      apellido_paterno: p.apellido_paterno || null,
      apellido_materno: p.apellido_materno || null,
      nombre: p.nombre || null
    };

  try {
    const r = await fetch(`${API}/propietarios`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo importar propietario del padrón."));
    const persona = extraerPersonaApi(data);
    if (!persona?.id_persona) throw new Error("El servidor no devolvió ID de propietario.");
    llenarFormularioPropietarioCambioNombre(persona);
    msgCambioNombreCatalogo("Propietario importado del padrón al catálogo.", true);
    await buscarPropietariosCatalogoCambioNombre();
  } catch (e) {
    msgCambioNombreCatalogo(e.message || "Error al importar propietario.", false);
  }
}

function seleccionarPropietarioCambioNombre(idx) {
  const p = (cambioNombreEstado.catalogoResultados || [])[idx];
  if (!p) {
    msgCambioNombreCatalogo("No se encontró el propietario en los resultados.", false);
    return;
  }

  document.querySelectorAll("#modalMovResultadosCatalogo tr[data-idx]").forEach(el => el.classList.remove("activo"));
  const fila = document.querySelector(`#modalMovResultadosCatalogo tr[data-idx="${idx}"]`);
  if (fila) fila.classList.add("activo");

  if (!p.id_persona || p.origen === "padron") {
    if (confirm(`¿Usar este nombre del padrón como nuevo titular?\n\n${nombrePersonaCatalogo(p)}\n\nSe puede crear ficha en catálogo al guardar.`)) {
      llenarFormularioPropietarioCambioNombre({ ...p, id_persona: null });
    }
    return;
  }
  llenarFormularioPropietarioCambioNombre(p);
}
window.seleccionarPropietarioCambioNombre = seleccionarPropietarioCambioNombre;

async function crearPropietarioCatalogoCambioNombre() {
  const tipo = document.getElementById("modalMovTipoPersona")?.value || "FISICA";
  const rfc = normalizarPersonaCatalogo(document.getElementById("modalMovRFC")?.value);
  const curp = normalizarPersonaCatalogo(document.getElementById("modalMovCURP")?.value);
  const apellidoPaterno = normalizarPersonaCatalogo(document.getElementById("modalMovPrimerApellido")?.value);
  const apellidoMaterno = normalizarPersonaCatalogo(document.getElementById("modalMovSegundoApellido")?.value);
  const nombres = normalizarPersonaCatalogo(document.getElementById("modalMovNombres")?.value);
  const razonSocial = normalizarPersonaCatalogo(document.getElementById("modalMovRazonSocial")?.value);

  if (tipo === "FISICA" && !apellidoPaterno && !apellidoMaterno && !nombres) {
    msgCambioNombreCatalogo("Para persona física capture al menos apellido o nombre(s).", false);
    return;
  }
  if (tipo === "MORAL" && !razonSocial) {
    msgCambioNombreCatalogo("Para persona moral capture razón social.", false);
    return;
  }

  const payload = tipo === "MORAL"
    ? { tipo_persona: "MORAL", razon_social: razonSocial, ...(rfc ? { rfc } : {}), ...(curp ? { curp } : {}) }
    : {
      tipo_persona: "FISICA",
      apellido_paterno: apellidoPaterno || null,
      apellido_materno: apellidoMaterno || null,
      nombre: nombres || null,
      ...(rfc ? { rfc } : {}),
      ...(curp ? { curp } : {})
    };

  try {
    const r = await fetch(`${API}/propietarios`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo crear propietario."));
    const persona = extraerPersonaApi(data);
    if (!persona?.id_persona) throw new Error("El servidor no devolvió ID de propietario.");
    llenarFormularioPropietarioCambioNombre(persona);
    msgCambioNombreCatalogo("Propietario creado en catálogo y listo para la solicitud.", true);
    await buscarPropietariosCatalogoCambioNombre();
  } catch (e) {
    msgCambioNombreCatalogo(e.message || "Error al crear propietario.", false);
  }
}
window.crearPropietarioCatalogoCambioNombre = crearPropietarioCatalogoCambioNombre;

function renderSugerenciasCambioNombre(contenedorId, valores, campoId, modo) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  if (!valores?.length) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML = valores.map(v => `
    <button type="button" class="mov-cat-sug-item" data-campo="${escapeHtml(campoId)}" data-modo="${escapeHtml(modo || "reemplazar")}" data-valor="${escapeHtml(v)}">${escapeHtml(v)}</button>
  `).join("");
  cont.querySelectorAll(".mov-cat-sug-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const el = document.getElementById(btn.dataset.campo);
      if (!el) return;
      if (btn.dataset.modo === "agregar") {
        const partes = normalizarTextoPersonaInput(el.value).split(" ").filter(Boolean);
        el.value = partes.length ? partes.slice(0, -1).concat(btn.dataset.valor).join(" ") : btn.dataset.valor;
      } else {
        el.value = btn.dataset.valor;
      }
      document.querySelectorAll(".mov-cat-sugerencias").forEach(n => n.innerHTML = "");
      generarNombreCambioNombreModal();
    });
  });
}

async function buscarCatalogoApellidosCambioNombre(tipo, valor) {
  const contId = tipo === "materno" ? "modalMovSugApMat" : "modalMovSugApPat";
  const campoId = tipo === "materno" ? "modalMovSegundoApellido" : "modalMovPrimerApellido";
  const texto = normalizarTextoPersonaInput(valor);
  generarNombreCambioNombreModal();
  clearTimeout(cambioNombreCatalogoTimer);
  if (texto.length < 2) {
    renderSugerenciasCambioNombre(contId, [], campoId);
    return;
  }
  cambioNombreCatalogoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/propietarios/catalogo/apellidos?q=${encodeURIComponent(texto)}&tipo=${encodeURIComponent(tipo)}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      renderSugerenciasCambioNombre(contId, data.valores || [], campoId, "reemplazar");
    } catch (e) {
      renderSugerenciasCambioNombre(contId, [], campoId);
    }
  }, 220);
}

async function buscarCatalogoNombresCambioNombre(valor) {
  const texto = normalizarTextoPersonaInput(valor);
  generarNombreCambioNombreModal();
  clearTimeout(cambioNombreCatalogoTimer);
  if (texto.length < 2) {
    renderSugerenciasCambioNombre("modalMovSugNombres", [], "modalMovNombres");
    return;
  }
  const token = texto.split(" ").pop() || texto;
  cambioNombreCatalogoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/propietarios/catalogo/nombres?q=${encodeURIComponent(token)}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      renderSugerenciasCambioNombre("modalMovSugNombres", data.valores || [], "modalMovNombres", "agregar");
    } catch (e) {
      renderSugerenciasCambioNombre("modalMovSugNombres", [], "modalMovNombres");
    }
  }, 220);
}

async function buscarCatalogoRazonSocialCambioNombre(valor) {
  const texto = normalizarTextoPersonaInput(valor);
  generarNombreCambioNombreModal();
  clearTimeout(cambioNombreCatalogoTimer);
  if (texto.length < 2) {
    renderSugerenciasCambioNombre("modalMovSugRazon", [], "modalMovRazonSocial");
    return;
  }
  cambioNombreCatalogoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/propietarios/catalogo/razones-sociales?q=${encodeURIComponent(texto)}&_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      renderSugerenciasCambioNombre("modalMovSugRazon", data.valores || [], "modalMovRazonSocial", "reemplazar");
    } catch (e) {
      renderSugerenciasCambioNombre("modalMovSugRazon", [], "modalMovRazonSocial");
    }
  }, 220);
}

function configurarEntradasPersonaCambioNombreModal() {
  if (cambioNombreEntradasConfiguradas) return;
  const modal = document.getElementById("modalMovimientoNombre");
  if (!modal) return;
  cambioNombreEntradasConfiguradas = true;

  [
    { id: "modalMovPrimerApellido", fn: v => buscarCatalogoApellidosCambioNombre("paterno", v) },
    { id: "modalMovSegundoApellido", fn: v => buscarCatalogoApellidosCambioNombre("materno", v) },
    { id: "modalMovNombres", fn: buscarCatalogoNombresCambioNombre },
    { id: "modalMovRazonSocial", fn: buscarCatalogoRazonSocialCambioNombre }
  ].forEach(({ id, fn }) => {
    const el = modal.querySelector("#" + id);
    if (!el) return;
    el.addEventListener("input", () => {
      el.value = normalizarTextoPersonaInput(el.value);
      fn(el.value);
      limpiarSeleccionTitularCambioNombre();
    });
    el.addEventListener("blur", () => {
      el.value = normalizarPersonaCatalogo(el.value);
      generarNombreCambioNombreModal();
    });
  });

  ["modalMovRFC", "modalMovCURP"].forEach(id => {
    const el = modal.querySelector("#" + id);
    if (!el) return;
    el.addEventListener("input", () => { el.value = normalizarPersonaCatalogo(el.value); });
  });

  const buscar = modal.querySelector("#modalMovBuscarTexto");
  if (buscar) {
    buscar.addEventListener("input", () => {
      buscar.value = normalizarTextoPersonaInput(buscar.value);
      if (cambioNombreBuscarTimer) clearTimeout(cambioNombreBuscarTimer);
      const texto = normalizarPersonaCatalogo(buscar.value);
      if (texto.length >= 2) {
        cambioNombreBuscarTimer = setTimeout(() => buscarPropietariosCatalogoCambioNombre(), 400);
      }
    });
  }
}

function abrirModalCambioNombreV28b() {
  const modal = document.getElementById('modalMovimientoNombre');
  if (!modal) {
    alert('No se encontró el modal de cambio de nombre en index.html.');
    return;
  }

  const clave = String(
    (typeof obtenerClaveParaMovimiento === "function" ? obtenerClaveParaMovimiento() : "") ||
    document.getElementById("claveInput")?.value ||
    window.predioSeleccionado?.clave_catastral ||
    ""
  ).trim().toUpperCase();

  const nombreActual = obtenerNombreSeleccionadoActualV28b();

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setVal('modalMovClave', clave);
  setVal('modalMovNombreActual', nombreActual);
  limpiarFormularioCambioNombreTitular();
  setVal('modalMovMotivo', 'ACTUALIZACION');
  setVal('modalMovObservaciones', '');

  const msg = document.getElementById('modalMovMensaje');
  if (msg) { msg.textContent = ''; msg.className = 'modal-mov-msg'; }

  if (typeof cambiarTipoPersonaModal === 'function') cambiarTipoPersonaModal();
  if (typeof bindPersonaModalInputs === 'function') bindPersonaModalInputs();
  if (typeof activarMayusculasOperativas === 'function') activarMayusculasOperativas(modal);
  configurarEntradasPersonaCambioNombreModal();

  modal.classList.remove('oculto');
  modal.style.display = '';

  setTimeout(() => {
    document.getElementById('modalMovBuscarTexto')?.focus();
  }, 150);
}

abrirModalCambioNombre = abrirModalCambioNombreV28b;
window.abrirModalCambioNombre = abrirModalCambioNombreV28b;

// Mantener botón de cambio de nombre ligado aunque el HTML haya cargado antes/después del JS.
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn-modal-test');
  if (!btn) return;
  if ((btn.textContent || '').toUpperCase().includes('CAMBIO DE NOMBRE')) {
    e.preventDefault();
    abrirModalCambioNombreV28b();
  }
});

/* El refresco automático al cargar provocaba saltos de selección; usar selección explícita del usuario. */

/* ============================================================
   v28c - Restaurar guardado del modal Cambio de Nombre/Titular
============================================================ */
function authHeaders() {
  const token = (typeof obtenerTokenInstitucional === 'function') ? obtenerTokenInstitucional() : (localStorage.getItem('catastro_bc_token') || '');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}
window.authHeaders = authHeaders;

function cerrarModalCambioNombre() {
  const modal = document.getElementById('modalMovimientoNombre');
  if (modal) modal.classList.add('oculto');
}
window.cerrarModalCambioNombre = cerrarModalCambioNombre;

function mayusModalValor(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim().toUpperCase() : '';
}

function setModalMensajeCambio(texto, tipo) {
  const msg = document.getElementById('modalMovMensaje');
  if (!msg) return;
  msg.textContent = texto || '';
  msg.className = 'modal-mov-msg ' + (tipo || '');
}

function cambiarTipoPersonaModal() {
  const tipo = mayusModalValor('modalMovTipoPersona') || 'FISICA';
  const fisica = document.getElementById('bloquePersonaFisica');
  const moral = document.getElementById('bloquePersonaMoral');
  if (fisica) fisica.classList.toggle('oculto', tipo === 'MORAL');
  if (moral) moral.classList.toggle('oculto', tipo !== 'MORAL');
  document.querySelectorAll('.mov-cat-sugerencias').forEach(n => n.innerHTML = '');
  generarNombreCambioNombreModal();
}
window.cambiarTipoPersonaModal = cambiarTipoPersonaModal;

function generarNombreCambioNombreModal() {
  const tipo = mayusModalValor('modalMovTipoPersona') || 'FISICA';
  let nombre = '';
  if (tipo === 'MORAL') {
    nombre = mayusModalValor('modalMovRazonSocial');
  } else {
    nombre = [
      mayusModalValor('modalMovPrimerApellido'),
      mayusModalValor('modalMovSegundoApellido'),
      mayusModalValor('modalMovNombres')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }
  const out = document.getElementById('modalMovNombreNuevo');
  if (out) out.value = nombre;
  return nombre;
}
window.generarNombreCambioNombreModal = generarNombreCambioNombreModal;

function activarMayusculasOperativas(scope) {
  const root = scope || document;
  root.querySelectorAll('input[type="text"], textarea').forEach(el => {
    if (el.dataset.mayusBind === '1') return;
    el.dataset.mayusBind = '1';
    el.addEventListener('input', () => {
      const pos = el.selectionStart;
      el.value = String(el.value || '').toUpperCase();
      try { el.setSelectionRange(pos, pos); } catch(e) {}
      if (el.id && ['modalMovPrimerApellido','modalMovSegundoApellido','modalMovNombres','modalMovRazonSocial'].includes(el.id)) {
        generarNombreCambioNombreModal();
        if (typeof limpiarSeleccionTitularCambioNombre === 'function') limpiarSeleccionTitularCambioNombre();
      }
    });
  });
}
window.activarMayusculasOperativas = activarMayusculasOperativas;

function bindPersonaModalInputs() {
  ['modalMovPrimerApellido','modalMovSegundoApellido','modalMovNombres','modalMovRazonSocial'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.nombreBind === '1') return;
    el.dataset.nombreBind = '1';
    el.addEventListener('input', generarNombreCambioNombreModal);
    el.addEventListener('change', generarNombreCambioNombreModal);
  });
}
window.bindPersonaModalInputs = bindPersonaModalInputs;

async function guardarCambioNombreModal() {
  try {
    setModalMensajeCambio('', '');

    const clave = mayusModalValor('modalMovClave');
    const tipoPersona = mayusModalValor('modalMovTipoPersona') || 'FISICA';
    const nombreActual = mayusModalValor('modalMovNombreActual');
    const nombreNuevo = generarNombreCambioNombreModal();
    const rfc = mayusModalValor('modalMovRFC');
    const motivo = mayusModalValor('modalMovMotivo') || 'ACTUALIZACION';
    const observaciones = mayusModalValor('modalMovObservaciones');

    if (!clave) {
      setModalMensajeCambio('Falta la clave catastral.', 'error');
      return;
    }
    if (!nombreNuevo && !rfc) {
      setModalMensajeCambio('Captura un nombre nuevo o RFC para guardar la solicitud.', 'error');
      return;
    }

    const datosNuevos = {
      tipo_persona: tipoPersona,
      nombre_propietario: nombreNuevo || nombreActual,
      nombre_completo: nombreNuevo || nombreActual,
      rfc: rfc,
      primer_apellido: mayusModalValor('modalMovPrimerApellido'),
      segundo_apellido: mayusModalValor('modalMovSegundoApellido'),
      nombres: mayusModalValor('modalMovNombres'),
      razon_social: mayusModalValor('modalMovRazonSocial')
    };

    const detalles = [];
    if (nombreNuevo) {
      detalles.push({
        grupo: 'TITULARIDAD',
        campo: 'nombre_completo',
        etiqueta: 'Nombre / Titular',
        valor_anterior: nombreActual,
        valor_nuevo: nombreNuevo,
        tipo_dato: 'texto',
        requiere_validacion: true
      });
    }
    if (rfc) {
      detalles.push({
        grupo: 'TITULARIDAD',
        campo: 'rfc',
        etiqueta: 'RFC',
        valor_anterior: '',
        valor_nuevo: rfc,
        tipo_dato: 'texto',
        requiere_validacion: false
      });
    }

    const payload = {
      clave_catastral: clave,
      clave_catastral_anterior: clave,
      clave_catastral_nueva: null,
      tipo_movimiento: 'CAMBIO_NOMBRE',
      motivo: motivo,
      observaciones: observaciones,
      datos_anteriores: {
        nombre_completo: nombreActual
      },
      datos_nuevos: datosNuevos,
      detalles: detalles
    };

    const btn = document.querySelector('#modalMovimientoNombre .btn-modal-principal');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    const r = await fetch(`${API}/movimientos`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    let data = null;
    try { data = await r.json(); } catch(e) { data = { detail: await r.text() }; }

    if (!r.ok) {
      throw new Error(data?.detail || `HTTP ${r.status}`);
    }

    setModalMensajeCambio(`Solicitud guardada correctamente: ${data.folio || ('ID ' + data.id)}`, 'ok');

    if (typeof cargarHistorialMovimientos === 'function') cargarHistorialMovimientos(clave);
    if (typeof cargarMovimientosHistorial === 'function') cargarMovimientosHistorial(clave);
    if (typeof cargarMovimientos === 'function') cargarMovimientos(clave);

    setTimeout(() => {
      cerrarModalCambioNombre();
    }, 900);

  } catch (e) {
    console.error('Error guardando cambio de nombre:', e);
    setModalMensajeCambio(e.message || String(e), 'error');
  } finally {
    const btn = document.querySelector('#modalMovimientoNombre .btn-modal-principal');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar solicitud'; }
  }
}
window.guardarCambioNombreModal = guardarCambioNombreModal;

setTimeout(() => {
  const modal = document.getElementById('modalMovimientoNombre');
  if (modal) {
    activarMayusculasOperativas(modal);
    bindPersonaModalInputs();
    cambiarTipoPersonaModal();
  }
}, 500);

/* ============================================================
   FIX FINAL v28d - Restaurar guardar solicitud + seguimiento
============================================================ */
window.guardarCambioNombreModal = async function() {
  const clave = document.getElementById("modalMovClave")?.value?.trim().toUpperCase() || "";
  const nombreActual = document.getElementById("modalMovNombreActual")?.value?.trim().toUpperCase() || "";
  const tipoPersona = document.getElementById("modalMovTipoPersona")?.value || "FISICA";

  const primerApellido = document.getElementById("modalMovPrimerApellido")?.value?.trim().toUpperCase() || "";
  const segundoApellido = document.getElementById("modalMovSegundoApellido")?.value?.trim().toUpperCase() || "";
  const nombres = document.getElementById("modalMovNombres")?.value?.trim().toUpperCase() || "";
  const nombreGenerado = document.getElementById("modalMovNombreNuevo")?.value?.trim().toUpperCase() || "";

  const rfc = document.getElementById("modalMovRFC")?.value?.trim().toUpperCase() || "";
  const motivo = document.getElementById("modalMovMotivo")?.value?.trim().toUpperCase() || "ACTUALIZACION";
  const observaciones = document.getElementById("modalMovObservaciones")?.value?.trim().toUpperCase() || "";

  if (!clave) {
    modalMovimientoMensaje("INDICA LA CLAVE CATASTRAL.", false);
    return;
  }

  if (!nombreGenerado) {
    modalMovimientoMensaje("CAPTURA EL NOMBRE NUEVO.", false);
    return;
  }

  const payload = {
    clave_catastral: clave,
    clave_catastral_anterior: clave,
    clave_catastral_nueva: null,
    tipo_movimiento: "CAMBIO_NOMBRE",
    motivo,
    observaciones,
    datos_anteriores: {
      nombre_propietario: nombreActual
    },
    datos_nuevos: {
      nombre_propietario: nombreGenerado,
      nombre_completo: nombreGenerado,
      tipo_persona: tipoPersona,
      primer_apellido: primerApellido,
      segundo_apellido: segundoApellido,
      nombres: nombres,
      rfc: rfc
    },
    detalles: [
      {
        grupo: "TITULARIDAD",
        campo: "nombre_propietario",
        etiqueta: "NOMBRE / TITULAR",
        valor_anterior: nombreActual,
        valor_nuevo: nombreGenerado,
        tipo_dato: "texto",
        requiere_validacion: true
      },
      {
        grupo: "TITULARIDAD",
        campo: "rfc",
        etiqueta: "RFC",
        valor_anterior: "",
        valor_nuevo: rfc,
        tipo_dato: "texto",
        requiere_validacion: false
      }
    ]
  };

  try {
    const r = await fetch(`${API}/movimientos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();

    if (!r.ok) {
      throw new Error(data.detail || data.message || "NO SE PUDO GUARDAR LA SOLICITUD.");
    }

    const movimiento = data.movimiento || data;

    modalMovimientoMensaje(`SOLICITUD CREADA CORRECTAMENTE: ${movimiento.folio || ""}`, true);

    if (typeof cargarMovimientosPadron === "function") {
      await cargarMovimientosPadron();
    }

    setTimeout(() => {
      if (typeof cerrarModalCambioNombre === "function") cerrarModalCambioNombre();

      if (typeof abrirModalSeguimientoMovimiento === "function") {
        abrirModalSeguimientoMovimiento(movimiento);
      }
    }, 700);

  } catch (e) {
    modalMovimientoMensaje(e.message || "ERROR AL GUARDAR SOLICITUD.", false);
  }
};
window.modalMovimientoMensaje = window.modalMovimientoMensaje || function(msg, ok) {
  alert(msg);
};

/* ============================================================
   FIX v28e - Guardar cambio nombre sin doble POST
============================================================ */

window.modalMovimientoMensaje = function(msg, ok = true) {
  const el =
    document.getElementById("modalMovimientoMensaje") ||
    document.getElementById("modalMovMensaje") ||
    document.getElementById("movimientoModalMensaje");

  if (el) {
    el.textContent = msg;
    el.style.display = "block";
    el.style.color = ok ? "#166534" : "#991b1b";
    el.style.background = ok ? "#dcfce7" : "#fee2e2";
    el.style.border = ok ? "1px solid #86efac" : "1px solid #fecaca";
    el.style.padding = "10px";
    el.style.borderRadius = "8px";
  } else {
    alert(msg);
  }
};

window.__guardandoCambioNombre = false;

window.guardarCambioNombreModal = async function() {
  if (window.__guardandoCambioNombre) return;
  window.__guardandoCambioNombre = true;

  try {
    const clave = document.getElementById("modalMovClave")?.value?.trim().toUpperCase() || "";
    const nombreActual = document.getElementById("modalMovNombreActual")?.value?.trim().toUpperCase() || "";
    const tipoPersona = document.getElementById("modalMovTipoPersona")?.value || "FISICA";

    const primerApellido = document.getElementById("modalMovPrimerApellido")?.value?.trim().toUpperCase() || "";
    const segundoApellido = document.getElementById("modalMovSegundoApellido")?.value?.trim().toUpperCase() || "";
    const nombres = document.getElementById("modalMovNombres")?.value?.trim().toUpperCase() || "";
    const razonSocial = document.getElementById("modalMovRazonSocial")?.value?.trim().toUpperCase() || "";
    const nombreGenerado = document.getElementById("modalMovNombreNuevo")?.value?.trim().toUpperCase() || "";
    const idPersona = document.getElementById("modalMovIdPersona")?.value?.trim() || "";
    const curp = document.getElementById("modalMovCURP")?.value?.trim().toUpperCase() || "";

    const rfc = document.getElementById("modalMovRFC")?.value?.trim().toUpperCase() || "";
    const motivo = document.getElementById("modalMovMotivo")?.value?.trim().toUpperCase() || "ACTUALIZACION";
    const observaciones = document.getElementById("modalMovObservaciones")?.value?.trim().toUpperCase() || "";

    if (!clave) throw new Error("INDICA LA CLAVE CATASTRAL.");
    if (!nombreGenerado) throw new Error("CAPTURA EL NOMBRE NUEVO.");

    const payload = {
      clave_catastral: clave,
      clave_catastral_anterior: clave,
      clave_catastral_nueva: null,
      tipo_movimiento: "CAMBIO_NOMBRE",
      motivo,
      observaciones,
      datos_anteriores: {
        nombre_propietario: nombreActual
      },
      datos_nuevos: {
        nombre_propietario: nombreGenerado,
        nombre_completo: nombreGenerado,
        tipo_persona: tipoPersona,
        primer_apellido: primerApellido,
        segundo_apellido: segundoApellido,
        nombres: nombres,
        razon_social: razonSocial,
        rfc: rfc,
        curp: curp,
        id_persona: idPersona ? Number(idPersona) : null
      },
      detalles: [
        {
          grupo: "TITULARIDAD",
          campo: "nombre_propietario",
          etiqueta: "NOMBRE / TITULAR",
          valor_anterior: nombreActual,
          valor_nuevo: nombreGenerado,
          tipo_dato: "texto",
          requiere_validacion: true
        },
        {
          grupo: "TITULARIDAD",
          campo: "rfc",
          etiqueta: "RFC",
          valor_anterior: "",
          valor_nuevo: rfc,
          tipo_dato: "texto",
          requiere_validacion: false
        }
      ]
    };

    const r = await fetch(`${API}/movimientos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify(payload)
    });

    const txt = await r.text();
    let data = {};
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      throw new Error(txt || "ERROR INTERNO DEL SERVIDOR");
    }

    if (!r.ok) {
      throw new Error(data.detail || data.message || "NO SE PUDO GUARDAR LA SOLICITUD.");
    }

    const mov = data.movimiento || data;

    modalMovimientoMensaje(`SOLICITUD CREADA CORRECTAMENTE: ${mov.folio || ""}`, true);

    if (typeof cargarMovimientosPadron === "function") {
      await cargarMovimientosPadron(clave);
    }

    setTimeout(() => {
      if (typeof cerrarModalCambioNombre === "function") cerrarModalCambioNombre();

      if (typeof abrirModalSeguimientoMovimiento === "function") {
        abrirModalSeguimientoMovimiento(mov);
      }
    }, 700);

  } catch (e) {
    console.error("ERROR guardarCambioNombreModal:", e);
    modalMovimientoMensaje(e.message || "ERROR AL GUARDAR SOLICITUD.", false);
  } finally {
    setTimeout(() => {
      window.__guardandoCambioNombre = false;
    }, 1000);
  }
};


/* ============================================================
   FIX A - Helpers que faltaban (escapeHtml, authJsonHeaders,
   obtenerClaveSeleccionadaActual)
   Se usaban en el módulo de copropietarios pero nunca se definían.
============================================================ */
function escapeHtml(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
window.escapeHtml = escapeHtml;

function authJsonHeaders() {
  // authHeaders() ya incluye Content-Type: application/json + Authorization.
  return authHeaders();
}
window.authJsonHeaders = authJsonHeaders;

function obtenerClaveSeleccionadaActual() {
  if (claveSeleccionadaActual) return claveSeleccionadaActual;

  try {
    if (typeof obtenerClaveSeleccionadaPDF === "function") {
      const c = obtenerClaveSeleccionadaPDF();
      if (c) return c;
    }
  } catch (e) {}

  const inputClave = document.getElementById("claveInput")?.value?.trim();
  if (inputClave) return inputClave;

  const fichaClave = document.getElementById("fichaFlotanteClave")?.innerText?.trim();
  if (fichaClave && fichaClave.toUpperCase() !== "SIN SELECCIÓN") return fichaClave;

  try {
    const f = vectorSource.getFeatures().find(x => x.get("seleccionado") === true);
    if (f) return f.get("clave_catastral") || "";
  } catch (e) {}

  return "";
}
window.obtenerClaveSeleccionadaActual = obtenerClaveSeleccionadaActual;

function claveActivaPredioSeleccionado() {
  const candidatos = [
    claveSeleccionadaActual,
    typeof obtenerClaveSeleccionadaActual === "function" ? obtenerClaveSeleccionadaActual() : "",
    document.getElementById("claveInput")?.value,
    document.getElementById("fichaFlotanteClave")?.innerText
  ];

  for (let i = 0; i < candidatos.length; i++) {
    const norm = String(candidatos[i] || "").trim().toUpperCase();
    if (norm && norm !== "SIN SELECCIÓN") return norm;
  }
  return "";
}

function sincronizarClavesMovimientoConPredioActivo() {
  const clave = claveActivaPredioSeleccionado();
  if (!clave) return "";
  return clave;
}
window.sincronizarClavesMovimientoConPredioActivo = sincronizarClavesMovimientoConPredioActivo;

function obtenerClaveParaMovimiento() {
  const activa = sincronizarClavesMovimientoConPredioActivo();
  if (activa) return activa;
  return claveActivaPredioSeleccionado();
}
window.obtenerClaveParaMovimiento = obtenerClaveParaMovimiento;


/* ============================================================
   FIX A - Módulo de Movimientos catastrales (pestaña Movimientos)
   Implementa funciones que el HTML invocaba pero no existían:
   agregarDetalleMovimiento, quitarDetalleMovimiento,
   crearMovimientoPadron, cargarMovimientosPadron.
============================================================ */
let movDetallesPendientes = [];

function setMovMensaje(texto, tipo = "") {
  const el = document.getElementById("movMensaje");
  if (!el) return;
  el.innerText = texto || "";
  el.className = "admin-mensaje " + tipo;
}

function renderDetallesMovimiento() {
  const cont = document.getElementById("movDetallesLista");
  if (!cont) return;

  if (!movDetallesPendientes.length) {
    cont.innerHTML = '<div class="mov-empty">Sin campos agregados.</div>';
    return;
  }

  cont.innerHTML = movDetallesPendientes.map((d, i) => `
    <div class="mov-item">
      <div class="mov-item-info">
        <b>${escapeHtml(d.etiqueta || d.campo)}</b>
        <span>${escapeHtml(d.valor_nuevo)}</span>
      </div>
      <button type="button" class="btn-del-mov" onclick="quitarDetalleMovimiento(${i})">×</button>
    </div>
  `).join("");
}

function agregarDetalleMovimiento() {
  const selCampo = document.getElementById("movCampo");
  const campo = selCampo?.value || "";
  const etiqueta = selCampo?.options[selCampo.selectedIndex]?.text || campo;
  const valor = (document.getElementById("movValorNuevo")?.value || "").trim();

  if (!campo) {
    setMovMensaje("Selecciona un campo.", "error");
    return;
  }
  if (!valor) {
    setMovMensaje("Captura el valor nuevo.", "error");
    return;
  }

  movDetallesPendientes.push({
    grupo: "GENERAL",
    campo: campo,
    etiqueta: etiqueta,
    valor_anterior: "",
    valor_nuevo: valor.toUpperCase(),
    tipo_dato: "texto",
    requiere_validacion: false
  });

  const inputValor = document.getElementById("movValorNuevo");
  if (inputValor) inputValor.value = "";

  setMovMensaje("");
  renderDetallesMovimiento();
}
window.agregarDetalleMovimiento = agregarDetalleMovimiento;

function quitarDetalleMovimiento(idx) {
  movDetallesPendientes.splice(idx, 1);
  renderDetallesMovimiento();
}
window.quitarDetalleMovimiento = quitarDetalleMovimiento;

async function crearMovimientoPadron() {
  const clave = (typeof obtenerClaveParaMovimiento === "function" ? obtenerClaveParaMovimiento() : "").trim().toUpperCase();
  const claveNueva = (document.getElementById("movClaveNueva")?.value || "").trim().toUpperCase();
  const tipo = document.getElementById("movTipo")?.value || "";
  const motivo = (document.getElementById("movMotivo")?.value || "").trim().toUpperCase();
  const observaciones = (document.getElementById("movObservaciones")?.value || "").trim().toUpperCase();

  if (!clave) {
    setMovMensaje("Captura la clave catastral origen.", "error");
    return;
  }
  if (!tipo) {
    setMovMensaje("Selecciona el tipo de movimiento.", "error");
    return;
  }

  const datosNuevos = {};
  movDetallesPendientes.forEach(d => { datosNuevos[d.campo] = d.valor_nuevo; });
  if (claveNueva) datosNuevos.clave_catastral_nueva = claveNueva;

  const payload = {
    clave_catastral: clave,
    clave_catastral_anterior: clave,
    clave_catastral_nueva: claveNueva || null,
    tipo_movimiento: tipo,
    motivo: motivo,
    observaciones: observaciones,
    datos_anteriores: {},
    datos_nuevos: datosNuevos,
    detalles: movDetallesPendientes
  };

  try {
    setMovMensaje("Guardando movimiento...", "ok");

    const r = await fetch(`${API}/movimientos`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.detail || data.message || "No se pudo guardar el movimiento.");
    }

    const mov = data.movimiento || data;
    setMovMensaje(`Movimiento creado: ${mov.folio || ("ID " + mov.id)}`, "ok");

    movDetallesPendientes = [];
    renderDetallesMovimiento();
    const campos = ["movClaveNueva", "movMotivo", "movObservaciones", "movValorNuevo"];
    campos.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });

    await cargarMovimientosPadron(clave);

    if (typeof abrirModalSeguimientoMovimiento === "function") {
      abrirModalSeguimientoMovimiento(mov);
    }

  } catch (e) {
    console.error("Error creando movimiento:", e);
    setMovMensaje(e.message || "Error al guardar el movimiento.", "error");
  }
}
window.crearMovimientoPadron = crearMovimientoPadron;

function puedeAutorizarAplicarMovimientos() {
  return ["admin", "supervisor"].includes(obtenerRolSesion());
}

function nombreEstadoMovimiento(estado) {
  const mapa = {
    BORRADOR: "Borrador",
    EN_REVISION: "En revisión",
    OBSERVADO: "Observado",
    AUTORIZADO: "Autorizado",
    RECHAZADO: "Rechazado",
    APLICADO: "Aplicado al padrón",
    CANCELADO: "Cancelado"
  };
  const e = String(estado || "BORRADOR").toUpperCase();
  return mapa[e] || estado || "BORRADOR";
}

function formatearFechaMovimiento(fecha) {
  if (!fecha) return "Sin fecha";
  try {
    return new Date(fecha).toLocaleString("es-MX");
  } catch (e) {
    return String(fecha);
  }
}

const gestorMovimientosCache = {};
let gestorMovimientoSeleccionado = null;

function registrarMovimientoEnCache(m) {
  if (m && m.id != null) gestorMovimientosCache[m.id] = m;
}

function puedeAplicarEstadoMovimiento(estado) {
  return !["APLICADO", "RECHAZADO", "CANCELADO"].includes(String(estado || "").toUpperCase());
}

function puedeAutorizarEstadoMovimiento(estado) {
  return ["BORRADOR", "EN_REVISION", "OBSERVADO"].includes(String(estado || "").toUpperCase());
}

async function fetchMovimientosLista(filtroClave, filtroEstado) {
  let url = `${API}/movimientos?limite=200&_=${Date.now()}`;
  if (filtroClave) url += `&clave=${encodeURIComponent(filtroClave)}`;
  if (filtroEstado && filtroEstado !== "PENDIENTES") url += `&estado=${encodeURIComponent(filtroEstado)}`;

  const r = await fetch(url, { cache: "no-store", headers: authHeaders() });
  if (!r.ok) {
    const err = await r.json().catch(function() { return {}; });
    throw new Error(err.detail || "No se pudieron cargar los movimientos.");
  }

  const data = await r.json();
  let rows = Array.isArray(data) ? data : (data.movimientos || []);
  if (filtroEstado === "PENDIENTES") {
    rows = rows.filter(function(m) {
      return puedeAplicarEstadoMovimiento(m.estado);
    });
  }
  return rows;
}

function renderTablaMovimientosHtml(rows, opts) {
  opts = opts || {};
  const compacto = !!opts.compacto;
  const selectedId = opts.selectedId;

  if (!rows.length) {
    return "<div class='gestor-mov-placeholder'>Sin movimientos registrados.</div>";
  }

  rows.forEach(registrarMovimientoEnCache);

  let html = `
    <table class="admin-table movimientos-table ${compacto ? "movimientos-table-compact" : ""}">
      <thead>
        <tr>
          <th>Folio</th>
          <th>Clave</th>
          <th>Tipo</th>
          <th>Estado</th>
          ${compacto ? "" : "<th>Fecha</th>"}
          ${compacto ? "" : "<th>Acciones</th>"}
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach(function(m) {
    const estado = String(m.estado || "BORRADOR");
    const estadoClass = estado.toLowerCase();
    const fecha = formatearFechaMovimiento(m.fecha_solicitud);
    const selected = selectedId && Number(selectedId) === Number(m.id) ? " mov-row-selected" : "";
    const puedeAplicar = puedeAplicarEstadoMovimiento(estado);

    html += `
      <tr class="mov-row-gestor${selected}" data-mov-id="${m.id}" onclick="seleccionarMovimientoGestor(${m.id})">
        <td><b>${escapeHtml(m.folio || ("ID " + m.id))}</b></td>
        <td>${escapeHtml(m.clave_catastral || "")}</td>
        <td>${escapeHtml(m.tipo_movimiento_nombre || m.tipo_movimiento || "")}</td>
        <td><span class="mov-estado ${estadoClass}">${escapeHtml(m.estado_nombre || nombreEstadoMovimiento(estado))}</span></td>
        ${compacto ? "" : `<td>${fecha}</td>`}
        ${compacto ? "" : `
          <td class="mov-acciones-inline" onclick="event.stopPropagation()">
            <button type="button" title="Ver detalle" onclick="seleccionarMovimientoGestor(${m.id})">📋</button>
            ${puedeAplicar ? `<button type="button" class="btn-mini-aplicar" onclick="abrirModalAplicarMovimientoPorId(${m.id})">Aplicar</button>` : ""}
          </td>`}
      </tr>
    `;
  });

  html += "</tbody></table>";
  return html;
}

async function cargarMovimientosPadron(clave = null) {
  const cont = document.getElementById("movimientosTabla");
  if (!cont) return;

  const filtroClave = clave !== null && clave !== undefined && clave !== ""
    ? clave
    : (typeof claveActivaPredioSeleccionado === "function" ? claveActivaPredioSeleccionado() : "");

  cont.innerHTML = "<div style='padding:10px;'>Cargando movimientos...</div>";

  try {
    const rows = await fetchMovimientosLista(filtroClave, "");
    cont.innerHTML = renderTablaMovimientosHtml(rows);
  } catch (e) {
    console.error(e);
    cont.innerHTML = `<div style="padding:10px;color:#991b1b;">${escapeHtml(e.message)}</div>`;
  }
}
window.cargarMovimientosPadron = cargarMovimientosPadron;


/* ============================================================
   v57g - Modal gestor de movimientos
============================================================ */
function setGestorMovMensaje(texto, ok) {
  const el = document.getElementById("gestorMovMensaje");
  if (!el) return;
  el.textContent = texto || "";
  el.className = "modal-mov-msg " + (ok ? "ok" : "error");
}

function obtenerClaveParaGestorMovimientos(claveExplicita) {
  if (claveExplicita) return String(claveExplicita).trim().toUpperCase();
  const activa = typeof sincronizarClavesMovimientoConPredioActivo === "function"
    ? sincronizarClavesMovimientoConPredioActivo()
    : "";
  if (activa) return activa;
  return claveActivaPredioSeleccionado();
}

function abrirModalGestorMovimientos(clave) {
  const modal = document.getElementById("modalGestorMovimientos");
  if (!modal) return;

  const claveFiltro = obtenerClaveParaGestorMovimientos(clave);
  const input = document.getElementById("gestorMovFiltroClave");
  if (input) input.value = claveFiltro;

  const estadoSel = document.getElementById("gestorMovFiltroEstado");
  if (estadoSel && !estadoSel.value) estadoSel.value = "PENDIENTES";

  gestorMovimientoSeleccionado = null;
  const det = document.getElementById("gestorMovDetalle");
  if (det) {
    det.innerHTML = "<div class=\"gestor-mov-placeholder\">Seleccione un movimiento de la lista para ver detalle, autorizar o aplicar.</div>";
  }

  setGestorMovMensaje("", true);
  modal.classList.remove("oculto");
  cargarGestorMovimientos();
}
window.abrirModalGestorMovimientos = abrirModalGestorMovimientos;

function cerrarModalGestorMovimientos() {
  const modal = document.getElementById("modalGestorMovimientos");
  if (modal) modal.classList.add("oculto");
  gestorMovimientoSeleccionado = null;
  setGestorMovMensaje("", true);
}
window.cerrarModalGestorMovimientos = cerrarModalGestorMovimientos;

function abrirModalGestorMovimientosDesdeSeguimiento() {
  const clave = movimientoSeguimientoActual?.clave_catastral || "";
  cerrarModalSeguimientoMovimiento();
  abrirModalGestorMovimientos(clave);
}
window.abrirModalGestorMovimientosDesdeSeguimiento = abrirModalGestorMovimientosDesdeSeguimiento;

async function cargarGestorMovimientos() {
  const lista = document.getElementById("gestorMovLista");
  if (!lista) return;

  const filtroClave = (document.getElementById("gestorMovFiltroClave")?.value || "").trim();
  const filtroEstado = document.getElementById("gestorMovFiltroEstado")?.value || "";

  lista.innerHTML = "<div class=\"gestor-mov-placeholder\">Cargando movimientos...</div>";

  try {
    const rows = await fetchMovimientosLista(filtroClave, filtroEstado);
    lista.innerHTML = renderTablaMovimientosHtml(rows, {
      compacto: true,
      selectedId: gestorMovimientoSeleccionado?.id
    });

    if (gestorMovimientoSeleccionado?.id) {
      const still = rows.some(function(m) { return Number(m.id) === Number(gestorMovimientoSeleccionado.id); });
      if (still) {
        await seleccionarMovimientoGestor(gestorMovimientoSeleccionado.id, true);
      } else {
        gestorMovimientoSeleccionado = null;
      }
    }
  } catch (e) {
    lista.innerHTML = `<div class="gestor-mov-placeholder gestor-mov-error">${escapeHtml(e.message)}</div>`;
  }
}
window.cargarGestorMovimientos = cargarGestorMovimientos;

function renderDetallesMovimientoHtml(detalles) {
  if (!detalles || !detalles.length) {
    return "<div class=\"gestor-mov-sin-detalles\">Sin detalle de campos registrado.</div>";
  }

  let html = `
    <table class="admin-table gestor-mov-detalle-table">
      <thead>
        <tr><th>Campo</th><th>Anterior</th><th>Nuevo</th></tr>
      </thead>
      <tbody>
  `;

  detalles.forEach(function(d) {
    html += `
      <tr>
        <td>${escapeHtml(d.etiqueta || d.campo || "")}</td>
        <td>${escapeHtml(d.valor_anterior ?? "---")}</td>
        <td><b>${escapeHtml(d.valor_nuevo ?? "---")}</b></td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  return html;
}

function renderAccionesGestorMovHtml(mov) {
  if (!puedeAutorizarAplicarMovimientos()) {
    return "<div class=\"gestor-mov-permiso\">Su rol puede consultar movimientos. Solo admin o supervisor pueden autorizar y aplicar.</div>";
  }

  const estado = String(mov.estado || "BORRADOR").toUpperCase();
  const acciones = [];

  if (["BORRADOR", "OBSERVADO"].includes(estado)) {
    acciones.push(`<button type="button" onclick="cambiarEstadoMovimientoGestor(${mov.id}, 'EN_REVISION')">En revisión</button>`);
  }
  if (puedeAutorizarEstadoMovimiento(estado)) {
    acciones.push(`<button type="button" class="btn-gestor-autorizar" onclick="cambiarEstadoMovimientoGestor(${mov.id}, 'AUTORIZADO')">Autorizar</button>`);
    acciones.push(`<button type="button" class="btn-gestor-rechazar" onclick="cambiarEstadoMovimientoGestor(${mov.id}, 'RECHAZADO')">Rechazar</button>`);
  }
  if (puedeAplicarEstadoMovimiento(estado)) {
    acciones.push(`<button type="button" class="btn-gestor-aplicar principal" onclick="abrirModalAplicarMovimientoPorId(${mov.id})">Aplicar al padrón</button>`);
  }
  if (esMovimientoNumeroOficial(mov) && estado === "APLICADO") {
    acciones.push(`<button type="button" class="btn-gestor-cedula" onclick="imprimirCedulaNumeroOficialPorId(${mov.id})">🖨️ Cédula No. Oficial</button>`);
  }

  if (!acciones.length) {
    if (esMovimientoNumeroOficial(mov) && estado === "APLICADO") {
      return `<div class="gestor-mov-acciones"><button type="button" class="btn-gestor-cedula" onclick="imprimirCedulaNumeroOficialPorId(${mov.id})">🖨️ Cédula No. Oficial</button></div>`;
    }
    return "<div class=\"gestor-mov-permiso\">Este movimiento ya está cerrado (aplicado, rechazado o cancelado).</div>";
  }

  return `<div class="gestor-mov-acciones">${acciones.join("")}</div>`;
}

function renderPanelDetalleGestorMov(mov) {
  const cont = document.getElementById("gestorMovDetalle");
  if (!cont || !mov) return;

  const estado = String(mov.estado || "BORRADOR");
  const estadoClass = estado.toLowerCase();

  cont.innerHTML = `
    <div class="gestor-mov-detalle-head">
      <div>
        <div class="gestor-mov-detalle-folio">${escapeHtml(mov.folio || ("ID " + mov.id))}</div>
        <div class="gestor-mov-detalle-tipo">${escapeHtml(mov.tipo_movimiento_nombre || mov.tipo_movimiento || "")}</div>
      </div>
      <span class="mov-estado ${estadoClass}">${escapeHtml(mov.estado_nombre || nombreEstadoMovimiento(estado))}</span>
    </div>

    <div class="gestor-mov-meta">
      <div><span>Clave</span><b>${escapeHtml(mov.clave_catastral || "---")}</b></div>
      <div><span>Solicitud</span><b>${formatearFechaMovimiento(mov.fecha_solicitud)}</b></div>
      <div><span>Motivo</span><b>${escapeHtml(mov.motivo || "---")}</b></div>
      <div><span>Observaciones</span><b>${escapeHtml(mov.observaciones || "---")}</b></div>
    </div>

    <div class="section-label">Cambios solicitados</div>
    ${renderDetallesMovimientoHtml(mov.detalles)}

    ${renderAccionesGestorMovHtml(mov)}
  `;
}

async function seleccionarMovimientoGestor(id, silencioso) {
  const lista = document.getElementById("gestorMovLista");
  if (lista) {
    lista.querySelectorAll(".mov-row-gestor").forEach(function(tr) {
      tr.classList.toggle("mov-row-selected", Number(tr.dataset.movId) === Number(id));
    });
  }

  const det = document.getElementById("gestorMovDetalle");
  if (det) det.innerHTML = "<div class=\"gestor-mov-placeholder\">Cargando detalle...</div>";

  try {
    const r = await fetch(`${API}/movimientos/${encodeURIComponent(id)}?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    if (!r.ok) {
      const err = await r.json().catch(function() { return {}; });
      throw new Error(err.detail || "No se pudo cargar el movimiento.");
    }

    const mov = await r.json();
    gestorMovimientoSeleccionado = mov;
    registrarMovimientoEnCache(mov);
    renderPanelDetalleGestorMov(mov);
    if (!silencioso) setGestorMovMensaje("", true);
  } catch (e) {
    gestorMovimientoSeleccionado = null;
    if (det) det.innerHTML = `<div class="gestor-mov-placeholder gestor-mov-error">${escapeHtml(e.message)}</div>`;
    if (!silencioso) setGestorMovMensaje(e.message, false);
  }
}
window.seleccionarMovimientoGestor = seleccionarMovimientoGestor;

async function cambiarEstadoMovimientoGestor(id, nuevoEstado) {
  const etiquetas = {
    EN_REVISION: "enviar a revisión",
    AUTORIZADO: "autorizar",
    RECHAZADO: "rechazar",
    CANCELADO: "cancelar"
  };
  const accion = etiquetas[nuevoEstado] || "actualizar";
  if (!confirm("¿Confirma " + accion + " este movimiento?")) return;

  const obs = prompt("Observaciones (opcional):", "") || "";

  try {
    setGestorMovMensaje("Actualizando estado...", true);

    const r = await fetch(`${API}/movimientos/${encodeURIComponent(id)}/estado`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        estado: nuevoEstado,
        observaciones: obs.trim().toUpperCase()
      })
    });

    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(detalleErrorApi(data) || "No se pudo actualizar el estado.");

    const mov = data.movimiento || data;
    registrarMovimientoEnCache(mov);
    setGestorMovMensaje("Estado actualizado: " + nombreEstadoMovimiento(nuevoEstado), true);

    await cargarGestorMovimientos();
    await seleccionarMovimientoGestor(id, true);
    await cargarMovimientosPadron(mov.clave_catastral || null);

    const segModal = document.getElementById("modalSeguimientoMovimiento");
    if (segModal && !segModal.classList.contains("oculto")) {
      const setTxt = function(elId, v) {
        const el = document.getElementById(elId);
        if (el) el.innerText = v || "---";
      };
      setTxt("segMovEstado", mov.estado_nombre || nombreEstadoMovimiento(nuevoEstado));
      pintarEtapasSeguimiento(nuevoEstado);
      await cargarDetalleSeguimientoMovimiento(id);
    }

  } catch (e) {
    setGestorMovMensaje(e.message || String(e), false);
  }
}
window.cambiarEstadoMovimientoGestor = cambiarEstadoMovimientoGestor;

function abrirModalAplicarMovimientoPorId(id) {
  const mov = gestorMovimientosCache[id];
  if (mov) {
    abrirModalAplicarMovimiento(mov);
    return;
  }
  seleccionarMovimientoGestor(id, true).then(function() {
    if (gestorMovimientoSeleccionado) abrirModalAplicarMovimiento(gestorMovimientoSeleccionado);
  });
}
window.abrirModalAplicarMovimientoPorId = abrirModalAplicarMovimientoPorId;


/* ============================================================
   FIX A - Modal de seguimiento de movimiento
============================================================ */
let movimientoSeguimientoActual = null;

function pintarEtapasSeguimiento(estado) {
  const etapas = document.querySelectorAll("#modalSeguimientoMovimiento .etapa");
  if (!etapas.length) return;

  const mapa = {
    "BORRADOR": 1,
    "EN_REVISION": 2,
    "OBSERVADO": 2,
    "AUTORIZADO": 3,
    "RECHAZADO": 3,
    "APLICADO": 4,
    "CANCELADO": 1
  };
  const activa = mapa[String(estado || "BORRADOR").toUpperCase()] || 1;

  etapas.forEach((el, i) => {
    el.classList.toggle("activa", (i + 1) <= activa);
  });
}

function abrirModalSeguimientoMovimiento(mov) {
  const modal = document.getElementById("modalSeguimientoMovimiento");
  if (!modal) return;

  movimientoSeguimientoActual = mov || {};
  registrarMovimientoEnCache(mov);

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v || "---"; };
  setTxt("segMovFolio", mov?.folio || (mov?.id ? "ID " + mov.id : "---"));
  setTxt("segMovClave", mov?.clave_catastral);
  setTxt("segMovTipo", mov?.tipo_movimiento_nombre || mov?.tipo_movimiento);
  setTxt("segMovEstado", mov?.estado_nombre || nombreEstadoMovimiento(mov?.estado));

  pintarEtapasSeguimiento(mov?.estado);

  const detCont = document.getElementById("segMovDetalles");
  if (detCont) detCont.innerHTML = "";

  const accCont = document.getElementById("segMovAcciones");
  if (accCont) {
    accCont.innerHTML = "";
    accCont.classList.add("oculto");
  }

  modal.classList.remove("oculto");

  actualizarBotonCedulaNumeroOficial(mov);

  if (mov?.id) {
    cargarDetalleSeguimientoMovimiento(mov.id);
  }
}

async function cargarDetalleSeguimientoMovimiento(id) {
  const detCont = document.getElementById("segMovDetalles");
  const accCont = document.getElementById("segMovAcciones");
  if (!detCont) return;

  detCont.innerHTML = "<div class=\"gestor-mov-placeholder\">Cargando detalle...</div>";

  try {
    const r = await fetch(`${API}/movimientos/${encodeURIComponent(id)}?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    if (!r.ok) throw new Error("No se pudo cargar el detalle.");
    const mov = await r.json();
    movimientoSeguimientoActual = mov;
    registrarMovimientoEnCache(mov);

    detCont.innerHTML = renderDetallesMovimientoHtml(mov.detalles);

    if (accCont) {
      accCont.innerHTML = renderAccionesGestorMovHtml(mov);
      accCont.classList.remove("oculto");
    }
    actualizarBotonCedulaNumeroOficial(mov);
  } catch (e) {
    detCont.innerHTML = `<div class="gestor-mov-error">${escapeHtml(e.message)}</div>`;
  }
}
window.abrirModalSeguimientoMovimiento = abrirModalSeguimientoMovimiento;

function cerrarModalSeguimientoMovimiento() {
  const modal = document.getElementById("modalSeguimientoMovimiento");
  if (modal) modal.classList.add("oculto");
}
window.cerrarModalSeguimientoMovimiento = cerrarModalSeguimientoMovimiento;

function irHistorialMovimiento() {
  abrirModalGestorMovimientos(movimientoSeguimientoActual?.clave_catastral || "");
}
window.irHistorialMovimiento = irHistorialMovimiento;


/* ============================================================
   FIX A - Modal aplicar movimiento al padrón
============================================================ */
let movimientoAplicarActual = null;

function abrirModalAplicarMovimiento(mov) {
  const modal = document.getElementById("modalAplicarMovimiento");
  if (!modal) return;

  movimientoAplicarActual = mov || {};

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v || "---"; };
  setTxt("aplicarMovFolio", mov?.folio || (mov?.id ? "ID " + mov.id : "---"));
  setTxt("aplicarMovClave", mov?.clave_catastral);
  setTxt("aplicarMovTipo", mov?.tipo_movimiento_nombre || mov?.tipo_movimiento);

  const obs = document.getElementById("aplicarMovObservaciones");
  if (obs) obs.value = "";

  const msg = document.getElementById("aplicarMovMensaje");
  if (msg) { msg.textContent = ""; msg.className = "modal-mov-msg"; }

  modal.classList.remove("oculto");
}
window.abrirModalAplicarMovimiento = abrirModalAplicarMovimiento;

function cerrarModalAplicarMovimiento() {
  const modal = document.getElementById("modalAplicarMovimiento");
  if (modal) modal.classList.add("oculto");
}
window.cerrarModalAplicarMovimiento = cerrarModalAplicarMovimiento;

function setAplicarMovMensaje(texto, tipo = "") {
  const msg = document.getElementById("aplicarMovMensaje");
  if (!msg) return;
  msg.textContent = texto || "";
  msg.className = "modal-mov-msg " + tipo;
}

function detalleErrorApi(data) {
  if (!data) return "";
  const d = data.detail ?? data.message ?? data.mensaje;
  if (!d) return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(function(x) { return x.msg || x.message || JSON.stringify(x); }).join("; ");
  return JSON.stringify(d);
}

async function confirmarAplicarMovimientoModal() {
  const mov = movimientoAplicarActual;
  if (!mov || !mov.id) {
    setAplicarMovMensaje("No hay movimiento seleccionado.", "error");
    return;
  }

  const observaciones = (document.getElementById("aplicarMovObservaciones")?.value || "").trim().toUpperCase();

  try {
    setAplicarMovMensaje("Aplicando movimiento al padrón...", "");

    const r = await fetch(`${API}/movimientos/${encodeURIComponent(mov.id)}/aplicar`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ observaciones })
    });

    const raw = await r.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { detail: raw }; }

    if (!r.ok) {
      throw new Error(detalleErrorApi(data) || raw || ("Error HTTP " + r.status));
    }

    const actualizado = data.actualizado || {};
    const campos = ["sup_documental", "sup_fisica", "sup_const", "descripcion_uso", "id_tasa", "porcentaje_tasa", "zonah", "zona_homogenea", "numof", "valor2026"]
      .filter(function(c) { return actualizado[c] !== undefined && actualizado[c] !== null; })
      .map(function(c) { return c + ": " + actualizado[c]; })
      .join(", ");
    setAplicarMovMensaje(
      campos ? ("Movimiento aplicado. Actualizado: " + campos) : "Movimiento aplicado correctamente.",
      "ok"
    );

    await cargarMovimientosPadron(mov.clave_catastral || null);

    if (document.getElementById("modalGestorMovimientos") && !document.getElementById("modalGestorMovimientos").classList.contains("oculto")) {
      await cargarGestorMovimientos();
      if (mov.id) await seleccionarMovimientoGestor(mov.id, true);
    }

    if (mov.clave_catastral && typeof seleccionarPorClave === "function") {
      try { await seleccionarPorClave(mov.clave_catastral); } catch (e) {}
    }

    if (esMovimientoNumeroOficial(mov)) {
      setTimeout(function() {
        if (confirm("Movimiento aplicado. ¿Desea generar la cédula de número oficial para impresión y firma?")) {
          imprimirCedulaNumeroOficialPorId(mov.id);
        }
      }, 400);
    }

    setTimeout(cerrarModalAplicarMovimiento, 1200);

  } catch (e) {
    console.error("Error aplicando movimiento:", e);
    setAplicarMovMensaje(e.message || "Error al aplicar movimiento.", "error");
  }
}
window.confirmarAplicarMovimientoModal = confirmarAplicarMovimientoModal;


// Inicialización del módulo de movimientos al cargar.
setTimeout(() => {
  renderDetallesMovimiento();
}, 300);

/* ============================================================
   v57 - Modales guiados para movimientos al padron
============================================================ */
function esMovimientoNumeroOficial(mov) {
  const t = String(mov?.tipo_movimiento || "").toUpperCase();
  return t === "NUMERO_OFICIAL" || t.includes("NUMERO_OFICIAL");
}

function numeroOficialVacio(val) {
  const s = String(val ?? "").trim();
  return !s || s === "0" || s === "---" || s === "SIN NUMERO" || s === "S/N";
}

function resolverTipoNumeroOficial(ficha) {
  return numeroOficialVacio(ficha?.numof) ? "ASIGNACION_NUMERO_OFICIAL" : "CAMBIO_NUMERO_OFICIAL";
}

function obtenerDetalleNumofMovimiento(mov) {
  const det = mov?.detalles || [];
  const row = det.find(function(d) {
    const c = String(d.campo || "").toLowerCase();
    return c === "numof" || c === "numero_oficial";
  });
  if (row) {
    return {
      anterior: row.valor_anterior ?? "",
      nuevo: row.valor_nuevo ?? ""
    };
  }
  let dn = mov?.datos_nuevos || {};
  let da = mov?.datos_anteriores || {};
  if (typeof dn === "string") {
    try { dn = JSON.parse(dn); } catch (e) { dn = {}; }
  }
  if (typeof da === "string") {
    try { da = JSON.parse(da); } catch (e) { da = {}; }
  }
  return {
    anterior: da.numof ?? da.numero_oficial ?? "",
    nuevo: dn.numof ?? dn.numero_oficial ?? ""
  };
}

async function obtenerValorUnitarioZonaHomogenea(p, anio) {
  anio = anio || ANIO_FISCAL_ZONA_HOMOGENEA;
  const codigo = String(p.zona_homogenea || p.zonah || "").trim().toUpperCase();
  if (!codigo) return null;
  try {
    const zonas = await cargarCatalogoZonasHomogeneas(anio);
    const item = (zonas || []).find(function(z) {
      return String(z.codigo_zona_homogenea || z.zona_homogenea || "").toUpperCase() === codigo;
    });
    if (item && item.valor_m2 != null && item.valor_m2 !== "") {
      return Number(item.valor_m2);
    }
  } catch (e) {
    console.warn("No se pudo obtener valor de zona homogenea:", e);
  }
  return null;
}

async function calcularValoresFiscalesCedula(p) {
  const sup = Number(p.sup_documental || p.sup_fisica || 0);
  let valorUnit = await obtenerValorUnitarioZonaHomogenea(p, ANIO_FISCAL_ZONA_HOMOGENEA);
  if (valorUnit == null || isNaN(valorUnit)) {
    const v26 = Number(p.valor2026 || 0);
    if (v26 > 0 && sup > 0 && v26 / sup <= 50000) {
      valorUnit = v26 >= 500 ? v26 : (v26 / sup);
    }
  }
  const valorFiscal = (valorUnit != null && sup > 0) ? Math.round(valorUnit * sup * 100) / 100 : null;
  return { valorUnit: valorUnit, valorFiscal: valorFiscal, sup: sup };
}

async function cargarHistorialNumeroOficialHtml(clave, numofActual) {
  if (!clave) return "";
  try {
    const r = await fetch(`${API}/movimientos/historial/${encodeURIComponent(clave)}/numero-oficial?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) {
      return await cargarHistorialNumeroOficialHtmlLegacy(clave, numofActual);
    }
    const data = await r.json();
    const rows = data.historial || [];
    const items = [];
    rows.forEach(function(row) {
      const anterior = String(row.valor_anterior ?? "").trim();
      const nuevo = String(row.valor_nuevo ?? "").trim();
      if (!anterior && !nuevo) return;
      items.push({
        folio: row.folio || ("ID " + row.id),
        fecha: formatearFechaMovimiento(row.fecha_aplicacion || row.fecha_solicitud),
        estado: row.estado || "",
        anterior: anterior || "—",
        nuevo: nuevo || "—"
      });
    });
    if (!items.length && !numeroOficialVacio(numofActual)) {
      return `<div class="mov-numof-historial-vacio">Sin movimientos registrados aún. Número actual en padrón: <b>${escapeHtml(String(numofActual))}</b></div>`;
    }
    if (!items.length) {
      return '<div class="mov-numof-historial-vacio">Sin movimientos previos de número oficial.</div>';
    }
    let html = '<div class="mov-numof-historial-list">';
    items.slice(0, 10).forEach(function(it) {
      html += `<div class="mov-numof-historial-item">
        <span>${escapeHtml(it.fecha)} · ${escapeHtml(it.folio)}</span>
        <b>${escapeHtml(it.anterior)} → ${escapeHtml(it.nuevo)}</b>
        <small>${escapeHtml(it.estado)}</small>
      </div>`;
    });
    html += "</div>";
    return html;
  } catch (e) {
    return await cargarHistorialNumeroOficialHtmlLegacy(clave, numofActual);
  }
}

async function cargarHistorialNumeroOficialHtmlLegacy(clave, numofActual) {
  try {
    const r = await fetch(`${API}/movimientos/historial/${encodeURIComponent(clave)}?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) return "";
    const rows = await r.json();
    const items = [];
    for (const mov of (rows || [])) {
      if (!esMovimientoNumeroOficial(mov)) continue;
      let detalle = obtenerDetalleNumofMovimiento(mov);
      if (!detalle.nuevo && !detalle.anterior && mov.id) {
        try {
          const rd = await fetch(`${API}/movimientos/${encodeURIComponent(mov.id)}?_=${Date.now()}`, {
            cache: "no-store",
            headers: typeof authHeaders === "function" ? authHeaders() : {}
          });
          if (rd.ok) detalle = obtenerDetalleNumofMovimiento(await rd.json());
        } catch (e) {}
      }
      if (!detalle.nuevo && !detalle.anterior) continue;
      items.push({
        folio: mov.folio || ("ID " + mov.id),
        fecha: formatearFechaMovimiento(mov.fecha_aplicacion || mov.fecha_solicitud),
        estado: mov.estado_nombre || nombreEstadoMovimiento(mov.estado),
        anterior: detalle.anterior || "—",
        nuevo: detalle.nuevo || "—"
      });
    }
    if (!items.length && !numeroOficialVacio(numofActual)) {
      return `<div class="mov-numof-historial-vacio">Sin movimientos registrados aún. Número actual en padrón: <b>${escapeHtml(String(numofActual))}</b></div>`;
    }
    if (!items.length) {
      return '<div class="mov-numof-historial-vacio">Sin movimientos previos de número oficial.</div>';
    }
    let html = '<div class="mov-numof-historial-list">';
    items.slice(0, 10).forEach(function(it) {
      html += `<div class="mov-numof-historial-item">
        <span>${escapeHtml(it.fecha)} · ${escapeHtml(it.folio)}</span>
        <b>${escapeHtml(it.anterior)} → ${escapeHtml(it.nuevo)}</b>
        <small>${escapeHtml(it.estado)}</small>
      </div>`;
    });
    html += "</div>";
    return html;
  } catch (e) {
    return "";
  }
}

function segmentosClaveParaCedula(clave) {
  const c = String(clave || "").trim().toUpperCase();
  const m = c.match(/^([A-Z]{1,3})(\d+)$/);
  if (!m) {
    return { manzana: "—", lote: "—", fraccion: "—" };
  }
  const numeros = m[2];
  const manzana = numeros.slice(0, 3) || "—";
  const lote = numeros.slice(3, 6) || "—";
  const fraccionRaw = numeros.slice(6);
  const fraccion = fraccionRaw ? fraccionRaw.replace(/^0+/, "") || fraccionRaw : "—";
  return { manzana: manzana, lote: lote, fraccion: fraccion };
}

function construirDomicilioFisicoCedula(p, numof) {
  const calle = String(p.calle || "CONOCIDO").trim();
  const colonia = String(p.colonia || "").trim();
  const delegacion = String(p.delegacion || "").trim();
  const num = String(numof || p.numof || "").trim();
  let txt = calle;
  if (num) txt += ", No. " + num;
  if (colonia) txt += " - Col/Fracc. " + colonia;
  if (delegacion) txt += ", Delegacion " + delegacion;
  return txt.toUpperCase();
}

function calcularValorUnitarioTerreno(p) {
  const sup = Number(p.sup_documental || p.sup_fisica);
  const v26 = Number(p.valor2026);
  if (v26 > 0 && sup > 0 && v26 >= 500) return v26;
  if (v26 > 0 && sup > 0) return Math.round((v26 / sup) * 100) / 100;
  return null;
}

async function imprimirCedulaNumeroOficial(movOpt) {
  const mov = movOpt || movimientoSeguimientoActual;
  if (!mov) {
    alert("Seleccione un movimiento de número oficial.");
    return;
  }
  if (!esMovimientoNumeroOficial(mov)) {
    alert("Este movimiento no corresponde a número oficial.");
    return;
  }
  if (String(mov.estado || "").toUpperCase() !== "APLICADO") {
    alert("La cédula se genera cuando el movimiento ya fue aplicado al padrón.");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Generador PDF no disponible.");
    return;
  }

  const clave = String(mov.clave_catastral || "").trim().toUpperCase();
  if (!clave) {
    alert("El movimiento no tiene clave catastral.");
    return;
  }

  let movFull = mov;
  if (!mov.detalles && mov.id) {
    try {
      const r = await fetch(`${API}/movimientos/${encodeURIComponent(mov.id)}?_=${Date.now()}`, {
        cache: "no-store",
        headers: typeof authHeaders === "function" ? authHeaders() : {}
      });
      if (r.ok) movFull = await r.json();
    } catch (e) {}
  }

  const detNum = obtenerDetalleNumofMovimiento(movFull);
  const numNuevo = String(detNum.nuevo || "").trim();
  const numAnterior = String(detNum.anterior || "").trim();

  let feature = null;
  try {
    const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (r.ok) feature = await r.json();
  } catch (e) {}

  const p = feature?.properties || {};
  const numof = numNuevo || String(p.numof || "").trim();
  const nombre = String(p.nombre_completo || "—").trim().toUpperCase();
  const colonia = String(p.colonia || "—").trim().toUpperCase();
  const seg = segmentosClaveParaCedula(clave);
  const domicilio = construirDomicilioFisicoCedula(p, numof);
  const valoresFiscales = await calcularValoresFiscalesCedula(p);
  const valorUnit = valoresFiscales.valorUnit;
  const valorFiscal = valoresFiscales.valorFiscal;
  const supDoc = valoresFiscales.sup || Number(p.sup_documental || p.sup_fisica || 0);
  const uso = String(p.descripcion_uso || "—").trim().toUpperCase();
  const tasa = p.porcentaje_tasa != null ? formatTasaMillar(p.porcentaje_tasa) : "—";

  if (typeof seleccionarPorClave === "function") {
    try { await seleccionarPorClave(clave); } catch (e) {}
  }

  let mapaImg = await obtenerImagenMapaPDF();
  if (!mapaImg) mapaImg = await generarCroquisWMSPDF();

  const logoImg = await obtenerLogoInstitucionalDataUrl();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const guinda = [112, 51, 65];
  const grisTexto = [40, 48, 60];
  const grisClaro = [245, 247, 250];
  const midX = pageW / 2;
  const fechaEmision = new Date().toLocaleString("es-MX");
  const cpTxt = String(p.cp || "").trim();
  const zonahTxt = String(p.zona_homogenea || p.zonah || "—").trim().toUpperCase();
  const valorUnitTxt = valorUnit != null
    ? ("$" + valorUnit.toLocaleString("es-MX", { minimumFractionDigits: 2 }) + " / m²")
    : "—";
  const valorFiscalTxt = valorFiscal != null
    ? ("$" + valorFiscal.toLocaleString("es-MX", { minimumFractionDigits: 2 }))
    : "—";

  doc.setFillColor(...guinda);
  doc.rect(0, 0, pageW, 32, "F");
  if (logoImg) {
    try { doc.addImage(logoImg, "PNG", 12, 4, 38, 18); } catch (e) {}
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Sistema de Gestión Catastral", logoImg ? 54 : 14, 12);
  doc.setFontSize(10);
  doc.text("Dirección de Catastro · H. Ayuntamiento de Mexicali", logoImg ? 54 : 14, 19);
  doc.setFontSize(9);
  doc.text("Estado de Baja California, México", logoImg ? 54 : 14, 25);
  doc.text("Fecha: " + fechaEmision, pageW - 14, 12, { align: "right" });
  doc.text("Clave: " + clave, pageW - 14, 19, { align: "right" });

  doc.setTextColor(...grisTexto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Cédula de número oficial", 14, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Asignación de domicilio fiscal · predio urbano", 14, 50);

  doc.setFillColor(...guinda);
  doc.roundedRect(pageW - 58, 38, 44, 16, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("NÚMERO OFICIAL", pageW - 36, 43.5, { align: "center" });
  doc.setFontSize(17);
  doc.text(String(numof || "—"), pageW - 36, 51, { align: "center" });

  function marcoSeccionCedula(yTop, h, titulo) {
    doc.setDrawColor(...guinda);
    doc.setLineWidth(0.45);
    doc.setFillColor(...grisClaro);
    doc.roundedRect(14, yTop, pageW - 28, h, 2, 2, "FD");
    doc.setFillColor(...guinda);
    doc.roundedRect(14, yTop, pageW - 28, 7, 2, 2, "F");
    doc.rect(14, yTop + 4, pageW - 28, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(titulo, 18, yTop + 4.8);
  }

  function rowCedula(label, value, x1, x2, yy) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...guinda);
    doc.setFontSize(7);
    doc.text(label, x1, yy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...grisTexto);
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(textoPdf(value), Math.max(8, x2 - x1 - 26)), x1 + 26, yy);
  }

  function celdaInline(label, value, x, yy) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...guinda);
    doc.text(label + ":", x, yy);
    const lw = doc.getTextWidth(label + ": ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...grisTexto);
    doc.text(String(value || "—"), x + lw + 0.5, yy);
  }

  let y = 56;
  const hIdent = 22;
  marcoSeccionCedula(y, hIdent, "IDENTIFICACIÓN DEL PREDIO");
  rowCedula("Propietario", nombre, 18, pageW - 18, y + 11);
  rowCedula("Colonia", colonia, 18, midX - 2, y + 15);
  rowCedula("Delegación", String(p.delegacion || "MEXICALI").trim().toUpperCase(), midX + 2, pageW - 18, y + 15);
  rowCedula("Domicilio", domicilio + (cpTxt ? ", C.P. " + cpTxt : ""), 18, pageW - 18, y + 19);

  y += hIdent + 3;
  const hDatos = numAnterior && numAnterior !== numNuevo ? 28 : 24;
  marcoSeccionCedula(y, hDatos, "DATOS CATASTRALES Y VALORES FISCALES");
  const c1 = 18, c2 = 58, c3 = 98, c4 = 138;
  celdaInline("Manzana", seg.manzana, c1, y + 11);
  celdaInline("Lote", seg.lote, c2, y + 11);
  celdaInline("Fracción", seg.fraccion === "—" ? "—" : seg.fraccion, c3, y + 11);
  celdaInline("Sup. doc.", supDoc ? (supDoc + " m²") : "—", c4, y + 11);
  rowCedula("Uso", uso, 18, midX - 2, y + 15);
  rowCedula("Tasa", tasa, midX + 2, pageW - 18, y + 15);
  rowCedula("Zona H.", zonahTxt + " · " + ANIO_FISCAL_ZONA_HOMOGENEA, 18, midX - 2, y + 19);
  rowCedula("V. unit.", valorUnitTxt, midX + 2, pageW - 18, y + 19);
  rowCedula("V. fiscal", valorFiscalTxt, 18, midX - 2, y + 23);
  if (numAnterior && numAnterior !== numNuevo) {
    rowCedula("No. ant.", numAnterior, midX + 2, pageW - 18, y + 23);
  }

  y += hDatos + 3;
  const mapY = y;
  const mapH = pageH - mapY - 20;
  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.45);
  doc.setFillColor(252, 252, 253);
  doc.roundedRect(14, mapY, pageW - 28, mapH, 2, 2, "FD");
  doc.setFillColor(...guinda);
  doc.roundedRect(14, mapY, pageW - 28, 7, 2, 2, "F");
  doc.rect(14, mapY + 4, pageW - 28, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("UBICACIÓN CARTOGRÁFICA DEL PREDIO", 18, mapY + 4.8);
  const mapInnerY = mapY + 9;
  const mapInnerH = mapH - 11;
  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.35);
  doc.rect(16, mapInnerY, pageW - 32, mapInnerH);
  if (mapaImg) {
    try {
      doc.addImage(mapaImg, "PNG", 17, mapInnerY + 1, pageW - 34, mapInnerH - 2);
    } catch (e) {}
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("Croquis no disponible.", pageW / 2, mapInnerY + mapInnerH / 2, { align: "center" });
  }

  doc.setDrawColor(...guinda);
  doc.line(14, pageH - 16, pageW - 14, pageH - 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 110, 125);
  doc.text("Documento para impresión y firma · Cobro de número oficial", 14, pageH - 10);
  doc.text(new Date().toLocaleDateString("es-MX"), pageW - 14, pageH - 10, { align: "right" });

  doc.save("cedula_numero_oficial_" + clave + "_" + String(numof || "sn") + ".pdf");
}
window.imprimirCedulaNumeroOficial = imprimirCedulaNumeroOficial;

async function imprimirCedulaNumeroOficialPorId(id) {
  const mov = gestorMovimientosCache[id];
  if (mov && mov.detalles) {
    await imprimirCedulaNumeroOficial(mov);
    return;
  }
  try {
    const r = await fetch(`${API}/movimientos/${encodeURIComponent(id)}?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) throw new Error("No se pudo cargar el movimiento.");
    await imprimirCedulaNumeroOficial(await r.json());
  } catch (e) {
    alert(e.message || String(e));
  }
}
window.imprimirCedulaNumeroOficialPorId = imprimirCedulaNumeroOficialPorId;

function actualizarBotonCedulaNumeroOficial(mov) {
  const btn = document.getElementById("segMovBtnCedulaNumof");
  if (!btn) return;
  const visible = mov && esMovimientoNumeroOficial(mov) && String(mov.estado || "").toUpperCase() === "APLICADO";
  btn.classList.toggle("oculto", !visible);
}

const CATALOGO_MOVIMIENTOS_PADRON = {
  CAMBIO_SUPERFICIE: {
    titulo: "Cambio de superficie",
    icono: "📐",
    desc: "Modifica superficies documentales y fisicas del predio.",
    campos: [
      { key: "sup_documental", label: "Superficie documental (m²)", padronKey: "sup_documental", tipo: "number" },
      { key: "sup_fisica", label: "Superficie fisica (m²)", padronKey: "sup_fisica", tipo: "number" }
    ]
  },
  CAMBIO_CONSTRUCCION: {
    titulo: "Cambio de construccion",
    icono: "🏗️",
    desc: "Actualiza la superficie de construccion.",
    campos: [
      { key: "sup_const", label: "Superficie construccion (m²)", padronKey: "sup_const", tipo: "number" }
    ]
  },
  CAMBIO_USO_SUELO: {
    titulo: "Cambio de uso de suelo",
    icono: "🌿",
    desc: "Modifica el uso de suelo registrado en el padron.",
    campos: [
      { key: "uso_tasa", label: "Uso de suelo", tipo: "uso_tasa", required: true }
    ]
  },
  CAMBIO_ZONA_HOMOGENEA: {
    titulo: "Cambio de zona homogenea",
    icono: "🗺️",
    desc: "Modifica la zona homogenea (zonah) del predio segun tabla fiscal.",
    campos: [
      { key: "zona_homogenea", label: "Zona homogenea", tipo: "zona_homogenea", required: true, anio: 2026 }
    ]
  },
  ASIGNACION_NUMERO_OFICIAL: {
    titulo: "Asignacion de numero oficial",
    icono: "🔢",
    desc: "Asigna numero oficial al predio.",
    aliasDe: "NUMERO_OFICIAL",
    campos: [
      { key: "numof", label: "Numero oficial", padronKey: "numof", tipo: "numero_oficial", required: true }
    ]
  },
  CAMBIO_NUMERO_OFICIAL: {
    titulo: "Cambio de numero oficial",
    icono: "🔢",
    desc: "Modifica el numero oficial existente.",
    aliasDe: "NUMERO_OFICIAL",
    campos: [
      { key: "numof", label: "Numero oficial", padronKey: "numof", tipo: "numero_oficial", required: true }
    ]
  },
  NUMERO_OFICIAL: {
    titulo: "Numero oficial",
    icono: "🔢",
    desc: "Asigna o modifica el numero oficial del predio.",
    campos: [
      { key: "numof", label: "Numero oficial", padronKey: "numof", tipo: "numero_oficial", required: true }
    ]
  },
  CAMBIO_CLAVE: {
    titulo: "Cambio de clave",
    icono: "🔑",
    desc: "Cambia la clave catastral en padron y tablas relacionadas.",
    campos: [
      { key: "clave_catastral_nueva", label: "Clave catastral nueva", tipo: "text", required: true, esClaveNueva: true }
    ]
  },
  BLOQUEO: {
    titulo: "Bloqueo",
    icono: "🔒",
    desc: "Bloquea el predio en cartografia (estatus BLOQUEADO).",
    campos: []
  },
  DESBLOQUEO: {
    titulo: "Desbloqueo",
    icono: "🔓",
    desc: "Restaura el predio a estatus ACTIVO.",
    campos: []
  },
  BAJA_CLAVE: {
    titulo: "Baja de clave",
    icono: "⬇️",
    desc: "Da de baja la clave catastral del padron.",
    campos: []
  },
  ALTA_CLAVE: {
    titulo: "Alta de clave",
    icono: "⬆️",
    desc: "Registra una nueva clave en el padron. Debe asignar tipo de tenencia (C, P, G, S, R o E) desde el alta.",
    sinClaveOrigen: true,
    campos: [
      { key: "clave_catastral", label: "Clave catastral nueva", tipo: "text", required: true, esClaveAlta: true },
      { key: "nombre_completo", label: "Nombre / titular", padronKey: "nombre_completo", tipo: "text", required: true },
      { key: "condominio", label: "Tipo de tenencia", padronKey: "condominio", tipo: "regimen_condominio", required: true },
      { key: "colonia", label: "Colonia", padronKey: "colonia", tipo: "text" },
      { key: "calle", label: "Calle", padronKey: "calle", tipo: "text" },
      { key: "numof", label: "Numero oficial", padronKey: "numof", tipo: "text" },
      { key: "sup_documental", label: "Superficie documental", padronKey: "sup_documental", tipo: "number" }
    ]
  },
  SUBDIVISION: {
    titulo: "Subdivision",
    icono: "✂️",
    desc: "Registra subdivision: clave origen y claves resultantes.",
    campos: [
      { key: "claves_resultantes", label: "Claves resultantes (separadas por coma)", tipo: "text", required: true },
      { key: "sup_documental", label: "Superficie origen (m²)", padronKey: "sup_documental", tipo: "number" }
    ]
  },
  FUSION: {
    titulo: "Fusion",
    icono: "🔗",
    desc: "Registra fusion de claves hacia una clave destino.",
    campos: [
      { key: "claves_origen", label: "Claves a fusionar (coma)", tipo: "text", required: true },
      { key: "clave_destino", label: "Clave resultante / destino", tipo: "text", required: true, esClaveNueva: true }
    ]
  }
};

const movPadronEstado = { tipo: "", ficha: null, guardando: false };

let _cacheCatalogoUsosTasa = null;
let _cacheCatalogoUsosTasaTs = 0;
let _cacheCatalogoZonasHomogeneas = {};
const ANIO_FISCAL_ZONA_HOMOGENEA = 2026;

function formatTasaMillar(pct) {
  const n = parseFloat(String(pct ?? "").replace(",", "."));
  if (isNaN(n)) return String(pct ?? "");
  return n.toFixed(2) + " / millar";
}

function etiquetaUsoTasa(item) {
  const desc = String(item.descripcion_uso || "").trim();
  const idTasa = item.id_tasa ?? "";
  return desc + " — " + formatTasaMillar(item.porcentaje_tasa) + " (tasa " + idTasa + ")";
}

async function cargarCatalogoUsosTasa() {
  const now = Date.now();
  if (_cacheCatalogoUsosTasa && now - _cacheCatalogoUsosTasaTs < 300000) {
    return _cacheCatalogoUsosTasa;
  }
  const r = await fetch(`${API}/padron/catalogo/usos-tasa?_=${now}`, {
    cache: "no-store",
    headers: typeof authHeaders === "function" ? authHeaders() : {}
  });
  if (!r.ok) {
    const err = await r.json().catch(function() { return {}; });
    throw new Error(err.detail || err.message || "No se pudo cargar el catalogo de usos");
  }
  _cacheCatalogoUsosTasa = await r.json();
  _cacheCatalogoUsosTasaTs = now;
  return _cacheCatalogoUsosTasa;
}

function formatValorM2(valor) {
  const n = parseFloat(String(valor ?? "").replace(",", ""));
  if (isNaN(n)) return String(valor ?? "");
  return "$ " + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " / m²";
}

function etiquetaZonaHomogenea(item) {
  const codigo = String(item.codigo_zona_homogenea || item.zona_homogenea || "").trim();
  const desc = String(item.descripcion_col_fracc || "").trim();
  const valor = item.valor_m2;
  let txt = codigo;
  if (desc && desc.toUpperCase() !== codigo.toUpperCase()) txt += " — " + desc;
  if (valor !== null && valor !== undefined && valor !== "") txt += " — " + formatValorM2(valor);
  if (item.es_adicional) {
    const tipo = String(item.tipo_zona || "ADICIONAL").toUpperCase();
    txt = "[" + tipo + "] " + txt;
  }
  return txt;
}

async function cargarCatalogoZonasHomogeneas(anio) {
  anio = anio || ANIO_FISCAL_ZONA_HOMOGENEA;
  const now = Date.now();
  const cacheKey = String(anio);
  const cached = _cacheCatalogoZonasHomogeneas[cacheKey];
  if (cached && now - cached.ts < 300000) {
    return cached.rows;
  }
  const r = await fetch(`${API}/padron/catalogo/zonas-homogeneas?anio=${encodeURIComponent(anio)}&_=${now}`, {
    cache: "no-store",
    headers: typeof authHeaders === "function" ? authHeaders() : {}
  });
  if (!r.ok) {
    const err = await r.json().catch(function() { return {}; });
    throw new Error(err.detail || err.message || "No se pudo cargar el catalogo de zonas homogeneas");
  }
  const rows = await r.json();
  _cacheCatalogoZonasHomogeneas[cacheKey] = { rows: rows, ts: now };
  return rows;
}

function filtrarSelectZonaHomogenea() {
  const filtro = (document.getElementById("movPadron_zona_homogenea_filtro")?.value || "").trim().toUpperCase();
  const sel = document.getElementById("movPadron_zona_homogenea");
  if (!sel) return;
  Array.from(sel.options).forEach(function(opt, idx) {
    if (idx === 0) {
      opt.hidden = false;
      return;
    }
    const txt = (opt.textContent || "").toUpperCase();
    const codigo = String(opt.dataset?.codigo || "").toUpperCase();
    opt.hidden = filtro !== "" && txt.indexOf(filtro) === -1 && codigo.indexOf(filtro) === -1;
  });
}
window.filtrarSelectZonaHomogenea = filtrarSelectZonaHomogenea;

function toggleModoZonaHomogeneaAdicional() {
  const manual = !!document.getElementById("movPadron_zona_modo_adicional")?.checked;
  document.getElementById("movPadron_bloque_zona_catalogo")?.classList.toggle("oculto", manual);
  document.getElementById("movPadron_bloque_zona_adicional")?.classList.toggle("oculto", !manual);
}
window.toggleModoZonaHomogeneaAdicional = toggleModoZonaHomogeneaAdicional;

function actualizarPreviewCodigoZonaAdicional() {
  const sub = (document.getElementById("movPadron_zona_adic_subsector")?.value || "").trim().toUpperCase();
  const hom = (document.getElementById("movPadron_zona_adic_homoclave")?.value || "").trim().toUpperCase();
  const sec = (document.getElementById("movPadron_zona_adic_seccion")?.value || "").trim().toUpperCase();
  const directo = (document.getElementById("movPadron_zona_adic_codigo")?.value || "").trim().toUpperCase();
  const codigo = directo || (sub + hom + sec);
  const preview = document.getElementById("movPadron_zona_adic_preview");
  if (preview) preview.textContent = codigo || "—";
}
window.actualizarPreviewCodigoZonaAdicional = actualizarPreviewCodigoZonaAdicional;

function obtenerCodigoZonaAdicionalCapturado() {
  const directo = (document.getElementById("movPadron_zona_adic_codigo")?.value || "").trim().toUpperCase();
  if (directo) return directo;
  const sub = (document.getElementById("movPadron_zona_adic_subsector")?.value || "").trim().toUpperCase();
  const hom = (document.getElementById("movPadron_zona_adic_homoclave")?.value || "").trim().toUpperCase();
  const sec = (document.getElementById("movPadron_zona_adic_seccion")?.value || "").trim().toUpperCase();
  return (sub + hom + sec).trim();
}

function _codigo_zonah_desde_partes(subsector, homoclave, seccion) {
  return String(subsector || "").trim().toUpperCase() +
    String(homoclave || "").trim().toUpperCase() +
    String(seccion || "").trim().toUpperCase();
}

function asegurarModalMovimientoPadron() {
  if (document.getElementById("modalMovimientoPadron")) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
<div id="modalMovimientoPadron" class="modal-movimiento-overlay oculto">
  <div class="modal-movimiento-card">
    <div class="modal-movimiento-left">
      <div class="modal-icon" id="movPadronIcon">📋</div>
      <h2>Movimiento Catastral</h2>
      <h3 id="movPadronTitulo">Movimiento al padron</h3>
      <p id="movPadronDesc">Registra una solicitud institucional de cambio al padron.</p>
      <div class="modal-nota">La solicitud queda en historial y puede aplicarse al padron tras autorizacion.</div>
    </div>
    <div class="modal-movimiento-right">
      <button type="button" class="modal-cerrar" onclick="cerrarModalMovimientoPadron()">×</button>
      <div class="section-label">Datos del movimiento</div>
      <div id="movPadronCampos"></div>
      <label class="input-label-mini">Motivo</label>
      <input type="text" id="movPadronMotivo" placeholder="MOTIVO DEL MOVIMIENTO">
      <label class="input-label-mini">Observaciones</label>
      <textarea id="movPadronObservaciones" placeholder="OBSERVACIONES"></textarea>
      <button type="button" class="btn-modal-principal" onclick="guardarModalMovimientoPadron()">💾 Guardar solicitud</button>
      <div id="movPadronMensaje" class="modal-mov-msg"></div>
    </div>
  </div>
</div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function setMovPadronMensaje(texto, ok) {
  const el = document.getElementById("movPadronMensaje");
  if (!el) return;
  el.textContent = texto || "";
  el.className = "modal-mov-msg " + (ok ? "ok" : "error");
}

function cerrarModalMovimientoPadron() {
  document.getElementById("modalMovimientoPadron")?.classList.add("oculto");
}
window.cerrarModalMovimientoPadron = cerrarModalMovimientoPadron;

async function cargarFichaParaMovimiento(clave) {
  if (!clave) return null;
  try {
    const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.properties || data;
  } catch (e) {
    return null;
  }
}

function toggleMovRegimenCondominioAlta() {
  const val = document.getElementById("movPadron_condominio")?.value || "";
  const bloque = document.getElementById("movPadron_bloque_condominio_c");
  if (bloque) bloque.classList.toggle("oculto", val !== "C");
}
window.toggleMovRegimenCondominioAlta = toggleMovRegimenCondominioAlta;

function renderCamposMovimientoPadron(cfg, ficha, catalogos) {
  catalogos = catalogos || {};
  const catalogoUsos = catalogos.usos || [];
  const catalogoZonas = catalogos.zonas || [];
  const cont = document.getElementById("movPadronCampos");
  if (!cont) return;

  const clave = obtenerClaveParaMovimiento();
  let html = "";

  if (!cfg.sinClaveOrigen) {
    html += `
      <label class="input-label-mini">Clave catastral</label>
      <input type="text" id="movPadronClave" value="${escapeHtml(clave)}" placeholder="CLAVE CATASTRAL">`;
  }

  (cfg.campos || []).forEach(function(c) {
    if (c.tipo === "uso_tasa") {
      const descActual = ficha ? String(ficha.descripcion_uso ?? "").trim() : "";
      const idTasaActual = ficha && ficha.id_tasa !== undefined && ficha.id_tasa !== null ? String(ficha.id_tasa) : "";
      const pctActual = ficha && ficha.porcentaje_tasa !== undefined && ficha.porcentaje_tasa !== null ? String(ficha.porcentaje_tasa) : "";
      const actualTxt = descActual
        ? (descActual + (pctActual !== "" ? " — " + formatTasaMillar(pctActual) + (idTasaActual !== "" ? " (tasa " + idTasaActual + ")" : "") : ""))
        : "";

      html += `<label class="input-label-mini">${escapeHtml(c.label)}${c.required ? " *" : ""}</label>`;
      html += `<select id="movPadron_${c.key}" data-campo="${c.key}" data-tipo="uso_tasa"
        data-desc-anterior="${escapeHtml(descActual)}"
        data-id-tasa-anterior="${escapeHtml(idTasaActual)}"
        data-pct-anterior="${escapeHtml(pctActual)}">`;
      html += `<option value="">SELECCIONE USO DE SUELO...</option>`;

      (catalogoUsos || []).forEach(function(item) {
        const desc = String(item.descripcion_uso || "").trim();
        const idTasa = item.id_tasa ?? "";
        const pct = item.porcentaje_tasa ?? "";
        const selected = descActual && desc.toUpperCase() === descActual.toUpperCase()
          ? " selected"
          : (!descActual && idTasaActual !== "" && String(idTasa) === idTasaActual ? " selected" : "");
        html += `<option value="${escapeHtml(String(item.id))}"${selected}
          data-descripcion="${escapeHtml(desc)}"
          data-id-tasa="${escapeHtml(String(idTasa))}"
          data-porcentaje="${escapeHtml(String(pct))}">${escapeHtml(etiquetaUsoTasa(item))}</option>`;
      });

      html += `</select>`;
      if (actualTxt) {
        html += `<div class="mov-valor-anterior">Actual: ${escapeHtml(actualTxt)}</div>`;
      }
      return;
    }

    if (c.tipo === "zona_homogenea") {
      const codigoActual = String(ficha?.zona_homogenea || ficha?.zonah || "").trim().toUpperCase();
      const itemActual = catalogoZonas.find(function(item) {
        return String(item.codigo_zona_homogenea || "").toUpperCase() === codigoActual;
      });
      const actualTxt = codigoActual
        ? (codigoActual + (itemActual?.descripcion_col_fracc ? " — " + itemActual.descripcion_col_fracc : "") +
          (itemActual?.valor_m2 != null ? " — " + formatValorM2(itemActual.valor_m2) : ""))
        : "";

      html += `<label class="input-label-mini">${escapeHtml(c.label)}${c.required ? " *" : ""}</label>`;
      html += `<label class="mov-zona-check-line">
        <input type="checkbox" id="movPadron_zona_modo_adicional" onchange="toggleModoZonaHomogeneaAdicional()">
        <span class="mov-zona-check-text">Zona adicional o temporal (fuera de tabla oficial PDF)</span>
      </label>`;

      html += `<div id="movPadron_bloque_zona_catalogo">`;
      html += `<input type="text" id="movPadron_zona_homogenea_filtro" placeholder="BUSCAR CODIGO O COLONIA..." oninput="filtrarSelectZonaHomogenea()">`;
      html += `<select id="movPadron_${c.key}" data-campo="${c.key}" data-tipo="zona_homogenea"
        data-codigo-anterior="${escapeHtml(codigoActual)}"
        data-desc-anterior="${escapeHtml(String(itemActual?.descripcion_col_fracc || ""))}"
        data-valor-anterior="${escapeHtml(itemActual?.valor_m2 != null ? String(itemActual.valor_m2) : "")}">`;
      html += `<option value="">SELECCIONE ZONA HOMOGENEA...</option>`;

      catalogoZonas.forEach(function(item) {
        const codigo = String(item.codigo_zona_homogenea || "").trim().toUpperCase();
        const selected = codigoActual && codigo === codigoActual ? " selected" : "";
        html += `<option value="${escapeHtml(String(item.id))}"${selected}
          data-codigo="${escapeHtml(codigo)}"
          data-descripcion="${escapeHtml(String(item.descripcion_col_fracc || ""))}"
          data-valor="${escapeHtml(item.valor_m2 != null ? String(item.valor_m2) : "")}"
          data-adicional="${item.es_adicional ? "1" : "0"}">${escapeHtml(etiquetaZonaHomogenea(item))}</option>`;
      });

      html += `</select>`;
      html += `<div class="mov-valor-anterior">Tabla fiscal ${c.anio || ANIO_FISCAL_ZONA_HOMOGENEA} · ${catalogoZonas.length} zonas (oficial + adicionales)</div>`;
      html += `</div>`;

      html += `<div id="movPadron_bloque_zona_adicional" class="oculto mov-zona-adicional">`;
      html += `<label class="input-label-mini">Tipo de zona *</label>`;
      html += `<select id="movPadron_zona_adic_tipo">
        <option value="ADICIONAL">ADICIONAL — nueva en el ejercicio</option>
        <option value="TEMPORAL">TEMPORAL — vigencia acotada / dictamen</option>
      </select>`;
      html += `<div class="mov-zona-adic-grid">`;
      html += `<div><label class="input-label-mini">Subsector</label>
        <input type="text" id="movPadron_zona_adic_subsector" maxlength="8" placeholder="MXH" oninput="actualizarPreviewCodigoZonaAdicional()"></div>`;
      html += `<div><label class="input-label-mini">Homoclave col./fracc.</label>
        <input type="text" id="movPadron_zona_adic_homoclave" maxlength="12" placeholder="BFS" oninput="actualizarPreviewCodigoZonaAdicional()"></div>`;
      html += `<div><label class="input-label-mini">Sección</label>
        <input type="text" id="movPadron_zona_adic_seccion" maxlength="4" placeholder="A" oninput="actualizarPreviewCodigoZonaAdicional()"></div>`;
      html += `</div>`;
      html += `<label class="input-label-mini">Código zona homogénea (zonah) *</label>`;
      html += `<input type="text" id="movPadron_zona_adic_codigo" placeholder="SUBSECTOR+HOMOCLAVE+SECCIÓN" oninput="actualizarPreviewCodigoZonaAdicional()">`;
      html += `<div class="mov-valor-anterior">Código compuesto: <strong id="movPadron_zona_adic_preview">—</strong> · Subsector + Homoclave + Sección</div>`;
      html += `<label class="input-label-mini">Descripción col./fracc. *</label>`;
      html += `<input type="text" id="movPadron_zona_adic_descripcion" placeholder="NOMBRE COLONIA O FRACCIONAMIENTO">`;
      html += `<label class="input-label-mini">Valor ley / m² *</label>`;
      html += `<input type="number" id="movPadron_zona_adic_valor" min="0" step="0.01" placeholder="0.00">`;
      html += `<label class="input-label-mini">Fundamento legal / dictamen *</label>`;
      html += `<textarea id="movPadron_zona_adic_fundamento" rows="2" placeholder="Artículo, resolución o dictamen que autoriza la zona adicional o temporal"></textarea>`;
      html += `<div class="mov-valor-anterior">Al aplicar el movimiento, la zona queda registrada en catálogo adicional y disponible para otros predios.</div>`;
      html += `</div>`;

      if (actualTxt) {
        html += `<div class="mov-valor-anterior">Actual: ${escapeHtml(actualTxt)}</div>`;
      }
      return;
    }

    if (c.tipo === "regimen_condominio") {
      html += `<label class="input-label-mini">${escapeHtml(c.label)}${c.required ? " *" : ""}</label>`;
      html += `<select id="movPadron_${c.key}" data-campo="${c.key}" data-tipo="regimen_condominio" onchange="toggleMovRegimenCondominioAlta()">`;
      html += htmlOpcionesTenenciaPadron("", true, "SELECCIONE TIPO DE TENENCIA...");
      html += `</select>`;
      html += `<div id="movPadron_bloque_condominio_c" class="oculto mov-zona-adicional">`;
      html += `<label class="input-label-mini">Modalidad de condominio *</label>`;
      html += `<select id="movPadron_modalidad_condominio" data-campo="modalidad_condominio">`;
      html += `<option value="">SELECCIONE MODALIDAD...</option>`;
      html += `<option value="HORIZONTAL">Horizontal — unidades contiguas</option>`;
      html += `<option value="VERTICAL">Vertical — pisos / torre</option>`;
      html += `</select>`;
      html += `<label class="input-label-mini">Nombre del condominio</label>`;
      html += `<input type="text" id="movPadron_nombre_condominio" data-campo="nombre_condominio" placeholder="EJ: TORRES DEL MAR, CONDOMINIO CETYS...">`;
      html += `<div class="mov-valor-anterior">Obligatorio al dar de alta en regimen Condominio (C).</div>`;
      html += `</div>`;
      return;
    }

    if (c.tipo === "numero_oficial") {
      const valAnt = ficha ? String(ficha.numof ?? "").trim() : "";
      const esAsignacion = numeroOficialVacio(valAnt);
      html += `<div class="mov-numof-modo ${esAsignacion ? "modo-asignacion" : "modo-cambio"}">`;
      html += esAsignacion
        ? "Modo: <b>Asignación</b> — el predio no tiene número oficial registrado."
        : `Modo: <b>Cambio</b> — número actual: <b>${escapeHtml(valAnt)}</b>`;
      html += `</div>`;
      html += `<label class="input-label-mini">${escapeHtml(esAsignacion ? "Número oficial a asignar" : "Número oficial nuevo")} *</label>`;
      html += `<input type="text" id="movPadron_${c.key}" data-campo="${c.key}" data-padron="numof" data-anterior="${escapeHtml(valAnt)}" value="" placeholder="CAPTURE EL NÚMERO OFICIAL">`;
      html += `<div class="mov-valor-anterior">El número anterior quedará registrado en el historial del movimiento.</div>`;
      html += `<div class="section-label" style="margin-top:8px;">Historial de números oficiales</div>`;
      html += `<div id="movPadronHistorialNumof" class="mov-numof-historial-wrap">Cargando historial...</div>`;
      return;
    }

    const valAnt = ficha && c.padronKey ? (ficha[c.padronKey] ?? ficha[c.key] ?? "") : "";
    const valInput = c.esClaveAlta ? "" : (c.esClaveNueva ? "" : valAnt);
    html += `
      <label class="input-label-mini">${escapeHtml(c.label)}${c.required ? " *" : ""}</label>
      <input type="${c.tipo || "text"}" id="movPadron_${c.key}"
        data-campo="${c.key}" data-padron="${c.padronKey || c.key}"
        data-anterior="${escapeHtml(String(valAnt))}"
        value="${escapeHtml(valInput === null || valInput === undefined ? "" : String(valInput))}"
        placeholder="${escapeHtml(c.label.toUpperCase())}">`;
    if (valAnt !== "" && valAnt !== null && valAnt !== undefined && !c.esClaveNueva && !c.esClaveAlta) {
      html += `<div class="mov-valor-anterior">Actual: ${escapeHtml(String(valAnt))}</div>`;
    }
  });

  cont.innerHTML = html;
  if (typeof activarMayusculasOperativas === "function") {
    activarMayusculasOperativas(document.getElementById("modalMovimientoPadron"));
  }
  if ((cfg.campos || []).some(function(c) { return c.tipo === "numero_oficial"; })) {
    const histCont = document.getElementById("movPadronHistorialNumof");
    const numAct = ficha ? String(ficha.numof ?? "").trim() : "";
    if (histCont) {
      cargarHistorialNumeroOficialHtml(clave, numAct).then(function(h) {
        histCont.innerHTML = h || '<div class="mov-numof-historial-vacio">Sin historial previo.</div>';
      });
    }
  }
}

async function abrirModalMovimientoPadron(tipo) {
  asegurarModalMovimientoPadron();

  if (tipo === "CAMBIO_NOMBRE") {
    if (typeof abrirModalCambioNombre === "function") abrirModalCambioNombre();
    return;
  }
  if (tipo === "CAMBIO_TITULARIDAD") {
    if (typeof abrirCopropietariosDesdeMovimientos === "function") abrirCopropietariosDesdeMovimientos();
    return;
  }
  if (tipo === "ASIGNACION_NUMERO_OFICIAL" || tipo === "CAMBIO_NUMERO_OFICIAL") {
    tipo = "NUMERO_OFICIAL";
  }

  const cfg = CATALOGO_MOVIMIENTOS_PADRON[tipo];
  if (!cfg) {
    alert("Tipo de movimiento no configurado: " + tipo);
    return;
  }

  const clave = obtenerClaveParaMovimiento();
  if (!cfg.sinClaveOrigen && !clave) {
    alert("Seleccione un predio o capture la clave en «Clave catastral origen».");
    return;
  }

  movPadronEstado.tipo = tipo;
  movPadronEstado.ficha = cfg.sinClaveOrigen ? null : await cargarFichaParaMovimiento(clave);

  document.getElementById("movPadronIcon").textContent = cfg.icono || "📋";
  if (tipo === "NUMERO_OFICIAL") {
    const esAsignacion = numeroOficialVacio(movPadronEstado.ficha?.numof);
    document.getElementById("movPadronTitulo").textContent = esAsignacion
      ? "Asignacion de numero oficial"
      : "Cambio de numero oficial";
    document.getElementById("movPadronDesc").textContent = esAsignacion
      ? "Capture el numero oficial que se asignara al predio."
      : "Capture el nuevo numero oficial. El anterior quedara en historial.";
    movPadronEstado.modoNumeroOficial = esAsignacion ? "ASIGNACION" : "CAMBIO";
  } else {
    document.getElementById("movPadronTitulo").textContent = cfg.titulo;
    document.getElementById("movPadronDesc").textContent = cfg.desc || "";
  }
  document.getElementById("movPadronMotivo").value = "";
  document.getElementById("movPadronObservaciones").value = "";
  setMovPadronMensaje("", true);

  let catalogoUsos = [];
  let catalogoZonas = [];
  const anioZona = (cfg.campos || []).find(function(c) { return c.tipo === "zona_homogenea"; })?.anio || ANIO_FISCAL_ZONA_HOMOGENEA;

  if ((cfg.campos || []).some(function(c) { return c.tipo === "uso_tasa"; })) {
    try {
      catalogoUsos = await cargarCatalogoUsosTasa();
    } catch (e) {
      setMovPadronMensaje(e.message || "No se pudo cargar catalogo de usos", false);
    }
  }
  if ((cfg.campos || []).some(function(c) { return c.tipo === "zona_homogenea"; })) {
    try {
      catalogoZonas = await cargarCatalogoZonasHomogeneas(anioZona);
    } catch (e) {
      setMovPadronMensaje(e.message || "No se pudo cargar catalogo de zonas homogeneas", false);
    }
  }

  renderCamposMovimientoPadron(cfg, movPadronEstado.ficha, { usos: catalogoUsos, zonas: catalogoZonas });

  document.getElementById("modalMovimientoPadron").classList.remove("oculto");
}
window.abrirModalMovimientoPadron = abrirModalMovimientoPadron;

async function guardarModalMovimientoPadron() {
  if (movPadronEstado.guardando) return;
  movPadronEstado.guardando = true;

  try {
    const tipo = movPadronEstado.tipo;
    const cfg = CATALOGO_MOVIMIENTOS_PADRON[tipo];
    if (!cfg) throw new Error("Tipo de movimiento invalido");

    let tipoGuardar = tipo;
    if (tipo === "NUMERO_OFICIAL") {
      tipoGuardar = resolverTipoNumeroOficial(movPadronEstado.ficha);
    }

    const clave = cfg.sinClaveOrigen
      ? ""
      : (document.getElementById("movPadronClave")?.value || obtenerClaveParaMovimiento()).trim().toUpperCase();

    const motivo = (document.getElementById("movPadronMotivo")?.value || "ACTUALIZACION").trim().toUpperCase();
    const observaciones = (document.getElementById("movPadronObservaciones")?.value || "").trim().toUpperCase();

    const detalles = [];
    const datosAnteriores = {};
    const datosNuevos = {};
    let claveNueva = null;

    (cfg.campos || []).forEach(function(c) {
      if (c.tipo === "uso_tasa") {
        const el = document.getElementById("movPadron_" + c.key);
        const opt = el?.selectedOptions?.[0];
        if (c.required && (!opt || !opt.value)) throw new Error("Seleccione: " + c.label);

        const descNuevo = String(opt?.dataset?.descripcion || "").trim().toUpperCase();
        const idTasaNuevo = String(opt?.dataset?.idTasa ?? "").trim();
        const pctNuevo = String(opt?.dataset?.porcentaje ?? "").trim();

        const descAnt = String(el?.dataset?.descAnterior || "").trim();
        const idTasaAnt = String(el?.dataset?.idTasaAnterior ?? "").trim();
        const pctAnt = String(el?.dataset?.pctAnterior ?? "").trim();

        if (descAnt) datosAnteriores.descripcion_uso = descAnt;
        if (idTasaAnt) datosAnteriores.id_tasa = idTasaAnt;
        if (pctAnt) datosAnteriores.porcentaje_tasa = pctAnt;

        datosNuevos.descripcion_uso = descNuevo;
        datosNuevos.id_tasa = idTasaNuevo;
        datosNuevos.porcentaje_tasa = pctNuevo;

        detalles.push({
          grupo: "PADRON",
          campo: "descripcion_uso",
          etiqueta: "USO DE SUELO",
          valor_anterior: descAnt,
          valor_nuevo: descNuevo,
          tipo_dato: "texto",
          requiere_validacion: true
        });
        detalles.push({
          grupo: "PADRON",
          campo: "id_tasa",
          etiqueta: "ID TASA",
          valor_anterior: idTasaAnt,
          valor_nuevo: idTasaNuevo,
          tipo_dato: "numero",
          requiere_validacion: false
        });
        detalles.push({
          grupo: "PADRON",
          campo: "porcentaje_tasa",
          etiqueta: "TASA PREDIAL (/MILLAR)",
          valor_anterior: pctAnt,
          valor_nuevo: pctNuevo,
          tipo_dato: "numero",
          requiere_validacion: false
        });
        return;
      }

      if (c.tipo === "zona_homogenea") {
        const esAdicional = !!document.getElementById("movPadron_zona_modo_adicional")?.checked;
        const el = document.getElementById("movPadron_" + c.key);
        let codigoNuevo = "";
        let descNuevo = "";
        let valorNuevo = "";

        const codigoAnt = String(el?.dataset?.codigoAnterior || "").trim().toUpperCase();
        const descAnt = String(el?.dataset?.descAnterior || "").trim();
        const valorAnt = String(el?.dataset?.valorAnterior ?? "").trim();

        if (esAdicional) {
          codigoNuevo = obtenerCodigoZonaAdicionalCapturado();
          descNuevo = String(document.getElementById("movPadron_zona_adic_descripcion")?.value || "").trim().toUpperCase();
          valorNuevo = String(document.getElementById("movPadron_zona_adic_valor")?.value ?? "").trim();
          const fundamento = String(document.getElementById("movPadron_zona_adic_fundamento")?.value || "").trim().toUpperCase();
          const tipoZona = String(document.getElementById("movPadron_zona_adic_tipo")?.value || "ADICIONAL").trim().toUpperCase();
          const subsector = String(document.getElementById("movPadron_zona_adic_subsector")?.value || "").trim().toUpperCase();
          const homoclave = String(document.getElementById("movPadron_zona_adic_homoclave")?.value || "").trim().toUpperCase();
          const seccion = String(document.getElementById("movPadron_zona_adic_seccion")?.value || "").trim().toUpperCase();

          if (c.required && !codigoNuevo) throw new Error("Capture el codigo de zona homogenea (Subsector + Homoclave + Seccion)");
          if (c.required && !descNuevo) throw new Error("Capture la descripcion de colonia o fraccionamiento");
          if (c.required && !valorNuevo) throw new Error("Capture el valor ley por m2");
          if (!fundamento) throw new Error("Indique el fundamento legal o dictamen para la zona adicional/temporal");

          datosNuevos.es_zona_adicional = "SI";
          datosNuevos.tipo_zona = tipoZona;
          datosNuevos.fundamento_legal = fundamento;
          datosNuevos.anio_zona = String(c.anio || ANIO_FISCAL_ZONA_HOMOGENEA);
          if (subsector) datosNuevos.subsector_zona = subsector;
          if (homoclave) datosNuevos.homoclave_zona = homoclave;
          if (seccion) datosNuevos.seccion_zona = seccion;
        } else {
          const opt = el?.selectedOptions?.[0];
          if (c.required && (!opt || !opt.value)) throw new Error("Seleccione: " + c.label);
          codigoNuevo = String(opt?.dataset?.codigo || "").trim().toUpperCase();
          descNuevo = String(opt?.dataset?.descripcion || "").trim().toUpperCase();
          valorNuevo = String(opt?.dataset?.valor ?? "").trim();
        }

        if (codigoAnt) {
          datosAnteriores.zonah = codigoAnt;
          datosAnteriores.zona_homogenea = codigoAnt;
        }
        if (descAnt) datosAnteriores.descripcion_zona = descAnt;
        if (valorAnt) datosAnteriores.valor_m2_zona = valorAnt;

        datosNuevos.zonah = codigoNuevo;
        datosNuevos.zona_homogenea = codigoNuevo;
        if (descNuevo) datosNuevos.descripcion_zona = descNuevo;
        if (valorNuevo) datosNuevos.valor_m2_zona = valorNuevo;

        detalles.push({
          grupo: "PADRON",
          campo: "zonah",
          etiqueta: "ZONA HOMOGENEA",
          valor_anterior: codigoAnt,
          valor_nuevo: codigoNuevo,
          tipo_dato: "texto",
          requiere_validacion: true
        });
        if (descNuevo || descAnt) {
          detalles.push({
            grupo: "PADRON",
            campo: "descripcion_zona",
            etiqueta: "DESCRIPCION COL./FRACC.",
            valor_anterior: descAnt,
            valor_nuevo: descNuevo,
            tipo_dato: "texto",
            requiere_validacion: false
          });
        }
        if (valorNuevo || valorAnt) {
          detalles.push({
            grupo: "PADRON",
            campo: "valor_m2_zona",
            etiqueta: "VALOR LEY / M2",
            valor_anterior: valorAnt,
            valor_nuevo: valorNuevo,
            tipo_dato: "numero",
            requiere_validacion: false
          });
        }
        if (esAdicional) {
          detalles.push({
            grupo: "PADRON",
            campo: "es_zona_adicional",
            etiqueta: "ZONA ADICIONAL/TEMPORAL",
            valor_anterior: "",
            valor_nuevo: "SI",
            tipo_dato: "texto",
            requiere_validacion: false
          });
          detalles.push({
            grupo: "PADRON",
            campo: "tipo_zona",
            etiqueta: "TIPO ZONA",
            valor_anterior: "",
            valor_nuevo: datosNuevos.tipo_zona,
            tipo_dato: "texto",
            requiere_validacion: false
          });
          detalles.push({
            grupo: "PADRON",
            campo: "fundamento_legal",
            etiqueta: "FUNDAMENTO LEGAL",
            valor_anterior: "",
            valor_nuevo: datosNuevos.fundamento_legal,
            tipo_dato: "texto",
            requiere_validacion: false
          });
        }
        return;
      }

      if (c.tipo === "regimen_condominio") {
        const regimen = (document.getElementById("movPadron_condominio")?.value || "").trim().toUpperCase();
        if (c.required && !regimen) throw new Error("Seleccione el tipo de tenencia (C, P, G, S, R o E)");
        const modalidad = (document.getElementById("movPadron_modalidad_condominio")?.value || "").trim().toUpperCase();
        const nombreCond = (document.getElementById("movPadron_nombre_condominio")?.value || "").trim().toUpperCase();
        if (regimen === "C" && !modalidad) {
          throw new Error("Condominio (C) requiere modalidad VERTICAL u HORIZONTAL");
        }
        datosNuevos.condominio = regimen;
        if (regimen === "C") {
          datosNuevos.modalidad_condominio = modalidad;
          if (nombreCond) datosNuevos.nombre_condominio = nombreCond;
        }
        detalles.push({
          grupo: "PADRON",
          campo: "condominio",
          etiqueta: "TIPO DE TENENCIA",
          valor_anterior: "",
          valor_nuevo: regimen,
          tipo_dato: "texto",
          requiere_validacion: true
        });
        if (regimen === "C") {
          detalles.push({
            grupo: "CATASTRO",
            campo: "modalidad_condominio",
            etiqueta: "MODALIDAD CONDOMINIO",
            valor_anterior: "",
            valor_nuevo: modalidad,
            tipo_dato: "texto",
            requiere_validacion: true
          });
          if (nombreCond) {
            detalles.push({
              grupo: "CATASTRO",
              campo: "nombre_condominio",
              etiqueta: "NOMBRE CONDOMINIO",
              valor_anterior: "",
              valor_nuevo: nombreCond,
              tipo_dato: "texto",
              requiere_validacion: false
            });
          }
        }
        return;
      }

      const el = document.getElementById("movPadron_" + c.key);
      const val = (el?.value || "").trim();
      if (c.required && !val) throw new Error("Capture: " + c.label);
      if (!val) return;

      const valAnt = el?.dataset?.anterior || "";
      if (tipo === "NUMERO_OFICIAL" && c.key === "numof") {
        const antNorm = String(valAnt || "").trim().toUpperCase();
        const valNorm = val.toUpperCase();
        if (antNorm && antNorm === valNorm) {
          throw new Error("El numero oficial nuevo debe ser diferente al actual.");
        }
      }
      if (valAnt) datosAnteriores[c.key] = valAnt;
      datosNuevos[c.key] = c.tipo === "number" ? val : val.toUpperCase();

      if (c.esClaveNueva || c.key === "clave_destino") {
        claveNueva = val.toUpperCase();
      }

      detalles.push({
        grupo: "PADRON",
        campo: c.key,
        etiqueta: c.label.toUpperCase(),
        valor_anterior: valAnt,
        valor_nuevo: datosNuevos[c.key],
        tipo_dato: c.tipo === "number" ? "numero" : "texto",
        requiere_validacion: !!c.required
      });
    });

    if (!cfg.sinClaveOrigen && !clave) throw new Error("Indique la clave catastral.");

    const payload = {
      clave_catastral: cfg.sinClaveOrigen ? (datosNuevos.clave_catastral || null) : clave,
      clave_catastral_anterior: clave || null,
      clave_catastral_nueva: claveNueva,
      tipo_movimiento: tipoGuardar,
      motivo,
      observaciones,
      datos_anteriores: datosAnteriores,
      datos_nuevos: datosNuevos,
      detalles
    };

    const r = await fetch(`${API}/movimientos`, {
      method: "POST",
      headers: typeof authHeaders === "function" ? authHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "No se pudo guardar la solicitud");

    const mov = data.movimiento || data;
    setMovPadronMensaje("Solicitud creada: " + (mov.folio || mov.id || ""), true);

    if (typeof cargarMovimientosPadron === "function") {
      await cargarMovimientosPadron(clave || datosNuevos.clave_catastral);
    }

    setTimeout(function() {
      cerrarModalMovimientoPadron();
      if (typeof abrirModalSeguimientoMovimiento === "function") {
        abrirModalSeguimientoMovimiento(mov);
      }
    }, 700);

  } catch (e) {
    setMovPadronMensaje(e.message || String(e), false);
  } finally {
    setTimeout(function() { movPadronEstado.guardando = false; }, 800);
  }
}
window.guardarModalMovimientoPadron = guardarModalMovimientoPadron;

function abrirMovimientoDesdeSelect() {
  const tipo = document.getElementById("movTipo")?.value;
  if (!tipo) return;
  abrirModalMovimientoPadron(tipo);
}
window.abrirMovimientoDesdeSelect = abrirMovimientoDesdeSelect;

function initMovimientosPadronV57() {
  asegurarModalMovimientoPadron();
  document.querySelectorAll("[data-mov-tipo]").forEach(function(btn) {
    if (btn.dataset.movBind === "1") return;
    btn.dataset.movBind = "1";
    btn.addEventListener("click", function() {
      abrirModalMovimientoPadron(btn.dataset.movTipo);
    });
  });
}

setTimeout(initMovimientosPadronV57, 900);

/* --- v58/v61: Análisis evolución zonas homogéneas (años dinámicos) --- */
const ANALISIS_ZONAS_ANIOS_BASE = [2024, 2025, 2026];
const ANALISIS_ZONAS_COLORES = { 2024: "#dc2626", 2025: "#ea580c", 2026: "#2563eb", 2027: "#16a34a" };
const ANALISIS_ZONAS_PALETA = ["#dc2626", "#ea580c", "#2563eb", "#16a34a", "#7c3aed", "#0891b2"];

let _analisisZonasState = {
  resultados: [],
  total: 0,
  indice: 0,
  cargando: false,
  filtrosListos: false,
  anios: ANALISIS_ZONAS_ANIOS_BASE.slice()
};

function obtenerAniosAnalisisZonas() {
  const arr = _analisisZonasState.anios;
  if (arr && arr.length) return arr.slice();
  return ANALISIS_ZONAS_ANIOS_BASE.slice();
}

function colorAnioAnalisisZona(an, idx) {
  if (ANALISIS_ZONAS_COLORES[an]) return ANALISIS_ZONAS_COLORES[an];
  return ANALISIS_ZONAS_PALETA[idx % ANALISIS_ZONAS_PALETA.length];
}

function actualizarEncabezadoAniosAnalisis() {
  const anios = obtenerAniosAnalisisZonas();
  const sub = document.getElementById("analisisZonasSubtitulo");
  if (sub) sub.textContent = "Evolución del valor por m² · ejercicios " + anios.join(", ");
  const sel = document.getElementById("analisisZonasAnio");
  if (sel) {
    const actual = sel.value;
    const labelTodos = anios.length > 1
      ? ("TODOS (" + anios[0] + "–" + anios[anios.length - 1] + ")")
      : "TODOS";
    sel.innerHTML = `<option value="">${escapeHtml(labelTodos)}</option>`;
    anios.forEach(function(a) {
      sel.innerHTML += `<option value="${a}">${a}</option>`;
    });
    if (actual && Array.from(sel.options).some(function(o) { return o.value === actual; })) {
      sel.value = actual;
    }
  }
}

function renderEditarZonaValoresInputs(reg) {
  const cont = document.getElementById("editarZonaValoresDinamic");
  if (!cont) return;
  const anios = obtenerAniosAnalisisZonas();
  let html = "";
  anios.forEach(function(an) {
    const val = reg && reg["valor_" + an] != null ? reg["valor_" + an] : "";
    html += `<label class="input-label-mini">Valor / m² · ${an}</label>`;
    html += `<input type="number" id="editarZonaValor${an}" min="0" step="0.01" value="${val !== "" ? escapeHtml(String(val)) : ""}" placeholder="0.00">`;
  });
  cont.innerHTML = html;
}

function abrirModuloAnalisisZonas() {
  document.getElementById("overlayAnalisisZonas")?.classList.remove("oculto");
  document.body.classList.add("analisis-zonas-activo");
  if (!_analisisZonasState.filtrosListos) {
    cargarFiltrosAnalisisZonas().then(function() {
      if (!_analisisZonasState.resultados.length) buscarAnalisisZonasHomogeneas();
    });
  } else if (!_analisisZonasState.resultados.length) {
    buscarAnalisisZonasHomogeneas();
  } else {
    renderAnalisisZonasCompleto();
  }
}
window.abrirModuloAnalisisZonas = abrirModuloAnalisisZonas;

function cerrarModuloAnalisisZonas() {
  document.getElementById("overlayAnalisisZonas")?.classList.add("oculto");
  document.body.classList.remove("analisis-zonas-activo");
}
window.cerrarModuloAnalisisZonas = cerrarModuloAnalisisZonas;

function llenarSelectAnalisisZonas(id, valores, etiquetaTodas) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(etiquetaTodas)}</option>`;
  (valores || []).forEach(function(v) {
    sel.innerHTML += `<option value="${escapeHtml(String(v))}">${escapeHtml(String(v))}</option>`;
  });
  if (actual && Array.from(sel.options).some(function(o) { return o.value === actual; })) {
    sel.value = actual;
  }
}

async function cargarFiltrosAnalisisZonas() {
  try {
    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/filtros?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) throw new Error("No se pudieron cargar filtros");
    const data = await r.json();
    llenarSelectAnalisisZonas("analisisZonasZona", data.zonas, "TODAS");
    llenarSelectAnalisisZonas("analisisZonasSector", data.sectores, "TODOS");
    llenarSelectAnalisisZonas("analisisZonasSubsector", data.subsectores, "TODOS");
    _analisisZonasState.anios = data.anios && data.anios.length ? data.anios : ANALISIS_ZONAS_ANIOS_BASE.slice();
    actualizarEncabezadoAniosAnalisis();
    _analisisZonasState.filtrosListos = true;
  } catch (e) {
    console.warn("Filtros analisis zonas:", e);
  }
}

function obtenerFiltrosAnalisisZonasForm() {
  return {
    codigo: (document.getElementById("analisisZonasCodigo")?.value || "").trim(),
    zona: (document.getElementById("analisisZonasZona")?.value || "").trim(),
    sector: (document.getElementById("analisisZonasSector")?.value || "").trim(),
    subsector: (document.getElementById("analisisZonasSubsector")?.value || "").trim(),
    anio: parseInt(document.getElementById("analisisZonasAnio")?.value || "0", 10) || 0,
    q: (document.getElementById("analisisZonasTexto")?.value || "").trim()
  };
}

function limpiarFiltrosAnalisisZonas() {
  ["analisisZonasCodigo", "analisisZonasTexto"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["analisisZonasZona", "analisisZonasSector", "analisisZonasSubsector", "analisisZonasAnio"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  buscarAnalisisZonasHomogeneas();
}
window.limpiarFiltrosAnalisisZonas = limpiarFiltrosAnalisisZonas;

async function buscarAnalisisZonasHomogeneas() {
  if (_analisisZonasState.cargando) return;
  _analisisZonasState.cargando = true;
  const lista = document.getElementById("analisisZonasLista");
  if (lista) lista.textContent = "Buscando...";

  try {
    const f = obtenerFiltrosAnalisisZonasForm();
    const qs = new URLSearchParams();
    if (f.codigo) qs.set("codigo", f.codigo);
    if (f.zona) qs.set("zona", f.zona);
    if (f.sector) qs.set("sector", f.sector);
    if (f.subsector) qs.set("subsector", f.subsector);
    if (f.anio) qs.set("anio", String(f.anio));
    if (f.q) qs.set("q", f.q);
    qs.set("limite", "5000");
    qs.set("offset", "0");

    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/evolucion?${qs.toString()}&_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "Error en consulta");

    _analisisZonasState.resultados = data.resultados || [];
    _analisisZonasState.total = data.total || _analisisZonasState.resultados.length;
    if (data.anios && data.anios.length) _analisisZonasState.anios = data.anios;
    actualizarEncabezadoAniosAnalisis();
    _analisisZonasState.indice = 0;
    renderAnalisisZonasCompleto();
  } catch (e) {
    if (lista) lista.innerHTML = `<div class="analisis-zonas-error">${escapeHtml(e.message || String(e))}</div>`;
  } finally {
    _analisisZonasState.cargando = false;
  }
}
window.buscarAnalisisZonasHomogeneas = buscarAnalisisZonasHomogeneas;

function navegarAnalisisZonas(delta) {
  const total = _analisisZonasState.total || 0;
  if (!total) return;
  let idx = (_analisisZonasState.indice || 0) + delta;
  if (idx < 0) idx = total - 1;
  if (idx >= total) idx = 0;
  _analisisZonasState.indice = idx;
  renderAnalisisZonasCompleto();
}
window.navegarAnalisisZonas = navegarAnalisisZonas;

function seleccionarAnalisisZonaIndice(idx) {
  _analisisZonasState.indice = idx;
  renderAnalisisZonasCompleto();
}
window.seleccionarAnalisisZonaIndice = seleccionarAnalisisZonaIndice;

function registroAnalisisZonasActual() {
  const arr = _analisisZonasState.resultados || [];
  if (!arr.length) return null;
  const idx = Math.min(Math.max(_analisisZonasState.indice || 0, 0), arr.length - 1);
  return arr[idx] || null;
}

function renderAnalisisZonasLista() {
  const cont = document.getElementById("analisisZonasLista");
  if (!cont) return;
  const arr = _analisisZonasState.resultados || [];
  const anios = obtenerAniosAnalisisZonas();
  if (!arr.length) {
    cont.innerHTML = '<div class="analisis-zonas-vacio">Sin resultados para los filtros indicados.</div>';
    return;
  }
  const idxAct = _analisisZonasState.indice || 0;
  let html = '<table class="analisis-zonas-tabla"><thead><tr><th>Código</th><th>Descripción</th>';
  anios.forEach(function(an) { html += `<th>${an}</th>`; });
  html += '</tr></thead><tbody>';
  arr.forEach(function(row, idx) {
    const cod = row.clave_zonah || row.codigo_zona_homogenea || "—";
    const desc = row.descripcion_col_fracc || "";
    const v = function(n, val) { return val != null ? formatValorM2(val) : "—"; };
    html += `<tr class="${idx === idxAct ? "activo" : ""}" onclick="seleccionarAnalisisZonaIndice(${idx})"><td><b>${escapeHtml(cod)}</b></td><td>${escapeHtml(desc)}</td>`;
    anios.forEach(function(an) {
      html += `<td>${escapeHtml(v(an, row["valor_" + an]))}</td>`;
    });
    html += '</tr>';
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
  const filaActiva = cont.querySelector("tr.activo");
  if (filaActiva) filaActiva.scrollIntoView({ block: "nearest" });
}

function renderAnalisisZonasDetalle(reg) {
  const valores = document.getElementById("analisisZonasDetalleValores");
  const meta = document.getElementById("analisisZonasMeta");
  const contador = document.getElementById("analisisZonasContador");
  const variacion = document.getElementById("analisisZonasVariacion");
  const total = _analisisZonasState.total || 0;
  const idx = _analisisZonasState.indice || 0;

  if (contador) {
    contador.textContent = total
      ? `Registro #${idx + 1} de ${total.toLocaleString("es-MX")} encontrados`
      : "Sin registros";
  }

  if (!reg) {
    if (valores) valores.innerHTML = "";
    if (meta) meta.innerHTML = "";
    if (variacion) variacion.textContent = "";
    dibujarGraficaEvolucionZona(null);
    return;
  }

  if (valores) {
    let vhtml = "";
    const anios = obtenerAniosAnalisisZonas();
    anios.forEach(function(an) {
      const val = reg["valor_" + an] != null
        ? reg["valor_" + an]
        : ((reg.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
      vhtml += `<div class="analisis-zona-valor-line">
        <span>VALOR${an}</span>
        <b>${val != null ? formatValorM2(val) : "—"}</b>
      </div>`;
    });
    valores.innerHTML = vhtml;
  }

  if (meta) {
    const cod = reg.clave_zonah || reg.codigo_zona_homogenea || "—";
    meta.innerHTML = `
      <div><span>SECSUB / ZONAH</span><b>${escapeHtml(cod)}</b></div>
      <div><span>NOMBRE</span><b>${escapeHtml(reg.descripcion_col_fracc || "—")}</b></div>
      <div><span>ZONA / SECTOR</span><b>${escapeHtml([reg.zona, reg.sector].filter(Boolean).join(" · ") || "—")}</b></div>
      <div><span>SUBSECTOR</span><b>${escapeHtml(reg.subsector || "—")}</b></div>
      ${reg.es_adicional ? `<div><span>TIPO</span><b>[${escapeHtml(reg.tipo_zona || "ADICIONAL")}]</b></div>` : ""}
    `;
  }

  if (variacion) {
    if (reg.variacion_pct != null) {
      const signo = reg.variacion_abs >= 0 ? "+" : "";
      const anios = obtenerAniosAnalisisZonas();
      const desde = reg.variacion_desde || anios[0];
      const hasta = reg.variacion_hasta || anios[anios.length - 1];
      variacion.innerHTML = `Variación ${desde}→${hasta}: <b>${signo}${reg.variacion_pct}%</b> (${signo}${formatValorM2(reg.variacion_abs).replace(" / m²", "")})`;
    } else {
      variacion.textContent = "";
    }
  }

  dibujarGraficaEvolucionZona(reg);
}

function renderAnalisisZonasLeyenda() {
  const el = document.getElementById("analisisZonasLeyenda");
  if (!el) return;
  const anios = obtenerAniosAnalisisZonas();
  el.innerHTML = anios.map(function(an, idx) {
    return `<span><i style="background:${colorAnioAnalisisZona(an, idx)}"></i>${an}</span>`;
  }).join("");
}

function dibujarGraficaEvolucionZona(reg, canvasOpt, opts) {
  opts = opts || {};
  if (!canvasOpt) renderAnalisisZonasLeyenda();
  const canvas = canvasOpt || document.getElementById("analisisZonasCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (opts.fondo) {
    ctx.fillStyle = opts.fondo;
    ctx.fillRect(0, 0, W, H);
  }

  if (!reg) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Seleccione una zona homogénea", W / 2, H / 2);
    return;
  }

  const padTopExtra = opts.titulo ? 24 : 0;
  const anios = obtenerAniosAnalisisZonas();
  const datos = anios.map(function(an) {
    let valor = reg["valor_" + an];
    if (valor == null) {
      const item = (reg.evolucion || []).find(function(e) { return e.anio === an; });
      valor = item?.valor_m2;
    }
    return { anio: an, valor: valor != null ? Number(valor) : null };
  }).filter(function(d) { return d.valor != null; });

  if (!datos.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sin valores registrados", W / 2, H / 2);
    return;
  }

  if (opts.titulo) {
    ctx.fillStyle = "#703341";
    ctx.font = "bold 15px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(opts.titulo, W / 2, 22);
  }

  const padL = 58, padR = 24, padT = 36 + padTopExtra, padB = 56;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max.apply(null, datos.map(function(d) { return d.valor; })) * 1.12;
  const barW = Math.min(72, chartW / (datos.length * 1.8));
  const gap = (chartW - barW * datos.length) / (datos.length + 1);

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + chartH);
  ctx.lineTo(padL + chartW, padT + chartH);
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Segoe UI, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const yVal = maxVal * (1 - i / 4);
    const y = padT + (chartH * i) / 4;
    ctx.fillText("$" + yVal.toLocaleString("es-MX", { maximumFractionDigits: 0 }), padL - 8, y + 4);
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  datos.forEach(function(d, i) {
    const x = padL + gap + i * (barW + gap);
    const h = (d.valor / maxVal) * chartH;
    const y = padT + chartH - h;
    ctx.fillStyle = colorAnioAnalisisZona(d.anio, i) || "#64748b";
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 11px Segoe UI, sans-serif";
    ctx.fillText("$" + d.valor.toLocaleString("es-MX", { maximumFractionDigits: 0 }), x + barW / 2, y - 6);
    ctx.fillStyle = "#475569";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillText(String(d.anio), x + barW / 2, padT + chartH + 18);
  });

  ctx.fillStyle = "#334155";
  ctx.font = "bold 12px Segoe UI, sans-serif";
  ctx.fillText(reg.clave_zonah || reg.codigo_zona_homogenea || "", W / 2, H - 8);

  ctx.save();
  ctx.translate(14, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748b";
  ctx.font = "11px Segoe UI, sans-serif";
  ctx.fillText("Valor × m²", 0, 0);
  ctx.restore();
}

function obtenerImagenGraficaZonaHomogenea(reg) {
  const c = document.createElement("canvas");
  c.width = 820;
  c.height = 460;
  dibujarGraficaEvolucionZona(reg, c, {
    titulo: "ZONA HOMOGÉNEA · VALOR × AÑO",
    fondo: "#ffffff"
  });
  try {
    return c.toDataURL("image/png");
  } catch (e) {
    return null;
  }
}

function recalcularVariacionZona(reg) {
  if (!reg) return reg;
  const v24 = reg.valor_2024;
  const v25 = reg.valor_2025;
  const v26 = reg.valor_2026;
  const base = v24 != null ? v24 : (v25 != null ? v25 : v26);
  const ultimo = v26 != null ? v26 : (v25 != null ? v25 : v24);
  reg.variacion_abs = null;
  reg.variacion_pct = null;
  if (base != null && ultimo != null) {
    reg.variacion_abs = Number(ultimo) - Number(base);
    if (Number(base) !== 0) {
      reg.variacion_pct = Math.round((reg.variacion_abs / Number(base)) * 10000) / 100;
    }
  }
  reg.evolucion = obtenerAniosAnalisisZonas().map(function(an) {
    const key = "valor_" + an;
    const val = reg[key];
    return { anio: an, valor_m2: val != null ? Number(val) : null, presente: val != null };
  });
  return reg;
}

let _analisisZonasFormModo = "editar";
let _logoInstitucionalCache = null;

function actualizarPreviewCodigoEditarZona() {
  const sub = (document.getElementById("editarZonaSubsector")?.value || "").trim().toUpperCase();
  const hom = (document.getElementById("editarZonaHomoclave")?.value || "").trim().toUpperCase();
  const sec = (document.getElementById("editarZonaSeccion")?.value || "").trim().toUpperCase();
  const cod = _codigo_zonah_desde_partes(sub, hom, sec);
  const prev = document.getElementById("editarZonaCodigoPreview");
  if (prev) prev.value = cod;
}

function prepararModalFormZonaHomogenea(modo) {
  _analisisZonasFormModo = modo;
  const heading = document.getElementById("editarZonaHeading");
  const btn = document.getElementById("editarZonaBtnGuardar");
  const bloqueTipo = document.getElementById("editarZonaBloqueTipo");
  if (heading) heading.textContent = modo === "nueva" ? "Registrar nueva zona homogénea" : "Corregir zona homogénea";
  if (btn) btn.textContent = modo === "nueva" ? "💾 Crear zona homogénea" : "💾 Guardar corrección";
  bloqueTipo?.classList.toggle("oculto", modo !== "nueva");

  ["editarZonaSubsector", "editarZonaHomoclave", "editarZonaSeccion"].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el || el.dataset.zhBind) return;
    el.dataset.zhBind = "1";
    el.addEventListener("input", actualizarPreviewCodigoEditarZona);
  });
}

function abrirModalFormZonaHomogenea() {
  const modal = document.getElementById("modalEditarZonaHomogenea");
  if (!modal) return;
  modal.classList.remove("oculto");
  document.body.classList.add("modal-zona-homogenea-activo");
}

function abrirEditarZonaHomogenea() {
  if (!puedeEditarCatastro()) {
    alert("No tiene permisos para editar valores de zona homogénea.");
    return;
  }
  const reg = registroAnalisisZonasActual();
  if (!reg) {
    alert("Seleccione una zona homogénea.");
    return;
  }
  prepararModalFormZonaHomogenea("editar");
  const cod = reg.clave_zonah || reg.codigo_zona_homogenea || "";
  document.getElementById("editarZonaTitulo").textContent = cod + (reg.descripcion_col_fracc ? " · " + reg.descripcion_col_fracc : "");
  document.getElementById("editarZonaDescripcion").value = reg.descripcion_col_fracc || "";
  document.getElementById("editarZonaZona").value = reg.zona || "";
  document.getElementById("editarZonaSector").value = reg.sector || "";
  document.getElementById("editarZonaSubsector").value = reg.subsector || "";
  document.getElementById("editarZonaHomoclave").value = reg.homoclave_col_fracc || "";
  document.getElementById("editarZonaSeccion").value = reg.seccion || "";
  renderEditarZonaValoresInputs(reg);
  document.getElementById("editarZonaMotivo").value = "";
  actualizarPreviewCodigoEditarZona();
  const msg = document.getElementById("editarZonaMensaje");
  if (msg) { msg.textContent = ""; msg.className = "modal-mov-msg"; }
  abrirModalFormZonaHomogenea();
}
window.abrirEditarZonaHomogenea = abrirEditarZonaHomogenea;

function abrirNuevaZonaHomogenea() {
  if (!puedeEditarCatastro()) {
    alert("No tiene permisos para crear zonas homogéneas.");
    return;
  }
  prepararModalFormZonaHomogenea("nueva");
  document.getElementById("editarZonaTitulo").textContent = "Capture los datos de la nueva zona (Subsector + Homoclave + Sección)";
  document.getElementById("editarZonaTipo").value = "OFICIAL";
  ["editarZonaDescripcion", "editarZonaZona", "editarZonaSector", "editarZonaSubsector",
    "editarZonaHomoclave", "editarZonaSeccion", "editarZonaMotivo"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderEditarZonaValoresInputs(null);
  actualizarPreviewCodigoEditarZona();
  const msg = document.getElementById("editarZonaMensaje");
  if (msg) { msg.textContent = ""; msg.className = "modal-mov-msg"; }
  abrirModalFormZonaHomogenea();
}
window.abrirNuevaZonaHomogenea = abrirNuevaZonaHomogenea;

function cerrarEditarZonaHomogenea() {
  document.getElementById("modalEditarZonaHomogenea")?.classList.add("oculto");
  document.body.classList.remove("modal-zona-homogenea-activo");
}
window.cerrarEditarZonaHomogenea = cerrarEditarZonaHomogenea;

async function guardarAjusteZonaHomogenea() {
  const msg = document.getElementById("editarZonaMensaje");
  const motivo = (document.getElementById("editarZonaMotivo")?.value || "").trim();
  if (!motivo) {
    if (msg) { msg.textContent = "Indique el motivo o fundamento legal."; msg.className = "modal-mov-msg error"; }
    return;
  }

  const valores = [];
  obtenerAniosAnalisisZonas().forEach(function(an) {
    const raw = document.getElementById("editarZonaValor" + an)?.value;
    if (raw !== "" && raw != null) valores.push({ anio: an, valor_m2: parseFloat(raw) });
  });
  if (!valores.length) {
    if (msg) { msg.textContent = "Capture al menos un valor por m²."; msg.className = "modal-mov-msg error"; }
    return;
  }

  const metaForm = {
    descripcion_col_fracc: (document.getElementById("editarZonaDescripcion")?.value || "").trim().toUpperCase(),
    zona: (document.getElementById("editarZonaZona")?.value || "").trim().toUpperCase(),
    sector: (document.getElementById("editarZonaSector")?.value || "").trim().toUpperCase(),
    subsector: (document.getElementById("editarZonaSubsector")?.value || "").trim().toUpperCase(),
    homoclave_col_fracc: (document.getElementById("editarZonaHomoclave")?.value || "").trim().toUpperCase(),
    seccion: (document.getElementById("editarZonaSeccion")?.value || "").trim().toUpperCase()
  };

  if (_analisisZonasFormModo === "nueva") {
    if (!metaForm.descripcion_col_fracc || !metaForm.zona || !metaForm.sector ||
        !metaForm.subsector || !metaForm.homoclave_col_fracc || !metaForm.seccion) {
      if (msg) { msg.textContent = "Complete zona, sector, subsector, homoclave, sección y descripción."; msg.className = "modal-mov-msg error"; }
      return;
    }
  }

  const reg = registroAnalisisZonasActual();
  const claveEdit = reg ? (reg.clave_zonah || reg.codigo_zona_homogenea) : "";
  const claveSel = _codigo_zonah_desde_partes(metaForm.subsector, metaForm.homoclave_col_fracc, metaForm.seccion) || claveEdit;

  let url = `${API}/padron/analisis/zonas-homogeneas`;
  let method = "PATCH";
  let payload;

  if (_analisisZonasFormModo === "nueva") {
    method = "POST";
    payload = Object.assign({}, metaForm, {
      motivo: motivo.toUpperCase(),
      tipo_registro: document.getElementById("editarZonaTipo")?.value || "OFICIAL",
      fundamento_legal: motivo.toUpperCase(),
      valores: valores
    });
  } else {
    if (!reg) return;
    payload = Object.assign({ clave_zonah: claveEdit, motivo: motivo.toUpperCase() }, metaForm, { valores: valores });
  }

  try {
    if (msg) { msg.textContent = "Guardando..."; msg.className = "modal-mov-msg"; }
    const r = await fetch(url, {
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, typeof authHeaders === "function" ? authHeaders() : {}),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "No se pudo guardar");

    _cacheCatalogoZonasHomogeneas = {};
    const idxPrev = _analisisZonasState.indice || 0;
    cerrarEditarZonaHomogenea();
    document.getElementById("analisisZonasCodigo").value = claveSel;
    await buscarAnalisisZonasHomogeneas();
    const nuevoIdx = (_analisisZonasState.resultados || []).findIndex(function(row) {
      return (row.clave_zonah || row.codigo_zona_homogenea) === claveSel;
    });
    _analisisZonasState.indice = nuevoIdx >= 0 ? nuevoIdx : idxPrev;
    renderAnalisisZonasCompleto();
    alert(_analisisZonasFormModo === "nueva" ? "Zona homogénea creada correctamente." : "Corrección guardada correctamente.");
  } catch (e) {
    if (msg) { msg.textContent = e.message || String(e); msg.className = "modal-mov-msg error"; }
  }
}
window.guardarAjusteZonaHomogenea = guardarAjusteZonaHomogenea;

function normalizarKeysImportZona(raw) {
  const out = {};
  Object.keys(raw || {}).forEach(function(k) {
    out[String(k).trim().toLowerCase().replace(/\s+/g, "_")] = raw[k];
  });
  return out;
}

function parsearArchivoZonasHomogeneas(file) {
  return new Promise(function(resolve, reject) {
    if (typeof XLSX === "undefined") {
      reject(new Error("Biblioteca Excel no disponible."));
      return;
    }
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array", raw: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          reject(new Error("El archivo no contiene hojas de datos."));
          return;
        }
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = function() { reject(new Error("No se pudo leer el archivo.")); };
    reader.readAsArrayBuffer(file);
  });
}

async function descargarPlantillaZonasHomogeneas() {
  try {
    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/plantilla.csv?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) {
      const data = await r.json().catch(function() { return {}; });
      throw new Error(data.detail || data.message || "No se pudo descargar la plantilla");
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_zonas_homogeneas.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message || String(e));
  }
}
window.descargarPlantillaZonasHomogeneas = descargarPlantillaZonasHomogeneas;

async function importarArchivoZonasHomogeneas() {
  if (!puedeEditarCatastro()) {
    alert("No tiene permisos para importar zonas homogéneas.");
    return;
  }
  const anio = parseInt(document.getElementById("analisisZonasImportAnio")?.value || "0", 10);
  const fileInput = document.getElementById("analisisZonasImportFile");
  const msg = document.getElementById("analisisZonasImportMsg");
  const reemplazar = document.getElementById("analisisZonasImportReemplazar")?.checked || false;
  const file = fileInput?.files?.[0];

  if (!anio || anio < 2020 || anio > 2035) {
    alert("Indique un año válido (2020–2035).");
    return;
  }
  if (!file) {
    alert("Seleccione un archivo CSV o Excel.");
    return;
  }
  const confirmMsg = reemplazar
    ? `¿Importar el ejercicio ${anio}? Se eliminarán todas las zonas oficiales de ese año antes de cargar el archivo.`
    : `¿Importar zonas homogéneas del ejercicio ${anio}?`;
  if (!confirm(confirmMsg)) return;

  if (msg) { msg.textContent = "Procesando archivo..."; msg.className = "analisis-zonas-import-msg"; }

  try {
    const rawRows = await parsearArchivoZonasHomogeneas(file);
    const filas = [];
    rawRows.forEach(function(raw) {
      const r = normalizarKeysImportZona(raw);
      const valorRaw = r.valor_m2 != null && r.valor_m2 !== "" ? r.valor_m2 : r.valor;
      const valor = parseFloat(String(valorRaw || "").replace(/[$,\s]/g, ""));
      if (isNaN(valor)) return;
      const fila = {
        anio: anio,
        zona: String(r.zona || "").trim(),
        sector: String(r.sector || "").trim(),
        subsector: String(r.subsector || "").trim(),
        homoclave_col_fracc: String(r.homoclave_col_fracc || r.homoclave || "").trim(),
        seccion: String(r.seccion || "").trim(),
        descripcion_col_fracc: String(r.descripcion_col_fracc || r.descripcion || "").trim(),
        valor_m2: valor
      };
      const cod = String(r.codigo_zona_homogenea || r.codigo || "").trim();
      if (cod) fila.codigo_zona_homogenea = cod;
      filas.push(fila);
    });
    if (!filas.length) throw new Error("No se encontraron filas válidas. Verifique columnas y valores.");

    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/importar`, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, typeof authHeaders === "function" ? authHeaders() : {}),
      body: JSON.stringify({ anio: anio, reemplazar: reemplazar, filas: filas })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "Error en importación");

    _cacheCatalogoZonasHomogeneas = {};
    const detalleErrores = (data.errores && data.errores.length)
      ? " · " + data.errores.slice(0, 3).join("; ")
      : "";
    if (msg) {
      msg.textContent = `Listo: ${data.procesados || 0} procesados (${data.insertados || 0} nuevos, ${data.actualizados || 0} actualizados${data.omitidos ? ", " + data.omitidos + " omitidos" : ""})${detalleErrores}`;
      msg.className = "analisis-zonas-import-msg ok";
    }
    if (fileInput) fileInput.value = "";
    await cargarFiltrosAnalisisZonas();
    await buscarAnalisisZonasHomogeneas();
  } catch (e) {
    if (msg) { msg.textContent = e.message || String(e); msg.className = "analisis-zonas-import-msg error"; }
  }
}
window.importarArchivoZonasHomogeneas = importarArchivoZonasHomogeneas;

function exportarAnalisisZonasExcel() {
  const arr = _analisisZonasState.resultados || [];
  if (!arr.length) {
    alert("No hay resultados para exportar. Ejecute una búsqueda primero.");
    return;
  }
  if (typeof XLSX === "undefined") {
    alert("Biblioteca Excel no disponible.");
    return;
  }
  const anios = obtenerAniosAnalisisZonas();
  const filas = arr.map(function(row) {
    const o = {
      "Código": row.clave_zonah || row.codigo_zona_homogenea || "",
      "Descripción": row.descripcion_col_fracc || "",
      "Zona": row.zona || "",
      "Sector": row.sector || "",
      "Subsector": row.subsector || "",
      "Tipo": row.es_adicional ? (row.tipo_zona || "ADICIONAL") : "OFICIAL"
    };
    anios.forEach(function(an) {
      const val = row["valor_" + an];
      o[String(an) + " ($/m²)"] = val != null ? Number(val) : "";
    });
    if (row.variacion_pct != null) {
      o["Variación %"] = row.variacion_pct;
      o["Variación $/m²"] = row.variacion_abs;
    }
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Zonas homogéneas");
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, "zonas_homogeneas_" + fecha + ".xlsx");
}
window.exportarAnalisisZonasExcel = exportarAnalisisZonasExcel;

/* --- Análisis tipo de tenencia (campo padron.condominio) --- */

const TIPOS_TENENCIA_UI = {
  C: { codigo: "C", nombre: "Condominio", desc: "Régimen en condominio." },
  P: { codigo: "P", nombre: "Privado", desc: "Propiedad privada individual." },
  G: { codigo: "G", nombre: "Gobierno / Pública", desc: "Propiedad de gobierno o sector público." },
  S: { codigo: "S", nombre: "Social", desc: "Vivienda o patrimonio social." },
  R: { codigo: "R", nombre: "Rústica", desc: "Propiedad de carácter rústico." },
  E: { codigo: "E", nombre: "Ejidal", desc: "Régimen ejidal o comunal." }
};

const TIPOS_CONDOMINIO_UI = TIPOS_TENENCIA_UI;

function htmlOpcionesTenenciaPadron(valorSel, incluirVacio, vacioLabel) {
  let html = incluirVacio ? `<option value="">${escapeHtml(vacioLabel || "SELECCIONE...")}</option>` : "";
  Object.values(TIPOS_TENENCIA_UI).forEach(function(t) {
    const sel = String(valorSel || "").toUpperCase() === t.codigo ? " selected" : "";
    html += `<option value="${t.codigo}"${sel}>${t.codigo} — ${escapeHtml(t.nombre)}</option>`;
  });
  return html;
}
window.htmlOpcionesTenenciaPadron = htmlOpcionesTenenciaPadron;

let _analisisCondominiosState = {
  resumen: null,
  tiposPadron: [],
  catalogo: [],
  unidades: [],
  valorActivo: "",
  tipoActivo: "",
  totalCatalogo: 0,
  totalUnidades: 0,
  cargando: false,
  seleccion: {}
};

let _clasifMasivaState = {
  resultados: [],
  seleccion: {},
  total: 0
};

function tipoCondominioSeleccionado() {
  return (document.getElementById("analisisCondominiosTipo")?.value || "C").trim().toUpperCase();
}

function formatoNumeroEntero(n) {
  return Number(n || 0).toLocaleString("es-MX");
}

function etiquetaTipoCondominio(tipo) {
  const key = (tipo || "").toUpperCase();
  return TIPOS_TENENCIA_UI[key] || { codigo: key || "?", nombre: key || "Otro", desc: "" };
}

function pintarKpiCondominios(data, prefix) {
  const p = prefix || "condKpi";
  const elCond = document.getElementById(p === "condKpi" ? "condKpiCondominios" : "condTabTotalCondominios");
  const elUni = document.getElementById(p === "condKpi" ? "condKpiUnidades" : "condTabTotalUnidades");
  const elVal = document.getElementById(p === "condKpi" ? "condKpiValor" : "condTabValorTotal");
  const elAde = document.getElementById("condKpiAdeudo");
  const tipos = data?.total_tipos ?? data?.total_condominios;
  if (elCond) elCond.textContent = formatoNumeroEntero(tipos);
  if (elUni) elUni.textContent = formatoNumeroEntero(data?.total_unidades);
  if (elVal) elVal.textContent = formatoMoneda(data?.valor_total_2026);
  if (elAde) elAde.textContent = formatoMoneda(data?.adeudo_total);
}

function renderLeyendaTiposCondominio(tipos) {
  const box = document.getElementById("analisisCondominiosLeyenda");
  if (!box) return;
  const base = Object.values(TIPOS_TENENCIA_UI).map(t => (
    `<div class="condominios-leyenda-item"><b>${escapeHtml(t.codigo)}</b> ${escapeHtml(t.nombre)} — ${escapeHtml(t.desc)}</div>`
  )).join("");
  let extra = "";
  if ((tipos || []).length) {
    extra = `<div class="condominios-leyenda-padron">En su padrón: ${tipos.map(t =>
      `<span><b>${escapeHtml(t.tipo_codigo || t.tipo || "—")}</b> ${formatoNumeroEntero(t.unidades)}</span>`
    ).join(" · ")}</div>`;
  }
  box.innerHTML = base + extra;
}

async function cargarTiposCondominioPadron() {
  const r = await fetch(`${API}/padron/condominios/tipos?_=${Date.now()}`, {
    cache: "no-store",
    headers: typeof authHeaders === "function" ? authHeaders() : {}
  });
  if (!r.ok) throw new Error("No se pudo cargar el catálogo de tipos.");
  return r.json();
}

async function cargarResumenCondominiosPadron(tipo, extras) {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  const ex = extras || {};
  if (ex.prefijoClave) agregarParamsPrefijoClave(params, ex.prefijoClave);
  if (ex.colonia) params.set("colonia", ex.colonia);
  if (ex.texto) params.set("q", ex.texto);
  const r = await fetch(`${API}/padron/condominios/resumen?${params}`, {
    cache: "no-store",
    headers: typeof authHeaders === "function" ? authHeaders() : {}
  });
  if (!r.ok) throw new Error("No se pudo cargar el resumen de condominios.");
  return r.json();
}

async function cargarResumenCondominiosTab() {
  try {
    const data = await cargarResumenCondominiosPadron("C");
    _analisisCondominiosState.resumen = data;
    pintarKpiCondominios(data, "condTab");
  } catch (e) {
    console.warn("Resumen condominios tab:", e);
  }
}

function filtrosAnalisisCondominiosForm() {
  return {
    tipo: tipoCondominioSeleccionado(),
    colonia: (document.getElementById("analisisCondominiosColonia")?.value || "").trim(),
    prefijoClave: (document.getElementById("analisisCondominiosPrefijoClave")?.value || "").trim().toUpperCase(),
    texto: (document.getElementById("analisisCondominiosTexto")?.value || "").trim()
  };
}

function agregarParamsPrefijoClave(params, prefijoClave) {
  const pref = (prefijoClave || "").trim().toUpperCase();
  if (!pref) return "";
  params.set("clave_prefijo", pref);
  params.set("clave", pref);
  return pref;
}

function filtrarUnidadesPorPrefijoClave(rows, prefijoClave) {
  const pref = (prefijoClave || "").trim().toUpperCase();
  if (!pref) {
    return { rows: rows || [], descartados: 0, apiIgnoroPrefijo: false };
  }
  const src = rows || [];
  const filtradas = src.filter(function(row) {
    return String(row.clave_catastral || "").toUpperCase().startsWith(pref);
  });
  return {
    rows: filtradas,
    descartados: src.length - filtradas.length,
    apiIgnoroPrefijo: src.length > 0 && filtradas.length === 0
  };
}

function onCambioTipoCondominios() {
  _analisisCondominiosState.valorActivo = "";
  _analisisCondominiosState.tipoActivo = "";
  buscarCatalogoCondominios();
}
window.onCambioTipoCondominios = onCambioTipoCondominios;

function limpiarFiltrosAnalisisCondominios() {
  const sel = document.getElementById("analisisCondominiosTipo");
  if (sel) sel.value = "C";
  ["analisisCondominiosColonia", "analisisCondominiosTexto", "analisisCondominiosPrefijoClave"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  _analisisCondominiosState.valorActivo = "";
  _analisisCondominiosState.tipoActivo = "";
  const tit = document.getElementById("analisisCondominiosTituloUnidades");
  if (tit) tit.textContent = "Seleccione un tipo";
  buscarCatalogoCondominios();
}
window.limpiarFiltrosAnalisisCondominios = limpiarFiltrosAnalisisCondominios;

async function abrirModuloAnalisisCondominios() {
  document.getElementById("overlayAnalisisCondominios")?.classList.remove("oculto");
  document.body.classList.add("analisis-condominios-activo");
  try {
    const tiposData = await cargarTiposCondominioPadron();
    _analisisCondominiosState.tiposPadron = tiposData.tipos_en_padron || [];
    renderLeyendaTiposCondominio(_analisisCondominiosState.tiposPadron);
    _analisisCondominiosState.resumen = await cargarResumenCondominiosPadron(tipoCondominioSeleccionado());
    pintarKpiCondominios(_analisisCondominiosState.resumen, "condKpi");
  } catch (e) {
    console.warn(e);
  }
  await buscarCatalogoCondominios();
}
window.abrirModuloAnalisisCondominios = abrirModuloAnalisisCondominios;

function cerrarModuloAnalisisCondominios() {
  document.getElementById("overlayAnalisisCondominios")?.classList.add("oculto");
  document.body.classList.remove("analisis-condominios-activo");
}
window.cerrarModuloAnalisisCondominios = cerrarModuloAnalisisCondominios;

async function buscarCatalogoCondominios() {
  if (_analisisCondominiosState.cargando) return;
  _analisisCondominiosState.cargando = true;
  const f = filtrosAnalisisCondominiosForm();
  const cont = document.getElementById("analisisCondominiosCatalogo");
  if (cont) cont.innerHTML = `<div class="analisis-zonas-meta">Buscando tipos...</div>`;
  try {
    const params = new URLSearchParams({ limite: "500", tipo: f.tipo });
    agregarParamsPrefijoClave(params, f.prefijoClave);
    if (f.colonia) params.set("colonia", f.colonia);
    if (f.texto) params.set("q", f.texto);
    const [dataResumen, r] = await Promise.all([
      cargarResumenCondominiosPadron(f.tipo, f),
      fetch(`${API}/padron/condominios/catalogo?${params}`, {
        headers: typeof authHeaders === "function" ? authHeaders() : {}
      })
    ]);
    _analisisCondominiosState.resumen = dataResumen;
    pintarKpiCondominios(dataResumen, "condKpi");
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "Error al buscar tipos.");
    _analisisCondominiosState.catalogo = data.resultados || [];
    _analisisCondominiosState.totalCatalogo = data.total || _analisisCondominiosState.catalogo.length;
    renderCatalogoCondominios();
    await buscarUnidadesCondominio();
    const meta = document.getElementById("analisisCondominiosMeta");
    const etiq = etiquetaTipoCondominio(f.tipo === "TODOS" ? "" : f.tipo);
    if (meta) {
      const prefTxt = f.prefijoClave ? ` · prefijo ${f.prefijoClave}` : "";
      meta.textContent = `Filtro: ${f.tipo === "TODOS" ? "Todos" : etiq.nombre}${prefTxt} · ${formatoNumeroEntero(_analisisCondominiosState.totalCatalogo)} grupo(s)`;
    }
    const cnt = document.getElementById("analisisCondominiosContador");
    if (cnt) cnt.textContent = `${formatoNumeroEntero(dataResumen.total_unidades || 0)} predios`;
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="analisis-zonas-error">${escapeHtml(e.message)}</div>`;
  } finally {
    _analisisCondominiosState.cargando = false;
  }
}
window.buscarCatalogoCondominios = buscarCatalogoCondominios;

function renderCatalogoCondominios() {
  const cont = document.getElementById("analisisCondominiosCatalogo");
  if (!cont) return;
  const rows = _analisisCondominiosState.catalogo || [];
  if (!rows.length) {
    cont.innerHTML = `<div class="analisis-zonas-meta">Sin registros con ese tipo.</div>`;
    return;
  }
  const activo = _analisisCondominiosState.valorActivo || "";
  let html = `<table class="analisis-condominios-tabla"><thead><tr>
    <th>Tipo de tenencia</th><th>Código</th><th>Unidades</th><th>Colonias</th><th>Valor total</th><th>Adeudo</th>
  </tr></thead><tbody>`;
  rows.forEach(function(row, idx) {
    const val = row.condominio || row.valor_padron || "";
    const cls = val === activo ? "activo" : "";
    html += `<tr class="${cls}" onclick="seleccionarCondominioAnalisis(${idx})">
      <td><b>${escapeHtml(row.tipo_nombre || row.tipo || "")}</b><br><small>${escapeHtml(row.tipo_descripcion || "")}</small></td>
      <td>${escapeHtml(val || "—")}</td>
      <td>${formatoNumeroEntero(row.unidades)}</td>
      <td>${formatoNumeroEntero(row.colonias)}</td>
      <td>${formatoMoneda(row.valor_total)}</td>
      <td>${formatoMoneda(row.adeudo_total)}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
}

function seleccionarCondominioAnalisis(idx) {
  const row = (_analisisCondominiosState.catalogo || [])[idx];
  if (!row) return;
  _analisisCondominiosState.valorActivo = row.tipo === "NULL"
    ? "NULL"
    : (row.condominio || row.valor_padron || "");
  _analisisCondominiosState.tipoActivo = row.tipo || "";
  const sel = document.getElementById("analisisCondominiosTipo");
  if (sel && row.tipo) sel.value = row.tipo;
  renderCatalogoCondominios();
  buscarUnidadesCondominio();
}
window.seleccionarCondominioAnalisis = seleccionarCondominioAnalisis;

async function buscarUnidadesCondominio() {
  const f = filtrosAnalisisCondominiosForm();
  const valor = _analisisCondominiosState.valorActivo;
  const cont = document.getElementById("analisisCondominiosUnidades");
  if (cont) cont.innerHTML = `<div class="analisis-zonas-meta">Cargando unidades...</div>`;
  try {
    const params = new URLSearchParams({ limite: "5000", tipo: f.tipo });
    agregarParamsPrefijoClave(params, f.prefijoClave);
    if (valor) params.set("condominio", valor === "NULL" ? "NULL" : valor);
    else if (f.tipo && f.tipo !== "TODOS") params.set("condominio", f.tipo);
    if (f.colonia) params.set("colonia", f.colonia);
    if (f.texto) params.set("q", f.texto);
    const r = await fetch(`${API}/padron/condominios/unidades?${params}`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {},
      cache: "no-store"
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "Error al cargar unidades.");
    const filtrado = filtrarUnidadesPorPrefijoClave(data.resultados || [], f.prefijoClave);
    _analisisCondominiosState.unidades = filtrado.rows;
    _analisisCondominiosState.apiIgnoroPrefijoClave = filtrado.apiIgnoroPrefijo;
    _analisisCondominiosState.descartadosPrefijoClave = filtrado.descartados;

    let total = Number(data.total || filtrado.rows.length);
    if (f.prefijoClave) {
      if (data.clave_prefijo) {
        total = Number(data.total || filtrado.rows.length);
      } else if (filtrado.apiIgnoroPrefijo) {
        try {
          const qs = new URLSearchParams({ prefijo: f.prefijoClave, _: String(Date.now()) });
          if (f.tipo && f.tipo !== "TODOS") qs.set("tipo_actual", f.tipo);
          const rPrev = await fetch(`${API}/padron/tenencia/por-prefijo/resumen?${qs}`, {
            headers: typeof authHeaders === "function" ? authHeaders() : {},
            cache: "no-store"
          });
          const prev = await rPrev.json().catch(() => ({}));
          if (rPrev.ok) total = Number(prev.total || 0);
        } catch (_e) { /* usar total filtrado local */ }
      } else if (filtrado.descartados > 0) {
        total = filtrado.rows.length;
      }
    }
    _analisisCondominiosState.totalUnidades = total;
    renderUnidadesCondominio();
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="analisis-zonas-error">${escapeHtml(e.message)}</div>`;
  }
}
window.buscarUnidadesCondominio = buscarUnidadesCondominio;

function renderUnidadesCondominio() {
  const cont = document.getElementById("analisisCondominiosUnidades");
  const tit = document.getElementById("analisisCondominiosTituloUnidades");
  if (!cont) return;
  const rows = _analisisCondominiosState.unidades || [];
  const val = _analisisCondominiosState.valorActivo;
  const tipo = _analisisCondominiosState.tipoActivo || tipoCondominioSeleccionado();
  const etiq = etiquetaTipoCondominio(tipo);
  const prefActivo = (document.getElementById("analisisCondominiosPrefijoClave")?.value || "").trim().toUpperCase();
  if (tit) {
    const prefTxt = prefActivo ? ` · prefijo ${prefActivo}` : "";
    tit.textContent = val
      ? `${etiq.nombre} · ${val || "—"}${prefTxt} (${formatoNumeroEntero(_analisisCondominiosState.totalUnidades)})`
      : `${etiq.nombre}${prefTxt} (${formatoNumeroEntero(_analisisCondominiosState.totalUnidades)} predios)`;
  }
  if (!rows.length) {
    if (_analisisCondominiosState.apiIgnoroPrefijoClave && prefActivo) {
      cont.innerHTML = `<div class="analisis-zonas-error">La API no aplicó el prefijo «${escapeHtml(prefActivo)}». Suba <b>padron.py</b> y <b>catastro.js</b> al servidor, reinicie <b>catastro-api</b> y recargue con Ctrl+F5. Verifique en /api/catastro/ que aparezca <b>tenencia_prefijo_clave: true</b>.</div>`;
      return;
    }
    cont.innerHTML = `<div class="analisis-zonas-meta">Sin predios para el criterio seleccionado.</div>`;
    return;
  }
  const sel = _analisisCondominiosState.seleccion || {};
  let html = "";
  if (_analisisCondominiosState.descartadosPrefijoClave > 0) {
    html += `<div class="condominios-aviso-prefijo">Se descartaron ${formatoNumeroEntero(_analisisCondominiosState.descartadosPrefijoClave)} registro(s) que no empiezan por ${escapeHtml(prefActivo)} (la API aún no filtra por prefijo).</div>`;
  }
  html += `<div class="condominios-unidades-acciones">
    <button type="button" class="btn-busqueda-unica" onclick="toggleSeleccionUnidadesCondominio(true)">Marcar visibles</button>
    <button type="button" onclick="toggleSeleccionUnidadesCondominio(false)">Desmarcar</button>
    <button type="button" class="btn-busqueda-unica" onclick="abrirClasificacionCondominioMasivaDesdeUnidades()">Clasificar vertical/horizontal</button>
    <span class="perm-editar-catastro condominios-tenencia-masiva">
      <select id="analisisTenenciaAsignar">${htmlOpcionesTenenciaPadron("P", true, "Asignar tenencia…")}</select>
      <button type="button" class="btn-busqueda-unica" onclick="asignarTenenciaUnidadesSeleccionadas()">Asignar tenencia</button>
    </span>
  </div>`;
  html += `<table class="analisis-condominios-tabla analisis-condominios-tabla-unidades"><thead><tr>
    <th><input type="checkbox" onchange="toggleSeleccionUnidadesCondominio(this.checked)"></th>
    <th>Clave</th><th>Ten.</th><th>Nombre condominio</th><th>Modalidad</th><th>Titular</th><th>Ubicación</th><th>Int.</th><th>Valor 2026</th>
  </tr></thead><tbody>`;
  rows.forEach(function(row, idx) {
    const clave = row.clave_catastral || "";
    const checked = !!sel[clave];
    const ubic = [row.colonia, row.calle, row.numof].filter(Boolean).join(" · ");
    const interior = [row.numint, row.letra].filter(Boolean).join(" ");
    const modTxt = row.modalidad ? (etiquetaModalidadCondominio(row.modalidad)?.nombre || row.modalidad) : "—";
    const nomCond = row.nombre_condominio || "—";
    const tenTxt = row.tipo_nombre || etiquetaTipoCondominio(row.condominio || row.tipo).nombre;
    const tenCod = row.condominio || row.tipo || "—";
    html += `<tr class="analisis-cond-unidad-row${checked ? " activo" : ""}">
      <td onclick="event.stopPropagation()"><input type="checkbox" data-clave="${escapeHtml(clave)}" ${checked ? "checked" : ""} onchange="toggleSeleccionUnidadCondominio('${escapeHtml(clave)}', this.checked)"></td>
      <td onclick="abrirPredioCondominioIdx(${idx})"><b>${escapeHtml(clave)}</b></td>
      <td onclick="abrirPredioCondominioIdx(${idx})" title="${escapeHtml(tenTxt)}"><b>${escapeHtml(tenCod)}</b></td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(nomCond)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(modTxt)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(row.nombre_completo || "")}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(ubic)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(interior)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${formatoMoneda(row.valor2026)}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  if (_analisisCondominiosState.totalUnidades > rows.length) {
    html += `<div class="analisis-zonas-meta">Mostrando ${rows.length} de ${formatoNumeroEntero(_analisisCondominiosState.totalUnidades)} predios.</div>`;
  }
  cont.innerHTML = html;
}

function toggleSeleccionUnidadCondominio(clave, on) {
  if (!_analisisCondominiosState.seleccion) _analisisCondominiosState.seleccion = {};
  if (on) _analisisCondominiosState.seleccion[clave] = true;
  else delete _analisisCondominiosState.seleccion[clave];
  renderUnidadesCondominio();
}
window.toggleSeleccionUnidadCondominio = toggleSeleccionUnidadCondominio;

function toggleSeleccionUnidadesCondominio(on) {
  const rows = _analisisCondominiosState.unidades || [];
  if (!_analisisCondominiosState.seleccion) _analisisCondominiosState.seleccion = {};
  rows.forEach(r => {
    const c = r.clave_catastral;
    if (!c) return;
    if (on) _analisisCondominiosState.seleccion[c] = true;
    else delete _analisisCondominiosState.seleccion[c];
  });
  renderUnidadesCondominio();
}
window.toggleSeleccionUnidadesCondominio = toggleSeleccionUnidadesCondominio;

function clavesSeleccionadasUnidadesCondominio() {
  return Object.keys(_analisisCondominiosState.seleccion || {});
}

async function asignarTenenciaUnidadesSeleccionadas() {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para asignar tenencia.");
    return;
  }
  const tenencia = (document.getElementById("analisisTenenciaAsignar")?.value || "").trim().toUpperCase();
  const claves = clavesSeleccionadasUnidadesCondominio();
  if (!tenencia) {
    alert("Seleccione el tipo de tenencia a asignar.");
    return;
  }
  if (!claves.length) {
    alert("Marque al menos un predio en la lista de unidades.");
    return;
  }
  const etiq = etiquetaTipoCondominio(tenencia).nombre;
  if (!confirm(`¿Asignar tenencia ${etiq} (${tenencia}) a ${claves.length} predio(s)?`)) return;
  try {
    const r = await fetch(`${API}/padron/tenencia/masiva`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ claves, tenencia, confirmar: true })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.mensaje || "No se pudo asignar tenencia.");
    alert(data.mensaje || `Actualizados: ${data.actualizadas || 0}`);
    _analisisCondominiosState.seleccion = {};
    await buscarCatalogoCondominios();
  } catch (e) {
    alert(e.message || "Error al asignar tenencia.");
  }
}
window.asignarTenenciaUnidadesSeleccionadas = asignarTenenciaUnidadesSeleccionadas;

async function asignarTenenciaPorPrefijoClave() {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para asignar tenencia.");
    return;
  }
  const f = filtrosAnalisisCondominiosForm();
  const prefijo = f.prefijoClave;
  if (!prefijo) {
    alert("Capture el prefijo de clave (ej. RU) en el campo «Prefijo de clave».");
    return;
  }
  const tenencia = (document.getElementById("analisisTenenciaAsignar")?.value || "R").trim().toUpperCase();
  if (!tenencia || tenencia === "") {
    alert("Seleccione el tipo de tenencia a asignar en el listado de unidades.");
    return;
  }
  const etiq = etiquetaTipoCondominio(tenencia).nombre;
  try {
    const qs = new URLSearchParams({ prefijo, _: String(Date.now()) });
    if (f.tipo && f.tipo !== "TODOS") qs.set("tipo_actual", f.tipo);
    const rPrev = await fetch(`${API}/padron/tenencia/por-prefijo/resumen?${qs}`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    const prev = await rPrev.json().catch(() => ({}));
    if (!rPrev.ok) throw new Error(prev.detail || "No se pudo obtener vista previa.");
    const n = Number(prev.total || 0);
    if (!n) {
      alert(`No hay predios cuya clave empiece con «${prefijo}».`);
      return;
    }
    const muestra = (prev.muestra || []).slice(0, 8).map(m => m.clave_catastral).join(", ");
    const porTen = (prev.por_tenencia || []).map(t => `${t.tenencia || "?"}: ${formatoNumeroEntero(t.total)}`).join(" · ");
    const filtroTipo = f.tipo && f.tipo !== "TODOS" ? `\nSolo tenencia actual: ${f.tipo}.` : "";
    const msg = [
      `Se asignará ${etiq} (${tenencia}) a ${formatoNumeroEntero(n)} predio(s) con clave que empieza por ${prefijo}.`,
      porTen ? `Distribución actual: ${porTen}.` : "",
      muestra ? `Ejemplo: ${muestra}${(prev.muestra || []).length > 8 ? "…" : ""}` : "",
      filtroTipo,
      "",
      "¿Desea continuar?"
    ].filter(Boolean).join("\n");
    if (!confirm(msg)) return;

    const r = await fetch(`${API}/padron/tenencia/por-prefijo`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        prefijo,
        tenencia,
        tipo_actual: f.tipo && f.tipo !== "TODOS" ? f.tipo : "",
        confirmar: true
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.mensaje || "No se pudo asignar tenencia.");
    alert(data.mensaje || `Actualizados: ${data.actualizadas || 0}`);
    await buscarCatalogoCondominios();
  } catch (e) {
    alert(e.message || "Error al asignar tenencia por prefijo.");
  }
}
window.asignarTenenciaPorPrefijoClave = asignarTenenciaPorPrefijoClave;

function abrirClasificacionCondominioMasivaDesdeUnidades() {
  const claves = clavesSeleccionadasUnidadesCondominio();
  if (!claves.length) {
    alert("Marque al menos un predio en la lista de unidades.");
    return;
  }
  abrirClasificacionCondominioMasiva(claves.join("\n"), claves);
}
window.abrirClasificacionCondominioMasivaDesdeUnidades = abrirClasificacionCondominioMasivaDesdeUnidades;

function asegurarModalClasificacionCondominioMasiva() {
  const versionModal = "v2";
  const existente = document.getElementById("modalClasificacionCondominioMasiva");
  if (existente && existente.dataset.version !== versionModal) {
    existente.remove();
  }
  if (document.getElementById("modalClasificacionCondominioMasiva")) {
    document.getElementById("modalClasificacionCondominioMasiva").classList.add("clasif-masiva-overlay");
    return;
  }
  const modal = document.createElement("div");
  modal.id = "modalClasificacionCondominioMasiva";
  modal.dataset.version = versionModal;
  modal.className = "coprop-overlay clasif-masiva-overlay oculto";
  modal.innerHTML = `
    <div class="coprop-modal clasif-masiva-modal">
      <div class="coprop-head">
        <h3>🏢 Clasificación masiva de condominios</h3>
        <button type="button" class="coprop-close-btn" onclick="cerrarClasificacionCondominioMasiva()" title="Cerrar">×</button>
      </div>
      <div class="clasif-masiva-body">
        <div class="clasif-masiva-buscar">
          <div class="section-label">Buscar predios en padrón</div>
          <label class="input-label-mini">Claves (una por línea, coma o espacio)</label>
          <textarea id="clasifMasivaClaves" rows="3" placeholder="PA504013&#10;AL032006&#10;AL032066"></textarea>
          <small class="clasif-masiva-ayuda">Si captura claves aquí, solo se buscarán esas claves exactas (se ignoran prefijo y demás filtros).</small>
          <div class="clasif-masiva-grid">
            <div>
              <label class="input-label-mini">Prefijo de clave</label>
              <input id="clasifMasivaPrefijo" type="text" placeholder="PA504">
            </div>
            <div>
              <label class="input-label-mini">Nombre condominio</label>
              <input id="clasifMasivaBuscarNombre" type="text" list="clasifMasivaNombresLista" placeholder="Buscar por nombre asignado">
              <datalist id="clasifMasivaNombresLista"></datalist>
            </div>
          </div>
          <div class="clasif-masiva-grid">
            <div><label class="input-label-mini">Colonia</label><input id="clasifMasivaColonia" type="text"></div>
            <div><label class="input-label-mini">Calle</label><input id="clasifMasivaCalle" type="text"></div>
            <div><label class="input-label-mini">Número</label><input id="clasifMasivaNumof" type="text"></div>
          </div>
          <label class="input-label-mini">Texto libre (clave, titular, calle, colonia, nombre condominio)</label>
          <input id="clasifMasivaQ" type="text" placeholder="Filtro general">
          <label class="clasif-masiva-filtro-c"><input type="checkbox" id="clasifMasivaSoloC"> Solo predios con <b>C</b> en padrón fiscal</label>
          <div class="clasif-masiva-acciones">
            <button type="button" class="coprop-btn" onclick="buscarPrediosClasificacionMasiva()">Buscar predios</button>
            <button type="button" class="coprop-btn sec" onclick="limpiarBusquedaClasificacionMasiva()">Limpiar</button>
          </div>
        </div>
        <div class="clasif-masiva-resultados">
          <div class="clasif-masiva-resultados-head">
            <span id="clasifMasivaContador">0 predio(s)</span>
            <div>
              <button type="button" onclick="toggleSeleccionTodasClasifMasiva(true)">Marcar todas</button>
              <button type="button" onclick="toggleSeleccionTodasClasifMasiva(false)">Desmarcar</button>
            </div>
          </div>
          <div id="clasifMasivaTabla" class="clasif-masiva-tabla-wrap">Busque predios para seleccionarlos.</div>
        </div>
        <div class="clasif-masiva-aplicar">
          <div class="section-label">Aplicar a seleccionados</div>
          <label class="input-label-mini">Nombre del condominio</label>
          <input id="clasifMasivaNombreAplicar" type="text" list="clasifMasivaNombresLista" placeholder="Nombre común del conjunto">
          <label class="input-label-mini">Modalidad</label>
          <select id="clasifMasivaModalidadAplicar">
            <option value="__NO_CAMBIAR__">— No cambiar modalidad —</option>
            <option value="">Sin clasificar (limpiar)</option>
            <option value="HORIZONTAL">Horizontal</option>
            <option value="VERTICAL">Vertical</option>
          </select>
          <div class="clasif-masiva-acciones">
            <button type="button" class="coprop-btn ok" onclick="aplicarClasificacionCondominioMasiva()">Aplicar clasificación masiva</button>
          </div>
          <div id="clasifMasivaMsg" class="coprop-msg"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function abrirClasificacionCondominioMasiva(clavesPrefill = "", clavesSeleccionInicial = null) {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para clasificar condominios.");
    return;
  }
  asegurarModalClasificacionCondominioMasiva();
  limpiarBusquedaClasificacionMasiva(false);
  _clasifMasivaState = {
    resultados: [],
    seleccion: {},
    total: 0,
    seleccionInicial: Array.isArray(clavesSeleccionInicial) ? clavesSeleccionInicial.map(c => String(c || "").trim().toUpperCase()).filter(Boolean) : null
  };
  if (clavesPrefill) {
    document.getElementById("clasifMasivaClaves").value = clavesPrefill;
  }
  document.getElementById("modalClasificacionCondominioMasiva").classList.remove("oculto");
  cargarSugerenciasNombreCondominio();
  if (clavesPrefill) buscarPrediosClasificacionMasiva();
}
window.abrirClasificacionCondominioMasiva = abrirClasificacionCondominioMasiva;

function cerrarClasificacionCondominioMasiva() {
  document.getElementById("modalClasificacionCondominioMasiva")?.classList.add("oculto");
}
window.cerrarClasificacionCondominioMasiva = cerrarClasificacionCondominioMasiva;

function limpiarBusquedaClasificacionMasiva(limpiarClaves = true) {
  const ids = ["clasifMasivaPrefijo", "clasifMasivaBuscarNombre", "clasifMasivaColonia", "clasifMasivaCalle", "clasifMasivaNumof", "clasifMasivaQ"];
  if (limpiarClaves) ids.unshift("clasifMasivaClaves");
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  _clasifMasivaState = { resultados: [], seleccion: {}, total: 0, seleccionInicial: null };
  renderResultadosClasificacionMasiva();
}
window.limpiarBusquedaClasificacionMasiva = limpiarBusquedaClasificacionMasiva;

async function buscarPrediosClasificacionMasiva() {
  const cont = document.getElementById("clasifMasivaTabla");
  if (cont) cont.innerHTML = "Buscando...";
  const clavesTexto = (document.getElementById("clasifMasivaClaves")?.value || "").trim();
  const payload = {
    solo_regimen_c: !!document.getElementById("clasifMasivaSoloC")?.checked,
    limite: 2000
  };
  if (clavesTexto) {
    payload.claves_texto = clavesTexto;
    payload.solo_regimen_c = false;
  } else {
    payload.clave_prefijo = document.getElementById("clasifMasivaPrefijo")?.value || "";
    payload.nombre_condominio = document.getElementById("clasifMasivaBuscarNombre")?.value || "";
    payload.colonia = document.getElementById("clasifMasivaColonia")?.value || "";
    payload.calle = document.getElementById("clasifMasivaCalle")?.value || "";
    payload.numof = document.getElementById("clasifMasivaNumof")?.value || "";
    payload.q = document.getElementById("clasifMasivaQ")?.value || "";
  }
  try {
    const r = await fetch(`${API}/condominios/clasificacion/buscar`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar predios."));
    _clasifMasivaState.resultados = data.resultados || [];
    _clasifMasivaState.total = data.total || _clasifMasivaState.resultados.length;
    _clasifMasivaState.seleccion = {};
    const seleccionInicial = _clasifMasivaState.seleccionInicial;
    const clavesSolicitadas = clavesTexto
      ? clavesTexto.split(/[\s,;|\n\r\t]+/).map(c => c.trim().toUpperCase()).filter(Boolean)
      : [];
    if (seleccionInicial?.length) {
      const permitidas = new Set(seleccionInicial);
      _clasifMasivaState.resultados.forEach(row => {
        const c = String(row.clave_catastral || "").trim().toUpperCase();
        if (permitidas.has(c)) _clasifMasivaState.seleccion[row.clave_catastral] = true;
      });
      _clasifMasivaState.seleccionInicial = null;
    } else if (clavesSolicitadas.length) {
      const permitidas = new Set(clavesSolicitadas);
      _clasifMasivaState.resultados.forEach(row => {
        const c = String(row.clave_catastral || "").trim().toUpperCase();
        if (permitidas.has(c)) _clasifMasivaState.seleccion[row.clave_catastral] = true;
      });
    } else {
      _clasifMasivaState.resultados.forEach(row => {
        if (row.clave_catastral) _clasifMasivaState.seleccion[row.clave_catastral] = true;
      });
    }
    if (clavesSolicitadas.length) {
      const encontradas = new Set(_clasifMasivaState.resultados.map(r => String(r.clave_catastral || "").trim().toUpperCase()));
      _clasifMasivaState.clavesFaltantes = clavesSolicitadas.filter(c => !encontradas.has(c));
    } else {
      _clasifMasivaState.clavesFaltantes = [];
    }
    renderResultadosClasificacionMasiva();
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="coprop-msg error">${escapeHtml(e.message)}</div>`;
  }
}
window.buscarPrediosClasificacionMasiva = buscarPrediosClasificacionMasiva;

function renderResultadosClasificacionMasiva() {
  const cont = document.getElementById("clasifMasivaTabla");
  const cnt = document.getElementById("clasifMasivaContador");
  const rows = _clasifMasivaState.resultados || [];
  const sel = _clasifMasivaState.seleccion || {};
  const marcadas = Object.keys(sel).length;
  if (cnt) cnt.textContent = `${marcadas} seleccionada(s) · ${rows.length} mostradas · ${_clasifMasivaState.total || rows.length} total`;
  if (!cont) return;
  if (!rows.length) {
    cont.innerHTML = `<div class="analisis-zonas-meta">Sin resultados. Ajuste criterios o pegue claves directamente.</div>`;
    return;
  }
  let html = `<table class="analisis-condominios-tabla"><thead><tr>
    <th></th><th>Clave</th><th>Nombre condominio</th><th>Modalidad</th><th>Titular</th><th>Ubicación</th>
  </tr></thead><tbody>`;
  rows.forEach(row => {
    const clave = row.clave_catastral || "";
    const checked = !!sel[clave];
    const ubic = [row.colonia, row.calle, row.numof].filter(Boolean).join(" · ");
    const mod = row.modalidad ? (etiquetaModalidadCondominio(row.modalidad)?.nombre || row.modalidad) : "—";
    html += `<tr class="${checked ? "activo" : ""}">
      <td><input type="checkbox" ${checked ? "checked" : ""} onchange="toggleSeleccionClasifMasiva('${escapeHtml(clave)}', this.checked)"></td>
      <td><b>${escapeHtml(clave)}</b></td>
      <td>${escapeHtml(row.nombre_condominio || "—")}</td>
      <td>${escapeHtml(mod)}</td>
      <td>${escapeHtml(row.nombre_completo || "")}</td>
      <td>${escapeHtml(ubic)}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  if ((_clasifMasivaState.total || 0) > rows.length) {
    html += `<div class="analisis-zonas-meta">Mostrando ${rows.length} de ${formatoNumeroEntero(_clasifMasivaState.total)}. Refine la búsqueda si falta alguna clave.</div>`;
  }
  const faltantes = _clasifMasivaState.clavesFaltantes || [];
  if (faltantes.length) {
    html += `<div class="analisis-zonas-meta clasif-masiva-faltantes">No encontradas en padrón: ${faltantes.map(c => escapeHtml(c)).join(", ")}</div>`;
  }
  cont.innerHTML = html;
}

function toggleSeleccionClasifMasiva(clave, on) {
  if (!_clasifMasivaState.seleccion) _clasifMasivaState.seleccion = {};
  if (on) _clasifMasivaState.seleccion[clave] = true;
  else delete _clasifMasivaState.seleccion[clave];
  renderResultadosClasificacionMasiva();
}
window.toggleSeleccionClasifMasiva = toggleSeleccionClasifMasiva;

function toggleSeleccionTodasClasifMasiva(on) {
  (_clasifMasivaState.resultados || []).forEach(row => {
    const c = row.clave_catastral;
    if (!c) return;
    if (on) _clasifMasivaState.seleccion[c] = true;
    else delete _clasifMasivaState.seleccion[c];
  });
  renderResultadosClasificacionMasiva();
}
window.toggleSeleccionTodasClasifMasiva = toggleSeleccionTodasClasifMasiva;

async function aplicarClasificacionCondominioMasiva() {
  const claves = Object.keys(_clasifMasivaState.seleccion || {});
  if (!claves.length) {
    msgCoprop("clasifMasivaMsg", "Seleccione al menos un predio.", false);
    return;
  }
  const modalidadSel = document.getElementById("clasifMasivaModalidadAplicar")?.value ?? "__NO_CAMBIAR__";
  const nombre = document.getElementById("clasifMasivaNombreAplicar")?.value?.trim() || "";
  const cambiaModalidad = modalidadSel !== "__NO_CAMBIAR__";
  if (!cambiaModalidad && !nombre) {
    msgCoprop("clasifMasivaMsg", "Indique nombre de condominio y/o modalidad.", false);
    return;
  }
  if (!confirm(`¿Aplicar clasificación a ${claves.length} predio(s)?`)) return;
  const body = { claves };
  if (cambiaModalidad) body.modalidad = modalidadSel;
  if (nombre) body.nombre_condominio = nombre;
  try {
    const r = await fetch(`${API}/condominios/clasificacion/masiva`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo aplicar la clasificación masiva."));
    msgCoprop("clasifMasivaMsg", data.mensaje || "Clasificación aplicada.", true);
    await buscarPrediosClasificacionMasiva();
    if (typeof buscarUnidadesCondominio === "function") buscarUnidadesCondominio();
    if (copropEstado.clave && claves.includes(copropEstado.clave)) {
      await cargarCopropietariosPredio(copropEstado.clave);
    }
  } catch (e) {
    msgCoprop("clasifMasivaMsg", e.message || "Error en clasificación masiva.", false);
  }
}
window.aplicarClasificacionCondominioMasiva = aplicarClasificacionCondominioMasiva;

setTimeout(asegurarModalClasificacionCondominioMasiva, 900);

async function abrirPredioCondominioIdx(idx) {
  const row = (_analisisCondominiosState.unidades || [])[idx];
  if (!row?.clave_catastral) return;
  await abrirPredioDesdeCondominio(row.clave_catastral);
}
window.abrirPredioCondominioIdx = abrirPredioCondominioIdx;

async function abrirPredioDesdeCondominio(clave) {
  if (!clave) return;
  cerrarModuloAnalisisCondominios();
  mostrarTab("tabConsulta", document.querySelector(".tab-btn[onclick*=\"tabConsulta\"]"));
  document.getElementById("claveInput").value = clave;
  if (typeof seleccionarPorClave === "function") {
    await seleccionarPorClave(clave, "condominios");
  }
}
window.abrirPredioDesdeCondominio = abrirPredioDesdeCondominio;

function exportarCatalogoCondominiosExcel() {
  const rows = _analisisCondominiosState.catalogo || [];
  if (!rows.length || typeof XLSX === "undefined") {
    alert(rows.length ? "No se pudo cargar Excel." : "No hay datos para exportar.");
    return;
  }
  const filas = rows.map(r => ({
    Tipo: r.tipo_nombre || r.tipo,
    "Valor padrón": r.condominio || r.valor_padron,
    Unidades: r.unidades,
    Colonias: r.colonias,
    "Valor total": r.valor_total,
    "Adeudo total": r.adeudo_total
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Tipos condominio");
  XLSX.writeFile(wb, "catalogo_condominios_" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
window.exportarCatalogoCondominiosExcel = exportarCatalogoCondominiosExcel;

function exportarUnidadesCondominioExcel() {
  const rows = _analisisCondominiosState.unidades || [];
  if (!rows.length || typeof XLSX === "undefined") {
    alert(rows.length ? "No se pudo cargar Excel." : "No hay unidades para exportar.");
    return;
  }
  const filas = rows.map(r => ({
    "Clave catastral": r.clave_catastral,
    Tipo: r.tipo_nombre || r.tipo,
    "Valor padrón": r.condominio,
    Titular: r.nombre_completo,
    Colonia: r.colonia,
    Calle: r.calle,
    "No. oficial": r.numof,
    Interior: r.numint,
    Letra: r.letra,
    "Zona H.": r.zona_homogenea,
    "Valor 2026": r.valor2026,
    "Adeudo 2026": r.adeudo_2026,
    "Adeudo total": r.adeudo_total,
    "Sup. documental": r.sup_documental,
    "Sup. construcción": r.sup_const,
    Uso: r.descripcion_uso
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Unidades");
  XLSX.writeFile(wb, "unidades_condominio_" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
window.exportarUnidadesCondominioExcel = exportarUnidadesCondominioExcel;

async function obtenerLogoInstitucionalDataUrl() {
  if (_logoInstitucionalCache) return _logoInstitucionalCache;
  try {
    const r = await fetch("logomxli.png?_=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise(function(resolve) {
      const fr = new FileReader();
      fr.onload = function() { _logoInstitucionalCache = fr.result; resolve(fr.result); };
      fr.onerror = function() { resolve(null); };
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

function renderAnalisisZonasCompleto() {
  renderAnalisisZonasLista();
  renderAnalisisZonasDetalle(registroAnalisisZonasActual());
}

async function imprimirCedulaZonaHomogenea() {
  const reg = registroAnalisisZonasActual();
  if (!reg) {
    alert("Seleccione una zona homogénea.");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Generador PDF no disponible.");
    return;
  }

  dibujarGraficaEvolucionZona(reg);
  const chartImg = obtenerImagenGraficaZonaHomogenea(reg);
  const logoImg = await obtenerLogoInstitucionalDataUrl();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const guinda = [112, 51, 65];
  const grisTexto = [40, 48, 60];
  const grisClaro = [245, 247, 250];
  const cod = reg.clave_zonah || reg.codigo_zona_homogenea || "";
  const fecha = new Date().toLocaleString("es-MX");

  doc.setFillColor(...guinda);
  doc.rect(0, 0, pageW, 32, "F");
  if (logoImg) {
    try {
      doc.addImage(logoImg, "PNG", 12, 4, 38, 18);
    } catch (e) { /* continuar sin logo */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Sistema de Gestión Catastral", logoImg ? 54 : 14, 12);
  doc.setFontSize(10);
  doc.text("Dirección de Catastro · H. Ayuntamiento de Mexicali", logoImg ? 54 : 14, 19);
  doc.setFontSize(9);
  doc.text("Estado de Baja California, México", logoImg ? 54 : 14, 25);
  doc.text(`Fecha: ${fecha}`, pageW - 14, 12, { align: "right" });
  doc.text(`Código zonah: ${cod}`, pageW - 14, 19, { align: "right" });

  doc.setTextColor(...grisTexto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Cédula de valor unitario de suelo", 14, 44);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Tabla de zonas homogéneas · ejercicios fiscales 2024, 2025 y 2026", 14, 51);

  doc.setDrawColor(220, 225, 232);
  doc.setFillColor(...grisClaro);
  doc.roundedRect(14, 56, pageW - 28, 36, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...guinda);
  doc.text("IDENTIFICACIÓN DE LA ZONA HOMOGÉNEA", 18, 63);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grisTexto);
  doc.setFontSize(10);
  doc.text(`Código (zonah): ${cod}`, 18, 71);
  doc.text(`Descripción: ${reg.descripcion_col_fracc || "—"}`, 18, 78);
  doc.text(`Zona: ${reg.zona || "—"}   Sector: ${reg.sector || "—"}   Subsector: ${reg.subsector || "—"}`, 18, 85);

  let y = 100;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...guinda);
  doc.text("Valores unitarios de suelo (MXN / m²)", 14, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...grisTexto);
  const aniosPdf = obtenerAniosAnalisisZonas();
  aniosPdf.forEach(function(an) {
    const val = reg["valor_" + an] != null
      ? reg["valor_" + an]
      : ((reg.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
    doc.setFillColor(...grisClaro);
    doc.roundedRect(14, y - 4, pageW - 28, 8, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.text(String(an), 18, y + 1);
    doc.setFont("helvetica", "normal");
    doc.text(val != null ? formatValorM2(val) : "Sin registro", 42, y + 1);
    y += 10;
  });

  if (reg.variacion_pct != null) {
    y += 2;
    const signo = reg.variacion_abs >= 0 ? "+" : "";
    const desde = reg.variacion_desde || aniosPdf[0];
    const hasta = reg.variacion_hasta || aniosPdf[aniosPdf.length - 1];
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...guinda);
    doc.text(`Variación ${desde} → ${hasta}: ${signo}${reg.variacion_pct}% (${signo}$${Number(reg.variacion_abs || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })})`, 14, y);
    y += 8;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...guinda);
  doc.text("Gráfica de evolución del valor unitario", 14, y);
  y += 4;

  if (chartImg) {
    try {
      doc.addImage(chartImg, "PNG", 14, y, pageW - 28, 82);
      y += 86;
    } catch (e) {
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text("No se pudo insertar la gráfica en el PDF.", 14, y + 10);
      y += 16;
    }
  }

  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.4);
  doc.line(14, pageH - 22, pageW - 14, pageH - 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 110, 125);
  doc.text("Documento oficial generado por el Sistema de Gestión Catastral del H. Ayuntamiento de Mexicali.", 14, pageH - 16);
  doc.text("Los valores corresponden a la tabla de zonas homogéneas. Uso institucional · Sujeto a validación catastral.", 14, pageH - 11);

  doc.save(`cedula_zona_homogenea_${cod}.pdf`);
}
window.imprimirCedulaZonaHomogenea = imprimirCedulaZonaHomogenea;

/* ============================================================
   v76 - Mantenimiento de propietarios
============================================================ */
function mensajeErrorApiPropietarios(status, txt, accion) {
  if (status === 405) {
    return "El servidor no tiene activa la función de " + accion + " (HTTP 405). " +
      "Suba routers/propietarios.py y main.py al servidor y ejecute: sudo systemctl restart catastro-api";
  }
  if (status === 404 && accion === "fusionar") {
    return "Endpoint /propietarios/fusionar no encontrado. Actualice propietarios.py en el servidor y reinicie la API.";
  }
  return null;
}

async function verificarApiMantenimientoPropietarios() {
  try {
    const r = await fetch(`${API}/`, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.propietarios_fusionar) {
      setMantPropMsg(
        "⚠ API sin fusión/borrado (v" + (data.version || "?") + "). Actualice propietarios.py en el servidor.",
        false
      );
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

const mantPropEstado = {
  resultados: [],
  indiceActivo: -1,
  buscando: false,
  fusionIds: new Set(),
  fusionPadronIdx: new Set(),
  fusionDestinoMeta: null,
  registroPadronCache: new Map()
};
let mantPropCallesTimer = null;

function setMantPropMsg(texto, ok) {
  const cls = "mant-prop-msg " + (ok ? "ok" : texto ? "error" : "");
  ["mantPropMsg", "mantPropToolbarMsg"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = texto || "";
    el.className = cls;
  });
}

function elegirDestinoFusionPropietarios(ids) {
  const lista = (ids || []).map(Number).filter(Boolean);
  if (lista.length < 2) return 0;
  const lineas = lista.map((id, i) => {
    const r = (mantPropEstado.resultados || []).find(x => Number(x.id_persona) === id);
    const nom = r ? nombrePersonaCatalogo(r) : ("ID " + id);
    return `${i + 1}. ${nom}`;
  });
  const resp = prompt(
    "¿Cuál registro se CONSERVARÁ?\n" +
    "Los demás marcados se fusionarán en él.\n\n" +
    lineas.join("\n") +
    `\n\nEscriba el número (1-${lista.length}):`,
    "1"
  );
  if (resp === null) return 0;
  const n = parseInt(String(resp).trim(), 10);
  if (!n || n < 1 || n > lista.length) {
    alert("Selección inválida. Indique un número de la lista.");
    return 0;
  }
  return lista[n - 1];
}

function itemsMarcadosFusionMantenimiento() {
  const items = [];
  (mantPropEstado.resultados || []).forEach((r, idx) => {
    const id = Number(r.id_persona || 0);
    const nombre = nombrePersonaCatalogo(r);
    if (id && mantPropEstado.fusionIds.has(id)) {
      items.push({ kind: "catalogo", id, idx, nombre, row: r });
    } else if (!id && mantPropEstado.fusionPadronIdx.has(idx)) {
      items.push({ kind: "padron", id: 0, idx, nombre, row: r });
    }
  });
  return items;
}

function esNombrePersonaMoral(nombre) {
  const t = ` ${normalizarPersonaCatalogo(nombre)} `;
  if (/\b(S\.?\s*A\.?|S,A|S DE R\.?L\.?|S\.?\s*C\.?)\b/.test(t)) return true;
  if (/\bS\.?\s*A\.?\s*DE\s*C\.?\s*V\.?\b/.test(t)) return true;
  const claves = [
    " MUNICIPIO ", " GOBIERNO ", " SECRETARIA ", " FEDERACION ", " EJIDO ",
    " INSTITUTO ", " ASOCIACION ", " SA DE CV ", " UNIVERSIDAD ", " CAMARA ",
    " COMITE ", " EMPRESA ", " PRODUCTOS ", " AGRICOLA "
  ];
  return claves.some(k => t.includes(k));
}

function buildPayloadPropietarioDesdeRow(row) {
  const nombreCompleto = normalizarPersonaCatalogo(row.nombre_completo || row.razon_social || "");
  let tipo = esResultadoMoral(row) ? "MORAL" : "FISICA";
  if (tipo === "FISICA" && esNombrePersonaMoral(nombreCompleto)) tipo = "MORAL";
  const payload = {
    tipo_persona: tipo,
    rfc: normalizarPersonaCatalogo(row.rfc) || null,
    curp: normalizarPersonaCatalogo(row.curp) || null,
    calle: normalizarPersonaCatalogo(row.calle) || null,
    colonia: normalizarPersonaCatalogo(row.colonia) || null,
    numof: row.numof != null && row.numof !== "" ? normalizarPersonaCatalogo(String(row.numof)) : null,
    cp: normalizarPersonaCatalogo(row.cp) || null,
    delegacion: normalizarPersonaCatalogo(row.delegacion) || null,
    activo: true
  };
  if (tipo === "MORAL") {
    payload.razon_social = normalizarPersonaCatalogo(row.razon_social || row.nombre_completo) || null;
  } else {
    const cols = columnasPersonaResultado(row);
    const div = dividirNombrePropietario(cols.nombres);
    payload.apellido_paterno = normalizarPersonaCatalogo(cols.paterno) || null;
    payload.apellido_materno = normalizarPersonaCatalogo(cols.materno) || null;
    payload.nombre = unirNombrePropietario(div.n1, div.n2) || null;
  }
  return payload;
}

async function registrarPropietarioCatalogoDesdeRow(row, idx) {
  if (!row) return 0;
  const idxKey = idx != null ? Number(idx) : -1;
  if (idxKey >= 0 && mantPropEstado.registroPadronCache.has(idxKey)) {
    return mantPropEstado.registroPadronCache.get(idxKey);
  }
  if (row.id_persona) {
    const id = Number(row.id_persona);
    if (idxKey >= 0) mantPropEstado.registroPadronCache.set(idxKey, id);
    return id;
  }
  const payload = buildPayloadPropietarioDesdeRow(row);
  if (payload.tipo_persona === "MORAL" && !payload.razon_social) return 0;
  if (payload.tipo_persona === "FISICA" && !payload.nombre && !payload.apellido_paterno) return 0;

  const r = await fetch(`${API}/propietarios`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo registrar el propietario en catálogo."));
  const persona = extraerPersonaApi(data) || data.propietario || data;
  const id = Number(persona?.id_persona || 0);
  if (id && idxKey >= 0) mantPropEstado.registroPadronCache.set(idxKey, id);
  return id;
}

function fijarDestinoFusionMantenimiento(id, nombre) {
  mantPropEstado.fusionDestinoMeta = {
    id: Number(id),
    nombre: normalizarPersonaCatalogo(nombre) || ""
  };
  return Number(id);
}

function nombreDestinoFusionMantenimiento(destinoId) {
  const meta = mantPropEstado.fusionDestinoMeta;
  if (meta && Number(meta.id) === Number(destinoId) && meta.nombre) return meta.nombre;
  const row = (mantPropEstado.resultados || []).find(x => Number(x.id_persona) === Number(destinoId));
  if (row) return nombrePersonaCatalogo(row);
  for (const [idx, id] of mantPropEstado.registroPadronCache.entries()) {
    if (Number(id) === Number(destinoId)) {
      const r = mantPropEstado.resultados[idx];
      if (r) return nombrePersonaCatalogo(r);
    }
  }
  return "";
}

function nombreOrigenFusionMantenimiento(id) {
  const row = (mantPropEstado.resultados || []).find(x => Number(x.id_persona) === Number(id));
  if (row) return nombrePersonaCatalogo(row);
  for (const [idx, cachedId] of mantPropEstado.registroPadronCache.entries()) {
    if (Number(cachedId) === Number(id)) {
      const r = mantPropEstado.resultados[idx];
      if (r) return nombrePersonaCatalogo(r);
    }
  }
  return "ID " + id;
}

async function elegirDestinoFusionMixto(items) {
  if ((items || []).length < 2) return 0;
  const lineas = items.map((it, i) => {
    const suf = it.kind === "padron" ? " [padrón]" : "";
    return `${i + 1}. ${it.nombre}${suf}`;
  });
  const resp = prompt(
    "¿Cuál registro se CONSERVARÁ?\n" +
    "Los demás marcados se fusionarán en él.\n" +
    "(Los del padrón se registrarán en catálogo automáticamente.)\n\n" +
    lineas.join("\n") +
    `\n\nEscriba el número (1-${items.length}):`,
    "1"
  );
  if (resp === null) return 0;
  const n = parseInt(String(resp).trim(), 10);
  if (!n || n < 1 || n > items.length) {
    alert("Selección inválida. Indique un número de la lista.");
    return 0;
  }
  const sel = items[n - 1];
  if (sel.kind === "catalogo") return fijarDestinoFusionMantenimiento(sel.id, sel.nombre);
  const id = await registrarPropietarioCatalogoDesdeRow(sel.row, sel.idx);
  if (!id) return 0;
  return fijarDestinoFusionMantenimiento(id, sel.nombre);
}

async function resolverDestinoFusionMantenimiento() {
  mantPropEstado.fusionDestinoMeta = null;
  const items = itemsMarcadosFusionMantenimiento();
  const idxOk = idxActivoEnResultadosActualesMantenimiento();

  let destinoId = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  if (destinoId && !idPersonaEnResultadosActualesMantenimiento(destinoId)) {
    document.getElementById("mantPropIdPersona").value = "";
    destinoId = 0;
  }

  if (idxOk >= 0) {
    const row = mantPropEstado.resultados[idxOk];
    if (row?.id_persona) {
      return fijarDestinoFusionMantenimiento(row.id_persona, nombrePersonaCatalogo(row));
    }
    if (row && row.origen === "padron" && !row.id_persona) {
      setMantPropMsg("Registrando titular destino del padrón en catálogo...", true);
      const id = await registrarPropietarioCatalogoDesdeRow(row, idxOk);
      if (!id) return 0;
      return fijarDestinoFusionMantenimiento(id, nombrePersonaCatalogo(row));
    }
  }

  if (destinoId && idPersonaEnResultadosActualesMantenimiento(destinoId)) {
    const row = mantPropEstado.resultados.find(x => Number(x.id_persona) === destinoId);
    return fijarDestinoFusionMantenimiento(destinoId, row ? nombrePersonaCatalogo(row) : "");
  }

  if (items.length >= 2) {
    setMantPropMsg("Seleccione titular destino...", true);
    return elegirDestinoFusionMixto(items);
  }

  return 0;
}

function idPersonaEnResultadosActualesMantenimiento(id) {
  return (mantPropEstado.resultados || []).some(r => Number(r.id_persona) === Number(id));
}

function idxActivoEnResultadosActualesMantenimiento() {
  const idx = mantPropEstado.indiceActivo;
  const total = (mantPropEstado.resultados || []).length;
  if (idx < 0 || idx >= total) return -1;
  return idx;
}

function resetDestinoTrasNuevaBusquedaMantenimiento() {
  const q = document.getElementById("mantPropBuscar")?.value || "";
  limpiarFormularioMantenimientoPropietario();
  const inp = document.getElementById("mantPropBuscar");
  if (inp) inp.value = q;
}

async function resolverOrigenesFusionMantenimiento(destinoId) {
  const origenes = [...mantPropEstado.fusionIds]
    .map(Number)
    .filter(id => id && id !== destinoId);

  for (const idx of mantPropEstado.fusionPadronIdx) {
    const row = mantPropEstado.resultados[idx];
    if (!row) continue;
    let id = Number(row.id_persona || 0);
    if (!id) id = await registrarPropietarioCatalogoDesdeRow(row, idx);
    if (id && id !== destinoId && !origenes.includes(id)) origenes.push(id);
  }
  return origenes;
}

function setMantPropProgress(visible) {
  const el = document.getElementById("mantPropProgress");
  if (el) el.classList.toggle("oculto", !visible);
}

function dividirNombrePropietario(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return { n1: "", n2: "" };
  if (partes.length === 1) return { n1: partes[0], n2: "" };
  return { n1: partes[0], n2: partes.slice(1).join(" ") };
}

function unirNombrePropietario(n1, n2) {
  return [n1, n2].map(v => String(v || "").trim()).filter(Boolean).join(" ");
}

function generarNombreCompletoMantenimiento() {
  const tipo = document.getElementById("mantPropTipoPersona")?.value || "FISICA";
  let nombre = "";
  if (tipo === "MORAL") {
    nombre = normalizarPersonaCatalogo(document.getElementById("mantPropRazonSocial")?.value);
  } else {
    nombre = [
      normalizarPersonaCatalogo(document.getElementById("mantPropApPat")?.value),
      normalizarPersonaCatalogo(document.getElementById("mantPropApMat")?.value),
      unirNombrePropietario(
        document.getElementById("mantPropNombre1")?.value,
        document.getElementById("mantPropNombre2")?.value
      )
    ].filter(Boolean).join(" ");
  }
  const out = document.getElementById("mantPropNombreCompleto");
  if (out) out.value = nombre;
  return nombre;
}

function cambiarTipoPersonaMantenimiento() {
  const tipo = document.getElementById("mantPropTipoPersona")?.value || "FISICA";
  const fisica = document.getElementById("mantPropBloqueFisica");
  const moral = document.getElementById("mantPropBloqueMoral");
  if (fisica) fisica.classList.toggle("oculto", tipo === "MORAL");
  if (moral) moral.classList.toggle("oculto", tipo !== "MORAL");
  generarNombreCompletoMantenimiento();
}
window.cambiarTipoPersonaMantenimiento = cambiarTipoPersonaMantenimiento;

function limpiarFormularioMantenimientoPropietario() {
  ["mantPropIdPersona", "mantPropClavePredio", "mantPropApPat", "mantPropApMat", "mantPropNombre1",
    "mantPropNombre2", "mantPropRazonSocial", "mantPropRFC", "mantPropCURP", "mantPropCalle",
    "mantPropIdCalle", "mantPropNumof", "mantPropColonia", "mantPropCP", "mantPropDelegacion", "mantPropClaveDisplay",
    "mantPropNombreCompleto"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const tipo = document.getElementById("mantPropTipoPersona");
  if (tipo) tipo.value = "FISICA";
  cambiarTipoPersonaMantenimiento();
  mantPropEstado.indiceActivo = -1;
  mantPropEstado.fusionIds = new Set();
  mantPropEstado.fusionPadronIdx = new Set();
  document.querySelectorAll("#mantPropGridBody tr[data-idx]").forEach(r => r.classList.remove("activo"));
  const chkTodos = document.getElementById("mantPropFusionTodos");
  if (chkTodos) chkTodos.checked = false;
  setMantPropMsg("", true);
  limpiarSugerenciasCallesMantenimiento();
}

function limpiarSugerenciasCallesMantenimiento() {
  const cont = document.getElementById("mantPropSugCalles");
  if (cont) cont.innerHTML = "";
}

function seleccionarCalleMantenimiento(nombre, idCalle, origen) {
  const inp = document.getElementById("mantPropCalle");
  const hid = document.getElementById("mantPropIdCalle");
  if (inp) inp.value = normalizarPersonaCatalogo(nombre);
  if (hid) hid.value = idCalle ? String(idCalle) : "";
  limpiarSugerenciasCallesMantenimiento();
  if (origen === "padron") {
    setMantPropMsg("Calle del padrón — al grabar se puede registrar en catálogo de calles.", true);
  }
}

function renderSugerenciasCallesMantenimiento(calles, textoBusqueda) {
  const cont = document.getElementById("mantPropSugCalles");
  if (!cont) return;
  const texto = normalizarPersonaCatalogo(textoBusqueda);
  const catalogo = (calles || []).filter(c => c.origen !== "padron");
  const padron = (calles || []).filter(c => c.origen === "padron");
  const hayExacta = catalogo.some(c => c.nombre_calle === texto);

  cont.innerHTML = "";

  catalogo.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mant-prop-sug-item";
    btn.textContent = c.nombre_calle;
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => seleccionarCalleMantenimiento(c.nombre_calle, c.id || 0, "catalogo"));
    cont.appendChild(btn);
  });

  padron.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mant-prop-sug-item padron";
    btn.title = "Del padrón fiscal";
    btn.textContent = `${c.nombre_calle} · padrón`;
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => seleccionarCalleMantenimiento(c.nombre_calle, 0, "padron"));
    cont.appendChild(btn);
  });

  if (texto && !hayExacta) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mant-prop-sug-item crear";
    btn.textContent = `➕ Crear "${texto}" en catálogo`;
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => crearCalleCatalogoMantenimiento(texto));
    cont.appendChild(btn);
  }
}

async function buscarCatalogoCallesMantenimiento(valor, forzar) {
  const texto = normalizarPersonaCatalogo(valor);
  clearTimeout(mantPropCallesTimer);
  if (!forzar && texto.length < 2) {
    limpiarSugerenciasCallesMantenimiento();
    return;
  }
  mantPropCallesTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({
        q: texto,
        limite: "25",
        _: String(Date.now())
      });
      const r = await fetch(`${API}/propietarios/catalogo/calles?${params.toString()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar calles."));
      renderSugerenciasCallesMantenimiento(data.calles || [], texto);
    } catch (e) {
      limpiarSugerenciasCallesMantenimiento();
    }
  }, forzar ? 0 : 220);
}

async function crearCalleCatalogoMantenimiento(nombre) {
  const calle = normalizarPersonaCatalogo(nombre || document.getElementById("mantPropCalle")?.value);
  if (!calle) {
    setMantPropMsg("Capture el nombre de la calle.", false);
    return null;
  }
  try {
    setMantPropMsg("Registrando calle en catálogo...", true);
    const r = await fetch(`${API}/propietarios/catalogo/calles`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({ nombre_calle: calle })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo crear la calle."));
    const item = data.calle || {};
    seleccionarCalleMantenimiento(item.nombre_calle || calle, item.id || 0, "catalogo");
    setMantPropMsg(data.creada ? "Calle agregada al catálogo." : "Calle ya existía en catálogo.", true);
    return item;
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
    return null;
  }
}

async function asegurarCalleEnCatalogoMantenimiento(nombre) {
  const calle = normalizarPersonaCatalogo(nombre);
  if (!calle) return true;
  const idCalle = Number(document.getElementById("mantPropIdCalle")?.value || 0);
  if (idCalle) return true;

  try {
    const params = new URLSearchParams({ q: calle, exacta: "true", limite: "5", _: String(Date.now()) });
    const r = await fetch(`${API}/propietarios/catalogo/calles?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.exacta && (data.calles || []).length) {
      const c = data.calles[0];
      document.getElementById("mantPropIdCalle").value = c.id || "";
      return true;
    }
  } catch (e) {
    /* continuar con confirmación */
  }

  if (!confirm(`La calle "${calle}" no está en el catálogo.\n\n¿Agregarla al catálogo de calles?`)) {
    return true;
  }
  const creada = await crearCalleCatalogoMantenimiento(calle);
  return !!creada;
}
window.crearCalleCatalogoMantenimiento = crearCalleCatalogoMantenimiento;
window.seleccionarCalleMantenimiento = seleccionarCalleMantenimiento;

function limpiarMarcasFusionPropietarios() {
  mantPropEstado.fusionIds = new Set();
  mantPropEstado.fusionPadronIdx = new Set();
  mantPropEstado.fusionDestinoMeta = null;
  mantPropEstado.registroPadronCache = new Map();
  document.querySelectorAll(".mant-prop-fusion-chk").forEach(chk => { chk.checked = false; });
  const chkTodos = document.getElementById("mantPropFusionTodos");
  if (chkTodos) chkTodos.checked = false;
}

function toggleFusionPropietario(idPersona, checked) {
  const id = Number(idPersona);
  if (!id) return;
  if (checked) mantPropEstado.fusionIds.add(id);
  else mantPropEstado.fusionIds.delete(id);
}
window.toggleFusionPropietario = toggleFusionPropietario;

function toggleFusionPadronPropietario(idx, checked) {
  const i = Number(idx);
  if (Number.isNaN(i)) return;
  if (checked) mantPropEstado.fusionPadronIdx.add(i);
  else mantPropEstado.fusionPadronIdx.delete(i);
}
window.toggleFusionPadronPropietario = toggleFusionPadronPropietario;

function toggleFusionTodosPropietarios(marcar) {
  const destinoIdRaw = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  const destinoId = idPersonaEnResultadosActualesMantenimiento(destinoIdRaw) ? destinoIdRaw : 0;
  const destinoIdx = idxActivoEnResultadosActualesMantenimiento();
  mantPropEstado.fusionIds = new Set();
  mantPropEstado.fusionPadronIdx = new Set();
  (mantPropEstado.resultados || []).forEach((r, idx) => {
    if (r.id_persona) {
      const id = Number(r.id_persona);
      if (marcar && id !== destinoId) mantPropEstado.fusionIds.add(id);
    } else if (marcar && idx !== destinoIdx) {
      mantPropEstado.fusionPadronIdx.add(idx);
    }
  });
  document.querySelectorAll(".mant-prop-fusion-chk").forEach(chk => {
    const id = Number(chk.dataset.id || 0);
    const idx = Number(chk.dataset.idx ?? -1);
    if (chk.dataset.padron === "1") {
      chk.checked = marcar && idx !== destinoIdx;
      return;
    }
    if (chk.disabled) return;
    chk.checked = marcar && id !== destinoId;
  });
}
window.toggleFusionTodosPropietarios = toggleFusionTodosPropietarios;

function cargarFilaMantenimientoPropietario(row, idx) {
  if (!row) return;
  mantPropEstado.indiceActivo = idx;
  document.querySelectorAll("#mantPropGridBody tr[data-idx]").forEach(r => r.classList.remove("activo"));
  const fila = document.querySelector(`#mantPropGridBody tr[data-idx="${idx}"]`);
  if (fila) fila.classList.add("activo");

  const nombreRow = row.razon_social || row.nombre_completo || "";
  const tipo = esResultadoMoral(row) || esNombrePersonaMoral(nombreRow) ? "MORAL" : "FISICA";
  document.getElementById("mantPropTipoPersona").value = tipo;
  cambiarTipoPersonaMantenimiento();

  document.getElementById("mantPropIdPersona").value = row.id_persona || "";
  document.getElementById("mantPropClavePredio").value = row.clave_catastral || "";
  document.getElementById("mantPropRFC").value = row.rfc || "";
  document.getElementById("mantPropCURP").value = row.curp || "";
  document.getElementById("mantPropCalle").value = row.calle || "";
  document.getElementById("mantPropIdCalle").value = row.id_calle || "";
  document.getElementById("mantPropNumof").value = row.numof != null ? String(row.numof) : "";
  document.getElementById("mantPropColonia").value = row.colonia || "";
  document.getElementById("mantPropCP").value = row.cp || "";
  document.getElementById("mantPropDelegacion").value = row.delegacion || "";
  document.getElementById("mantPropClaveDisplay").value = row.clave_catastral || "";

  if (tipo === "MORAL") {
    document.getElementById("mantPropRazonSocial").value = row.razon_social || row.nombre_completo || "";
    document.getElementById("mantPropApPat").value = "";
    document.getElementById("mantPropApMat").value = "";
    document.getElementById("mantPropNombre1").value = "";
    document.getElementById("mantPropNombre2").value = "";
  } else {
    const cols = columnasPersonaResultado(row);
    const div = dividirNombrePropietario(cols.nombres);
    document.getElementById("mantPropApPat").value = cols.paterno || "";
    document.getElementById("mantPropApMat").value = cols.materno || "";
    document.getElementById("mantPropNombre1").value = div.n1;
    document.getElementById("mantPropNombre2").value = div.n2;
    document.getElementById("mantPropRazonSocial").value = "";
  }
  generarNombreCompletoMantenimiento();
  const destId = Number(row.id_persona || 0);
  document.querySelectorAll("#mantPropGridBody tr.mant-prop-row-destino").forEach(r => r.classList.remove("mant-prop-row-destino"));
  document.querySelectorAll("#mantPropGridBody tr.mant-prop-row-destino-padron").forEach(r => r.classList.remove("mant-prop-row-destino-padron"));
  if (destId) {
    mantPropEstado.fusionIds.delete(destId);
    const chk = document.querySelector(`.mant-prop-fusion-chk[data-id="${destId}"]`);
    if (chk) chk.checked = false;
    if (fila) fila.classList.add("mant-prop-row-destino");
  } else if (fila && row.origen === "padron" && !row.id_persona) {
    mantPropEstado.fusionPadronIdx.delete(idx);
    const chkPad = document.querySelector(`.mant-prop-fusion-chk[data-idx="${idx}"][data-padron="1"]`);
    if (chkPad) chkPad.checked = false;
    fila.classList.add("mant-prop-row-destino-padron");
  }
  setMantPropMsg(row.origen === "padron" && !row.id_persona
    ? "Padrón — clic = destino (naranja) · ✓ = fusionar · se registrará en catálogo al fusionar."
    : "", true);
}

function renderGridMantenimientoPropietarios(resultados, meta) {
  const body = document.getElementById("mantPropGridBody");
  const contador = document.getElementById("mantPropContador");
  if (!body) return;

  if (!resultados.length) {
    body.innerHTML = `<tr><td colspan="6" class="mant-prop-empty">Sin resultados.</td></tr>`;
    if (contador) contador.textContent = "0";
    return;
  }

  const destinoIdRaw = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  const destinoId = idPersonaEnResultadosActualesMantenimiento(destinoIdRaw) ? destinoIdRaw : 0;

  body.innerHTML = resultados.map((r, idx) => {
    const nombre = nombrePersonaCatalogo(r);
    const dir = String(r.calle || "—");
    const origen = r.origen === "padron" && !r.id_persona ? "Padrón" : "Catálogo";
    const idP = r.id_persona ? Number(r.id_persona) : 0;
    const chk = idP
      ? `<input type="checkbox" class="mant-prop-fusion-chk" data-id="${idP}"
          ${mantPropEstado.fusionIds.has(idP) ? "checked" : ""}
          onclick="event.stopPropagation(); toggleFusionPropietario(${idP}, this.checked)">`
      : `<input type="checkbox" class="mant-prop-fusion-chk" data-padron="1" data-idx="${idx}"
          ${mantPropEstado.fusionPadronIdx.has(idx) ? "checked" : ""}
          title="Padrón — se registrará en catálogo al fusionar"
          onclick="event.stopPropagation(); toggleFusionPadronPropietario(${idx}, this.checked)">`;
    const esDestinoPadron = !idP && idx === mantPropEstado.indiceActivo ? " mant-prop-row-destino-padron" : "";
    const esDestino = idP && idP === destinoId ? " mant-prop-row-destino" : esDestinoPadron;
    return `
      <tr data-idx="${idx}" class="${esDestino}" tabindex="0"
        onclick="cargarFilaMantenimientoPropietario(mantPropEstado.resultados[${idx}], ${idx})"
        ondblclick="cargarFilaMantenimientoPropietario(mantPropEstado.resultados[${idx}], ${idx})"
        onkeydown="if(event.key==='Enter'){event.preventDefault();cargarFilaMantenimientoPropietario(mantPropEstado.resultados[${idx}], ${idx});}">
        <td class="mant-prop-col-chk" onclick="event.stopPropagation()">${chk}</td>
        <td>${escapeHtml(nombre)}</td>
        <td>${escapeHtml(r.colonia || "—")}</td>
        <td>${escapeHtml(dir)}</td>
        <td>${escapeHtml(r.numof != null && r.numof !== "" ? String(r.numof) : "—")}</td>
        <td>${escapeHtml(origen)}</td>
      </tr>`;
  }).join("");

  if (contador) {
    let txt = String(resultados.length);
    if (meta?.truncado) txt += "+";
    contador.textContent = txt;
  }
}

window.cargarFilaMantenimientoPropietario = cargarFilaMantenimientoPropietario;

async function buscarMantenimientoPropietarios() {
  const q = normalizarPersonaCatalogo(document.getElementById("mantPropBuscar")?.value);
  if (!q) {
    setMantPropMsg("Capture un criterio de búsqueda.", false);
    return;
  }
  if (mantPropEstado.buscando) return;
  resetDestinoTrasNuevaBusquedaMantenimiento();
  mantPropEstado.buscando = true;
  setMantPropProgress(true);
  setMantPropMsg("Buscando...", true);

  try {
    const params = new URLSearchParams({ q: q, limite: "150", _: String(Date.now()) });
    const r = await fetch(`${API}/propietarios/mantenimiento/buscar?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const txt = await r.text();
    let data = {};
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch (e) {
      throw new Error(
        r.status >= 500
          ? "Error del servidor al buscar propietarios. Verifique que propietarios.py esté actualizado y reinicie la API."
          : (txt || "Respuesta inválida del servidor.")
      );
    }
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar propietarios."));

    mantPropEstado.resultados = data.resultados || [];
    renderGridMantenimientoPropietarios(mantPropEstado.resultados, data);
    let msg = data.truncado
      ? `Mostrando ${mantPropEstado.resultados.length} resultados. Refine la búsqueda.`
      : `${mantPropEstado.resultados.length} resultado(s).`;
    if (data.padron_ocultos_por_catalogo > 0) {
      msg += ` · ${data.padron_ocultos_por_catalogo} variante(s) de padrón oculta(s) (ya en catálogo o fusionadas).`;
    }
    setMantPropMsg(msg, true);

    if (mantPropEstado.resultados.length === 1) {
      cargarFilaMantenimientoPropietario(mantPropEstado.resultados[0], 0);
    }
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
    renderGridMantenimientoPropietarios([], {});
  } finally {
    mantPropEstado.buscando = false;
    setMantPropProgress(false);
  }
}
window.buscarMantenimientoPropietarios = buscarMantenimientoPropietarios;

function nuevoMantenimientoPropietario() {
  limpiarFormularioMantenimientoPropietario();
  setMantPropMsg("Captura datos del nuevo propietario y pulse Grabar.", true);
  document.getElementById("mantPropApPat")?.focus();
}
window.nuevoMantenimientoPropietario = nuevoMantenimientoPropietario;

function cancelarMantenimientoPropietario() {
  limpiarFormularioMantenimientoPropietario();
}
window.cancelarMantenimientoPropietario = cancelarMantenimientoPropietario;

async function grabarMantenimientoPropietario() {
  const tipo = document.getElementById("mantPropTipoPersona")?.value || "FISICA";
  const idPersona = document.getElementById("mantPropIdPersona")?.value?.trim();
  const nombreCompleto = generarNombreCompletoMantenimiento();
  const payload = {
    tipo_persona: tipo,
    apellido_paterno: normalizarPersonaCatalogo(document.getElementById("mantPropApPat")?.value) || null,
    apellido_materno: normalizarPersonaCatalogo(document.getElementById("mantPropApMat")?.value) || null,
    nombre: tipo === "FISICA"
      ? unirNombrePropietario(
        document.getElementById("mantPropNombre1")?.value,
        document.getElementById("mantPropNombre2")?.value
      ) || null
      : null,
    razon_social: tipo === "MORAL"
      ? normalizarPersonaCatalogo(document.getElementById("mantPropRazonSocial")?.value) || null
      : null,
    rfc: normalizarPersonaCatalogo(document.getElementById("mantPropRFC")?.value) || null,
    curp: normalizarPersonaCatalogo(document.getElementById("mantPropCURP")?.value) || null,
    calle: normalizarPersonaCatalogo(document.getElementById("mantPropCalle")?.value) || null,
    colonia: normalizarPersonaCatalogo(document.getElementById("mantPropColonia")?.value) || null,
    numof: normalizarPersonaCatalogo(document.getElementById("mantPropNumof")?.value) || null,
    cp: normalizarPersonaCatalogo(document.getElementById("mantPropCP")?.value) || null,
    delegacion: normalizarPersonaCatalogo(document.getElementById("mantPropDelegacion")?.value) || null,
    activo: true
  };

  if (tipo === "MORAL" && !payload.razon_social) {
    setMantPropMsg("Capture razón social.", false);
    return;
  }
  if (tipo === "FISICA" && !nombreCompleto) {
    setMantPropMsg("Capture apellidos o nombre(s).", false);
    return;
  }

  const calleCapturada = document.getElementById("mantPropCalle")?.value || "";
  if (!(await asegurarCalleEnCatalogoMantenimiento(calleCapturada))) {
    return;
  }

  try {
    setMantPropMsg("Guardando...", true);
    let r;
    if (idPersona) {
      r = await fetch(`${API}/propietarios/${encodeURIComponent(idPersona)}`, {
        method: "PUT",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      r = await fetch(`${API}/propietarios`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo guardar el propietario."));

    const persona = extraerPersonaApi(data) || data.propietario || data;
    if (persona?.id_persona) {
      document.getElementById("mantPropIdPersona").value = persona.id_persona;
    }
    setMantPropMsg(idPersona ? "Propietario actualizado correctamente." : "Propietario creado en catálogo.", true);

    const claveActiva = (document.getElementById("claveInput")?.value || "").trim().toUpperCase();
    if (claveActiva && typeof refrescarVistaPredioActivo === "function") {
      await refrescarVistaPredioActivo(claveActiva);
    }

    const q = normalizarPersonaCatalogo(document.getElementById("mantPropBuscar")?.value) || nombreCompleto;
    if (q) {
      document.getElementById("mantPropBuscar").value = q;
      await buscarMantenimientoPropietarios();
      const idx = (mantPropEstado.resultados || []).findIndex(x =>
        Number(x.id_persona) === Number(persona.id_persona) ||
        nombrePersonaCatalogo(x) === nombreCompleto
      );
      if (idx >= 0) cargarFilaMantenimientoPropietario(mantPropEstado.resultados[idx], idx);
    }
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
  }
}
window.grabarMantenimientoPropietario = grabarMantenimientoPropietario;

async function borrarMantenimientoPropietario() {
  const idPersona = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  if (!idPersona) {
    setMantPropMsg("Solo se pueden borrar propietarios del catálogo (con ID). Los del padrón no tienen ficha.", false);
    return;
  }
  const nombre = document.getElementById("mantPropNombreCompleto")?.value || "";
  if (!confirm(`¿Dar de baja este propietario del catálogo?\n\n${nombre}\n\nSe cerrarán sus relaciones con predios.`)) {
    return;
  }
  try {
    setMantPropMsg("Eliminando...", true);
    const r = await fetch(`${API}/propietarios/${encodeURIComponent(idPersona)}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    const txt = await r.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (e) {
      throw new Error(r.status >= 500 ? "Error del servidor al borrar." : txt);
    }
    if (!r.ok) {
      const msg405 = mensajeErrorApiPropietarios(r.status, txt, "borrar propietarios");
      throw new Error(msg405 || extraerMensajeApi(data, "No se pudo borrar el propietario."));
    }
    limpiarFormularioMantenimientoPropietario();
    setMantPropMsg(data.mensaje || "Propietario dado de baja.", true);
    await buscarMantenimientoPropietarios();
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
  }
}
window.borrarMantenimientoPropietario = borrarMantenimientoPropietario;

async function fusionarPropietariosMantenimiento() {
  const totalMarcados = mantPropEstado.fusionIds.size + mantPropEstado.fusionPadronIdx.size;
  const tieneFilaActiva = mantPropEstado.indiceActivo >= 0;

  if (totalMarcados < 1 && !tieneFilaActiva) {
    const msg = "Marque con ✓ las variantes a fusionar (catálogo o padrón) y haga clic en el titular destino.";
    setMantPropMsg(msg, false);
    alert(msg);
    return;
  }

  try {
    setMantPropMsg("Preparando fusión...", true);
    mantPropEstado.registroPadronCache = new Map();
    mantPropEstado.fusionDestinoMeta = null;
    let destinoId = await resolverDestinoFusionMantenimiento();
    if (!destinoId) {
      if (totalMarcados + (tieneFilaActiva ? 1 : 0) < 2) {
        const msg = "Seleccione al menos 2 variantes (✓) o elija titular destino + duplicados marcados.";
        setMantPropMsg(msg, false);
        alert(msg);
      }
      return;
    }

    const origenes = await resolverOrigenesFusionMantenimiento(destinoId);
    if (!origenes.length) {
      const msg = "Marque con ✓ los duplicados (no marque el titular destino: amarillo o naranja).";
      setMantPropMsg(msg, false);
      alert(msg);
      return;
    }

    const nombreDest = nombreDestinoFusionMantenimiento(destinoId);
    if (!nombreDest) {
      setMantPropMsg("No se identificó el titular destino. Verifique que sea persona moral (S.A. de C.V.) si aplica.", false);
      return;
    }
    const nombresOrigen = origenes.map(id => nombreOrigenFusionMantenimiento(id)).join("\n• ");
    if (!confirm(
      `¿Fusionar ${origenes.length} propietario(s) en?\n\n${nombreDest}\n\nOrígenes:\n• ${nombresOrigen}\n\nLos duplicados quedarán dados de baja y sus predios pasarán al titular destino.`
    )) {
      return;
    }

    setMantPropMsg("Fusionando...", true);
    const r = await fetch(`${API}/propietarios/fusionar`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        id_persona_destino: destinoId,
        id_personas_origen: origenes
      })
    });
    const txt = await r.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (e) {
      throw new Error(r.status >= 500 ? "Error del servidor al fusionar." : txt);
    }
    if (!r.ok) {
      const msg405 = mensajeErrorApiPropietarios(r.status, txt, "fusionar propietarios");
      throw new Error(msg405 || extraerMensajeApi(data, "No se pudo fusionar propietarios."));
    }
    limpiarMarcasFusionPropietarios();
    const padronAct = Number(data.padron_actualizados || 0);
    setMantPropMsg(
      `Fusión completada: ${data.personas_desactivadas || origenes.length} dado(s) de baja, ` +
      `${data.relaciones_movidas || 0} predio(s) reasignados, ${data.relaciones_unidas || 0} unificados` +
      (padronAct ? `, ${padronAct} registro(s) del padrón actualizados.` : "."),
      true
    );
    await buscarMantenimientoPropietarios();
    const idx = (mantPropEstado.resultados || []).findIndex(x => Number(x.id_persona) === destinoId);
    if (idx >= 0) cargarFilaMantenimientoPropietario(mantPropEstado.resultados[idx], idx);
    const claveActiva = (document.getElementById("claveInput")?.value || "").trim().toUpperCase();
    if (claveActiva && typeof refrescarVistaPredioActivo === "function") {
      await refrescarVistaPredioActivo(claveActiva);
    }
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
  }
}
window.fusionarPropietariosMantenimiento = fusionarPropietariosMantenimiento;

function configurarEntradasMantenimientoPropietarios() {
  const modal = document.getElementById("modalMantenimientoPropietarios");
  if (!modal || modal.dataset.bind === "1") return;
  modal.dataset.bind = "1";

  ["mantPropApPat", "mantPropApMat", "mantPropNombre1", "mantPropNombre2", "mantPropRazonSocial"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      el.value = normalizarTextoPersonaInput(el.value);
      generarNombreCompletoMantenimiento();
    });
    el.addEventListener("blur", () => {
      el.value = normalizarPersonaCatalogo(el.value);
      generarNombreCompletoMantenimiento();
    });
  });

  ["mantPropRFC", "mantPropCURP"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => { el.value = normalizarPersonaCatalogo(el.value); });
  });

  ["mantPropCalle", "mantPropNumof", "mantPropColonia", "mantPropCP", "mantPropDelegacion"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => { el.value = normalizarPersonaCatalogo(el.value); });
  });

  const calleEl = document.getElementById("mantPropCalle");
  if (calleEl) {
    calleEl.addEventListener("input", () => {
      document.getElementById("mantPropIdCalle").value = "";
      buscarCatalogoCallesMantenimiento(calleEl.value);
    });
    calleEl.addEventListener("focus", () => {
      buscarCatalogoCallesMantenimiento(calleEl.value, !normalizarPersonaCatalogo(calleEl.value));
    });
    calleEl.addEventListener("blur", () => {
      setTimeout(limpiarSugerenciasCallesMantenimiento, 180);
    });
  }
}

function abrirMantenimientoPropietarios() {
  const modal = document.getElementById("modalMantenimientoPropietarios");
  if (!modal) return;
  configurarEntradasMantenimientoPropietarios();
  limpiarFormularioMantenimientoPropietario();
  mantPropEstado.resultados = [];
  limpiarMarcasFusionPropietarios();
  renderGridMantenimientoPropietarios([], {});
  document.getElementById("mantPropBuscar").value = "";
  document.getElementById("mantPropContador").textContent = "0";
  modal.classList.remove("oculto");
  verificarApiMantenimientoPropietarios();
  setTimeout(() => document.getElementById("mantPropBuscar")?.focus(), 120);
}
window.abrirMantenimientoPropietarios = abrirMantenimientoPropietarios;

function cerrarMantenimientoPropietarios() {
  const modal = document.getElementById("modalMantenimientoPropietarios");
  if (modal) modal.classList.add("oculto");
}
window.cerrarMantenimientoPropietarios = cerrarMantenimientoPropietarios;

// --- v89 Mantenimiento catálogos: calles y colonias ---

const MANT_CAT_CFG = {
  calles: {
    modalId: "modalMantenimientoCalles",
    prefix: "mantCalle",
    apiBase: "catalogos/calles",
    campoNombre: "nombre_calle",
    labelCap: "Calle",
    respKey: "calle"
  },
  colonias: {
    modalId: "modalMantenimientoColonias",
    prefix: "mantCol",
    apiBase: "catalogos/colonias",
    campoNombre: "nombre_colonia",
    labelCap: "Colonia",
    respKey: "colonia"
  }
};

function crearEstadoCatalogoMantenimiento() {
  return {
    resultados: [],
    indiceActivo: -1,
    fusionIds: new Set(),
    fusionPadronIdx: new Set(),
    fusionDestinoMeta: null,
    registroPadronCache: new Map()
  };
}

const mantCatEstado = {
  calles: crearEstadoCatalogoMantenimiento(),
  colonias: crearEstadoCatalogoMantenimiento()
};

function cfgMantCat(tipo) {
  return MANT_CAT_CFG[tipo] || MANT_CAT_CFG.calles;
}

function elMantCat(tipo, suf) {
  const cfg = cfgMantCat(tipo);
  return document.getElementById(`${cfg.prefix}${suf}`);
}

function estadoMantCat(tipo) {
  return mantCatEstado[tipo] || mantCatEstado.calles;
}

function nombreCatalogoRow(row, tipo) {
  const cfg = cfgMantCat(tipo);
  return normalizarPersonaCatalogo(row?.[cfg.campoNombre] || "");
}

function setMantCatMsg(tipo, msg, ok) {
  const el = elMantCat(tipo, "Msg");
  if (el) {
    el.textContent = msg || "";
    el.classList.toggle("ok", !!ok);
    el.classList.toggle("err", !ok && !!msg);
  }
  const tb = elMantCat(tipo, "ToolbarMsg");
  if (tb && msg) {
    tb.textContent = msg;
    tb.classList.toggle("ok", !!ok);
    tb.classList.toggle("err", !ok);
  }
}

function setMantCatProgress(tipo, visible) {
  const el = elMantCat(tipo, "Progress");
  if (el) el.classList.toggle("oculto", !visible);
}

function limpiarMarcasFusionCatalogo(tipo) {
  const st = estadoMantCat(tipo);
  st.fusionIds = new Set();
  st.fusionPadronIdx = new Set();
  st.fusionDestinoMeta = null;
  st.registroPadronCache = new Map();
  const chk = elMantCat(tipo, "FusionTodos");
  if (chk) chk.checked = false;
}

function limpiarFormularioCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  elMantCat(tipo, "Id").value = "";
  elMantCat(tipo, "Nombre").value = "";
  estadoMantCat(tipo).indiceActivo = -1;
  document.querySelectorAll(`#${cfg.prefix}GridBody tr[data-idx]`).forEach(r => {
    r.classList.remove("activo", "mant-prop-row-destino", "mant-prop-row-destino-padron");
  });
  setMantCatMsg(tipo, "", true);
}

async function buscarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const q = normalizarPersonaCatalogo(elMantCat(tipo, "Buscar")?.value);
  if (!q) {
    setMantCatMsg(tipo, "Capture un criterio de búsqueda.", false);
    return;
  }
  setMantCatProgress(tipo, true);
  setMantCatMsg(tipo, "Buscando...", true);
  try {
    const params = new URLSearchParams({ q, limite: "150" });
    const r = await fetch(`${API}/${cfg.apiBase}/mantenimiento/buscar?${params}`, {
      headers: authJsonHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar en catálogo."));
    st.resultados = data.resultados || [];
    limpiarMarcasFusionCatalogo(tipo);
    limpiarFormularioCatalogoMantenimiento(tipo);
    renderGridCatalogoMantenimiento(tipo);
    elMantCat(tipo, "Contador").textContent = String(st.resultados.length);
    setMantCatMsg(tipo, `${st.resultados.length} resultado(s).`, true);
    if (st.resultados.length) cargarFilaCatalogoMantenimiento(tipo, st.resultados[0], 0);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  } finally {
    setMantCatProgress(tipo, false);
  }
}

function renderGridCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const tbody = elMantCat(tipo, "GridBody");
  if (!tbody) return;
  const rows = st.resultados || [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="mant-prop-empty">Sin resultados.</td></tr>`;
    return;
  }
  const destId = Number(elMantCat(tipo, "Id")?.value || 0);
  tbody.innerHTML = rows.map((row, idx) => {
    const id = Number(row.id || 0);
    const nombre = escapeHtml(nombreCatalogoRow(row, tipo));
    const origen = row.origen === "padron" ? "Padrón" : "Catálogo";
    const esDestino = (id && id === destId) || (!id && st.indiceActivo === idx);
    const clsDest = row.origen === "padron"
      ? "mant-prop-row-destino-padron"
      : "mant-prop-row-destino";
    const clsAct = st.indiceActivo === idx ? " activo" : "";
    const clsDestino = esDestino ? ` ${clsDest}` : "";
    const chk = id
      ? `<input type="checkbox" class="mant-prop-fusion-chk" data-id="${id}" ${st.fusionIds.has(id) ? "checked" : ""} onchange="toggleFusionCatalogoMantenimiento('${tipo}', ${idx}, this.checked)">`
      : `<input type="checkbox" class="mant-prop-fusion-chk" data-idx="${idx}" ${st.fusionPadronIdx.has(idx) ? "checked" : ""} onchange="toggleFusionCatalogoMantenimiento('${tipo}', ${idx}, this.checked)">`;
    return `<tr data-idx="${idx}" class="${clsDestino}${clsAct}"
      onclick="cargarFilaCatalogoMantenimiento('${tipo}', mantCatEstado.${tipo}.resultados[${idx}], ${idx})"
      ondblclick="cargarFilaCatalogoMantenimiento('${tipo}', mantCatEstado.${tipo}.resultados[${idx}], ${idx})"
      onkeydown="if(event.key==='Enter'){event.preventDefault();cargarFilaCatalogoMantenimiento('${tipo}', mantCatEstado.${tipo}.resultados[${idx}], ${idx});}">
      <td class="mant-prop-col-chk" onclick="event.stopPropagation()">${chk}</td>
      <td>${nombre}</td>
      <td>${Number(row.predios_padron || 0)}</td>
      <td>${Number(row.personas_catalogo || 0)}</td>
      <td>${origen}</td>
    </tr>`;
  }).join("");
}

function cargarFilaCatalogoMantenimiento(tipo, row, idx) {
  if (!row) return;
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  st.indiceActivo = idx;
  document.querySelectorAll(`#${cfg.prefix}GridBody tr[data-idx]`).forEach(r => r.classList.remove("activo"));
  const fila = document.querySelector(`#${cfg.prefix}GridBody tr[data-idx="${idx}"]`);
  if (fila) fila.classList.add("activo");

  elMantCat(tipo, "Id").value = row.id || "";
  elMantCat(tipo, "Nombre").value = nombreCatalogoRow(row, tipo);

  document.querySelectorAll(`#${cfg.prefix}GridBody tr.mant-prop-row-destino, #${cfg.prefix}GridBody tr.mant-prop-row-destino-padron`).forEach(r => {
    r.classList.remove("mant-prop-row-destino", "mant-prop-row-destino-padron");
  });
  if (fila) {
    fila.classList.add(row.origen === "padron" ? "mant-prop-row-destino-padron" : "mant-prop-row-destino");
  }
}

function toggleFusionCatalogoMantenimiento(tipo, idx, marcado) {
  const st = estadoMantCat(tipo);
  const row = st.resultados[idx];
  if (!row) return;
  const id = Number(row.id || 0);
  if (id) {
    if (marcado) st.fusionIds.add(id);
    else st.fusionIds.delete(id);
  } else {
    if (marcado) st.fusionPadronIdx.add(idx);
    else st.fusionPadronIdx.delete(idx);
  }
}

function toggleFusionTodosCatalogoMantenimiento(tipo, marcar) {
  const st = estadoMantCat(tipo);
  const destinoId = Number(elMantCat(tipo, "Id")?.value || 0);
  (st.resultados || []).forEach((row, idx) => {
    const id = Number(row.id || 0);
    if (id) {
      if (marcar && id !== destinoId) st.fusionIds.add(id);
      else if (!marcar) st.fusionIds.delete(id);
    } else {
      if (marcar) st.fusionPadronIdx.add(idx);
      else st.fusionPadronIdx.delete(idx);
    }
  });
  renderGridCatalogoMantenimiento(tipo);
}

function itemsMarcadosFusionCatalogo(tipo) {
  const st = estadoMantCat(tipo);
  const items = [];
  (st.resultados || []).forEach((row, idx) => {
    const id = Number(row.id || 0);
    const nombre = nombreCatalogoRow(row, tipo);
    if (id && st.fusionIds.has(id)) items.push({ kind: "catalogo", id, idx, nombre, row });
    else if (!id && st.fusionPadronIdx.has(idx)) items.push({ kind: "padron", id: 0, idx, nombre, row });
  });
  return items;
}

async function registrarCatalogoDesdeRow(tipo, row, idx) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const idxKey = idx != null ? Number(idx) : -1;
  if (idxKey >= 0 && st.registroPadronCache.has(idxKey)) {
    return st.registroPadronCache.get(idxKey);
  }
  if (row?.id) {
    const id = Number(row.id);
    if (idxKey >= 0) st.registroPadronCache.set(idxKey, id);
    return id;
  }
  const nombre = nombreCatalogoRow(row, tipo);
  if (!nombre) return 0;
  const payload = { [cfg.campoNombre]: nombre };
  const r = await fetch(`${API}/${cfg.apiBase}`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo registrar en catálogo."));
  const reg = data[cfg.resKey] || data;
  const id = Number(reg?.id || 0);
  if (id && idxKey >= 0) st.registroPadronCache.set(idxKey, id);
  return id;
}

function fijarDestinoFusionCatalogo(tipo, id, nombre) {
  estadoMantCat(tipo).fusionDestinoMeta = {
    id: Number(id),
    nombre: normalizarPersonaCatalogo(nombre) || ""
  };
  return Number(id);
}

function nombreDestinoFusionCatalogo(tipo, destinoId) {
  const st = estadoMantCat(tipo);
  const meta = st.fusionDestinoMeta;
  if (meta && Number(meta.id) === Number(destinoId) && meta.nombre) return meta.nombre;
  const row = (st.resultados || []).find(x => Number(x.id) === Number(destinoId));
  if (row) return nombreCatalogoRow(row, tipo);
  for (const [idx, id] of st.registroPadronCache.entries()) {
    if (Number(id) === Number(destinoId)) {
      const r = st.resultados[idx];
      if (r) return nombreCatalogoRow(r, tipo);
    }
  }
  return "";
}

async function elegirDestinoFusionCatalogo(tipo, items) {
  const cfg = cfgMantCat(tipo);
  if ((items || []).length < 2) return 0;
  const lineas = items.map((it, i) => {
    const suf = it.kind === "padron" ? " [padrón]" : "";
    return `${i + 1}. ${it.nombre}${suf}`;
  });
  const resp = prompt(
    `¿Cuál ${cfg.labelCap.toLowerCase()} se CONSERVARÁ?\n` +
    "Los demás marcados se fusionarán en él.\n" +
    "(Los del padrón se registrarán en catálogo automáticamente.)\n\n" +
    lineas.join("\n") +
    `\n\nEscriba el número (1-${items.length}):`,
    "1"
  );
  if (resp === null) return 0;
  const n = parseInt(String(resp).trim(), 10);
  if (!n || n < 1 || n > items.length) {
    alert("Selección inválida. Indique un número de la lista.");
    return 0;
  }
  const sel = items[n - 1];
  if (sel.kind === "catalogo") return fijarDestinoFusionCatalogo(tipo, sel.id, sel.nombre);
  const id = await registrarCatalogoDesdeRow(tipo, sel.row, sel.idx);
  if (!id) return 0;
  return fijarDestinoFusionCatalogo(tipo, id, sel.nombre);
}

async function resolverDestinoFusionCatalogo(tipo) {
  const st = estadoMantCat(tipo);
  st.fusionDestinoMeta = null;
  const items = itemsMarcadosFusionCatalogo(tipo);
  const idx = st.indiceActivo;
  let destinoId = Number(elMantCat(tipo, "Id")?.value || 0);

  if (idx >= 0 && idx < (st.resultados || []).length) {
    const row = st.resultados[idx];
    if (row?.id) return fijarDestinoFusionCatalogo(tipo, row.id, nombreCatalogoRow(row, tipo));
    if (row?.origen === "padron") {
      setMantCatMsg(tipo, "Registrando destino del padrón en catálogo...", true);
      const id = await registrarCatalogoDesdeRow(tipo, row, idx);
      if (!id) return 0;
      return fijarDestinoFusionCatalogo(tipo, id, nombreCatalogoRow(row, tipo));
    }
  }

  if (destinoId) {
    const row = (st.resultados || []).find(x => Number(x.id) === destinoId);
    return fijarDestinoFusionCatalogo(tipo, destinoId, row ? nombreCatalogoRow(row, tipo) : "");
  }

  if (items.length >= 2) {
    setMantCatMsg(tipo, "Seleccione titular destino...", true);
    return elegirDestinoFusionCatalogo(tipo, items);
  }
  return 0;
}

async function resolverOrigenesFusionCatalogo(tipo, destinoId) {
  const st = estadoMantCat(tipo);
  const origenes = [...st.fusionIds].map(Number).filter(id => id && id !== destinoId);
  for (const idx of st.fusionPadronIdx) {
    const row = st.resultados[idx];
    if (!row) continue;
    let id = Number(row.id || 0);
    if (!id) id = await registrarCatalogoDesdeRow(tipo, row, idx);
    if (id && id !== destinoId && !origenes.includes(id)) origenes.push(id);
  }
  return origenes;
}

async function fusionarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const totalMarcados = st.fusionIds.size + st.fusionPadronIdx.size;
  if (totalMarcados < 1) {
    const msg = "Marque al menos un duplicado con ✓ y seleccione el destino (clic en fila).";
    setMantCatMsg(tipo, msg, false);
    alert(msg);
    return;
  }
  try {
    setMantCatMsg(tipo, "Preparando fusión...", true);
    st.registroPadronCache = new Map();
    st.fusionDestinoMeta = null;
    const destinoId = await resolverDestinoFusionCatalogo(tipo);
    if (!destinoId) return;

    const origenes = await resolverOrigenesFusionCatalogo(tipo, destinoId);
    if (!origenes.length) {
      const msg = "Marque con ✓ los duplicados (no marque el registro destino).";
      setMantCatMsg(tipo, msg, false);
      alert(msg);
      return;
    }

    const nombreDest = nombreDestinoFusionCatalogo(tipo, destinoId);
    if (!nombreDest) {
      setMantCatMsg(tipo, "No se identificó el registro destino.", false);
      return;
    }

    const nombresOrigen = origenes.map(id => {
      const row = (st.resultados || []).find(x => Number(x.id) === Number(id));
      if (row) return nombreCatalogoRow(row, tipo);
      for (const [idx, cachedId] of st.registroPadronCache.entries()) {
        if (Number(cachedId) === Number(id) && st.resultados[idx]) {
          return nombreCatalogoRow(st.resultados[idx], tipo);
        }
      }
      return "ID " + id;
    }).join("\n• ");

    if (!confirm(
      `¿Fusionar ${origenes.length} registro(s) en?\n\n${nombreDest}\n\nOrígenes:\n• ${nombresOrigen}\n\nSe actualizarán predios del padrón y personas del catálogo.`
    )) return;

    setMantCatMsg(tipo, "Fusionando...", true);
    const r = await fetch(`${API}/${cfg.apiBase}/fusionar`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({ id_destino: destinoId, ids_origen: origenes })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo fusionar."));
    limpiarMarcasFusionCatalogo(tipo);
    setMantCatMsg(
      tipo,
      `Fusión completada: ${data.registros_desactivados || origenes.length} dado(s) de baja, ` +
      `${data.padron_actualizados || 0} predio(s) y ${data.personas_actualizadas || 0} persona(s) actualizados.`,
      true
    );
    await buscarCatalogoMantenimiento(tipo);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  }
}
window.fusionarCatalogoMantenimiento = fusionarCatalogoMantenimiento;

async function grabarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const nombre = normalizarPersonaCatalogo(elMantCat(tipo, "Nombre")?.value);
  if (!nombre) {
    setMantCatMsg(tipo, `Capture el nombre de la ${cfg.labelCap.toLowerCase()}.`, false);
    return;
  }
  const id = Number(elMantCat(tipo, "Id")?.value || 0);
  const payload = { [cfg.campoNombre]: nombre };
  try {
    setMantCatMsg(tipo, "Guardando...", true);
    let r;
    if (id) {
      r = await fetch(`${API}/${cfg.apiBase}/${id}`, {
        method: "PUT",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      r = await fetch(`${API}/${cfg.apiBase}`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo guardar."));
    const reg = data[cfg.resKey] || data;
    const nuevoId = Number(reg?.id || id);
    if (nuevoId) elMantCat(tipo, "Id").value = String(nuevoId);
    const extra = id && (data.padron_actualizados || data.personas_actualizadas)
      ? ` · Padrón: ${data.padron_actualizados || 0}, personas: ${data.personas_actualizadas || 0}`
      : "";
    setMantCatMsg(tipo, (id ? "Actualizado" : "Registrado") + " correctamente." + extra, true);
    await buscarCatalogoMantenimiento(tipo);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  }
}
window.grabarCatalogoMantenimiento = grabarCatalogoMantenimiento;

async function borrarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const id = Number(elMantCat(tipo, "Id")?.value || 0);
  if (!id) {
    setMantCatMsg(tipo, "Seleccione un registro del catálogo para dar de baja.", false);
    return;
  }
  const nombre = normalizarPersonaCatalogo(elMantCat(tipo, "Nombre")?.value);
  if (!confirm(`¿Dar de baja la ${cfg.labelCap.toLowerCase()}?\n\n${nombre}\n\nNo se borran predios del padrón.`)) return;
  try {
    const r = await fetch(`${API}/${cfg.apiBase}/${id}`, {
      method: "DELETE",
      headers: authJsonHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo dar de baja."));
    setMantCatMsg(tipo, "Registro dado de baja.", true);
    limpiarFormularioCatalogoMantenimiento(tipo);
    await buscarCatalogoMantenimiento(tipo);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  }
}
window.borrarCatalogoMantenimiento = borrarCatalogoMantenimiento;

function nuevoCatalogoMantenimiento(tipo) {
  limpiarFormularioCatalogoMantenimiento(tipo);
  elMantCat(tipo, "Nombre")?.focus();
}
window.nuevoCatalogoMantenimiento = nuevoCatalogoMantenimiento;

function cancelarCatalogoMantenimiento(tipo) {
  const st = estadoMantCat(tipo);
  const idx = st.indiceActivo;
  if (idx >= 0 && st.resultados[idx]) cargarFilaCatalogoMantenimiento(tipo, st.resultados[idx], idx);
  else limpiarFormularioCatalogoMantenimiento(tipo);
}
window.cancelarCatalogoMantenimiento = cancelarCatalogoMantenimiento;

function abrirCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const modal = document.getElementById(cfg.modalId);
  if (!modal) return;
  Object.assign(estadoMantCat(tipo), crearEstadoCatalogoMantenimiento());
  limpiarFormularioCatalogoMantenimiento(tipo);
  renderGridCatalogoMantenimiento(tipo);
  elMantCat(tipo, "Buscar").value = "";
  elMantCat(tipo, "Contador").textContent = "0";
  modal.classList.remove("oculto");
  setTimeout(() => elMantCat(tipo, "Buscar")?.focus(), 120);
}

function cerrarCatalogoMantenimiento(tipo) {
  const modal = document.getElementById(cfgMantCat(tipo).modalId);
  if (modal) modal.classList.add("oculto");
}

function abrirMantenimientoCalles() { abrirCatalogoMantenimiento("calles"); }
function cerrarMantenimientoCalles() { cerrarCatalogoMantenimiento("calles"); }
function buscarMantenimientoCalles() { return buscarCatalogoMantenimiento("calles"); }
window.abrirMantenimientoCalles = abrirMantenimientoCalles;
window.cerrarMantenimientoCalles = cerrarMantenimientoCalles;
window.buscarMantenimientoCalles = buscarMantenimientoCalles;
window.cargarFilaCatalogoMantenimiento = cargarFilaCatalogoMantenimiento;
window.toggleFusionCatalogoMantenimiento = toggleFusionCatalogoMantenimiento;
window.toggleFusionTodosCatalogoMantenimiento = toggleFusionTodosCatalogoMantenimiento;

function abrirMantenimientoColonias() { abrirCatalogoMantenimiento("colonias"); }
function cerrarMantenimientoColonias() { cerrarCatalogoMantenimiento("colonias"); }
function buscarMantenimientoColonias() { return buscarCatalogoMantenimiento("colonias"); }
window.abrirMantenimientoColonias = abrirMantenimientoColonias;
window.cerrarMantenimientoColonias = cerrarMantenimientoColonias;
window.buscarMantenimientoColonias = buscarMantenimientoColonias;
window.mantCatEstado = mantCatEstado;