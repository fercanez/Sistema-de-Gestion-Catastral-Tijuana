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
  condominio: null,
  baseline: null
};

function requiereSolicitudMovimientoTitularidad() {
  return true;
}

function puedeConsultarTitularidadCoprop() {
  if (typeof tienePermiso !== "function") return typeof puedeEditarCatastro === "function" && puedeEditarCatastro();
  return (
    tienePermiso("ver_expediente") ||
    tienePermiso("consulta") ||
    tienePermiso("editar_titularidad") ||
    tienePermiso("solicitar_movimientos")
  );
}

function aplicarPermisosUiCoprop() {
  const puedeTit = typeof puedeEditarTitularidad === "function" && puedeEditarTitularidad();
  const puedeSol = typeof puedeSolicitarMovimientos === "function" && puedeSolicitarMovimientos();

  document.querySelectorAll(".coprop-btn-guardar-principal").forEach(function(el) {
    el.style.display = puedeTit ? "" : "none";
  });
  document.querySelectorAll(".coprop-solicitud-mov").forEach(function(el) {
    el.style.display = (puedeTit && puedeSol) ? "" : "none";
  });
  document.querySelectorAll(".coprop-acciones-predio .coprop-btn").forEach(function(el) {
    if (el.classList.contains("coprop-btn-guardar-principal")) return;
    el.style.display = puedeTit ? "" : "none";
  });
  document.querySelectorAll(".coprop-principal-radio").forEach(function(el) {
    if (el.disabled && el.closest("tr")) return;
    el.disabled = !puedeTit;
  });
  document.querySelectorAll(".coprop-table input[type=number]").forEach(function(el) {
    el.disabled = !puedeTit;
  });
  document.querySelectorAll(".coprop-table .coprop-btn.danger").forEach(function(el) {
    el.style.display = puedeTit ? "" : "none";
  });
  document.querySelectorAll(".coprop-padron-alerta .coprop-btn").forEach(function(el) {
    el.style.display = puedeTit ? "" : "none";
  });
  const cardCatalogo = document.querySelector("#modalCopropietarios .coprop-body .coprop-card:last-child");
  if (cardCatalogo) {
    cardCatalogo.querySelectorAll("input, select, button, textarea").forEach(function(el) {
      el.disabled = !puedeTit;
    });
  }
  const aviso = document.getElementById("copropPermisoLectura");
  if (aviso) aviso.classList.toggle("oculto", !!puedeTit);
}

function snapshotPropietariosMovimiento(props) {
  return (props || []).map(function(p, idx) {
    return {
      id_persona: Number(p.id_persona),
      porcentaje_propiedad: Number(p.porcentaje_propiedad || 0),
      tipo_titularidad: p.tipo_titularidad || (idx === 0 ? "PROPIETARIO" : "COPROPIETARIO"),
      nombre_completo: p.nombre_completo || (typeof nombrePersonaCatalogo === "function" ? nombrePersonaCatalogo(p) : "")
    };
  }).sort(function(a, b) { return a.id_persona - b.id_persona; });
}

function obtenerTenenciaCopropUi() {
  return String(document.getElementById("copropTenenciaPadron")?.value || copropEstado.baseline?.tenencia || "").trim().toUpperCase();
}

function hayCambiosPendientesCoprop() {
  if (!copropEstado.baseline) return false;
  const base = snapshotPropietariosMovimiento(copropEstado.baseline.propietarios);
  const actual = snapshotPropietariosMovimiento(copropEstado.propietarios);
  const tenBase = String(copropEstado.baseline.tenencia || "").trim().toUpperCase();
  const tenAct = obtenerTenenciaCopropUi();
  return JSON.stringify(base) !== JSON.stringify(actual) || tenBase !== tenAct;
}

function esPropietarioPrincipalCoprop(p) {
  return String(p?.tipo_titularidad || "").toUpperCase() === "PROPIETARIO";
}

