
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
    modulos: data.modulos || [],
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
      rol: data.rol,
      modulos: data.modulos || []
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
  if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
  document.getElementById("selectorModulosOverlay")?.classList.add("oculto");
  document.getElementById("appInstitucional")?.classList.add("oculto");
  document.body.classList.remove("portal-modulo-activo", "modo-gestion-catastral", "modo-portal-completo", "popup-predio-abierto");
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
