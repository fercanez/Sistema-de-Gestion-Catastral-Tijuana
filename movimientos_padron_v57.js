/* ============================================================
   v57 - Modales guiados para movimientos al padron
============================================================ */
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
      { key: "descripcion_uso", label: "Uso de suelo", padronKey: "descripcion_uso", tipo: "text" }
    ]
  },
  CAMBIO_ZONA_HOMOGENEA: {
    titulo: "Cambio de zona homogenea",
    icono: "🗺️",
    desc: "Actualiza la zona homogenea (zonah) del predio.",
    campos: [
      { key: "zonah", label: "Zona homogenea", padronKey: "zona_homogenea", tipo: "text" }
    ]
  },
  ASIGNACION_NUMERO_OFICIAL: {
    titulo: "Asignacion de numero oficial",
    icono: "🔢",
    desc: "Asigna numero oficial al predio.",
    campos: [
      { key: "numof", label: "Numero oficial", padronKey: "numof", tipo: "text" }
    ]
  },
  CAMBIO_NUMERO_OFICIAL: {
    titulo: "Cambio de numero oficial",
    icono: "🔢",
    desc: "Modifica el numero oficial existente.",
    campos: [
      { key: "numof", label: "Numero oficial nuevo", padronKey: "numof", tipo: "text" }
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
    desc: "Registra una nueva clave en el padron.",
    sinClaveOrigen: true,
    campos: [
      { key: "clave_catastral", label: "Clave catastral nueva", tipo: "text", required: true, esClaveAlta: true },
      { key: "nombre_completo", label: "Nombre / titular", padronKey: "nombre_completo", tipo: "text", required: true },
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

function obtenerClaveParaMovimiento() {
  return String(
    document.getElementById("movClave")?.value ||
    (typeof obtenerClaveSeleccionadaActual === "function" ? obtenerClaveSeleccionadaActual() : "") ||
    document.getElementById("claveInput")?.value ||
    ""
  ).trim().toUpperCase();
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

function renderCamposMovimientoPadron(cfg, ficha) {
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
    const valAnt = ficha && c.padronKey ? (ficha[c.padronKey] ?? ficha[c.key] ?? "") : "";
    const valInput = c.esClaveAlta ? "" : (c.esClaveNueva ? "" : valAnt);
    html += `
      <label class="input-label-mini">${escapeHtml(c.label)}${c.required ? " *" : ""}</label>
      <input type="${c.tipo || "text"}" id="movPadron_${c.key}"
        data-campo="${c.key}" data-padron="${c.padronKey || c.key}"
        data-anterior="${escapeHtml(valAnt)}"
        value="${escapeHtml(valInput === null || valInput === undefined ? "" : valInput)}"
        placeholder="${escapeHtml(c.label.toUpperCase())}">`;
    if (valAnt !== "" && valAnt !== null && valAnt !== undefined && !c.esClaveNueva && !c.esClaveAlta) {
      html += `<div class="mov-valor-anterior">Actual: ${escapeHtml(valAnt)}</div>`;
    }
  });

  cont.innerHTML = html;
  if (typeof activarMayusculasOperativas === "function") {
    activarMayusculasOperativas(document.getElementById("modalMovimientoPadron"));
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

  const movTipo = document.getElementById("movTipo");
  if (movTipo) movTipo.value = tipo;
  const movClave = document.getElementById("movClave");
  if (movClave && clave) movClave.value = clave;

  document.getElementById("movPadronIcon").textContent = cfg.icono || "📋";
  document.getElementById("movPadronTitulo").textContent = cfg.titulo;
  document.getElementById("movPadronDesc").textContent = cfg.desc || "";
  document.getElementById("movPadronMotivo").value = "";
  document.getElementById("movPadronObservaciones").value = "";
  setMovPadronMensaje("", true);

  renderCamposMovimientoPadron(cfg, movPadronEstado.ficha);

  const modal = document.getElementById("modalMovimientoPadron");
  modal.classList.remove("oculto");
}
window.abrirModalMovimientoPadron = abrirModalMovimientoPadron;

async function guardarModalMovimientoPadron() {
  if (movPadronEstado.guardando) return;
  movPadronEstado.guardando = true;

  try {
    const tipo = movPadronEstado.tipo;
    const cfg = CATALOGO_MOVIMIENTOS_PADRON[tipo];
    if (!cfg) throw new Error("Tipo de movimiento invalido");

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
      const el = document.getElementById("movPadron_" + c.key);
      const val = (el?.value || "").trim();
      if (c.required && !val) throw new Error("Capture: " + c.label);
      if (!val) return;

      const valAnt = el?.dataset?.anterior || "";
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
      tipo_movimiento: tipo,
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
