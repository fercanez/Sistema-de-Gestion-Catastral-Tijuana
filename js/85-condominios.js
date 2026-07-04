function htmlOpcionesTenenciaPadron(valorSel, incluirVacio, vacioLabel) {
  let html = incluirVacio ? `<option value="">${escapeHtml(vacioLabel || "SELECCIONE...")}</option>` : "";
  Object.values(TIPOS_TENENCIA_UI).forEach(function(t) {
    const sel = String(valorSel || "").toUpperCase() === t.codigo ? " selected" : "";
    html += `<option value="${t.codigo}"${sel}>${t.codigo} — ${escapeHtml(t.nombre)}</option>`;
  });
  return html;
}
window.htmlOpcionesTenenciaPadron = htmlOpcionesTenenciaPadron;

let _analisisCondominiosState = {
  resumen: null,
  tiposPadron: [],
  catalogo: [],
  unidades: [],
  valorActivo: "",
  tipoActivo: "",
  totalCatalogo: 0,
  totalUnidades: 0,
  cargando: false,
  seleccion: {}
};

let _clasifMasivaState = {
  resultados: [],
  seleccion: {},
  total: 0
};

function tipoCondominioSeleccionado() {
  return (document.getElementById("analisisCondominiosTipo")?.value || "C").trim().toUpperCase();
}

function formatoNumeroEntero(n) {
  return Number(n || 0).toLocaleString("es-MX");
}

function etiquetaTipoCondominio(tipo) {
  const key = (tipo || "").toUpperCase();
  return TIPOS_TENENCIA_UI[key] || { codigo: key || "?", nombre: key || "Otro", desc: "" };
}

function pintarKpiCondominios(data, prefix) {
  const p = prefix || "condKpi";
  const elCond = document.getElementById(p === "condKpi" ? "condKpiCondominios" : "condTabTotalCondominios");
  const elUni = document.getElementById(p === "condKpi" ? "condKpiUnidades" : "condTabTotalUnidades");
  const elVal = document.getElementById(p === "condKpi" ? "condKpiValor" : "condTabValorTotal");
  const elAde = document.getElementById("condKpiAdeudo");
  const tipos = data?.total_tipos ?? data?.total_condominios;
  if (elCond) elCond.textContent = formatoNumeroEntero(tipos);
  if (elUni) elUni.textContent = formatoNumeroEntero(data?.total_unidades);
  if (elVal) elVal.textContent = formatoMoneda(data?.valor_total_2026);
  if (elAde) elAde.textContent = formatoMoneda(data?.adeudo_total);
}

function renderLeyendaTiposCondominio(tipos) {
  const box = document.getElementById("analisisCondominiosLeyenda");
  if (!box) return;
  const base = Object.values(TIPOS_TENENCIA_UI).map(t => (
    `<div class="condominios-leyenda-item"><b>${escapeHtml(t.codigo)}</b> ${escapeHtml(t.nombre)} — ${escapeHtml(t.desc)}</div>`
  )).join("");
  let extra = "";
  if ((tipos || []).length) {
    extra = `<div class="condominios-leyenda-padron">En su padrón: ${tipos.map(t =>
      `<span><b>${escapeHtml(t.tipo_codigo || t.tipo || "—")}</b> ${formatoNumeroEntero(t.unidades)}</span>`
    ).join(" · ")}</div>`;
  }
  box.innerHTML = base + extra;
}

async function cargarTiposCondominioPadron() {
  const r = await fetch(`${API}/padron/condominios/tipos?_=${Date.now()}`, {
    cache: "no-store",
    headers: typeof authHeaders === "function" ? authHeaders() : {}
  });
  if (!r.ok) throw new Error("No se pudo cargar el catálogo de tipos.");
  return r.json();
}

async function cargarResumenCondominiosPadron(tipo, extras) {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  const ex = extras || {};
  if (ex.prefijoClave) agregarParamsPrefijoClave(params, ex.prefijoClave);
  if (ex.colonia) params.set("colonia", ex.colonia);
  if (ex.texto) params.set("q", ex.texto);
  const r = await fetch(`${API}/padron/condominios/resumen?${params}`, {
    cache: "no-store",
    headers: typeof authHeaders === "function" ? authHeaders() : {}
  });
  if (!r.ok) throw new Error("No se pudo cargar el resumen de condominios.");
  return r.json();
}

async function cargarResumenCondominiosTab() {
  try {
    const data = await cargarResumenCondominiosPadron("C");
    _analisisCondominiosState.resumen = data;
    pintarKpiCondominios(data, "condTab");
  } catch (e) {
    console.warn("Resumen condominios tab:", e);
  }
}

function filtrosAnalisisCondominiosForm() {
  return {
    tipo: tipoCondominioSeleccionado(),
    colonia: (document.getElementById("analisisCondominiosColonia")?.value || "").trim(),
    prefijoClave: (document.getElementById("analisisCondominiosPrefijoClave")?.value || "").trim().toUpperCase(),
    texto: (document.getElementById("analisisCondominiosTexto")?.value || "").trim()
  };
}

