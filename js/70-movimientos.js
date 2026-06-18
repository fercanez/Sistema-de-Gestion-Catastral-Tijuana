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

  if (typeof puedeSolicitarMovimientos === "function" && !puedeSolicitarMovimientos()) {
    setMovMensaje("Su rol no tiene permiso para registrar movimientos catastrales.", "error");
    return;
  }
  const tipoUp = String(tipo || "").trim().toUpperCase();
  if (tipoUp === "CAMBIO_TITULARIDAD" && typeof puedeEditarTitularidad === "function" && !puedeEditarTitularidad()) {
    setMovMensaje("Su rol no tiene permiso para cambios de titularidad.", "error");
    return;
  }
  if (tipoUp === "CAMBIO_NOMBRE" && typeof puedeEditarNombreContribuyente === "function" && !puedeEditarNombreContribuyente()) {
    setMovMensaje("Su rol no tiene permiso para cambio de nombre del contribuyente.", "error");
    return;
  }

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

    cerrarModalMovimientoPadron();
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
  return typeof puedeAplicarMovimientos === "function" && puedeAplicarMovimientos();
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

function nombreUsuarioMovimiento(mov, loginKey, nombreKey) {
  if (!mov) return "";
  return String(mov[nombreKey] || mov[loginKey] || "").trim();
}

function metaUsuarioMovHtml(mov, loginKey, nombreKey, etiqueta, fechaKey) {
  const nombre = nombreUsuarioMovimiento(mov, loginKey, nombreKey);
  if (!nombre) return "";
  const fecha = fechaKey ? formatearFechaMovimiento(mov[fechaKey]) : "";
  const extra = fecha && fecha !== "Sin fecha"
    ? `<small style="color:#64748b;font-weight:600;">${escapeHtml(fecha)}</small>`
    : "";
  return `
    <div>
      <span>${escapeHtml(etiqueta)}</span>
      <b>${escapeHtml(nombre)}</b>
      ${extra}
    </div>
  `;
}

function renderMetaUsuariosMovHtml(mov) {
  if (!mov) return "";
  const estado = String(mov.estado || "").toUpperCase();
  let html = metaUsuarioMovHtml(mov, "usuario_solicita", "nombre_solicita", "Solicitó", "fecha_solicitud");
  if (nombreUsuarioMovimiento(mov, "usuario_autoriza", "nombre_autoriza")) {
    html += metaUsuarioMovHtml(mov, "usuario_autoriza", "nombre_autoriza", "Autorizó", "fecha_autorizacion");
  }
  if (estado === "APLICADO" || nombreUsuarioMovimiento(mov, "usuario_aplica", "nombre_aplica")) {
    html += metaUsuarioMovHtml(mov, "usuario_aplica", "nombre_aplica", "Aplicó al padrón", "fecha_aplicacion");
  }
  return html;
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
      ${renderMetaUsuariosMovHtml(mov)}
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

function cerrarModalesBloqueoSeguimiento() {
  document.getElementById("modalAplicarMovimiento")?.classList.add("oculto");
  document.getElementById("modalMovimientoPadron")?.classList.add("oculto");
  document.getElementById("modalCopropietarios")?.classList.add("oculto");
}

function abrirModalSeguimientoMovimiento(mov) {
  const modal = document.getElementById("modalSeguimientoMovimiento");
  if (!modal) return;

  cerrarModalesBloqueoSeguimiento();

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

    detCont.innerHTML = `
      <div class="gestor-mov-meta" style="margin-bottom:12px;">
        ${renderMetaUsuariosMovHtml(mov)}
      </div>
      ${renderDetallesMovimientoHtml(mov.detalles)}
    `;

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

  document.getElementById("modalMovimientoPadron")?.classList.add("oculto");
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

    const movActualizado = Object.assign({}, mov, data.movimiento || {}, { estado: "APLICADO" });
    registrarMovimientoEnCache(movActualizado);

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

    cerrarModalAplicarMovimiento();
    cerrarModalMovimientoPadron();
    document.getElementById("modalCopropietarios")?.classList.add("oculto");

    if (typeof abrirModalSeguimientoMovimiento === "function") {
      abrirModalSeguimientoMovimiento(movActualizado);
      if (mov.id) await cargarDetalleSeguimientoMovimiento(mov.id);
    }

  } catch (e) {
    console.error("Error aplicando movimiento:", e);
    setAplicarMovMensaje(e.message || "Error al aplicar movimiento.", "error");
  }
}
window.confirmarAplicarMovimientoModal = confirmarAplicarMovimientoModal;


