/* --- v58/v61: Análisis evolución zonas homogéneas (años dinámicos) --- */
const ANALISIS_ZONAS_ANIOS_BASE = [2023, 2024, 2025, 2026];
const ANALISIS_ZONAS_COLORES = { 2023: "#059669", 2024: "#dc2626", 2025: "#ea580c", 2026: "#2563eb", 2027: "#16a34a" };
const ANALISIS_ZONAS_PALETA = ["#059669", "#dc2626", "#ea580c", "#2563eb", "#16a34a", "#7c3aed", "#0891b2"];

let _analisisZonasState = {
  resultados: [],
  total: 0,
  indice: 0,
  cargando: false,
  filtrosListos: false,
  anios: ANALISIS_ZONAS_ANIOS_BASE.slice()
};

let _analisisZonasMap = null;
let _analisisZonasMapCapas = null;
let _analisisZonasMapCodigo = "";
let _analisisZonasMapReqId = 0;

function obtenerAniosAnalisisZonas() {
  const arr = _analisisZonasState.anios;
  if (arr && arr.length) return arr.slice();
  return ANALISIS_ZONAS_ANIOS_BASE.slice();
}

function colorAnioAnalisisZona(an, idx) {
  const y = parseInt(an, 10);
  if (!Number.isNaN(y) && ANALISIS_ZONAS_COLORES[y]) return ANALISIS_ZONAS_COLORES[y];
  if (ANALISIS_ZONAS_COLORES[an]) return ANALISIS_ZONAS_COLORES[an];
  return ANALISIS_ZONAS_PALETA[idx % ANALISIS_ZONAS_PALETA.length];
}

function actualizarEncabezadoAniosAnalisis() {
  const anios = obtenerAniosAnalisisZonas();
  const sub = document.getElementById("analisisZonasSubtitulo");
  if (sub) sub.textContent = "Evolución del valor por m² · ejercicios " + anios.join(", ");
  const sel = document.getElementById("analisisZonasAnio");
  if (sel) {
    const actual = sel.value;
    const labelTodos = anios.length > 1
      ? ("TODOS (" + anios[0] + "–" + anios[anios.length - 1] + ")")
      : "TODOS";
    sel.innerHTML = `<option value="">${escapeHtml(labelTodos)}</option>`;
    anios.forEach(function(a) {
      sel.innerHTML += `<option value="${a}">${a}</option>`;
    });
    if (actual && Array.from(sel.options).some(function(o) { return o.value === actual; })) {
      sel.value = actual;
    }
  }
}

function renderEditarZonaValoresInputs(reg) {
  const cont = document.getElementById("editarZonaValoresDinamic");
  if (!cont) return;
  const anios = obtenerAniosAnalisisZonas();
  let html = "";
  anios.forEach(function(an) {
    const val = reg && reg["valor_" + an] != null ? reg["valor_" + an] : "";
    html += `<label class="input-label-mini">Valor / m² · ${an}</label>`;
    html += `<input type="number" id="editarZonaValor${an}" min="0" step="0.01" value="${val !== "" ? escapeHtml(String(val)) : ""}" placeholder="0.00">`;
  });
  cont.innerHTML = html;
}

function abrirModuloAnalisisZonas() {
  document.getElementById("overlayAnalisisZonas")?.classList.remove("oculto");
  document.body.classList.add("analisis-zonas-activo");
  if (!_analisisZonasState.filtrosListos) {
    cargarFiltrosAnalisisZonas().then(function() {
      if (!_analisisZonasState.resultados.length) buscarAnalisisZonasHomogeneas();
    });
  } else if (!_analisisZonasState.resultados.length) {
    buscarAnalisisZonasHomogeneas();
  } else {
    renderAnalisisZonasCompleto();
  }
  setTimeout(function() {
    if (_analisisZonasMap) {
      _analisisZonasMap.updateSize();
      analisisZonasCentrarMapa();
    }
  }, 150);
}
window.abrirModuloAnalisisZonas = abrirModuloAnalisisZonas;

function cerrarModuloAnalisisZonas() {
  destruirMapaAnalisisZonas();
  document.getElementById("overlayAnalisisZonas")?.classList.add("oculto");
  document.body.classList.remove("analisis-zonas-activo");
}
window.cerrarModuloAnalisisZonas = cerrarModuloAnalisisZonas;

