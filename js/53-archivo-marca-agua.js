/* Marca de agua institucional — visores de documento (Archivo, RPPC, Control Urbano) */

const MARCA_AGUA_DOCUMENTO_ASSET = "img/marca.png?v=20260704_marca_tijuana";
const MARCA_AGUA_ARCHIVO_ASSET = MARCA_AGUA_DOCUMENTO_ASSET;
const MARCA_AGUA_STORAGE_KEY = "catastro_marca_agua_documento_activa";
const MARCA_AGUA_ARCHIVO_STORAGE_KEY = MARCA_AGUA_STORAGE_KEY;
const MARCA_AGUA_OPACIDAD_PDF = 0.3;

const MARCA_AGUA_VISORES = {
  archivo: {
    overlayId: "popupArchivoMarcaAguaOverlay",
    wrapId: "popupArchivoVisorWrap",
    btnId: "popupArchivoBtnMarcaAgua",
    printClass: "popup-archivo-imprimiendo",
    embebidaEnPdf: true
  },
  rppc: {
    overlayId: "popupRppcMarcaAguaOverlay",
    wrapId: "popupRppcVisorWrap",
    btnId: "popupRppcBtnMarcaAgua",
    printClass: "popup-rppc-imprimiendo",
    embebidaEnPdf: true
  },
  control_urbano: {
    btnId: "popupCuBtnMarcaAgua",
    embebidaEnPdf: true
  }
};

const marcaAguaEstadoPorVisor = {
  archivo: true,
  rppc: true,
  control_urbano: true
};
const documentoMarcadoCache = new Map();
let marcaAguaPngBytesCache = null;
let marcaAguaPngBlobUrlCache = null;

function urlBaseVisorCatastro() {
  const path = window.location.pathname || "/";
  const base = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  return `${window.location.origin}${base}`;
}

function urlMarcaAguaDocumento() {
  return `${urlBaseVisorCatastro()}${MARCA_AGUA_DOCUMENTO_ASSET.replace(/^\//, "")}`;
}

function puedeGestionarMarcaAguaInstitucional() {
  return typeof puedeGestionarMarcaAguaDocumento === "function" && puedeGestionarMarcaAguaDocumento();
}

function marcaAguaEsObligatoria() {
  if (typeof esRolConsultaInstitucional === "function" && esRolConsultaInstitucional()) return true;
  return !puedeGestionarMarcaAguaInstitucional();
}

function marcaAguaDocumentoPreferida() {
  if (marcaAguaEsObligatoria()) return true;
  try {
    let raw = localStorage.getItem(MARCA_AGUA_STORAGE_KEY);
    if (raw == null) raw = localStorage.getItem("catastro_archivo_marca_agua_activa");
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch (e) {}
  return true;
}

function marcaAguaArchivoPreferida() {
  return marcaAguaDocumentoPreferida();
}

function guardarPreferenciaMarcaAguaDocumento(activa) {
  if (marcaAguaEsObligatoria()) return;
  try {
    localStorage.setItem(MARCA_AGUA_STORAGE_KEY, activa ? "1" : "0");
  } catch (e) {}
}

function guardarPreferenciaMarcaAguaArchivo(activa) {
  guardarPreferenciaMarcaAguaDocumento(activa);
}

function configMarcaAguaVisor(tipo) {
  return MARCA_AGUA_VISORES[tipo] || null;
}

function pdfLibDisponible() {
  return !!(window.PDFLib && typeof window.PDFLib.PDFDocument?.load === "function");
}

function esArchivoPdfNombre(nombreArchivo) {
  return /\.pdf$/i.test(String(nombreArchivo || ""));
}

function esArchivoImagenNombre(nombreArchivo) {
  return /\.(jpe?g|png|webp|gif)$/i.test(String(nombreArchivo || ""));
}

function revocarCacheDocumentosMarcados() {
  documentoMarcadoCache.forEach(function(blobUrl) {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch (e) {}
  });
  documentoMarcadoCache.clear();
}

async function obtenerBytesMarcaAguaPngProcesado() {
  if (marcaAguaPngBytesCache) return marcaAguaPngBytesCache;

  const resp = await fetch(urlMarcaAguaDocumento(), { cache: "force-cache" });
  if (!resp.ok) {
    throw new Error(`No se pudo cargar la marca de agua (${resp.status})`);
  }

  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imgData.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (r > 232 && g > 232 && b > 232) {
      px[i + 3] = 0;
      continue;
    }
    const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    px[i] = gray;
    px[i + 1] = gray;
    px[i + 2] = gray;
    px[i + 3] = Math.min(255, Math.round((255 - gray) * 1.35 + 55));
  }
  ctx.putImageData(imgData, 0, 0);

  const pngBlob = await new Promise(function(resolve, reject) {
    canvas.toBlob(function(b) {
      if (b) resolve(b);
      else reject(new Error("No se pudo procesar la marca de agua"));
    }, "image/png");
  });

  marcaAguaPngBytesCache = new Uint8Array(await pngBlob.arrayBuffer());
  if (marcaAguaPngBlobUrlCache) URL.revokeObjectURL(marcaAguaPngBlobUrlCache);
  marcaAguaPngBlobUrlCache = URL.createObjectURL(pngBlob);
  return marcaAguaPngBytesCache;
}