function ordenarTitularesCoprop(props) {
  return [...(props || [])].sort(function(a, b) {
    const pa = esPropietarioPrincipalCoprop(a) ? 0 : 1;
    const pb = esPropietarioPrincipalCoprop(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return Number(b.porcentaje_propiedad || 0) - Number(a.porcentaje_propiedad || 0);
  });
}

function nombreTitularPrincipalCoprop(props) {
  return formatearNombreVisibleTitularidad(props);
}

function formatearNombreVisibleTitularidad(props) {
  const lista = ordenarTitularesCoprop(props || copropEstado.propietarios || []);
  if (!lista.length) return "";
  const principal = lista.find(esPropietarioPrincipalCoprop) || lista[0];
  const base = (
    typeof nombrePersonaCatalogo === "function"
      ? nombrePersonaCatalogo(principal)
      : (principal.nombre_completo || "")
  ).trim();
  if (!base) return "";
  const hayCop = lista.length > 1 || lista.some(function(p) { return !esPropietarioPrincipalCoprop(p); });
  if (hayCop && !/\bY\s+COP\.?\b/i.test(base)) {
    return `${base} Y COP.`;
  }
  return base;
}
window.formatearNombreVisibleTitularidad = formatearNombreVisibleTitularidad;

function marcarPropietarioPrincipalCoprop(idPersona) {
  if (typeof puedeEditarTitularidad === "function" && !puedeEditarTitularidad()) {
    msgCoprop("copropMsgPredio", "Su rol no tiene permiso para modificar titularidad.", false);
    return;
  }
  const id = Number(idPersona);
  const props = copropEstado.propietarios || [];
  if (!props.length) return;
  if (props.length === 1) {
    props[0].tipo_titularidad = "PROPIETARIO";
    renderCopropietariosPredio();
    return;
  }
  copropEstado.propietarios = ordenarTitularesCoprop(props.map(function(p) {
    return Object.assign({}, p, {
      tipo_titularidad: Number(p.id_persona) === id ? "PROPIETARIO" : "COPROPIETARIO"
    });
  }));
  renderCopropietariosPredio();
  actualizarPreviewNombreVisibleCoprop();
  msgCoprop(
    "copropMsgPredio",
    requiereSolicitudMovimientoTitularidad()
      ? "Propietario principal actualizado en borrador. Registre la solicitud de movimiento."
      : "Propietario principal actualizado.",
    true
  );
}
window.marcarPropietarioPrincipalCoprop = marcarPropietarioPrincipalCoprop;

function actualizarPreviewNombreVisibleCoprop() {
  const box = document.getElementById("copropNombreVisiblePreview");
  if (!box) return;
  const props = copropEstado.propietarios || [];
  if (!props.length) {
    box.innerHTML = "";
    box.classList.add("oculto");
    return;
  }
  const nombre = formatearNombreVisibleTitularidad(props);
  box.classList.remove("oculto");
  box.innerHTML = `
    <div class="coprop-nombre-visible-preview">
      <div class="coprop-nombre-visible-head">
        <span class="coprop-nombre-visible-label">Nombre visible en ficha / padrón:</span>
        <button type="button" class="coprop-btn ok coprop-btn-guardar-principal" onclick="guardarTitularPrincipalCoprop()" title="Guardar titular principal y copropietarios en catálogo y padrón">💾 Guardar</button>
      </div>
      <strong>${escapeHtml(nombre)}</strong>
    </div>
  `;
}

async function guardarTitularPrincipalCoprop() {
  const clave = copropEstado.clave;
  if (!clave) {
    msgCoprop("copropMsgPredio", "No hay predio seleccionado.", false);
    return;
  }
  if (typeof puedeEditarTitularidad === "function" && !puedeEditarTitularidad()) {
    msgCoprop("copropMsgPredio", "Su rol no tiene permiso para guardar titularidad.", false);
    return;
  }
  const props = copropEstado.propietarios || [];
  if (!props.length) {
    msgCoprop("copropMsgPredio", "Debe haber al menos un titular.", false);
    return;
  }
  if (!props.some(esPropietarioPrincipalCoprop)) {
    msgCoprop("copropMsgPredio", "Seleccione quién será el titular principal visible.", false);
    return;
  }
  const suma = sumaCopropiedadLocal();
  if (Math.abs(suma - 100) >= 0.01) {
    msgCoprop("copropMsgPredio", "La suma de copropiedad debe ser exactamente 100%.", false);
    return;
  }

  const nombreNuevo = formatearNombreVisibleTitularidad(props);
  const confirmar = confirm(
    `¿Guardar titularidad del predio ${clave}?\n\n` +
    `Nombre visible: ${nombreNuevo}\n\n` +
    `Se actualizará el catálogo de propietarios y el nombre en padrón.`
  );
  if (!confirmar) return;

  try {
    msgCoprop("copropMsgPredio", "Guardando titularidad...", true);
    await sincronizarCopropietariosPredio();
    invalidarCachePropietariosPredio(clave);
    copropEstado.baseline = {
      propietarios: JSON.parse(JSON.stringify(copropEstado.propietarios)),
      tenencia: obtenerTenenciaCopropUi(),
      nombre_padron: nombreNuevo
    };
    msgCoprop("copropMsgPredio", "Titularidad guardada correctamente.", true);
    await cargarCopropietariosPredio(clave);
    await refrescarVistaPredioActivo(clave);
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "No se pudo guardar la titularidad.", false);
  }
}
window.guardarTitularPrincipalCoprop = guardarTitularPrincipalCoprop;