function llenarSelectAnalisisZonas(id, valores, etiquetaTodas) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(etiquetaTodas)}</option>`;
  (valores || []).forEach(function(v) {
    sel.innerHTML += `<option value="${escapeHtml(String(v))}">${escapeHtml(String(v))}</option>`;
  });
  if (actual && Array.from(sel.options).some(function(o) { return o.value === actual; })) {
    sel.value = actual;
  }
}

async function cargarFiltrosAnalisisZonas() {
  try {
    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/filtros?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (!r.ok) throw new Error("No se pudieron cargar filtros");
    const data = await r.json();
    llenarSelectAnalisisZonas("analisisZonasZona", data.zonas, "TODAS");
    llenarSelectAnalisisZonas("analisisZonasSector", data.sectores, "TODOS");
    llenarSelectAnalisisZonas("analisisZonasSubsector", data.subsectores, "TODOS");
    _analisisZonasState.anios = data.anios && data.anios.length ? data.anios : ANALISIS_ZONAS_ANIOS_BASE.slice();
    actualizarEncabezadoAniosAnalisis();
    _analisisZonasState.filtrosListos = true;
  } catch (e) {
    console.warn("Filtros analisis zonas:", e);
  }
}

function obtenerFiltrosAnalisisZonasForm() {
  return {
    codigo: (document.getElementById("analisisZonasCodigo")?.value || "").trim(),
    zona: (document.getElementById("analisisZonasZona")?.value || "").trim(),
    sector: (document.getElementById("analisisZonasSector")?.value || "").trim(),
    subsector: (document.getElementById("analisisZonasSubsector")?.value || "").trim(),
    anio: parseInt(document.getElementById("analisisZonasAnio")?.value || "0", 10) || 0,
    q: (document.getElementById("analisisZonasTexto")?.value || "").trim()
  };
}

function limpiarFiltrosAnalisisZonas() {
  ["analisisZonasCodigo", "analisisZonasTexto"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["analisisZonasZona", "analisisZonasSector", "analisisZonasSubsector", "analisisZonasAnio"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  buscarAnalisisZonasHomogeneas();
}
window.limpiarFiltrosAnalisisZonas = limpiarFiltrosAnalisisZonas;

async function buscarAnalisisZonasHomogeneas() {
  if (_analisisZonasState.cargando) return;
  _analisisZonasState.cargando = true;
  const lista = document.getElementById("analisisZonasLista");
  if (lista) lista.textContent = "Buscando...";

  try {
    const f = obtenerFiltrosAnalisisZonasForm();
    const qs = new URLSearchParams();
    if (f.codigo) qs.set("codigo", f.codigo);
    if (f.zona) qs.set("zona", f.zona);
    if (f.sector) qs.set("sector", f.sector);
    if (f.subsector) qs.set("subsector", f.subsector);
    if (f.anio) qs.set("anio", String(f.anio));
    if (f.q) qs.set("q", f.q);
    qs.set("limite", "5000");
    qs.set("offset", "0");

    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/evolucion?${qs.toString()}&_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "Error en consulta");

    _analisisZonasState.resultados = data.resultados || [];
    _analisisZonasState.total = data.total || _analisisZonasState.resultados.length;
    if (data.anios && data.anios.length) _analisisZonasState.anios = data.anios;
    actualizarEncabezadoAniosAnalisis();
    _analisisZonasState.indice = 0;
    renderAnalisisZonasCompleto();
  } catch (e) {
    if (lista) lista.innerHTML = `<div class="analisis-zonas-error">${escapeHtml(e.message || String(e))}</div>`;
  } finally {
    _analisisZonasState.cargando = false;
  }
}
window.buscarAnalisisZonasHomogeneas = buscarAnalisisZonasHomogeneas;

function navegarAnalisisZonas(delta) {
  const total = _analisisZonasState.total || 0;
  if (!total) return;
  let idx = (_analisisZonasState.indice || 0) + delta;
  if (idx < 0) idx = total - 1;
  if (idx >= total) idx = 0;
  _analisisZonasState.indice = idx;
  renderAnalisisZonasCompleto();
}
window.navegarAnalisisZonas = navegarAnalisisZonas;

function seleccionarAnalisisZonaIndice(idx) {
  _analisisZonasState.indice = idx;
  renderAnalisisZonasCompleto();
}
window.seleccionarAnalisisZonaIndice = seleccionarAnalisisZonaIndice;

function registroAnalisisZonasActual() {
  const arr = _analisisZonasState.resultados || [];
  if (!arr.length) return null;
  const idx = Math.min(Math.max(_analisisZonasState.indice || 0, 0), arr.length - 1);
  return arr[idx] || null;
}

function renderAnalisisZonasLista() {
  const cont = document.getElementById("analisisZonasLista");
  if (!cont) return;
  const arr = _analisisZonasState.resultados || [];
  const anios = obtenerAniosAnalisisZonas();
  if (!arr.length) {
    cont.innerHTML = '<div class="analisis-zonas-vacio">Sin resultados para los filtros indicados.</div>';
    return;
  }
  const idxAct = _analisisZonasState.indice || 0;
  let html = '<table class="analisis-zonas-tabla"><thead><tr><th>Código</th><th>Descripción</th>';
  anios.forEach(function(an) { html += `<th>${an}</th>`; });
  html += '</tr></thead><tbody>';
  arr.forEach(function(row, idx) {
    const cod = row.clave_zonah || row.codigo_zona_homogenea || "—";
    const desc = row.descripcion_col_fracc || "";
    const v = function(n, val) { return val != null ? formatValorM2(val) : "—"; };
    html += `<tr class="${idx === idxAct ? "activo" : ""}" onclick="seleccionarAnalisisZonaIndice(${idx})"><td><b>${escapeHtml(cod)}</b></td><td>${escapeHtml(desc)}</td>`;
    anios.forEach(function(an) {
      html += `<td>${escapeHtml(v(an, row["valor_" + an]))}</td>`;
    });
    html += '</tr>';
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
  const filaActiva = cont.querySelector("tr.activo");
  if (filaActiva) filaActiva.scrollIntoView({ block: "nearest" });
}

function renderAnalisisZonasDetalle(reg) {
  const valores = document.getElementById("analisisZonasDetalleValores");
  const meta = document.getElementById("analisisZonasMeta");
  const contador = document.getElementById("analisisZonasContador");
  const variacion = document.getElementById("analisisZonasVariacion");
  const total = _analisisZonasState.total || 0;
  const idx = _analisisZonasState.indice || 0;

  if (contador) {
    contador.textContent = total
      ? `Registro #${idx + 1} de ${total.toLocaleString("es-MX")} encontrados`
      : "Sin registros";
  }

  if (!reg) {
    if (valores) valores.innerHTML = "";
    if (meta) meta.innerHTML = "";
    if (variacion) variacion.textContent = "";
    dibujarGraficaEvolucionZona(null);
    actualizarMapaAnalisisZonas(null);
    return;
  }

  if (valores) {
    let vhtml = "";
    const anios = obtenerAniosAnalisisZonas();
    anios.forEach(function(an) {
      const val = reg["valor_" + an] != null
        ? reg["valor_" + an]
        : ((reg.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
      vhtml += `<div class="analisis-zona-valor-line">
        <span>VALOR${an}</span>
        <b>${val != null ? formatValorM2(val) : "—"}</b>
      </div>`;
    });
    valores.innerHTML = vhtml;
  }

  if (meta) {
    const cod = reg.clave_zonah || reg.codigo_zona_homogenea || "—";
    meta.innerHTML = `
      <div><span>SECSUB / ZONAH</span><b>${escapeHtml(cod)}</b></div>
      <div><span>NOMBRE</span><b>${escapeHtml(reg.descripcion_col_fracc || "—")}</b></div>
      <div><span>ZONA / SECTOR</span><b>${escapeHtml([reg.zona, reg.sector].filter(Boolean).join(" · ") || "—")}</b></div>
      <div><span>SUBSECTOR</span><b>${escapeHtml(reg.subsector || "—")}</b></div>
      ${reg.es_adicional ? `<div><span>TIPO</span><b>[${escapeHtml(reg.tipo_zona || "ADICIONAL")}]</b></div>` : ""}
    `;
  }

  if (variacion) {
    if (reg.variacion_pct != null) {
      const signo = reg.variacion_abs >= 0 ? "+" : "";
      const anios = obtenerAniosAnalisisZonas();
      const desde = reg.variacion_desde || anios[0];
      const hasta = reg.variacion_hasta || anios[anios.length - 1];
      variacion.innerHTML = `Variación ${desde}→${hasta}: <b>${signo}${reg.variacion_pct}%</b> (${signo}${formatValorM2(reg.variacion_abs).replace(" / m²", "")})`;
    } else {
      variacion.textContent = "";
    }
  }

  dibujarGraficaEvolucionZona(reg);
  actualizarMapaAnalisisZonas(reg);
}

function renderAnalisisZonasLeyenda() {
  const el = document.getElementById("analisisZonasLeyenda");
  if (!el) return;
  const anios = obtenerAniosAnalisisZonas();
  el.innerHTML = anios.map(function(an, idx) {
    return `<span><i style="background:${colorAnioAnalisisZona(an, idx)}"></i>${an}</span>`;
  }).join("");
}

function dibujarGraficaEvolucionZona(reg, canvasOpt, opts) {
  opts = opts || {};
  if (!canvasOpt) renderAnalisisZonasLeyenda();
  const canvas = canvasOpt || document.getElementById("analisisZonasCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (opts.fondo) {
    ctx.fillStyle = opts.fondo;
    ctx.fillRect(0, 0, W, H);
  }

  if (!reg) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Seleccione una zona homogénea", W / 2, H / 2);
    return;
  }

  const padTopExtra = opts.titulo ? 24 : 0;
  const anios = obtenerAniosAnalisisZonas();
  const datos = anios.map(function(an) {
    let valor = reg["valor_" + an];
    if (valor == null) {
      const item = (reg.evolucion || []).find(function(e) { return e.anio === an; });
      valor = item?.valor_m2;
    }
    return { anio: an, valor: valor != null ? Number(valor) : null };
  }).filter(function(d) { return d.valor != null; });

  if (!datos.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sin valores registrados", W / 2, H / 2);
    return;
  }

  if (opts.titulo) {
    ctx.fillStyle = "#703341";
    ctx.font = "bold 15px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(opts.titulo, W / 2, 22);
  }

  const padL = 58, padR = 24, padT = 36 + padTopExtra, padB = 56;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max.apply(null, datos.map(function(d) { return d.valor; })) * 1.12;
  const barW = Math.min(72, chartW / (datos.length * 1.8));
  const gap = (chartW - barW * datos.length) / (datos.length + 1);

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + chartH);
  ctx.lineTo(padL + chartW, padT + chartH);
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "11px Segoe UI, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const yVal = maxVal * (1 - i / 4);
    const y = padT + (chartH * i) / 4;
    ctx.fillText("$" + yVal.toLocaleString("es-MX", { maximumFractionDigits: 0 }), padL - 8, y + 4);
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  datos.forEach(function(d, i) {
    const x = padL + gap + i * (barW + gap);
    const h = (d.valor / maxVal) * chartH;
    const y = padT + chartH - h;
    ctx.fillStyle = colorAnioAnalisisZona(d.anio, i) || "#64748b";
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 11px Segoe UI, sans-serif";
    ctx.fillText("$" + d.valor.toLocaleString("es-MX", { maximumFractionDigits: 0 }), x + barW / 2, y - 6);
    ctx.fillStyle = "#475569";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillText(String(d.anio), x + barW / 2, padT + chartH + 18);
  });

  ctx.fillStyle = "#334155";
  ctx.font = "bold 12px Segoe UI, sans-serif";
  ctx.fillText(reg.clave_zonah || reg.codigo_zona_homogenea || "", W / 2, H - 8);

  ctx.save();
  ctx.translate(14, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748b";
  ctx.font = "11px Segoe UI, sans-serif";
  ctx.fillText("Valor × m²", 0, 0);
  ctx.restore();
}

