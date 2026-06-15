function obtenerClaveSeleccionadaPDF() {
  const fichaClave = document.getElementById("fichaClave")?.innerText?.trim();
  if (fichaClave) return fichaClave;

  const inputClave = document.getElementById("claveInput")?.value?.trim();
  if (inputClave) return inputClave;

  try {
    const f = vectorSource.getFeatures().find(x => x.get("seleccionado") === true);
    return f ? (f.get("clave_catastral") || "") : "";
  } catch (e) {
    return "";
  }
}

function obtenerPropiedadesFichaPDF() {
  const clave = obtenerClaveSeleccionadaPDF();
  if (!clave) return null;

  try {
    const f = vectorSource.getFeatures().find(x => (x.get("clave_catastral") || "").toUpperCase() === clave.toUpperCase());
    if (f) return f.getProperties();
  } catch (e) {}

  return {
    clave_catastral: clave,
    nombre_completo: document.querySelector(".ficha-status-box .big + div")?.innerText || ""
  };
}

function formatoPdfMoneda(v) {
  const n = Number(v || 0);
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function textoPdf(v) {
  if (v === null || v === undefined || v === "") return "Sin dato";
  return String(v);
}

function capturarMapaOlParaPDF(mapInst, timeoutMs = 2500) {
  return new Promise(resolve => {
    let resuelto = false;
    const finalizar = (img) => {
      if (!resuelto) {
        resuelto = true;
        resolve(img);
      }
    };

    if (!mapInst || typeof mapInst.once !== "function") {
      finalizar(null);
      return;
    }

    setTimeout(() => finalizar(null), timeoutMs);

    try {
      const target = mapInst.getTargetElement ? mapInst.getTargetElement() : null;
      mapInst.once("rendercomplete", function () {
        try {
          const size = mapInst.getSize();
          const canvasFinal = document.createElement("canvas");
          canvasFinal.width = size[0];
          canvasFinal.height = size[1];
          const ctx = canvasFinal.getContext("2d");

          const scope = target || document;
          Array.prototype.forEach.call(
            scope.querySelectorAll(".ol-layer canvas, canvas.ol-layer"),
            function (canvas) {
              try {
                if (canvas.width > 0) {
                  const opacity = canvas.parentNode.style.opacity || canvas.style.opacity;
                  ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);

                  let matrix;
                  const transform = canvas.style.transform;
                  if (transform && transform.startsWith("matrix")) {
                    matrix = transform.match(/^matrix\(([^\(]*)\)$/)[1].split(",").map(Number);
                  } else {
                    matrix = [1, 0, 0, 1, 0, 0];
                  }

                  CanvasRenderingContext2D.prototype.setTransform.apply(ctx, matrix);
                  ctx.drawImage(canvas, 0, 0);
                }
              } catch (canvasError) {
                console.warn("Una capa no pudo capturarse para PDF:", canvasError);
              }
            }
          );

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          finalizar(canvasFinal.toDataURL("image/png"));
        } catch (e) {
          console.warn("No se pudo capturar el mapa para PDF:", e);
          finalizar(null);
        }
      });

      mapInst.renderSync();
    } catch (e) {
      console.warn("No se pudo iniciar captura del mapa:", e);
      finalizar(null);
    }
  });
}

function obtenerImagenMapaPDF() {
  try {
    return capturarMapaOlParaPDF(typeof map !== "undefined" ? map : null);
  } catch (e) {
    return Promise.resolve(null);
  }
}

async function generarQRPDF(clave) {
  try {
    const canvas = document.getElementById("qrPdfTemp") || document.createElement("canvas");
    const url = `${location.origin}${location.pathname}?clave=${encodeURIComponent(clave)}`;
    await QRCode.toCanvas(canvas, url, { width: 120, margin: 1 });
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("No se pudo generar QR:", e);
    return null;
  }
}


/* --- v20c: croquis institucional WMS para PDF cuando Google bloquea captura --- */
function obtenerFeatureSeleccionadaPDF() {
  try {
    const clave = obtenerClaveSeleccionadaPDF();
    return vectorSource.getFeatures().find(f =>
      (f.get("clave_catastral") || "").toUpperCase() === (clave || "").toUpperCase()
    ) || vectorSource.getFeatures().find(f => f.get("seleccionado") === true) || null;
  } catch (e) {
    return null;
  }
}

function expandirExtentPDF(extent, factor = 1.25) {
  const w = extent[2] - extent[0];
  const h = extent[3] - extent[1];
  const cx = (extent[0] + extent[2]) / 2;
  const cy = (extent[1] + extent[3]) / 2;
  const maxDim = Math.max(w, h, 80);
  const half = (maxDim * factor) / 2;
  return [cx - half, cy - half, cx + half, cy + half];
}

function cargarImagenPDF(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function dibujarGeometriaPDF(ctx, geom, bbox, width, height) {
  if (!geom) return;

  const extent = bbox;
  const minx = extent[0], miny = extent[1], maxx = extent[2], maxy = extent[3];

  function px(coord) {
    const x = ((coord[0] - minx) / (maxx - minx)) * width;
    const y = height - ((coord[1] - miny) / (maxy - miny)) * height;
    return [x, y];
  }

  function dibujarRing(coords) {
    if (!coords || coords.length === 0) return;
    ctx.beginPath();
    coords.forEach((c, i) => {
      const p = px(c);
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  const type = geom.getType();

  ctx.save();
  ctx.fillStyle = "rgba(21, 128, 61, 0.28)";
  ctx.strokeStyle = "#15803d";
  ctx.lineWidth = 6;

  if (type === "Polygon") {
    const rings = geom.getCoordinates();
    rings.forEach(r => dibujarRing(r));
  }

  if (type === "MultiPolygon") {
    const polys = geom.getCoordinates();
    polys.forEach(poly => poly.forEach(r => dibujarRing(r)));
  }

  ctx.restore();
}

async function generarCroquisWMSPDF() {
  try {
    const feature = obtenerFeatureSeleccionadaPDF();
    if (!feature || !feature.getGeometry()) return null;

    const width = 1100;
    const height = 620;

    const geom = feature.getGeometry();
    const extentOriginal = geom.getExtent();
    const bbox = expandirExtentPDF(extentOriginal, 3.0);

    const wmsUrl =
      "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms?" +
      "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap" +
      "&LAYERS=catastro_bc:predios_oficial" +
      "&STYLES=" +
      "&FORMAT=image/png" +
      "&TRANSPARENT=false" +
      "&SRS=EPSG:3857" +
      `&BBOX=${bbox.join(",")}` +
      `&WIDTH=${width}&HEIGHT=${height}`;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Fondo institucional claro
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    const img = await cargarImagenPDF(wmsUrl);
    if (img) {
      try {
        ctx.drawImage(img, 0, 0, width, height);
      } catch (e) {
        console.warn("No se pudo dibujar WMS en croquis PDF:", e);
      }
    } else {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#64748b";
      ctx.font = "bold 26px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Croquis institucional WMS", width / 2, height / 2 - 14);
      ctx.font = "20px Arial";
      ctx.fillText("No se pudo cargar imagen WMS, se dibuja la geometría seleccionada.", width / 2, height / 2 + 22);
    }

    // Rejilla ligera
    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,0.22)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.restore();

    // Predio seleccionado
    dibujarGeometriaPDF(ctx, geom, bbox, width, height);

    // Etiqueta
    const clave = feature.get("clave_catastral") || obtenerClaveSeleccionadaPDF();
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "#15803d";
    ctx.lineWidth = 2;
    ctx.roundRect(width - 270, 24, 235, 54, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(clave, width - 152, 59);
    ctx.restore();

    // Norte
    ctx.save();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(50, 50, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px Arial";
    ctx.textAlign = "center";
    ctx.fillText("N", 50, 60);
    ctx.restore();

    // Escala referencial
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(50, height - 45);
    ctx.lineTo(250, height - 45);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.font = "18px Arial";
    ctx.fillText("Escala gráfica referencial", 50, height - 18);
    ctx.restore();

    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("No se pudo generar croquis WMS PDF:", e);
    return null;
  }
}

function segmentosClaveFicha(clave) {
  const c = String(clave || "").trim().toUpperCase();
  const m = c.match(/^([A-Z]{1,3})(\d+)$/);
  if (!m) return { manzana: "NULL", lote: "NULL", fraccion: "NULL" };
  const numeros = m[2];
  const manzana = numeros.slice(0, 3) || "NULL";
  const lote = numeros.slice(3, 6) || "NULL";
  const fraccionRaw = numeros.slice(6);
  const fraccion = fraccionRaw ? (fraccionRaw.replace(/^0+/, "") || fraccionRaw) : "NULL";
  return { manzana, lote, fraccion };
}

function construirIdCatastralExtendido(clave) {
  const c = String(clave || "").trim().toUpperCase();
  const m = c.match(/^([A-Z]{1,3})(\d+)$/);
  if (!m) return c;
  const pref = m[1];
  const nums = m[2];
  const manzana = nums.slice(0, 3).padStart(3, "0");
  const lote = nums.slice(3, 6).padStart(5, "0");
  const fracc = (nums.slice(6) || "0").padStart(5, "0");
  return "020010040500010" + pref + manzana + lote + fracc;
}

function construirDomicilioFisicoFicha(p, numof) {
  const calle = String(p.calle || "CONOCIDO").trim();
  const colonia = String(p.colonia || "").trim();
  const delegacion = String(p.delegacion || "MEXICALI").trim();
  const num = String(numof || p.numof || "").trim();
  let txt = calle;
  if (num) txt += ", No. " + num + "- ";
  else txt += ", ";
  if (colonia) txt += "Col/Fracc. " + colonia;
  if (delegacion) txt += ", Delegacion " + delegacion;
  return txt.toUpperCase();
}

async function resolverNombreContribuyenteFicha(clave, p) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  try {
    if (typeof fetchPropietariosPredioCached === "function") {
      const tit = await fetchPropietariosPredioCached(claveNorm);
      if (tit?.propietarios?.length) {
        const props = tit.propietarios;
        const nombre = props.map(x => x.nombre_completo || x.razon_social || x.nombre).filter(Boolean).join(" / ");
        if (nombre) {
          if (props.length > 1 || Number(tit.total || 0) > 1) {
            const base = String(nombre).split(" / ")[0];
            return /\bY\s+COP\.?\b/i.test(nombre) ? nombre.toUpperCase() : (base + " Y COP.").toUpperCase();
          }
          return String(nombre).toUpperCase();
        }
      }
    }
  } catch (e) {}

  const nombre = String(p?.nombre_completo || p?.propietario || "—").trim();
  return nombre ? nombre.toUpperCase() : "—";
}

async function obtenerImagenStreetViewFicha(lat, lon, heading = 0, pitch = 0) {
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) return null;
  const url =
    "https://maps.googleapis.com/maps/api/streetview?size=800x450" +
    "&location=" + encodeURIComponent(Number(lat).toFixed(6) + "," + Number(lon).toFixed(6)) +
    "&fov=90&pitch=" + encodeURIComponent(String(Math.round(pitch))) +
    "&heading=" + encodeURIComponent(String(Math.round(heading) % 360)) +
    "&source=outdoor";
  try {
    const img = await cargarImagenPDF(url);
    if (!img || img.width < 50) return null;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (e) {
    return null;
  }
}

async function cargarDatosFichaCatastral(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;

  let feature = null;
  try {
    const r = await fetch(`${API}/padron/${encodeURIComponent(claveNorm)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (r.ok) feature = await r.json();
  } catch (e) {
    console.warn("No se pudo cargar ficha:", e);
  }

  const p = feature?.properties || window.predioSeleccionado || {};
  const seg = segmentosClaveFicha(claveNorm);
  const nombre = await resolverNombreContribuyenteFicha(claveNorm, p);
  const supDoc = Number(p.sup_documental || 0);
  const supFis = Number(p.sup_fisica || supDoc || 0);
  const anioValor = typeof ANIO_FISCAL_ZONA_HOMOGENEA !== "undefined" ? ANIO_FISCAL_ZONA_HOMOGENEA : 2026;

  let valorUnit = null;
  let valorFiscal = null;
  if (typeof calcularValoresFiscalesCedula === "function") {
    const vf = await calcularValoresFiscalesCedula(p);
    valorUnit = vf.valorUnit;
    valorFiscal = vf.valorFiscal;
  } else {
    const sup = supDoc || supFis;
    const v26 = Number(p.valor2026 || 0);
    if (v26 > 0 && sup > 0) {
      valorUnit = v26 >= 500 ? v26 : Math.round((v26 / sup) * 100) / 100;
      valorFiscal = Math.round(valorUnit * sup * 100) / 100;
    }
  }

  const centroide = await resolverCentroidePredioFicha(claveNorm, feature);
  const usuario = typeof obtenerUsuarioSesion === "function" ? obtenerUsuarioSesion() : null;
  const folioRaw = String(p.folio_real ?? "").trim();
  const folioReal = folioRaw && folioRaw !== "0" ? folioRaw : "—";

  return {
    clave: claveNorm,
    folioReal,
    feature,
    p,
    seg,
    nombre,
    colonia: String(p.colonia || "—").trim().toUpperCase(),
    calle: String(p.calle || "—").trim().toUpperCase(),
    numof: String(p.numof || "—").trim(),
    supDoc,
    supFis,
    uso: String(p.descripcion_uso || "—").trim().toUpperCase(),
    zonah: String(p.zona_homogenea || p.zonah || "—").trim().toUpperCase(),
    valorUnit,
    valorFiscal,
    valorUnitTxt: valorUnit != null
      ? ("$" + Number(valorUnit).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : "—",
    anioValor,
    lat: centroide.lat,
    lon: centroide.lon,
    geometry: centroide.geometry,
    fechaConsulta: new Date().toLocaleString("es-MX"),
    impresoPor: String(usuario?.usuario || usuario?.nombre || "consulta").trim(),
    tieneAdeudo: Number(p.adeudo_total || 0) > 0
  };
}

async function exportarFichaCatastralPdf(datos, imagenes = {}) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("No se cargó la librería jsPDF. Revise su conexión e intente recargar con Ctrl+F5.");
    throw new Error("jsPDF no disponible");
  }
  if (!datos) {
    throw new Error("Sin datos del predio");
  }

  const streetImg = imagenes.streetImg || null;
  const mapaImg = imagenes.mapaImg || null;
  const logoImg = typeof obtenerLogoInstitucionalDataUrl === "function"
    ? await obtenerLogoInstitucionalDataUrl()
    : null;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const guinda = [112, 51, 65];
  const grisTexto = [40, 48, 60];
  const margen = 10;
  const midX = pageW / 2;

  doc.setFillColor(...guinda);
  doc.rect(0, 0, pageW, 28, "F");
  if (logoImg) {
    try { doc.addImage(logoImg, "PNG", margen, 4, 30, 14); } catch (e) {}
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("FICHA CATASTRAL", logoImg ? 44 : margen, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Consulta Catastral Mexicali", logoImg ? 44 : margen, 17);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Clave Catastral: " + datos.clave, pageW - margen, 12, { align: "right" });
  doc.setFontSize(8);
  doc.text("Folio Real: " + (datos.folioReal || "—"), pageW - margen, 17, { align: "right" });

  doc.setTextColor(...grisTexto);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Fecha y hora de consulta: " + datos.fechaConsulta, margen, 34);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...guinda);
  doc.text("Nombre Registrado:", margen, 41);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grisTexto);
  const nomX = margen + doc.getTextWidth("Nombre Registrado: ") + 1;
  doc.text(datos.nombre, nomX, 41);
  doc.line(nomX, 41.7, nomX + doc.getTextWidth(datos.nombre), 41.7);

  function celdaPdf(label, value, x, y, w) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...grisTexto);
    doc.text(doc.splitTextToSize(String(value || "—"), w - 2), x, y + 4.5);
  }

  const yGrid1 = 48;
  const colW = (pageW - margen * 2) / 4;
  celdaPdf("COLONIA", datos.colonia, margen, yGrid1, colW);
  celdaPdf("CALLE", datos.calle, margen + colW, yGrid1, colW);
  celdaPdf("NÚMERO OFICIAL", datos.numof, margen + colW * 2, yGrid1, colW);
  celdaPdf("SUPERFICIE", datos.supDoc ? (Number(datos.supDoc).toFixed(2) + " m²") : "—", margen + colW * 3, yGrid1, colW);

  const yGrid2 = 60;
  celdaPdf("MANZANA", datos.seg.manzana, margen, yGrid2, colW);
  celdaPdf("LOTE", datos.seg.lote, margen + colW, yGrid2, colW);
  celdaPdf("ZONA HOMOGÉNEA", datos.zonah, margen + colW * 2, yGrid2, colW);
  celdaPdf("VALOR /M²", datos.valorUnitTxt, margen + colW * 3, yGrid2, colW);

  celdaPdf("USO PREDIAL", datos.uso, margen, 72, pageW - margen * 2);

  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.25);
  doc.line(margen, 46, pageW - margen, 46);
  doc.line(margen, 58, pageW - margen, 58);
  doc.line(margen, 70, pageW - margen, 70);

  function marcoImagenPdf(yTop, h, titulo, imgData, vacioMsg, x = margen, w = pageW - margen * 2) {
    doc.setDrawColor(...guinda);
    doc.setLineWidth(0.35);
    doc.setFillColor(252, 252, 253);
    doc.roundedRect(x, yTop, w, h, 1.5, 1.5, "FD");
    doc.setFillColor(...guinda);
    doc.rect(x, yTop, w, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(titulo, x + 3, yTop + 4.2);
    const innerY = yTop + 7;
    const innerH = h - 8;
    if (imgData) {
      try {
        doc.addImage(imgData, "PNG", x + 1.5, innerY, w - 3, innerH);
      } catch (e) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text("Imagen no disponible.", x + w / 2, innerY + innerH / 2, { align: "center" });
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(vacioMsg, x + w / 2, innerY + innerH / 2, { align: "center" });
    }
  }

  const yMedia = 78;
  const mediaW = pageW - margen * 2;
  const hStreet = streetImg ? 52 : 0;
  const hMapa = 78;
  if (streetImg) {
    marcoImagenPdf(
      yMedia,
      hStreet,
      "VISTA DE CALLE",
      streetImg,
      "Sin vista de calle disponible.",
      margen,
      mediaW
    );
  }
  const yMapa = streetImg ? yMedia + hStreet + 4 : yMedia;
  marcoImagenPdf(
    yMapa,
    hMapa,
    "LOCALIZACIÓN CARTOGRÁFICA",
    mapaImg,
    "Sin croquis cartográfico.",
    margen,
    mediaW
  );

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(100, 110, 125);
  doc.text("Documento generado por el Sistema de Gestión Catastral · " + datos.impresoPor, margen, pageH - 10);
  doc.text(new Date().toLocaleDateString("es-MX"), pageW - margen, pageH - 10, { align: "right" });

  doc.save("ficha_catastral_" + datos.clave + ".pdf");
}

window.capturarMapaOlParaPDF = capturarMapaOlParaPDF;
window.cargarDatosFichaCatastral = cargarDatosFichaCatastral;
window.exportarFichaCatastralPdf = exportarFichaCatastralPdf;

async function generarFichaCatastralGeneralPDF() {
  if (typeof abrirVentanaFichaCatastralGeneral === "function") {
    return abrirVentanaFichaCatastralGeneral();
  }
  if (typeof abrirPreviewFichaCatastralGeneral === "function") {
    return abrirPreviewFichaCatastralGeneral();
  }

  const clave = String(
    window.predioSeleccionado?.clave_catastral ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio en el panel de análisis para generar la ficha.");
    return;
  }

  const datos = await cargarDatosFichaCatastral(clave);
  if (!datos) return;

  let streetImg = await obtenerImagenStreetViewFicha(datos.lat, datos.lon);
  let mapaImg = await generarCroquisWMSPDF();
  await exportarFichaCatastralPdf(datos, { streetImg, mapaImg });
}

async function resolverCentroidePredioFicha(clave, feature) {
  let geom = null;
  if (feature?.geometry) {
    try {
      const format = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      geom = format.readFeature(feature).getGeometry();
    } catch (e) {}
  }
  if (!geom && typeof resolverGeometriaPredioPopup === "function") {
    try { geom = await resolverGeometriaPredioPopup(clave); } catch (e) {}
  }
  if (!geom && typeof obtenerGeometriaPredioSeleccionado === "function") {
    geom = obtenerGeometriaPredioSeleccionado(clave);
  }
  if (!geom) return { lat: null, lon: null, geometry: null };

  try {
    let center3857;
    if (typeof geom.getInteriorPoint === "function") {
      center3857 = geom.getInteriorPoint().getCoordinates();
    } else {
      center3857 = ol.extent.getCenter(geom.getExtent());
    }
    const [lon, lat] = ol.proj.toLonLat(center3857);
    return { lat, lon, geometry: geom };
  } catch (e) {
    return { lat: null, lon: null, geometry: geom };
  }
}

window.generarFichaCatastralGeneralPDF = generarFichaCatastralGeneralPDF;
window.capturarMapaOlParaPDF = capturarMapaOlParaPDF;

async function generarPDFInstitucional() {
  const btn = document.getElementById("btnPdfInstitucional");
  const estado = document.getElementById("estadoPdfInstitucional");

  const setEstado = (txt, tipo = "") => {
    if (!estado) return;
    estado.innerText = txt;
    estado.className = "estado-pdf " + tipo;
  };

  try {
    const clave = obtenerClaveSeleccionadaPDF();

    if (!clave) {
      alert("Primero selecciona o busca un predio para generar el PDF.");
      return;
    }

    if (typeof window.jspdf === "undefined") {
      alert("No se cargó la librería jsPDF. Revisa conexión a internet o bloqueo de CDN.");
      setEstado("No se cargó jsPDF.", "error");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerText = "⏳ Generando PDF...";
    }
    setEstado("Generando ficha institucional...", "procesando");

    let feature = null;
    try {
      const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, { cache: "no-store", headers: authHeaders() });
      if (r.ok) feature = await r.json();
    } catch (e) {
      console.warn("No se pudo cargar ficha para PDF:", e);
    }

    const p = feature?.properties || obtenerPropiedadesFichaPDF() || {};
    setEstado("Capturando mapa...", "procesando");
    let mapaImg = await obtenerImagenMapaPDF();
    if (!mapaImg) {
      setEstado("Google bloqueó captura; generando croquis WMS institucional...", "procesando");
      mapaImg = await generarCroquisWMSPDF();
    }

    setEstado("Generando QR...", "procesando");
    const qrImg = await generarQRPDF(clave);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "letter");

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const guinda = [112, 51, 65];
    const grisTexto = [40, 48, 60];
    const grisClaro = [245, 247, 250];
    const rojo = [198, 40, 40];
    const verde = [21, 128, 61];

    // Header
    doc.setFillColor(...guinda);
    doc.rect(0, 0, pageW, 25, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Sistema de Gestión Catastral", 14, 10);
    doc.setFontSize(10);
    doc.text("Ficha predial institucional · Catastro Mexicali", 14, 17);

    doc.setFontSize(9);
    const fecha = new Date().toLocaleString("es-MX");
    doc.text(`Fecha: ${fecha}`, pageW - 14, 10, { align: "right" });
    doc.text(`Clave: ${clave}`, pageW - 14, 17, { align: "right" });

    // Title block
    doc.setTextColor(...grisTexto);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`Ficha predial: ${clave}`, 14, 36);

    const tieneAdeudo = Number(p.adeudo_total || 0) > 0;
    doc.setFillColor(...(tieneAdeudo ? rojo : verde));
    doc.roundedRect(pageW - 62, 29, 48, 10, 2, 2, "F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(8);
    doc.text(tieneAdeudo ? "CON ADEUDO" : "SIN ADEUDO", pageW - 38, 35.5, { align: "center" });

    // Croquis
    doc.setDrawColor(220, 225, 232);
    doc.setFillColor(...grisClaro);
    doc.roundedRect(14, 43, pageW - 28, 78, 2, 2, "FD");

    if (mapaImg) {
      try {
        doc.addImage(mapaImg, "PNG", 16, 45, pageW - 32, 74);
      } catch (imgErr) {
        console.warn("No se pudo insertar la imagen del mapa en PDF:", imgErr);
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        doc.text("Croquis no disponible; no se pudo capturar Google ni generar WMS.", pageW / 2, 80, { align: "center" });
        doc.text("El PDF se genera con la información predial institucional.", pageW / 2, 87, { align: "center" });
      }
    } else {
      doc.setFontSize(10);
      doc.setTextColor(120, 120, 120);
      doc.text("Croquis no disponible; no se pudo capturar Google ni generar WMS.", pageW / 2, 80, { align: "center" });
      doc.text("El PDF se genera con la información predial institucional.", pageW / 2, 87, { align: "center" });
    }

    // Norte y escala visual simple
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(0, 0, 0);
    doc.circle(pageW - 27, 54, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("N", pageW - 27, 57, { align: "center" });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.7);
    doc.line(22, 113, 62, 113);
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text("Escala gráfica referencial", 22, 117);

    // Datos principales
    let y = 132;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...guinda);
    doc.text("Información del predio", 14, y);

    y += 6;

    function row(label, value, x1, x2, yy) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...guinda);
      doc.setFontSize(8);
      doc.text(label, x1, yy);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...grisTexto);
      doc.text(doc.splitTextToSize(textoPdf(value), x2 - x1 - 4), x1 + 35, yy);
    }

    doc.setDrawColor(230, 234, 240);
    doc.setFillColor(252, 252, 253);
    doc.roundedRect(14, y, pageW - 28, 58, 2, 2, "FD");

    row("Clave", p.clave_catastral || clave, 18, pageW/2, y + 9);
    row("Propietario", p.nombre_completo || p.propietario, 18, pageW - 18, y + 18);
    row("Delegación", p.delegacion, 18, pageW/2, y + 27);
    row("Colonia", p.colonia, pageW/2 + 2, pageW - 18, y + 27);
    row("Calle", p.calle, 18, pageW/2, y + 36);
    row("# Oficial", p.numof, pageW/2 + 2, pageW - 18, y + 36);
    row("Zona H.", p.zona_homogenea || p.zonah, 18, pageW/2, y + 45);
    row("Uso", p.descripcion_uso, pageW/2 + 2, pageW - 18, y + 45);

    y += 68;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...guinda);
    doc.text("Valores, superficies y estado fiscal", 14, y);

    y += 6;
    doc.setDrawColor(230, 234, 240);
    doc.setFillColor(252, 252, 253);
    doc.roundedRect(14, y, pageW - 28, 42, 2, 2, "FD");

    row("Valor 2026", formatoPdfMoneda(p.valor2026), 18, pageW/2, y + 10);
    row("Sup. doc.", `${textoPdf(p.sup_documental)} m²`, pageW/2 + 2, pageW - 18, y + 10);
    row("Sup. física", `${textoPdf(p.sup_fisica)} m²`, 18, pageW/2, y + 20);
    row("Sup. const.", `${textoPdf(p.sup_const)} m²`, pageW/2 + 2, pageW - 18, y + 20);
    row("Adeudo 2026", formatoPdfMoneda(p.adeudo_2026), 18, pageW/2, y + 30);
    row("Adeudo total", formatoPdfMoneda(p.adeudo_total), pageW/2 + 2, pageW - 18, y + 30);

    if (qrImg) {
      try {
        doc.addImage(qrImg, "PNG", pageW - 42, pageH - 42, 28, 28);
        doc.setFontSize(7);
        doc.setTextColor(80, 80, 80);
        doc.text("Consulta digital", pageW - 28, pageH - 10, { align: "center" });
      } catch(e) {
        console.warn("QR no insertado:", e);
      }
    }

    doc.setDrawColor(...guinda);
    doc.setLineWidth(0.5);
    doc.line(14, pageH - 18, pageW - 48, pageH - 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    doc.text("Documento generado automáticamente por el Sistema de Gestión Catastral. Información sujeta a validación institucional.", 14, pageH - 12);

    setEstado("PDF generado correctamente.", "ok");
    doc.save(`ficha_predial_${clave}.pdf`);

  } catch (e) {
    console.error("Error generando PDF:", e);
    alert("No se pudo generar el PDF. Abre la consola del navegador para ver el detalle.");
    setEstado("Error al generar PDF.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "📄 Generar ficha PDF";
    }
  }
}

