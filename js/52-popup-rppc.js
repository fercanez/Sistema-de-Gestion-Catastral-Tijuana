/* Pestaña Documento RPPC — resolver folio con JWT y PDF por DOC_TRAMITE_ID */

let popupRppcBlobUrl = null;

function popupRppcEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function apiBaseRppc() {
  if (typeof API !== "undefined" && API) return String(API).replace(/\/$/, "");
  return `${window.location.origin}/api/catastro`;
}

function popupRppcFolioTexto(p) {
  if (typeof textoFolioReal === "function") return textoFolioReal(p);
  const f = String(p?.folio_real ?? "").trim();
  if (!f || f === "0") return "—";
  return f;
}

function popupRppcFolioNumerico(p) {
  const txt = popupRppcFolioTexto(p);
  if (!txt || txt === "—" || txt === "---") return "";
  return txt.replace(/\D/g, "") || txt;
}

function buildUrlPdfRppcDoc(docId) {
  const base = apiBaseRppc();
  return `${base}/rppc/pdf/doc/${encodeURIComponent(docId)}`;
}

function buildUrlVisorPdfRppcDoc(docId) {
  const base = apiBaseRppc();
  return `${base}/rppc/visor/pdf/doc/${encodeURIComponent(docId)}`;
}

function buildUrlResolverRppc(claveNorm, folioNum) {
  const base = apiBaseRppc();
  if (folioNum) {
    return `${base}/rppc/resolver/folio/${encodeURIComponent(folioNum)}`;
  }
  return `${base}/rppc/resolver/clave/${encodeURIComponent(claveNorm)}`;
}

function destruirPopupRppc() {
  const frame = document.getElementById("popupRppcVisorFrame");
  if (frame) frame.src = "about:blank";
  if (popupRppcBlobUrl) {
    URL.revokeObjectURL(popupRppcBlobUrl);
    popupRppcBlobUrl = null;
  }
}

async function extraerErrorFetchRppc(response) {
  let msg = `No se pudo obtener el documento RPPC (HTTP ${response.status})`;
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map(item => item.msg || item).join("; ");
    }
  } catch (e) {}
  return msg;
}

async function resolverDocumentoRppc(claveNorm, folioNum) {
  const urlResolver = buildUrlResolverRppc(claveNorm, folioNum);
  const headers = typeof authHeaders === "function" ? authHeaders() : {};

  const response = await fetch(urlResolver, {
    cache: "no-store",
    headers
  });

  if (!response.ok) {
    throw new Error(await extraerErrorFetchRppc(response));
  }

  const data = await response.json();
  const docId = data?.doc_tramite_id || data?.DOC_TRAMITE_ID;

  if (!docId) {
    throw new Error("El RPPC no devolvió DOC_TRAMITE_ID para este folio.");
  }

  return data;
}

async function cargarPdfRppcEnIframe(claveNorm, folioNum) {
  const frame = document.getElementById("popupRppcVisorFrame");
  const estado = document.getElementById("popupRppcEstado");
  const btnExterno = document.getElementById("popupRppcBtnExterno");
  if (!frame) return;

  if (estado) {
    estado.classList.remove("popup-rppc-estado-error");
    estado.textContent = "Resolviendo folio real en el Registro Público de la Propiedad…";
  }
  if (btnExterno) {
    btnExterno.classList.add("oculto");
    btnExterno.removeAttribute("href");
  }

  try {
    const data = await resolverDocumentoRppc(claveNorm, folioNum);
    const docId = data.doc_tramite_id || data.DOC_TRAMITE_ID;
    const urlPdf = buildUrlVisorPdfRppcDoc(docId);

    if (estado) {
      estado.textContent = `Documento localizado. Partida ${data.partida ?? "—"}, DOC_TRAMITE_ID ${docId}. Cargando PDF…`;
    }

    frame.src = urlPdf;

    if (btnExterno) {
      btnExterno.href = urlPdf;
      btnExterno.classList.remove("oculto");
    }
  } catch (error) {
    frame.src = "about:blank";
    if (estado) {
      estado.textContent = error.message || "Error al consultar el RPPC.";
      estado.classList.add("popup-rppc-estado-error");
    }
  }
}

async function pintarPopupTabRppc(clave, p) {
  const panel = document.getElementById("popupTabDocumentoRppc");
  if (!panel) return;

  destruirPopupRppc();

  const predio = p || window.predioSeleccionado || {};
  const claveNorm = String(clave || predio?.clave_catastral || "").trim().toUpperCase();
  const folioTxt = popupRppcFolioTexto(predio);
  const folioNum = popupRppcFolioNumerico(predio);
  const nombre = String(predio.nombre_completo || predio.propietario || "—").trim().toUpperCase();

  if (!claveNorm) {
    panel.innerHTML = `
      <div class="popup-placeholder-modulo">
        <strong>Sin clave catastral</strong>
        <p>Seleccione un predio en el mapa o en la búsqueda.</p>
      </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="popup-rppc-layout">
      <section class="popup-rppc-panel">
        <header class="popup-rppc-head">
          <span>Documento RPPC</span>
          <a id="popupRppcBtnExterno" class="popup-rppc-link-externo oculto" href="#" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
        </header>
        <div class="popup-rppc-meta">
          <span><b>Clave:</b> ${popupRppcEsc(claveNorm)}</span>
          <span><b>Folio real:</b> ${popupRppcEsc(folioTxt)}</span>
          <span><b>Contribuyente:</b> ${popupRppcEsc(nombre)}</span>
        </div>
        <p id="popupRppcEstado" class="popup-rppc-estado">Preparando consulta RPPC…</p>
        <div class="popup-rppc-iframe-wrap">
          <iframe id="popupRppcVisorFrame" class="popup-rppc-iframe" title="Documento RPPC ${popupRppcEsc(claveNorm)}" src="about:blank"></iframe>
        </div>
        ${!folioNum ? `<p class="popup-rppc-aviso">Sin folio real en padrón; se intentará resolver por clave catastral.</p>` : ""}
      </section>
    </div>`;

  await cargarPdfRppcEnIframe(claveNorm, folioNum);
}

window.buildUrlPdfRppcDoc = buildUrlPdfRppcDoc;
window.buildUrlVisorPdfRppcDoc = buildUrlVisorPdfRppcDoc;
window.buildUrlResolverRppc = buildUrlResolverRppc;
window.pintarPopupTabRppc = pintarPopupTabRppc;
window.destruirPopupRppc = destruirPopupRppc;