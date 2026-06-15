/* Portal por módulos + pop-up de predio (7 pestañas) */

let moduloPortalActivo = null;
let popupPredioTabActiva = "datos-generales";
let popupPredioIndiceActual = -1;
let popupMiniMap = null;
let popupMiniMapCapas = null;
let popupMiniMapClaveActual = "";
let popupMiniCapasManager = null;

const POPUP_MINI_CAPA_ORDEN_DEF = {
  consultado: 35,
  predios: 12,
  colonias: 5
};

const POPUP_MINI_CAPA_PROP = {
  consultado: "predioVector",
  predios: "prediosWms",
  colonias: "coloniasWms"
};
let popupTitularidadSubTab = "titulares";
let popupTitularidadCache = null;

const POPUP_TIPOS_TENENCIA = {
  C: { codigo: "C", nombre: "Condominio", desc: "Régimen en condominio." },
  P: { codigo: "P", nombre: "Privado", desc: "Propiedad privada individual." },
  G: { codigo: "G", nombre: "Gobierno / Pública", desc: "Propiedad de gobierno o sector público." },
  S: { codigo: "S", nombre: "Social", desc: "Vivienda o patrimonio social." },
  R: { codigo: "R", nombre: "Rústica", desc: "Propiedad de carácter rústico." },
  E: { codigo: "E", nombre: "Ejidal", desc: "Régimen ejidal o comunal." }
};

const MODULOS_PORTAL_DEF = [
  {
    id: "gestion-catastral",
    titulo: "Gestión Catastral",
    descripcion: "Mapa de consulta y análisis predial con ficha detallada por predio.",
    icono: "🗺️",
    roles: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion", "consulta"]
  },
  {
    id: "movimientos",
    titulo: "Movimientos Catastrales",
    descripcion: "Solicitudes, autorización y aplicación de movimientos al padrón.",
    icono: "📝",
    roles: ["admin", "supervisor", "catastro"],
    tabId: "tabMovimientos"
  },
  {
    id: "zonas-homogeneas",
    titulo: "Análisis de Zonas Homogéneas",
    descripcion: "Catálogo, evolución de valores y cédulas de zona homogénea.",
    icono: "📊",
    roles: ["admin", "supervisor", "catastro", "fiscalizacion", "cartografia", "consulta"],
    tabId: "tabAnalisisZonas"
  },
  {
    id: "condominios",
    titulo: "Régimen en Condominio",
    descripcion: "Consulta y análisis de condominios y unidades.",
    icono: "🏢",
    roles: ["admin", "supervisor", "catastro", "fiscalizacion", "cartografia", "consulta"],
    tabId: "tabCondominios"
  },
  {
    id: "modulo-cartografico",
    titulo: "Módulo Cartográfico",
    descripcion: "Edición geométrica de predios: alta de clave, subdivisión, fusión y ajustes.",
    icono: "📐",
    roles: ["admin", "supervisor", "cartografia"]
  },
  {
    id: "administracion",
    titulo: "Administración del Sistema",
    descripcion: "Usuarios, permisos y auditoría institucional.",
    icono: "⚙️",
    roles: ["admin"],
    tabId: "tabAdministracion"
  },
  {
    id: "portal-completo",
    titulo: "Portal Integral (vista clásica)",
    descripcion: "Acceso a todas las herramientas en el panel lateral completo.",
    icono: "🖥️",
    roles: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion", "consulta"]
  }
];

const POPUP_PREDIO_TABS = [
  { id: "datos-generales", label: "Datos Generales" },
  { id: "construcciones", label: "Construcciones/Medidas" },
  { id: "archivo", label: "Archivo Digitalizado" },
  { id: "numeros-oficiales", label: "Números Oficiales" },
  { id: "carta-urbana", label: "Carta Urbana 2040" },
  { id: "colonia", label: "Colonia/Fraccionamiento" },
  { id: "zona-homogenea", label: "Zona Homogénea" }
];

function ocultarTabsExtraGestionCatastral() {
  const idsOcultar = ["tabHerramientas", "tabAnalisisZonas", "tabCondominios", "tabMovimientos", "tabAdministracion"];
  document.querySelectorAll("#panel .tabs-modulos-trabajo .tab-btn").forEach(btn => {
    const onclick = btn.getAttribute("onclick") || "";
    const esExtra = idsOcultar.some(id => onclick.includes(id));
    btn.classList.toggle("tab-modulo-extra", esExtra);
    btn.style.display = esExtra ? "none" : "";
    btn.setAttribute("aria-hidden", esExtra ? "true" : "false");
  });
}

function restaurarTabsExtraPanel() {
  document.querySelectorAll("#panel .tabs-modulos-trabajo .tab-btn").forEach(btn => {
    btn.style.display = "";
    btn.removeAttribute("aria-hidden");
  });
}

function modulosVisiblesParaRol(rol, usuarioOpt) {
  const rolNorm = String(rol || "consulta").trim().toLowerCase();
  const u = usuarioOpt || (typeof obtenerUsuarioSesion === "function" ? obtenerUsuarioSesion() : null);
  const modulosApi = (u && u.modulos) || [];
  const grantIds = new Set(
    (modulosApi || [])
      .filter(function(m) { return m.origen === "concesion" && m.estado === "activo"; })
      .map(function(m) { return m.modulo_id; })
  );
  return MODULOS_PORTAL_DEF.filter(function(m) {
    if (m.roles.includes(rolNorm)) return true;
    if (grantIds.has(m.id)) return true;
    return false;
  });
}

function enModoGestionCatastral() {
  return moduloPortalActivo === "gestion-catastral";
}

function mostrarSelectorModulos(usuario) {
  const overlay = document.getElementById("selectorModulosOverlay");
  const app = document.getElementById("appInstitucional");
  const lista = document.getElementById("listaModulosInstitucionales");
  const bienvenida = document.getElementById("selectorModulosBienvenida");

  if (app) app.classList.add("oculto");
  if (overlay) overlay.classList.remove("oculto");

  document.body.classList.remove(
    "portal-modulo-activo",
    "modo-gestion-catastral",
    "modo-portal-completo",
    "modo-modulo-cartografico",
    "modo-movimientos-catastrales",
    "panel-oculto-activo"
  );
  if (typeof desactivarModuloMovimientosCatastrales === "function") {
    desactivarModuloMovimientosCatastrales();
  }
  document.getElementById("panel")?.classList.remove("panel-oculto");
  if (typeof cerrarEdicionCartograficaSilencioso === "function") cerrarEdicionCartograficaSilencioso();
  restaurarTabsExtraPanel();
  moduloPortalActivo = null;

  const nombre = usuario?.nombre || usuario?.usuario || "Usuario";
  const rol = usuario?.rol || "consulta";
  if (bienvenida) {
    bienvenida.textContent = `${nombre} · Rol: ${String(rol).toUpperCase()}`;
  }

  if (!lista) return;
  lista.innerHTML = "";

  modulosVisiblesParaRol(rol, usuario).forEach(mod => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "selector-modulos-item";
    btn.innerHTML = `
      <span class="selector-modulos-item-icono" aria-hidden="true">${mod.icono}</span>
      <span class="selector-modulos-item-texto">
        <strong>${mod.titulo}</strong>
        <span>${mod.descripcion}</span>
      </span>
      <span class="selector-modulos-item-flecha" aria-hidden="true">→</span>
    `;
    btn.onclick = () => entrarModuloPortal(mod.id);
    li.appendChild(btn);
    lista.appendChild(li);
  });
}

