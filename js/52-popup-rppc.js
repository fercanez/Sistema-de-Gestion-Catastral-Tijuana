/* Pestaña Documento RPPC — resolver con JWT, DOC_TRAMITE_ID o Hoja de Inscripción por partida */

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

function buildAbsoluteRppcUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = apiBaseRppc();
  return `${base}${String(pathOrUrl).startsWith("/") ? "" : "/"}${pathOrUrl}`;
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
  const pdfUrl = data?.pdf_url || data?.PDF_URL;

  if (!docId && !pdfUrl) {
    throw new Error("El RPPC no devolvió DOC_TRAMITE_ID ni PDF alternativo para este folio.");
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
    estado.textContent = "Resolviendo documento en el Registro Público de la Propiedad…";
  }

  if (btnExterno) {
    btnExterno.classList.add("oculto");
    btnExterno.removeAttribute("href");
  }

  try {
	const data = await resolverDocumentoRppc(claveNorm, folioNum);
	
    const folioDetectado = data.folio_real || data.FOLIO_REAL;

if (folioDetectado) {
  const meta = document.querySelector(".popup-rppc-meta");
  if (meta) {
    const spans = meta.querySelectorAll("span");
    spans.forEach(sp => {
      if (sp.textContent.includes("Folio real:")) {
        sp.innerHTML = `<b>Folio real:</b> ${popupRppcEsc(folioDetectado)}`;
      }
    });
  }

  if (window.predioSeleccionado) {
    window.predioSeleccionado.folio_real = folioDetectado;
  }
}

    const docId = data.doc_tramite_id || data.DOC_TRAMITE_ID;
    const pdfUrl = data.pdf_url || data.PDF_URL;

    const urlPdf = docId
      ? buildUrlVisorPdfRppcDoc(docId)
      : buildAbsoluteRppcUrl(pdfUrl);

    if (estado) {
      estado.textContent = docId
        ? `Documento localizado. Partida ${data.partida ?? "—"}, DOC_TRAMITE_ID ${docId}. Cargando PDF…`
        : `Hoja de inscripción localizada. Partida ${data.partida ?? "—"}. Cargando PDF…`;
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

window.buildUrlResolverRppc = buildUrlResolverRppc;
window.pintarPopupTabRppc = pintarPopupTabRppc;
window.destruirPopupRppc = destruirPopupRppc;