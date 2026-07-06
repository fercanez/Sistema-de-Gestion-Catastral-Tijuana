async function abrirPredioCondominioIdx(idx) {
  const row = (_analisisCondominiosState.unidades || [])[idx];
  if (!row?.clave_catastral) return;
  await abrirPredioDesdeCondominio(row.clave_catastral);
}
window.abrirPredioCondominioIdx = abrirPredioCondominioIdx;

async function abrirPredioDesdeCondominio(clave) {
  if (!clave) return;
  cerrarModuloAnalisisCondominios();
  mostrarTab("tabConsulta", document.querySelector(".tab-btn[onclick*=\"tabConsulta\"]"));
  document.getElementById("claveInput").value = clave;
  if (typeof seleccionarPorClave === "function") {
    await seleccionarPorClave(clave, "condominios");
  }
}
window.abrirPredioDesdeCondominio = abrirPredioDesdeCondominio;

function exportarCatalogoCondominiosExcel() {
  const rows = _analisisCondominiosState.catalogo || [];
  if (!rows.length || typeof XLSX === "undefined") {
    alert(rows.length ? "No se pudo cargar Excel." : "No hay datos para exportar.");
    return;
  }
  const filas = rows.map(r => ({
    Tipo: r.tipo_nombre || r.tipo,
    "Valor padrón": r.condominio || r.valor_padron,
    Unidades: r.unidades,
    Colonias: r.colonias,
    "Valor total": r.valor_total,
    "Adeudo total": r.adeudo_total
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Tipos condominio");
  XLSX.writeFile(wb, "catalogo_condominios_" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
window.exportarCatalogoCondominiosExcel = exportarCatalogoCondominiosExcel;

function exportarUnidadesCondominioExcel() {
  const rows = _analisisCondominiosState.unidades || [];
  if (!rows.length || typeof XLSX === "undefined") {
    alert(rows.length ? "No se pudo cargar Excel." : "No hay unidades para exportar.");
    return;
  }
  const filas = rows.map(r => ({
    "Clave catastral": r.clave_catastral,
    Tipo: r.tipo_nombre || r.tipo,
    "Valor padrón": r.condominio,
    Titular: r.nombre_completo,
    Colonia: r.colonia,
    Calle: r.calle,
    "No. oficial": r.numof,
    Interior: r.numint,
    Letra: r.letra,
    "Zona H.": r.zona_homogenea,
    "Valor 2026": r.valor2026,
    "Adeudo 2026": r.adeudo_2026,
    "Adeudo total": r.adeudo_total,
    "Sup. documental": r.sup_documental,
    "Sup. construcción": r.sup_const,
    Uso: r.descripcion_uso
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Unidades");
  XLSX.writeFile(wb, "unidades_condominio_" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
window.exportarUnidadesCondominioExcel = exportarUnidadesCondominioExcel;

async function obtenerLogoInstitucionalDataUrl() {
  if (_logoInstitucionalCache) return _logoInstitucionalCache;
  try {
    const r = await fetch("logotijuana.png?_=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise(function(resolve) {
      const fr = new FileReader();
      fr.onload = function() { _logoInstitucionalCache = fr.result; resolve(fr.result); };
      fr.onerror = function() { resolve(null); };
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

function renderAnalisisZonasCompleto() {
  renderAnalisisZonasLista();
  renderAnalisisZonasDetalle(registroAnalisisZonasActual());
}

async function imprimirCedulaZonaHomogenea() {
  const reg = registroAnalisisZonasActual();
  if (!reg) {
    alert("Seleccione una zona homogénea.");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Generador PDF no disponible.");
    return;
  }

  dibujarGraficaEvolucionZona(reg);
  const chartImg = obtenerImagenGraficaZonaHomogenea(reg);
  const logoImg = await obtenerLogoInstitucionalDataUrl();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const guinda = [112, 51, 65];
  const grisTexto = [40, 48, 60];
  const grisClaro = [245, 247, 250];
  const cod = reg.clave_zonah || reg.codigo_zona_homogenea || "";
  const fecha = new Date().toLocaleString("es-MX");

  doc.setFillColor(...guinda);
  doc.rect(0, 0, pageW, 32, "F");
  if (logoImg) {
    try {
      doc.addImage(logoImg, "PNG", 12, 4, 38, 18);
    } catch (e) { /* continuar sin logo */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Sistema de Gestión Catastral", logoImg ? 54 : 14, 12);
  doc.setFontSize(10);
  doc.text("Dirección de Catastro · H. Ayuntamiento de Tijuana", logoImg ? 54 : 14, 19);
  doc.setFontSize(9);
  doc.text("Estado de Baja California, México", logoImg ? 54 : 14, 25);
  doc.text(`Fecha: ${fecha}`, pageW - 14, 12, { align: "right" });
  doc.text(`Código zonah: ${cod}`, pageW - 14, 19, { align: "right" });

  doc.setTextColor(...grisTexto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Cédula de valor unitario de suelo", 14, 44);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Tabla de zonas homogéneas · ejercicios fiscales 2024, 2025 y 2026", 14, 51);

  doc.setDrawColor(220, 225, 232);
  doc.setFillColor(...grisClaro);
  doc.roundedRect(14, 56, pageW - 28, 36, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...guinda);
  doc.text("IDENTIFICACIÓN DE LA ZONA HOMOGÉNEA", 18, 63);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grisTexto);
  doc.setFontSize(10);
  doc.text(`Código (zonah): ${cod}`, 18, 71);
  doc.text(`Descripción: ${reg.descripcion_col_fracc || "—"}`, 18, 78);
  doc.text(`Zona: ${reg.zona || "—"}   Sector: ${reg.sector || "—"}   Subsector: ${reg.subsector || "—"}`, 18, 85);

  let y = 100;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...guinda);
  doc.text("Valores unitarios de suelo (MXN / m²)", 14, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...grisTexto);
  const aniosPdf = obtenerAniosAnalisisZonas();
  aniosPdf.forEach(function(an) {
    const val = reg["valor_" + an] != null
      ? reg["valor_" + an]
      : ((reg.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
    doc.setFillColor(...grisClaro);
    doc.roundedRect(14, y - 4, pageW - 28, 8, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.text(String(an), 18, y + 1);
    doc.setFont("helvetica", "normal");
    doc.text(val != null ? formatValorM2(val) : "Sin registro", 42, y + 1);
    y += 10;
  });

  if (reg.variacion_pct != null) {
    y += 2;
    const signo = reg.variacion_abs >= 0 ? "+" : "";
    const desde = reg.variacion_desde || aniosPdf[0];
    const hasta = reg.variacion_hasta || aniosPdf[aniosPdf.length - 1];
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...guinda);
    doc.text(`Variación ${desde} → ${hasta}: ${signo}${reg.variacion_pct}% (${signo}$${Number(reg.variacion_abs || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })})`, 14, y);
    y += 8;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...guinda);
  doc.text("Gráfica de evolución del valor unitario", 14, y);
  y += 4;

  if (chartImg) {
    try {
      doc.addImage(chartImg, "PNG", 14, y, pageW - 28, 82);
      y += 86;
    } catch (e) {
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text("No se pudo insertar la gráfica en el PDF.", 14, y + 10);
      y += 16;
    }
  }

  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.4);
  doc.line(14, pageH - 22, pageW - 14, pageH - 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 110, 125);
  doc.text("Documento oficial generado por el Sistema de Gestión Catastral del H. Ayuntamiento de Tijuana.", 14, pageH - 16);
  doc.text("Los valores corresponden a la tabla de zonas homogéneas. Uso institucional · Sujeto a validación catastral.", 14, pageH - 11);

  doc.save(`cedula_zona_homogenea_${cod}.pdf`);
}
window.imprimirCedulaZonaHomogenea = imprimirCedulaZonaHomogenea;

/* ============================================================
   v76 - Mantenimiento de propietarios
============================================================ */
function mensajeErrorApiPropietarios(status, txt, accion) {
  if (status === 405) {
    return "El servidor no tiene activa la función de " + accion + " (HTTP 405). " +
      "Suba routers/propietarios.py y main.py al servidor y ejecute: sudo systemctl restart catastro-tijuana-api";
  }
  if (status === 404 && accion === "fusionar") {
    return "Endpoint /propietarios/fusionar no encontrado. Actualice propietarios.py en el servidor y reinicie la API.";
  }
  return null;
}

async function verificarApiMantenimientoPropietarios() {
  try {
    const r = await fetch(`${API}/`, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.propietarios_fusionar) {
      setMantPropMsg(
        "⚠ API sin fusión/borrado (v" + (data.version || "?") + "). Actualice propietarios.py en el servidor.",
        false
      );
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

const mantPropEstado = {
  resultados: [],
  indiceActivo: -1,
  buscando: false,
  fusionIds: new Set(),
  fusionPadronIdx: new Set(),
  fusionDestinoMeta: null,
  registroPadronCache: new Map()
};
let mantPropCallesTimer = null;

function setMantPropMsg(texto, ok) {
  const cls = "mant-prop-msg " + (ok ? "ok" : texto ? "error" : "");
  ["mantPropMsg", "mantPropToolbarMsg"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = texto || "";
    el.className = cls;
  });
}

function elegirDestinoFusionPropietarios(ids) {
  const lista = (ids || []).map(Number).filter(Boolean);
  if (lista.length < 2) return 0;
  const lineas = lista.map((id, i) => {
    const r = (mantPropEstado.resultados || []).find(x => Number(x.id_persona) === id);
    const nom = r ? nombrePersonaCatalogo(r) : ("ID " + id);
    return `${i + 1}. ${nom}`;
  });
  const resp = prompt(
    "¿Cuál registro se CONSERVARÁ?\n" +
    "Los demás marcados se fusionarán en él.\n\n" +
    lineas.join("\n") +
    `\n\nEscriba el número (1-${lista.length}):`,
    "1"
  );
  if (resp === null) return 0;
  const n = parseInt(String(resp).trim(), 10);
  if (!n || n < 1 || n > lista.length) {
    alert("Selección inválida. Indique un número de la lista.");
    return 0;
  }
  return lista[n - 1];
}

function itemsMarcadosFusionMantenimiento() {
  const items = [];
  (mantPropEstado.resultados || []).forEach((r, idx) => {
    const id = Number(r.id_persona || 0);
    const nombre = nombrePersonaCatalogo(r);
    if (id && mantPropEstado.fusionIds.has(id)) {
      items.push({ kind: "catalogo", id, idx, nombre, row: r });
    } else if (!id && mantPropEstado.fusionPadronIdx.has(idx)) {
      items.push({ kind: "padron", id: 0, idx, nombre, row: r });
    }
  });
  return items;
}

function esNombrePersonaMoral(nombre) {
  const t = ` ${normalizarPersonaCatalogo(nombre)} `;
  if (/\b(S\.?\s*A\.?|S,A|S DE R\.?L\.?|S\.?\s*C\.?)\b/.test(t)) return true;
  if (/\bS\.?\s*A\.?\s*DE\s*C\.?\s*V\.?\b/.test(t)) return true;
  const claves = [
    " MUNICIPIO ", " GOBIERNO ", " SECRETARIA ", " FEDERACION ", " EJIDO ",
    " INSTITUTO ", " ASOCIACION ", " SA DE CV ", " UNIVERSIDAD ", " CAMARA ",
    " COMITE ", " EMPRESA ", " PRODUCTOS ", " AGRICOLA "
  ];
  return claves.some(k => t.includes(k));
}

function buildPayloadPropietarioDesdeRow(row) {
  const nombreCompleto = normalizarPersonaCatalogo(row.nombre_completo || row.razon_social || "");
  let tipo = esResultadoMoral(row) ? "MORAL" : "FISICA";
  if (tipo === "FISICA" && esNombrePersonaMoral(nombreCompleto)) tipo = "MORAL";
  const payload = {
    tipo_persona: tipo,
    rfc: normalizarPersonaCatalogo(row.rfc) || null,
    curp: normalizarPersonaCatalogo(row.curp) || null,
    calle: normalizarPersonaCatalogo(row.calle) || null,
    colonia: normalizarPersonaCatalogo(row.colonia) || null,
    numof: row.numof != null && row.numof !== "" ? normalizarPersonaCatalogo(String(row.numof)) : null,
    cp: normalizarPersonaCatalogo(row.cp) || null,
    delegacion: normalizarPersonaCatalogo(row.delegacion) || null,
    activo: true
  };
  if (tipo === "MORAL") {
    payload.razon_social = normalizarPersonaCatalogo(row.razon_social || row.nombre_completo) || null;
  } else {
    const cols = columnasPersonaResultado(row);
    const div = dividirNombrePropietario(cols.nombres);
    payload.apellido_paterno = normalizarPersonaCatalogo(cols.paterno) || null;
    payload.apellido_materno = normalizarPersonaCatalogo(cols.materno) || null;
    payload.nombre = unirNombrePropietario(div.n1, div.n2) || null;
  }
  return payload;
}

async function registrarPropietarioCatalogoDesdeRow(row, idx) {
  if (!row) return 0;
  const idxKey = idx != null ? Number(idx) : -1;
  if (idxKey >= 0 && mantPropEstado.registroPadronCache.has(idxKey)) {
    return mantPropEstado.registroPadronCache.get(idxKey);
  }
  if (row.id_persona) {
    const id = Number(row.id_persona);
    if (idxKey >= 0) mantPropEstado.registroPadronCache.set(idxKey, id);
    return id;
  }
  const payload = buildPayloadPropietarioDesdeRow(row);
  if (payload.tipo_persona === "MORAL" && !payload.razon_social) return 0;
  if (payload.tipo_persona === "FISICA" && !payload.nombre && !payload.apellido_paterno) return 0;

  const r = await fetch(`${API}/propietarios`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo registrar el propietario en catálogo."));
  const persona = extraerPersonaApi(data) || data.propietario || data;
  const id = Number(persona?.id_persona || 0);
  if (id && idxKey >= 0) mantPropEstado.registroPadronCache.set(idxKey, id);
  return id;
}

function fijarDestinoFusionMantenimiento(id, nombre) {
  mantPropEstado.fusionDestinoMeta = {
    id: Number(id),
    nombre: normalizarPersonaCatalogo(nombre) || ""
  };
  return Number(id);
}

function nombreDestinoFusionMantenimiento(destinoId) {
  const meta = mantPropEstado.fusionDestinoMeta;
  if (meta && Number(meta.id) === Number(destinoId) && meta.nombre) return meta.nombre;
  const row = (mantPropEstado.resultados || []).find(x => Number(x.id_persona) === Number(destinoId));
  if (row) return nombrePersonaCatalogo(row);
  for (const [idx, id] of mantPropEstado.registroPadronCache.entries()) {
    if (Number(id) === Number(destinoId)) {
      const r = mantPropEstado.resultados[idx];
      if (r) return nombrePersonaCatalogo(r);
    }
  }
  return "";
}

function nombreOrigenFusionMantenimiento(id) {
  const row = (mantPropEstado.resultados || []).find(x => Number(x.id_persona) === Number(id));
  if (row) return nombrePersonaCatalogo(row);
  for (const [idx, cachedId] of mantPropEstado.registroPadronCache.entries()) {
    if (Number(cachedId) === Number(id)) {
      const r = mantPropEstado.resultados[idx];
      if (r) return nombrePersonaCatalogo(r);
    }
  }
  return "ID " + id;
}

async function elegirDestinoFusionMixto(items) {
  if ((items || []).length < 2) return 0;
  const lineas = items.map((it, i) => {
    const suf = it.kind === "padron" ? " [padrón]" : "";
    return `${i + 1}. ${it.nombre}${suf}`;
  });
  const resp = prompt(
    "¿Cuál registro se CONSERVARÁ?\n" +
    "Los demás marcados se fusionarán en él.\n" +
    "(Los del padrón se registrarán en catálogo automáticamente.)\n\n" +
    lineas.join("\n") +
    `\n\nEscriba el número (1-${items.length}):`,
    "1"
  );
  if (resp === null) return 0;
  const n = parseInt(String(resp).trim(), 10);
  if (!n || n < 1 || n > items.length) {
    alert("Selección inválida. Indique un número de la lista.");
    return 0;
  }
  const sel = items[n - 1];
  if (sel.kind === "catalogo") return fijarDestinoFusionMantenimiento(sel.id, sel.nombre);
  const id = await registrarPropietarioCatalogoDesdeRow(sel.row, sel.idx);
  if (!id) return 0;
  return fijarDestinoFusionMantenimiento(id, sel.nombre);
}

async function resolverDestinoFusionMantenimiento() {
  mantPropEstado.fusionDestinoMeta = null;
  const items = itemsMarcadosFusionMantenimiento();
  const idxOk = idxActivoEnResultadosActualesMantenimiento();

  let destinoId = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  if (destinoId && !idPersonaEnResultadosActualesMantenimiento(destinoId)) {
    document.getElementById("mantPropIdPersona").value = "";
    destinoId = 0;
  }

  if (idxOk >= 0) {
    const row = mantPropEstado.resultados[idxOk];
    if (row?.id_persona) {
      return fijarDestinoFusionMantenimiento(row.id_persona, nombrePersonaCatalogo(row));
    }
    if (row && row.origen === "padron" && !row.id_persona) {
      setMantPropMsg("Registrando titular destino del padrón en catálogo...", true);
      const id = await registrarPropietarioCatalogoDesdeRow(row, idxOk);
      if (!id) return 0;
      return fijarDestinoFusionMantenimiento(id, nombrePersonaCatalogo(row));
    }
  }

  if (destinoId && idPersonaEnResultadosActualesMantenimiento(destinoId)) {
    const row = mantPropEstado.resultados.find(x => Number(x.id_persona) === destinoId);
    return fijarDestinoFusionMantenimiento(destinoId, row ? nombrePersonaCatalogo(row) : "");
  }

  if (items.length >= 2) {
    setMantPropMsg("Seleccione titular destino...", true);
    return elegirDestinoFusionMixto(items);
  }

  return 0;
}

function idPersonaEnResultadosActualesMantenimiento(id) {
  return (mantPropEstado.resultados || []).some(r => Number(r.id_persona) === Number(id));
}

function idxActivoEnResultadosActualesMantenimiento() {
  const idx = mantPropEstado.indiceActivo;
  const total = (mantPropEstado.resultados || []).length;
  if (idx < 0 || idx >= total) return -1;
  return idx;
}

function resetDestinoTrasNuevaBusquedaMantenimiento() {
  const q = document.getElementById("mantPropBuscar")?.value || "";
  limpiarFormularioMantenimientoPropietario();
  const inp = document.getElementById("mantPropBuscar");
  if (inp) inp.value = q;
}

async function resolverOrigenesFusionMantenimiento(destinoId) {
  const origenes = [...mantPropEstado.fusionIds]
    .map(Number)
    .filter(id => id && id !== destinoId);

  for (const idx of mantPropEstado.fusionPadronIdx) {
    const row = mantPropEstado.resultados[idx];
    if (!row) continue;
    let id = Number(row.id_persona || 0);
    if (!id) id = await registrarPropietarioCatalogoDesdeRow(row, idx);
    if (id && id !== destinoId && !origenes.includes(id)) origenes.push(id);
  }
  return origenes;
}

function setMantPropProgress(visible) {
  const el = document.getElementById("mantPropProgress");
  if (el) el.classList.toggle("oculto", !visible);
}

function dividirNombrePropietario(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return { n1: "", n2: "" };
  if (partes.length === 1) return { n1: partes[0], n2: "" };
  return { n1: partes[0], n2: partes.slice(1).join(" ") };
}

function unirNombrePropietario(n1, n2) {
  return [n1, n2].map(v => String(v || "").trim()).filter(Boolean).join(" ");
}

function generarNombreCompletoMantenimiento() {
  const tipo = document.getElementById("mantPropTipoPersona")?.value || "FISICA";
  let nombre = "";
  if (tipo === "MORAL") {
    nombre = normalizarPersonaCatalogo(document.getElementById("mantPropRazonSocial")?.value);
  } else {
    nombre = [
      normalizarPersonaCatalogo(document.getElementById("mantPropApPat")?.value),
      normalizarPersonaCatalogo(document.getElementById("mantPropApMat")?.value),
      unirNombrePropietario(
        document.getElementById("mantPropNombre1")?.value,
        document.getElementById("mantPropNombre2")?.value
      )
    ].filter(Boolean).join(" ");
  }
  const out = document.getElementById("mantPropNombreCompleto");
  if (out) out.value = nombre;
  return nombre;
}

function cambiarTipoPersonaMantenimiento() {
  const tipo = document.getElementById("mantPropTipoPersona")?.value || "FISICA";
  const fisica = document.getElementById("mantPropBloqueFisica");
  const moral = document.getElementById("mantPropBloqueMoral");
  if (fisica) fisica.classList.toggle("oculto", tipo === "MORAL");
  if (moral) moral.classList.toggle("oculto", tipo !== "MORAL");
  generarNombreCompletoMantenimiento();
}
window.cambiarTipoPersonaMantenimiento = cambiarTipoPersonaMantenimiento;

function limpiarFormularioMantenimientoPropietario() {
  ["mantPropIdPersona", "mantPropClavePredio", "mantPropApPat", "mantPropApMat", "mantPropNombre1",
    "mantPropNombre2", "mantPropRazonSocial", "mantPropRFC", "mantPropCURP", "mantPropCalle",
    "mantPropIdCalle", "mantPropNumof", "mantPropColonia", "mantPropCP", "mantPropDelegacion", "mantPropClaveDisplay",
    "mantPropNombreCompleto"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const tipo = document.getElementById("mantPropTipoPersona");
  if (tipo) tipo.value = "FISICA";
  cambiarTipoPersonaMantenimiento();
  mantPropEstado.indiceActivo = -1;
  mantPropEstado.fusionIds = new Set();
  mantPropEstado.fusionPadronIdx = new Set();
  document.querySelectorAll("#mantPropGridBody tr[data-idx]").forEach(r => r.classList.remove("activo"));
  const chkTodos = document.getElementById("mantPropFusionTodos");
  if (chkTodos) chkTodos.checked = false;
  setMantPropMsg("", true);
  limpiarSugerenciasCallesMantenimiento();
}

function limpiarSugerenciasCallesMantenimiento() {
  const cont = document.getElementById("mantPropSugCalles");
  if (cont) cont.innerHTML = "";
}

function seleccionarCalleMantenimiento(nombre, idCalle, origen) {
  const inp = document.getElementById("mantPropCalle");
  const hid = document.getElementById("mantPropIdCalle");
  if (inp) inp.value = normalizarPersonaCatalogo(nombre);
  if (hid) hid.value = idCalle ? String(idCalle) : "";
  limpiarSugerenciasCallesMantenimiento();
  if (origen === "padron") {
    setMantPropMsg("Calle del padrón — al grabar se puede registrar en catálogo de calles.", true);
  }
}

function renderSugerenciasCallesMantenimiento(calles, textoBusqueda) {
  const cont = document.getElementById("mantPropSugCalles");
  if (!cont) return;
  const texto = normalizarPersonaCatalogo(textoBusqueda);
  const catalogo = (calles || []).filter(c => c.origen !== "padron");
  const padron = (calles || []).filter(c => c.origen === "padron");
  const hayExacta = catalogo.some(c => c.nombre_calle === texto);

  cont.innerHTML = "";

  catalogo.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mant-prop-sug-item";
    btn.textContent = c.nombre_calle;
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => seleccionarCalleMantenimiento(c.nombre_calle, c.id || 0, "catalogo"));
    cont.appendChild(btn);
  });

  padron.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mant-prop-sug-item padron";
    btn.title = "Del padrón fiscal";
    btn.textContent = `${c.nombre_calle} · padrón`;
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => seleccionarCalleMantenimiento(c.nombre_calle, 0, "padron"));
    cont.appendChild(btn);
  });

  if (texto && !hayExacta) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mant-prop-sug-item crear";
    btn.textContent = `➕ Crear "${texto}" en catálogo`;
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => crearCalleCatalogoMantenimiento(texto));
    cont.appendChild(btn);
  }
}

async function buscarCatalogoCallesMantenimiento(valor, forzar) {
  const texto = normalizarPersonaCatalogo(valor);
  clearTimeout(mantPropCallesTimer);
  if (!forzar && texto.length < 2) {
    limpiarSugerenciasCallesMantenimiento();
    return;
  }
  mantPropCallesTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({
        q: texto,
        limite: "25",
        _: String(Date.now())
      });
      const r = await fetch(`${API}/propietarios/catalogo/calles?${params.toString()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar calles."));
      renderSugerenciasCallesMantenimiento(data.calles || [], texto);
    } catch (e) {
      limpiarSugerenciasCallesMantenimiento();
    }
  }, forzar ? 0 : 220);
}

async function crearCalleCatalogoMantenimiento(nombre) {
  const calle = normalizarPersonaCatalogo(nombre || document.getElementById("mantPropCalle")?.value);
  if (!calle) {
    setMantPropMsg("Capture el nombre de la calle.", false);
    return null;
  }
  try {
    setMantPropMsg("Registrando calle en catálogo...", true);
    const r = await fetch(`${API}/propietarios/catalogo/calles`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({ nombre_calle: calle })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo crear la calle."));
    const item = data.calle || {};
    seleccionarCalleMantenimiento(item.nombre_calle || calle, item.id || 0, "catalogo");
    setMantPropMsg(data.creada ? "Calle agregada al catálogo." : "Calle ya existía en catálogo.", true);
    return item;
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
    return null;
  }
}

async function asegurarCalleEnCatalogoMantenimiento(nombre) {
  const calle = normalizarPersonaCatalogo(nombre);
  if (!calle) return true;
  const idCalle = Number(document.getElementById("mantPropIdCalle")?.value || 0);
  if (idCalle) return true;

  try {
    const params = new URLSearchParams({ q: calle, exacta: "true", limite: "5", _: String(Date.now()) });
    const r = await fetch(`${API}/propietarios/catalogo/calles?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.exacta && (data.calles || []).length) {
      const c = data.calles[0];
      document.getElementById("mantPropIdCalle").value = c.id || "";
      return true;
    }
  } catch (e) {
    /* continuar con confirmación */
  }

  if (!confirm(`La calle "${calle}" no está en el catálogo.\n\n¿Agregarla al catálogo de calles?`)) {
    return true;
  }
  const creada = await crearCalleCatalogoMantenimiento(calle);
  return !!creada;
}
window.crearCalleCatalogoMantenimiento = crearCalleCatalogoMantenimiento;
window.seleccionarCalleMantenimiento = seleccionarCalleMantenimiento;

function limpiarMarcasFusionPropietarios() {
  mantPropEstado.fusionIds = new Set();
  mantPropEstado.fusionPadronIdx = new Set();
  mantPropEstado.fusionDestinoMeta = null;
  mantPropEstado.registroPadronCache = new Map();
  document.querySelectorAll(".mant-prop-fusion-chk").forEach(chk => { chk.checked = false; });
  const chkTodos = document.getElementById("mantPropFusionTodos");
  if (chkTodos) chkTodos.checked = false;
}

function toggleFusionPropietario(idPersona, checked) {
  const id = Number(idPersona);
  if (!id) return;
  if (checked) mantPropEstado.fusionIds.add(id);
  else mantPropEstado.fusionIds.delete(id);
}
window.toggleFusionPropietario = toggleFusionPropietario;

function toggleFusionPadronPropietario(idx, checked) {
  const i = Number(idx);
  if (Number.isNaN(i)) return;
  if (checked) mantPropEstado.fusionPadronIdx.add(i);
  else mantPropEstado.fusionPadronIdx.delete(i);
}
window.toggleFusionPadronPropietario = toggleFusionPadronPropietario;

function toggleFusionTodosPropietarios(marcar) {
  const destinoIdRaw = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  const destinoId = idPersonaEnResultadosActualesMantenimiento(destinoIdRaw) ? destinoIdRaw : 0;
  const destinoIdx = idxActivoEnResultadosActualesMantenimiento();
  mantPropEstado.fusionIds = new Set();
  mantPropEstado.fusionPadronIdx = new Set();
  (mantPropEstado.resultados || []).forEach((r, idx) => {
    if (r.id_persona) {
      const id = Number(r.id_persona);
      if (marcar && id !== destinoId) mantPropEstado.fusionIds.add(id);
    } else if (marcar && idx !== destinoIdx) {
      mantPropEstado.fusionPadronIdx.add(idx);
    }
  });
  document.querySelectorAll(".mant-prop-fusion-chk").forEach(chk => {
    const id = Number(chk.dataset.id || 0);
    const idx = Number(chk.dataset.idx ?? -1);
    if (chk.dataset.padron === "1") {
      chk.checked = marcar && idx !== destinoIdx;
      return;
    }
    if (chk.disabled) return;
    chk.checked = marcar && id !== destinoId;
  });
}
window.toggleFusionTodosPropietarios = toggleFusionTodosPropietarios;

function cargarFilaMantenimientoPropietario(row, idx) {
  if (!row) return;
  mantPropEstado.indiceActivo = idx;
  document.querySelectorAll("#mantPropGridBody tr[data-idx]").forEach(r => r.classList.remove("activo"));
  const fila = document.querySelector(`#mantPropGridBody tr[data-idx="${idx}"]`);
  if (fila) fila.classList.add("activo");

  const nombreRow = row.razon_social || row.nombre_completo || "";
  const tipo = esResultadoMoral(row) || esNombrePersonaMoral(nombreRow) ? "MORAL" : "FISICA";
  document.getElementById("mantPropTipoPersona").value = tipo;
  cambiarTipoPersonaMantenimiento();

  document.getElementById("mantPropIdPersona").value = row.id_persona || "";
  document.getElementById("mantPropClavePredio").value = row.clave_catastral || "";
  document.getElementById("mantPropRFC").value = row.rfc || "";
  document.getElementById("mantPropCURP").value = row.curp || "";
  document.getElementById("mantPropCalle").value = row.calle || "";
  document.getElementById("mantPropIdCalle").value = row.id_calle || "";
  document.getElementById("mantPropNumof").value = row.numof != null ? String(row.numof) : "";
  document.getElementById("mantPropColonia").value = row.colonia || "";
  document.getElementById("mantPropCP").value = row.cp || "";
  document.getElementById("mantPropDelegacion").value = row.delegacion || "";
  document.getElementById("mantPropClaveDisplay").value = row.clave_catastral || "";

  if (tipo === "MORAL") {
    document.getElementById("mantPropRazonSocial").value = row.razon_social || row.nombre_completo || "";
    document.getElementById("mantPropApPat").value = "";
    document.getElementById("mantPropApMat").value = "";
    document.getElementById("mantPropNombre1").value = "";
    document.getElementById("mantPropNombre2").value = "";
  } else {
    const cols = columnasPersonaResultado(row);
    const div = dividirNombrePropietario(cols.nombres);
    document.getElementById("mantPropApPat").value = cols.paterno || "";
    document.getElementById("mantPropApMat").value = cols.materno || "";
    document.getElementById("mantPropNombre1").value = div.n1;
    document.getElementById("mantPropNombre2").value = div.n2;
    document.getElementById("mantPropRazonSocial").value = "";
  }
  generarNombreCompletoMantenimiento();
  const destId = Number(row.id_persona || 0);
  document.querySelectorAll("#mantPropGridBody tr.mant-prop-row-destino").forEach(r => r.classList.remove("mant-prop-row-destino"));
  document.querySelectorAll("#mantPropGridBody tr.mant-prop-row-destino-padron").forEach(r => r.classList.remove("mant-prop-row-destino-padron"));
  if (destId) {
    mantPropEstado.fusionIds.delete(destId);
    const chk = document.querySelector(`.mant-prop-fusion-chk[data-id="${destId}"]`);
    if (chk) chk.checked = false;
    if (fila) fila.classList.add("mant-prop-row-destino");
  } else if (fila && row.origen === "padron" && !row.id_persona) {
    mantPropEstado.fusionPadronIdx.delete(idx);
    const chkPad = document.querySelector(`.mant-prop-fusion-chk[data-idx="${idx}"][data-padron="1"]`);
    if (chkPad) chkPad.checked = false;
    fila.classList.add("mant-prop-row-destino-padron");
  }
  setMantPropMsg(row.origen === "padron" && !row.id_persona
    ? "Padrón — clic = destino (naranja) · ✓ = fusionar · se registrará en catálogo al fusionar."
    : "", true);
}

function renderGridMantenimientoPropietarios(resultados, meta) {
  const body = document.getElementById("mantPropGridBody");
  const contador = document.getElementById("mantPropContador");
  if (!body) return;

  if (!resultados.length) {
    body.innerHTML = `<tr><td colspan="6" class="mant-prop-empty">Sin resultados.</td></tr>`;
    if (contador) contador.textContent = "0";
    return;
  }

  const destinoIdRaw = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  const destinoId = idPersonaEnResultadosActualesMantenimiento(destinoIdRaw) ? destinoIdRaw : 0;

  body.innerHTML = resultados.map((r, idx) => {
    const nombre = nombrePersonaCatalogo(r);
    const dir = String(r.calle || "—");
    const origen = r.origen === "padron" && !r.id_persona ? "Padrón" : "Catálogo";
    const idP = r.id_persona ? Number(r.id_persona) : 0;
    const chk = idP
      ? `<input type="checkbox" class="mant-prop-fusion-chk" data-id="${idP}"
          ${mantPropEstado.fusionIds.has(idP) ? "checked" : ""}
          onclick="event.stopPropagation(); toggleFusionPropietario(${idP}, this.checked)">`
      : `<input type="checkbox" class="mant-prop-fusion-chk" data-padron="1" data-idx="${idx}"
          ${mantPropEstado.fusionPadronIdx.has(idx) ? "checked" : ""}
          title="Padrón — se registrará en catálogo al fusionar"
          onclick="event.stopPropagation(); toggleFusionPadronPropietario(${idx}, this.checked)">`;
    const esDestinoPadron = !idP && idx === mantPropEstado.indiceActivo ? " mant-prop-row-destino-padron" : "";
    const esDestino = idP && idP === destinoId ? " mant-prop-row-destino" : esDestinoPadron;
    return `
      <tr data-idx="${idx}" class="${esDestino}" tabindex="0"
        onclick="cargarFilaMantenimientoPropietario(mantPropEstado.resultados[${idx}], ${idx})"
        ondblclick="cargarFilaMantenimientoPropietario(mantPropEstado.resultados[${idx}], ${idx})"
        onkeydown="if(event.key==='Enter'){event.preventDefault();cargarFilaMantenimientoPropietario(mantPropEstado.resultados[${idx}], ${idx});}">
        <td class="mant-prop-col-chk" onclick="event.stopPropagation()">${chk}</td>
        <td>${escapeHtml(nombre)}</td>
        <td>${escapeHtml(r.colonia || "—")}</td>
        <td>${escapeHtml(dir)}</td>
        <td>${escapeHtml(r.numof != null && r.numof !== "" ? String(r.numof) : "—")}</td>
        <td>${escapeHtml(origen)}</td>
      </tr>`;
  }).join("");

  if (contador) {
    let txt = String(resultados.length);
    if (meta?.truncado) txt += "+";
    contador.textContent = txt;
  }
}

window.cargarFilaMantenimientoPropietario = cargarFilaMantenimientoPropietario;

async function buscarMantenimientoPropietarios() {
  const q = normalizarPersonaCatalogo(document.getElementById("mantPropBuscar")?.value);
  if (!q) {
    setMantPropMsg("Capture un criterio de búsqueda.", false);
    return;
  }
  if (mantPropEstado.buscando) return;
  resetDestinoTrasNuevaBusquedaMantenimiento();
  mantPropEstado.buscando = true;
  setMantPropProgress(true);
  setMantPropMsg("Buscando...", true);

  try {
    const params = new URLSearchParams({ q: q, limite: "150", _: String(Date.now()) });
    const r = await fetch(`${API}/propietarios/mantenimiento/buscar?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    const txt = await r.text();
    let data = {};
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch (e) {
      throw new Error(
        r.status >= 500
          ? "Error del servidor al buscar propietarios. Verifique que propietarios.py esté actualizado y reinicie la API."
          : (txt || "Respuesta inválida del servidor.")
      );
    }
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar propietarios."));

    mantPropEstado.resultados = data.resultados || [];
    renderGridMantenimientoPropietarios(mantPropEstado.resultados, data);
    let msg = data.truncado
      ? `Mostrando ${mantPropEstado.resultados.length} resultados. Refine la búsqueda.`
      : `${mantPropEstado.resultados.length} resultado(s).`;
    if (data.padron_ocultos_por_catalogo > 0) {
      msg += ` · ${data.padron_ocultos_por_catalogo} variante(s) de padrón oculta(s) (ya en catálogo o fusionadas).`;
    }
    setMantPropMsg(msg, true);

    if (mantPropEstado.resultados.length === 1) {
      cargarFilaMantenimientoPropietario(mantPropEstado.resultados[0], 0);
    }
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
    renderGridMantenimientoPropietarios([], {});
  } finally {
    mantPropEstado.buscando = false;
    setMantPropProgress(false);
  }
}
window.buscarMantenimientoPropietarios = buscarMantenimientoPropietarios;

function nuevoMantenimientoPropietario() {
  limpiarFormularioMantenimientoPropietario();
  setMantPropMsg("Captura datos del nuevo propietario y pulse Grabar.", true);
  document.getElementById("mantPropApPat")?.focus();
}
window.nuevoMantenimientoPropietario = nuevoMantenimientoPropietario;

function cancelarMantenimientoPropietario() {
  limpiarFormularioMantenimientoPropietario();
}
window.cancelarMantenimientoPropietario = cancelarMantenimientoPropietario;

async function grabarMantenimientoPropietario() {
  const tipo = document.getElementById("mantPropTipoPersona")?.value || "FISICA";
  const idPersona = document.getElementById("mantPropIdPersona")?.value?.trim();
  const nombreCompleto = generarNombreCompletoMantenimiento();
  const payload = {
    tipo_persona: tipo,
    apellido_paterno: normalizarPersonaCatalogo(document.getElementById("mantPropApPat")?.value) || null,
    apellido_materno: normalizarPersonaCatalogo(document.getElementById("mantPropApMat")?.value) || null,
    nombre: tipo === "FISICA"
      ? unirNombrePropietario(
        document.getElementById("mantPropNombre1")?.value,
        document.getElementById("mantPropNombre2")?.value
      ) || null
      : null,
    razon_social: tipo === "MORAL"
      ? normalizarPersonaCatalogo(document.getElementById("mantPropRazonSocial")?.value) || null
      : null,
    rfc: normalizarPersonaCatalogo(document.getElementById("mantPropRFC")?.value) || null,
    curp: normalizarPersonaCatalogo(document.getElementById("mantPropCURP")?.value) || null,
    calle: normalizarPersonaCatalogo(document.getElementById("mantPropCalle")?.value) || null,
    colonia: normalizarPersonaCatalogo(document.getElementById("mantPropColonia")?.value) || null,
    numof: normalizarPersonaCatalogo(document.getElementById("mantPropNumof")?.value) || null,
    cp: normalizarPersonaCatalogo(document.getElementById("mantPropCP")?.value) || null,
    delegacion: normalizarPersonaCatalogo(document.getElementById("mantPropDelegacion")?.value) || null,
    activo: true
  };

  if (tipo === "MORAL" && !payload.razon_social) {
    setMantPropMsg("Capture razón social.", false);
    return;
  }
  if (tipo === "FISICA" && !nombreCompleto) {
    setMantPropMsg("Capture apellidos o nombre(s).", false);
    return;
  }

  const calleCapturada = document.getElementById("mantPropCalle")?.value || "";
  if (!(await asegurarCalleEnCatalogoMantenimiento(calleCapturada))) {
    return;
  }

  try {
    setMantPropMsg("Guardando...", true);
    let r;
    if (idPersona) {
      r = await fetch(`${API}/propietarios/${encodeURIComponent(idPersona)}`, {
        method: "PUT",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      r = await fetch(`${API}/propietarios`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo guardar el propietario."));

    const persona = extraerPersonaApi(data) || data.propietario || data;
    if (persona?.id_persona) {
      document.getElementById("mantPropIdPersona").value = persona.id_persona;
    }
    setMantPropMsg(idPersona ? "Propietario actualizado correctamente." : "Propietario creado en catálogo.", true);

    const claveActiva = (document.getElementById("claveInput")?.value || "").trim().toUpperCase();
    if (claveActiva && typeof refrescarVistaPredioActivo === "function") {
      await refrescarVistaPredioActivo(claveActiva);
    }

    const q = normalizarPersonaCatalogo(document.getElementById("mantPropBuscar")?.value) || nombreCompleto;
    if (q) {
      document.getElementById("mantPropBuscar").value = q;
      await buscarMantenimientoPropietarios();
      const idx = (mantPropEstado.resultados || []).findIndex(x =>
        Number(x.id_persona) === Number(persona.id_persona) ||
        nombrePersonaCatalogo(x) === nombreCompleto
      );
      if (idx >= 0) cargarFilaMantenimientoPropietario(mantPropEstado.resultados[idx], idx);
    }
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
  }
}
window.grabarMantenimientoPropietario = grabarMantenimientoPropietario;

async function borrarMantenimientoPropietario() {
  const idPersona = Number(document.getElementById("mantPropIdPersona")?.value || 0);
  if (!idPersona) {
    setMantPropMsg("Solo se pueden borrar propietarios del catálogo (con ID). Los del padrón no tienen ficha.", false);
    return;
  }
  const nombre = document.getElementById("mantPropNombreCompleto")?.value || "";
  if (!confirm(`¿Dar de baja este propietario del catálogo?\n\n${nombre}\n\nSe cerrarán sus relaciones con predios.`)) {
    return;
  }
  try {
    setMantPropMsg("Eliminando...", true);
    const r = await fetch(`${API}/propietarios/${encodeURIComponent(idPersona)}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    const txt = await r.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (e) {
      throw new Error(r.status >= 500 ? "Error del servidor al borrar." : txt);
    }
    if (!r.ok) {
      const msg405 = mensajeErrorApiPropietarios(r.status, txt, "borrar propietarios");
      throw new Error(msg405 || extraerMensajeApi(data, "No se pudo borrar el propietario."));
    }
    limpiarFormularioMantenimientoPropietario();
    setMantPropMsg(data.mensaje || "Propietario dado de baja.", true);
    await buscarMantenimientoPropietarios();
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
  }
}
window.borrarMantenimientoPropietario = borrarMantenimientoPropietario;

async function fusionarPropietariosMantenimiento() {
  const totalMarcados = mantPropEstado.fusionIds.size + mantPropEstado.fusionPadronIdx.size;
  const tieneFilaActiva = mantPropEstado.indiceActivo >= 0;

  if (totalMarcados < 1 && !tieneFilaActiva) {
    const msg = "Marque con ✓ las variantes a fusionar (catálogo o padrón) y haga clic en el titular destino.";
    setMantPropMsg(msg, false);
    alert(msg);
    return;
  }

  try {
    setMantPropMsg("Preparando fusión...", true);
    mantPropEstado.registroPadronCache = new Map();
    mantPropEstado.fusionDestinoMeta = null;
    let destinoId = await resolverDestinoFusionMantenimiento();
    if (!destinoId) {
      if (totalMarcados + (tieneFilaActiva ? 1 : 0) < 2) {
        const msg = "Seleccione al menos 2 variantes (✓) o elija titular destino + duplicados marcados.";
        setMantPropMsg(msg, false);
        alert(msg);
      }
      return;
    }

    const origenes = await resolverOrigenesFusionMantenimiento(destinoId);
    if (!origenes.length) {
      const msg = "Marque con ✓ los duplicados (no marque el titular destino: amarillo o naranja).";
      setMantPropMsg(msg, false);
      alert(msg);
      return;
    }

    const nombreDest = nombreDestinoFusionMantenimiento(destinoId);
    if (!nombreDest) {
      setMantPropMsg("No se identificó el titular destino. Verifique que sea persona moral (S.A. de C.V.) si aplica.", false);
      return;
    }
    const nombresOrigen = origenes.map(id => nombreOrigenFusionMantenimiento(id)).join("\n• ");
    if (!confirm(
      `¿Fusionar ${origenes.length} propietario(s) en?\n\n${nombreDest}\n\nOrígenes:\n• ${nombresOrigen}\n\nLos duplicados quedarán dados de baja y sus predios pasarán al titular destino.`
    )) {
      return;
    }

    setMantPropMsg("Fusionando...", true);
    const r = await fetch(`${API}/propietarios/fusionar`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        id_persona_destino: destinoId,
        id_personas_origen: origenes
      })
    });
    const txt = await r.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (e) {
      throw new Error(r.status >= 500 ? "Error del servidor al fusionar." : txt);
    }
    if (!r.ok) {
      const msg405 = mensajeErrorApiPropietarios(r.status, txt, "fusionar propietarios");
      throw new Error(msg405 || extraerMensajeApi(data, "No se pudo fusionar propietarios."));
    }
    limpiarMarcasFusionPropietarios();
    const padronAct = Number(data.padron_actualizados || 0);
    setMantPropMsg(
      `Fusión completada: ${data.personas_desactivadas || origenes.length} dado(s) de baja, ` +
      `${data.relaciones_movidas || 0} predio(s) reasignados, ${data.relaciones_unidas || 0} unificados` +
      (padronAct ? `, ${padronAct} registro(s) del padrón actualizados.` : "."),
      true
    );
    await buscarMantenimientoPropietarios();
    const idx = (mantPropEstado.resultados || []).findIndex(x => Number(x.id_persona) === destinoId);
    if (idx >= 0) cargarFilaMantenimientoPropietario(mantPropEstado.resultados[idx], idx);
    const claveActiva = (document.getElementById("claveInput")?.value || "").trim().toUpperCase();
    if (claveActiva && typeof refrescarVistaPredioActivo === "function") {
      await refrescarVistaPredioActivo(claveActiva);
    }
  } catch (e) {
    setMantPropMsg(e.message || String(e), false);
  }
}
window.fusionarPropietariosMantenimiento = fusionarPropietariosMantenimiento;

function configurarEntradasMantenimientoPropietarios() {
  const modal = document.getElementById("modalMantenimientoPropietarios");
  if (!modal || modal.dataset.bind === "1") return;
  modal.dataset.bind = "1";

  ["mantPropApPat", "mantPropApMat", "mantPropNombre1", "mantPropNombre2", "mantPropRazonSocial"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      el.value = normalizarTextoPersonaInput(el.value);
      generarNombreCompletoMantenimiento();
    });
    el.addEventListener("blur", () => {
      el.value = normalizarPersonaCatalogo(el.value);
      generarNombreCompletoMantenimiento();
    });
  });

  ["mantPropRFC", "mantPropCURP"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => { el.value = normalizarPersonaCatalogo(el.value); });
  });

  ["mantPropCalle", "mantPropNumof", "mantPropColonia", "mantPropCP", "mantPropDelegacion"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => { el.value = normalizarPersonaCatalogo(el.value); });
  });

  const calleEl = document.getElementById("mantPropCalle");
  if (calleEl) {
    calleEl.addEventListener("input", () => {
      document.getElementById("mantPropIdCalle").value = "";
      buscarCatalogoCallesMantenimiento(calleEl.value);
    });
    calleEl.addEventListener("focus", () => {
      buscarCatalogoCallesMantenimiento(calleEl.value, !normalizarPersonaCatalogo(calleEl.value));
    });
    calleEl.addEventListener("blur", () => {
      setTimeout(limpiarSugerenciasCallesMantenimiento, 180);
    });
  }
}