function entrarModuloPortal(moduloId) {
  const mod = MODULOS_PORTAL_DEF.find(m => m.id === moduloId);
  if (!mod) return;

  moduloPortalActivo = moduloId;
  document.getElementById("selectorModulosOverlay")?.classList.add("oculto");
  document.body.classList.add("portal-modulo-activo");
  document.body.classList.remove("modo-gestion-catastral", "modo-portal-completo", "modo-modulo-cartografico", "modo-movimientos-catastrales");

  if (moduloId === "modulo-cartografico") {
    document.getElementById("appInstitucional")?.classList.add("oculto");
    document.body.classList.add("modo-modulo-cartografico");
    const tituloMod = document.getElementById("breadcrumbModulo");
    if (tituloMod) tituloMod.textContent = mod.titulo;
    if (typeof abrirModuloCartograficoDesdePortal === "function") {
      abrirModuloCartograficoDesdePortal();
    } else if (typeof abrirEdicionCartografica === "function") {
      abrirEdicionCartografica({ desdePortal: true });
    } else {
      alert("El módulo cartográfico no está cargado. Suba js/51-edicion-cartografica.js e index.html al servidor y recargue con Ctrl+F5.");
      mostrarSelectorModulos(obtenerUsuarioSesion());
    }
    return;
  }

  document.getElementById("appInstitucional")?.classList.remove("oculto");

  if (moduloId === "administracion") {
    document.body.classList.add("modo-portal-completo");
    restaurarTabsExtraPanel();
    if (typeof abrirModuloAdministracion === "function") {
      setTimeout(function() { abrirModuloAdministracion(); }, 80);
    }
  } else if (moduloId === "gestion-catastral") {
    document.body.classList.add("modo-gestion-catastral");
    document.getElementById("panel")?.classList.remove("panel-oculto");
    document.body.classList.remove("panel-oculto-activo");
    const btnConsulta = document.querySelector('.tab-btn[onclick*="tabConsulta"]');
    if (typeof mostrarTab === "function") mostrarTab("tabConsulta", btnConsulta);
    if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
    if (typeof cerrarFichaFlotante === "function") cerrarFichaFlotante();
    if (typeof aplicarCapasVistaGeneral === "function") aplicarCapasVistaGeneral();
    ocultarTabsExtraGestionCatastral();
  } else if (moduloId === "movimientos") {
  document.body.classList.add("modo-movimientos-catastrales", "panel-oculto-activo");
  document.getElementById("panel")?.classList.add("panel-oculto");
    if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
    if (typeof cerrarFichaFlotante === "function") cerrarFichaFlotante();
    if (typeof activarModuloMovimientosCatastrales === "function") {
      activarModuloMovimientosCatastrales();
    } else {
      document.body.classList.add("modo-portal-completo");
      restaurarTabsExtraPanel();
      const btn = document.querySelector('.tab-btn[onclick*="tabMovimientos"]');
      if (typeof mostrarTab === "function") mostrarTab("tabMovimientos", btn);
    }
  } else {
    document.body.classList.add("modo-portal-completo");
    restaurarTabsExtraPanel();
    if (typeof restaurarCapasModuloCompleto === "function") restaurarCapasModuloCompleto();
    if (mod.tabId && typeof mostrarTab === "function") {
      const btn = document.querySelector(`.tab-btn[onclick*="${mod.tabId}"]`);
      mostrarTab(mod.tabId, btn);
    } else if (typeof mostrarTab === "function") {
      const btn = document.querySelector('.tab-btn[onclick*="tabConsulta"]');
      mostrarTab("tabConsulta", btn);
    }
  }

  const tituloMod = document.getElementById("breadcrumbModulo");
  if (tituloMod) tituloMod.textContent = mod.titulo;

  if (moduloId === "modulo-cartografico") return;

  setTimeout(() => {
    if (moduloId === "gestion-catastral") ocultarTabsExtraGestionCatastral();
    if (typeof inicializarBotonOcultarPanel === "function") inicializarBotonOcultarPanel();
    if (typeof map !== "undefined" && map) map.updateSize();
    if (typeof actualizarLayoutPrincipal === "function") actualizarLayoutPrincipal();
    if (typeof _iniciarDashboardsPostLogin === "function") {
      _iniciarDashboardsPostLogin(obtenerUsuarioSesion());
    }
    actualizarLeyendaDinamica();
    if (
      moduloId !== "movimientos" &&
      document.getElementById("chkLeyenda")?.checked !== false &&
      typeof aplicarVisibilidadLeyendaIntegrada === "function"
    ) {
      aplicarVisibilidadLeyendaIntegrada(true);
    }
  }, 280);
}

function volverSelectorModulos() {
  if (typeof cerrarEdicionCartograficaSilencioso === "function") cerrarEdicionCartograficaSilencioso();
  if (typeof desactivarModuloMovimientosCatastrales === "function") desactivarModuloMovimientosCatastrales();
  if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
  if (typeof cerrarFichaFlotante === "function") cerrarFichaFlotante();
  mostrarSelectorModulos(obtenerUsuarioSesion());
}

function popupVal(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  return String(valor);
}