async function urlMarcaAguaOverlayProcesada() {
  await obtenerBytesMarcaAguaPngProcesado();
  return marcaAguaPngBlobUrlCache;
}

function cargarImagenDesdeUrl(url) {
  return new Promise(function(resolve, reject) {
    const img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject(new Error("No se pudo cargar la imagen")); };
    img.src = url;
  });
}

function dibujarMarcaAguaEnContexto(ctx, ancho, alto, marcaImg) {
  const tileW = ancho * 0.5;
  const scale = tileW / marcaImg.width;
  const tileH = marcaImg.height * scale;
  const cols = 2;
  const filas = Math.ceil(alto / (tileH * 0.85)) + 1;
  ctx.save();
  ctx.globalAlpha = MARCA_AGUA_OPACIDAD_PDF;
  for (let fila = 0; fila < filas; fila += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * (ancho / cols) - tileW * 0.04;
      const y = fila * tileH * 0.85;
      ctx.drawImage(marcaImg, x, y, tileW, tileH);
    }
  }
  ctx.restore();
}

async function prepararOverlayMarcaAguaElemento(overlayEl) {
  if (!overlayEl) return;
  try {
    const url = await urlMarcaAguaOverlayProcesada();
    overlayEl.style.backgroundImage = `url("${url}")`;
    overlayEl.classList.add("popup-marca-agua-overlay-listo");
  } catch (e) {
    overlayEl.style.backgroundImage = `url("${urlMarcaAguaDocumento()}")`;
  }
}

async function aplicarMarcaAguaEnPdfBytes(pdfBytes) {
  if (!pdfLibDisponible()) {
    throw new Error("La librería pdf-lib no está disponible");
  }

  const marcaBytes = await obtenerBytesMarcaAguaPngProcesado();
  const pdfDoc = await window.PDFLib.PDFDocument.load(pdfBytes);
  const pngImage = await pdfDoc.embedPng(marcaBytes);
  const imgW = pngImage.width;
  const imgH = pngImage.height;

  pdfDoc.getPages().forEach(function(page) {
    const size = page.getSize();
    const width = size.width;
    const height = size.height;
    const tileW = width * 0.5;
    const scale = tileW / imgW;
    const tileH = imgH * scale;
    const cols = 2;
    const filas = Math.ceil(height / (tileH * 0.85)) + 1;

    for (let fila = 0; fila < filas; fila += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = col * (width / cols) - tileW * 0.04;
        const y = height - (fila + 1) * tileH + tileH * 0.12;
        page.drawImage(pngImage, {
          x: x,
          y: y,
          width: tileW,
          height: tileH,
          opacity: MARCA_AGUA_OPACIDAD_PDF
        });
      }
    }
  });

  return pdfDoc.save();
}