function obtenerImagenGraficaZonaHomogenea(reg) {
  const c = document.createElement("canvas");
  c.width = 820;
  c.height = 460;
  dibujarGraficaEvolucionZona(reg, c, {
    titulo: "ZONA HOMOGÉNEA · VALOR × AÑO",
    fondo: "#ffffff"
  });
  try {
    return c.toDataURL("image/png");
  } catch (e) {
    return null;
  }
}

function recalcularVariacionZona(reg) {
  if (!reg) return reg;
  const v24 = reg.valor_2024;
  const v25 = reg.valor_2025;
  const v26 = reg.valor_2026;
  const base = v24 != null ? v24 : (v25 != null ? v25 : v26);
  const ultimo = v26 != null ? v26 : (v25 != null ? v25 : v24);
  reg.variacion_abs = null;
  reg.variacion_pct = null;
  if (base != null && ultimo != null) {
    reg.variacion_abs = Number(ultimo) - Number(base);
    if (Number(base) !== 0) {
      reg.variacion_pct = Math.round((reg.variacion_abs / Number(base)) * 10000) / 100;
    }
  }
  reg.evolucion = obtenerAniosAnalisisZonas().map(function(an) {
    const key = "valor_" + an;
    const val = reg[key];
    return { anio: an, valor_m2: val != null ? Number(val) : null, presente: val != null };
  });
  return reg;
}