function agregarParamsPrefijoClave(params, prefijoClave) {
  const pref = (prefijoClave || "").trim().toUpperCase();
  if (!pref) return "";
  params.set("clave_prefijo", pref);
  params.set("clave", pref);
  return pref;
}

function filtrarUnidadesPorPrefijoClave(rows, prefijoClave) {
  const pref = (prefijoClave || "").trim().toUpperCase();
  if (!pref) {
    return { rows: rows || [], descartados: 0, apiIgnoroPrefijo: false };
  }
  const src = rows || [];
  const filtradas = src.filter(function(row) {
    return String(row.clave_catastral || "").toUpperCase().startsWith(pref);
  });
  return {
    rows: filtradas,
    descartados: src.length - filtradas.length,
    apiIgnoroPrefijo: src.length > 0 && filtradas.length === 0
  };
}

function onCambioTipoCondominios() {
  _analisisCondominiosState.valorActivo = "";
  _analisisCondominiosState.tipoActivo = "";
  buscarCatalogoCondominios();
}
window.onCambioTipoCondominios = onCambioTipoCondominios;

function limpiarFiltrosAnalisisCondominios() {
  const sel = document.getElementById("analisisCondominiosTipo");
  if (sel) sel.value = "C";
  ["analisisCondominiosColonia", "analisisCondominiosTexto", "analisisCondominiosPrefijoClave"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  _analisisCondominiosState.valorActivo = "";
  _analisisCondominiosState.tipoActivo = "";
  const tit = document.getElementById("analisisCondominiosTituloUnidades");
  if (tit) tit.textContent = "Seleccione un tipo";
  buscarCatalogoCondominios();
}
window.limpiarFiltrosAnalisisCondominios = limpiarFiltrosAnalisisCondominios;

async function abrirModuloAnalisisCondominios() {
  document.getElementById("overlayAnalisisCondominios")?.classList.remove("oculto");
  document.body.classList.add("analisis-condominios-activo");
  try {
    const tiposData = await cargarTiposCondominioPadron();
    _analisisCondominiosState.tiposPadron = tiposData.tipos_en_padron || [];
    renderLeyendaTiposCondominio(_analisisCondominiosState.tiposPadron);
    _analisisCondominiosState.resumen = await cargarResumenCondominiosPadron(tipoCondominioSeleccionado());
    pintarKpiCondominios(_analisisCondominiosState.resumen, "condKpi");
  } catch (e) {
    console.warn(e);
  }
  await buscarCatalogoCondominios();
}
window.abrirModuloAnalisisCondominios = abrirModuloAnalisisCondominios;

function cerrarModuloAnalisisCondominios() {
  document.getElementById("overlayAnalisisCondominios")?.classList.add("oculto");
  document.body.classList.remove("analisis-condominios-activo");
}
window.cerrarModuloAnalisisCondominios = cerrarModuloAnalisisCondominios;

async function buscarCatalogoCondominios() {
  if (_analisisCondominiosState.cargando) return;
  _analisisCondominiosState.cargando = true;
  const f = filtrosAnalisisCondominiosForm();
  const cont = document.getElementById("analisisCondominiosCatalogo");
  if (cont) cont.innerHTML = `<div class="analisis-zonas-meta">Buscando tipos...</div>`;
  try {
    const params = new URLSearchParams({ limite: "500", tipo: f.tipo });
    agregarParamsPrefijoClave(params, f.prefijoClave);
    if (f.colonia) params.set("colonia", f.colonia);
    if (f.texto) params.set("q", f.texto);
    const [dataResumen, r] = await Promise.all([
      cargarResumenCondominiosPadron(f.tipo, f),
      fetch(`${API}/padron/condominios/catalogo?${params}`, {
        headers: typeof authHeaders === "function" ? authHeaders() : {}
      })
    ]);
    _analisisCondominiosState.resumen = dataResumen;
    pintarKpiCondominios(dataResumen, "condKpi");
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "Error al buscar tipos.");
    _analisisCondominiosState.catalogo = data.resultados || [];
    _analisisCondominiosState.totalCatalogo = data.total || _analisisCondominiosState.catalogo.length;
    renderCatalogoCondominios();
    await buscarUnidadesCondominio();
    const meta = document.getElementById("analisisCondominiosMeta");
    const etiq = etiquetaTipoCondominio(f.tipo === "TODOS" ? "" : f.tipo);
    if (meta) {
      const prefTxt = f.prefijoClave ? ` · prefijo ${f.prefijoClave}` : "";
      meta.textContent = `Filtro: ${f.tipo === "TODOS" ? "Todos" : etiq.nombre}${prefTxt} · ${formatoNumeroEntero(_analisisCondominiosState.totalCatalogo)} grupo(s)`;
    }
    const cnt = document.getElementById("analisisCondominiosContador");
    if (cnt) cnt.textContent = `${formatoNumeroEntero(dataResumen.total_unidades || 0)} predios`;
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="analisis-zonas-error">${escapeHtml(e.message)}</div>`;
  } finally {
    _analisisCondominiosState.cargando = false;
  }
}
window.buscarCatalogoCondominios = buscarCatalogoCondominios;

function renderCatalogoCondominios() {
  const cont = document.getElementById("analisisCondominiosCatalogo");
  if (!cont) return;
  const rows = _analisisCondominiosState.catalogo || [];
  if (!rows.length) {
    cont.innerHTML = `<div class="analisis-zonas-meta">Sin registros con ese tipo.</div>`;
    return;
  }
  const activo = _analisisCondominiosState.valorActivo || "";
  let html = `<table class="analisis-condominios-tabla"><thead><tr>
    <th>Tipo de tenencia</th><th>Código</th><th>Unidades</th><th>Colonias</th><th>Valor total</th><th>Adeudo</th>
  </tr></thead><tbody>`;
  rows.forEach(function(row, idx) {
    const val = row.condominio || row.valor_padron || "";
    const cls = val === activo ? "activo" : "";
    html += `<tr class="${cls}" onclick="seleccionarCondominioAnalisis(${idx})">
      <td><b>${escapeHtml(row.tipo_nombre || row.tipo || "")}</b><br><small>${escapeHtml(row.tipo_descripcion || "")}</small></td>
      <td>${escapeHtml(val || "—")}</td>
      <td>${formatoNumeroEntero(row.unidades)}</td>
      <td>${formatoNumeroEntero(row.colonias)}</td>
      <td>${formatoMoneda(row.valor_total)}</td>
      <td>${formatoMoneda(row.adeudo_total)}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  cont.innerHTML = html;
}

function seleccionarCondominioAnalisis(idx) {
  const row = (_analisisCondominiosState.catalogo || [])[idx];
  if (!row) return;
  _analisisCondominiosState.valorActivo = row.tipo === "NULL"
    ? "NULL"
    : (row.condominio || row.valor_padron || "");
  _analisisCondominiosState.tipoActivo = row.tipo || "";
  const sel = document.getElementById("analisisCondominiosTipo");
  if (sel && row.tipo) sel.value = row.tipo;
  renderCatalogoCondominios();
  buscarUnidadesCondominio();
}
window.seleccionarCondominioAnalisis = seleccionarCondominioAnalisis;

async function buscarUnidadesCondominio() {
  const f = filtrosAnalisisCondominiosForm();
  const valor = _analisisCondominiosState.valorActivo;
  const cont = document.getElementById("analisisCondominiosUnidades");
  if (cont) cont.innerHTML = `<div class="analisis-zonas-meta">Cargando unidades...</div>`;
  try {
    const params = new URLSearchParams({ limite: "5000", tipo: f.tipo });
    agregarParamsPrefijoClave(params, f.prefijoClave);
    if (valor) params.set("condominio", valor === "NULL" ? "NULL" : valor);
    else if (f.tipo && f.tipo !== "TODOS") params.set("condominio", f.tipo);
    if (f.colonia) params.set("colonia", f.colonia);
    if (f.texto) params.set("q", f.texto);
    const r = await fetch(`${API}/padron/condominios/unidades?${params}`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {},
      cache: "no-store"
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "Error al cargar unidades.");
    const filtrado = filtrarUnidadesPorPrefijoClave(data.resultados || [], f.prefijoClave);
    _analisisCondominiosState.unidades = filtrado.rows;
    _analisisCondominiosState.apiIgnoroPrefijoClave = filtrado.apiIgnoroPrefijo;
    _analisisCondominiosState.descartadosPrefijoClave = filtrado.descartados;

    let total = Number(data.total || filtrado.rows.length);
    if (f.prefijoClave) {
      if (data.clave_prefijo) {
        total = Number(data.total || filtrado.rows.length);
      } else if (filtrado.apiIgnoroPrefijo) {
        try {
          const qs = new URLSearchParams({ prefijo: f.prefijoClave, _: String(Date.now()) });
          if (f.tipo && f.tipo !== "TODOS") qs.set("tipo_actual", f.tipo);
          const rPrev = await fetch(`${API}/padron/tenencia/por-prefijo/resumen?${qs}`, {
            headers: typeof authHeaders === "function" ? authHeaders() : {},
            cache: "no-store"
          });
          const prev = await rPrev.json().catch(() => ({}));
          if (rPrev.ok) total = Number(prev.total || 0);
        } catch (_e) { /* usar total filtrado local */ }
      } else if (filtrado.descartados > 0) {
        total = filtrado.rows.length;
      }
    }
    _analisisCondominiosState.totalUnidades = total;
    renderUnidadesCondominio();
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="analisis-zonas-error">${escapeHtml(e.message)}</div>`;
  }
}
window.buscarUnidadesCondominio = buscarUnidadesCondominio;

function renderUnidadesCondominio() {
  const cont = document.getElementById("analisisCondominiosUnidades");
  const tit = document.getElementById("analisisCondominiosTituloUnidades");
  if (!cont) return;
  const rows = _analisisCondominiosState.unidades || [];
  const val = _analisisCondominiosState.valorActivo;
  const tipo = _analisisCondominiosState.tipoActivo || tipoCondominioSeleccionado();
  const etiq = etiquetaTipoCondominio(tipo);
  const prefActivo = (document.getElementById("analisisCondominiosPrefijoClave")?.value || "").trim().toUpperCase();
  if (tit) {
    const prefTxt = prefActivo ? ` · prefijo ${prefActivo}` : "";
    tit.textContent = val
      ? `${etiq.nombre} · ${val || "—"}${prefTxt} (${formatoNumeroEntero(_analisisCondominiosState.totalUnidades)})`
      : `${etiq.nombre}${prefTxt} (${formatoNumeroEntero(_analisisCondominiosState.totalUnidades)} predios)`;
  }
  if (!rows.length) {
    if (_analisisCondominiosState.apiIgnoroPrefijoClave && prefActivo) {
      cont.innerHTML = `<div class="analisis-zonas-error">La API no aplicó el prefijo «${escapeHtml(prefActivo)}». Suba <b>padron.py</b> y <b>catastro.js</b> al servidor, reinicie <b>catastro-tijuana-api</b> y recargue con Ctrl+F5. Verifique en /api/catastro-tijuana/ que aparezca <b>tenencia_prefijo_clave: true</b>.</div>`;
      return;
    }
    cont.innerHTML = `<div class="analisis-zonas-meta">Sin predios para el criterio seleccionado.</div>`;
    return;
  }
  const sel = _analisisCondominiosState.seleccion || {};
  let html = "";
  if (_analisisCondominiosState.descartadosPrefijoClave > 0) {
    html += `<div class="condominios-aviso-prefijo">Se descartaron ${formatoNumeroEntero(_analisisCondominiosState.descartadosPrefijoClave)} registro(s) que no empiezan por ${escapeHtml(prefActivo)} (la API aún no filtra por prefijo).</div>`;
  }
  html += `<div class="condominios-unidades-acciones">
    <button type="button" class="btn-busqueda-unica" onclick="toggleSeleccionUnidadesCondominio(true)">Marcar visibles</button>
    <button type="button" onclick="toggleSeleccionUnidadesCondominio(false)">Desmarcar</button>
    <button type="button" class="btn-busqueda-unica" onclick="abrirClasificacionCondominioMasivaDesdeUnidades()">Clasificar vertical/horizontal</button>
    <span class="perm-editar-catastro condominios-tenencia-masiva">
      <select id="analisisTenenciaAsignar">${htmlOpcionesTenenciaPadron("P", true, "Asignar tenencia…")}</select>
      <button type="button" class="btn-busqueda-unica" onclick="asignarTenenciaUnidadesSeleccionadas()">Asignar tenencia</button>
    </span>
  </div>`;
  html += `<table class="analisis-condominios-tabla analisis-condominios-tabla-unidades"><thead><tr>
    <th><input type="checkbox" onchange="toggleSeleccionUnidadesCondominio(this.checked)"></th>
    <th>Clave</th><th>Ten.</th><th>Nombre condominio</th><th>Modalidad</th><th>Titular</th><th>Ubicación</th><th>Int.</th><th>Valor 2026</th>
  </tr></thead><tbody>`;
  rows.forEach(function(row, idx) {
    const clave = row.clave_catastral || "";
    const checked = !!sel[clave];
    const ubic = [row.colonia, row.calle, row.numof].filter(Boolean).join(" · ");
    const interior = [row.numint, row.letra].filter(Boolean).join(" ");
    const modTxt = row.modalidad ? (etiquetaModalidadCondominio(row.modalidad)?.nombre || row.modalidad) : "—";
    const nomCond = row.nombre_condominio || "—";
    const tenTxt = row.tipo_nombre || etiquetaTipoCondominio(row.condominio || row.tipo).nombre;
    const tenCod = row.condominio || row.tipo || "—";
    html += `<tr class="analisis-cond-unidad-row${checked ? " activo" : ""}">
      <td onclick="event.stopPropagation()"><input type="checkbox" data-clave="${escapeHtml(clave)}" ${checked ? "checked" : ""} onchange="toggleSeleccionUnidadCondominio('${escapeHtml(clave)}', this.checked)"></td>
      <td onclick="abrirPredioCondominioIdx(${idx})"><b>${escapeHtml(clave)}</b></td>
      <td onclick="abrirPredioCondominioIdx(${idx})" title="${escapeHtml(tenTxt)}"><b>${escapeHtml(tenCod)}</b></td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(nomCond)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(modTxt)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(row.nombre_completo || "")}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(ubic)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${escapeHtml(interior)}</td>
      <td onclick="abrirPredioCondominioIdx(${idx})">${formatoMoneda(row.valor2026)}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  if (_analisisCondominiosState.totalUnidades > rows.length) {
    html += `<div class="analisis-zonas-meta">Mostrando ${rows.length} de ${formatoNumeroEntero(_analisisCondominiosState.totalUnidades)} predios.</div>`;
  }
  cont.innerHTML = html;
}

function toggleSeleccionUnidadCondominio(clave, on) {
  if (!_analisisCondominiosState.seleccion) _analisisCondominiosState.seleccion = {};
  if (on) _analisisCondominiosState.seleccion[clave] = true;
  else delete _analisisCondominiosState.seleccion[clave];
  renderUnidadesCondominio();
}
window.toggleSeleccionUnidadCondominio = toggleSeleccionUnidadCondominio;

function toggleSeleccionUnidadesCondominio(on) {
  const rows = _analisisCondominiosState.unidades || [];
  if (!_analisisCondominiosState.seleccion) _analisisCondominiosState.seleccion = {};
  rows.forEach(r => {
    const c = r.clave_catastral;
    if (!c) return;
    if (on) _analisisCondominiosState.seleccion[c] = true;
    else delete _analisisCondominiosState.seleccion[c];
  });
  renderUnidadesCondominio();
}
window.toggleSeleccionUnidadesCondominio = toggleSeleccionUnidadesCondominio;

function clavesSeleccionadasUnidadesCondominio() {
  return Object.keys(_analisisCondominiosState.seleccion || {});
}

async function asignarTenenciaUnidadesSeleccionadas() {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para asignar tenencia.");
    return;
  }
  const tenencia = (document.getElementById("analisisTenenciaAsignar")?.value || "").trim().toUpperCase();
  const claves = clavesSeleccionadasUnidadesCondominio();
  if (!tenencia) {
    alert("Seleccione el tipo de tenencia a asignar.");
    return;
  }
  if (!claves.length) {
    alert("Marque al menos un predio en la lista de unidades.");
    return;
  }
  const etiq = etiquetaTipoCondominio(tenencia).nombre;
  if (!confirm(`¿Asignar tenencia ${etiq} (${tenencia}) a ${claves.length} predio(s)?`)) return;
  try {
    const r = await fetch(`${API}/padron/tenencia/masiva`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ claves, tenencia, confirmar: true })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.mensaje || "No se pudo asignar tenencia.");
    alert(data.mensaje || `Actualizados: ${data.actualizadas || 0}`);
    _analisisCondominiosState.seleccion = {};
    await buscarCatalogoCondominios();
  } catch (e) {
    alert(e.message || "Error al asignar tenencia.");
  }
}
window.asignarTenenciaUnidadesSeleccionadas = asignarTenenciaUnidadesSeleccionadas;