async function aplicarMarcaAguaEnImagenBytes(imageBytes, mimeType) {
  const tipo = String(mimeType || "image/jpeg").split(";")[0].trim().toLowerCase() || "image/jpeg";
  const blobEntrada = new Blob([imageBytes], { type: tipo });
  const urlEntrada = URL.createObjectURL(blobEntrada);
  try {
    const [img, marcaUrl] = await Promise.all([
      cargarImagenDesdeUrl(urlEntrada),
      urlMarcaAguaOverlayProcesada()
    ]);
    const marcaImg = await cargarImagenDesdeUrl(marcaUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    dibujarMarcaAguaEnContexto(ctx, canvas.width, canvas.height, marcaImg);
    const salidaTipo = tipo === "image/png" ? "image/png" : "image/jpeg";
    return await new Promise(function(resolve, reject) {
      canvas.toBlob(function(b) {
        if (b) resolve(b);
        else reject(new Error("No se pudo generar la imagen con marca de agua"));
      }, salidaTipo, salidaTipo === "image/jpeg" ? 0.92 : undefined);
    });
  } finally {
    URL.revokeObjectURL(urlEntrada);
  }
}

function debeAplicarMarcaAguaDocumento(tipo) {
  if (marcaAguaEsObligatoria()) return true;
  return marcaAguaEstadoPorVisor[tipo] !== false;
}

function marcaAguaActivaEnVisor(tipo) {
  return debeAplicarMarcaAguaDocumento(tipo);
}

async function resolverUrlDocumentoConMarcaAgua(urlOriginal, nombreArchivo, cacheKey, opciones) {
  opciones = opciones || {};
  if (!urlOriginal) return "";

  const forzarMarca = !!opciones.forzarMarca;
  const tipoVisor = opciones.tipoVisor || "control_urbano";
  const conMarca = forzarMarca || debeAplicarMarcaAguaDocumento(tipoVisor);
  const key = `${cacheKey || urlOriginal}|${conMarca ? "1" : "0"}`;

  if (documentoMarcadoCache.has(key)) return documentoMarcadoCache.get(key);

  const headers = typeof authHeaders === "function" ? authHeaders() : {};

  if (!conMarca) {
    if (!headers.Authorization) return urlOriginal;
    const respSinMarca = await fetch(urlOriginal, { cache: "no-store", headers: headers });
    if (!respSinMarca.ok) {
      throw new Error(`No se pudo descargar el documento (HTTP ${respSinMarca.status})`);
    }
    const blobUrl = URL.createObjectURL(await respSinMarca.blob());
    documentoMarcadoCache.set(key, blobUrl);
    return blobUrl;
  }

  const resp = await fetch(urlOriginal, { cache: "no-store", headers: headers });
  if (!resp.ok) {
    throw new Error(`No se pudo descargar el documento (HTTP ${resp.status})`);
  }

  const bytes = new Uint8Array(await resp.arrayBuffer());
  let blobSalida = null;

  if (esArchivoPdfNombre(nombreArchivo) && pdfLibDisponible()) {
    const marcado = await aplicarMarcaAguaEnPdfBytes(bytes);
    blobSalida = new Blob([marcado], { type: "application/pdf" });
  } else if (esArchivoImagenNombre(nombreArchivo)) {
    blobSalida = await aplicarMarcaAguaEnImagenBytes(bytes, resp.headers.get("content-type") || undefined);
  } else {
    return urlOriginal;
  }

  const blobUrl = URL.createObjectURL(blobSalida);
  documentoMarcadoCache.set(key, blobUrl);
  return blobUrl;
}

async function aplicarEstadoMarcaAguaVisor(tipo, activa) {
  const cfg = configMarcaAguaVisor(tipo);
  if (!cfg) return;

  if (marcaAguaEsObligatoria()) activa = true;
  marcaAguaEstadoPorVisor[tipo] = !!activa;

  const overlay = cfg.overlayId ? document.getElementById(cfg.overlayId) : null;
  const wrap = cfg.wrapId ? document.getElementById(cfg.wrapId) : null;
  const btn = cfg.btnId ? document.getElementById(cfg.btnId) : null;
  const embebida = cfg.embebidaEnPdf && pdfLibDisponible();

  if (overlay) {
    const mostrarOverlay = marcaAguaEstadoPorVisor[tipo] && !embebida;
    overlay.classList.toggle("activa", mostrarOverlay);
    overlay.setAttribute("aria-hidden", mostrarOverlay ? "false" : "true");
    if (mostrarOverlay) await prepararOverlayMarcaAguaElemento(overlay);
  }
  if (wrap) wrap.classList.toggle("con-marca-agua", marcaAguaEstadoPorVisor[tipo]);
  if (btn) {
    if (marcaAguaEsObligatoria()) {
      btn.style.display = "none";
    } else {
      btn.style.display = "";
      btn.classList.toggle("activo", marcaAguaEstadoPorVisor[tipo]);
      btn.textContent = marcaAguaEstadoPorVisor[tipo] ? "Ocultar marca de agua" : "Mostrar marca de agua";
      btn.title = marcaAguaEstadoPorVisor[tipo]
        ? "Ocultar la leyenda «Documento sin validez oficial»"
        : "Mostrar la leyenda «Documento sin validez oficial»";
    }
  }

  guardarPreferenciaMarcaAguaDocumento(marcaAguaEstadoPorVisor[tipo]);
  revocarCacheDocumentosMarcados();

  if (tipo === "rppc" && typeof refrescarVisorPdfRppcConMarca === "function") {
    await refrescarVisorPdfRppcConMarca();
  }
  if (tipo === "archivo" && typeof refrescarVisorArchivoExternoConMarca === "function") {
    await refrescarVisorArchivoExternoConMarca();
  }
  if (tipo === "control_urbano" && typeof refrescarDocumentosControlUrbanoConMarca === "function") {
    await refrescarDocumentosControlUrbanoConMarca();
  }
}

async function toggleMarcaAguaVisor(tipo) {
  if (marcaAguaEsObligatoria()) return;
  await aplicarEstadoMarcaAguaVisor(tipo, !marcaAguaEstadoPorVisor[tipo]);
}

async function inicializarMarcaAguaVisor(tipo) {
  const preferida = marcaAguaDocumentoPreferida();
  marcaAguaEstadoPorVisor[tipo] = preferida;
  await aplicarEstadoMarcaAguaVisor(tipo, preferida);
}

async function imprimirDocumentoConMarcaAgua(tipo) {
  if (tipo === "rppc") {
    await imprimirRppcConMarcaAgua();
    return;
  }
  if (tipo === "archivo") {
    await imprimirArchivoExternoConMarcaAgua();
    return;
  }

  const cfg = configMarcaAguaVisor(tipo);
  if (!cfg || !document.getElementById(cfg.wrapId)) return;

  await aplicarEstadoMarcaAguaVisor(tipo, true);
  document.body.classList.add(cfg.printClass);
  const limpiar = function() {
    document.body.classList.remove(cfg.printClass);
    window.removeEventListener("afterprint", limpiar);
  };
  window.addEventListener("afterprint", limpiar);
  window.setTimeout(function() { window.print(); }, 180);
}

async function imprimirUrlDocumentoConMarca(url, nombreArchivo, cacheKey) {
  const urlMarcada = await resolverUrlDocumentoConMarcaAgua(url, nombreArchivo, cacheKey, {
    forzarMarca: true,
    tipoVisor: "control_urbano"
  });
  const ventana = window.open(urlMarcada, "_blank", "noopener,noreferrer");
  if (!ventana) {
    alert("Permita ventanas emergentes para imprimir el documento con marca de agua.");
    return;
  }
  const imprimir = function() {
    try {
      ventana.focus();
      ventana.print();
    } catch (e) {}
  };
  ventana.addEventListener("load", function() {
    window.setTimeout(imprimir, 700);
  });
  window.setTimeout(imprimir, 1400);
}

async function abrirPdfVisorEnVentanaImpresion(frameId, mensajeSinDocumento) {
  const frame = document.getElementById(frameId);
  const src = frame?.src;
  if (!src || src === "about:blank") {
    alert(mensajeSinDocumento);
    return;
  }

  const ventana = window.open(src, "_blank", "noopener,noreferrer");
  if (!ventana) {
    alert("Permita ventanas emergentes para imprimir el documento con marca de agua.");
    return;
  }

  const imprimir = function() {
    try {
      ventana.focus();
      ventana.print();
    } catch (e) {}
  };
  ventana.addEventListener("load", function() {
    window.setTimeout(imprimir, 700);
  });
  window.setTimeout(imprimir, 1400);
}

async function imprimirRppcConMarcaAgua() {
  await aplicarEstadoMarcaAguaVisor("rppc", true);
  await abrirPdfVisorEnVentanaImpresion(
    "popupRppcVisorFrame",
    "El documento RPPC aún no está listo para imprimir."
  );
}

let popupArchivoUrlOriginal = "";
let popupArchivoBlobUrl = null;

async function mostrarArchivoExternoEnVisor(urlPdf) {
  const frame = document.getElementById("popupArchivoDigitalExternoFrame");
  const estado = document.getElementById("popupArchivoEstado");
  const btnExterno = document.getElementById("popupArchivoBtnExterno");
  const overlay = document.getElementById("popupArchivoMarcaAguaOverlay");
  if (!frame || !urlPdf) return;

  popupArchivoUrlOriginal = urlPdf;

  if (popupArchivoBlobUrl) {
    URL.revokeObjectURL(popupArchivoBlobUrl);
    popupArchivoBlobUrl = null;
  }

  const conMarca = marcaAguaActivaEnVisor("archivo");
  const puedeEmbebida = conMarca && pdfLibDisponible();

  if (overlay) {
    overlay.classList.toggle("activa", conMarca && !puedeEmbebida);
  }

  try {
    if (puedeEmbebida) {
      if (estado) estado.textContent = "Aplicando marca de agua al archivo digital…";
      const headers = typeof authHeaders === "function" ? authHeaders() : {};
      const respPdf = await fetch(urlPdf, { cache: "no-store", headers: headers });
      if (!respPdf.ok) {
        throw new Error(`No se pudo descargar el archivo (HTTP ${respPdf.status})`);
      }
      const pdfBytes = new Uint8Array(await respPdf.arrayBuffer());
      const marcado = await aplicarMarcaAguaEnPdfBytes(pdfBytes);
      popupArchivoBlobUrl = URL.createObjectURL(new Blob([marcado], { type: "application/pdf" }));
      frame.src = popupArchivoBlobUrl;
      if (btnExterno) {
        btnExterno.href = popupArchivoBlobUrl;
        btnExterno.classList.remove("oculto");
      }
      if (overlay) {
        overlay.classList.remove("activa");
        overlay.setAttribute("aria-hidden", "true");
      }
      if (estado) {
        estado.textContent = "Archivo digital listo con marca de agua institucional.";
        estado.classList.remove("popup-archivo-estado-error");
      }
      return;
    }

    frame.src = urlPdf;
    if (conMarca && overlay) {
      overlay.classList.add("activa");
      overlay.setAttribute("aria-hidden", "false");
      await prepararOverlayMarcaAguaElemento(overlay);
    }
    if (btnExterno) {
      btnExterno.href = urlPdf;
      btnExterno.classList.remove("oculto");
    }
    if (estado) {
      estado.textContent = "Archivo digital cargado.";
      estado.classList.remove("popup-archivo-estado-error");
    }
  } catch (error) {
    frame.src = urlPdf;
    if (conMarca && overlay) {
      overlay.classList.add("activa");
      overlay.setAttribute("aria-hidden", "false");
      await prepararOverlayMarcaAguaElemento(overlay);
    }
    if (btnExterno) {
      btnExterno.href = urlPdf;
      btnExterno.classList.remove("oculto");
    }
    if (estado) {
      estado.textContent = `${error.message || error} · Mostrando PDF con superposición visual.`;
      estado.classList.add("popup-archivo-estado-error");
    }
  }
}

async function refrescarVisorArchivoExternoConMarca() {
  if (!popupArchivoUrlOriginal) return;
  const estado = document.getElementById("popupArchivoEstado");
  if (estado) estado.classList.remove("popup-archivo-estado-error");
  await mostrarArchivoExternoEnVisor(popupArchivoUrlOriginal);
}

async function cargarArchivoExternoEnVisor(claveNorm) {
  const clave = String(claveNorm || "").trim().toUpperCase();
  if (!clave) return;

  const frame = document.getElementById("popupArchivoDigitalExternoFrame");
  const estado = document.getElementById("popupArchivoEstado");
  const btnExterno = document.getElementById("popupArchivoBtnExterno");

  if (frame) frame.src = "about:blank";
  if (btnExterno) {
    btnExterno.classList.add("oculto");
    btnExterno.removeAttribute("href");
  }
  if (estado) {
    estado.classList.remove("popup-archivo-estado-error");
    estado.textContent = "Descargando archivo digital externo…";
  }

  const urlApi = typeof urlArchivoExternoApi === "function"
    ? urlArchivoExternoApi(clave)
    : "";
  const urlPdf = urlApi || (typeof urlArchivoDigitalExterno === "function"
    ? urlArchivoDigitalExterno(clave)
    : "");
  await mostrarArchivoExternoEnVisor(urlPdf);
}

async function imprimirArchivoExternoConMarcaAgua() {
  await aplicarEstadoMarcaAguaVisor("archivo", true);
  await abrirPdfVisorEnVentanaImpresion(
    "popupArchivoDigitalExternoFrame",
    "El archivo digital aún no está listo para imprimir."
  );
}

function setPopupArchivoUrlOriginal(url) {
  popupArchivoUrlOriginal = String(url || "");
}

async function imprimirArchivoSinMarcaAgua() {
  const url = popupArchivoUrlOriginal;
  if (!url) {
    alert("El archivo digital aún no está listo para imprimir.");
    return;
  }

  try {
    const headers = typeof authHeaders === "function" ? authHeaders() : {};
    const resp = await fetch(url, { cache: "no-store", headers: headers });
    if (!resp.ok) {
      throw new Error(`No se pudo descargar el documento (HTTP ${resp.status})`);
    }
    const blobUrl = URL.createObjectURL(await resp.blob());
    const ventana = window.open(blobUrl, "_blank", "noopener,noreferrer");
    if (!ventana) {
      URL.revokeObjectURL(blobUrl);
      alert("Permita ventanas emergentes para imprimir el documento sin marca de agua.");
      return;
    }
    const imprimir = function() {
      try {
        ventana.focus();
        ventana.print();
      } catch (e) {}
    };
    ventana.addEventListener("load", function() {
      window.setTimeout(imprimir, 700);
    });
    window.setTimeout(imprimir, 1400);
  } catch (e) {
    alert(e.message || "No se pudo imprimir el documento sin marca de agua.");
  }
}

function htmlBotonesImpresionArchivoTijuana() {
  return `
    <button type="button" class="popup-marca-agua-btn popup-marca-agua-btn-imprimir" onclick="imprimirArchivoConMarcaAgua()" title="Imprimir el documento con marca de agua">Imprimir con marca</button>
    <button type="button" class="popup-marca-agua-btn popup-marca-agua-btn-sin-marca" onclick="imprimirArchivoSinMarcaAgua()" title="Imprimir el documento sin marca de agua">Imprimir sin marca</button>`;
}

function htmlOverlayMarcaAguaDocumento(overlayId) {
  const esc = typeof escapeHtml === "function" ? escapeHtml : function(v) { return String(v ?? ""); };
  return `<div id="${esc(overlayId)}" class="popup-marca-agua-overlay activa" aria-hidden="false"></div>`;
}

function htmlBotonesMarcaAguaDocumento(btnMarcaId, onclickToggle, onclickImprimir, opciones) {
  opciones = opciones || {};
  const esc = typeof escapeHtml === "function" ? escapeHtml : function(v) { return String(v ?? ""); };
  const variante = opciones.variante === "claro" ? " popup-marca-agua-btn-claro" : "";
  const toggleBtn = marcaAguaEsObligatoria() ? "" : `
    <button type="button" id="${esc(btnMarcaId)}" class="popup-marca-agua-btn activo${variante}" onclick="${esc(onclickToggle)}" title="Mostrar u ocultar marca de agua">Ocultar marca de agua</button>`;
  const imprimirBtn = opciones.ocultarImprimir ? "" : `
    <button type="button" class="popup-marca-agua-btn popup-marca-agua-btn-imprimir${variante}" onclick="${esc(onclickImprimir)}" title="Imprimir el documento con la marca de agua">Imprimir con marca</button>`;
  return `${toggleBtn}${imprimirBtn}`;
}

function htmlAvisoMarcaAguaConsulta() {
  if (!marcaAguaEsObligatoria()) return "";
  return `<p class="popup-marca-agua-aviso popup-marca-agua-aviso-obligatoria">Perfil de consulta: los documentos se muestran siempre con la leyenda «Documento sin validez oficial».</p>`;
}

function capturarOpcionesMarcaAguaFichaInstitucional() {
  const rol = typeof obtenerRolSesion === "function"
    ? String(obtenerRolSesion()).trim().toLowerCase()
    : "";
  const esConsulta = rol === "consulta"
    || (typeof esRolConsultaInstitucional === "function" && esRolConsultaInstitucional());
  return {
    activa: esConsulta,
    imgUrl: typeof urlMarcaAguaDocumento === "function" ? urlMarcaAguaDocumento() : ""
  };
}

function debeAplicarMarcaAguaFichaInstitucional(opciones) {
  if (opciones && opciones.activa === true) return true;
  if (opciones && opciones.activa === false) return false;
  return capturarOpcionesMarcaAguaFichaInstitucional().activa;
}

const FICHA_MARCA_OPACIDAD_PANTALLA = 0.13;
const FICHA_MARCA_OPACIDAD_IMPRESION = 0.24;

function cssMarcaAguaFichaInstitucional(imgEsc) {
  return `
.contenedor.ficha-con-marca-agua{position:relative;box-sizing:border-box;}
.ficha-marca-agua-overlay{
  position:absolute;
  inset:0;
  z-index:120;
  pointer-events:none;
  display:block;
  opacity:${FICHA_MARCA_OPACIDAD_PANTALLA};
  background-image:url("${imgEsc}");
  background-repeat:repeat;
  background-size:50% auto;
  background-position:0 0;
  -webkit-print-color-adjust:exact!important;
  print-color-adjust:exact!important;
}
.aviso-marca-ficha-consulta{
  position:absolute;
  top:0;
  left:0;
  right:0;
  margin:0;
  padding:5px 10px;
  font-size:10px;
  font-style:italic;
  color:#64748b;
  background:rgba(250,245,243,.92);
  border-bottom:1px solid #e2e8f0;
  z-index:121;
  pointer-events:none;
}
@media print{
  html,body{width:var(--ficha-ancho,8.5in)!important;max-width:var(--ficha-ancho,8.5in)!important;margin:0 auto!important;padding:0!important;}
  .contenedor.ficha-con-marca-agua{
    max-height:calc(var(--ficha-alto,11in) - 0.12in)!important;
    overflow:hidden!important;
    page-break-inside:avoid!important;
    break-inside:avoid!important;
  }
  .contenedor.ficha-con-marca-agua .ficha-marca-agua-overlay{
    position:fixed!important;
    top:0!important;
    left:50%!important;
    right:auto!important;
    bottom:auto!important;
    transform:translateX(-50%)!important;
    width:var(--ficha-ancho,8.5in)!important;
    height:calc(var(--ficha-alto,11in) - 0.12in)!important;
    opacity:${FICHA_MARCA_OPACIDAD_IMPRESION}!important;
    background-repeat:no-repeat!important;
    background-size:100% 100%!important;
    background-position:0 0!important;
    -webkit-print-color-adjust:exact!important;
    print-color-adjust:exact!important;
    z-index:9999!important;
  }
  .aviso-marca-ficha-consulta{display:none!important;}
}`;
}

function scriptMarcaAguaFichaInstitucional(imgEsc) {
  const opPantalla = FICHA_MARCA_OPACIDAD_PANTALLA;
  const opImpresion = FICHA_MARCA_OPACIDAD_IMPRESION;
  return `<script>
(function(){
  var MARCA_SRC="${imgEsc}";
  var OP_PANTALLA=${opPantalla};
  var OP_IMPRESION=${opImpresion};
  var marcaImgCache=null;
  var marcaCanvasDataUrl="";

  function leerPaginaPx(){
    var root=getComputedStyle(document.documentElement);
    var anchoIn=parseFloat(String(root.getPropertyValue("--ficha-ancho")||"8.5in").replace(/in\\s*$/,""))||8.5;
    var altoIn=parseFloat(String(root.getPropertyValue("--ficha-alto")||"11in").replace(/in\\s*$/,""))||11;
    return{
      w:Math.max(320,Math.round(anchoIn*96)),
      h:Math.max(420,Math.round((altoIn-0.12)*96))
    };
  }

  function dibujarMarcaEnCanvas(ctx,ancho,alto,img,opacidad){
    var tileW=ancho*0.5;
    var scale=tileW/img.width;
    var tileH=img.height*scale;
    var cols=2;
    var filas=Math.ceil(alto/(tileH*0.85))+1;
    ctx.save();
    ctx.globalAlpha=opacidad;
    for(var fila=0;fila<filas;fila++){
      for(var col=0;col<cols;col++){
        var x=col*(ancho/cols)-tileW*0.04;
        var y=fila*tileH*0.85;
        ctx.drawImage(img,x,y,tileW,tileH);
      }
    }
    ctx.restore();
  }

  function precargarMarcaImg(){
    if(marcaImgCache)return Promise.resolve(marcaImgCache);
    return new Promise(function(resolve,reject){
      var img=new Image();
      img.onload=function(){marcaImgCache=img;resolve(img);};
      img.onerror=reject;
      img.src=MARCA_SRC;
    });
  }

  function pintarMarcaCanvasImpresion(){
    if(!marcaImgCache)return false;
    var px=leerPaginaPx();
    var canvas=document.createElement("canvas");
    canvas.width=px.w;
    canvas.height=px.h;
    var ctx=canvas.getContext("2d");
    if(!ctx)return false;
    dibujarMarcaEnCanvas(ctx,px.w,px.h,marcaImgCache,OP_IMPRESION);
    marcaCanvasDataUrl=canvas.toDataURL("image/png");
    document.querySelectorAll(".contenedor.ficha-con-marca-agua .ficha-marca-agua-overlay").forEach(function(el){
      el.style.backgroundImage='url("'+marcaCanvasDataUrl+'")';
      el.style.backgroundRepeat="no-repeat";
      el.style.backgroundSize="100% 100%";
      el.style.backgroundPosition="0 0";
      el.style.opacity=String(OP_IMPRESION);
    });
    return true;
  }

  function restaurarMarcaPantalla(){
    document.querySelectorAll(".contenedor.ficha-con-marca-agua .ficha-marca-agua-overlay").forEach(function(el){
      el.style.removeProperty("background-image");
      el.style.removeProperty("background-repeat");
      el.style.removeProperty("background-size");
      el.style.removeProperty("background-position");
      el.style.removeProperty("opacity");
    });
  }

  function prepararMarcaImpresion(){
    if(marcaImgCache){
      pintarMarcaCanvasImpresion();
      return;
    }
    precargarMarcaImg().then(function(){
      pintarMarcaCanvasImpresion();
    }).catch(function(){});
  }

  window.addEventListener("beforeprint", function(){
    prepararMarcaImpresion();
  });
  window.addEventListener("afterprint", function(){
    restaurarMarcaPantalla();
  });

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", function(){ precargarMarcaImg(); });
  }else{
    precargarMarcaImg();
  }
})();
<\/script>`;
}

function inyectarMarcaAguaEnHtmlFicha(html, css, aviso, overlayContenedor, imgEsc) {
  let out = String(html || "");
  if (out.indexOf("ficha-marca-agua-consulta-css") >= 0) return out;
  out = out.replace(/<\/head>/i, `<style id="ficha-marca-agua-consulta-css">${css}</style>\n</head>`);
  const bloqueMarca = `${aviso}${overlayContenedor}`;
  if (/(<div\s+class=")contenedor(">)/i.test(out)) {
    out = out.replace(
      /(<div\s+class=")contenedor(">)/i,
      `$1contenedor ficha-con-marca-agua$2${bloqueMarca}`
    );
  } else if (/(<div\s+class="[^"]*\bcontenedor\b)/i.test(out)) {
    out = out.replace(
      /(<div\s+class=")([^"]*\bcontenedor\b[^"]*)(">)/i,
      `$1$2 ficha-con-marca-agua$3${bloqueMarca}`
    );
  } else {
    out = out.replace(/(<body[^>]*>)/i, `$1${bloqueMarca}`);
  }
  out = out.replace(/<\/body>/i, scriptMarcaAguaFichaInstitucional(imgEsc) + "\n</body>");
  return out;
}

