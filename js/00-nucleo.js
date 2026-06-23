
/* --- v21: Login institucional JWT --- */
const TOKEN_KEY_CATASTRO = "catastro_bc_token";
const USER_KEY_CATASTRO = "catastro_bc_usuario";
const SESION_INACTIVIDAD_MIN_DEFAULT = 15;
let sesionInactividadTimer = null;
let sesionExpulsando = false;

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

function obtenerPermisosSesion() {
  const u = obtenerUsuarioSesion();
  return Array.isArray(u?.permisos) ? u.permisos : [];
}

function _fallbackPermisoPorRol(codigo) {
  const rol = String(obtenerRolSesion()).trim().toLowerCase();
  const mapa = {
    editar_catastro: ["admin", "supervisor", "catastro"],
    editar_titularidad: ["admin", "supervisor", "catastro"],
    editar_nombre_contribuyente: ["admin", "supervisor", "catastro"],
    solicitar_movimientos: ["admin", "supervisor", "catastro"],
    aplicar_movimientos: ["admin", "supervisor"],
    gestionar_marca_agua: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion"],
    ver_pestana_archivo: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion"],
    ver_pestana_control_urbano: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion"],
    ver_pestana_rppc: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion"],
    ver_pestana_zona_homogenea: ["admin", "supervisor", "catastro", "cartografia", "fiscalizacion"],
  };
  return (mapa[codigo] || []).includes(rol);
}

function tienePermiso(codigo) {
  const permiso = String(codigo || "").trim().toLowerCase();
  if (!permiso) return false;
  const perms = obtenerPermisosSesion();
  if (perms.includes(permiso)) return true;
  return _fallbackPermisoPorRol(permiso);
}

function puedeEditarCatastro(rol) {
  if (typeof rol === "string" && rol.trim()) {
    return tienePermiso("editar_catastro") || _fallbackPermisoPorRol("editar_catastro");
  }
  return tienePermiso("editar_catastro");
}

function puedeEditarTitularidad() {
  return tienePermiso("editar_titularidad");
}

function puedeEditarNombreContribuyente() {
  return tienePermiso("editar_nombre_contribuyente");
}

function puedeSolicitarMovimientos() {
  return tienePermiso("solicitar_movimientos");
}

function puedeAplicarMovimientos() {
  return tienePermiso("aplicar_movimientos");
}

function puedeGestionarMarcaAguaDocumento() {
  return tienePermiso("gestionar_marca_agua");
}

function esRolConsultaInstitucional() {
  return String(obtenerRolSesion()).trim().toLowerCase() === "consulta";
}

window.esRolConsultaInstitucional = esRolConsultaInstitucional;

function permisoPestanaPopupPredio(tabId) {
  const mapa = {
    archivo: "ver_pestana_archivo",
    "control-urbano": "ver_pestana_control_urbano",
    "documento-rppc": "ver_pestana_rppc",
    "zona-homogenea": "ver_pestana_zona_homogenea"
  };
  return mapa[String(tabId || "").trim()] || "";
}

function puedeVerPestanaPopupPredio(tabId) {
  const tab = String(tabId || "").trim();
  if (tab === "zona-homogenea") return puedeVerDatosZonaHomogenea();
  const permiso = permisoPestanaPopupPredio(tabId);
  if (!permiso) return true;
  return tienePermiso(permiso);
}

function puedeVerDatosZonaHomogenea() {
  if (esRolConsultaInstitucional()) return false;
  return tienePermiso("ver_pestana_zona_homogenea");
}

window.puedeVerDatosZonaHomogenea = puedeVerDatosZonaHomogenea;

function guardarSesionInstitucional(data) {
  localStorage.setItem(TOKEN_KEY_CATASTRO, data.access_token);
  localStorage.setItem(USER_KEY_CATASTRO, JSON.stringify({
    usuario: data.usuario,
    nombre: data.nombre,
    rol: data.rol,
    permisos: data.permisos || [],
    modulos: data.modulos || [],
    expira_minutos: data.expira_minutos,
    inactividad_minutos: data.inactividad_minutos || SESION_INACTIVIDAD_MIN_DEFAULT
  }));
}

function obtenerInactividadSesionMs() {
  const mins = Number(obtenerUsuarioSesion()?.inactividad_minutos);
  if (mins > 0) return mins * 60 * 1000;
  return SESION_INACTIVIDAD_MIN_DEFAULT * 60 * 1000;
}

function _throttleSesion(fn, waitMs) {
  let ultimo = 0;
  return function throttled() {
    const ahora = Date.now();
    if (ahora - ultimo < waitMs) return;
    ultimo = ahora;
    fn();
  };
}

let sesionUltimaActividadMs = 0;

function registrarActividadSesion() {
  if (!obtenerTokenInstitucional()) return;
  sesionUltimaActividadMs = Date.now();
  reprogramarTimerInactividadSesion();
}