function popupEtiquetaTipoPersona(p) {
  const t = String(p?.tipo_persona || "").trim().toUpperCase();
  if (!t) return "—";
  if (t.includes("MORAL")) return "Persona moral";
  if (t.includes("FISIC")) return "Persona física";
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function popupCampo(label, valor) {
  return `<div class="popup-legacy-row"><label>${label}</label><div class="popup-legacy-val">${popupVal(valor)}</div></div>`;
}

function popupCampoNombre(label, valor) {
  return `<div class="popup-legacy-row popup-legacy-row-nombre"><label>${label}</label><div class="popup-legacy-val">${popupVal(valor)}</div></div>`;
}

function popupZonaHomogenea(p) {
  return popupVal(p?.zona_homogenea || p?.zonah);
}

function popupNombrePersonaTitular(row) {
  if (!row) return "—";
  if (typeof nombrePersonaCatalogo === "function") return nombrePersonaCatalogo(row);
  return row.nombre_completo || row.razon_social || row.nombre || "—";
}

function popupEtiquetaTenencia(codigo) {
  const c = String(codigo || "").trim().toUpperCase();
  const mapa = (typeof TIPOS_TENENCIA_UI !== "undefined" && TIPOS_TENENCIA_UI) || POPUP_TIPOS_TENENCIA;
  if (mapa[c]) return mapa[c];
  if (!c) {
    return { codigo: "—", nombre: "Sin clasificar", desc: "No hay tipo de tenencia registrado en el padrón." };
  }
  return { codigo: c, nombre: c, desc: "Código de tenencia registrado en el padrón." };
}

function popupHayCopropiedad(p, titularidad) {
  const props = titularidad?.propietarios || [];
  const total = Number(titularidad?.total ?? p?.total_titulares ?? 0);
  if (props.length > 1) return true;
  if (total > 1) return true;
  return props.some(x => String(x.tipo_titularidad || "").toUpperCase() === "COPROPIETARIO");
}

function popupNombreContribuyente(p, titularidad) {
  const nombre = String(p?.nombre_completo || p?.propietario || "").trim();
  if (!nombre) return "—";
  if (popupHayCopropiedad(p, titularidad) && !/\bY\s+COP\.?\b/i.test(nombre)) {
    return `${nombre} Y COP.`;
  }
  return nombre;
}

async function cargarTitularidadPredioPopup(clave, p) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;

  try {
    if (typeof fetchPropietariosPredioCached === "function") {
      const cached = await fetchPropietariosPredioCached(claveNorm);
      if (cached) return cached;
    }
    const r = await fetch(`${API}/predios/${encodeURIComponent(claveNorm)}/propietarios?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (r.ok) return await r.json();
  } catch (e) {
    console.warn("No se pudo cargar titularidad del predio:", e);
  }

  const nombre = String(p?.nombre_completo || p?.propietario || "").trim();
  if (!nombre && !p?.condominio) return null;

  return {
    clave_catastral: claveNorm,
    total: Number(p?.total_titulares || 1),
    suma_porcentaje: Number(p?.suma_porcentaje || p?.porcentaje_propiedad || 100),
    valido: true,
    propietarios: nombre ? [{
      nombre_completo: nombre,
      tipo_titularidad: p?.tipo_titularidad || "PROPIETARIO",
      rfc: p?.rfc || "",
      porcentaje_propiedad: Number(p?.porcentaje_propiedad ?? 100)
    }] : [],
    condominio: p?.condominio ? { en_padron: true, regimen_padron: { tipo: p.condominio } } : null
  };
}

function htmlTablaTitularesPopup(titularidad) {
  const props = titularidad?.propietarios || [];
  if (!props.length) {
    return `<div class="popup-titulares-vacio">Sin titulares registrados en el catálogo catastral para este predio.</div>`;
  }

  const filas = props.map(row => `
    <tr>
      <td><b>${escapeHtml(popupNombrePersonaTitular(row))}</b></td>
      <td>${escapeHtml(row.tipo_titularidad || "—")}</td>
      <td class="popup-titulares-pct">${Number(row.porcentaje_propiedad || 0).toFixed(2)}%</td>
    </tr>
  `).join("");

  const suma = Number(titularidad?.suma_porcentaje ?? props.reduce((s, x) => s + Number(x.porcentaje_propiedad || 0), 0));
  const valido = Math.abs(suma - 100) < 0.01;

  return `
    <div class="popup-titulares-scroll">
      <table class="popup-titulares-table">
        <thead>
          <tr><th>Propietario</th><th>Tipo</th><th>%</th></tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div class="popup-coprop-total ${valido ? "ok" : "warn"}">
      TOTAL COPROPIEDAD: ${suma.toFixed(2)}% ${valido ? "✓" : "⚠"}
    </div>
  `;
}

function htmlPanelTenenciaPopup(p, titularidad) {
  const cond = titularidad?.condominio;
  const codigoRaw = String(
    p?.condominio ||
    cond?.regimen_padron?.tipo ||
    cond?.regimen?.tipo ||
    cond?.regimen_padron?.tipo_codigo ||
    ""
  ).trim().toUpperCase();
  const info = popupEtiquetaTenencia(codigoRaw);
  const modalidad = cond?.modalidad_etiqueta || cond?.modalidad || "";
  const nombreCondominio = cond?.nombre_condominio || "";

  let extra = "";
  if (codigoRaw === "C") {
    extra = `
      <div class="popup-tenencia-extra">
        ${modalidad ? `<div><span>Modalidad</span><b>${escapeHtml(modalidad)}</b></div>` : ""}
        ${nombreCondominio ? `<div><span>Condominio</span><b>${escapeHtml(nombreCondominio)}</b></div>` : ""}
        ${!modalidad && !nombreCondominio ? `<p class="popup-tenencia-nota">Régimen en condominio registrado en padrón. Consulte el módulo de condominios para detalle cartográfico.</p>` : ""}
      </div>
    `;
  }

  return `
    <div class="popup-tenencia-panel">
      <div class="popup-tenencia-codigo">${escapeHtml(info.codigo)}</div>
      <div class="popup-tenencia-nombre">${escapeHtml(info.nombre)}</div>
      <p class="popup-tenencia-desc">${escapeHtml(info.desc)}</p>
      <div class="popup-tenencia-meta">
        <span>Campo padrón:</span> <b>condominio</b> · Código institucional de tenencia predial
      </div>
      ${extra}
    </div>
  `;
}

function mostrarPopupSubTabTitularidad(tab) {
  popupTitularidadSubTab = tab;
  document.querySelectorAll(".popup-subtab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.subtab === tab);
  });
  document.getElementById("popupSubPanelTitulares")?.classList.toggle("oculto", tab !== "titulares");
  document.getElementById("popupSubPanelTenencia")?.classList.toggle("oculto", tab !== "tenencia");
}

function pintarPopupTitularidadSeccion(titularidad, p) {
  const elTit = document.getElementById("popupSubPanelTitulares");
  const elTen = document.getElementById("popupSubPanelTenencia");
  if (elTit) elTit.innerHTML = htmlTablaTitularesPopup(titularidad);
  if (elTen) elTen.innerHTML = htmlPanelTenenciaPopup(p, titularidad);
  mostrarPopupSubTabTitularidad(popupTitularidadSubTab || "titulares");
}

function htmlSeccionTitularidadPopup() {
  return `
    <div class="popup-titularidad-box">
      <div class="popup-subtabs" role="tablist" aria-label="Titularidad del predio">
        <button type="button" class="popup-subtab active" data-subtab="titulares" onclick="mostrarPopupSubTabTitularidad('titulares')">Titulares vigentes del predio</button>
        <button type="button" class="popup-subtab" data-subtab="tenencia" onclick="mostrarPopupSubTabTitularidad('tenencia')">Tipo de tenencia</button>
      </div>
      <div id="popupSubPanelTitulares" class="popup-subpanel"></div>
      <div id="popupSubPanelTenencia" class="popup-subpanel oculto"></div>
    </div>
  `;
}

function urlStreetViewEmbed(lat, lon) {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return "";
  const latN = Number(lat).toFixed(7);
  const lonN = Number(lon).toFixed(7);
  return `https://maps.google.com/maps?q=&layer=c&cbll=${latN},${lonN}&cbp=12,0,,0,0&output=svembed`;
}

async function resolverGeometriaPredioPopup(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;

  let geom = typeof obtenerGeometriaPredioSeleccionado === "function"
    ? obtenerGeometriaPredioSeleccionado(claveNorm)
    : null;
  if (geom) return geom;

  const cacheFeature = window._cacheFeaturePredioPorClave?.[claveNorm];
  if (cacheFeature?.geometry) {
    try {
      const format = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      geom = format.readFeature(cacheFeature).getGeometry();
      if (geom) return geom;
    } catch (e) {}
  }

  try {
    const r = await fetch(`${API}/predios/${encodeURIComponent(claveNorm)}/geojson`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {},
      cache: "no-store"
    });
    if (!r.ok) return null;
    const feature = await r.json();
    if (!feature?.geometry) return null;
    const format = new ol.format.GeoJSON({
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    geom = format.readFeature(feature).getGeometry();
    return geom || null;
  } catch (e) {
    return null;
  }
}

function obtenerCentroidePredio(clave, geometry = null) {
  const geom = geometry || (typeof obtenerGeometriaPredioSeleccionado === "function"
    ? obtenerGeometriaPredioSeleccionado(clave)
    : null);
  if (!geom) return { lat: null, lon: null, geometry: null };

  let center3857;
  try {
    if (typeof geom.getInteriorPoint === "function") {
      center3857 = geom.getInteriorPoint().getCoordinates();
    } else {
      center3857 = ol.extent.getCenter(geom.getExtent());
    }
    const [lon, lat] = ol.proj.toLonLat(center3857);
    return { lat, lon, geometry: geom };
  } catch (e) {
    return { lat: null, lon: null, geometry: geom };
  }
}

function enfocarMapaPrincipalPredio(clave, geometry = null) {
  if (typeof hacerZoomAPredio !== "function") return;
  const claveNorm = String(clave || "").trim().toUpperCase();
  const geom = geometry || (typeof obtenerGeometriaPredioSeleccionado === "function"
    ? obtenerGeometriaPredioSeleccionado(claveNorm)
    : null);
  if (!geom) return;
  hacerZoomAPredio(claveNorm, geom, {
    maxZoom: 19,
    factorExpansion: 0.42,
    minExpansionMetros: 26,
    duration: 550
  });
}

function crearCapasPopupMiniMap() {
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
    yandex: new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://core-sat.maps.yandex.net/tiles?l=sat&v=3.450&x={x}&y={y}&z={z}&scale=1&lang=es_MX",
        attributions: "Yandex"
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
      opacity: 0.9,
      zIndex: POPUP_MINI_CAPA_ORDEN_DEF.predios,
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
    }),
    coloniasWms: new ol.layer.Tile({
      visible: false,
      opacity: 0.55,
      zIndex: POPUP_MINI_CAPA_ORDEN_DEF.colonias,
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
    }),
    predioVector: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_MINI_CAPA_ORDEN_DEF.consultado,
      source: new ol.source.Vector(),
      style: function(feature) {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "#64748b",
            width: 2
          }),
          fill: new ol.style.Fill({
            color: "rgba(100, 116, 139, 0.12)"
          }),
          text: new ol.style.Text({
            text: feature.get("clave_catastral") || "",
            font: "bold 11px Arial",
            fill: new ol.style.Fill({ color: "#111" }),
            stroke: new ol.style.Stroke({ color: "#fff", width: 3 }),
            overflow: true
          })
        });
      }
    }),
    contorno: new ol.layer.Vector({
      visible: true,
      zIndex: POPUP_MINI_CAPA_ORDEN_DEF.consultado + 1,
      source: new ol.source.Vector(),
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "#0000ff",
          width: 4,
          lineDash: [12, 8]
        }),
        fill: new ol.style.Fill({
          color: "rgba(0, 0, 255, 0.08)"
        })
      })
    })
  };
  return capas;
}