function aplicarMarcaAguaHtmlFichaInstitucional(html, opciones) {
  opciones = opciones || capturarOpcionesMarcaAguaFichaInstitucional();
  if (!debeAplicarMarcaAguaFichaInstitucional(opciones)) return html;
  const imgUrl = String(opciones.imgUrl || urlMarcaAguaDocumento() || "").trim();
  const imgEsc = imgUrl.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const css = cssMarcaAguaFichaInstitucional(imgEsc);
  const aviso = `<p class="aviso-marca-ficha-consulta">Documento sin validez oficial — perfil de consulta.</p>`;
  const overlayContenedor = `<div class="ficha-marca-agua-overlay" aria-hidden="true"></div>`;
  return inyectarMarcaAguaEnHtmlFicha(html, css, aviso, overlayContenedor, imgEsc);
}

function escribirHtmlFichaVentanaInstitucional(html, opciones) {
  return aplicarMarcaAguaHtmlFichaInstitucional(html, opciones || capturarOpcionesMarcaAguaFichaInstitucional());
}

function abrirVentanaHtmlFichaInstitucional(html, features) {
  const opts = typeof features === "string" ? { windowFeatures: features } : (features || {});
  const marcaOpts = opts.marcaAgua || capturarOpcionesMarcaAguaFichaInstitucional();
  const win = window.open("", "_blank", opts.windowFeatures || "width=1200,height=900");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes para este sitio.");
    return null;
  }
  win.document.open();
  win.document.write(aplicarMarcaAguaHtmlFichaInstitucional(html, marcaOpts));
  win.document.close();
  return win;
}

