/* Administración del Sistema — módulo desplegable (usuarios, permisos con vigencia, auditoría) */

let adminUsuariosCache = [];
let adminModulosCache = [];
let adminAccesosCache = [];
let adminSeccionActiva = "usuarios";
let adminAclRoles = [];
let adminAclPermisos = [];
let adminAclRolEditId = "";

const ADMIN_ROLES = ["consulta", "catastro", "cartografia", "fiscalizacion", "supervisor", "admin"];

const ADMIN_MODULOS_FALLBACK = [
  { id: "gestion-catastral", titulo: "Gestión Catastral" },
  { id: "movimientos", titulo: "Movimientos Catastrales" },
  { id: "zonas-homogeneas", titulo: "Análisis de Zonas Homogéneas" },
  { id: "condominios", titulo: "Régimen en Condominio" },
  { id: "modulo-cartografico", titulo: "Módulo Cartográfico" },
  { id: "administracion", titulo: "Administración del Sistema" },
  { id: "portal-completo", titulo: "Portal Integral (vista clásica)" }
];

function obtenerCatalogoModulosAdmin() {
  if (adminModulosCache && adminModulosCache.length) return adminModulosCache;
  if (typeof MODULOS_PORTAL_DEF !== "undefined" && MODULOS_PORTAL_DEF.length) {
    return MODULOS_PORTAL_DEF.map(function(m) {
      return { id: m.id, titulo: m.titulo, descripcion: m.descripcion || "" };
    });
  }
  return ADMIN_MODULOS_FALLBACK.slice();
}

function adminDetalleErrorApi(err, contexto) {
  const msg = String(err || "").trim();
  if (msg === "Not Found" || msg === "Not found") {
    return "El servidor no tiene la ruta " + contexto + ". Suba routers/admin.py, auth/accesos_modulo.py y reinicie catastro-api.";
  }
  return msg || "Error de consulta";
}

function setAdminMensaje(texto, tipo) {
  const el = document.getElementById("adminMensaje");
  if (!el) return;
  el.innerText = texto || "";
  el.className = "admin-mensaje " + (tipo || "");
}

function setAdminMensajeMatriz(texto, tipo) {
  const el = document.getElementById("adminMensajeMatriz");
  if (!el) return;
  el.innerText = texto || "";
  el.className = "admin-mensaje " + (tipo || "");
}

function setAdminMensajeAccesos(texto, tipo) {
  const el = document.getElementById("adminMensajeAccesos");
  if (!el) return;
  el.innerText = texto || "";
  el.className = "admin-mensaje " + (tipo || "");
}

async function fetchAdmin(url, options) {
  options = options || {};
  const token = typeof obtenerTokenInstitucional === "function" ? obtenerTokenInstitucional() : "";
  const headers = Object.assign(
    { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    options.headers || {}
  );
  return fetch(API + url, Object.assign({}, options, { headers: headers }));
}

function formatearFechaAdmin(fecha) {
  if (!fecha) return "—";
  try {
    return new Date(fecha).toLocaleString("es-MX");
  } catch (e) {
    return String(fecha);
  }
}

function formatearFechaCortaAdmin(fecha) {
  if (!fecha) return "Permanente";
  const raw = String(fecha);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("es-MX");
  }
  try {
    return new Date(fecha).toLocaleDateString("es-MX", { timeZone: "America/Tijuana" });
  } catch (e) {
    return raw;
  }
}

function badgeEstadoAcceso(estado, vigente) {
  const st = String(estado || "").toLowerCase();
  if (st === "negado") return '<span class="badge-acceso-negado">NEGADO</span>';
  if (st === "vencido" || vigente === false) return '<span class="badge-acceso-vencido">VENCIDO</span>';
  return '<span class="badge-acceso-activo">ACTIVO</span>';
}