function reprogramarTimerInactividadSesion() {
  clearTimeout(sesionInactividadTimer);
  if (!obtenerTokenInstitucional()) return;
  sesionInactividadTimer = setTimeout(verificarInactividadSesion, obtenerInactividadSesionMs());
}

function verificarInactividadSesion() {
  if (!obtenerTokenInstitucional()) return;
  const limite = obtenerInactividadSesionMs();
  if (Date.now() - sesionUltimaActividadMs < limite - 1000) {
    reprogramarTimerInactividadSesion();
    return;
  }
  const mins = Math.round(limite / 60000);
  expulsarSesionInstitucional(`Su sesión se cerró por inactividad (${mins} minutos). Vuelva a iniciar sesión.`);
}

function iniciarControlInactividadSesion() {
  detenerControlInactividadSesion();
  const marcar = _throttleSesion(registrarActividadSesion, 20000);
  const eventos = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click"];
  eventos.forEach(function(ev) {
    document.addEventListener(ev, marcar, { passive: true });
  });
  window.__sesionInactividadMarcar = marcar;
  window.__sesionInactividadEventos = eventos;
  document.addEventListener("visibilitychange", onVisibilidadPestanaSesion);
  registrarActividadSesion();
}

function onVisibilidadPestanaSesion() {
  if (document.visibilityState === "visible" && obtenerTokenInstitucional()) {
    validarSesionInstitucional({ silencioso: true });
  }
}

function detenerControlInactividadSesion() {
  clearTimeout(sesionInactividadTimer);
  sesionInactividadTimer = null;
  if (window.__sesionInactividadMarcar && window.__sesionInactividadEventos) {
    window.__sesionInactividadEventos.forEach(function(ev) {
      document.removeEventListener(ev, window.__sesionInactividadMarcar);
    });
  }
  window.__sesionInactividadMarcar = null;
  window.__sesionInactividadEventos = null;
  document.removeEventListener("visibilitychange", onVisibilidadPestanaSesion);
}

async function cerrarSesionEnServidor() {
  const token = obtenerTokenInstitucional();
  if (!token) return;
  try {
    await fetch(`${API}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (e) {
    console.warn("No se pudo cerrar sesión en servidor:", e);
  }
}

async function expulsarSesionInstitucional(mensaje) {
  if (sesionExpulsando) return;
  sesionExpulsando = true;
  try {
    detenerControlInactividadSesion();
    await cerrarSesionEnServidor();
    if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
    document.getElementById("selectorModulosOverlay")?.classList.add("oculto");
    document.getElementById("appInstitucional")?.classList.add("oculto");
    document.body.classList.remove("portal-modulo-activo", "modo-gestion-catastral", "modo-portal-completo", "popup-predio-abierto");
    limpiarSesionInstitucional();
    mostrarLoginInstitucional();
    if (mensaje) setLoginMensaje(mensaje, "error");
  } finally {
    sesionExpulsando = false;
  }
}

function instalarInterceptorSesion401() {
  if (window.__sesionFetchInterceptor) return;
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function fetchConSesion(url, options) {
    const resp = await fetchOriginal(url, options);
    if (resp.status !== 401 || !obtenerTokenInstitucional() || sesionExpulsando) return resp;
    const urlStr = String(url || "");
    if (urlStr.includes("/login") || urlStr.includes("/logout") || urlStr.includes("/me")) return resp;
    let usaBearer = false;
    const headers = options?.headers;
    if (headers instanceof Headers) {
      usaBearer = (headers.get("Authorization") || "").includes("Bearer");
    } else if (headers && typeof headers === "object") {
      const auth = headers.Authorization || headers.authorization || "";
      usaBearer = String(auth).includes("Bearer");
    }
    if (!usaBearer) return resp;

    const token = obtenerTokenInstitucional();
    try {
      const check = await fetchOriginal(`${API}/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (check.ok) return resp;
    } catch (e) { /* confirmar cierre abajo */ }

    let detalle = "Su sesión ya no es válida. Vuelva a iniciar sesión.";
    try {
      const clon = resp.clone();
      const data = await clon.json();
      if (data?.detail) detalle = typeof data.detail === "string" ? data.detail : detalle;
    } catch (e) { /* ignore */ }
    expulsarSesionInstitucional(detalle);
    return resp;
  };
  window.__sesionFetchInterceptor = true;
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
  document.getElementById("selectorModulosOverlay")?.classList.add("oculto");
  document.body.classList.remove("portal-institucional-activo", "portal-modulo-activo", "modo-gestion-catastral", "modo-portal-completo", "popup-predio-abierto");
}

