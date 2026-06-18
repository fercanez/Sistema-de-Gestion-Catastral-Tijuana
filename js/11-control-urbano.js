/* Control Urbano — documentos por predio (licencia de construcción, uso de suelo). */

const POPUP_CONTROL_URBANO_SLOTS = [
  {
    slot: "licencia_construccion",
    label: "Licencia de construcción",
    icono: "🏗️",
    hint: "PDF o imagen del permiso de construcción vigente."
  },
  {
    slot: "uso_suelo_autorizado",
    label: "Uso de suelo autorizado",
    icono: "📋",
    hint: "PDF o imagen del dictamen o autorización de uso de suelo."
  }
];

let popupControlUrbanoClaveActual = "";
window.popupControlUrbanoClaveActual = popupControlUrbanoClaveActual;
const popupControlUrbanoEstado = {
  licencia_construccion: { docs: [], seleccionadoId: null },
  uso_suelo_autorizado: { docs: [], seleccionadoId: null }
};

function cuEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function puedeGestionarControlUrbano() {
  return typeof puedeEditarCatastro === "function" && puedeEditarCatastro();
}

function authUploadHeadersControlUrbano() {
  const token = typeof obtenerTokenInstitucional === "function" ? obtenerTokenInstitucional() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function urlDocumentoControlUrbano(clave, nombreArchivo) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  const archivo = String(nombreArchivo || "").replace(/^\/+/, "");
  if (!claveNorm || !archivo) return "";
  return `${API}/documentos/${encodeURIComponent(claveNorm)}/${archivo.split("/").map(encodeURIComponent).join("/")}`;
}

function esImagenControlUrbano(nombreArchivo) {
  return /\.(jpe?g|png|webp|gif)$/i.test(String(nombreArchivo || ""));
}

function esPdfControlUrbano(nombreArchivo) {
  return /\.pdf$/i.test(String(nombreArchivo || ""));
}

function nombreCortoControlUrbano(nombreArchivo) {
  return String(nombreArchivo || "").split("/").pop() || "documento";
}

function formatearFechaControlUrbano(valor) {
  if (!valor) return "—";
  try {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor);
    return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  } catch (e) {
    return String(valor);
  }
}

function mensajeErrorControlUrbano(r, data, fallback) {
  if (r && r.status === 404) {
    return "El servicio de control urbano no está activo en el servidor. Suba routers/expediente.py y reinicie la API.";
  }
  if (r && r.status === 401) return "Sesión expirada. Vuelva a iniciar sesión.";
  if (r && r.status === 403) return "No tiene permisos para gestionar documentos de control urbano.";
  return typeof extraerMensajeApi === "function" ? extraerMensajeApi(data, fallback) : (data?.detail || fallback);
}

function estadoSlotControlUrbano(slot) {
  if (!popupControlUrbanoEstado[slot]) {
    popupControlUrbanoEstado[slot] = { docs: [], seleccionadoId: null };
  }
  return popupControlUrbanoEstado[slot];
}

function docSeleccionadoControlUrbano(slot) {
  const st = estadoSlotControlUrbano(slot);
  if (!st.docs.length) return null;
  const id = st.seleccionadoId;
  return st.docs.find(d => Number(d.id_documento) === Number(id)) || st.docs[0];
}