function construirDetallesMovimientoTitularidad(anterior, nuevo, tenAnt, tenNueva) {
  const detalles = [];
  const antTxt = (anterior || []).map(function(p) {
    return `${p.nombre_completo || p.id_persona} (${Number(p.porcentaje_propiedad || 0).toFixed(2)}%)`;
  }).join("; ");
  const nueTxt = (nuevo || []).map(function(p) {
    return `${p.nombre_completo || p.id_persona} (${Number(p.porcentaje_propiedad || 0).toFixed(2)}%)`;
  }).join("; ");
  if (antTxt !== nueTxt) {
    detalles.push({
      grupo: "TITULARIDAD",
      campo: "propietarios",
      etiqueta: "Titulares / copropietarios",
      valor_anterior: antTxt || "Sin titulares",
      valor_nuevo: nueTxt || "Sin titulares",
      tipo_dato: "json",
      requiere_validacion: true
    });
  }
  if (tenAnt !== tenNueva) {
    detalles.push({
      grupo: "TITULARIDAD",
      campo: "tenencia",
      etiqueta: "Tipo de tenencia",
      valor_anterior: tenAnt || "—",
      valor_nuevo: tenNueva || "—",
      tipo_dato: "texto",
      requiere_validacion: true
    });
  }
  const nombreAnt = copropEstado.baseline?.nombre_padron || "";
  const nombreNuevo = nombreTitularPrincipalCoprop(nuevo);
  if (nombreNuevo && nombreAnt !== nombreNuevo) {
    detalles.push({
      grupo: "TITULARIDAD",
      campo: "nombre_completo",
      etiqueta: "Nombre visible en padrón",
      valor_anterior: nombreAnt,
      valor_nuevo: nombreNuevo,
      tipo_dato: "texto",
      requiere_validacion: true
    });
  }
  return detalles;
}