function abrirMantenimientoPropietarios() {
  const modal = document.getElementById("modalMantenimientoPropietarios");
  if (!modal) return;
  configurarEntradasMantenimientoPropietarios();
  limpiarFormularioMantenimientoPropietario();
  mantPropEstado.resultados = [];
  limpiarMarcasFusionPropietarios();
  renderGridMantenimientoPropietarios([], {});
  document.getElementById("mantPropBuscar").value = "";
  document.getElementById("mantPropContador").textContent = "0";
  modal.classList.remove("oculto");
  verificarApiMantenimientoPropietarios();
  setTimeout(() => document.getElementById("mantPropBuscar")?.focus(), 120);
}
window.abrirMantenimientoPropietarios = abrirMantenimientoPropietarios;

function cerrarMantenimientoPropietarios() {
  const modal = document.getElementById("modalMantenimientoPropietarios");
  if (modal) modal.classList.add("oculto");
}
window.cerrarMantenimientoPropietarios = cerrarMantenimientoPropietarios;

// --- v89 Mantenimiento catálogos: calles y colonias ---

const MANT_CAT_CFG = {
  calles: {
    modalId: "modalMantenimientoCalles",
    prefix: "mantCalle",
    apiBase: "catalogos/calles",
    campoNombre: "nombre_calle",
    labelCap: "Calle",
    respKey: "calle"
  },
  colonias: {
    modalId: "modalMantenimientoColonias",
    prefix: "mantCol",
    apiBase: "catalogos/colonias",
    campoNombre: "nombre_colonia",
    labelCap: "Colonia",
    respKey: "colonia"
  }
};