function tituloModuloAdmin(moduloId) {
  const m = adminModulosCache.find(function(x) { return x.id === moduloId; })
    || (typeof MODULOS_PORTAL_DEF !== "undefined" ? MODULOS_PORTAL_DEF.find(function(x) { return x.id === moduloId; }) : null);
  return m ? m.titulo : moduloId;
}

function abrirModuloAdministracion() {
  document.getElementById("overlayAdministracion")?.classList.remove("oculto");
  document.body.classList.add("admin-modulo-activo");
  adminSeccionActiva = "usuarios";
  llenarSelectModulosAdmin();
  adminCambiarSeccion("usuarios");
  cargarModuloAdministracion();
}
window.abrirModuloAdministracion = abrirModuloAdministracion;

function cerrarModuloAdministracion() {
  document.getElementById("overlayAdministracion")?.classList.add("oculto");
  document.body.classList.remove("admin-modulo-activo");
  if (typeof volverSelectorModulos === "function") {
    volverSelectorModulos();
  }
}
window.cerrarModuloAdministracion = cerrarModuloAdministracion;

function adminCambiarSeccion(seccion) {
  adminSeccionActiva = seccion;
  document.querySelectorAll(".overlay-admin-tabs button").forEach(function(btn) {
    btn.classList.toggle("activo", btn.dataset.seccion === seccion);
  });
  document.querySelectorAll(".admin-seccion").forEach(function(el) {
    el.classList.toggle("oculto", el.dataset.seccion !== seccion);
  });
  if (seccion === "permisos") {
    cargarModulosSistemaAdmin();
    llenarSelectUsuariosAccesos();
    cargarAccesosAdmin();
  }
  if (seccion === "matriz") cargarMatrizPermisosAdmin();
  if (seccion === "auditoria") cargarAuditoriaAdmin();
}
window.adminCambiarSeccion = adminCambiarSeccion;

async function cargarModuloAdministracion() {
  await Promise.all([
    cargarModulosSistemaAdmin(),
    cargarUsuariosAdmin(),
    cargarAccesosAdmin(),
    cargarMatrizPermisosAdmin()
  ]);
}

async function cargarModulosSistemaAdmin() {
  try {
    const r = await fetchAdmin("/admin/modulos");
    if (r.ok) {
      const data = await r.json();
      adminModulosCache = data.modulos || [];
    } else {
      adminModulosCache = [];
      console.warn("Admin modulos HTTP", r.status);
    }
  } catch (e) {
    adminModulosCache = [];
    console.warn("Admin modulos:", e);
  }
  llenarSelectModulosAdmin();
}

function llenarSelectModulosAdmin() {
  const catalogo = obtenerCatalogoModulosAdmin();
  const sel = document.getElementById("adminAccesoModulo");
  const filtro = document.getElementById("adminFiltroModuloAccesos");
  const opts = '<option value="">Seleccione módulo…</option>' + catalogo.map(function(m) {
    return '<option value="' + m.id + '">' + m.titulo + "</option>";
  }).join("");
  if (sel) {
    const val = sel.value;
    sel.innerHTML = opts;
    if (val && Array.from(sel.options).some(function(o) { return o.value === val; })) sel.value = val;
  }
  if (filtro) {
    const valF = filtro.value;
    filtro.innerHTML = '<option value="">Todos los módulos</option>' + catalogo.map(function(m) {
      return '<option value="' + m.id + '">' + m.titulo + "</option>";
    }).join("");
    if (valF) filtro.value = valF;
  }
}

async function cargarUsuariosAdmin() {
  const cont = document.getElementById("adminUsuariosTabla");
  if (!cont) return;
  cont.innerHTML = "<div style='padding:10px;'>Cargando usuarios...</div>";
  try {
    const r = await fetchAdmin("/admin/usuarios");
    if (!r.ok) {
      const err = await r.json().catch(function() { return {}; });
      throw new Error(err.detail || "No se pudieron cargar usuarios");
    }
    const data = await r.json();
    adminUsuariosCache = data.usuarios || [];
    pintarUsuariosAdmin(adminUsuariosCache);
    llenarSelectUsuariosAccesos();
  } catch (e) {
    cont.innerHTML = '<div style="padding:10px;color:#991b1b;">' + e.message + "</div>";
  }
}