async function solicitarMovimientoTitularidadCoprop() {
  const clave = copropEstado.clave;
  if (!clave) {
    msgCoprop("copropMsgPredio", "No hay predio seleccionado.", false);
    return;
  }
  if (typeof puedeEditarTitularidad === "function" && !puedeEditarTitularidad()) {
    msgCoprop("copropMsgPredio", "Su rol no tiene permiso para modificar titularidad.", false);
    return;
  }
  if (typeof puedeSolicitarMovimientos === "function" && !puedeSolicitarMovimientos()) {
    msgCoprop("copropMsgPredio", "Su rol no tiene permiso para registrar movimientos catastrales.", false);
    return;
  }
  if (!hayCambiosPendientesCoprop()) {
    msgCoprop("copropMsgPredio", "No hay cambios pendientes para registrar.", false);
    return;
  }

  const suma = sumaCopropiedadLocal();
  if (Math.abs(suma - 100) >= 0.01) {
    msgCoprop("copropMsgPredio", "La suma de copropiedad debe ser exactamente 100%.", false);
    return;
  }

  const propAnterior = snapshotPropietariosMovimiento(copropEstado.baseline?.propietarios);
  const propNuevo = snapshotPropietariosMovimiento(copropEstado.propietarios);
  if (!propNuevo.length) {
    msgCoprop("copropMsgPredio", "Debe haber al menos un titular en el predio.", false);
    return;
  }

  const tenAnt = String(copropEstado.baseline?.tenencia || "").trim().toUpperCase();
  const tenNueva = obtenerTenenciaCopropUi();
  const motivo = String(document.getElementById("copropMovMotivo")?.value || "ACTUALIZACION TITULARIDAD").trim().toUpperCase();
  const observaciones = String(document.getElementById("copropMovObservaciones")?.value || "").trim().toUpperCase();
  const nombreNuevo = nombreTitularPrincipalCoprop(propNuevo);

  const payload = {
    clave_catastral: clave,
    clave_catastral_anterior: clave,
    clave_catastral_nueva: null,
    tipo_movimiento: "CAMBIO_TITULARIDAD",
    motivo: motivo,
    observaciones: observaciones,
    datos_anteriores: {
      propietarios: propAnterior,
      tenencia: tenAnt || null,
      nombre_completo: copropEstado.baseline?.nombre_padron || null
    },
    datos_nuevos: {
      propietarios: propNuevo.map(function(p) {
        return {
          id_persona: p.id_persona,
          porcentaje_propiedad: p.porcentaje_propiedad,
          tipo_titularidad: p.tipo_titularidad
        };
      }),
      tenencia: tenNueva || null,
      nombre_completo: nombreNuevo || null,
      nombre_propietario: nombreNuevo || null
    },
    detalles: construirDetallesMovimientoTitularidad(propAnterior, propNuevo, tenAnt, tenNueva)
  };

  if (!payload.detalles.length) {
    msgCoprop("copropMsgPredio", "No hay cambios para registrar.", false);
    return;
  }

  try {
    msgCoprop("copropMsgPredio", "Registrando solicitud de movimiento...", true);
    const r = await fetch(`${API}/movimientos`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo registrar la solicitud."));

    const mov = data.movimiento || data;
    msgCoprop(
      "copropMsgPredio",
      `Solicitud registrada: ${mov.folio || ("ID " + mov.id)}. Pendiente de autorización y aplicación.`,
      true
    );

    if (typeof cargarMovimientosPadron === "function") await cargarMovimientosPadron(clave);
    if (typeof abrirModalSeguimientoMovimiento === "function") abrirModalSeguimientoMovimiento(mov);

    await cargarCopropietariosPredio(clave);
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al registrar solicitud.", false);
  }
}
window.solicitarMovimientoTitularidadCoprop = solicitarMovimientoTitularidadCoprop;

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
          <button type="button" class="coprop-btn ok" onclick="guardarTenenciaPredio()">Capturar tenencia</button>
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
  if (requiereSolicitudMovimientoTitularidad()) {
    msgCoprop(
      "copropMsgCondominio",
      "Tenencia capturada en borrador. Registre la solicitud de movimiento para enviarla a autorización.",
      true
    );
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

  const props = copropEstado.propietarios || [];
  const nombreBorrador = formatearNombreVisibleTitularidad(props);
  const titular = data?.titular_padron || copropEstado.titularPadron;
  if (!titular && !nombreBorrador) {
    box.innerHTML = "";
    return;
  }

  const ok = data?.padron_sincronizado ?? copropEstado.padronSincronizado;
  if (ok && titular) {
    box.innerHTML = `<div class="coprop-padron-ok">✓ Titular en padrón: ${escapeHtml(titular)}</div>`;
    return;
  }

  const vacio = !props.length;
  box.innerHTML = `
    <div class="coprop-padron-alerta">
      <div><b>Titular en padrón:</b> ${escapeHtml(titular || "—")}</div>
      ${nombreBorrador ? `<div style="margin-top:4px;"><b>Con borrador actual:</b> ${escapeHtml(nombreBorrador)}</div>` : ""}
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

async function aplicarTitularPadronMasivo() {
  if (typeof puedeEditarTitularidad === "function" && !puedeEditarTitularidad()) {
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
  const ap = normalizarPersonaCatalogo(p.apellido_paterno);
  const am = normalizarPersonaCatalogo(p.apellido_materno);
  let nm = normalizarPersonaCatalogo(p.nombre);
  nm = nm.replace(/\s+Y\s+COP\.?\s*$/i, "").trim();
  const prefijo = [ap, am].filter(Boolean).join(" ");
  if (prefijo && nm) {
    if (nm.startsWith(prefijo + " ")) nm = nm.slice(prefijo.length + 1).trim();
    else if (nm === prefijo) nm = "";
  }
  const armado = [ap, am, nm].filter(Boolean).join(" ");
  if (armado) return armado;
  return normalizarPersonaCatalogo(String(p.nombre_completo || p.nombre || "").replace(/\s+Y\s+COP\.?\s*$/i, ""));
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
  const versionModal = "v52_guardar_principal";
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
    .coprop-solicitud-mov{margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;}
    .coprop-solicitud-mov label{display:block;font-size:11px;font-weight:bold;color:#475569;margin:6px 0 3px;}
    .coprop-solicitud-mov input,.coprop-solicitud-mov textarea{width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;box-sizing:border-box;}
    .coprop-solicitud-mov textarea{min-height:52px;resize:vertical;}
    .coprop-solicitud-nota{font-size:10px;color:#64748b;margin:6px 0 8px;line-height:1.35;}
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
    .coprop-principal-badge{display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:bold;white-space:nowrap;}
    .coprop-principal-radio{width:16px;height:16px;cursor:pointer;accent-color:#703341;}
    .coprop-principal-radio:disabled{cursor:default;opacity:.65;}
    .coprop-nombre-visible-preview{background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:12px;color:#1e3a8a;line-height:1.45;}
    .coprop-nombre-visible-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;}
    .coprop-nombre-visible-label{display:block;font-size:10px;font-weight:bold;color:#475569;}
    .coprop-btn-guardar-principal{font-size:11px;padding:4px 10px;white-space:nowrap;}
    tr.coprop-fila-principal{background:#fffbeb;}
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
          <div id="copropNombreVisiblePreview" class="oculto"></div>
          <div id="copropTotal" class="coprop-total">TOTAL: 0%</div>
          <div class="coprop-acciones-predio">
            <button type="button" class="coprop-btn sec" onclick="repartirPorcentajesCopropiedad()">Repartir automático</button>
          </div>
          <div class="coprop-solicitud-mov">
            <div class="coprop-solicitud-nota">Los cambios de titularidad, copropietarios y tenencia se registran como movimiento catastral. Un supervisor/administrador debe autorizar y aplicar al padrón.</div>
            <label for="copropMovMotivo">Motivo</label>
            <input type="text" id="copropMovMotivo" placeholder="ACTUALIZACION TITULARIDAD" maxlength="120">
            <label for="copropMovObservaciones">Observaciones</label>
            <textarea id="copropMovObservaciones" placeholder="Notas para revisión y autorización..."></textarea>
            <div class="coprop-acciones-predio" style="margin-top:8px;">
              <button type="button" class="coprop-btn ok" onclick="solicitarMovimientoTitularidadCoprop()">📋 Registrar solicitud de movimiento</button>
            </div>
          </div>
          <div id="copropMsgPredio" class="coprop-msg"></div>
          <div id="copropPermisoLectura" class="coprop-msg oculto">Modo consulta: puede ver titulares, pero no modificar propietarios ni copropietarios.</div>
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
  if (typeof puedeConsultarTitularidadCoprop === "function" && !puedeConsultarTitularidadCoprop()) {
    alert("No tiene permiso para consultar titularidad del predio.");
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
  aplicarPermisosUiCoprop();
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
    window._cachePropietariosPredioClave[String(clave).trim().toUpperCase()] = data;
    copropEstado.titularPadron = data.titular_padron || null;
    copropEstado.padronSincronizado = !!data.padron_sincronizado;
    copropEstado.condominio = data.condominio || null;
    const tenenciaBase = String(
      data.condominio?.regimen_padron?.tipo_codigo
      || data.condominio?.regimen_padron?.valor_padron
      || data.condominio?.tenencia
      || "P"
    ).trim().toUpperCase();
    copropEstado.baseline = {
      propietarios: JSON.parse(JSON.stringify(data.propietarios || [])),
      tenencia: tenenciaBase,
      nombre_padron: data.titular_padron?.nombre_completo || data.titular_padron?.nombre || ""
    };
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

  const props = ordenarTitularesCoprop(copropEstado.propietarios || []);
  copropEstado.propietarios = props;
  if (!props.length) {
    cont.innerHTML = "Sin propietarios registrados.";
  } else {
    cont.innerHTML = `
      <table class="coprop-table">
        <thead><tr><th>Propietario</th><th>Tipo</th><th>Principal visible</th><th>%</th><th>Acciones</th></tr></thead>
        <tbody>
          ${props.map((p) => {
            const esPrincipal = esPropietarioPrincipalCoprop(p);
            const soloUno = props.length <= 1;
            const radioPrincipal = `
              <label class="coprop-principal-radio-wrap" title="Aparece primero en ficha y padrón${props.length > 1 ? " (y copropietarios como Y COP.)" : ""}">
                <input type="radio" class="coprop-principal-radio" name="copropPrincipalSel"
                  ${esPrincipal ? "checked" : ""} ${soloUno ? "disabled" : ""}
                  onchange="marcarPropietarioPrincipalCoprop(${p.id_persona})">
              </label>`;
            return `
            <tr class="${esPrincipal ? "coprop-fila-principal" : ""}">
              <td><b>${escapeHtml(nombrePersonaCatalogo(p))}</b><br><small>ID persona: ${escapeHtml(p.id_persona)}</small></td>
              <td>${escapeHtml(p.tipo_titularidad || "")}</td>
              <td style="text-align:center;">${radioPrincipal}</td>
              <td><input type="number" step="0.01" min="0" max="100" value="${Number(p.porcentaje_propiedad || 0)}" onchange="actualizarPorcentajeLocalCoprop(${p.id_persona}, this.value)"></td>
              <td><button type="button" class="coprop-btn danger" onclick="quitarCopropietarioPredio(${p.id_persona})">Quitar</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  actualizarPreviewNombreVisibleCoprop();

  const suma = data?.suma_porcentaje ?? sumaCopropiedadLocal();
  const valido = Math.abs(Number(suma || 0) - 100) < 0.01;
  if (totalBox) {
    totalBox.textContent = `TOTAL COPROPIEDAD: ${Number(suma || 0).toFixed(2)}% ${valido ? "✓" : "⚠ DEBE SER 100%"}`;
    totalBox.className = valido ? "coprop-total ok" : "coprop-total error";
  }
  aplicarPermisosUiCoprop();
}

function actualizarPorcentajeLocalCoprop(idPersona, valor) {
  const idx = (copropEstado.propietarios || []).findIndex(function(p) {
    return Number(p.id_persona) === Number(idPersona);
  });
  if (idx < 0) return;
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
  return solicitarMovimientoTitularidadCoprop();
}

async function agregarCopropietarioPredio(idPersona, porcentaje = null) {
  try {
    const id = Number(idPersona);
    if ((copropEstado.propietarios || []).some(p => Number(p.id_persona) === id)) {
      msgCoprop("copropMsgPredio", "Esta persona ya está asignada al predio.", false);
      return;
    }

    const persona = await resolverPersonaCatalogo(id);
    copropEstado.seleccionCatalogo = persona;
    const nuevo = Object.assign({}, persona, { id_persona: id });
    const props = copropEstado.propietarios || [];

    if (!props.length) {
      nuevo.tipo_titularidad = "PROPIETARIO";
      nuevo.porcentaje_propiedad = porcentaje ?? 100;
      props.push(nuevo);
    } else {
      nuevo.tipo_titularidad = "COPROPIETARIO";
      if (sumaCopropiedadLocal() >= 99.99) {
        nuevo.porcentaje_propiedad = 0;
        props.push(nuevo);
        repartirPorcentajesCopropiedad();
      } else {
        nuevo.porcentaje_propiedad = porcentaje ?? porcentajeDefaultNuevoCopropietario();
        props.push(nuevo);
      }
    }

    copropEstado.propietarios = props;
    renderCopropietariosPredio();
    msgCoprop(
      "copropMsgPredio",
      requiereSolicitudMovimientoTitularidad()
        ? "Titular agregado en borrador. Registre la solicitud de movimiento para aplicar."
        : "Propietario agregado. Revisa que el total sea 100%.",
      true
    );
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al agregar propietario.", false);
  }
}

async function quitarCopropietarioPredio(idPersona) {
  if (!confirm("¿Quitar este propietario del borrador del predio?")) return;

  try {
    const id = Number(idPersona);
    copropEstado.propietarios = (copropEstado.propietarios || []).filter(p => Number(p.id_persona) !== id);
    if (copropEstado.propietarios.length === 1) {
      copropEstado.propietarios[0].tipo_titularidad = "PROPIETARIO";
      copropEstado.propietarios[0].porcentaje_propiedad = 100;
    }
    renderCopropietariosPredio();
    msgCoprop(
      "copropMsgPredio",
      requiereSolicitudMovimientoTitularidad()
        ? "Titular quitado del borrador. Registre la solicitud de movimiento para aplicar."
        : "Propietario quitado. Revisa porcentajes.",
      true
    );
  } catch (e) {
    msgCoprop("copropMsgPredio", e.message || "Error al quitar propietario.", false);
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
    const data = typeof fetchPropietariosPredioCached === "function"
      ? await fetchPropietariosPredioCached(claveFinal)
      : null;
    if (!data) {
      const r = await fetch(`${API}/predios/${encodeURIComponent(claveFinal)}/propietarios?_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const parsed = await r.json();
      if (!r.ok) throw new Error(parsed.detail || "No se pudo cargar titularidad.");
      renderTitularidadFichaDestinos(destinos, parsed);
      return;
    }
    renderTitularidadFichaDestinos(destinos, data);
  } catch (e) {
    destinos.forEach(d => d.innerHTML = `<div class="coprop-msg error">${escapeHtml(e.message)}</div>`);
  }
}

function renderTitularidadFichaDestinos(destinos, data) {
  const props = ordenarTitularesCoprop(data.propietarios || []);
  const nombreVisible = data.nombre_visible || formatearNombreVisibleTitularidad(props);
  const html = props.length ? `
    ${nombreVisible ? `<div class="ficha-mini-row"><div class="label">Nombre visible</div><div class="value">${escapeHtml(nombreVisible)}</div></div>` : ""}
    <table class="coprop-table">
      <thead><tr><th>Principal</th><th>Nombre</th><th>Tipo</th><th>%</th></tr></thead>
      <tbody>
        ${props.map(p => `
          <tr class="${esPropietarioPrincipalCoprop(p) ? "coprop-fila-principal" : ""}">
            <td style="text-align:center;">${esPropietarioPrincipalCoprop(p) ? "★" : ""}</td>
            <td>${escapeHtml(nombrePersonaCatalogo(p))}</td>
            <td>${escapeHtml(p.tipo_titularidad || "")}</td>
            <td>${Number(p.porcentaje_propiedad || 0).toFixed(2)}%</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="coprop-total ${data.valido ? "ok" : "error"}">TOTAL: ${Number(data.suma_porcentaje || 0).toFixed(2)}%</div>
  ` : "Sin propietarios registrados.";
  destinos.forEach(d => d.innerHTML = html);
  if (nombreVisible) {
    actualizarNombreVisibleEnFichaDom(nombreVisible);
  }
}

function actualizarNombreVisibleEnFichaDom(nombre) {
  ["fichaNombreVisible", "fichaNombreVisibleTab", "fichaNombreVisibleTit"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = nombre || "—";
  });
}

async function cargarNombreVisibleFicha(clave) {
  const claveFinal = normalizarPersonaCatalogo(clave || document.getElementById("claveInput")?.value);
  if (!claveFinal) return;
  const p = window.predioSeleccionado;
  if (p && String(p.clave_catastral || "").trim().toUpperCase() === claveFinal && p.nombre_completo) {
    actualizarNombreVisibleEnFichaDom(p.nombre_completo);
    return;
  }
  try {
    let data = null;
    if (typeof fetchPropietariosPredioCached === "function") {
      data = await fetchPropietariosPredioCached(claveFinal);
    }
    if (!data) {
      const r = await fetch(`${API}/predios/${encodeURIComponent(claveFinal)}/propietarios?_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      data = await r.json().catch(function() { return null; });
      if (!r.ok) data = null;
    }
    if (!data) return;
    const nombre = data.nombre_visible || formatearNombreVisibleTitularidad(data.propietarios);
    if (nombre) actualizarNombreVisibleEnFichaDom(nombre);
  } catch (e) {
    console.warn("No se pudo cargar nombre visible:", e);
  }
}
window.cargarNombreVisibleFicha = cargarNombreVisibleFicha;

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
  const data = await fetchPropietariosPredioCached(clave);
  if (!data) return null;
  const rows = data.propietarios || [];
  if (!rows.length) return null;
  const principal = rows.find(x => String(x.tipo_titularidad || "").toUpperCase() === "PROPIETARIO") || rows[0];
  return principal || null;
}

