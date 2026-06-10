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
  ];

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
    if (!vistos.has(clave)) vistos.set(clave, r);
  });
  return Array.from(vistos.values());
}

function detectarTipoBusquedaActiva() {
  const clave = (document.getElementById("claveInput")?.value || "").trim();
  const nombre = (document.getElementById("nombreInput")?.value || "").trim();
  const calle = (document.getElementById("calleInput")?.value || "").trim();
  const numero = (document.getElementById("numeroInput")?.value || "").trim();
  const colonia = (document.getElementById("coloniaInput")?.value || "").trim();

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

function construirUrlBusqueda(clave, nombre, colonia, calle, numero, limite) {
  return `${API}/padron/busqueda-avanzada?` +
    `clave=${encodeURIComponent(clave)}` +
    `&nombre=${encodeURIComponent(nombre)}` +
    `&colonia=${encodeURIComponent(colonia)}` +
    `&calle=${encodeURIComponent(calle)}` +
    `&numero=${encodeURIComponent(numero)}` +
    `&limite=${limite}`;
}

async function pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, limite) {
  const url = construirUrlBusqueda(clave, nombre, colonia, calle, numero, limite);
  const r = await fetch(url, { cache: "no-store", headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  data.__limite_usado = limite;
  return data;
}

async function buscarAvanzado() {
  const clave = document.getElementById("claveInput").value.trim();
  const nombre = document.getElementById("nombreInput").value.trim();
  const colonia = document.getElementById("coloniaInput").value.trim();
  const calle = document.getElementById("calleInput").value.trim();
  const numero = document.getElementById("numeroInput").value.trim();

  const tipoBusqueda = detectarTipoBusquedaActiva();
  limpiarContornoSeleccion();

  try {
    let data = null;

    try {
      data = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, 5000);
    } catch (e5000) {
      console.warn("Búsqueda con límite 5000 falló; reintentando con 100.", e5000);
      data = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, 100);
    }

    let resultados = deduplicarResultadosPadron(data.resultados || []);
    let total = Number(data.total ?? resultados.length ?? 0);
    if (resultados.length < total && clave && !nombre && !colonia && !calle && !numero) {
      total = resultados.length;
    }

    // Si el backend respondió 0 con 5000, reintenta con 100 para evitar falso negativo.
    if (data.__limite_usado === 5000 && total === 0 && resultados.length === 0) {
      try {
        const data100 = await pedirBusquedaAvanzada(clave, nombre, colonia, calle, numero, 100);
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
  }
}

function registrarEnterBusquedas() {
  ["claveInput", "nombreInput", "coloniaInput", "calleInput", "numeroInput"].forEach(function(id) {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("keyup", function(e) {
        if (e.key === "Enter") buscarAvanzado();
      });
    }
  });
}

async function seleccionarPorClave(clave, origen = "programa", opciones = {}) {
  if (!clave) return;

  const claveNorm = String(clave).trim().toUpperCase();
  const claveAnterior = claveSeleccionadaActual;
  const seq = ++seleccionPredioSeq;

  // Feedback visual inmediato: si el clic en el mapa ya trajo la geometría
  // (vía /predios/intersecta), pintamos el contorno y reencuadramos sin esperar
  // a que termine de cargar la ficha (/expediente), que es lo que se sentía lento.
  let zoomYaAplicado = false;
  const geojsonPrefetch = opciones?.geojsonPrefetch;
  if (geojsonPrefetch?.geometry && origen === "mapa") {
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
          programarZoomPredioSeleccionado(geomPre, {}, seq);
          zoomYaAplicado = true;
        }
      }
    } catch (e) {
      /* si falla, seguimos con el flujo normal */
    }
  }

  const fichaGeojsonResponse = await fetch(`${API}/expediente/${encodeURIComponent(claveNorm)}?_=${Date.now()}`, {
    cache: "no-store",
    headers: authHeaders()
  });

  if (seq !== seleccionPredioSeq) return;

  let featureGeojson = null;

  if (fichaGeojsonResponse.ok) {
    featureGeojson = await fichaGeojsonResponse.json();
  } else {
    // Muchos predios existen en padrón/cartografía pero aún no tienen expediente integral.
    // Sin este respaldo el clic en el mapa dejaba la ficha del predio anterior.
    console.warn("Expediente no disponible, se intenta padrón:", claveNorm);
    const resPadron = await fetch(`${API}/padron/${encodeURIComponent(claveNorm)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });
    if (seq !== seleccionPredioSeq) return;
    if (!resPadron.ok) {
      console.warn("No se pudo cargar ficha del predio:", claveNorm);
      return;
    }
    featureGeojson = await resPadron.json();
    // Si el clic ya trajo geometría exacta, preferirla sobre la del padrón.
    if (geojsonPrefetch?.geometry && !featureGeojson?.geometry) {
      featureGeojson = { ...featureGeojson, geometry: geojsonPrefetch.geometry };
    }
    if (geojsonPrefetch?.geometry && featureGeojson?.geometry) {
      featureGeojson.geometry = geojsonPrefetch.geometry;
    }
  }

  if (seq !== seleccionPredioSeq) return;

  const ficha = featureGeojson.properties || featureGeojson || {};

  const enResultados = resultadosSource?.getFeatures().some(
    f => String(f.get("clave_catastral") || "").toUpperCase() === claveNorm
  );

  let debeHacerZoom = origen !== "mapa" || claveNorm !== claveSeleccionadaActual;
  let geomParaZoom = null;

  if (enResultados) {
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
  document.getElementById("claveInput").value = claveNorm;
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
    programarZoomPredioSeleccionado(geomParaZoom, {}, seq);
  }
}