function destruirPopupMiniMap() {
  if (popupMiniMap) {
    popupMiniMap.setTarget(null);
    popupMiniMap = null;
  }
  popupMiniMapCapas = null;
  popupMiniCapasManager = null;
  popupMiniMapClaveActual = "";
}

function popupMiniInicializarCapasManager() {
  if (typeof crearFichaMapaCapasManager !== "function") return;
  popupMiniCapasManager = crearFichaMapaCapasManager({
    ordenDef: POPUP_MINI_CAPA_ORDEN_DEF,
    capaProp: POPUP_MINI_CAPA_PROP,
    chkMap: {
      consultado: "popupChkPredioConsultado",
      predios: "popupChkPrediosWms",
      colonias: "popupChkColoniasWms"
    },
    optionalIds: ["colonias"],
    getCapas: () => popupMiniMapCapas,
    getMap: () => popupMiniMap,
    overlayListId: "popupMiniCapasOverlayList",
    opPrefix: "popupMiniOp"
  });
  popupMiniCapasManager.inicializar();
}

function htmlMenuCapasPopupMini() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "consultado", checkboxId: "popupChkPredioConsultado", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "predios", checkboxId: "popupChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: true, opacity: 90 },
        { id: "colonias", checkboxId: "popupChkColoniasWms", dotClass: "dot-purple", label: "Colonias", checked: false, opacity: 55 }
      ], {
        opPrefix: "popupMiniOp",
        toggleFn: "togglePopupMiniCapa",
        opacityFn: "popupMiniCambiarOpacidadCapa",
        subirFn: "popupMiniSubirCapa",
        bajarFn: "popupMiniBajarCapa"
      })
    : "";

  const basemap = `<div class="popup-capas-seccion">
        <strong>Base mapas</strong>
        <label><input type="radio" name="popupBaseMap" value="googleHybrid" checked onchange="setPopupMiniBaseLayer(this.value)"> Google Satellite &amp; Roads</label>
        <label><input type="radio" name="popupBaseMap" value="googleRoad" onchange="setPopupMiniBaseLayer(this.value)"> Google Road Map</label>
        <label><input type="radio" name="popupBaseMap" value="yandex" onchange="setPopupMiniBaseLayer(this.value)"> Yandex Satellite</label>
        <label><input type="radio" name="popupBaseMap" value="esri" onchange="setPopupMiniBaseLayer(this.value)"> ESRI Satellite</label>
        <label><input type="radio" name="popupBaseMap" value="osm" onchange="setPopupMiniBaseLayer(this.value)"> Open Street Map</label>
        <label><input type="radio" name="popupBaseMap" value="googleSat" onchange="setPopupMiniBaseLayer(this.value)"> Google Satellite</label>
      </div>`;

  return typeof htmlPopupMapaCapasMenu === "function"
    ? htmlPopupMapaCapasMenu({
        menuId: "popupMiniCapasMenu",
        overlayListId: "popupMiniCapasOverlayList",
        menuClass: "popup-carta-capas-menu popup-mini-capas-menu",
        itemsHtml: capas,
        basemapHtml: basemap
      })
    : "";
}

function togglePopupMiniCapasMenu(ev) {
  togglePopupMapaCapasMenu("popupMiniCapasMenu", ev);
}

function popupMiniCambiarOpacidadCapa(id, valor) {
  popupMiniCapasManager?.cambiarOpacidad(id, valor);
  if (id === "consultado" && popupMiniMapCapas?.contorno) {
    popupMiniMapCapas.contorno.setOpacity(Number(valor) / 100);
    popupMiniMap?.render();
  }
}

function popupMiniSubirCapa(id) {
  popupMiniCapasManager?.subir(id);
}

function popupMiniBajarCapa(id) {
  popupMiniCapasManager?.bajar(id);
}

function setPopupMiniBaseLayer(valor) {
  if (!popupMiniMapCapas) return;
  const ids = ["googleHybrid", "googleSat", "googleRoad", "yandex", "esri", "osm"];
  ids.forEach(id => {
    if (popupMiniMapCapas[id]) popupMiniMapCapas[id].setVisible(id === valor);
  });
  if (popupMiniMap) popupMiniMap.render();
}

function togglePopupMiniCapa(tipo) {
  if (tipo === "consultado") {
    const visible = document.getElementById("popupChkPredioConsultado")?.checked !== false;
    if (popupMiniMapCapas?.contorno) popupMiniMapCapas.contorno.setVisible(visible);
    popupMiniCapasManager?.toggle("consultado");
    return;
  }
  popupMiniCapasManager?.toggle(tipo);
}