function htmlTarjetaControlUrbano(def, claveNorm) {
  const puedeEditar = puedeGestionarControlUrbano();
  const acciones = `
    <div class="popup-cu-doc-acciones">
      ${puedeEditar ? `<button type="button" class="popup-cu-doc-btn" onclick="seleccionarDocControlUrbano('${def.slot}')">Subir</button>` : ""}
      <button type="button" class="popup-cu-doc-btn popup-cu-doc-btn-ver" id="popupCuBtnVer_${def.slot}" onclick="abrirDocControlUrbano('${def.slot}')" style="display:none" title="Abrir en ventana nueva">Abrir ventana</button>
      <button type="button" class="popup-cu-doc-btn popup-cu-doc-btn-ver-int" id="popupCuBtnVerInt_${def.slot}" onclick="verDocControlUrbanoIntegrado('${def.slot}')" style="display:none" title="Ver en visor integrado">Ver aquí</button>
      ${puedeEditar ? `<button type="button" class="popup-cu-doc-btn popup-cu-doc-btn-borrar" id="popupCuBtnBorrar_${def.slot}" onclick="eliminarDocControlUrbano('${def.slot}')" style="display:none">Borrar</button>` : ""}
    </div>
    ${puedeEditar ? `<input type="file" id="popupCuInput_${def.slot}" class="popup-cu-doc-input" accept=".pdf,image/jpeg,image/png,image/webp" hidden onchange="subirDocControlUrbano('${def.slot}', this)">` : ""}`;

  return `
    <article class="popup-cu-doc-card" id="popupCuCard_${def.slot}" data-slot="${def.slot}">
      <header class="popup-cu-doc-head">
        <span class="popup-cu-doc-icono" aria-hidden="true">${def.icono}</span>
        <div>
          <h4>${cuEsc(def.label)}</h4>
          <p>${cuEsc(def.hint)}</p>
        </div>
      </header>
      <div class="popup-cu-doc-vigente-label" id="popupCuVigente_${def.slot}">Último documento</div>
      <div class="popup-cu-doc-preview" id="popupCuPreview_${def.slot}" title="Clic para abrir en ventana nueva">
        <span class="popup-cu-doc-placeholder">Sin documento cargado</span>
      </div>
      <div class="popup-cu-doc-meta" id="popupCuMeta_${def.slot}"></div>
      <div class="popup-cu-doc-historial">
        <div class="popup-cu-doc-historial-titulo">Documentos disponibles</div>
        <ul class="popup-cu-doc-lista" id="popupCuLista_${def.slot}">
          <li class="popup-cu-doc-lista-vacio">Sin registros</li>
        </ul>
      </div>
      ${acciones}
    </article>`;
}

function htmlPreviewControlUrbano(claveNorm, doc, def) {
  const url = urlDocumentoControlUrbano(claveNorm, doc.nombre_archivo);
  if (esImagenControlUrbano(doc.nombre_archivo)) {
    return `<img src="${cuEsc(url)}" alt="${cuEsc(def.label)}" class="popup-cu-doc-img">`;
  }
  if (esPdfControlUrbano(doc.nombre_archivo)) {
    return `
      <iframe class="popup-cu-doc-iframe" src="${cuEsc(url)}" title="${cuEsc(def.label)}"></iframe>`;
  }
  return `
    <div class="popup-cu-doc-pdf">
      <span class="popup-cu-doc-pdf-icono" aria-hidden="true">📄</span>
      <span class="popup-cu-doc-pdf-nombre">${cuEsc(nombreCortoControlUrbano(doc.nombre_archivo))}</span>
    </div>`;
}

function pintarPreviewControlUrbano(claveNorm, slot, doc) {
  const preview = document.getElementById(`popupCuPreview_${slot}`);
  const meta = document.getElementById(`popupCuMeta_${slot}`);
  const card = document.getElementById(`popupCuCard_${slot}`);
  const btnVer = document.getElementById(`popupCuBtnVer_${slot}`);
  const btnVerInt = document.getElementById(`popupCuBtnVerInt_${slot}`);
  const btnBorrar = document.getElementById(`popupCuBtnBorrar_${slot}`);
  const vigenteLbl = document.getElementById(`popupCuVigente_${slot}`);
  const def = POPUP_CONTROL_URBANO_SLOTS.find(s => s.slot === slot) || { label: slot };

  if (!preview) return;

  if (!doc || !doc.nombre_archivo) {
    preview.innerHTML = `<span class="popup-cu-doc-placeholder">Sin documento cargado</span>`;
    preview.dataset.url = "";
    preview.dataset.idDocumento = "";
    preview.onclick = null;
    preview.style.cursor = "";
    if (meta) meta.innerHTML = "";
    if (card) card.classList.remove("con-documento");
    if (btnVer) btnVer.style.display = "none";
    if (btnVerInt) btnVerInt.style.display = "none";
    if (btnBorrar) btnBorrar.style.display = "none";
    if (vigenteLbl) vigenteLbl.style.display = "none";
    return;
  }

  const url = urlDocumentoControlUrbano(claveNorm, doc.nombre_archivo);
  preview.dataset.url = url;
  preview.dataset.idDocumento = String(doc.id_documento || "");
  preview.innerHTML = htmlPreviewControlUrbano(claveNorm, doc, def);
  preview.style.cursor = "pointer";
  preview.title = "Clic para abrir en ventana nueva";
  preview.onclick = function() { abrirDocControlUrbano(slot); };

  const esUltimo = !!doc.es_actual;
  if (vigenteLbl) {
    vigenteLbl.style.display = "";
    vigenteLbl.textContent = esUltimo ? "Último documento" : "Documento seleccionado del historial";
  }

  if (meta) {
    meta.innerHTML = `
      <div><b>Archivo:</b> ${cuEsc(nombreCortoControlUrbano(doc.nombre_archivo))}</div>
      <div><b>Cargado:</b> ${cuEsc(formatearFechaControlUrbano(doc.fecha_carga))}</div>
      <div><b>Usuario:</b> ${cuEsc(doc.usuario_carga || "—")}</div>`;
  }
  if (card) card.classList.add("con-documento");
  if (btnVer) btnVer.style.display = "";
  if (btnVerInt) btnVerInt.style.display = "";
  if (btnBorrar && puedeGestionarControlUrbano()) btnBorrar.style.display = "";
}