function mostrarSistemaInstitucional(usuario) {
  const overlay = document.getElementById("loginOverlay");
  const barra = document.getElementById("barraSesion");

  if (overlay) overlay.classList.add("oculto");
  document.body.classList.add("portal-institucional-activo");

  if (barra) {
    barra.classList.remove("oculto");
    document.getElementById("sesionNombre").innerText = usuario?.nombre || usuario?.usuario || "Usuario";
    document.getElementById("sesionRol").innerText = usuario?.rol ? `Rol: ${usuario.rol}` : "";
  }

  aplicarPermisosVisuales(usuario?.rol || "consulta");
  iniciarRelojInstitucional();
  iniciarControlInactividadSesion();

  if (typeof mostrarSelectorModulos === "function") {
    mostrarSelectorModulos(usuario);
    return;
  }

  const app = document.getElementById("appInstitucional");
  if (app) app.classList.remove("oculto");
  actualizarBreadcrumbModulo("tabConsulta");
  _iniciarDashboardsPostLogin(usuario);
  actualizarLeyendaDinamica();
  if (document.getElementById("chkLeyenda")?.checked !== false) {
    aplicarVisibilidadLeyendaIntegrada(true);
  }
  actualizarLayoutPrincipal();
}

function _iniciarDashboardsPostLogin(usuario) {
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

async function validarSesionInstitucional(opciones) {
  opciones = opciones || {};
  const token = obtenerTokenInstitucional();

  if (!token) {
    if (!opciones.silencioso) mostrarLoginInstitucional();
    return false;
  }

  try {
    const r = await fetch(`${API}/me`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!r.ok) {
      let detalle = "Sesión expirada";
      try {
        const err = await r.json();
        if (err?.detail) detalle = typeof err.detail === "string" ? err.detail : detalle;
      } catch (e) { /* ignore */ }
      throw new Error(detalle);
    }

    const data = await r.json();

    const usuario = {
      usuario: data.usuario,
      nombre: data.nombre,
      rol: data.rol,
      permisos: data.permisos || [],
      modulos: data.modulos || [],
      inactividad_minutos: data.inactividad_minutos || SESION_INACTIVIDAD_MIN_DEFAULT
    };

    localStorage.setItem(USER_KEY_CATASTRO, JSON.stringify(usuario));
    if (!opciones.silencioso) {
      mostrarSistemaInstitucional(usuario);
    } else {
      registrarActividadSesion();
    }
    return true;

  } catch (e) {
    console.warn("Sesión inválida:", e);
    await expulsarSesionInstitucional(e.message || "Sesión expirada. Vuelva a iniciar sesión.");
    return false;
  }
}

async function cerrarSesionInstitucional() {
  if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
  document.getElementById("selectorModulosOverlay")?.classList.add("oculto");
  document.getElementById("appInstitucional")?.classList.add("oculto");
  document.body.classList.remove("portal-modulo-activo", "modo-gestion-catastral", "modo-portal-completo", "popup-predio-abierto");
  detenerControlInactividadSesion();
  await cerrarSesionEnServidor();
  limpiarSesionInstitucional();
  mostrarLoginInstitucional();
}

function aplicarPermisosVisuales(rol) {
  const rolNorm = String(rol || "").trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  const puedeHerramientas = ["admin", "cartografia", "catastro", "supervisor"].includes(rolNorm);
  const puedeEditarCatastroRol = typeof puedeEditarCatastro === "function" && puedeEditarCatastro();
  const puedeMovimientosRol = (typeof puedeSolicitarMovimientos === "function" && puedeSolicitarMovimientos())
    || (typeof puedeAplicarMovimientos === "function" && puedeAplicarMovimientos());

  document.querySelectorAll(".solo-admin").forEach(el => {
    el.style.display = esAdmin ? "" : "none";
  });

  document.querySelectorAll(".requiere-herramientas").forEach(el => {
    el.style.display = puedeHerramientas ? "" : "none";
  });

  document.querySelectorAll(".requiere-movimientos").forEach(el => {
    el.style.display = puedeMovimientosRol ? "" : "none";
  });

  document.querySelectorAll(".perm-editar-cartografia").forEach(el => {
    const puedeCarto = ["admin", "supervisor", "cartografia"].includes(rolNorm);
    el.style.display = puedeCarto ? "" : "none";
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

  if (typeof aplicarVisibilidadPestanasPopupPredio === "function") {
    aplicarVisibilidadPestanasPopupPredio();
  }
}

function prepararEventosLoginInstitucional() {
  instalarInterceptorSesion401();
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
  colonias: 50,
  codigos: 25,
  auditoria: 70
};

/* --- Utilidades transversales (extraidas de modulos posteriores) --- */

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
function authHeaders() {
  const token = (typeof obtenerTokenInstitucional === 'function') ? obtenerTokenInstitucional() : (localStorage.getItem('catastro_bc_token') || '');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}
window.authHeaders = authHeaders;
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