async function actualizarPopupMiniMap(clave, geometry = null) {
  const target = document.getElementById("popupMiniMap");
  if (!target) return;

  const claveNorm = String(clave || "").trim().toUpperCase();
  const geom = geometry || await resolverGeometriaPredioPopup(claveNorm);
  if (!geom) {
    target.innerHTML = `<div class="popup-mini-map-vacio">Sin geometría cartográfica para este predio.</div>`;
    return;
  }

  if (!popupMiniMap) {
    target.innerHTML = "";
    popupMiniMapCapas = crearCapasPopupMiniMap();
    popupMiniMap = new ol.Map({
      target: "popupMiniMap",
      layers: [
        popupMiniMapCapas.googleHybrid,
        popupMiniMapCapas.googleSat,
        popupMiniMapCapas.googleRoad,
        popupMiniMapCapas.yandex,
        popupMiniMapCapas.esri,
        popupMiniMapCapas.osm,
        popupMiniMapCapas.coloniasWms,
        popupMiniMapCapas.prediosWms,
        popupMiniMapCapas.predioVector,
        popupMiniMapCapas.contorno
      ],
      controls: (function() {
        try {
          if (ol.control?.defaults?.defaults) {
            return ol.control.defaults.defaults({ zoom: true, rotate: false, attribution: false });
          }
          if (typeof ol.control?.defaults === "function") {
            return ol.control.defaults({ zoom: true, rotate: false, attribution: false });
          }
        } catch (e) {}
        return [new ol.control.Zoom()];
      })(),
      view: new ol.View({
        projection: "EPSG:3857",
        center: ol.extent.getCenter(geom.getExtent()),
        zoom: 18
      })
    });
    popupMiniInicializarCapasManager();
    popupMiniMapClaveActual = claveNorm;
  }

  popupMiniMapCapas.predioVector.getSource().clear();
  popupMiniMapCapas.contorno.getSource().clear();

  const feature = new ol.Feature(geom.clone ? geom.clone() : geom);
  feature.set("clave_catastral", claveNorm);
  popupMiniMapCapas.predioVector.getSource().addFeature(feature);
  popupMiniMapCapas.contorno.getSource().addFeature(new ol.Feature(geom.clone ? geom.clone() : geom));

  const extent = typeof expandirExtentGeometria === "function"
    ? expandirExtentGeometria(geom, 0.55, 30)
    : geom.getExtent();

  popupMiniMap.getView().fit(extent, {
    padding: [16, 16, 16, 16],
    maxZoom: 20,
    duration: 450
  });

  setTimeout(() => popupMiniMap?.updateSize(), 120);
}

async function actualizarPopupVistaCartografica(p) {
  const clave = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  const geom = await resolverGeometriaPredioPopup(clave);
  const { lat, lon } = obtenerCentroidePredio(clave, geom);

  const iframe = document.getElementById("popupStreetViewFrame");
  const streetVacio = document.getElementById("popupStreetViewVacio");
  const streetUrl = urlStreetViewEmbed(lat, lon);

  if (iframe && streetVacio) {
    if (streetUrl) {
      iframe.src = streetUrl;
      iframe.classList.remove("oculto");
      streetVacio.classList.add("oculto");
    } else {
      iframe.removeAttribute("src");
      iframe.classList.add("oculto");
      streetVacio.classList.remove("oculto");
    }
  }

  await actualizarPopupMiniMap(clave, geom);
  enfocarMapaPrincipalPredio(clave, geom);
}

function obtenerListaPrediosPopupNavegacion() {
  const claveActual = String(claveSeleccionadaActual || "").trim().toUpperCase();
  const filas = gridEstado?.filtrados || gridEstado?.todos || [];
  const claves = filas
    .map(r => String(r.clave_catastral || "").trim().toUpperCase())
    .filter(Boolean);
  if (claveActual && !claves.includes(claveActual)) claves.unshift(claveActual);
  return claves;
}

function actualizarPopupPredioHeader(p) {
  const clave = popupVal(p?.clave_catastral);
  const elClave = document.getElementById("popupPredioClave");
  const elResumen = document.getElementById("popupPredioResumen");
  const elNav = document.getElementById("popupPredioNavInfo");

  if (elClave) {
    elClave.innerHTML = `${clave}<small>${popupVal(p?.delegacion)}</small>`;
  }
  if (elResumen) {
    const nombreHdr = popupNombreContribuyente(p, popupTitularidadCache);
    elResumen.innerHTML = `
      <strong>${popupVal(nombreHdr)}</strong>
      <span>${popupVal(p?.calle)} ${popupVal(p?.numof ? "#" + p.numof : "")} · ${popupVal(p?.colonia)}</span>
    `;
  }
  const claves = obtenerListaPrediosPopupNavegacion();
  const idx = claves.indexOf(String(clave).toUpperCase());
  popupPredioIndiceActual = idx;
  if (elNav) {
    elNav.style.display = claves.length > 1 ? "block" : "none";
    elNav.textContent = claves.length > 1
      ? `Registro ${idx + 1} de ${claves.length}`
      : "";
  }
}

async function pintarPopupTabDatosGenerales(p) {
  const panel = document.getElementById("popupTabDatosGenerales");
  if (!panel) return;

  destruirPopupMiniMap();

  const clave = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  const titularidad = await cargarTitularidadPredioPopup(clave, p);
  popupTitularidadCache = titularidad;

  const supDoc = typeof formatoNumero === "function" ? formatoNumero(p?.sup_documental) : p?.sup_documental;
  const valor = typeof formatoMoneda === "function" ? formatoMoneda(p?.valor2026) : p?.valor2026;
  const adeudo = typeof formatoMoneda === "function" ? formatoMoneda(p?.adeudo_total) : p?.adeudo_total;
  const nombreContrib = popupNombreContribuyente(p, titularidad);

  panel.innerHTML = `
    <div class="popup-datos-grid popup-datos-grid-legacy">
      <div class="popup-col-izquierda">
        <div class="popup-datos-form popup-legacy-form">
          ${popupCampo("Clave catastral", p?.clave_catastral)}
          ${popupCampoNombre("Nombre contribuyente", nombreContrib)}
          ${popupCampo("Tipo persona", popupEtiquetaTipoPersona(p))}
          ${popupCampo("RFC", p?.rfc)}
          ${popupCampo("Delegación", p?.delegacion)}
          ${popupCampo("Colonia / fraccionamiento", p?.colonia)}
          ${popupCampo("Calle", p?.calle)}
          ${popupCampo("Número oficial", p?.numof)}
          ${popupCampo("Superficie documental", supDoc ? supDoc + " m²" : "—")}
          ${popupCampo("Valor 2026", valor)}
          ${popupCampo("Adeudo total", adeudo)}
          ${popupCampo("Uso de suelo predial", p?.descripcion_uso)}
          ${popupCampo("Zona homogénea", popupZonaHomogenea(p))}
          ${popupCampo("Folio real", typeof textoFolioReal === "function" ? textoFolioReal(p) : (p?.folio_real || "—"))}
        </div>
        ${htmlSeccionTitularidadPopup()}
      </div>
      <div class="popup-media-panel popup-street-panel">
        <div class="popup-media-head">Vista de calle</div>
        <div class="popup-media-body">
          <iframe id="popupStreetViewFrame" class="popup-street-iframe oculto" title="Street View del predio" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
          <div id="popupStreetViewVacio" class="popup-street-vacio">Sin coordenadas de centroide para Street View.</div>
        </div>
      </div>
      <div class="popup-media-panel popup-mapa-panel">
        <div class="popup-media-head">
          <span>Localización cartográfica</span>
          <div class="popup-media-head-acciones">
            <button type="button" class="popup-btn-imprimir-ficha" onclick="exportarPdfDesdePreviewFicha()" title="Abrir vista previa de la ficha">🖨️ Imprimir / PDF</button>
            <button type="button" class="popup-btn-capas" onclick="togglePopupMiniCapasMenu(event)">Capas</button>
          </div>
        </div>
        <div class="popup-media-body popup-mini-map-wrap">
          <div id="popupMiniMap" class="popup-mini-map"></div>
          ${htmlMenuCapasPopupMini()}
        </div>
      </div>
    </div>
  `;

  pintarPopupTitularidadSeccion(titularidad, p);
  actualizarPopupPredioHeader(p);
  await actualizarPopupVistaCartografica(p);
}