let _analisisZonasFormModo = "editar";
let _logoInstitucionalCache = null;

function actualizarPreviewCodigoEditarZona() {
  const sub = (document.getElementById("editarZonaSubsector")?.value || "").trim().toUpperCase();
  const hom = (document.getElementById("editarZonaHomoclave")?.value || "").trim().toUpperCase();
  const sec = (document.getElementById("editarZonaSeccion")?.value || "").trim().toUpperCase();
  const cod = _codigo_zonah_desde_partes(sub, hom, sec);
  const prev = document.getElementById("editarZonaCodigoPreview");
  if (prev) prev.value = cod;
}

function prepararModalFormZonaHomogenea(modo) {
  _analisisZonasFormModo = modo;
  const heading = document.getElementById("editarZonaHeading");
  const btn = document.getElementById("editarZonaBtnGuardar");
  const bloqueTipo = document.getElementById("editarZonaBloqueTipo");
  if (heading) heading.textContent = modo === "nueva" ? "Registrar nueva zona homogénea" : "Corregir zona homogénea";
  if (btn) btn.textContent = modo === "nueva" ? "💾 Crear zona homogénea" : "💾 Guardar corrección";
  bloqueTipo?.classList.toggle("oculto", modo !== "nueva");

  ["editarZonaSubsector", "editarZonaHomoclave", "editarZonaSeccion"].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el || el.dataset.zhBind) return;
    el.dataset.zhBind = "1";
    el.addEventListener("input", actualizarPreviewCodigoEditarZona);
  });
}

function abrirModalFormZonaHomogenea() {
  const modal = document.getElementById("modalEditarZonaHomogenea");
  if (!modal) return;
  modal.classList.remove("oculto");
  document.body.classList.add("modal-zona-homogenea-activo");
}

function abrirEditarZonaHomogenea() {
  if (!puedeEditarCatastro()) {
    alert("No tiene permisos para editar valores de zona homogénea.");
    return;
  }
  const reg = registroAnalisisZonasActual();
  if (!reg) {
    alert("Seleccione una zona homogénea.");
    return;
  }
  prepararModalFormZonaHomogenea("editar");
  const cod = reg.clave_zonah || reg.codigo_zona_homogenea || "";
  document.getElementById("editarZonaTitulo").textContent = cod + (reg.descripcion_col_fracc ? " · " + reg.descripcion_col_fracc : "");
  document.getElementById("editarZonaDescripcion").value = reg.descripcion_col_fracc || "";
  document.getElementById("editarZonaZona").value = reg.zona || "";
  document.getElementById("editarZonaSector").value = reg.sector || "";
  document.getElementById("editarZonaSubsector").value = reg.subsector || "";
  document.getElementById("editarZonaHomoclave").value = reg.homoclave_col_fracc || "";
  document.getElementById("editarZonaSeccion").value = reg.seccion || "";
  renderEditarZonaValoresInputs(reg);
  document.getElementById("editarZonaMotivo").value = "";
  actualizarPreviewCodigoEditarZona();
  const msg = document.getElementById("editarZonaMensaje");
  if (msg) { msg.textContent = ""; msg.className = "modal-mov-msg"; }
  abrirModalFormZonaHomogenea();
}
window.abrirEditarZonaHomogenea = abrirEditarZonaHomogenea;