function escribirHtmlFichaVentanaConMarcaConsulta(html) {
  return aplicarMarcaAguaHtmlFichaInstitucional(html, capturarOpcionesMarcaAguaFichaInstitucional());
}

async function toggleMarcaAguaArchivoExterno() {
  await toggleMarcaAguaVisor("archivo");
}

async function inicializarMarcaAguaArchivoExterno() {
  await inicializarMarcaAguaVisor("archivo");
}

async function imprimirArchivoConMarcaAgua() {
  await imprimirDocumentoConMarcaAgua("archivo");
}

async function toggleMarcaAguaRppc() {
  await toggleMarcaAguaVisor("rppc");
}

async function inicializarMarcaAguaRppc() {
  await inicializarMarcaAguaVisor("rppc");
}

async function toggleMarcaAguaControlUrbano() {
  await toggleMarcaAguaVisor("control_urbano");
}

async function inicializarMarcaAguaControlUrbano() {
  await inicializarMarcaAguaVisor("control_urbano");
}

if (!window.__popupMarcaAguaDocumentoEsc) {
  window.__popupMarcaAguaDocumentoEsc = true;
  window.addEventListener("keydown", function(e) {
    if (e.key !== "Escape") return;
    Object.keys(MARCA_AGUA_VISORES).forEach(function(tipo) {
      const cfg = MARCA_AGUA_VISORES[tipo];
      if (cfg?.printClass) document.body.classList.remove(cfg.printClass);
    });
  });
}