// Inicialización del módulo de movimientos al cargar.

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
  if (typeof abrirPreviewCedulaNumeroOficial === "function") {
    return abrirPreviewCedulaNumeroOficial(movOpt);
  }
  alert("Vista previa de cédula no disponible. Actualice js/44-cedula-numero-oficial-preview.js");
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
  CORRECCION_DOMICILIO: {
    titulo: "Correccion de domicilio",
    icono: "🏠",
    desc: "Corrige colonia y calle del predio segun catalogos institucionales (colonias y calles).",
    campos: [
      { key: "colonia", label: "Colonia / fraccionamiento", padronKey: "colonia", tipo: "catalogo_colonia" },
      { key: "calle", label: "Calle", padronKey: "calle", tipo: "catalogo_calle" }
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

async function cargarCatalogoColoniasMov(q) {
  const texto = String(q || "").trim();
  const r = await fetch(
    `${API}/catalogos/colonias/mantenimiento/buscar?q=${encodeURIComponent(texto)}&limite=150&_=${Date.now()}`,
    { cache: "no-store", headers: typeof authHeaders === "function" ? authHeaders() : {} }
  );
  const data = await r.json().catch(function() { return {}; });
  if (!r.ok) {
    throw new Error(errorApiMov(data, "No se pudo cargar el catalogo de colonias"));
  }
  return data.resultados || [];
}

async function cargarCatalogoCallesMov(q) {
  const texto = String(q || "").trim();
  const r = await fetch(
    `${API}/catalogos/calles/mantenimiento/buscar?q=${encodeURIComponent(texto)}&limite=150&_=${Date.now()}`,
    { cache: "no-store", headers: typeof authHeaders === "function" ? authHeaders() : {} }
  );
  const data = await r.json().catch(function() { return {}; });
  if (!r.ok) {
    throw new Error(errorApiMov(data, "No se pudo cargar el catalogo de calles"));
  }
  return data.resultados || [];
}

function nombreItemCatalogoColonia(item) {
  return String(item?.nombre_colonia || item?.nombre || "").trim().toUpperCase();
}

function nombreItemCatalogoCalle(item) {
  return String(item?.nombre_calle || item?.nombre || "").trim().toUpperCase();
}

function asegurarOpcionCatalogoColonia(rows, valorPadron) {
  const nom = String(valorPadron || "").trim().toUpperCase();
  const lista = Array.isArray(rows) ? rows.slice() : [];
  if (nom && !lista.some(function(r) { return nombreItemCatalogoColonia(r) === nom; })) {
    lista.unshift({ nombre_colonia: nom, origen: "padron" });
  }
  return lista;
}

function asegurarOpcionCatalogoCalle(rows, valorPadron) {
  const nom = String(valorPadron || "").trim().toUpperCase();
  const lista = Array.isArray(rows) ? rows.slice() : [];
  if (nom && !lista.some(function(r) { return nombreItemCatalogoCalle(r) === nom; })) {
    lista.unshift({ nombre_calle: nom, origen: "padron" });
  }
  return lista;
}

function htmlOpcionesCatalogoColonia(opciones, seleccionada) {
  const actual = String(seleccionada || "").trim().toUpperCase();
  let html = `<option value="">— Sin cambio —</option>`;
  (opciones || []).forEach(function(item) {
    const nom = nombreItemCatalogoColonia(item);
    if (!nom) return;
    const sel = actual && nom === actual ? " selected" : "";
    const extra = item.origen === "padron" ? " (padrón actual)" : "";
    html += `<option value="${escapeHtml(nom)}"${sel}>${escapeHtml(nom + extra)}</option>`;
  });
  return html;
}

function htmlOpcionesCatalogoCalle(opciones, seleccionada) {
  const actual = String(seleccionada || "").trim().toUpperCase();
  let html = `<option value="">— Sin cambio —</option>`;
  (opciones || []).forEach(function(item) {
    const nom = nombreItemCatalogoCalle(item);
    if (!nom) return;
    const sel = actual && nom === actual ? " selected" : "";
    const extra = item.origen === "padron" ? " (padrón actual)" : "";
    html += `<option value="${escapeHtml(nom)}"${sel}>${escapeHtml(nom + extra)}</option>`;
  });
  return html;
}

let movCatalogoColoniaTimer = null;
let movCatalogoCalleTimer = null;
const MOV_CATALOGO_MIN_BUSQUEDA = 2;

function actualizarDatalistCatalogoMov(datalistId, rows, nombreFn) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  const vistos = new Set();
  let html = "";
  (rows || []).forEach(function(item) {
    const nom = nombreFn(item);
    if (!nom || vistos.has(nom)) return;
    vistos.add(nom);
    html += `<option value="${escapeHtml(nom)}"></option>`;
  });
  dl.innerHTML = html;
}

function actualizarContadorCatalogoMov(contadorId, texto, estado) {
  const el = document.getElementById(contadorId);
  if (!el) return;
  el.textContent = texto || "";
  el.classList.remove("busy", "ok", "err");
  if (estado) el.classList.add(estado);
}

function aplicarSeleccionCatalogoDesdeFiltro(selectId, filtroId) {
  const sel = document.getElementById(selectId);
  const filtroEl = document.getElementById(filtroId);
  if (!sel || !filtroEl) return;
  const ant = String(sel.dataset.anterior || "").trim().toUpperCase();
  const filtro = String(filtroEl.value || "").trim().toUpperCase();
  if (!filtro) return;

  const opciones = Array.from(sel.options).filter(function(opt, idx) {
    return idx > 0 && opt.value;
  });
  const exacta = opciones.find(function(o) { return o.value.toUpperCase() === filtro; });
  if (exacta && exacta.value.toUpperCase() !== ant) {
    sel.value = exacta.value;
    return;
  }
  const coincidencias = opciones.filter(function(o) {
    const v = o.value.toUpperCase();
    return v !== ant && (v.indexOf(filtro) >= 0 || filtro.indexOf(v) >= 0);
  });
  if (coincidencias.length === 1) {
    sel.value = coincidencias[0].value;
  }
}

function sincronizarCatalogosMovimientoPadron() {
  aplicarSeleccionCatalogoDesdeFiltro("movPadron_colonia", "movPadron_colonia_filtro");
  aplicarSeleccionCatalogoDesdeFiltro("movPadron_calle", "movPadron_calle_filtro");
}

function onCatalogoColoniaMovChange() {
  const sel = document.getElementById("movPadron_colonia");
  const filtro = document.getElementById("movPadron_colonia_filtro");
  if (sel && filtro && sel.value) filtro.value = sel.value;
}
window.onCatalogoColoniaMovChange = onCatalogoColoniaMovChange;

function onCatalogoCalleMovChange() {
  const sel = document.getElementById("movPadron_calle");
  const filtro = document.getElementById("movPadron_calle_filtro");
  if (sel && filtro && sel.value) filtro.value = sel.value;
}
window.onCatalogoCalleMovChange = onCatalogoCalleMovChange;

async function recargarSelectColoniaMov(q) {
  const sel = document.getElementById("movPadron_colonia");
  if (!sel) return;
  const valorPrevio = sel.value;
  const ant = String(sel.dataset.anterior || movPadronEstado.ficha?.colonia || "").trim().toUpperCase();
  const fichaActual = movPadronEstado.ficha?.colonia || sel.dataset.anterior || "";
  const texto = String(q || "").trim();
  try {
    let rows = [];
    if (texto.length >= MOV_CATALOGO_MIN_BUSQUEDA) {
      actualizarContadorCatalogoMov("movPadron_colonia_contador", "Buscando colonias...", "busy");
      rows = await cargarCatalogoColoniasMov(texto);
    } else {
      actualizarContadorCatalogoMov(
        "movPadron_colonia_contador",
        texto.length
          ? "Escriba al menos " + MOV_CATALOGO_MIN_BUSQUEDA + " caracteres para buscar."
          : "Escriba en el buscador para ver colonias del catalogo."
      );
    }
    rows = asegurarOpcionCatalogoColonia(rows, fichaActual);
    sel.innerHTML = htmlOpcionesCatalogoColonia(rows, "");
    actualizarDatalistCatalogoMov("movPadron_colonia_datalist", rows, nombreItemCatalogoColonia);
    const prevNorm = String(valorPrevio || "").trim().toUpperCase();
    if (prevNorm && prevNorm !== ant) sel.value = valorPrevio;
    aplicarSeleccionCatalogoDesdeFiltro("movPadron_colonia", "movPadron_colonia_filtro");
    if (texto.length >= MOV_CATALOGO_MIN_BUSQUEDA) {
      const nCat = rows.filter(function(r) {
        return nombreItemCatalogoColonia(r) && nombreItemCatalogoColonia(r) !== ant;
      }).length;
      actualizarContadorCatalogoMov(
        "movPadron_colonia_contador",
        nCat
          ? nCat + " resultado(s). Elija en la lista o use la sugerencia del buscador."
          : "Sin coincidencias en catalogo. Refine la busqueda.",
        nCat ? "ok" : ""
      );
    }
  } catch (e) {
    actualizarContadorCatalogoMov("movPadron_colonia_contador", e.message || String(e), "err");
    setMovPadronMensaje(e.message || String(e), false);
  }
}

async function recargarSelectCalleMov(q) {
  const sel = document.getElementById("movPadron_calle");
  if (!sel) return;
  const valorPrevio = sel.value;
  const ant = String(sel.dataset.anterior || movPadronEstado.ficha?.calle || "").trim().toUpperCase();
  const fichaActual = movPadronEstado.ficha?.calle || sel.dataset.anterior || "";
  const texto = String(q || "").trim();
  try {
    let rows = [];
    if (texto.length >= MOV_CATALOGO_MIN_BUSQUEDA) {
      actualizarContadorCatalogoMov("movPadron_calle_contador", "Buscando calles...", "busy");
      rows = await cargarCatalogoCallesMov(texto);
    } else {
      actualizarContadorCatalogoMov(
        "movPadron_calle_contador",
        texto.length
          ? "Escriba al menos " + MOV_CATALOGO_MIN_BUSQUEDA + " caracteres para buscar."
          : "Escriba en el buscador para ver calles del catalogo."
      );
    }
    rows = asegurarOpcionCatalogoCalle(rows, fichaActual);
    sel.innerHTML = htmlOpcionesCatalogoCalle(rows, "");
    actualizarDatalistCatalogoMov("movPadron_calle_datalist", rows, nombreItemCatalogoCalle);
    const prevNorm = String(valorPrevio || "").trim().toUpperCase();
    if (prevNorm && prevNorm !== ant) sel.value = valorPrevio;
    aplicarSeleccionCatalogoDesdeFiltro("movPadron_calle", "movPadron_calle_filtro");
    if (texto.length >= MOV_CATALOGO_MIN_BUSQUEDA) {
      const nCat = rows.filter(function(r) {
        return nombreItemCatalogoCalle(r) && nombreItemCatalogoCalle(r) !== ant;
      }).length;
      actualizarContadorCatalogoMov(
        "movPadron_calle_contador",
        nCat
          ? nCat + " resultado(s). Elija en la lista o use la sugerencia del buscador."
          : "Sin coincidencias en catalogo. Refine la busqueda.",
        nCat ? "ok" : ""
      );
    }
  } catch (e) {
    actualizarContadorCatalogoMov("movPadron_calle_contador", e.message || String(e), "err");
    setMovPadronMensaje(e.message || String(e), false);
  }
}

function onFiltroColoniaMovInput() {
  clearTimeout(movCatalogoColoniaTimer);
  movCatalogoColoniaTimer = setTimeout(function() {
    const q = document.getElementById("movPadron_colonia_filtro")?.value || "";
    recargarSelectColoniaMov(q);
  }, 280);
}
window.onFiltroColoniaMovInput = onFiltroColoniaMovInput;

function onFiltroCalleMovInput() {
  clearTimeout(movCatalogoCalleTimer);
  movCatalogoCalleTimer = setTimeout(function() {
    const q = document.getElementById("movPadron_calle_filtro")?.value || "";
    recargarSelectCalleMov(q);
  }, 280);
}
window.onFiltroCalleMovInput = onFiltroCalleMovInput;

function filtrarSelectCatalogoMov(selectId, filtroId) {
  const filtro = (document.getElementById(filtroId)?.value || "").trim().toUpperCase();
  const sel = document.getElementById(selectId);
  if (!sel) return;
  Array.from(sel.options).forEach(function(opt, idx) {
    if (idx === 0) {
      opt.hidden = false;
      return;
    }
    const txt = (opt.textContent || "").toUpperCase();
    opt.hidden = filtro !== "" && txt.indexOf(filtro) === -1;
  });
}
window.filtrarSelectCatalogoColoniaMov = function() {
  filtrarSelectCatalogoMov("movPadron_colonia", "movPadron_colonia_filtro");
};
window.filtrarSelectCatalogoCalleMov = function() {
  filtrarSelectCatalogoMov("movPadron_calle", "movPadron_calle_filtro");
};

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
  let msg = texto;
  if (msg && typeof msg === "object") {
    msg = typeof extraerMensajeApi === "function"
      ? extraerMensajeApi(msg, "Error en la solicitud")
      : JSON.stringify(msg);
  }
  el.textContent = msg || "";
  el.className = "modal-mov-msg " + (ok ? "ok" : "error");
}