function abrirNuevaZonaHomogenea() {
  if (!puedeEditarCatastro()) {
    alert("No tiene permisos para crear zonas homogéneas.");
    return;
  }
  prepararModalFormZonaHomogenea("nueva");
  document.getElementById("editarZonaTitulo").textContent = "Capture los datos de la nueva zona (Subsector + Homoclave + Sección)";
  document.getElementById("editarZonaTipo").value = "OFICIAL";
  ["editarZonaDescripcion", "editarZonaZona", "editarZonaSector", "editarZonaSubsector",
    "editarZonaHomoclave", "editarZonaSeccion", "editarZonaMotivo"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderEditarZonaValoresInputs(null);
  actualizarPreviewCodigoEditarZona();
  const msg = document.getElementById("editarZonaMensaje");
  if (msg) { msg.textContent = ""; msg.className = "modal-mov-msg"; }
  abrirModalFormZonaHomogenea();
}
window.abrirNuevaZonaHomogenea = abrirNuevaZonaHomogenea;

function cerrarEditarZonaHomogenea() {
  document.getElementById("modalEditarZonaHomogenea")?.classList.add("oculto");
  document.body.classList.remove("modal-zona-homogenea-activo");
}
window.cerrarEditarZonaHomogenea = cerrarEditarZonaHomogenea;

async function guardarAjusteZonaHomogenea() {
  const msg = document.getElementById("editarZonaMensaje");
  const motivo = (document.getElementById("editarZonaMotivo")?.value || "").trim();
  if (!motivo) {
    if (msg) { msg.textContent = "Indique el motivo o fundamento legal."; msg.className = "modal-mov-msg error"; }
    return;
  }

  const valores = [];
  obtenerAniosAnalisisZonas().forEach(function(an) {
    const raw = document.getElementById("editarZonaValor" + an)?.value;
    if (raw !== "" && raw != null) valores.push({ anio: an, valor_m2: parseFloat(raw) });
  });
  if (!valores.length) {
    if (msg) { msg.textContent = "Capture al menos un valor por m²."; msg.className = "modal-mov-msg error"; }
    return;
  }

  const metaForm = {
    descripcion_col_fracc: (document.getElementById("editarZonaDescripcion")?.value || "").trim().toUpperCase(),
    zona: (document.getElementById("editarZonaZona")?.value || "").trim().toUpperCase(),
    sector: (document.getElementById("editarZonaSector")?.value || "").trim().toUpperCase(),
    subsector: (document.getElementById("editarZonaSubsector")?.value || "").trim().toUpperCase(),
    homoclave_col_fracc: (document.getElementById("editarZonaHomoclave")?.value || "").trim().toUpperCase(),
    seccion: (document.getElementById("editarZonaSeccion")?.value || "").trim().toUpperCase()
  };

  if (_analisisZonasFormModo === "nueva") {
    if (!metaForm.descripcion_col_fracc || !metaForm.zona || !metaForm.sector ||
        !metaForm.subsector || !metaForm.homoclave_col_fracc || !metaForm.seccion) {
      if (msg) { msg.textContent = "Complete zona, sector, subsector, homoclave, sección y descripción."; msg.className = "modal-mov-msg error"; }
      return;
    }
  }

  const reg = registroAnalisisZonasActual();
  const claveEdit = reg ? (reg.clave_zonah || reg.codigo_zona_homogenea) : "";
  const claveSel = _codigo_zonah_desde_partes(metaForm.subsector, metaForm.homoclave_col_fracc, metaForm.seccion) || claveEdit;

  let url = `${API}/padron/analisis/zonas-homogeneas`;
  let method = "PATCH";
  let payload;

  if (_analisisZonasFormModo === "nueva") {
    method = "POST";
    payload = Object.assign({}, metaForm, {
      motivo: motivo.toUpperCase(),
      tipo_registro: document.getElementById("editarZonaTipo")?.value || "OFICIAL",
      fundamento_legal: motivo.toUpperCase(),
      valores: valores
    });
  } else {
    if (!reg) return;
    payload = Object.assign({ clave_zonah: claveEdit, motivo: motivo.toUpperCase() }, metaForm, { valores: valores });
  }

  try {
    if (msg) { msg.textContent = "Guardando..."; msg.className = "modal-mov-msg"; }
    const r = await fetch(url, {
      method: method,
      headers: Object.assign({ "Content-Type": "application/json" }, typeof authHeaders === "function" ? authHeaders() : {}),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "No se pudo guardar");

    _cacheCatalogoZonasHomogeneas = {};
    const idxPrev = _analisisZonasState.indice || 0;
    cerrarEditarZonaHomogenea();
    document.getElementById("analisisZonasCodigo").value = claveSel;
    await buscarAnalisisZonasHomogeneas();
    const nuevoIdx = (_analisisZonasState.resultados || []).findIndex(function(row) {
      return (row.clave_zonah || row.codigo_zona_homogenea) === claveSel;
    });
    _analisisZonasState.indice = nuevoIdx >= 0 ? nuevoIdx : idxPrev;
    renderAnalisisZonasCompleto();
    alert(_analisisZonasFormModo === "nueva" ? "Zona homogénea creada correctamente." : "Corrección guardada correctamente.");
  } catch (e) {
    if (msg) { msg.textContent = e.message || String(e); msg.className = "modal-mov-msg error"; }
  }
}
window.guardarAjusteZonaHomogenea = guardarAjusteZonaHomogenea;

function normalizarKeysImportZona(raw) {
  const out = {};
  Object.keys(raw || {}).forEach(function(k) {
    out[String(k).trim().toLowerCase().replace(/\s+/g, "_")] = raw[k];
  });
  return out;
}

function parsearArchivoZonasHomogeneas(file) {
  return new Promise(function(resolve, reject) {
    if (typeof XLSX === "undefined") {
      reject(new Error("Biblioteca Excel no disponible."));
      return;
    }
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
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
    reader.readAsArrayBuffer(file);
  });
}

async function descargarPlantillaZonasHomogeneas() {
  try {
    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/plantilla.csv?_=${Date.now()}`, {
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
    a.download = "plantilla_zonas_homogeneas.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message || String(e));
  }
}
window.descargarPlantillaZonasHomogeneas = descargarPlantillaZonasHomogeneas;

async function importarArchivoZonasHomogeneas() {
  if (!puedeEditarCatastro()) {
    alert("No tiene permisos para importar zonas homogéneas.");
    return;
  }
  const anio = parseInt(document.getElementById("analisisZonasImportAnio")?.value || "0", 10);
  const fileInput = document.getElementById("analisisZonasImportFile");
  const msg = document.getElementById("analisisZonasImportMsg");
  const reemplazar = document.getElementById("analisisZonasImportReemplazar")?.checked || false;
  const file = fileInput?.files?.[0];

  if (!anio || anio < 2020 || anio > 2035) {
    alert("Indique un año válido (2020–2035).");
    return;
  }
  if (!file) {
    alert("Seleccione un archivo CSV o Excel.");
    return;
  }
  const confirmMsg = reemplazar
    ? `¿Importar el ejercicio ${anio}? Se eliminarán todas las zonas oficiales de ese año antes de cargar el archivo.`
    : `¿Importar zonas homogéneas del ejercicio ${anio}?`;
  if (!confirm(confirmMsg)) return;

  if (msg) { msg.textContent = "Procesando archivo..."; msg.className = "analisis-zonas-import-msg"; }

  try {
    const rawRows = await parsearArchivoZonasHomogeneas(file);
    const filas = [];
    rawRows.forEach(function(raw) {
      const r = normalizarKeysImportZona(raw);
      const valorRaw = r.valor_m2 != null && r.valor_m2 !== "" ? r.valor_m2 : r.valor;
      const valor = parseFloat(String(valorRaw || "").replace(/[$,\s]/g, ""));
      if (isNaN(valor)) return;
      const fila = {
        anio: anio,
        zona: String(r.zona || "").trim(),
        sector: String(r.sector || "").trim(),
        subsector: String(r.subsector || "").trim(),
        homoclave_col_fracc: String(r.homoclave_col_fracc || r.homoclave || "").trim(),
        seccion: String(r.seccion || "").trim(),
        descripcion_col_fracc: String(r.descripcion_col_fracc || r.descripcion || "").trim(),
        valor_m2: valor
      };
      const cod = String(r.codigo_zona_homogenea || r.codigo || "").trim();
      if (cod) fila.codigo_zona_homogenea = cod;
      filas.push(fila);
    });
    if (!filas.length) throw new Error("No se encontraron filas válidas. Verifique columnas y valores.");

    const r = await fetch(`${API}/padron/analisis/zonas-homogeneas/importar`, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, typeof authHeaders === "function" ? authHeaders() : {}),
      body: JSON.stringify({ anio: anio, reemplazar: reemplazar, filas: filas })
    });
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || data.message || "Error en importación");

    _cacheCatalogoZonasHomogeneas = {};
    const detalleErrores = (data.errores && data.errores.length)
      ? " · " + data.errores.slice(0, 3).join("; ")
      : "";
    if (msg) {
      msg.textContent = `Listo: ${data.procesados || 0} procesados (${data.insertados || 0} nuevos, ${data.actualizados || 0} actualizados${data.omitidos ? ", " + data.omitidos + " omitidos" : ""})${detalleErrores}`;
      msg.className = "analisis-zonas-import-msg ok";
    }
    if (fileInput) fileInput.value = "";
    await cargarFiltrosAnalisisZonas();
    await buscarAnalisisZonasHomogeneas();
  } catch (e) {
    if (msg) { msg.textContent = e.message || String(e); msg.className = "analisis-zonas-import-msg error"; }
  }
}
window.importarArchivoZonasHomogeneas = importarArchivoZonasHomogeneas;

function exportarAnalisisZonasExcel() {
  const arr = _analisisZonasState.resultados || [];
  if (!arr.length) {
    alert("No hay resultados para exportar. Ejecute una búsqueda primero.");
    return;
  }
  if (typeof XLSX === "undefined") {
    alert("Biblioteca Excel no disponible.");
    return;
  }
  const anios = obtenerAniosAnalisisZonas();
  const filas = arr.map(function(row) {
    const o = {
      "Código": row.clave_zonah || row.codigo_zona_homogenea || "",
      "Descripción": row.descripcion_col_fracc || "",
      "Zona": row.zona || "",
      "Sector": row.sector || "",
      "Subsector": row.subsector || "",
      "Tipo": row.es_adicional ? (row.tipo_zona || "ADICIONAL") : "OFICIAL"
    };
    anios.forEach(function(an) {
      const val = row["valor_" + an];
      o[String(an) + " ($/m²)"] = val != null ? Number(val) : "";
    });
    if (row.variacion_pct != null) {
      o["Variación %"] = row.variacion_pct;
      o["Variación $/m²"] = row.variacion_abs;
    }
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Zonas homogéneas");
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, "zonas_homogeneas_" + fecha + ".xlsx");
}
window.exportarAnalisisZonasExcel = exportarAnalisisZonasExcel;

function analisisZonasWmsUrl() {
  return typeof POPUP_ZONA_GEONODE_WMS !== "undefined"
    ? POPUP_ZONA_GEONODE_WMS
    : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
}

function analisisZonasWmsLayer() {
  return typeof POPUP_ZONA_WMS_LAYER !== "undefined"
    ? POPUP_ZONA_WMS_LAYER
    : "zonas_homogeneas";
}

function analisisZonasEstiloZona() {
  return [
    new ol.style.Style({
      zIndex: 49,
      stroke: new ol.style.Stroke({
        color: "rgba(255,255,255,0.92)",
        width: 7,
        lineDash: [10, 6]
      })
    }),
    new ol.style.Style({
      zIndex: 50,
      stroke: new ol.style.Stroke({
        color: "#111827",
        width: 5,
        lineDash: [10, 6]
      })
    })
  ];
}

function analisisZonasAsegurarCanvasMapa() {
  const target = document.getElementById("analisisZonasMap");
  if (!target) return null;
  target.querySelector(".analisis-zonas-mapa-vacio")?.remove();
  let canvas = document.getElementById("analisisZonasMapCanvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.id = "analisisZonasMapCanvas";
    canvas.className = "analisis-zonas-mapa-canvas";
    target.appendChild(canvas);
  }
  return canvas;
}

function analisisZonasCrearCapasMapa() {
  return {
    base: new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        crossOrigin: "anonymous"
      })
    }),
    zonasWms: new ol.layer.Tile({
      visible: true,
      opacity: 0.55,
      zIndex: 6,
      source: new ol.source.TileWMS({
        url: analisisZonasWmsUrl(),
        params: {
          LAYERS: analisisZonasWmsLayer(),
          TILED: true,
          VERSION: "1.1.1",
          FORMAT: "image/png",
          TRANSPARENT: true
        },
        serverType: "geoserver",
        crossOrigin: "anonymous"
      })
    }),
    zonaVector: new ol.layer.Vector({
      visible: true,
      zIndex: 50,
      source: new ol.source.Vector(),
      style: analisisZonasEstiloZona()
    })
  };
}

function destruirMapaAnalisisZonas() {
  _analisisZonasMapReqId += 1;
  if (_analisisZonasMap) {
    _analisisZonasMap.setTarget(null);
    _analisisZonasMap = null;
  }
  _analisisZonasMapCapas = null;
  _analisisZonasMapCodigo = "";
  const target = document.getElementById("analisisZonasMap");
  if (target) {
    target.querySelector("#analisisZonasMapCanvas")?.remove();
    if (!target.querySelector(".analisis-zonas-mapa-vacio")) {
      const vacio = document.createElement("div");
      vacio.className = "analisis-zonas-mapa-vacio";
      vacio.textContent = "Seleccione una zona para ver su dibujo cartográfico.";
      target.appendChild(vacio);
    }
  }
  const estado = document.getElementById("analisisZonasMapEstado");
  if (estado) {
    estado.textContent = "";
    estado.className = "analisis-zonas-mapa-estado";
  }
}

function analisisZonasCentrarMapa(centroide) {
  if (!_analisisZonasMap || !_analisisZonasMapCapas) return;
  _analisisZonasMap.updateSize();
  const ext = _analisisZonasMapCapas.zonaVector.getSource().getExtent();
  if (ext && Number.isFinite(ext[0])) {
    let buffExt = ext;
    if (typeof ol.extent.buffer === "function") buffExt = ol.extent.buffer(ext, 80);
    _analisisZonasMap.getView().fit(buffExt, {
      padding: [24, 24, 24, 24],
      maxZoom: 17,
      duration: 200
    });
    return;
  }
  if (centroide?.lon != null && centroide?.lat != null) {
    _analisisZonasMap.getView().setCenter(ol.proj.fromLonLat([centroide.lon, centroide.lat]));
    _analisisZonasMap.getView().setZoom(15);
  }
}

function analisisZonasMostrarMapaVacio(mensaje) {
  destruirMapaAnalisisZonas();
  const target = document.getElementById("analisisZonasMap");
  if (target && mensaje) {
    const vacio = target.querySelector(".analisis-zonas-mapa-vacio");
    if (vacio) vacio.textContent = mensaje;
  }
}

async function actualizarMapaAnalisisZonas(reg) {
  const estado = document.getElementById("analisisZonasMapEstado");
  if (!reg) {
    analisisZonasMostrarMapaVacio("Seleccione una zona para ver su dibujo cartográfico.");
    return;
  }

  const codigo = String(reg.clave_zonah || reg.codigo_zona_homogenea || "").trim().toUpperCase();
  if (!codigo) {
    analisisZonasMostrarMapaVacio("La zona seleccionada no tiene código cartográfico.");
    return;
  }

  if (codigo === _analisisZonasMapCodigo && _analisisZonasMap) {
    analisisZonasCentrarMapa();
    return;
  }

  _analisisZonasMapCodigo = codigo;
  const reqId = ++_analisisZonasMapReqId;

  if (estado) {
    estado.textContent = "Cargando geometría de " + codigo + "…";
    estado.className = "analisis-zonas-mapa-estado";
  }

  analisisZonasAsegurarCanvasMapa();

  if (!_analisisZonasMap) {
    _analisisZonasMapCapas = analisisZonasCrearCapasMapa();
    _analisisZonasMap = new ol.Map({
      target: "analisisZonasMapCanvas",
      layers: [
        _analisisZonasMapCapas.base,
        _analisisZonasMapCapas.zonasWms,
        _analisisZonasMapCapas.zonaVector
      ],
      view: new ol.View({ center: ol.proj.fromLonLat([-116.97845271015251, 32.49868744466041]), zoom: 12 }),
      controls: []
    });
  }

  try {
    const r = await fetch(
      `${API}/padron/analisis/zonas-homogeneas/${encodeURIComponent(codigo)}/geometria?_=${Date.now()}`,
      { cache: "no-store", headers: typeof authHeaders === "function" ? authHeaders() : {} }
    );
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || r.statusText || "Error al consultar geometría");
    if (reqId !== _analisisZonasMapReqId || !_analisisZonasMap || !_analisisZonasMapCapas) return;

    const format = new ol.format.GeoJSON({
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });

    _analisisZonasMapCapas.zonaVector.getSource().clear();
    if (!data.geometry) throw new Error("Sin geometría cartográfica");

    const feats = format.readFeatures({
      type: "Feature",
      geometry: data.geometry,
      properties: { codigo: data.codigo || codigo }
    });
    _analisisZonasMapCapas.zonaVector.getSource().addFeatures(feats);

    analisisZonasCentrarMapa(data.centroide);
    _analisisZonasMap.render();

    if (estado) {
      const origen = data.origen ? " · " + data.origen : "";
      estado.textContent = "Zona " + codigo + origen;
      estado.className = "analisis-zonas-mapa-estado";
    }
  } catch (e) {
    if (reqId !== _analisisZonasMapReqId) return;
    _analisisZonasMapCodigo = "";
    if (_analisisZonasMapCapas) _analisisZonasMapCapas.zonaVector.getSource().clear();
    if (estado) {
      estado.textContent = e.message || "No se pudo cargar la geometría.";
      estado.className = "analisis-zonas-mapa-estado error";
    }
  }
}

async function capturarMapaAnalisisZonas() {
  if (!_analisisZonasMap) return null;
  _analisisZonasMap.updateSize();
  try {
    _analisisZonasMap.renderSync();
  } catch (e) {
    _analisisZonasMap.render();
  }
  await new Promise(function(resolve) { setTimeout(resolve, 450); });
  if (typeof capturarMapaOlParaPDF === "function") {
    return capturarMapaOlParaPDF(_analisisZonasMap, 10000);
  }
  if (typeof popupNumofCapturarMapaInstancia === "function") {
    return popupNumofCapturarMapaInstancia(_analisisZonasMap, 10000);
  }
  return null;
}

async function imprimirFichaAnalisisZonaHomogenea() {
  if (typeof abrirPreviewFichaAnalisisZonaHomogenea === "function") {
    return abrirPreviewFichaAnalisisZonaHomogenea();
  }
  alert("Vista previa de ficha no disponible.");
}
window.imprimirFichaAnalisisZonaHomogenea = imprimirFichaAnalisisZonaHomogenea;

/* --- Análisis tipo de tenencia (campo padron.condominio) --- */

const TIPOS_TENENCIA_UI = {
  C: { codigo: "C", nombre: "Condominio", desc: "Régimen en condominio." },
  P: { codigo: "P", nombre: "Privado", desc: "Propiedad privada individual." },
  G: { codigo: "G", nombre: "Gobierno / Pública", desc: "Propiedad de gobierno o sector público." },
  S: { codigo: "S", nombre: "Social", desc: "Vivienda o patrimonio social." },
  R: { codigo: "R", nombre: "Rústica", desc: "Propiedad de carácter rústico." },
  E: { codigo: "E", nombre: "Ejidal", desc: "Régimen ejidal o comunal." }
};

const TIPOS_CONDOMINIO_UI = TIPOS_TENENCIA_UI;