function crearEstadoCatalogoMantenimiento() {
  return {
    resultados: [],
    indiceActivo: -1,
    fusionIds: new Set(),
    fusionPadronIdx: new Set(),
    fusionDestinoMeta: null,
    registroPadronCache: new Map()
  };
}

const mantCatEstado = {
  calles: crearEstadoCatalogoMantenimiento(),
  colonias: crearEstadoCatalogoMantenimiento()
};

function cfgMantCat(tipo) {
  return MANT_CAT_CFG[tipo] || MANT_CAT_CFG.calles;
}

function elMantCat(tipo, suf) {
  const cfg = cfgMantCat(tipo);
  return document.getElementById(`${cfg.prefix}${suf}`);
}

function estadoMantCat(tipo) {
  return mantCatEstado[tipo] || mantCatEstado.calles;
}

function nombreCatalogoRow(row, tipo) {
  const cfg = cfgMantCat(tipo);
  return normalizarPersonaCatalogo(row?.[cfg.campoNombre] || "");
}

function setMantCatMsg(tipo, msg, ok) {
  const el = elMantCat(tipo, "Msg");
  if (el) {
    el.textContent = msg || "";
    el.classList.toggle("ok", !!ok);
    el.classList.toggle("err", !ok && !!msg);
  }
  const tb = elMantCat(tipo, "ToolbarMsg");
  if (tb && msg) {
    tb.textContent = msg;
    tb.classList.toggle("ok", !!ok);
    tb.classList.toggle("err", !ok);
  }
}