window._cachePropietariosPredioClave = window._cachePropietariosPredioClave || {};
window._inflightPropietariosPredio = window._inflightPropietariosPredio || {};

function invalidarCachePropietariosPredio(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (claveNorm) delete window._cachePropietariosPredioClave[claveNorm];
}

async function fetchPropietariosPredioCached(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;

  if (window._cachePropietariosPredioClave[claveNorm]) {
    return window._cachePropietariosPredioClave[claveNorm];
  }
  if (window._inflightPropietariosPredio[claveNorm]) {
    return window._inflightPropietariosPredio[claveNorm];
  }

  const prom = (async () => {
    try {
      const r = await fetch(`${API}/predios/${encodeURIComponent(claveNorm)}/propietarios?_=${Date.now()}`, {
        cache: "no-store",
        headers: typeof authHeaders === "function" ? authHeaders() : {}
      });
      if (!r.ok) return null;
      const data = await r.json();
      window._cachePropietariosPredioClave[claveNorm] = data;
      return data;
    } catch (e) {
      console.warn("No se pudo leer propietarios del predio:", e);
      return null;
    }
  })();

  window._inflightPropietariosPredio[claveNorm] = prom;
  try {
    return await prom;
  } finally {
    delete window._inflightPropietariosPredio[claveNorm];
  }
}
window.fetchPropietariosPredioCached = fetchPropietariosPredioCached;
window.invalidarCachePropietariosPredio = invalidarCachePropietariosPredio;