function errorApiMov(errJson, fallback) {
  if (typeof extraerMensajeApi === "function") {
    return extraerMensajeApi(errJson, fallback);
  }
  const d = errJson?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map(function(x) { return x.msg || x.message || String(x); }).join("; ");
  }
  return fallback;
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

    if (c.tipo === "catalogo_colonia") {
      const actual = String(ficha?.colonia || "").trim().toUpperCase();
      const opciones = catalogos.colonias || [];
      html += `<label class="input-label-mini">${escapeHtml(c.label)}</label>`;
      html += `<input type="text" id="movPadron_colonia_filtro" list="movPadron_colonia_datalist" autocomplete="off" placeholder="Escriba para buscar colonia..." oninput="onFiltroColoniaMovInput()" onblur="sincronizarCatalogosMovimientoPadron()">`;
      html += `<datalist id="movPadron_colonia_datalist"></datalist>`;
      html += `<div id="movPadron_colonia_contador" class="mov-catalogo-contador">Escriba en el buscador para ver colonias del catalogo.</div>`;
      html += `<select id="movPadron_${c.key}" class="mov-catalogo-listbox" size="6" data-campo="${c.key}" data-tipo="catalogo_colonia" data-anterior="${escapeHtml(actual)}" onchange="onCatalogoColoniaMovChange()">`;
      html += htmlOpcionesCatalogoColonia(opciones, "");
      html += `</select>`;
      if (actual) {
        html += `<div class="mov-valor-anterior">Actual: ${escapeHtml(actual)}</div>`;
      }
      html += `<div class="mov-valor-anterior">Seleccione del catalogo institucional. Deje «Sin cambio» si no aplica.</div>`;
      return;
    }

    if (c.tipo === "catalogo_calle") {
      const actual = String(ficha?.calle || "").trim().toUpperCase();
      const opciones = catalogos.calles || [];
      html += `<label class="input-label-mini">${escapeHtml(c.label)}</label>`;
      html += `<input type="text" id="movPadron_calle_filtro" list="movPadron_calle_datalist" autocomplete="off" placeholder="Escriba para buscar calle (ej. LUCIO BLANCO)..." oninput="onFiltroCalleMovInput()" onblur="sincronizarCatalogosMovimientoPadron()">`;
      html += `<datalist id="movPadron_calle_datalist"></datalist>`;
      html += `<div id="movPadron_calle_contador" class="mov-catalogo-contador">Escriba en el buscador para ver calles del catalogo.</div>`;
      html += `<select id="movPadron_${c.key}" class="mov-catalogo-listbox" size="6" data-campo="${c.key}" data-tipo="catalogo_calle" data-anterior="${escapeHtml(actual)}" onchange="onCatalogoCalleMovChange()">`;
      html += htmlOpcionesCatalogoCalle(opciones, "");
      html += `</select>`;
      if (actual) {
        html += `<div class="mov-valor-anterior">Actual: ${escapeHtml(actual)}</div>`;
      }
      html += `<div class="mov-valor-anterior">Seleccione del catalogo institucional. Deje «Sin cambio» si no aplica.</div>`;
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
  let catalogoColonias = [];
  let catalogoCalles = [];
  const anioZona = (cfg.campos || []).find(function(c) { return c.tipo === "zona_homogenea"; })?.anio || ANIO_FISCAL_ZONA_HOMOGENEA;
  const fichaMov = movPadronEstado.ficha || {};

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
  if ((cfg.campos || []).some(function(c) { return c.tipo === "catalogo_colonia"; })) {
    catalogoColonias = [];
  }
  if ((cfg.campos || []).some(function(c) { return c.tipo === "catalogo_calle"; })) {
    catalogoCalles = [];
  }

  renderCamposMovimientoPadron(cfg, movPadronEstado.ficha, {
    usos: catalogoUsos,
    zonas: catalogoZonas,
    colonias: catalogoColonias,
    calles: catalogoCalles
  });

  if ((cfg.campos || []).some(function(c) { return c.tipo === "catalogo_colonia"; })) {
    const fCol = String(fichaMov.colonia || "").trim();
    const filtroCol = document.getElementById("movPadron_colonia_filtro");
    if (filtroCol && fCol) filtroCol.value = fCol;
    recargarSelectColoniaMov(fCol);
  }
  if ((cfg.campos || []).some(function(c) { return c.tipo === "catalogo_calle"; })) {
    recargarSelectCalleMov("");
  }

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

    sincronizarCatalogosMovimientoPadron();

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

      if (c.tipo === "catalogo_colonia" || c.tipo === "catalogo_calle") {
        const el = document.getElementById("movPadron_" + c.key);
        const val = String(el?.value || "").trim().toUpperCase();
        const valAnt = String(el?.dataset?.anterior || "").trim().toUpperCase();
        const filtroId = c.tipo === "catalogo_colonia" ? "movPadron_colonia_filtro" : "movPadron_calle_filtro";
        const filtroTxt = String(document.getElementById(filtroId)?.value || "").trim();
        if (!val && filtroTxt) {
          throw new Error(
            "Seleccione " + c.label.toLowerCase() + " en el desplegable (no solo en el buscador). " +
            "Escriba en el buscador y elija la opcion que coincida."
          );
        }
        if (!val) return;
        if (valAnt && val === valAnt) return;
        if (valAnt) datosAnteriores[c.key] = valAnt;
        datosNuevos[c.key] = val;
        detalles.push({
          grupo: "PADRON",
          campo: c.key,
          etiqueta: c.label.toUpperCase(),
          valor_anterior: valAnt,
          valor_nuevo: val,
          tipo_dato: "texto",
          requiere_validacion: true
        });
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

    if (tipo === "CORRECCION_DOMICILIO" && !detalles.length) {
      throw new Error("Indique al menos un cambio de colonia o calle (distinto al valor actual).");
    }

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
    if (!r.ok) throw new Error(errorApiMov(data, data.message || "No se pudo guardar la solicitud"));

    const mov = data.movimiento || data;
    setMovPadronMensaje("Solicitud creada: " + (mov.folio || mov.id || ""), true);

    if (typeof cargarMovimientosPadron === "function") {
      await cargarMovimientosPadron(clave || datosNuevos.clave_catastral);
    }

    cerrarModalMovimientoPadron();
    if (typeof abrirModalSeguimientoMovimiento === "function") {
      abrirModalSeguimientoMovimiento(mov);
    }

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


