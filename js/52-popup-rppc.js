/* Pestaña Documento RPPC — resolver con JWT, DOC_TRAMITE_ID o Hoja de Inscripción por partida */

let popupRppcBlobUrl = null;
let popupRppcUrlPdfOriginal = "";

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

function htmlComparacionTitularMetaRppc(comp) {
  const estado = String(comp.estado || "sin_datos");
  const clase = estado === "coincide" ? "coincide" : estado === "difiere" ? "difiere" : "pendiente";
  const nombreRppc = comp.nombre_rppc ? popupRppcEsc(comp.nombre_rppc) : "";
  const rol = comp.rol_rppc_etiqueta ? popupRppcEsc(comp.rol_rppc_etiqueta) : "Titular folio";
  const resumen = popupRppcEsc(comp.mensaje || "Comparación de titular");

  if (estado === "coincide") {
    const detalle = nombreRppc ? ` · ${rol}: ${nombreRppc}` : "";
    return `<span class="popup-rppc-comparacion-meta coincide" role="status" title="${resumen}">
      <b>✓ COINCIDEN AMBOS REGISTROS</b>${detalle}
    </span>`;
  }

  if (estado === "difiere") {
    const detalle = nombreRppc ? ` · ${rol}: ${nombreRppc}` : "";
    return `<span class="popup-rppc-comparacion-meta difiere" role="status" title="${resumen}">
      <b>✕ NO COINCIDEN LOS REGISTROS</b>${detalle}
    </span>`;
  }

  return `<span class="popup-rppc-comparacion-meta ${clase} popup-rppc-comparacion-meta-ancho" role="status" title="${resumen}">
    <b>ℹ Validación:</b> ${resumen}
  </span>`;
}

function pintarComparacionTitularRppc(comp) {
  const contenedor = document.getElementById("popupRppcComparacionTitular");
  const headerViejo = document.getElementById("popupPredioComparacionRppc");
  if (headerViejo) {
    headerViejo.innerHTML = "";
    headerViejo.classList.add("oculto");
  }
  if (!contenedor) return;
  if (!comp) {
    contenedor.innerHTML = "";
    contenedor.className = "popup-rppc-comparacion-meta-wrap oculto";
    return;
  }
  contenedor.innerHTML = htmlComparacionTitularMetaRppc(comp);
  contenedor.className = "popup-rppc-comparacion-meta-wrap";
}

function limpiarComparacionTitularRppc() {
  pintarComparacionTitularRppc(null);
}