function setMantCatProgress(tipo, visible) {
  const el = elMantCat(tipo, "Progress");
  if (el) el.classList.toggle("oculto", !visible);
}

function limpiarMarcasFusionCatalogo(tipo) {
  const st = estadoMantCat(tipo);
  st.fusionIds = new Set();
  st.fusionPadronIdx = new Set();
  st.fusionDestinoMeta = null;
  st.registroPadronCache = new Map();
  const chk = elMantCat(tipo, "FusionTodos");
  if (chk) chk.checked = false;
}

function limpiarFormularioCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  elMantCat(tipo, "Id").value = "";
  elMantCat(tipo, "Nombre").value = "";
  estadoMantCat(tipo).indiceActivo = -1;
  document.querySelectorAll(`#${cfg.prefix}GridBody tr[data-idx]`).forEach(r => {
    r.classList.remove("activo", "mant-prop-row-destino", "mant-prop-row-destino-padron");
  });
  setMantCatMsg(tipo, "", true);
}

async function buscarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const q = normalizarPersonaCatalogo(elMantCat(tipo, "Buscar")?.value);
  if (!q) {
    setMantCatMsg(tipo, "Capture un criterio de búsqueda.", false);
    return;
  }
  setMantCatProgress(tipo, true);
  setMantCatMsg(tipo, "Buscando...", true);
  try {
    const params = new URLSearchParams({ q, limite: "150" });
    const r = await fetch(`${API}/${cfg.apiBase}/mantenimiento/buscar?${params}`, {
      headers: authJsonHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar en catálogo."));
    st.resultados = data.resultados || [];
    limpiarMarcasFusionCatalogo(tipo);
    limpiarFormularioCatalogoMantenimiento(tipo);
    renderGridCatalogoMantenimiento(tipo);
    elMantCat(tipo, "Contador").textContent = String(st.resultados.length);
    setMantCatMsg(tipo, `${st.resultados.length} resultado(s).`, true);
    if (st.resultados.length) cargarFilaCatalogoMantenimiento(tipo, st.resultados[0], 0);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  } finally {
    setMantCatProgress(tipo, false);
  }
}

function renderGridCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const tbody = elMantCat(tipo, "GridBody");
  if (!tbody) return;
  const rows = st.resultados || [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="mant-prop-empty">Sin resultados.</td></tr>`;
    return;
  }
  const destId = Number(elMantCat(tipo, "Id")?.value || 0);
  tbody.innerHTML = rows.map((row, idx) => {
    const id = Number(row.id || 0);
    const nombre = escapeHtml(nombreCatalogoRow(row, tipo));
    const origen = row.origen === "padron" ? "Padrón" : "Catálogo";
    const esDestino = (id && id === destId) || (!id && st.indiceActivo === idx);
    const clsDest = row.origen === "padron"
      ? "mant-prop-row-destino-padron"
      : "mant-prop-row-destino";
    const clsAct = st.indiceActivo === idx ? " activo" : "";
    const clsDestino = esDestino ? ` ${clsDest}` : "";
    const chk = id
      ? `<input type="checkbox" class="mant-prop-fusion-chk" data-id="${id}" ${st.fusionIds.has(id) ? "checked" : ""} onchange="toggleFusionCatalogoMantenimiento('${tipo}', ${idx}, this.checked)">`
      : `<input type="checkbox" class="mant-prop-fusion-chk" data-idx="${idx}" ${st.fusionPadronIdx.has(idx) ? "checked" : ""} onchange="toggleFusionCatalogoMantenimiento('${tipo}', ${idx}, this.checked)">`;
    return `<tr data-idx="${idx}" class="${clsDestino}${clsAct}"
      onclick="cargarFilaCatalogoMantenimiento('${tipo}', mantCatEstado.${tipo}.resultados[${idx}], ${idx})"
      ondblclick="cargarFilaCatalogoMantenimiento('${tipo}', mantCatEstado.${tipo}.resultados[${idx}], ${idx})"
      onkeydown="if(event.key==='Enter'){event.preventDefault();cargarFilaCatalogoMantenimiento('${tipo}', mantCatEstado.${tipo}.resultados[${idx}], ${idx});}">
      <td class="mant-prop-col-chk" onclick="event.stopPropagation()">${chk}</td>
      <td>${nombre}</td>
      <td>${Number(row.predios_padron || 0)}</td>
      <td>${Number(row.personas_catalogo || 0)}</td>
      <td>${origen}</td>
    </tr>`;
  }).join("");
}

function cargarFilaCatalogoMantenimiento(tipo, row, idx) {
  if (!row) return;
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  st.indiceActivo = idx;
  document.querySelectorAll(`#${cfg.prefix}GridBody tr[data-idx]`).forEach(r => r.classList.remove("activo"));
  const fila = document.querySelector(`#${cfg.prefix}GridBody tr[data-idx="${idx}"]`);
  if (fila) fila.classList.add("activo");

  elMantCat(tipo, "Id").value = row.id || "";
  elMantCat(tipo, "Nombre").value = nombreCatalogoRow(row, tipo);

  document.querySelectorAll(`#${cfg.prefix}GridBody tr.mant-prop-row-destino, #${cfg.prefix}GridBody tr.mant-prop-row-destino-padron`).forEach(r => {
    r.classList.remove("mant-prop-row-destino", "mant-prop-row-destino-padron");
  });
  if (fila) {
    fila.classList.add(row.origen === "padron" ? "mant-prop-row-destino-padron" : "mant-prop-row-destino");
  }
}

function toggleFusionCatalogoMantenimiento(tipo, idx, marcado) {
  const st = estadoMantCat(tipo);
  const row = st.resultados[idx];
  if (!row) return;
  const id = Number(row.id || 0);
  if (id) {
    if (marcado) st.fusionIds.add(id);
    else st.fusionIds.delete(id);
  } else {
    if (marcado) st.fusionPadronIdx.add(idx);
    else st.fusionPadronIdx.delete(idx);
  }
}

function toggleFusionTodosCatalogoMantenimiento(tipo, marcar) {
  const st = estadoMantCat(tipo);
  const destinoId = Number(elMantCat(tipo, "Id")?.value || 0);
  (st.resultados || []).forEach((row, idx) => {
    const id = Number(row.id || 0);
    if (id) {
      if (marcar && id !== destinoId) st.fusionIds.add(id);
      else if (!marcar) st.fusionIds.delete(id);
    } else {
      if (marcar) st.fusionPadronIdx.add(idx);
      else st.fusionPadronIdx.delete(idx);
    }
  });
  renderGridCatalogoMantenimiento(tipo);
}

function itemsMarcadosFusionCatalogo(tipo) {
  const st = estadoMantCat(tipo);
  const items = [];
  (st.resultados || []).forEach((row, idx) => {
    const id = Number(row.id || 0);
    const nombre = nombreCatalogoRow(row, tipo);
    if (id && st.fusionIds.has(id)) items.push({ kind: "catalogo", id, idx, nombre, row });
    else if (!id && st.fusionPadronIdx.has(idx)) items.push({ kind: "padron", id: 0, idx, nombre, row });
  });
  return items;
}

async function registrarCatalogoDesdeRow(tipo, row, idx) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const idxKey = idx != null ? Number(idx) : -1;
  if (idxKey >= 0 && st.registroPadronCache.has(idxKey)) {
    return st.registroPadronCache.get(idxKey);
  }
  if (row?.id) {
    const id = Number(row.id);
    if (idxKey >= 0) st.registroPadronCache.set(idxKey, id);
    return id;
  }
  const nombre = nombreCatalogoRow(row, tipo);
  if (!nombre) return 0;
  const payload = { [cfg.campoNombre]: nombre };
  const r = await fetch(`${API}/${cfg.apiBase}`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo registrar en catálogo."));
  const reg = data[cfg.resKey] || data;
  const id = Number(reg?.id || 0);
  if (id && idxKey >= 0) st.registroPadronCache.set(idxKey, id);
  return id;
}

function fijarDestinoFusionCatalogo(tipo, id, nombre) {
  estadoMantCat(tipo).fusionDestinoMeta = {
    id: Number(id),
    nombre: normalizarPersonaCatalogo(nombre) || ""
  };
  return Number(id);
}

function nombreDestinoFusionCatalogo(tipo, destinoId) {
  const st = estadoMantCat(tipo);
  const meta = st.fusionDestinoMeta;
  if (meta && Number(meta.id) === Number(destinoId) && meta.nombre) return meta.nombre;
  const row = (st.resultados || []).find(x => Number(x.id) === Number(destinoId));
  if (row) return nombreCatalogoRow(row, tipo);
  for (const [idx, id] of st.registroPadronCache.entries()) {
    if (Number(id) === Number(destinoId)) {
      const r = st.resultados[idx];
      if (r) return nombreCatalogoRow(r, tipo);
    }
  }
  return "";
}

async function elegirDestinoFusionCatalogo(tipo, items) {
  const cfg = cfgMantCat(tipo);
  if ((items || []).length < 2) return 0;
  const lineas = items.map((it, i) => {
    const suf = it.kind === "padron" ? " [padrón]" : "";
    return `${i + 1}. ${it.nombre}${suf}`;
  });
  const resp = prompt(
    `¿Cuál ${cfg.labelCap.toLowerCase()} se CONSERVARÁ?\n` +
    "Los demás marcados se fusionarán en él.\n" +
    "(Los del padrón se registrarán en catálogo automáticamente.)\n\n" +
    lineas.join("\n") +
    `\n\nEscriba el número (1-${items.length}):`,
    "1"
  );
  if (resp === null) return 0;
  const n = parseInt(String(resp).trim(), 10);
  if (!n || n < 1 || n > items.length) {
    alert("Selección inválida. Indique un número de la lista.");
    return 0;
  }
  const sel = items[n - 1];
  if (sel.kind === "catalogo") return fijarDestinoFusionCatalogo(tipo, sel.id, sel.nombre);
  const id = await registrarCatalogoDesdeRow(tipo, sel.row, sel.idx);
  if (!id) return 0;
  return fijarDestinoFusionCatalogo(tipo, id, sel.nombre);
}

async function resolverDestinoFusionCatalogo(tipo) {
  const st = estadoMantCat(tipo);
  st.fusionDestinoMeta = null;
  const items = itemsMarcadosFusionCatalogo(tipo);
  const idx = st.indiceActivo;
  let destinoId = Number(elMantCat(tipo, "Id")?.value || 0);

  if (idx >= 0 && idx < (st.resultados || []).length) {
    const row = st.resultados[idx];
    if (row?.id) return fijarDestinoFusionCatalogo(tipo, row.id, nombreCatalogoRow(row, tipo));
    if (row?.origen === "padron") {
      setMantCatMsg(tipo, "Registrando destino del padrón en catálogo...", true);
      const id = await registrarCatalogoDesdeRow(tipo, row, idx);
      if (!id) return 0;
      return fijarDestinoFusionCatalogo(tipo, id, nombreCatalogoRow(row, tipo));
    }
  }

  if (destinoId) {
    const row = (st.resultados || []).find(x => Number(x.id) === destinoId);
    return fijarDestinoFusionCatalogo(tipo, destinoId, row ? nombreCatalogoRow(row, tipo) : "");
  }

  if (items.length >= 2) {
    setMantCatMsg(tipo, "Seleccione titular destino...", true);
    return elegirDestinoFusionCatalogo(tipo, items);
  }
  return 0;
}

async function resolverOrigenesFusionCatalogo(tipo, destinoId) {
  const st = estadoMantCat(tipo);
  const origenes = [...st.fusionIds].map(Number).filter(id => id && id !== destinoId);
  for (const idx of st.fusionPadronIdx) {
    const row = st.resultados[idx];
    if (!row) continue;
    let id = Number(row.id || 0);
    if (!id) id = await registrarCatalogoDesdeRow(tipo, row, idx);
    if (id && id !== destinoId && !origenes.includes(id)) origenes.push(id);
  }
  return origenes;
}

async function fusionarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const st = estadoMantCat(tipo);
  const totalMarcados = st.fusionIds.size + st.fusionPadronIdx.size;
  if (totalMarcados < 1) {
    const msg = "Marque al menos un duplicado con ✓ y seleccione el destino (clic en fila).";
    setMantCatMsg(tipo, msg, false);
    alert(msg);
    return;
  }
  try {
    setMantCatMsg(tipo, "Preparando fusión...", true);
    st.registroPadronCache = new Map();
    st.fusionDestinoMeta = null;
    const destinoId = await resolverDestinoFusionCatalogo(tipo);
    if (!destinoId) return;

    const origenes = await resolverOrigenesFusionCatalogo(tipo, destinoId);
    if (!origenes.length) {
      const msg = "Marque con ✓ los duplicados (no marque el registro destino).";
      setMantCatMsg(tipo, msg, false);
      alert(msg);
      return;
    }

    const nombreDest = nombreDestinoFusionCatalogo(tipo, destinoId);
    if (!nombreDest) {
      setMantCatMsg(tipo, "No se identificó el registro destino.", false);
      return;
    }

    const nombresOrigen = origenes.map(id => {
      const row = (st.resultados || []).find(x => Number(x.id) === Number(id));
      if (row) return nombreCatalogoRow(row, tipo);
      for (const [idx, cachedId] of st.registroPadronCache.entries()) {
        if (Number(cachedId) === Number(id) && st.resultados[idx]) {
          return nombreCatalogoRow(st.resultados[idx], tipo);
        }
      }
      return "ID " + id;
    }).join("\n• ");

    if (!confirm(
      `¿Fusionar ${origenes.length} registro(s) en?\n\n${nombreDest}\n\nOrígenes:\n• ${nombresOrigen}\n\nSe actualizarán predios del padrón y personas del catálogo.`
    )) return;

    setMantCatMsg(tipo, "Fusionando...", true);
    const r = await fetch(`${API}/${cfg.apiBase}/fusionar`, {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({ id_destino: destinoId, ids_origen: origenes })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo fusionar."));
    limpiarMarcasFusionCatalogo(tipo);
    setMantCatMsg(
      tipo,
      `Fusión completada: ${data.registros_desactivados || origenes.length} dado(s) de baja, ` +
      `${data.padron_actualizados || 0} predio(s) y ${data.personas_actualizadas || 0} persona(s) actualizados.`,
      true
    );
    await buscarCatalogoMantenimiento(tipo);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  }
}
window.fusionarCatalogoMantenimiento = fusionarCatalogoMantenimiento;

async function grabarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const nombre = normalizarPersonaCatalogo(elMantCat(tipo, "Nombre")?.value);
  if (!nombre) {
    setMantCatMsg(tipo, `Capture el nombre de la ${cfg.labelCap.toLowerCase()}.`, false);
    return;
  }
  const id = Number(elMantCat(tipo, "Id")?.value || 0);
  const payload = { [cfg.campoNombre]: nombre };
  try {
    setMantCatMsg(tipo, "Guardando...", true);
    let r;
    if (id) {
      r = await fetch(`${API}/${cfg.apiBase}/${id}`, {
        method: "PUT",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    } else {
      r = await fetch(`${API}/${cfg.apiBase}`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(payload)
      });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo guardar."));
    const reg = data[cfg.resKey] || data;
    const nuevoId = Number(reg?.id || id);
    if (nuevoId) elMantCat(tipo, "Id").value = String(nuevoId);
    const extra = id && (data.padron_actualizados || data.personas_actualizadas)
      ? ` · Padrón: ${data.padron_actualizados || 0}, personas: ${data.personas_actualizadas || 0}`
      : "";
    setMantCatMsg(tipo, (id ? "Actualizado" : "Registrado") + " correctamente." + extra, true);
    await buscarCatalogoMantenimiento(tipo);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  }
}
window.grabarCatalogoMantenimiento = grabarCatalogoMantenimiento;

async function borrarCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const id = Number(elMantCat(tipo, "Id")?.value || 0);
  if (!id) {
    setMantCatMsg(tipo, "Seleccione un registro del catálogo para dar de baja.", false);
    return;
  }
  const nombre = normalizarPersonaCatalogo(elMantCat(tipo, "Nombre")?.value);
  if (!confirm(`¿Dar de baja la ${cfg.labelCap.toLowerCase()}?\n\n${nombre}\n\nNo se borran predios del padrón.`)) return;
  try {
    const r = await fetch(`${API}/${cfg.apiBase}/${id}`, {
      method: "DELETE",
      headers: authJsonHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo dar de baja."));
    setMantCatMsg(tipo, "Registro dado de baja.", true);
    limpiarFormularioCatalogoMantenimiento(tipo);
    await buscarCatalogoMantenimiento(tipo);
  } catch (e) {
    setMantCatMsg(tipo, e.message || String(e), false);
  }
}
window.borrarCatalogoMantenimiento = borrarCatalogoMantenimiento;

function nuevoCatalogoMantenimiento(tipo) {
  limpiarFormularioCatalogoMantenimiento(tipo);
  elMantCat(tipo, "Nombre")?.focus();
}
window.nuevoCatalogoMantenimiento = nuevoCatalogoMantenimiento;

function cancelarCatalogoMantenimiento(tipo) {
  const st = estadoMantCat(tipo);
  const idx = st.indiceActivo;
  if (idx >= 0 && st.resultados[idx]) cargarFilaCatalogoMantenimiento(tipo, st.resultados[idx], idx);
  else limpiarFormularioCatalogoMantenimiento(tipo);
}
window.cancelarCatalogoMantenimiento = cancelarCatalogoMantenimiento;

function abrirCatalogoMantenimiento(tipo) {
  const cfg = cfgMantCat(tipo);
  const modal = document.getElementById(cfg.modalId);
  if (!modal) return;
  Object.assign(estadoMantCat(tipo), crearEstadoCatalogoMantenimiento());
  limpiarFormularioCatalogoMantenimiento(tipo);
  renderGridCatalogoMantenimiento(tipo);
  elMantCat(tipo, "Buscar").value = "";
  elMantCat(tipo, "Contador").textContent = "0";
  modal.classList.remove("oculto");
  setTimeout(() => elMantCat(tipo, "Buscar")?.focus(), 120);
}

function cerrarCatalogoMantenimiento(tipo) {
  const modal = document.getElementById(cfgMantCat(tipo).modalId);
  if (modal) modal.classList.add("oculto");
}

function abrirMantenimientoCalles() { abrirCatalogoMantenimiento("calles"); }
function cerrarMantenimientoCalles() { cerrarCatalogoMantenimiento("calles"); }
function buscarMantenimientoCalles() { return buscarCatalogoMantenimiento("calles"); }
window.abrirMantenimientoCalles = abrirMantenimientoCalles;
window.cerrarMantenimientoCalles = cerrarMantenimientoCalles;
window.buscarMantenimientoCalles = buscarMantenimientoCalles;
window.cargarFilaCatalogoMantenimiento = cargarFilaCatalogoMantenimiento;
window.toggleFusionCatalogoMantenimiento = toggleFusionCatalogoMantenimiento;
window.toggleFusionTodosCatalogoMantenimiento = toggleFusionTodosCatalogoMantenimiento;

function abrirMantenimientoColonias() { abrirCatalogoMantenimiento("colonias"); }
function cerrarMantenimientoColonias() { cerrarCatalogoMantenimiento("colonias"); }
function buscarMantenimientoColonias() { return buscarCatalogoMantenimiento("colonias"); }
window.abrirMantenimientoColonias = abrirMantenimientoColonias;
window.cerrarMantenimientoColonias = cerrarMantenimientoColonias;
window.buscarMantenimientoColonias = buscarMantenimientoColonias;
window.mantCatEstado = mantCatEstado;

/* --- Importación de adeudos fiscales (Adeudo2026.xlsx) --- */

const MANT_ADEUdos_BATCH = 5000;
let _mantAdeudosFilas = [];
let _mantAdeudosParseErrores = [];

function normalizarKeysImportAdeudo(raw) {
  const out = {};
  Object.keys(raw || {}).forEach(function(k) {
    out[String(k).trim().toUpperCase().replace(/\s+/g, "_")] = raw[k];
  });
  return out;
}

function esPagoSiImportAdeudo(valor) {
  const t = String(valor || "").trim().toUpperCase();
  return t === "SI" || t === "SÍ" || t === "S" || t === "1" || t === "TRUE" || t === "PAGADO" || t === "PAGO" || t === "YES" || t === "Y";
}

function filasDesdeRawAdeudos(rawRows) {
  const map = new Map();
  const errores = [];
  (rawRows || []).forEach(function(raw, idx) {
    const r = normalizarKeysImportAdeudo(raw);
    const clave = String(r.CLAVECATASTRAL || r.CLAVE_CATASTRAL || r.CLAVE || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!clave) return;
    const pago = r.PAGO != null ? String(r.PAGO).trim() : "";
    let adeudoRaw = r.ADEUDO;
    if (adeudoRaw == null || adeudoRaw === "") adeudoRaw = 0;
    const adeudo = parseFloat(String(adeudoRaw).replace(/[$,\s]/g, ""));
    if (isNaN(adeudo)) {
      errores.push("Fila " + (idx + 2) + ": adeudo inválido (" + clave + ")");
      return;
    }
    map.set(clave, { clave_catastral: clave, adeudo: adeudo, pago: pago });
  });
  return { filas: Array.from(map.values()), errores: errores };
}

function parsearArchivoAdeudosMantenimiento(file) {
  return new Promise(function(resolve, reject) {
    if (typeof XLSX === "undefined") {
      reject(new Error("Biblioteca Excel no disponible."));
      return;
    }
    const nombre = (file.name || "").toLowerCase();
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) {
          const texto = String(ev.target.result || "");
          const wb = XLSX.read(texto, { type: "string", raw: false });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          if (!sheet) {
            reject(new Error("El archivo no contiene hojas de datos."));
            return;
          }
          resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
          return;
        }
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array", raw: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          reject(new Error("El archivo no contiene hojas de datos."));
          return;
        }
        resolve(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = function() { reject(new Error("No se pudo leer el archivo.")); };
    if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) reader.readAsText(file, "UTF-8");
    else reader.readAsArrayBuffer(file);
  });
}

function setMantAdeudosMsg(texto, ok) {
  const msg = document.getElementById("mantAdeudosMsg");
  if (!msg) return;
  msg.textContent = texto || "";
  msg.className = "mant-prop-msg" + (ok === true ? " ok" : ok === false ? " error" : "");
}

function renderResumenAdeudosMantenimiento(filas, erroresParse) {
  const el = document.getElementById("mantAdeudosResumen");
  if (!el) return;
  if (!filas.length) {
    el.innerHTML = "";
    return;
  }
  let conPago = 0;
  let sinPago = 0;
  let montoSinPago = 0;
  filas.forEach(function(f) {
    if (esPagoSiImportAdeudo(f.pago)) conPago += 1;
    else {
      sinPago += 1;
      montoSinPago += Number(f.adeudo || 0);
    }
  });
  const fmt = typeof formatoMoneda === "function" ? formatoMoneda : function(v) { return v; };
  el.innerHTML =
    "<div class=\"mant-adeudos-kpi\">" +
    "<span><b>" + filas.length.toLocaleString("es-MX") + "</b> claves únicas</span>" +
    "<span><b>" + conPago.toLocaleString("es-MX") + "</b> con PAGO = SI (sin adeudo)</span>" +
    "<span><b>" + sinPago.toLocaleString("es-MX") + "</b> con PAGO = NO</span>" +
    "<span>Total adeudo reportado: <b>" + fmt(montoSinPago) + "</b></span>" +
    (erroresParse.length ? "<span class=\"mant-adeudos-warn\">" + erroresParse.length + " fila(s) omitida(s) por error</span>" : "") +
    "</div>";
}

function renderPreviewAdeudosMantenimiento(filas) {
  const el = document.getElementById("mantAdeudosPreview");
  if (!el) return;
  if (!filas.length) {
    el.innerHTML = "";
    return;
  }
  const muestra = filas.slice(0, 12);
  const fmt = typeof formatoMoneda === "function" ? formatoMoneda : function(v) { return v; };
  let html = "<table class=\"mant-adeudos-preview-table\"><thead><tr>" +
    "<th>Clave</th><th>Adeudo archivo</th><th>Pago</th><th>→ adeudo_2026</th><th>→ adeudo_total</th>" +
    "</tr></thead><tbody>";
  muestra.forEach(function(f) {
    const pagado = esPagoSiImportAdeudo(f.pago);
    const dest = pagado ? 0 : Number(f.adeudo || 0);
    html += "<tr>" +
      "<td>" + f.clave_catastral + "</td>" +
      "<td>" + fmt(f.adeudo) + "</td>" +
      "<td>" + (f.pago || "—") + "</td>" +
      "<td>" + fmt(dest) + "</td>" +
      "<td>" + fmt(dest) + "</td>" +
      "</tr>";
  });
  html += "</tbody></table>";
  if (filas.length > muestra.length) {
    html += "<div class=\"mant-adeudos-preview-more\">Mostrando " + muestra.length + " de " + filas.length.toLocaleString("es-MX") + " filas.</div>";
  }
  el.innerHTML = html;
}

function abrirMantenimientoAdeudos() {
  if (typeof puedeEditarCatastro === "function" && !puedeEditarCatastro()) {
    alert("No tiene permisos para importar adeudos.");
    return;
  }
  const modal = document.getElementById("modalMantenimientoAdeudos");
  if (!modal) return;
  _mantAdeudosFilas = [];
  _mantAdeudosParseErrores = [];
  const fileInput = document.getElementById("mantAdeudosFile");
  if (fileInput) fileInput.value = "";
  const resumen = document.getElementById("mantAdeudosResumen");
  const preview = document.getElementById("mantAdeudosPreview");
  if (resumen) resumen.innerHTML = "";
  if (preview) preview.innerHTML = "";
  setMantAdeudosMsg("", null);
  const prog = document.getElementById("mantAdeudosProgress");
  if (prog) prog.classList.add("oculto");
  modal.classList.remove("oculto");
}
window.abrirMantenimientoAdeudos = abrirMantenimientoAdeudos;

function cerrarMantenimientoAdeudos() {
  const modal = document.getElementById("modalMantenimientoAdeudos");
  if (modal) modal.classList.add("oculto");
}
window.cerrarMantenimientoAdeudos = cerrarMantenimientoAdeudos;

async function vistaPreviaAdeudosMantenimiento() {
  const file = document.getElementById("mantAdeudosFile")?.files?.[0];
  if (!file) {
    alert("Seleccione un archivo Excel o CSV.");
    return;
  }
  setMantAdeudosMsg("Leyendo archivo...", null);
  try {
    const rawRows = await parsearArchivoAdeudosMantenimiento(file);
    const parsed = filasDesdeRawAdeudos(rawRows);
    _mantAdeudosFilas = parsed.filas;
    _mantAdeudosParseErrores = parsed.errores;
    if (!_mantAdeudosFilas.length) {
      throw new Error("No se encontraron filas válidas. Verifique columnas CLAVECATASTRAL, ADEUDO y PAGO.");
    }
    renderResumenAdeudosMantenimiento(_mantAdeudosFilas, _mantAdeudosParseErrores);
    renderPreviewAdeudosMantenimiento(_mantAdeudosFilas);
    setMantAdeudosMsg("Vista previa lista. Revise el resumen antes de importar.", true);
  } catch (e) {
    _mantAdeudosFilas = [];
    _mantAdeudosParseErrores = [];
    renderResumenAdeudosMantenimiento([], []);
    renderPreviewAdeudosMantenimiento([]);
    setMantAdeudosMsg(e.message || String(e), false);
  }
}
window.vistaPreviaAdeudosMantenimiento = vistaPreviaAdeudosMantenimiento;

async function descargarPlantillaAdeudosMantenimiento() {
  try {
    const r = await fetch(`${API}/padron/mantenimiento/adeudos/plantilla.csv?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) {
      const data = await r.json().catch(function() { return {}; });
      throw new Error(data.detail || data.message || "No se pudo descargar la plantilla");
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_adeudos_2026.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message || String(e));
  }
}
window.descargarPlantillaAdeudosMantenimiento = descargarPlantillaAdeudosMantenimiento;

function actualizarProgresoAdeudosMantenimiento(actual, total) {
  const wrap = document.getElementById("mantAdeudosProgress");
  const bar = document.getElementById("mantAdeudosProgressBar");
  if (!wrap || !bar) return;
  wrap.classList.remove("oculto");
  const pct = total > 0 ? Math.min(100, Math.round((actual / total) * 100)) : 0;
  bar.style.width = pct + "%";
  bar.textContent = pct + "%";
}

async function importarAdeudosMantenimiento() {
  if (typeof puedeEditarCatastro === "function" && !puedeEditarCatastro()) {
    alert("No tiene permisos para importar adeudos.");
    return;
  }
  if (!_mantAdeudosFilas.length) {
    await vistaPreviaAdeudosMantenimiento();
    if (!_mantAdeudosFilas.length) return;
  }
  const total = _mantAdeudosFilas.length;
  const lotes = Math.ceil(total / MANT_ADEUdos_BATCH);
  const confirmMsg =
    "¿Importar adeudos de " + total.toLocaleString("es-MX") + " predios al padrón 2026?\n\n" +
    "Se actualizarán adeudo_2026 y adeudo_total según PAGO (SI → 0, NO → monto ADEUDO).\n" +
    "El proceso se enviará en " + lotes + " lote(s).";
  if (!confirm(confirmMsg)) return;

  setMantAdeudosMsg("Importando...", null);
  actualizarProgresoAdeudosMantenimiento(0, total);

  const acum = {
    actualizados: 0,
    no_encontrados: 0,
    omitidos: 0,
    errores: [],
    no_encontrados_muestra: []
  };

  try {
    for (let i = 0; i < total; i += MANT_ADEUdos_BATCH) {
      const chunk = _mantAdeudosFilas.slice(i, i + MANT_ADEUdos_BATCH);
      const r = await fetch(`${API}/padron/mantenimiento/adeudos/importar`, {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json" },
          typeof authHeaders === "function" ? authHeaders() : {}
        ),
        body: JSON.stringify({ ejercicio: 2026, filas: chunk })
      });
      const data = await r.json().catch(function() { return {}; });
      if (!r.ok) throw new Error(data.detail || data.message || "Error en importación");

      acum.actualizados += Number(data.actualizados || 0);
      acum.no_encontrados += Number(data.no_encontrados || 0);
      acum.omitidos += Number(data.omitidos || 0);
      if (data.errores && data.errores.length) acum.errores = acum.errores.concat(data.errores);
      if (data.no_encontrados_muestra && data.no_encontrados_muestra.length) {
        acum.no_encontrados_muestra = acum.no_encontrados_muestra.concat(data.no_encontrados_muestra);
      }
      actualizarProgresoAdeudosMantenimiento(Math.min(i + chunk.length, total), total);
    }

    const detNoEnc = acum.no_encontrados_muestra.length
      ? " · Ej. no encontradas: " + acum.no_encontrados_muestra.slice(0, 5).join(", ")
      : "";
    const detErr = acum.errores.length ? " · Errores: " + acum.errores.slice(0, 2).join("; ") : "";
    setMantAdeudosMsg(
      "Importación completada: " +
        acum.actualizados.toLocaleString("es-MX") + " actualizados, " +
        acum.no_encontrados.toLocaleString("es-MX") + " claves no encontradas en padrón" +
        (acum.omitidos ? ", " + acum.omitidos + " omitidos" : "") +
        detNoEnc + detErr,
      true
    );
  } catch (e) {
    setMantAdeudosMsg(e.message || String(e), false);
  }
}
window.importarAdeudosMantenimiento = importarAdeudosMantenimiento;

/* --- Importación de folio real (clave mas folio real.xlsx) --- */

const MANT_FOLIOS_BATCH = 10000;
let _mantFoliosFilas = [];
let _mantFoliosParseErrores = [];

function filasDesdeRawFolios(rawRows) {
  const map = new Map();
  const errores = [];
  (rawRows || []).forEach(function(raw, idx) {
    const r = normalizarKeysImportAdeudo(raw);
    const clave = String(r.CLAVE_CATASTRAL || r.CLAVECATASTRAL || r.CLAVE || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!clave) return;
    const folioRaw = r.FOLIO_REAL != null ? r.FOLIO_REAL : (r.FOLIO != null ? r.FOLIO : "");
    map.set(clave, { clave_catastral: clave, folio_real: folioRaw == null ? "" : String(folioRaw).trim() });
  });
  return { filas: Array.from(map.values()), errores: errores };
}

function parsearArchivoFoliosMantenimiento(file) {
  return parsearArchivoAdeudosMantenimiento(file);
}

function setMantFoliosMsg(texto, ok) {
  const msg = document.getElementById("mantFoliosMsg");
  if (!msg) return;
  msg.textContent = texto || "";
  msg.className = "mant-prop-msg" + (ok === true ? " ok" : ok === false ? " error" : "");
}

function renderResumenFoliosMantenimiento(filas) {
  const el = document.getElementById("mantFoliosResumen");
  if (!el) return;
  if (!filas.length) {
    el.innerHTML = "";
    return;
  }
  let conFolio = 0;
  let sinFolio = 0;
  filas.forEach(function(f) {
    const t = String(f.folio_real || "").trim();
    if (t && t !== "0") conFolio += 1;
    else sinFolio += 1;
  });
  el.innerHTML =
    "<b>Resumen:</b> " + filas.length.toLocaleString("es-MX") + " claves · " +
    conFolio.toLocaleString("es-MX") + " con folio · " +
    sinFolio.toLocaleString("es-MX") + " sin folio (0 o vacío)";
}

function renderPreviewFoliosMantenimiento(filas) {
  const el = document.getElementById("mantFoliosPreview");
  if (!el) return;
  const muestra = (filas || []).slice(0, 12);
  if (!muestra.length) {
    el.innerHTML = "";
    return;
  }
  let html = "<table class=\"mant-prop-grid\"><thead><tr><th>Clave</th><th>Folio real</th></tr></thead><tbody>";
  muestra.forEach(function(f) {
    html += "<tr><td>" + escapeHtml(f.clave_catastral) + "</td><td>" + escapeHtml(f.folio_real || "0") + "</td></tr>";
  });
  html += "</tbody></table>";
  if (filas.length > muestra.length) {
    html += "<div class=\"mant-adeudos-more\">… y " + (filas.length - muestra.length).toLocaleString("es-MX") + " más</div>";
  }
  el.innerHTML = html;
}

function abrirMantenimientoFolios() {
  if (typeof puedeEditarCatastro === "function" && !puedeEditarCatastro()) {
    alert("No tiene permisos para importar folios.");
    return;
  }
  document.getElementById("modalMantenimientoFolios")?.classList.remove("oculto");
}
window.abrirMantenimientoFolios = abrirMantenimientoFolios;

function cerrarMantenimientoFolios() {
  document.getElementById("modalMantenimientoFolios")?.classList.add("oculto");
  limpiarAsignarFolioMantenimiento();
}
window.cerrarMantenimientoFolios = cerrarMantenimientoFolios;

async function vistaPreviaFoliosMantenimiento() {
  const file = document.getElementById("mantFoliosFile")?.files?.[0];
  if (!file) {
    alert("Seleccione el archivo Excel o CSV.");
    return;
  }
  setMantFoliosMsg("Leyendo archivo...", null);
  try {
    const rawRows = await parsearArchivoFoliosMantenimiento(file);
    const parsed = filasDesdeRawFolios(rawRows);
    _mantFoliosFilas = parsed.filas;
    _mantFoliosParseErrores = parsed.errores;
    if (!_mantFoliosFilas.length) {
      throw new Error("No se encontraron filas válidas. Verifique columnas CLAVE_CATASTRAL y Folio Real.");
    }
    renderResumenFoliosMantenimiento(_mantFoliosFilas);
    renderPreviewFoliosMantenimiento(_mantFoliosFilas);
    setMantFoliosMsg("Vista previa lista. Revise el resumen antes de importar.", true);
  } catch (e) {
    _mantFoliosFilas = [];
    renderResumenFoliosMantenimiento([]);
    renderPreviewFoliosMantenimiento([]);
    setMantFoliosMsg(e.message || String(e), false);
  }
}
window.vistaPreviaFoliosMantenimiento = vistaPreviaFoliosMantenimiento;

async function descargarPlantillaFoliosMantenimiento() {
  try {
    const r = await fetch(`${API}/padron/mantenimiento/folios/plantilla.csv?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) {
      const data = await r.json().catch(function() { return {}; });
      throw new Error(data.detail || data.message || "No se pudo descargar la plantilla");
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_folios_reales.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message || String(e));
  }
}
window.descargarPlantillaFoliosMantenimiento = descargarPlantillaFoliosMantenimiento;

function actualizarProgresoFoliosMantenimiento(actual, total) {
  const wrap = document.getElementById("mantFoliosProgress");
  const bar = document.getElementById("mantFoliosProgressBar");
  if (!wrap || !bar) return;
  wrap.classList.remove("oculto");
  const pct = total > 0 ? Math.min(100, Math.round((actual / total) * 100)) : 0;
  bar.style.width = pct + "%";
  bar.textContent = pct + "%";
}

async function importarFoliosMantenimiento() {
  if (typeof puedeEditarCatastro === "function" && !puedeEditarCatastro()) {
    alert("No tiene permisos para importar folios.");
    return;
  }
  if (!_mantFoliosFilas.length) {
    await vistaPreviaFoliosMantenimiento();
    if (!_mantFoliosFilas.length) return;
  }
  const total = _mantFoliosFilas.length;
  const lotes = Math.ceil(total / MANT_FOLIOS_BATCH);
  const confirmMsg =
    "¿Importar folio real de " + total.toLocaleString("es-MX") + " predios al padrón 2026?\n\n" +
    "Los valores 0 o vacíos quedarán sin folio.\n" +
    "El proceso se enviará en " + lotes + " lote(s).";
  if (!confirm(confirmMsg)) return;

  setMantFoliosMsg("Importando...", null);
  actualizarProgresoFoliosMantenimiento(0, total);

  const acum = {
    actualizados: 0,
    no_encontrados: 0,
    con_folio: 0,
    sin_folio: 0,
    omitidos: 0,
    no_encontrados_muestra: []
  };

  try {
    for (let i = 0; i < total; i += MANT_FOLIOS_BATCH) {
      const chunk = _mantFoliosFilas.slice(i, i + MANT_FOLIOS_BATCH);
      const r = await fetch(`${API}/padron/mantenimiento/folios/importar`, {
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json" },
          typeof authHeaders === "function" ? authHeaders() : {}
        ),
        body: JSON.stringify({ filas: chunk })
      });
      const data = await r.json().catch(function() { return {}; });
      if (!r.ok) throw new Error(data.detail || data.message || "Error en importación");

      acum.actualizados += Number(data.actualizados || 0);
      acum.no_encontrados += Number(data.no_encontrados || 0);
      acum.con_folio += Number(data.con_folio || 0);
      acum.sin_folio += Number(data.sin_folio || 0);
      acum.omitidos += Number(data.omitidos || 0);
      if (data.no_encontrados_muestra && data.no_encontrados_muestra.length) {
        acum.no_encontrados_muestra = acum.no_encontrados_muestra.concat(data.no_encontrados_muestra);
      }
      actualizarProgresoFoliosMantenimiento(Math.min(i + chunk.length, total), total);
    }

    const detNoEnc = acum.no_encontrados_muestra.length
      ? " · Ej. no encontradas: " + acum.no_encontrados_muestra.slice(0, 5).join(", ")
      : "";
    setMantFoliosMsg(
      "Importación completada: " +
        acum.actualizados.toLocaleString("es-MX") + " actualizados, " +
        acum.con_folio.toLocaleString("es-MX") + " con folio, " +
        acum.no_encontrados.toLocaleString("es-MX") + " claves no encontradas en padrón" +
        detNoEnc,
      true
    );
  } catch (e) {
    setMantFoliosMsg(e.message || String(e), false);
  }
}
window.importarFoliosMantenimiento = importarFoliosMantenimiento;

let _mantFoliosClaveAsignar = "";

function limpiarAsignarFolioMantenimiento() {
  _mantFoliosClaveAsignar = "";
  const res = document.getElementById("mantFoliosBuscarResultados");
  const form = document.getElementById("mantFoliosAsignarForm");
  if (res) res.innerHTML = "";
  if (form) form.classList.add("oculto");
}

function seleccionarPredioAsignarFolio(clave) {
  _mantFoliosClaveAsignar = String(clave || "").trim().toUpperCase();
  const form = document.getElementById("mantFoliosAsignarForm");
  const resumen = document.getElementById("mantFoliosAsignarResumen");
  const inputFolio = document.getElementById("mantFoliosAsignarFolio");
  if (!form || !resumen || !_mantFoliosClaveAsignar) return;

  const fila = (window._mantFoliosBuscarFilas || []).find(function(r) {
    return String(r.clave_catastral || "").trim().toUpperCase() === _mantFoliosClaveAsignar;
  });
  const folioActual = String(fila?.folio_real || "").trim();
  const titular = String(fila?.titular_principal || fila?.nombre_completo || "").trim();
  const colonia = String(fila?.colonia || "").trim();

  resumen.innerHTML =
    "<b>Clave:</b> " + escapeHtml(_mantFoliosClaveAsignar) +
    (titular ? " · <b>Titular:</b> " + escapeHtml(titular) : "") +
    (colonia ? " · <b>Colonia:</b> " + escapeHtml(colonia) : "") +
    (folioActual && folioActual !== "0" ? " · <b>Folio actual:</b> " + escapeHtml(folioActual) : "");

  if (inputFolio) {
    inputFolio.value = folioActual && folioActual !== "0" ? folioActual : "";
  }
  form.classList.remove("oculto");
}

async function buscarPadronAsignarFolio() {
  const clave = String(document.getElementById("mantFoliosBuscarClave")?.value || "").trim();
  const nombre = String(document.getElementById("mantFoliosBuscarNombre")?.value || "").trim();
  const colonia = String(document.getElementById("mantFoliosBuscarColonia")?.value || "").trim();
  const cont = document.getElementById("mantFoliosBuscarResultados");
  const form = document.getElementById("mantFoliosAsignarForm");

  if (!clave && !nombre && !colonia) {
    alert("Indique al menos clave, propietario o colonia.");
    return;
  }

  setMantFoliosMsg("Buscando en padrón...", null);
  if (cont) cont.innerHTML = "<p class=\"mant-folios-buscar-cargando\">Buscando...</p>";
  if (form) form.classList.add("oculto");
  _mantFoliosClaveAsignar = "";

  try {
    const url = typeof construirUrlBusqueda === "function"
      ? construirUrlBusqueda(clave, nombre, colonia, "", "", "", 40)
      : `${API}/padron/busqueda-avanzada?clave=${encodeURIComponent(clave)}&nombre=${encodeURIComponent(nombre)}&colonia=${encodeURIComponent(colonia)}&limite=40`;
    const r = await fetch(url, { cache: "no-store", headers: typeof authHeaders === "function" ? authHeaders() : {} });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || `HTTP ${r.status}`);

    const filas = data.resultados || [];
    window._mantFoliosBuscarFilas = filas;
    if (!filas.length) {
      if (cont) cont.innerHTML = "<p class=\"mant-folios-vacio\">Sin resultados en padrón.</p>";
      setMantFoliosMsg("Sin resultados.", false);
      return;
    }

    let html = "<table class=\"mant-prop-grid mant-folios-grid\"><thead><tr>" +
      "<th>Clave</th><th>Titular</th><th>Colonia</th><th>Folio</th><th></th></tr></thead><tbody>";
    filas.forEach(function(row) {
      const cl = String(row.clave_catastral || "").trim().toUpperCase();
      const folio = String(row.folio_real || "").trim();
      const tit = String(row.titular_principal || row.nombre_completo || "—").trim();
      const col = String(row.colonia || "—").trim();
      html += "<tr>" +
        "<td>" + escapeHtml(cl) + "</td>" +
        "<td>" + escapeHtml(tit) + "</td>" +
        "<td>" + escapeHtml(col) + "</td>" +
        "<td>" + escapeHtml(folio && folio !== "0" ? folio : "—") + "</td>" +
        "<td><button type=\"button\" class=\"btn-busqueda-unica\" data-clave=\"" + cl.replace(/"/g, "") + "\" onclick=\"seleccionarPredioAsignarFolio(this.dataset.clave)\">Elegir</button></td>" +
        "</tr>";
    });
    html += "</tbody></table>";
    if (cont) cont.innerHTML = html;
    setMantFoliosMsg(filas.length + " predio(s) encontrado(s). Elija uno y grabe el folio.", true);
  } catch (e) {
    if (cont) cont.innerHTML = "";
    setMantFoliosMsg(e.message || String(e), false);
  }
}
window.buscarPadronAsignarFolio = buscarPadronAsignarFolio;

async function grabarFolioAsignadoMantenimiento() {
  if (typeof puedeEditarCatastro === "function" && !puedeEditarCatastro()) {
    alert("No tiene permisos para asignar folios.");
    return;
  }
  const clave = _mantFoliosClaveAsignar;
  const folio = String(document.getElementById("mantFoliosAsignarFolio")?.value || "").trim();
  if (!clave) {
    alert("Seleccione un predio de la tabla.");
    return;
  }
  if (!folio || folio === "0") {
    alert("Indique el folio real (solo números).");
    return;
  }
  if (!confirm("¿Grabar folio real " + folio + " en la clave " + clave + "?")) return;

  setMantFoliosMsg("Guardando folio...", null);
  try {
    const r = await fetch(`${API}/padron/mantenimiento/folios/asignar`, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        typeof authHeaders === "function" ? authHeaders() : {}
      ),
      body: JSON.stringify({ clave_catastral: clave, folio_real: folio })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || `HTTP ${r.status}`);

    setMantFoliosMsg("Folio " + folio + " asignado a " + clave + ".", true);
    if (window._mantFoliosBuscarFilas) {
      window._mantFoliosBuscarFilas.forEach(function(row) {
        if (String(row.clave_catastral || "").trim().toUpperCase() === clave) {
          row.folio_real = folio;
        }
      });
    }
    await buscarPadronAsignarFolio();
    seleccionarPredioAsignarFolio(clave);
  } catch (e) {
    setMantFoliosMsg(e.message || String(e), false);
  }
}
window.grabarFolioAsignadoMantenimiento = grabarFolioAsignadoMantenimiento;
window.seleccionarPredioAsignarFolio = seleccionarPredioAsignarFolio;