async function asignarTenenciaPorPrefijoClave() {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para asignar tenencia.");
    return;
  }
  const f = filtrosAnalisisCondominiosForm();
  const prefijo = f.prefijoClave;
  if (!prefijo) {
    alert("Capture el prefijo de clave (ej. RU) en el campo «Prefijo de clave».");
    return;
  }
  const tenencia = (document.getElementById("analisisTenenciaAsignar")?.value || "R").trim().toUpperCase();
  if (!tenencia || tenencia === "") {
    alert("Seleccione el tipo de tenencia a asignar en el listado de unidades.");
    return;
  }
  const etiq = etiquetaTipoCondominio(tenencia).nombre;
  try {
    const qs = new URLSearchParams({ prefijo, _: String(Date.now()) });
    if (f.tipo && f.tipo !== "TODOS") qs.set("tipo_actual", f.tipo);
    const rPrev = await fetch(`${API}/padron/tenencia/por-prefijo/resumen?${qs}`, {
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    const prev = await rPrev.json().catch(() => ({}));
    if (!rPrev.ok) throw new Error(prev.detail || "No se pudo obtener vista previa.");
    const n = Number(prev.total || 0);
    if (!n) {
      alert(`No hay predios cuya clave empiece con «${prefijo}».`);
      return;
    }
    const muestra = (prev.muestra || []).slice(0, 8).map(m => m.clave_catastral).join(", ");
    const porTen = (prev.por_tenencia || []).map(t => `${t.tenencia || "?"}: ${formatoNumeroEntero(t.total)}`).join(" · ");
    const filtroTipo = f.tipo && f.tipo !== "TODOS" ? `\nSolo tenencia actual: ${f.tipo}.` : "";
    const msg = [
      `Se asignará ${etiq} (${tenencia}) a ${formatoNumeroEntero(n)} predio(s) con clave que empieza por ${prefijo}.`,
      porTen ? `Distribución actual: ${porTen}.` : "",
      muestra ? `Ejemplo: ${muestra}${(prev.muestra || []).length > 8 ? "…" : ""}` : "",
      filtroTipo,
      "",
      "¿Desea continuar?"
    ].filter(Boolean).join("\n");
    if (!confirm(msg)) return;

    const r = await fetch(`${API}/padron/tenencia/por-prefijo`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        prefijo,
        tenencia,
        tipo_actual: f.tipo && f.tipo !== "TODOS" ? f.tipo : "",
        confirmar: true
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.mensaje || "No se pudo asignar tenencia.");
    alert(data.mensaje || `Actualizados: ${data.actualizadas || 0}`);
    await buscarCatalogoCondominios();
  } catch (e) {
    alert(e.message || "Error al asignar tenencia por prefijo.");
  }
}
window.asignarTenenciaPorPrefijoClave = asignarTenenciaPorPrefijoClave;

function abrirClasificacionCondominioMasivaDesdeUnidades() {
  const claves = clavesSeleccionadasUnidadesCondominio();
  if (!claves.length) {
    alert("Marque al menos un predio en la lista de unidades.");
    return;
  }
  abrirClasificacionCondominioMasiva(claves.join("\n"), claves);
}
window.abrirClasificacionCondominioMasivaDesdeUnidades = abrirClasificacionCondominioMasivaDesdeUnidades;

function asegurarModalClasificacionCondominioMasiva() {
  const versionModal = "v2";
  const existente = document.getElementById("modalClasificacionCondominioMasiva");
  if (existente && existente.dataset.version !== versionModal) {
    existente.remove();
  }
  if (document.getElementById("modalClasificacionCondominioMasiva")) {
    document.getElementById("modalClasificacionCondominioMasiva").classList.add("clasif-masiva-overlay");
    return;
  }
  const modal = document.createElement("div");
  modal.id = "modalClasificacionCondominioMasiva";
  modal.dataset.version = versionModal;
  modal.className = "coprop-overlay clasif-masiva-overlay oculto";
  modal.innerHTML = `
    <div class="coprop-modal clasif-masiva-modal">
      <div class="coprop-head">
        <h3>🏢 Clasificación masiva de condominios</h3>
        <button type="button" class="coprop-close-btn" onclick="cerrarClasificacionCondominioMasiva()" title="Cerrar">×</button>
      </div>
      <div class="clasif-masiva-body">
        <div class="clasif-masiva-buscar">
          <div class="section-label">Buscar predios en padrón</div>
          <label class="input-label-mini">Claves (una por línea, coma o espacio)</label>
          <textarea id="clasifMasivaClaves" rows="3" placeholder="PA504013&#10;AL032006&#10;AL032066"></textarea>
          <small class="clasif-masiva-ayuda">Si captura claves aquí, solo se buscarán esas claves exactas (se ignoran prefijo y demás filtros).</small>
          <div class="clasif-masiva-grid">
            <div>
              <label class="input-label-mini">Prefijo de clave</label>
              <input id="clasifMasivaPrefijo" type="text" placeholder="PA504">
            </div>
            <div>
              <label class="input-label-mini">Nombre condominio</label>
              <input id="clasifMasivaBuscarNombre" type="text" list="clasifMasivaNombresLista" placeholder="Buscar por nombre asignado">
              <datalist id="clasifMasivaNombresLista"></datalist>
            </div>
          </div>
          <div class="clasif-masiva-grid">
            <div><label class="input-label-mini">Colonia</label><input id="clasifMasivaColonia" type="text"></div>
            <div><label class="input-label-mini">Calle</label><input id="clasifMasivaCalle" type="text"></div>
            <div><label class="input-label-mini">Número</label><input id="clasifMasivaNumof" type="text"></div>
          </div>
          <label class="input-label-mini">Texto libre (clave, titular, calle, colonia, nombre condominio)</label>
          <input id="clasifMasivaQ" type="text" placeholder="Filtro general">
          <label class="clasif-masiva-filtro-c"><input type="checkbox" id="clasifMasivaSoloC"> Solo predios con <b>C</b> en padrón fiscal</label>
          <div class="clasif-masiva-acciones">
            <button type="button" class="coprop-btn" onclick="buscarPrediosClasificacionMasiva()">Buscar predios</button>
            <button type="button" class="coprop-btn sec" onclick="limpiarBusquedaClasificacionMasiva()">Limpiar</button>
          </div>
        </div>
        <div class="clasif-masiva-resultados">
          <div class="clasif-masiva-resultados-head">
            <span id="clasifMasivaContador">0 predio(s)</span>
            <div>
              <button type="button" onclick="toggleSeleccionTodasClasifMasiva(true)">Marcar todas</button>
              <button type="button" onclick="toggleSeleccionTodasClasifMasiva(false)">Desmarcar</button>
            </div>
          </div>
          <div id="clasifMasivaTabla" class="clasif-masiva-tabla-wrap">Busque predios para seleccionarlos.</div>
        </div>
        <div class="clasif-masiva-aplicar">
          <div class="section-label">Aplicar a seleccionados</div>
          <label class="input-label-mini">Nombre del condominio</label>
          <input id="clasifMasivaNombreAplicar" type="text" list="clasifMasivaNombresLista" placeholder="Nombre común del conjunto">
          <label class="input-label-mini">Modalidad</label>
          <select id="clasifMasivaModalidadAplicar">
            <option value="__NO_CAMBIAR__">— No cambiar modalidad —</option>
            <option value="">Sin clasificar (limpiar)</option>
            <option value="HORIZONTAL">Horizontal</option>
            <option value="VERTICAL">Vertical</option>
          </select>
          <div class="clasif-masiva-acciones">
            <button type="button" class="coprop-btn ok" onclick="aplicarClasificacionCondominioMasiva()">Aplicar clasificación masiva</button>
          </div>
          <div id="clasifMasivaMsg" class="coprop-msg"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function abrirClasificacionCondominioMasiva(clavesPrefill = "", clavesSeleccionInicial = null) {
  if (!puedeEditarCatastro()) {
    alert("Su rol no tiene permiso para clasificar condominios.");
    return;
  }
  asegurarModalClasificacionCondominioMasiva();
  limpiarBusquedaClasificacionMasiva(false);
  _clasifMasivaState = {
    resultados: [],
    seleccion: {},
    total: 0,
    seleccionInicial: Array.isArray(clavesSeleccionInicial) ? clavesSeleccionInicial.map(c => String(c || "").trim().toUpperCase()).filter(Boolean) : null
  };
  if (clavesPrefill) {
    document.getElementById("clasifMasivaClaves").value = clavesPrefill;
  }
  document.getElementById("modalClasificacionCondominioMasiva").classList.remove("oculto");
  cargarSugerenciasNombreCondominio();
  if (clavesPrefill) buscarPrediosClasificacionMasiva();
}
window.abrirClasificacionCondominioMasiva = abrirClasificacionCondominioMasiva;

function cerrarClasificacionCondominioMasiva() {
  document.getElementById("modalClasificacionCondominioMasiva")?.classList.add("oculto");
}
window.cerrarClasificacionCondominioMasiva = cerrarClasificacionCondominioMasiva;

function limpiarBusquedaClasificacionMasiva(limpiarClaves = true) {
  const ids = ["clasifMasivaPrefijo", "clasifMasivaBuscarNombre", "clasifMasivaColonia", "clasifMasivaCalle", "clasifMasivaNumof", "clasifMasivaQ"];
  if (limpiarClaves) ids.unshift("clasifMasivaClaves");
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  _clasifMasivaState = { resultados: [], seleccion: {}, total: 0, seleccionInicial: null };
  renderResultadosClasificacionMasiva();
}
window.limpiarBusquedaClasificacionMasiva = limpiarBusquedaClasificacionMasiva;

async function buscarPrediosClasificacionMasiva() {
  const cont = document.getElementById("clasifMasivaTabla");
  if (cont) cont.innerHTML = "Buscando...";
  const clavesTexto = (document.getElementById("clasifMasivaClaves")?.value || "").trim();
  const payload = {
    solo_regimen_c: !!document.getElementById("clasifMasivaSoloC")?.checked,
    limite: 2000
  };
  if (clavesTexto) {
    payload.claves_texto = clavesTexto;
    payload.solo_regimen_c = false;
  } else {
    payload.clave_prefijo = document.getElementById("clasifMasivaPrefijo")?.value || "";
    payload.nombre_condominio = document.getElementById("clasifMasivaBuscarNombre")?.value || "";
    payload.colonia = document.getElementById("clasifMasivaColonia")?.value || "";
    payload.calle = document.getElementById("clasifMasivaCalle")?.value || "";
    payload.numof = document.getElementById("clasifMasivaNumof")?.value || "";
    payload.q = document.getElementById("clasifMasivaQ")?.value || "";
  }
  try {
    const r = await fetch(`${API}/condominios/clasificacion/buscar`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo buscar predios."));
    _clasifMasivaState.resultados = data.resultados || [];
    _clasifMasivaState.total = data.total || _clasifMasivaState.resultados.length;
    _clasifMasivaState.seleccion = {};
    const seleccionInicial = _clasifMasivaState.seleccionInicial;
    const clavesSolicitadas = clavesTexto
      ? clavesTexto.split(/[\s,;|\n\r\t]+/).map(c => c.trim().toUpperCase()).filter(Boolean)
      : [];
    if (seleccionInicial?.length) {
      const permitidas = new Set(seleccionInicial);
      _clasifMasivaState.resultados.forEach(row => {
        const c = String(row.clave_catastral || "").trim().toUpperCase();
        if (permitidas.has(c)) _clasifMasivaState.seleccion[row.clave_catastral] = true;
      });
      _clasifMasivaState.seleccionInicial = null;
    } else if (clavesSolicitadas.length) {
      const permitidas = new Set(clavesSolicitadas);
      _clasifMasivaState.resultados.forEach(row => {
        const c = String(row.clave_catastral || "").trim().toUpperCase();
        if (permitidas.has(c)) _clasifMasivaState.seleccion[row.clave_catastral] = true;
      });
    } else {
      _clasifMasivaState.resultados.forEach(row => {
        if (row.clave_catastral) _clasifMasivaState.seleccion[row.clave_catastral] = true;
      });
    }
    if (clavesSolicitadas.length) {
      const encontradas = new Set(_clasifMasivaState.resultados.map(r => String(r.clave_catastral || "").trim().toUpperCase()));
      _clasifMasivaState.clavesFaltantes = clavesSolicitadas.filter(c => !encontradas.has(c));
    } else {
      _clasifMasivaState.clavesFaltantes = [];
    }
    renderResultadosClasificacionMasiva();
  } catch (e) {
    if (cont) cont.innerHTML = `<div class="coprop-msg error">${escapeHtml(e.message)}</div>`;
  }
}
window.buscarPrediosClasificacionMasiva = buscarPrediosClasificacionMasiva;

function renderResultadosClasificacionMasiva() {
  const cont = document.getElementById("clasifMasivaTabla");
  const cnt = document.getElementById("clasifMasivaContador");
  const rows = _clasifMasivaState.resultados || [];
  const sel = _clasifMasivaState.seleccion || {};
  const marcadas = Object.keys(sel).length;
  if (cnt) cnt.textContent = `${marcadas} seleccionada(s) · ${rows.length} mostradas · ${_clasifMasivaState.total || rows.length} total`;
  if (!cont) return;
  if (!rows.length) {
    cont.innerHTML = `<div class="analisis-zonas-meta">Sin resultados. Ajuste criterios o pegue claves directamente.</div>`;
    return;
  }
  let html = `<table class="analisis-condominios-tabla"><thead><tr>
    <th></th><th>Clave</th><th>Nombre condominio</th><th>Modalidad</th><th>Titular</th><th>Ubicación</th>
  </tr></thead><tbody>`;
  rows.forEach(row => {
    const clave = row.clave_catastral || "";
    const checked = !!sel[clave];
    const ubic = [row.colonia, row.calle, row.numof].filter(Boolean).join(" · ");
    const mod = row.modalidad ? (etiquetaModalidadCondominio(row.modalidad)?.nombre || row.modalidad) : "—";
    html += `<tr class="${checked ? "activo" : ""}">
      <td><input type="checkbox" ${checked ? "checked" : ""} onchange="toggleSeleccionClasifMasiva('${escapeHtml(clave)}', this.checked)"></td>
      <td><b>${escapeHtml(clave)}</b></td>
      <td>${escapeHtml(row.nombre_condominio || "—")}</td>
      <td>${escapeHtml(mod)}</td>
      <td>${escapeHtml(row.nombre_completo || "")}</td>
      <td>${escapeHtml(ubic)}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  if ((_clasifMasivaState.total || 0) > rows.length) {
    html += `<div class="analisis-zonas-meta">Mostrando ${rows.length} de ${formatoNumeroEntero(_clasifMasivaState.total)}. Refine la búsqueda si falta alguna clave.</div>`;
  }
  const faltantes = _clasifMasivaState.clavesFaltantes || [];
  if (faltantes.length) {
    html += `<div class="analisis-zonas-meta clasif-masiva-faltantes">No encontradas en padrón: ${faltantes.map(c => escapeHtml(c)).join(", ")}</div>`;
  }
  cont.innerHTML = html;
}

function toggleSeleccionClasifMasiva(clave, on) {
  if (!_clasifMasivaState.seleccion) _clasifMasivaState.seleccion = {};
  if (on) _clasifMasivaState.seleccion[clave] = true;
  else delete _clasifMasivaState.seleccion[clave];
  renderResultadosClasificacionMasiva();
}
window.toggleSeleccionClasifMasiva = toggleSeleccionClasifMasiva;

function toggleSeleccionTodasClasifMasiva(on) {
  (_clasifMasivaState.resultados || []).forEach(row => {
    const c = row.clave_catastral;
    if (!c) return;
    if (on) _clasifMasivaState.seleccion[c] = true;
    else delete _clasifMasivaState.seleccion[c];
  });
  renderResultadosClasificacionMasiva();
}
window.toggleSeleccionTodasClasifMasiva = toggleSeleccionTodasClasifMasiva;

async function aplicarClasificacionCondominioMasiva() {
  const claves = Object.keys(_clasifMasivaState.seleccion || {});
  if (!claves.length) {
    msgCoprop("clasifMasivaMsg", "Seleccione al menos un predio.", false);
    return;
  }
  const modalidadSel = document.getElementById("clasifMasivaModalidadAplicar")?.value ?? "__NO_CAMBIAR__";
  const nombre = document.getElementById("clasifMasivaNombreAplicar")?.value?.trim() || "";
  const cambiaModalidad = modalidadSel !== "__NO_CAMBIAR__";
  if (!cambiaModalidad && !nombre) {
    msgCoprop("clasifMasivaMsg", "Indique nombre de condominio y/o modalidad.", false);
    return;
  }
  if (!confirm(`¿Aplicar clasificación a ${claves.length} predio(s)?`)) return;
  const body = { claves };
  if (cambiaModalidad) body.modalidad = modalidadSel;
  if (nombre) body.nombre_condominio = nombre;
  try {
    const r = await fetch(`${API}/condominios/clasificacion/masiva`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(extraerMensajeApi(data, "No se pudo aplicar la clasificación masiva."));
    msgCoprop("clasifMasivaMsg", data.mensaje || "Clasificación aplicada.", true);
    await buscarPrediosClasificacionMasiva();
    if (typeof buscarUnidadesCondominio === "function") buscarUnidadesCondominio();
    if (copropEstado.clave && claves.includes(copropEstado.clave)) {
      await cargarCopropietariosPredio(copropEstado.clave);
    }
  } catch (e) {
    msgCoprop("clasifMasivaMsg", e.message || "Error en clasificación masiva.", false);
  }
}
window.aplicarClasificacionCondominioMasiva = aplicarClasificacionCondominioMasiva;


