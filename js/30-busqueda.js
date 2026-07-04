function exportarResultadosExcel() {
  const datos = gridEstado.filtrados && gridEstado.filtrados.length
    ? gridEstado.filtrados
    : (gridEstado.todos || []);

  if (!datos.length) {
    alert("No hay resultados para exportar.");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("No se pudo cargar la librería de Excel. Revisa tu conexión a internet.");
    return;
  }

  const columnas = [
    { campo: "clave_catastral", titulo: "Clave catastral" },
    { campo: "nombre_completo", titulo: "Nombre / Razón social" },
    { campo: "delegacion", titulo: "Delegación" },
    { campo: "colonia", titulo: "Colonia" },
    { campo: "calle", titulo: "Calle" },
    { campo: "numof", titulo: "Número oficial" },
    { campo: "zona_homogenea", titulo: "Zona homogénea" },
    { campo: "valor2026", titulo: "Valor 2026" },
    { campo: "sup_documental", titulo: "Superficie documental" },
    { campo: "id_tasa", titulo: "ID tasa" },
    { campo: "porcentaje_tasa", titulo: "Porcentaje tasa" },
    { campo: "condominio", titulo: "Condominio" },
    { campo: "descripcion_uso", titulo: "Uso predial" },
    { campo: "dibujado", titulo: "Dibujado en cartografía" }
  ].filter(function(col) {
    if (col.campo !== "zona_homogenea") return true;
    return typeof puedeVerDatosZonaHomogenea === "function" && puedeVerDatosZonaHomogenea();
  });

  const filas = datos.map(p => {
    const fila = {};
    columnas.forEach(col => {
      let valor = p[col.campo];

      if (col.campo === "dibujado") {
        valor = valor ? "DIBUJADO" : "SIN GEOMETRÍA";
      }

      if (valor === null || valor === undefined) {
        valor = "";
      }

      fila[col.titulo] = valor;
    });
    return fila;
  });

  const ws = XLSX.utils.json_to_sheet(filas);

  ws["!cols"] = columnas.map(col => ({
    wch: Math.max(14, col.titulo.length + 2)
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");

  // Hoja de resumen para conservar el total real del backend
  const resumen = [{
    "Total encontrado": gridEstado.totalReal || datos.length,
    "Registros cargados/exportados": datos.length,
    "Nota": (gridEstado.totalReal && gridEstado.totalReal > datos.length)
      ? "El total real es mayor que los registros cargados en la tabla."
      : "Exportación completa de los registros cargados."
  }];
  const wsResumen = XLSX.utils.json_to_sheet(resumen);
  wsResumen["!cols"] = [{ wch: 20 }, { wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  const fecha = new Date();
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  const hh = String(fecha.getHours()).padStart(2, "0");
  const mi = String(fecha.getMinutes()).padStart(2, "0");

  XLSX.writeFile(wb, `resultados_catastro_${yyyy}${mm}${dd}_${hh}${mi}.xlsx`);
}

// Alias para compatibilidad con botones anteriores
function exportarResultadosCSV() {
  exportarResultadosExcel();
}



/* --- v16: contador + búsqueda con fallback seguro --- */
function deduplicarResultadosPadron(resultados) {
  const vistos = new Map();
  (resultados || []).forEach(r => {
    const clave = String(r.clave_catastral || "").trim().toUpperCase();
    if (!clave) return;
    vistos.set(clave, r);
  });
  return Array.from(vistos.values());
}
window.deduplicarResultadosPadron = deduplicarResultadosPadron;

function detectarTipoBusquedaActiva() {
  const clave = (document.getElementById("claveInput")?.value || "").trim();
  const nombre = (document.getElementById("nombreInput")?.value || "").trim();
  const calle = (document.getElementById("calleInput")?.value || "").trim();
  const numero = (document.getElementById("numeroInput")?.value || "").trim();
  const colonia = (document.getElementById("coloniaInput")?.value || "").trim();
  const folio = (document.getElementById("folioRealInput")?.value || "").trim();

  if (folio) return "folio";
  if (clave) return "clave";
  if (nombre) return "nombre";
  if (calle || numero || colonia) return "direccion";
  return "general";
}

function actualizarContadorBusqueda(total, tipo = null, cargados = null) {
  const totalNum = Number(total || 0);
  const cargadosNum = Number(cargados ?? totalNum);

  let texto = totalNum === 1
    ? "1 predio encontrado"
    : `${totalNum.toLocaleString("es-MX")} predios encontrados`;

  if (totalNum > cargadosNum) {
    texto += ` · cargados ${cargadosNum.toLocaleString("es-MX")}`;
  }

  const general = document.getElementById("contadorBusquedaGeneral");
  if (general) {
    general.innerText = texto;
    general.classList.toggle("contador-ok", totalNum > 0);
    general.classList.toggle("contador-warn", totalNum === 0);
  }

  ["contadorClave", "contadorNombre", "contadorDireccion"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = texto;
    el.classList.toggle("contador-ok", totalNum > 0);
    el.classList.toggle("contador-warn", totalNum === 0);
  });
}

function mostrarAvisoTotalResultados(total, cargados, limiteUsado = null) {
  const contenedorResultados = document.getElementById("resultadosBusqueda");
  if (!contenedorResultados) return;

  let aviso = document.getElementById("avisoTotalResultados");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "avisoTotalResultados";
    aviso.className = "aviso-total-resultados";
    contenedorResultados.parentNode.insertBefore(aviso, contenedorResultados);
  }

  const totalNum = Number(total || 0);
  const cargadosNum = Number(cargados || 0);

  if (totalNum <= 0) {
    aviso.style.display = "none";
    aviso.innerHTML = "";
    return;
  }

  aviso.style.display = "block";
  let extra = limiteUsado ? ` · límite usado: <b>${Number(limiteUsado).toLocaleString("es-MX")}</b>` : "";

  if (totalNum > cargadosNum) {
    aviso.innerHTML = `Total encontrado: <b>${totalNum.toLocaleString("es-MX")}</b> · cargados en tabla: <b>${cargadosNum.toLocaleString("es-MX")}</b>${extra}.`;
  } else {
    aviso.innerHTML = `Total encontrado: <b>${totalNum.toLocaleString("es-MX")}</b>${extra}.`;
  }
}

function construirUrlBusqueda(clave, nombre, colonia, calle, numero, folio, limite) {
  return `${API}/padron/busqueda-avanzada?` +
    `clave=${encodeURIComponent(clave)}` +
    `&nombre=${encodeURIComponent(nombre)}` +
    `&colonia=${encodeURIComponent(colonia)}` +
    `&calle=${encodeURIComponent(calle)}` +
    `&numero=${encodeURIComponent(numero)}` +
    `&folio_real=${encodeURIComponent(folio)}` +
    `&limite=${limite}`;
}

async function pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, folio, limite) {
  const url = construirUrlBusqueda(clave, nombre, colonia, calle, numero, folio, limite);
  const r = await fetch(url, { cache: "no-store", headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  data.__limite_usado = limite;
  return data;
}

function limpiarBusquedaCatastral() {
  ["claveInput", "nombreInput", "coloniaInput", "calleInput", "numeroInput", "folioRealInput"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const div = document.getElementById("resultadosBusqueda");
  if (div) div.innerHTML = "";

  const aviso = document.getElementById("avisoTotalResultados");
  if (aviso) {
    aviso.style.display = "none";
    aviso.innerHTML = "";
  }

  const textoInicial = "Sin búsqueda realizada";
  const general = document.getElementById("contadorBusquedaGeneral");
  if (general) {
    general.innerText = textoInicial;
    general.classList.remove("contador-ok", "contador-warn");
  }
  ["contadorClave", "contadorNombre", "contadorDireccion"].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = textoInicial;
    el.classList.remove("contador-ok", "contador-warn");
  });

  if (typeof limpiarResultadosZoom === "function") limpiarResultadosZoom();
  if (typeof vectorSource !== "undefined" && vectorSource) vectorSource.clear();
  if (typeof renderizarTablaResultados === "function") renderizarTablaResultados([], 0);
  if (typeof cerrarTablaResultados === "function") cerrarTablaResultados();

  if (typeof seleccionPredioSeq !== "undefined") seleccionPredioSeq++;
  if (typeof claveSeleccionadaActual !== "undefined") claveSeleccionadaActual = "";
  window.predioSeleccionado = null;
  if (window._cacheFeaturePredioPorClave) window._cacheFeaturePredioPorClave = {};
  if (window._cacheGeojsonPorClave) window._cacheGeojsonPorClave = {};

  if (typeof cerrarPopupPredioWorkspace === "function") cerrarPopupPredioWorkspace();
  if (typeof cerrarFichaFlotante === "function") cerrarFichaFlotante();
  if (typeof destruirPopupNumerosOficiales === "function") destruirPopupNumerosOficiales();

  const ficha = document.getElementById("ficha");
  if (ficha) {
    ficha.innerHTML = `<div class="ficha-vacia-consulta">Use la búsqueda catastral para localizar un predio.</div>`;
  }

  if (typeof actualizarBreadcrumbPredio === "function") actualizarBreadcrumbPredio(null);
  if (typeof sincronizarClavesMovimientoConPredioActivo === "function") {
    sincronizarClavesMovimientoConPredioActivo();
  }
  if (typeof limpiarMovimientosPredioAcciones === "function") limpiarMovimientosPredioAcciones();

  document.getElementById("claveInput")?.focus();
}

async function buscarAvanzado() {
  const clave = document.getElementById("claveInput").value.trim();
  const nombre = document.getElementById("nombreInput").value.trim();
  const colonia = document.getElementById("coloniaInput").value.trim();
  const calle = document.getElementById("calleInput").value.trim();
  const numero = document.getElementById("numeroInput").value.trim();
  const folio = document.getElementById("folioRealInput")?.value?.trim().replace(/\s+/g, "") || "";

  const tipoBusqueda = detectarTipoBusquedaActiva();
  const soloClaveExacta = clave.length >= 8 && !nombre && !colonia && !calle && !numero && !folio;

  if (typeof seleccionPredioSeq !== "undefined") seleccionPredioSeq++;
  if (soloClaveExacta && clave) {
    mostrarFichaCargando(clave.trim().toUpperCase());
    if (typeof limpiarResultadosZoom === "function") limpiarResultadosZoom();
    if (typeof vectorSource !== "undefined" && vectorSource) vectorSource.clear();
  }
  limpiarContornoSeleccion();

  try {
    let data = null;
    const limiteInicial = soloClaveExacta ? 1 : 5000;

    try {
      data = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, folio, limiteInicial);
    } catch (e5000) {
      if (soloClaveExacta) throw e5000;
      console.warn("Búsqueda con límite 5000 falló; reintentando con 100.", e5000);
      data = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, folio, 100);
    }

    let resultados = deduplicarResultadosPadron(data.resultados || []);
    let total = Number(data.total ?? resultados.length ?? 0);
    if (resultados.length < total && clave && !nombre && !colonia && !calle && !numero) {
      total = resultados.length;
    }

    // Si el backend respondió 0 con 5000, reintenta con 100 para evitar falso negativo.
    if (!soloClaveExacta && data.__limite_usado === 5000 && total === 0 && resultados.length === 0) {
      try {
        const data100 = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, folio, 100);
        if ((data100.resultados || []).length > 0 || Number(data100.total || 0) > 0) {
          data = data100;
          resultados = deduplicarResultadosPadron(data100.resultados || []);
          total = Number(data100.total ?? resultados.length ?? 0);
          if (resultados.length < total && clave && !nombre && !colonia && !calle && !numero) {
            total = resultados.length;
          }
        }
      } catch (e100) {
        console.warn("Reintento con 100 también falló.", e100);
      }
    }

    actualizarContadorBusqueda(total, tipoBusqueda, resultados.length);
    mostrarAvisoTotalResultados(total, resultados.length, data.__limite_usado);

    const div = document.getElementById("resultadosBusqueda");
    div.innerHTML = "";

    if (!resultados || resultados.length === 0) {
      div.innerHTML = "<p>Sin resultados.</p>";
      renderizarTablaResultados([], total);
      if (soloClaveExacta && clave) {
        const fichaEl = document.getElementById("ficha");
        if (fichaEl) {
          fichaEl.innerHTML = `<div class="ficha-section"><b>Sin resultados</b> para la clave ${val(clave.trim().toUpperCase())}.</div>`;
        }
      }
      return;
    }

    renderizarTablaResultados(resultados, total);
    await zoomAResultadosBusqueda(resultados);

    const LIMITE_LISTA_LATERAL = 3;
    resultados.slice(0, LIMITE_LISTA_LATERAL).forEach(p => {
      const item = document.createElement("div");
      item.className = "resultado-item";
      item.innerHTML = `
        <b>${p.clave_catastral}</b><br>
        <strong>${p.nombre_completo || ""}</strong><br>
        <small>${p.colonia || ""}${p.calle ? " · " + p.calle : ""}${p.numof ? " #" + p.numof : ""}</small>
      `;

      item.onclick = async () => {
        document.getElementById("claveInput").value = p.clave_catastral;
        await cargarDesdeBusqueda(p);
      };

      div.appendChild(item);
    });

    if (resultados.length > LIMITE_LISTA_LATERAL) {
      const nota = document.createElement("div");
      nota.className = "aviso-total-resultados";
      nota.style.display = "block";
      nota.innerHTML = `Mostrando <b>${LIMITE_LISTA_LATERAL}</b> de <b>${resultados.length.toLocaleString("es-MX")}</b> en el panel. Usa la tabla inferior para ver todos.`;
      div.appendChild(nota);
    }

    if (document.getElementById("chkLeyenda")?.checked !== false) {
      aplicarVisibilidadLeyendaIntegrada(true);
    }

  } catch(e) {
    console.error("Error en búsqueda avanzada:", e);
    actualizarContadorBusqueda(0, tipoBusqueda, 0);
    mostrarAvisoTotalResultados(0, 0);
    if (soloClaveExacta && clave) {
      const fichaEl = document.getElementById("ficha");
      if (fichaEl) {
        fichaEl.innerHTML = `<div class="ficha-section"><b>Error al consultar</b> la clave ${val(clave.trim().toUpperCase())}. Intente de nuevo.</div>`;
      }
    }
  }
}