function faltanDatosPadronEnFicha(p) {
  if (!p) return true;
  return !p.delegacion && p.valor2026 == null && p.sup_documental == null && !p.descripcion_uso;
}

async function fichaEnriquecidaPadronV28b(p) {
  const base = { ...(p || {}) };
  const clave = String(base.clave_catastral || base.clave || "").trim().toUpperCase();
  if (!clave) return base;
  if (base.__enriquecidaV28b) return base;

  let merged = { ...base };

  const cacheFeature = window._cacheFeaturePredioPorClave?.[clave];
  let dataPadron = cacheFeature || null;
  const necesitaFichaRemota = !dataPadron && faltanDatosPadronEnFicha(merged);

  const fichaPadronPromise = necesitaFichaRemota
    ? fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
        cache: "no-store",
        headers: authHeaders()
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(e => { console.warn("No se pudo enriquecer ficha con padrón:", e); return null; })
    : Promise.resolve(dataPadron);

  const [titularidadData, dataPadronFetched] = await Promise.all([
    typeof fetchPropietariosPredioCached === "function"
      ? fetchPropietariosPredioCached(clave)
      : Promise.resolve(null),
    fichaPadronPromise
  ]);
  const titular = titularidadData?.propietarios?.length
    ? (titularidadData.propietarios.find(x => String(x.tipo_titularidad || "").toUpperCase() === "PROPIETARIO")
      || titularidadData.propietarios[0])
    : await titularCatalogoPredio(clave);

  if (!dataPadron && dataPadronFetched) {
    dataPadron = dataPadronFetched;
    if (dataPadronFetched?.geometry || dataPadronFetched?.properties) {
      window._cacheFeaturePredioPorClave = window._cacheFeaturePredioPorClave || {};
      window._cacheFeaturePredioPorClave[clave] = dataPadronFetched;
    }
  }

  // 1) Datos del padrón (geometría, valores, ubicación, etc.).
  let nombrePadron = "";
  if (dataPadron) {
    const props = dataPadron?.properties || dataPadron || {};
    merged = { ...merged, ...props };
    nombrePadron = (props.nombre_completo || props.propietario || "").trim();
  }

  // 2) Titular del catálogo (prioritario para el nombre visible).
  let nombreCatalogo = "";
  if (titularidadData?.nombre_visible) {
    nombreCatalogo = String(titularidadData.nombre_visible).trim();
  } else if (titularidadData?.propietarios?.length && typeof formatearNombreVisibleTitularidad === "function") {
    nombreCatalogo = formatearNombreVisibleTitularidad(titularidadData.propietarios);
  } else if (titular) {
    nombreCatalogo = (typeof nombrePersonaCatalogo === "function"
      ? nombrePersonaCatalogo(titular)
      : (titular.nombre_completo || titular.razon_social || "")).trim();
  }
  if (titular) {
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

function fichaPinturaSigueVigenteV28b(claveEsperada, seqLocal) {
  if (seqLocal != null && seqLocal !== seleccionPredioSeq) return false;
  const claveNorm = String(claveEsperada || "").trim().toUpperCase();
  const claveActual = String(claveSeleccionadaActual || "").trim().toUpperCase();
  if (claveNorm && claveActual && claveNorm !== claveActual) return false;
  return true;
}

if (typeof pintarFichaFlotante === 'function' && !window.__pintarFichaFlotanteBaseV28b) {
  window.__pintarFichaFlotanteBaseV28b = pintarFichaFlotante;
  pintarFichaFlotante = async function(p) {
    const claveEsperada = String(p?.clave_catastral || p?.clave || "").trim().toUpperCase();
    const seqLocal = seleccionPredioSeq;
    if (!fichaPinturaSigueVigenteV28b(claveEsperada, seqLocal)) return;
    window.predioSeleccionado = p;
    return window.__pintarFichaFlotanteBaseV28b(p);
  };
  window.pintarFichaFlotante = pintarFichaFlotante;
}

if (typeof pintarFicha === 'function' && !window.__pintarFichaBaseV28b) {
  window.__pintarFichaBaseV28b = pintarFicha;
  pintarFicha = async function(p) {
    if (p?.__enriquecidaV28b) {
      window.predioSeleccionado = p;
      return window.__pintarFichaBaseV28b(p);
    }
    const claveEsperada = String(p?.clave_catastral || p?.clave || "").trim().toUpperCase();
    const seqLocal = seleccionPredioSeq;
    window.predioSeleccionado = p;
    window.__pintarFichaBaseV28b(p);

    try {
      const enriquecida = await fichaEnriquecidaPadronV28b(p);
      if (!fichaPinturaSigueVigenteV28b(claveEsperada, seqLocal)) return;
      enriquecida.__enriquecidaV28b = true;
      window.predioSeleccionado = enriquecida;
      if (typeof refrescarPopupPredioSiAbierto === "function") {
        refrescarPopupPredioSiAbierto(enriquecida);
      }
      return window.__pintarFichaBaseV28b(enriquecida);
    } catch (e) {
      console.warn("No se pudo enriquecer ficha en segundo plano:", e);
    }
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
  if (typeof puedeEditarNombreContribuyente === "function" && !puedeEditarNombreContribuyente()) {
    alert("Su rol no tiene permiso para solicitar cambio de nombre del contribuyente.");
    return;
  }
  if (typeof puedeSolicitarMovimientos === "function" && !puedeSolicitarMovimientos()) {
    alert("Su rol no tiene permiso para registrar movimientos catastrales.");
    return;
  }
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

/* El refresco automático al cargar provocaba saltos de selección; usar selección explícita del usuario. */

/* ============================================================
   v28c - Restaurar guardado del modal Cambio de Nombre/Titular
============================================================ */

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
  if (typeof puedeEditarNombreContribuyente === "function" && !puedeEditarNombreContribuyente()) {
    modalMovimientoMensaje("Su rol no tiene permiso para solicitar cambio de nombre.", false);
    return;
  }
  if (typeof puedeSolicitarMovimientos === "function" && !puedeSolicitarMovimientos()) {
    modalMovimientoMensaje("Su rol no tiene permiso para registrar movimientos catastrales.", false);
    return;
  }
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