function pintarListaControlUrbano(slot) {
  const lista = document.getElementById(`popupCuLista_${slot}`);
  if (!lista) return;
  const st = estadoSlotControlUrbano(slot);
  const docs = st.docs || [];
  if (!docs.length) {
    lista.innerHTML = `<li class="popup-cu-doc-lista-vacio">Sin registros</li>`;
    return;
  }
  lista.innerHTML = docs.map(function(doc) {
    const activo = Number(st.seleccionadoId) === Number(doc.id_documento)
      || (!st.seleccionadoId && doc.es_actual);
    const badge = doc.es_actual ? `<span class="popup-cu-doc-badge">Último</span>` : "";
    return `
      <li class="popup-cu-doc-lista-item${activo ? " activo" : ""}">
        <button type="button" class="popup-cu-doc-lista-btn" onclick="seleccionarDocControlUrbanoHistorial('${slot}', ${Number(doc.id_documento)})">
          <span class="popup-cu-doc-lista-fecha">${cuEsc(formatearFechaControlUrbano(doc.fecha_carga))}</span>
          <span class="popup-cu-doc-lista-nombre">${cuEsc(nombreCortoControlUrbano(doc.nombre_archivo))}</span>
          ${badge}
        </button>
        <button type="button" class="popup-cu-doc-lista-abrir" onclick="abrirDocControlUrbanoPorId('${slot}', ${Number(doc.id_documento)})" title="Abrir en ventana nueva">↗</button>
      </li>`;
  }).join("");
}

function seleccionarDocControlUrbanoHistorial(slot, idDocumento) {
  const st = estadoSlotControlUrbano(slot);
  st.seleccionadoId = Number(idDocumento);
  pintarListaControlUrbano(slot);
  pintarPreviewControlUrbano(popupControlUrbanoClaveActual, slot, docSeleccionadoControlUrbano(slot));
}
window.seleccionarDocControlUrbanoHistorial = seleccionarDocControlUrbanoHistorial;