function registrarEnterBusquedas() {
  ["claveInput", "nombreInput", "coloniaInput", "calleInput", "numeroInput", "folioRealInput"].forEach(function(id) {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("keyup", function(e) {
        if (e.key === "Enter") buscarAvanzado();
      });
    }
  });
}

window.limpiarBusquedaCatastral = limpiarBusquedaCatastral;
window.buscarAvanzado = buscarAvanzado;

async function fetchFeaturePredioOpcional(url) {
  try {
    const res = await fetch(url, { cache: "no-store", headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function fichaDatosCompletos(feature, claveNorm) {
  const p = feature?.properties || feature;
  if (!p || typeof p !== "object") return false;
  const clave = String(p.clave_catastral || "").trim().toUpperCase();
  if (clave && clave !== claveNorm) return false;
  return !!(p.nombre_completo || p.propietario || p.descripcion_uso
    || p.tiene_expediente !== undefined || p.tiene_documentos !== undefined);
}

function mostrarFichaCargando(claveNorm) {
  const clave = val(claveNorm);
  const html = `
    <div class="ficha-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>Ficha predial institucional</span>
      <span style="font-style:italic;font-size:14px;">${clave}</span>
    </div>
    <div class="ficha-section ficha-cargando">
      <div class="ficha-row"><b>Consultando predio…</b><span>${clave}</span></div>
    </div>`;
  const ficha = document.getElementById("ficha");
  if (ficha) ficha.innerHTML = html;
  if (typeof pintarFichaFlotante === "function") {
    pintarFichaFlotante({ clave_catastral: claveNorm, __cargando: true });
  }
}

function pintarFichaResumenBusqueda(registro) {
  if (!registro) return;
  const p = Object.assign({}, registro);
  p.clave_catastral = String(p.clave_catastral || "").trim().toUpperCase();
  if (typeof pintarFicha === "function") pintarFicha(p);
  else if (typeof pintarFichaFlotante === "function") pintarFichaFlotante(p);
}

function construirFeatureDesdePrefetch(geojsonPrefetch, claveNorm) {
  const props = geojsonPrefetch?.properties || {};
  return {
    type: "Feature",
    geometry: geojsonPrefetch.geometry,
    properties: {
      clave_catastral: claveNorm,
      estatus: props.estatus || null,
      sup_documental: props.superficie ?? props.sup_documental ?? null,
      dibujado: true,
      solo_cartografia: true,
      tiene_expediente: false
    }
  };
}

function normalizarFeaturePredioApi(raw, claveNorm) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "Feature" && (raw.properties || raw.geometry)) return raw;
  if (raw.geometry || raw.properties) {
    return {
      type: "Feature",
      geometry: raw.geometry || null,
      properties: raw.properties || raw
    };
  }
  if (raw.clave_catastral || raw.predio_id !== undefined) {
    return { type: "Feature", geometry: null, properties: raw };
  }
  return null;
}

function guardarFeaturePredioEnCache(claveNorm, feature) {
  if (!claveNorm || !feature) return;
  window._cacheFeaturePredioPorClave = window._cacheFeaturePredioPorClave || {};
  window._cacheFeaturePredioPorClave[claveNorm] = feature;
}

function guardarGeojsonPredioEnCache(claveNorm, geo) {
  if (!claveNorm || !geo?.geometry) return;
  window._cacheGeojsonPorClave = window._cacheGeojsonPorClave || {};
  window._cacheGeojsonPorClave[claveNorm] = geo;
}

function mezclarSinSobrescribirConVacios(base, extra) {
  const out = Object.assign({}, base || {});
  Object.entries(extra || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    out[k] = v;
  });
  return out;
}

async function cargarFeaturePredio(claveNorm, geojsonPrefetch, seq, opciones) {
  opciones = opciones || {};
  const geoUrl = `${API}/predios/${encodeURIComponent(claveNorm)}/geojson?_=${Date.now()}`;
  const fichaUrl = `${API}/padron/${encodeURIComponent(claveNorm)}/ficha?_=${Date.now()}`;

  const geoInicial = geojsonPrefetch?.geometry
    ? geojsonPrefetch
    : (window._cacheGeojsonPorClave?.[claveNorm] || null);

  const [geoRes, fichaRes] = await Promise.all([
    geoInicial ? Promise.resolve(geoInicial) : fetchFeaturePredioOpcional(geoUrl),
    fetchFeaturePredioOpcional(fichaUrl)
  ]);

  if (seq !== seleccionPredioSeq) return null;

  let feature = normalizarFeaturePredioApi(fichaRes, claveNorm);
  if (!feature && geoRes?.geometry) {
    feature = construirFeatureDesdePrefetch(geoRes, claveNorm);
  } else if (feature && geoRes?.geometry) {
    feature.geometry = geoRes.geometry;
  }

  if (!feature) {
    if (geojsonPrefetch?.geometry) {
      feature = construirFeatureDesdePrefetch(geojsonPrefetch, claveNorm);
    }
    return feature;
  }

  const props = feature.properties || {};
  const soloCartografia = props.solo_cartografia === true;
  const tieneExpediente = props.tiene_expediente === true;
  const yaEsExpediente = props.tiene_documentos !== undefined
    || props.estatus_expediente !== undefined
    || props.id_expediente !== undefined;

  if (tieneExpediente && !soloCartografia && !yaEsExpediente && !opciones.omitirExpediente) {
    enriquecerFeatureConExpedienteEnSegundoPlano(claveNorm, feature, seq);
  }

  if (geoRes?.geometry) {
    feature.geometry = geoRes.geometry;
    guardarGeojsonPredioEnCache(claveNorm, geoRes);
  }

  guardarFeaturePredioEnCache(claveNorm, feature);
  return feature;
}

async function enriquecerFeatureConExpedienteEnSegundoPlano(claveNorm, feature, seq) {
  const exp = await fetchFeaturePredioOpcional(
    `${API}/expediente/${encodeURIComponent(claveNorm)}?_=${Date.now()}`
  );
  if (seq !== seleccionPredioSeq || !exp) return;
  const expNorm = normalizarFeaturePredioApi(exp, claveNorm);
  if (!expNorm) return;

  feature.properties = mezclarSinSobrescribirConVacios(feature.properties || {}, expNorm.properties || {});
  if (expNorm.geometry && !feature.geometry) {
    feature.geometry = expNorm.geometry;
  }
  guardarFeaturePredioEnCache(claveNorm, feature);
  window.predioSeleccionado = feature.properties;

  if (typeof pintarFicha === "function") {
    pintarFicha(feature.properties);
  }
  if (document.body.classList.contains("popup-predio-abierto") &&
      typeof actualizarPopupPredioHeader === "function") {
    actualizarPopupPredioHeader(feature.properties);
    if (typeof refrescarPopupPredioSiAbierto === "function") {
      refrescarPopupPredioSiAbierto(feature.properties);
    }
  }
}

async function seleccionarPorClave(clave, origen = "programa", opciones = {}) {
  if (!clave) return;

  const claveNorm = String(clave).trim().toUpperCase();
  const claveAnterior = claveSeleccionadaActual;
  const seq = ++seleccionPredioSeq;

  if (claveNorm !== claveAnterior && typeof limpiarContornoSeleccion === "function") {
    limpiarContornoSeleccion();
  }

  mostrarFichaCargando(claveNorm);
  if (typeof actualizarBreadcrumbPredio === "function") {
    actualizarBreadcrumbPredio(claveNorm, opciones.registroBusqueda || null);
  }
  if (opciones.registroBusqueda) {
    pintarFichaResumenBusqueda(opciones.registroBusqueda);
  }

  if (document.body.classList.contains("popup-predio-abierto")) {
    if (typeof limpiarCachePopupPredio === "function") limpiarCachePopupPredio();
    if (typeof actualizarPopupPredioHeader === "function") {
      const prelim = Object.assign(
        { clave_catastral: claveNorm },
        opciones.registroBusqueda || {}
      );
      actualizarPopupPredioHeader(prelim);
    }
  }

  // Feedback visual inmediato: si el clic en el mapa ya trajo la geometría
  // (vía /predios/intersecta), pintamos el contorno y reencuadramos sin esperar
  // a que termine de cargar la ficha (/expediente), que es lo que se sentía lento.
  let zoomYaAplicado = false;
  const geojsonPrefetch = opciones?.geojsonPrefetch;
  const feedbackVisualInmediato = origen === "mapa" || origen === "busqueda";
  if (geojsonPrefetch?.geometry && feedbackVisualInmediato) {
    try {
      const formatPre = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      const geomPre = formatPre.readFeature(geojsonPrefetch).getGeometry();
      if (geomPre) {
        const enResultadosPre = resultadosSource?.getFeatures().some(
          f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
        );
        if (!enResultadosPre) pintarGeoJSON(geojsonPrefetch, false);
        aplicarSeleccionVisualPredio(claveNorm, geomPre);
        claveSeleccionadaActual = claveNorm;
        const debeZoomPre = claveNorm !== claveAnterior && !geometriaVisibleEnVista(geomPre);
        if (debeZoomPre) {
          const enMovPre = typeof enModoMovimientosCatastrales === "function" && enModoMovimientosCatastrales();
          if (!enMovPre) {
            programarZoomPredioSeleccionado(geomPre, { delayMs: origen === "busqueda" ? 0 : 80 }, seq);
            zoomYaAplicado = true;
          }
        }
      }
    } catch (e) {
      /* si falla, seguimos con el flujo normal */
    }
  }

  const featureGeojson = await cargarFeaturePredio(claveNorm, geojsonPrefetch, seq, {
    omitirExpediente: opciones?.omitirExpediente === true
  });
  if (seq !== seleccionPredioSeq) return;
  if (!featureGeojson) return;

  const ficha = featureGeojson.properties || featureGeojson || {};

  const enResultados = resultadosSource?.getFeatures().some(
    f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
  );

  let debeHacerZoom = origen !== "mapa" || claveNorm !== claveAnterior;
  let geomParaZoom = null;

  if (enResultados) {
    if (seq !== seleccionPredioSeq) return;
    vectorSource.clear();
    const fRes = resultadosSource.getFeatures().find(
      f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
    );
    if (fRes) {
      fRes.set("adeudo_total", Number(ficha.adeudo_total || fRes.get("adeudo_total") || 0));
      fRes.set("info_fiscal", true);
    }

    let geomSeleccion = fRes ? fRes.getGeometry() : null;
    if (featureGeojson.geometry) {
      const format = new ol.format.GeoJSON({
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      geomSeleccion = format.readFeature(featureGeojson).getGeometry();
    }

    geomParaZoom = geomSeleccion;
    aplicarSeleccionVisualPredio(claveNorm, geomSeleccion);
  } else if (featureGeojson.geometry) {
    pintarGeoJSON(featureGeojson, false);
    const format = new ol.format.GeoJSON({
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    geomParaZoom = format.readFeature(featureGeojson).getGeometry();
  } else {
    limpiarContornoSeleccion();
  }

  if (seq !== seleccionPredioSeq) return;

  claveSeleccionadaActual = claveNorm;
  await pintarFicha(ficha);
  if (seq !== seleccionPredioSeq) return;

  document.getElementById("claveInput").value = claveNorm;
  if (typeof actualizarMovimientosPredioAcciones === "function") {
    actualizarMovimientosPredioAcciones(claveNorm);
  }
  sincronizarClavesMovimientoConPredioActivo();
  actualizarBreadcrumbPredio(claveNorm, window.predioSeleccionado || ficha);

  try { actualizarFilaResultadoEnGrid(claveNorm, window.predioSeleccionado || ficha); } catch (e) {}

  // Si la selección viene del mapa y el predio ya está visible, no recentramos
  // (evita el "brinco"). Solo se reencuadra si el predio queda fuera de la vista.
  if (debeHacerZoom && origen === "mapa" && geometriaVisibleEnVista(geomParaZoom)) {
    debeHacerZoom = false;
  }

  // Si ya reencuadramos con la geometría del clic, no repetimos el zoom.
  if (zoomYaAplicado) {
    debeHacerZoom = false;
  }

  if (debeHacerZoom && geomParaZoom) {
    const enMov = typeof enModoMovimientosCatastrales === "function" && enModoMovimientosCatastrales();
    if (enMov && typeof activarVistaContextoPredioMovimientos === "function") {
      await activarVistaContextoPredioMovimientos(geomParaZoom, claveNorm, window.predioSeleccionado || ficha);
    } else {
      programarZoomPredioSeleccionado(
        geomParaZoom,
        { delayMs: origen === "busqueda" ? 0 : 80 },
        seq
      );
    }
  }

  if (typeof activarCapasPredioSeleccionado === "function" &&
      typeof enModoGestionCatastral === "function" && enModoGestionCatastral()) {
    activarCapasPredioSeleccionado();
  }

  if (typeof enModoGestionCatastral === "function" && enModoGestionCatastral()) {
    if (typeof abrirPopupPredioWorkspace === "function") {
      abrirPopupPredioWorkspace(window.predioSeleccionado || ficha);
    }
  }
}