function pintarPopupTabPlaceholder(panelId, titulo, detalle) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.innerHTML = `
    <div class="popup-placeholder-modulo popup-legacy-panel popup-legacy-centro">
      <strong>${titulo}</strong>
      <p>${detalle}</p>
    </div>
  `;
}

const URL_ARCHIVO_DIGITAL_EXTERNO =
  "https://www.mexicali.gob.mx/webpub/consultacatastro/documentacion.aspx?";

function urlArchivoDigitalExterno(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return "";
  return URL_ARCHIVO_DIGITAL_EXTERNO + encodeURIComponent(claveNorm);
}

function popupEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

const POPUP_FOTOS_SLOTS = [
  { slot: "fachada", label: "Fachada" },
  { slot: "aerea", label: "Vista aérea" },
  { slot: "inspeccion_1", label: "Inspección 1" },
  { slot: "inspeccion_2", label: "Inspección 2" }
];

let popupArchivoClaveActual = "";

function puedeGestionarFotosArchivo() {
  return typeof puedeEditarCatastro === "function" && puedeEditarCatastro();
}

function authUploadHeadersArchivo() {
  const token = typeof obtenerTokenInstitucional === "function" ? obtenerTokenInstitucional() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function urlFotoArchivoServidor(clave, nombreArchivo) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  const archivo = String(nombreArchivo || "").replace(/^\/+/, "");
  if (!claveNorm || !archivo) return "";
  return `${API}/documentos/${encodeURIComponent(claveNorm)}/${archivo.split("/").map(encodeURIComponent).join("/")}`;
}

function htmlPopupArchivoFotosGrid(claveNorm) {
  const puedeEditar = puedeGestionarFotosArchivo();
  return POPUP_FOTOS_SLOTS.map(function(def) {
    const acciones = puedeEditar ? `
      <div class="popup-archivo-foto-acciones">
        <button type="button" class="popup-archivo-foto-btn" onclick="seleccionarFotoArchivo('${def.slot}')">Subir</button>
        <button type="button" class="popup-archivo-foto-btn popup-archivo-foto-btn-borrar" id="popupFotoBtnBorrar_${def.slot}" onclick="eliminarFotoArchivo('${def.slot}')" style="display:none">Borrar</button>
      </div>
      <input type="file" id="popupFotoInput_${def.slot}" class="popup-archivo-foto-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden onchange="subirFotoArchivo('${def.slot}', this)">` : "";
    return `
      <div class="popup-archivo-foto-celda" id="popupFotoCelda_${def.slot}" data-slot="${def.slot}">
        <div class="popup-archivo-foto-media" id="popupFotoMedia_${def.slot}">
          <span class="popup-archivo-foto-placeholder">${popupEsc(def.label)}</span>
        </div>
        ${acciones}
      </div>`;
  }).join("");
}

function actualizarPopupArchivoFotosNota(fotos, p, avisoExtra) {
  const nota = document.getElementById("popupArchivoFotosNota");
  if (!nota) return;
  if (avisoExtra) {
    nota.textContent = avisoExtra;
    nota.classList.add("popup-archivo-fotos-nota-alerta");
    return;
  }
  nota.classList.remove("popup-archivo-fotos-nota-alerta");
  const total = Array.isArray(fotos) ? fotos.length : 0;
  const inspeccion = (fotos || []).some(f => String(f.slot || "").startsWith("inspeccion_"))
    || !!p?.tiene_inspeccion;
  const fotografia = (fotos || []).some(f => f.slot === "fachada" || f.slot === "aerea")
    || !!p?.tiene_fotografia;
  nota.textContent = `Fotografías cargadas: ${total}/4 · Inspección: ${inspeccion ? "Registrada" : "Sin registro"} · Fotografía: ${fotografia ? "Registrada" : "Sin registro"}`;
}

function pintarCeldaFotoArchivo(claveNorm, slot, foto) {
  const media = document.getElementById(`popupFotoMedia_${slot}`);
  const btnBorrar = document.getElementById(`popupFotoBtnBorrar_${slot}`);
  const celda = document.getElementById(`popupFotoCelda_${slot}`);
  if (!media) return;

  if (!foto || !foto.nombre_archivo) {
    media.innerHTML = `<span class="popup-archivo-foto-placeholder">${popupEsc((POPUP_FOTOS_SLOTS.find(s => s.slot === slot) || {}).label || slot)}</span>`;
    media.style.cursor = "";
    media.title = "";
    media.onclick = null;
    if (celda) celda.classList.remove("con-foto");
    if (btnBorrar) btnBorrar.style.display = "none";
    media.dataset.idDocumento = "";
    return;
  }

  const url = urlFotoArchivoServidor(claveNorm, foto.nombre_archivo);
  const label = (POPUP_FOTOS_SLOTS.find(s => s.slot === slot) || {}).label || slot;
  media.innerHTML = `<img src="${popupEsc(url)}" alt="${popupEsc(label)}" class="popup-archivo-foto-img" title="Clic para ver en tamaño completo">`;
  media.style.cursor = "pointer";
  media.title = "Clic para ver en tamaño completo";
  media.onclick = function() {
    abrirVisorFotoArchivo(url, label);
  };
  if (celda) celda.classList.add("con-foto");
  if (btnBorrar && puedeGestionarFotosArchivo()) btnBorrar.style.display = "";
  media.dataset.idDocumento = String(foto.id_documento || "");
}

function asegurarVisorFotoArchivoOverlay() {
  let overlay = document.getElementById("popupArchivoFotoLightbox");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "popupArchivoFotoLightbox";
  overlay.className = "popup-archivo-foto-lightbox oculto";
  overlay.innerHTML = `
    <div class="popup-archivo-foto-lightbox-backdrop" onclick="cerrarVisorFotoArchivo()"></div>
    <div class="popup-archivo-foto-lightbox-panel" role="dialog" aria-modal="true" aria-labelledby="popupArchivoFotoLightboxTitulo">
      <div class="popup-archivo-foto-lightbox-head">
        <span id="popupArchivoFotoLightboxTitulo">Fotografía</span>
        <button type="button" class="popup-archivo-foto-lightbox-cerrar" onclick="cerrarVisorFotoArchivo()" title="Cerrar">×</button>
      </div>
      <div class="popup-archivo-foto-lightbox-body">
        <img id="popupArchivoFotoLightboxImg" alt="">
      </div>
    </div>`;
  document.body.appendChild(overlay);
  if (!window.__popupArchivoFotoLightboxEsc) {
    window.__popupArchivoFotoLightboxEsc = true;
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") cerrarVisorFotoArchivo();
    });
  }
  return overlay;
}

function abrirVisorFotoArchivo(url, titulo) {
  if (!url) return;
  const overlay = asegurarVisorFotoArchivoOverlay();
  const img = document.getElementById("popupArchivoFotoLightboxImg");
  const tituloEl = document.getElementById("popupArchivoFotoLightboxTitulo");
  if (img) {
    img.src = url;
    img.alt = titulo || "Fotografía del predio";
  }
  if (tituloEl) tituloEl.textContent = titulo || "Fotografía";
  overlay.classList.remove("oculto");
  document.body.classList.add("popup-archivo-foto-lightbox-abierto");
}