function llenarSelectUsuariosAccesos() {
  const sel = document.getElementById("adminAccesoUsuario");
  const filtro = document.getElementById("adminFiltroUsuarioAccesos");
  const optsUsuarios = adminUsuariosCache.map(function(u) {
    return '<option value="' + u.id + '">' + u.usuario + " · " + (u.nombre_completo || "") + "</option>";
  }).join("");
  if (sel) {
    const val = sel.value;
    sel.innerHTML = '<option value="">Seleccione usuario…</option>' + optsUsuarios;
    if (val && Array.from(sel.options).some(function(o) { return o.value === val; })) sel.value = val;
  }
  if (filtro) {
    const valF = filtro.value;
    filtro.innerHTML = '<option value="">Todos los usuarios</option>' + optsUsuarios;
    if (valF) filtro.value = valF;
  }
}

function filtrarUsuariosAdmin() {
  const filtro = (document.getElementById("adminFiltroUsuarios")?.value || "").toUpperCase();
  const filtrados = adminUsuariosCache.filter(function(u) {
    return Object.values(u).some(function(v) {
      return String(v ?? "").toUpperCase().includes(filtro);
    });
  });
  pintarUsuariosAdmin(filtrados);
}

function pintarUsuariosAdmin(usuarios) {
  const cont = document.getElementById("adminUsuariosTabla");
  if (!cont) return;
  const total = usuarios.length;
  const activos = usuarios.filter(function(u) { return u.activo; }).length;
  const setTxt = function(id, v) {
    const el = document.getElementById(id);
    if (el) el.innerText = Number(v || 0).toLocaleString("es-MX");
  };
  setTxt("adminTotalUsuarios", total);
  setTxt("adminUsuariosActivos", activos);
  setTxt("adminUsuariosInactivos", total - activos);

  if (!usuarios.length) {
    cont.innerHTML = "<div style='padding:10px;'>Sin usuarios.</div>";
    return;
  }

  let html = '<table class="admin-table"><thead><tr>'
    + "<th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th>"
    + "</tr></thead><tbody>";

  usuarios.forEach(function(u) {
    const estado = u.activo
      ? '<span class="badge-admin-activo">ACTIVO</span>'
      : '<span class="badge-admin-inactivo">INACTIVO</span>';
    const rol = u.rol_principal || (Array.isArray(u.roles) ? u.roles.join(", ") : "");
    html += "<tr>"
      + "<td><b>" + (u.usuario || "") + "</b></td>"
      + "<td>" + (u.nombre_completo || "") + "</td>"
      + "<td>" + rol + "</td>"
      + "<td>" + estado + "</td>"
      + "<td>" + formatearFechaAdmin(u.ultimo_acceso) + "</td>"
      + '<td><button type="button" onclick="editarUsuarioAdmin(' + u.id + ')">Editar</button>'
      + '<button type="button" class="sec" onclick="abrirPermisosUsuarioAdmin(' + u.id + ')">Permisos</button>'
      + '<button type="button" onclick="resetPasswordAdmin(' + u.id + ')">Reset</button>'
      + '<button type="button" class="' + (u.activo ? "danger" : "") + '" onclick="toggleActivoAdmin(' + u.id + ", " + (u.activo ? "true" : "false") + ')">'
      + (u.activo ? "Desactivar" : "Activar") + "</button></td></tr>";
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
}

function abrirPermisosUsuarioAdmin(usuarioId) {
  const sel = document.getElementById("adminAccesoUsuario");
  const filtro = document.getElementById("adminFiltroUsuarioAccesos");
  if (sel) sel.value = String(usuarioId);
  if (filtro) filtro.value = String(usuarioId);
  adminCambiarSeccion("permisos");
  filtrarAccesosAdmin();
}
window.abrirPermisosUsuarioAdmin = abrirPermisosUsuarioAdmin;

async function cargarAccesosAdmin() {
  const cont = document.getElementById("adminAccesosTabla");
  if (!cont) return;
  cont.innerHTML = "<div style='padding:10px;'>Cargando permisos...</div>";
  try {
    const r = await fetchAdmin("/admin/accesos");
    if (!r.ok) {
      const err = await r.json().catch(function() { return {}; });
      throw new Error(adminDetalleErrorApi(err.detail, "GET /admin/accesos"));
    }
    const data = await r.json();
    adminAccesosCache = data.accesos || [];
    filtrarAccesosAdmin();
    setTxtAccesosKpi();
  } catch (e) {
    cont.innerHTML = '<div style="padding:10px;color:#991b1b;">' + e.message + "</div>";
  }
}

function setTxtAccesosKpi() {
  const activos = adminAccesosCache.filter(function(a) { return a.estado === "activo" && a.vigente; }).length;
  const negados = adminAccesosCache.filter(function(a) { return a.estado === "negado"; }).length;
  const vencidos = adminAccesosCache.filter(function(a) {
    return a.estado === "vencido" || (a.estado === "activo" && !a.vigente);
  }).length;
  const setTxt = function(id, v) {
    const el = document.getElementById(id);
    if (el) el.innerText = String(v);
  };
  setTxt("adminAccesosActivos", activos);
  setTxt("adminAccesosNegados", negados);
  setTxt("adminAccesosVencidos", vencidos);
}

function filtrarAccesosAdmin() {
  const uid = document.getElementById("adminFiltroUsuarioAccesos")?.value || "";
  const mid = document.getElementById("adminFiltroModuloAccesos")?.value || "";
  let rows = adminAccesosCache.slice();
  if (uid) rows = rows.filter(function(a) { return String(a.usuario_id) === String(uid); });
  if (mid) rows = rows.filter(function(a) { return a.modulo_id === mid; });
  pintarAccesosAdmin(rows);
}
window.filtrarAccesosAdmin = filtrarAccesosAdmin;

function pintarAccesosAdmin(rows) {
  const cont = document.getElementById("adminAccesosTabla");
  if (!cont) return;
  if (!rows.length) {
    cont.innerHTML = "<div style='padding:10px;'>Sin permisos registrados para el filtro.</div>";
    return;
  }
  let html = '<table class="admin-table"><thead><tr>'
    + "<th>Usuario</th><th>Módulo</th><th>Inicio</th><th>Vence</th><th>Estado</th><th>Motivo</th><th>Acciones</th>"
    + "</tr></thead><tbody>";
  rows.forEach(function(a) {
    html += "<tr>"
      + "<td><b>" + (a.usuario || "") + "</b></td>"
      + "<td>" + tituloModuloAdmin(a.modulo_id) + "</td>"
      + "<td>" + formatearFechaCortaAdmin(a.fecha_inicio) + "</td>"
      + "<td>" + formatearFechaCortaAdmin(a.fecha_fin) + "</td>"
      + "<td>" + badgeEstadoAcceso(a.estado, a.vigente) + "</td>"
      + "<td>" + (a.motivo || "—") + "</td>"
      + "<td>"
      + '<button type="button" onclick="renovarAccesoAdmin(' + a.id + ')">Renovar</button>'
      + '<button type="button" class="sec" onclick="editarAccesoAdmin(' + a.id + ')">Cambiar</button>'
      + '<button type="button" class="danger" onclick="negarAccesoAdmin(' + a.id + ')">Negar</button>'
      + "</td></tr>";
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
}

async function crearAccesoAdmin() {
  const usuarioId = document.getElementById("adminAccesoUsuario")?.value;
  const moduloId = document.getElementById("adminAccesoModulo")?.value;
  const fechaInicio = document.getElementById("adminAccesoInicio")?.value || null;
  const fechaFin = document.getElementById("adminAccesoFin")?.value || null;
  const motivo = document.getElementById("adminAccesoMotivo")?.value.trim() || "";
  if (!usuarioId || !moduloId) {
    setAdminMensajeAccesos("Seleccione usuario y módulo en los listados.", "error");
    return;
  }
  try {
    const r = await fetchAdmin("/admin/usuarios/" + usuarioId + "/accesos", {
      method: "POST",
      body: JSON.stringify({
        modulo_id: moduloId,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin || null,
        motivo: motivo
      })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(adminDetalleErrorApi(data.detail, "POST /admin/usuarios/{id}/accesos"));
    setAdminMensajeAccesos("Permiso otorgado correctamente.", "ok");
    document.getElementById("adminAccesoMotivo").value = "";
    await cargarAccesosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeAccesos(e.message, "error");
  }
}
window.crearAccesoAdmin = crearAccesoAdmin;

async function renovarAccesoAdmin(accesoId) {
  const diasTxt = prompt("¿Cuántos días renovar?", "30");
  if (diasTxt === null) return;
  const dias = parseInt(diasTxt, 10);
  if (isNaN(dias) || dias < 1) {
    setAdminMensajeAccesos("Días no válidos.", "error");
    return;
  }
  const motivo = prompt("Motivo de renovación (opcional):", "") || "";
  try {
    const r = await fetchAdmin("/admin/accesos/" + accesoId + "/renovar", {
      method: "POST",
      body: JSON.stringify({ dias: dias, motivo: motivo })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo renovar");
    setAdminMensajeAccesos("Permiso renovado hasta " + formatearFechaCortaAdmin(data.fecha_fin) + ".", "ok");
    await cargarAccesosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeAccesos(e.message, "error");
  }
}
window.renovarAccesoAdmin = renovarAccesoAdmin;

async function negarAccesoAdmin(accesoId) {
  const motivo = prompt("Motivo para negar el acceso:", "Acceso revocado por administrador");
  if (motivo === null) return;
  try {
    const r = await fetchAdmin("/admin/accesos/" + accesoId + "/negar", {
      method: "POST",
      body: JSON.stringify({ motivo: motivo })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo negar acceso");
    setAdminMensajeAccesos("Acceso negado.", "ok");
    await cargarAccesosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeAccesos(e.message, "error");
  }
}
window.negarAccesoAdmin = negarAccesoAdmin;

async function editarAccesoAdmin(accesoId) {
  const acc = adminAccesosCache.find(function(a) { return Number(a.id) === Number(accesoId); });
  if (!acc) return;
  const fin = prompt("Nueva fecha de vencimiento (AAAA-MM-DD) o vacío = permanente:", acc.fecha_fin ? String(acc.fecha_fin).slice(0, 10) : "");
  if (fin === null) return;
  const motivo = prompt("Motivo del cambio:", acc.motivo || "") || "";
  try {
    const r = await fetchAdmin("/admin/accesos/" + accesoId, {
      method: "PUT",
      body: JSON.stringify({
        fecha_fin: fin.trim() || null,
        estado: "activo",
        motivo: motivo
      })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo actualizar");
    setAdminMensajeAccesos("Permiso actualizado.", "ok");
    await cargarAccesosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeAccesos(e.message, "error");
  }
}
window.editarAccesoAdmin = editarAccesoAdmin;

function llenarSelectRolesAdmin() {
  const selMatriz = document.getElementById("adminMatrizRolSeleccion");
  const selUsuario = document.getElementById("adminNuevoRol");
  const roles = adminAclRoles.slice().sort(function(a, b) {
    return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
  });
  const opts = roles.map(function(r) {
    return '<option value="' + r.id + '">' + (r.nombre || "") + "</option>";
  }).join("");
  if (selMatriz) {
    const prev = adminAclRolEditId || selMatriz.value;
    selMatriz.innerHTML = roles.length
      ? opts
      : '<option value="">Sin roles</option>';
    if (prev && roles.some(function(r) { return String(r.id) === String(prev); })) {
      selMatriz.value = prev;
      adminAclRolEditId = String(prev);
    } else if (roles.length) {
      adminAclRolEditId = String(roles[0].id);
      selMatriz.value = adminAclRolEditId;
    }
  }
  if (selUsuario) {
    const val = selUsuario.value;
    const optsUsuario = roles.map(function(r) {
      return '<option value="' + (r.nombre || "") + '">' + (r.nombre || "") + "</option>";
    }).join("");
    selUsuario.innerHTML = optsUsuario || '<option value="consulta">consulta</option>';
    if (val && roles.some(function(r) { return r.nombre === val; })) {
      selUsuario.value = val;
    } else if (roles.length) {
      selUsuario.value = roles[0].nombre;
    }
  }
}

function pintarMatrizAclEditable() {
  const cont = document.getElementById("adminMatrizPermisos");
  if (!cont) return;
  const permisos = adminAclPermisos.slice().sort(function(a, b) {
    return String(a.codigo || "").localeCompare(String(b.codigo || ""), "es");
  });
  const roles = adminAclRoles.slice().sort(function(a, b) {
    return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es");
  });
  const rolEditId = String(adminAclRolEditId || document.getElementById("adminMatrizRolSeleccion")?.value || "");
  if (!roles.length || !permisos.length) {
    cont.innerHTML = "<div style='padding:10px;'>Sin roles o permisos registrados.</div>";
    return;
  }
  let html = '<table class="permisos-matriz permisos-matriz-transpuesta"><thead><tr><th class="perm-nombre">Permiso</th>';
  roles.forEach(function(rol) {
    const esEdit = String(rol.id) === rolEditId;
    html += '<th class="rol-col' + (esEdit ? " rol-editando-col" : "") + '" title="' + (rol.descripcion || rol.nombre || "").replace(/"/g, "&quot;") + '">'
      + (rol.nombre || "") + "</th>";
  });
  html += "</tr></thead><tbody>";
  permisos.forEach(function(p) {
    const codigo = p.codigo || "";
    const label = codigo.replace(/_/g, " ");
    const desc = String(p.descripcion || "").trim();
    const titulo = desc && desc.toLowerCase() !== label.toLowerCase() ? desc : label;
    html += '<tr><td class="perm-nombre" title="' + titulo.replace(/"/g, "&quot;") + '">' + label + "</td>";
    roles.forEach(function(rol) {
      const esEdit = String(rol.id) === rolEditId;
      const setPerm = {};
      (rol.permisos || []).forEach(function(c) { setPerm[c] = true; });
      const tiene = !!setPerm[codigo];
      if (esEdit) {
        html += '<td class="rol-editando-cel"><input type="checkbox" class="acl-perm-cb" data-codigo="' + codigo + '"' + (tiene ? " checked" : "") + "></td>";
      } else {
        html += "<td>" + (tiene ? "✅" : "—") + "</td>";
      }
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
}

async function cargarMatrizPermisosAdmin() {
  const cont = document.getElementById("adminMatrizPermisos");
  if (!cont) return;
  cont.innerHTML = "<div style='padding:10px;'>Cargando matriz...</div>";
  setAdminMensajeMatriz("", "");
  try {
    const r = await fetchAdmin("/admin/acl/matriz");
    if (!r.ok) {
      const err = await r.json().catch(function() { return {}; });
      throw new Error(err.detail || "No se pudo cargar matriz ACL (HTTP " + r.status + ")");
    }
    const data = await r.json();
    adminAclRoles = data.roles || [];
    adminAclPermisos = data.permisos || [];
    llenarSelectRolesAdmin();
    pintarMatrizAclEditable();
  } catch (e) {
    cont.innerHTML = '<div style="padding:10px;color:#991b1b;">' + e.message + "</div>";
    setAdminMensajeMatriz(e.message, "error");
  }
}

function adminMatrizSeleccionarRol() {
  adminAclRolEditId = document.getElementById("adminMatrizRolSeleccion")?.value || "";
  pintarMatrizAclEditable();
}

async function guardarMatrizAclSeleccionada() {
  const rolId = adminAclRolEditId || document.getElementById("adminMatrizRolSeleccion")?.value;
  if (!rolId) {
    setAdminMensajeMatriz("Seleccione un rol para guardar.", "error");
    return;
  }
  const permisos = Array.from(document.querySelectorAll("#adminMatrizPermisos .acl-perm-cb:checked"))
    .map(function(cb) { return cb.getAttribute("data-codigo"); })
    .filter(Boolean);
  try {
    setAdminMensajeMatriz("Guardando permisos...", "ok");
    const r = await fetchAdmin("/admin/acl/roles/" + rolId + "/permisos", {
      method: "PUT",
      body: JSON.stringify({ permisos: permisos })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudieron guardar los permisos");
    setAdminMensajeMatriz("Permisos del rol guardados (" + permisos.length + ").", "ok");
    await cargarMatrizPermisosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeMatriz(e.message, "error");
  }
}

async function crearRolAclAdmin() {
  const nombre = document.getElementById("adminNuevoRolAcl")?.value.trim();
  const descripcion = document.getElementById("adminNuevoRolAclDesc")?.value.trim();
  if (!nombre) {
    setAdminMensajeMatriz("Indique el nombre del nuevo rol.", "error");
    return;
  }
  try {
    setAdminMensajeMatriz("Creando rol...", "ok");
    const r = await fetchAdmin("/admin/acl/roles", {
      method: "POST",
      body: JSON.stringify({ nombre: nombre, descripcion: descripcion || null, permisos: [] })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo crear el rol");
    document.getElementById("adminNuevoRolAcl").value = "";
    document.getElementById("adminNuevoRolAclDesc").value = "";
    if (data.rol && data.rol.id) adminAclRolEditId = String(data.rol.id);
    setAdminMensajeMatriz("Rol «" + (data.rol?.nombre || nombre) + "» creado. Marque permisos y guarde.", "ok");
    await cargarMatrizPermisosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeMatriz(e.message, "error");
  }
}

async function crearPermisoAclAdmin() {
  const codigo = document.getElementById("adminNuevoPermisoAcl")?.value.trim();
  const descripcion = document.getElementById("adminNuevoPermisoAclDesc")?.value.trim();
  if (!codigo) {
    setAdminMensajeMatriz("Indique el código del permiso.", "error");
    return;
  }
  try {
    setAdminMensajeMatriz("Creando permiso...", "ok");
    const r = await fetchAdmin("/admin/acl/permisos", {
      method: "POST",
      body: JSON.stringify({ codigo: codigo, descripcion: descripcion || null })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo crear el permiso");
    document.getElementById("adminNuevoPermisoAcl").value = "";
    document.getElementById("adminNuevoPermisoAclDesc").value = "";
    setAdminMensajeMatriz("Permiso «" + (data.permiso?.codigo || codigo) + "» creado.", "ok");
    await cargarMatrizPermisosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensajeMatriz(e.message, "error");
  }
}

async function cargarAuditoriaAdmin() {
  const cont = document.getElementById("adminAuditoriaTabla");
  if (!cont) return;
  cont.innerHTML = "<div style='padding:10px;'>Cargando auditoría...</div>";
  try {
    const r = await fetchAdmin("/admin/auditoria?limite=200");
    if (!r.ok) {
      const err = await r.json().catch(function() { return {}; });
      throw new Error(err.detail || "No se pudo cargar auditoría");
    }
    const data = await r.json();
    const rows = data.auditoria || [];
    if (!rows.length) {
      cont.innerHTML = "<div style='padding:10px;'>Sin movimientos.</div>";
      return;
    }
    let html = '<table class="admin-table"><thead><tr>'
      + "<th>Fecha</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Detalle</th>"
      + "</tr></thead><tbody>";
    rows.forEach(function(a) {
      html += "<tr><td>" + formatearFechaAdmin(a.fecha) + "</td><td>" + (a.usuario || "")
        + "</td><td>" + (a.accion || "") + "</td><td>" + (a.modulo || "")
        + "</td><td>" + (a.detalle || "") + "</td></tr>";
    });
    html += "</tbody></table>";
    cont.innerHTML = html;
  } catch (e) {
    cont.innerHTML = '<div style="padding:10px;color:#991b1b;">' + e.message + "</div>";
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
      body: JSON.stringify({ usuario: usuario, nombre_completo: nombre, password: password, rol: rol })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo crear usuario");
    document.getElementById("adminNuevoUsuario").value = "";
    document.getElementById("adminNuevoNombre").value = "";
    document.getElementById("adminNuevoPassword").value = "";
    document.getElementById("adminNuevoRol").value = "consulta";
    setAdminMensaje("Usuario creado correctamente.", "ok");
    await cargarUsuariosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensaje(e.message, "error");
  }
}

async function editarUsuarioAdmin(id) {
  const u = adminUsuariosCache.find(function(x) { return Number(x.id) === Number(id); });
  if (!u) return;
  const nombre = prompt("Nombre completo:", u.nombre_completo || "");
  if (nombre === null) return;
  const rol = prompt("Rol (" + ADMIN_ROLES.join(", ") + "):", u.rol_principal || "consulta");
  if (rol === null) return;
  try {
    const r = await fetchAdmin("/admin/usuarios/" + id, {
      method: "PUT",
      body: JSON.stringify({ nombre_completo: nombre, rol: rol })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo actualizar usuario");
    setAdminMensaje("Usuario actualizado.", "ok");
    await cargarUsuariosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensaje(e.message, "error");
  }
}

async function resetPasswordAdmin(id) {
  const password = prompt("Nueva contraseña:");
  if (!password) return;
  try {
    const r = await fetchAdmin("/admin/usuarios/" + id + "/reset-password", {
      method: "POST",
      body: JSON.stringify({ password: password })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo actualizar contraseña");
    setAdminMensaje("Contraseña actualizada.", "ok");
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensaje(e.message, "error");
  }
}

async function toggleActivoAdmin(id, activoActual) {
  try {
    const r = await fetchAdmin("/admin/usuarios/" + id, {
      method: "PUT",
      body: JSON.stringify({ activo: !activoActual })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || "No se pudo cambiar estado");
    setAdminMensaje("Estado actualizado.", "ok");
    await cargarUsuariosAdmin();
    await cargarAuditoriaAdmin();
  } catch (e) {
    setAdminMensaje(e.message, "error");
  }
}

window.cargarUsuariosAdmin = cargarUsuariosAdmin;
window.cargarAuditoriaAdmin = cargarAuditoriaAdmin;
window.crearUsuarioAdmin = crearUsuarioAdmin;
window.editarUsuarioAdmin = editarUsuarioAdmin;
window.resetPasswordAdmin = resetPasswordAdmin;
window.toggleActivoAdmin = toggleActivoAdmin;
window.filtrarUsuariosAdmin = filtrarUsuariosAdmin;
window.cargarModuloAdministracion = cargarModuloAdministracion;
window.cargarMatrizPermisosAdmin = cargarMatrizPermisosAdmin;
window.adminMatrizSeleccionarRol = adminMatrizSeleccionarRol;
window.guardarMatrizAclSeleccionada = guardarMatrizAclSeleccionada;
window.crearRolAclAdmin = crearRolAclAdmin;
window.crearPermisoAclAdmin = crearPermisoAclAdmin;