function buildUrlVisorPdfRppcDoc(docId, claveNorm) {
  const base = apiBaseRppc();
  let url = `${base}/rppc/visor/pdf/doc/${encodeURIComponent(docId)}`;
  if (claveNorm) {
    url += `?clave_catastral=${encodeURIComponent(claveNorm)}`;
  }
  return url;
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
  popupRppcUrlPdfOriginal = "";
  limpiarComparacionTitularRppc();
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

async function refrescarComparacionTitularRppc(claveNorm) {
  if (!claveNorm) return;
  try {
    const r = await fetch(
      `${apiBaseRppc()}/rppc/comparar-titular/clave/${encodeURIComponent(claveNorm)}`,
      { cache: "no-store", headers: typeof authHeaders === "function" ? authHeaders() : {} }
    );
    if (!r.ok) return;
    pintarComparacionTitularRppc(await r.json());
  } catch (e) {}
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

async function mostrarPdfRppcEnVisor(urlPdf) {
  const frame = document.getElementById("popupRppcVisorFrame");
  const estado = document.getElementById("popupRppcEstado");
  const btnExterno = document.getElementById("popupRppcBtnExterno");
  const overlay = document.getElementById("popupRppcMarcaAguaOverlay");
  if (!frame || !urlPdf) return;

  popupRppcUrlPdfOriginal = urlPdf;

  if (popupRppcBlobUrl) {
    URL.revokeObjectURL(popupRppcBlobUrl);
    popupRppcBlobUrl = null;
  }

  const conMarca = typeof marcaAguaActivaEnVisor === "function"
    ? marcaAguaActivaEnVisor("rppc")
    : true;
  const puedeEmbebida = conMarca
    && typeof aplicarMarcaAguaEnPdfBytes === "function"
    && window.PDFLib;

  if (overlay) {
    overlay.classList.toggle("activa", conMarca && !puedeEmbebida);
  }

  try {
    if (puedeEmbebida) {
      if (estado) estado.textContent = "Aplicando marca de agua al documento RPPC…";
      const headers = typeof authHeaders === "function" ? authHeaders() : {};
      const respPdf = await fetch(urlPdf, { cache: "no-store", headers: headers });
      if (!respPdf.ok) {
        throw new Error(await extraerErrorFetchRppc(respPdf));
      }
      const pdfBytes = new Uint8Array(await respPdf.arrayBuffer());
      const marcado = await aplicarMarcaAguaEnPdfBytes(pdfBytes);
      popupRppcBlobUrl = URL.createObjectURL(new Blob([marcado], { type: "application/pdf" }));
      frame.src = popupRppcBlobUrl;
      if (btnExterno) {
        btnExterno.href = popupRppcBlobUrl;
        btnExterno.classList.remove("oculto");
      }
      if (estado) estado.textContent = "Documento RPPC listo con marca de agua institucional.";
      return;
    }

    frame.src = urlPdf;
    if (conMarca && overlay && typeof prepararOverlayMarcaAguaElemento === "function") {
      overlay.classList.add("activa");
      await prepararOverlayMarcaAguaElemento(overlay);
    }
    if (btnExterno) {
      btnExterno.href = urlPdf;
      btnExterno.classList.remove("oculto");
    }
  } catch (error) {
    frame.src = urlPdf;
    if (conMarca && overlay && typeof prepararOverlayMarcaAguaElemento === "function") {
      overlay.classList.add("activa");
      await prepararOverlayMarcaAguaElemento(overlay);
    }
    if (btnExterno) {
      btnExterno.href = urlPdf;
      btnExterno.classList.remove("oculto");
    }
    if (estado) {
      estado.textContent = `${error.message || error} · Mostrando PDF con superposición visual.`;
      estado.classList.add("popup-rppc-estado-error");
    }
  }
}

async function refrescarVisorPdfRppcConMarca() {
  if (!popupRppcUrlPdfOriginal) return;
  const estado = document.getElementById("popupRppcEstado");
  if (estado) estado.classList.remove("popup-rppc-estado-error");
  await mostrarPdfRppcEnVisor(popupRppcUrlPdfOriginal);
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

    const compInicial = data.comparacion_titular || null;
    if (compInicial && compInicial.estado !== "sin_rppc" && compInicial.estado !== "sin_datos") {
      pintarComparacionTitularRppc(compInicial);
    }

    if (folioDetectado) {
      const meta = document.querySelector(".popup-rppc-meta");
      if (meta) {
        meta.querySelectorAll("span").forEach(function(sp) {
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
      ? buildUrlVisorPdfRppcDoc(docId, claveNorm)
      : buildAbsoluteRppcUrl(pdfUrl);

    if (estado) {
      estado.textContent = docId
        ? `Documento localizado. Partida ${data.partida ?? "—"}, DOC_TRAMITE_ID ${docId}. Cargando PDF…`
        : `Hoja de inscripción localizada. Partida ${data.partida ?? "—"}. Cargando PDF…`;
    }

    await mostrarPdfRppcEnVisor(urlPdf);
    await refrescarComparacionTitularRppc(claveNorm);
  } catch (error) {
    frame.src = "about:blank";
    popupRppcUrlPdfOriginal = "";
    pintarComparacionTitularRppc(null);
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

  const botonesMarca = typeof htmlBotonesMarcaAguaDocumento === "function"
    ? htmlBotonesMarcaAguaDocumento("popupRppcBtnMarcaAgua", "toggleMarcaAguaRppc()", "imprimirRppcConMarcaAgua()")
    : "";
  const overlayMarca = typeof htmlOverlayMarcaAguaDocumento === "function"
    ? htmlOverlayMarcaAguaDocumento("popupRppcMarcaAguaOverlay")
    : "";

  panel.innerHTML = `
    <div class="popup-rppc-layout">
      <section class="popup-rppc-panel">
        <header class="popup-rppc-head">
          <span>Documento RPPC</span>
          <div class="popup-rppc-head-acciones">
            ${botonesMarca}
            <a id="popupRppcBtnExterno" class="popup-rppc-link-externo oculto" href="#" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
          </div>
        </header>
        <div class="popup-rppc-meta">
          <span><b>Clave:</b> ${popupRppcEsc(claveNorm)}</span>
          <span><b>Folio real:</b> ${popupRppcEsc(folioTxt)}</span>
          <span><b>Contribuyente:</b> ${popupRppcEsc(nombre)}</span>
          <span id="popupRppcComparacionTitular" class="popup-rppc-comparacion-meta-wrap oculto" aria-live="polite"></span>
        </div>
        <p id="popupRppcEstado" class="popup-rppc-estado">Preparando consulta RPPC…</p>
        <div class="popup-rppc-iframe-wrap" id="popupRppcVisorWrap">
          <iframe id="popupRppcVisorFrame" class="popup-rppc-iframe" title="Documento RPPC ${popupRppcEsc(claveNorm)}" src="about:blank"></iframe>
          ${overlayMarca}
        </div>
        <p class="popup-marca-agua-aviso">Los documentos se muestran con la leyenda «Documento sin validez oficial». Use «Imprimir con marca» para imprimir el PDF con la leyenda incluida.</p>
        ${!folioNum ? `<p class="popup-rppc-aviso">Sin folio real en padrón; se intentará resolver por clave catastral.</p>` : ""}
      </section>
    </div>`;

  if (typeof inicializarMarcaAguaRppc === "function") {
    await inicializarMarcaAguaRppc();
  }

  await cargarPdfRppcEnIframe(claveNorm, folioNum);
}

window.limpiarComparacionTitularRppc = limpiarComparacionTitularRppc;
window.pintarComparacionTitularRppc = pintarComparacionTitularRppc;
window.pintarPopupTabRppc = pintarPopupTabRppc;
window.destruirPopupRppc = destruirPopupRppc;
window.refrescarVisorPdfRppcConMarca = refrescarVisorPdfRppcConMarca;