function cerrarVisorFotoArchivo() {
  const overlay = document.getElementById("popupArchivoFotoLightbox");
  if (!overlay) return;
  overlay.classList.add("oculto");
  document.body.classList.remove("popup-archivo-foto-lightbox-abierto");
  const img = document.getElementById("popupArchivoFotoLightboxImg");
  if (img) img.removeAttribute("src");
}

function mensajeErrorFotoArchivo(r, data, fallback) {
  if (r && r.status === 404) {
    return "El servicio de fotografías no está activo en el servidor. Suba routers/expediente.py y reinicie la API (uvicorn).";
  }
  if (r && r.status === 401) return "Sesión expirada. Vuelva a iniciar sesión.";
  if (r && r.status === 403) return "No tiene permisos para gestionar fotografías del expediente.";
  return typeof extraerMensajeApi === "function" ? extraerMensajeApi(data, fallback) : (data?.detail || fallback);
}

async function cargarFotografiasArchivo(claveNorm, p) {
  popupArchivoClaveActual = claveNorm;
  try {
    const r = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}/fotografias`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (r.status === 404) {
      actualizarPopupArchivoFotosNota([], p, "Servicio de fotografías no desplegado en la API. Contacte al administrador.");
      return;
    }
    if (!r.ok) {
      actualizarPopupArchivoFotosNota([], p, mensajeErrorFotoArchivo(r, await r.json().catch(() => ({})), "No se pudieron cargar las fotografías."));
      return;
    }
    const data = await r.json();
    const mapa = {};
    (data.fotografias || []).forEach(function(foto) {
      if (foto?.slot) mapa[foto.slot] = foto;
    });
    POPUP_FOTOS_SLOTS.forEach(function(def) {
      pintarCeldaFotoArchivo(claveNorm, def.slot, mapa[def.slot] || null);
    });
    actualizarPopupArchivoFotosNota(data.fotografias || [], p);
  } catch (e) {
    actualizarPopupArchivoFotosNota([], p);
  }
}

function seleccionarFotoArchivo(slot) {
  if (!puedeGestionarFotosArchivo()) {
    alert("No tiene permisos para cargar fotografías.");
    return;
  }
  document.getElementById(`popupFotoInput_${slot}`)?.click();
}

async function subirFotoArchivo(slot, input) {
  if (!puedeGestionarFotosArchivo()) {
    alert("No tiene permisos para cargar fotografías.");
    return;
  }
  const claveNorm = popupArchivoClaveActual;
  const archivo = input?.files?.[0];
  if (!claveNorm || !archivo) return;

  const form = new FormData();
  form.append("slot", slot);
  form.append("archivo", archivo);

  const btn = document.querySelector(`#popupFotoCelda_${slot} .popup-archivo-foto-btn`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Subiendo…";
  }

  try {
    const r = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}/fotografias`, {
      method: "POST",
      headers: authUploadHeadersArchivo(),
      body: form
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(mensajeErrorFotoArchivo(r, data, "No se pudo subir la fotografía"));
    }
    await cargarFotografiasArchivo(claveNorm, window.predioSeleccionado || {});
  } catch (e) {
    alert(e.message || "No se pudo subir la fotografía.");
  } finally {
    if (input) input.value = "";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Subir";
    }
  }
}

async function eliminarFotoArchivo(slot) {
  if (!puedeGestionarFotosArchivo()) {
    alert("No tiene permisos para borrar fotografías.");
    return;
  }
  const claveNorm = popupArchivoClaveActual;
  const media = document.getElementById(`popupFotoMedia_${slot}`);
  const idDocumento = media?.dataset?.idDocumento;
  if (!claveNorm || !idDocumento) return;
  if (!confirm("¿Eliminar esta fotografía del expediente?")) return;

  try {
    const r = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}/fotografias/${encodeURIComponent(idDocumento)}`, {
      method: "DELETE",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(mensajeErrorFotoArchivo(r, data, "No se pudo eliminar la fotografía"));
    }
    await cargarFotografiasArchivo(claveNorm, window.predioSeleccionado || {});
  } catch (e) {
    alert(e.message || "No se pudo eliminar la fotografía.");
  }
}

async function pintarPopupTabArchivo(clave, p) {
  const panel = document.getElementById("popupTabArchivo");
  if (!panel) return;

  const claveNorm = String(clave || p?.clave_catastral || "").trim().toUpperCase();
  if (!claveNorm) {
    panel.innerHTML = `
      <div class="popup-placeholder-modulo">
        <strong>Sin clave catastral</strong>
        <p>Seleccione un predio en el mapa o en la búsqueda.</p>
      </div>`;
    return;
  }

  const urlExt = typeof urlExpedienteExterno === "function"
    ? urlExpedienteExterno(claveNorm)
    : urlArchivoDigitalExterno(claveNorm);
  popupArchivoClaveActual = claveNorm;

  panel.innerHTML = `
    <div class="popup-archivo-layout">
      <section class="popup-archivo-panel popup-archivo-externo">
        <header class="popup-archivo-head">
          <span>Archivo digital externo</span>
          <a class="popup-archivo-link-externo" href="${popupEsc(urlExt)}" target="_blank" rel="noopener noreferrer">Abrir en nueva pestaña</a>
        </header>
        <div class="popup-archivo-iframe-wrap">
          <iframe id="popupArchivoDigitalExternoFrame" class="popup-archivo-iframe" title="Archivo digital ${popupEsc(claveNorm)}" src="${popupEsc(urlExt)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
        </div>
        <div class="popup-archivo-clave-ref">Clave catastral: <b>${popupEsc(claveNorm)}</b></div>
      </section>
      <section class="popup-archivo-panel popup-archivo-fotos">
        <header class="popup-archivo-head"><span>Fotografías e inspección</span></header>
        <div class="popup-archivo-fotos-grid" id="popupArchivoFotosGrid">
          ${htmlPopupArchivoFotosGrid(claveNorm)}
        </div>
        <p class="popup-archivo-fotos-nota" id="popupArchivoFotosNota">Cargando fotografías…</p>
      </section>
    </div>`;

  await cargarFotografiasArchivo(claveNorm, p);
}