window.urlMarcaAguaDocumento = urlMarcaAguaDocumento;
window.marcaAguaActivaEnVisor = marcaAguaActivaEnVisor;
window.debeAplicarMarcaAguaDocumento = debeAplicarMarcaAguaDocumento;
window.marcaAguaEsObligatoria = marcaAguaEsObligatoria;
window.aplicarMarcaAguaEnPdfBytes = aplicarMarcaAguaEnPdfBytes;
window.aplicarMarcaAguaEnImagenBytes = aplicarMarcaAguaEnImagenBytes;
window.resolverUrlDocumentoConMarcaAgua = resolverUrlDocumentoConMarcaAgua;
window.revocarCacheDocumentosMarcados = revocarCacheDocumentosMarcados;
window.prepararOverlayMarcaAguaElemento = prepararOverlayMarcaAguaElemento;
window.imprimirUrlDocumentoConMarca = imprimirUrlDocumentoConMarca;
window.toggleMarcaAguaArchivoExterno = toggleMarcaAguaArchivoExterno;
window.inicializarMarcaAguaArchivoExterno = inicializarMarcaAguaArchivoExterno;
window.imprimirArchivoConMarcaAgua = imprimirArchivoConMarcaAgua;
window.imprimirArchivoSinMarcaAgua = imprimirArchivoSinMarcaAgua;
window.setPopupArchivoUrlOriginal = setPopupArchivoUrlOriginal;
window.htmlBotonesImpresionArchivoTijuana = htmlBotonesImpresionArchivoTijuana;
window.cargarArchivoExternoEnVisor = cargarArchivoExternoEnVisor;
window.refrescarVisorArchivoExternoConMarca = refrescarVisorArchivoExternoConMarca;
window.toggleMarcaAguaRppc = toggleMarcaAguaRppc;
window.inicializarMarcaAguaRppc = inicializarMarcaAguaRppc;
window.imprimirRppcConMarcaAgua = imprimirRppcConMarcaAgua;
window.toggleMarcaAguaControlUrbano = toggleMarcaAguaControlUrbano;
window.inicializarMarcaAguaControlUrbano = inicializarMarcaAguaControlUrbano;
window.htmlOverlayMarcaAguaDocumento = htmlOverlayMarcaAguaDocumento;
window.htmlBotonesMarcaAguaDocumento = htmlBotonesMarcaAguaDocumento;
window.htmlAvisoMarcaAguaConsulta = htmlAvisoMarcaAguaConsulta;
window.aplicarMarcaAguaHtmlFichaInstitucional = aplicarMarcaAguaHtmlFichaInstitucional;
window.capturarOpcionesMarcaAguaFichaInstitucional = capturarOpcionesMarcaAguaFichaInstitucional;
window.escribirHtmlFichaVentanaInstitucional = escribirHtmlFichaVentanaInstitucional;
window.escribirHtmlFichaVentanaConMarcaConsulta = escribirHtmlFichaVentanaConMarcaConsulta;
window.abrirVentanaHtmlFichaInstitucional = abrirVentanaHtmlFichaInstitucional;