function abrirDocControlUrbanoPorId(slot, idDocumento) {
  const st = estadoSlotControlUrbano(slot);
  const doc = (st.docs || []).find(d => Number(d.id_documento) === Number(idDocumento));
  if (!doc) return;
  const url = urlDocumentoControlUrbano(popupControlUrbanoClaveActual, doc.nombre_archivo);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
window.abrirDocControlUrbanoPorId = abrirDocControlUrbanoPorId;

function actualizarNotaControlUrbano(historialPorSlot, avisoExtra) {
  const nota = document.getElementById("popupControlUrbanoNota");
  if (!nota) return;
  if (avisoExtra) {
    nota.textContent = avisoExtra;
    nota.classList.add("popup-cu-nota-alerta");
    return;
  }
  nota.classList.remove("popup-cu-nota-alerta");
  const lic = (historialPorSlot?.licencia_construccion || []).length;
  const uso = (historialPorSlot?.uso_suelo_autorizado || []).length;
  nota.textContent = `Licencia: ${lic} documento(s) · Uso de suelo: ${uso} documento(s) · Total: ${lic + uso}`;
}

async function cargarDocumentosControlUrbano(claveNorm) {
  popupControlUrbanoClaveActual = claveNorm;
  window.popupControlUrbanoClaveActual = claveNorm;
  try {
    const r = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}/control-urbano`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (r.status === 404) {
      actualizarNotaControlUrbano({}, "Servicio de control urbano no desplegado en la API. Contacte al administrador.");
      return;
    }
    if (!r.ok) {
      actualizarNotaControlUrbano({}, mensajeErrorControlUrbano(r, await r.json().catch(() => ({})), "No se pudieron cargar los documentos."));
      return;
    }
    const data = await r.json();
    let historial = data.historial_por_slot || {};
    if (!historial.licencia_construccion && !historial.uso_suelo_autorizado && (data.documentos || []).length) {
      historial = { licencia_construccion: [], uso_suelo_autorizado: [] };
      (data.documentos || []).forEach(function(doc) {
        if (historial[doc.slot]) historial[doc.slot].push(doc);
      });
    }

    POPUP_CONTROL_URBANO_SLOTS.forEach(function(def) {
      const docs = historial[def.slot] || [];
      const st = estadoSlotControlUrbano(def.slot);
      st.docs = docs;
      const previo = st.seleccionadoId;
      const sigueExistiendo = docs.some(d => Number(d.id_documento) === Number(previo));
      st.seleccionadoId = sigueExistiendo ? previo : (docs[0]?.id_documento || null);
      pintarListaControlUrbano(def.slot);
      pintarPreviewControlUrbano(claveNorm, def.slot, docSeleccionadoControlUrbano(def.slot));
    });
    actualizarNotaControlUrbano(historial);
  } catch (e) {
    actualizarNotaControlUrbano({}, e.message || String(e));
  }
}

function seleccionarDocControlUrbano(slot) {
  if (!puedeGestionarControlUrbano()) {
    alert("No tiene permisos para cargar documentos de control urbano.");
    return;
  }
  document.getElementById(`popupCuInput_${slot}`)?.click();
}

function abrirDocControlUrbano(slot) {
  const doc = docSeleccionadoControlUrbano(slot);
  if (!doc) return;
  abrirDocControlUrbanoPorId(slot, doc.id_documento);
}

function asegurarVisorControlUrbano() {
  let overlay = document.getElementById("popupControlUrbanoLightbox");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "popupControlUrbanoLightbox";
  overlay.className = "popup-cu-lightbox oculto";
  overlay.innerHTML = `
    <div class="popup-cu-lightbox-backdrop" onclick="cerrarVisorControlUrbano()"></div>
    <div class="popup-cu-lightbox-panel" role="dialog" aria-modal="true">
      <div class="popup-cu-lightbox-head">
        <span id="popupControlUrbanoLightboxTitulo">Documento</span>
        <div class="popup-cu-lightbox-acciones">
          <button type="button" class="popup-cu-doc-btn popup-cu-doc-btn-ver" id="popupControlUrbanoLightboxExterno">Abrir ventana</button>
          <button type="button" class="popup-cu-lightbox-cerrar" onclick="cerrarVisorControlUrbano()" title="Cerrar">×</button>
        </div>
      </div>
      <div class="popup-cu-lightbox-body" id="popupControlUrbanoLightboxBody"></div>
    </div>`;
  document.body.appendChild(overlay);
  if (!window.__popupControlUrbanoLightboxEsc) {
    window.__popupControlUrbanoLightboxEsc = true;
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") cerrarVisorControlUrbano();
    });
  }
  return overlay;
}

function verDocControlUrbanoIntegrado(slot) {
  const doc = docSeleccionadoControlUrbano(slot);
  if (!doc) return;
  const url = urlDocumentoControlUrbano(popupControlUrbanoClaveActual, doc.nombre_archivo);
  if (!url) return;
  const def = POPUP_CONTROL_URBANO_SLOTS.find(s => s.slot === slot) || { label: "Documento" };
  const overlay = asegurarVisorControlUrbano();
  const body = document.getElementById("popupControlUrbanoLightboxBody");
  const titulo = document.getElementById("popupControlUrbanoLightboxTitulo");
  const btnExt = document.getElementById("popupControlUrbanoLightboxExterno");
  if (titulo) titulo.textContent = def.label;
  if (btnExt) btnExt.onclick = function() { window.open(url, "_blank", "noopener,noreferrer"); };
  if (body) {
    if (esImagenControlUrbano(doc.nombre_archivo)) {
      body.innerHTML = `<img src="${cuEsc(url)}" alt="${cuEsc(def.label)}" class="popup-cu-lightbox-img">`;
    } else if (esPdfControlUrbano(doc.nombre_archivo)) {
      body.innerHTML = `<iframe class="popup-cu-lightbox-iframe" src="${cuEsc(url)}" title="${cuEsc(def.label)}"></iframe>`;
    } else {
      body.innerHTML = `<p class="popup-cu-lightbox-sinvisor">Use «Abrir ventana» para consultar este archivo.</p>`;
    }
  }
  overlay.classList.remove("oculto");
  document.body.classList.add("popup-cu-lightbox-abierto");
}
window.verDocControlUrbanoIntegrado = verDocControlUrbanoIntegrado;

function cerrarVisorControlUrbano() {
  const overlay = document.getElementById("popupControlUrbanoLightbox");
  if (!overlay) return;
  overlay.classList.add("oculto");
  document.body.classList.remove("popup-cu-lightbox-abierto");
  const body = document.getElementById("popupControlUrbanoLightboxBody");
  if (body) body.innerHTML = "";
}
window.cerrarVisorControlUrbano = cerrarVisorControlUrbano;

async function subirDocControlUrbano(slot, input) {
  if (!puedeGestionarControlUrbano()) {
    alert("No tiene permisos para cargar documentos.");
    return;
  }
  const claveNorm = popupControlUrbanoClaveActual;
  const archivo = input?.files?.[0];
  if (!claveNorm || !archivo) return;

  const form = new FormData();
  form.append("slot", slot);
  form.append("archivo", archivo);

  const btn = document.querySelector(`#popupCuCard_${slot} .popup-cu-doc-btn:not(.popup-cu-doc-btn-ver):not(.popup-cu-doc-btn-ver-int):not(.popup-cu-doc-btn-borrar)`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Subiendo…";
  }

  try {
    const r = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}/control-urbano`, {
      method: "POST",
      headers: authUploadHeadersControlUrbano(),
      body: form
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(mensajeErrorControlUrbano(r, data, "No se pudo subir el documento"));
    }
    estadoSlotControlUrbano(slot).seleccionadoId = data.id_documento || null;
    await cargarDocumentosControlUrbano(claveNorm);
  } catch (e) {
    alert(e.message || "No se pudo subir el documento.");
  } finally {
    if (input) input.value = "";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Subir";
    }
  }
}

async function eliminarDocControlUrbano(slot) {
  if (!puedeGestionarControlUrbano()) {
    alert("No tiene permisos para borrar documentos.");
    return;
  }
  const claveNorm = popupControlUrbanoClaveActual;
  const doc = docSeleccionadoControlUrbano(slot);
  const idDocumento = doc?.id_documento;
  if (!claveNorm || !idDocumento) return;
  if (!confirm("¿Eliminar el documento seleccionado del expediente?")) return;

  try {
    const r = await fetch(
      `${API}/expediente/${encodeURIComponent(claveNorm)}/control-urbano/${encodeURIComponent(idDocumento)}`,
      {
        method: "DELETE",
        headers: typeof authHeaders === "function" ? authHeaders() : {}
      }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(mensajeErrorControlUrbano(r, data, "No se pudo eliminar el documento"));
    }
    estadoSlotControlUrbano(slot).seleccionadoId = null;
    await cargarDocumentosControlUrbano(claveNorm);
  } catch (e) {
    alert(e.message || "No se pudo eliminar el documento.");
  }
}

async function pintarPopupTabControlUrbano(clave, p) {
  const panel = document.getElementById("popupTabControlUrbano");
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

  POPUP_CONTROL_URBANO_SLOTS.forEach(function(def) {
    popupControlUrbanoEstado[def.slot] = { docs: [], seleccionadoId: null };
  });

  const puedeEditar = puedeGestionarControlUrbano();
  panel.innerHTML = `
    <div class="popup-cu-layout">
      <header class="popup-cu-intro">
        <div>
          <h3>Control Urbano</h3>
          <p>Adjunte la licencia de construcción y el uso de suelo autorizado del predio <b>${cuEsc(claveNorm)}</b>. Se conserva el historial de versiones.</p>
        </div>
        ${puedeEditar ? "" : `<span class="popup-cu-solo-lectura">Solo consulta</span>`}
      </header>
      <div class="popup-cu-grid" id="popupControlUrbanoGrid">
        ${POPUP_CONTROL_URBANO_SLOTS.map(def => htmlTarjetaControlUrbano(def, claveNorm)).join("")}
      </div>
      <p class="popup-cu-nota" id="popupControlUrbanoNota">Cargando documentos…</p>
      <p class="popup-cu-ayuda">Formatos: PDF, JPG, PNG o WEBP · Máximo 15 MB · Elija un documento del listado o abra en ventana nueva (↗).</p>
    </div>`;

  await cargarDocumentosControlUrbano(claveNorm);
}
window.pintarPopupTabControlUrbano = pintarPopupTabControlUrbano;
window.seleccionarDocControlUrbano = seleccionarDocControlUrbano;
window.subirDocControlUrbano = subirDocControlUrbano;
window.eliminarDocControlUrbano = eliminarDocControlUrbano;
window.abrirDocControlUrbano = abrirDocControlUrbano;