async function pintarPopupPredioTab(tabId, p) {
  const tabAnterior = popupPredioTabActiva;
  popupPredioTabActiva = tabId;
  if (tabAnterior === "construcciones" && tabId !== "construcciones") {
    if (typeof destruirPopupConstruccionesMedicion === "function") destruirPopupConstruccionesMedicion();
  }
  if (tabAnterior === "numeros-oficiales" && tabId !== "numeros-oficiales") {
    if (typeof destruirPopupNumerosOficiales === "function") destruirPopupNumerosOficiales();
  }
  if (tabAnterior === "carta-urbana" && tabId !== "carta-urbana") {
    if (typeof destruirPopupCartaUrbana === "function") destruirPopupCartaUrbana();
  }
  if (tabAnterior === "colonia" && tabId !== "colonia") {
    if (typeof destruirPopupColonia === "function") destruirPopupColonia();
  }
  if (tabAnterior === "zona-homogenea" && tabId !== "zona-homogenea") {
    if (typeof destruirPopupZonaHomogenea === "function") destruirPopupZonaHomogenea();
  }
  if (tabAnterior === "documento-rppc" && tabId !== "documento-rppc") {
    if (typeof destruirPopupRppc === "function") destruirPopupRppc();
  }
  document.querySelectorAll(".popup-predio-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".popup-tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.tab === tabId);
  });

  const clave = String(p?.clave_catastral || claveSeleccionadaActual || "").trim().toUpperCase();
  if (tabId === "datos-generales") await pintarPopupTabDatosGenerales(p);
  else if (tabId === "construcciones") {
    if (typeof pintarPopupTabConstrucciones === "function") {
      await pintarPopupTabConstrucciones(p);
    } else {
      pintarPopupTabPlaceholder("popupTabConstrucciones", "Construcciones / Medidas",
        "Cuadro de construcción, medición de vértices y edición cartográfica — módulo en desarrollo.");
    }
  }   else if (tabId === "archivo") await pintarPopupTabArchivo(clave, p);
  else if (tabId === "documento-rppc") {
    if (typeof pintarPopupTabRppc === "function") {
      await pintarPopupTabRppc(clave, p);
    } else {
      pintarPopupTabPlaceholder("popupTabDocumentoRppc", "Documento RPPC",
        "Visor del Registro Público de la Propiedad — recargue la página con Ctrl+F5.");
    }
  }
  else if (tabId === "numeros-oficiales") {
    if (typeof pintarPopupTabNumerosOficiales === "function") {
      await pintarPopupTabNumerosOficiales(p);
    } else {
      pintarPopupTabPlaceholder("popupTabNumerosOficiales", "Números Oficiales",
        "Mapa de colindantes y números oficiales cercanos — recargue la página con Ctrl+F5.");
    }
  }
  else if (tabId === "carta-urbana") {
    if (typeof pintarPopupTabCartaUrbana === "function") {
      await pintarPopupTabCartaUrbana(p);
    } else {
      pintarPopupTabPlaceholder("popupTabCartaUrbana", "Carta Urbana 2040",
        "Consulta de zonificación 2040 — recargue la página con Ctrl+F5.");
    }
  } else if (tabId === "colonia") {
    if (typeof pintarPopupTabColonia === "function") {
      await pintarPopupTabColonia(p);
    } else {
      pintarPopupTabPlaceholder("popupTabColonia", "Colonia/Fraccionamiento",
        "Ubicación del predio respecto al límite de colonia — recargue con Ctrl+F5.");
    }
  } else if (tabId === "zona-homogenea") {
    if (typeof pintarPopupTabZonaHomogenea === "function") {
      await pintarPopupTabZonaHomogenea(p);
    } else {
      pintarPopupTabPlaceholder("popupTabZonaHomogenea", "Zona Homogénea",
        "Consulta de zona homogénea y evolución de valores — recargue con Ctrl+F5.");
    }
  }
}

function tabIdToDomId(tabId) {
  return tabId.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

function capturarPopupMiniMapParaPDF() {
  if (typeof capturarMapaOlParaPDF !== "function" || !popupMiniMap) return Promise.resolve(null);
  try {
    popupMiniMap.updateSize();
    popupMiniMap.renderSync();
  } catch (e) {}
  return capturarMapaOlParaPDF(popupMiniMap, 3500);
}

async function generarFichaCatastralGeneral() {
  if (typeof abrirVentanaFichaCatastralGeneral === "function") {
    return abrirVentanaFichaCatastralGeneral();
  }
  if (typeof abrirPreviewFichaCatastralGeneral === "function") {
    return abrirPreviewFichaCatastralGeneral();
  }
  alert("El generador de ficha no está disponible. Recargue la página con Ctrl+F5.");
}

function mostrarPopupPredioTab(tabId) {
  const p = window.predioSeleccionado || {};
  pintarPopupPredioTab(tabId, p);
}

async function abrirPopupPredioWorkspace(ficha) {
  if (!enModoGestionCatastral()) return;

  const p = ficha || window.predioSeleccionado || {};
  const overlay = document.getElementById("popupPredioWorkspace");
  if (!overlay) return;

  if (typeof cerrarFichaFlotante === "function") cerrarFichaFlotante();

  overlay.classList.remove("oculto");
  document.body.classList.add("popup-predio-abierto");
  actualizarPopupPredioHeader(p);
  await pintarPopupPredioTab("datos-generales", p);

  if (typeof map !== "undefined" && map) {
    setTimeout(() => map.updateSize(), 200);
  }
}

function cerrarPopupPredioWorkspace() {
  if (typeof destruirPopupRppc === "function") destruirPopupRppc();
  document.getElementById("popupPredioWorkspace")?.classList.add("oculto");
  document.body.classList.remove("popup-predio-abierto");
  destruirPopupMiniMap();
  if (typeof destruirPopupConstruccionesMedicion === "function") destruirPopupConstruccionesMedicion();
  if (typeof destruirPopupNumerosOficiales === "function") destruirPopupNumerosOficiales();
  if (typeof destruirPopupCartaUrbana === "function") destruirPopupCartaUrbana();
  if (typeof destruirPopupColonia === "function") destruirPopupColonia();
  if (typeof destruirPopupZonaHomogenea === "function") destruirPopupZonaHomogenea();
}

async function navegarPopupPredio(delta) {
  const claves = obtenerListaPrediosPopupNavegacion();
  if (claves.length < 2) return;
  let idx = popupPredioIndiceActual >= 0 ? popupPredioIndiceActual : 0;
  idx = (idx + delta + claves.length) % claves.length;
  const clave = claves[idx];
  if (typeof seleccionarPorClave === "function") {
    await seleccionarPorClave(clave, "popup-nav");
  }
}

function engancharPortalModulos() {
  if (typeof abrirFichaFlotante === "function" && !window.__abrirFichaFlotantePortal) {
    window.__abrirFichaFlotantePortal = abrirFichaFlotante;
    abrirFichaFlotante = function() {
      if (enModoGestionCatastral()) return;
      return window.__abrirFichaFlotantePortal();
    };
  }
}

window.urlArchivoDigitalExterno = urlArchivoDigitalExterno;
window.seleccionarFotoArchivo = seleccionarFotoArchivo;
window.subirFotoArchivo = subirFotoArchivo;
window.eliminarFotoArchivo = eliminarFotoArchivo;
window.abrirVisorFotoArchivo = abrirVisorFotoArchivo;
window.cerrarVisorFotoArchivo = cerrarVisorFotoArchivo;
window.mostrarSelectorModulos = mostrarSelectorModulos;
window.entrarModuloPortal = entrarModuloPortal;
window.volverSelectorModulos = volverSelectorModulos;
window.enModoGestionCatastral = enModoGestionCatastral;
window.abrirPopupPredioWorkspace = abrirPopupPredioWorkspace;
window.cerrarPopupPredioWorkspace = cerrarPopupPredioWorkspace;
window.mostrarPopupPredioTab = mostrarPopupPredioTab;
window.navegarPopupPredio = navegarPopupPredio;
window.capturarPopupMiniMapParaPDF = capturarPopupMiniMapParaPDF;
window.generarFichaCatastralGeneral = generarFichaCatastralGeneral;
window.togglePopupMiniCapasMenu = togglePopupMiniCapasMenu;
window.popupMiniCambiarOpacidadCapa = popupMiniCambiarOpacidadCapa;
window.popupMiniSubirCapa = popupMiniSubirCapa;
window.popupMiniBajarCapa = popupMiniBajarCapa;
window.setPopupMiniBaseLayer = setPopupMiniBaseLayer;
window.togglePopupMiniCapa = togglePopupMiniCapa;
window.mostrarPopupSubTabTitularidad = mostrarPopupSubTabTitularidad;

document.addEventListener("DOMContentLoaded", engancharPortalModulos);
setTimeout(engancharPortalModulos, 0);
