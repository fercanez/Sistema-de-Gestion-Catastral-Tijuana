/* Módulo Movimientos Catastrales — panel flotante + capas en mapa */

const movModuloRestore = {
  consultaParent: null,
  movParent: null,
  capasParent: null
};

let movModuloDragState = null;

function enModoMovimientosCatastrales() {
  return document.body.classList.contains("modo-movimientos-catastrales");
}

function movModuloMontarCapasEnMapa() {
  const host = document.getElementById("movimientosCapasHost");
  const tabCapas = document.getElementById("tabCapas");
  if (!host || !tabCapas) return;

  if (!movModuloRestore.capasParent) movModuloRestore.capasParent = tabCapas.parentElement;

  tabCapas.classList.add("active", "mov-capas-tab-mapa");
  tabCapas.style.display = "block";
  host.appendChild(tabCapas);

  if (typeof inicializarAdministradorCapas === "function") inicializarAdministradorCapas();
  if (typeof refrescarLeyendaDespuesDeCambio === "function") refrescarLeyendaDespuesDeCambio();
}

function movModuloRestaurarCapasSidebar() {
  const tabCapas = document.getElementById("tabCapas");
  if (!tabCapas || !movModuloRestore.capasParent) return;

  tabCapas.classList.remove("mov-capas-tab-mapa");
  movModuloRestore.capasParent.appendChild(tabCapas);

  const capasActiva = document.querySelector('.tab-btn[onclick*="tabCapas"]')?.classList.contains("active");
  tabCapas.style.display = capasActiva ? "block" : "none";
  tabCapas.classList.toggle("active", !!capasActiva);
}

function movModuloMostrarPanelCapas() {
  const panel = document.getElementById("movimientosCapasPanel");
  const btn = document.getElementById("movCapasBtnMostrar");
  panel?.classList.remove("oculto");
  btn?.classList.add("oculto");
}

function movModuloOcultarPanelCapas() {
  const panel = document.getElementById("movimientosCapasPanel");
  const btn = document.getElementById("movCapasBtnMostrar");
  panel?.classList.add("oculto");
  btn?.classList.remove("oculto");
}

function movModuloToggleCapasPanel() {
  const panel = document.getElementById("movimientosCapasPanel");
  if (!panel) return;
  if (panel.classList.contains("oculto")) movModuloMostrarPanelCapas();
  else movModuloOcultarPanelCapas();
}

function actualizarMovimientosPredioAcciones(clave) {
  const host = document.getElementById("movimientosPredioAcciones");
  if (!host) return;

  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!enModoMovimientosCatastrales() || !claveNorm) {
    host.classList.add("oculto");
    host.innerHTML = "";
    return;
  }

  host.classList.remove("oculto");
  if (typeof htmlAdministrarCopropietariosFicha === "function") {
    host.innerHTML = htmlAdministrarCopropietariosFicha(claveNorm, "margin-top:0;width:100%;", {
      forMovimientosBusqueda: true
    });
  } else {
    const c = claveNorm.replace(/'/g, "\\'");
    host.innerHTML = `
      <button type="button" class="btn-expediente-externo perm-editar-catastro" style="margin-top:0;width:100%;" onclick="abrirModalCopropietarios('${c}')">
        👥 Administrar propietarios / copropietarios
      </button>
      <div class="solo-lectura-catastro" style="margin-top:6px;font-size:11px;color:#64748b;padding:6px 8px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;">
        Solo consulta. Para modificar titularidad utilice Movimientos o solicite apoyo al área de catastro.
      </div>`;
  }

  if (typeof aplicarPermisosVisuales === "function" && typeof obtenerRolSesion === "function") {
    aplicarPermisosVisuales(obtenerRolSesion());
  }
}

function limpiarMovimientosPredioAcciones() {
  actualizarMovimientosPredioAcciones("");
}

function movModuloToggleMinimizar() {
  const card = document.getElementById("movimientosModuloCard");
  const btn = document.getElementById("movimientosModuloBtnMin");
  if (!card || !btn) return;
  const min = card.classList.toggle("minimizado");
  btn.textContent = min ? "▢" : "—";
  btn.title = min ? "Restaurar panel" : "Minimizar panel";
}

function movModuloToggleBusqueda() {
  document.getElementById("movimientosModuloBusqueda")?.classList.toggle("colapsada");
}

function movModuloInstalarArrastre() {
  const handle = document.getElementById("movimientosModuloDragHandle");
  const card = document.getElementById("movimientosModuloCard");
  if (!handle || !card || handle.dataset.dragOk) return;
  handle.dataset.dragOk = "1";

  handle.addEventListener("pointerdown", function(e) {
    if (e.target.closest("button")) return;
    const rect = card.getBoundingClientRect();
    const parent = card.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    movModuloDragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left - parent.left,
      top: rect.top - parent.top
    };
    card.classList.add("arrastrando");
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener("pointermove", function(e) {
    if (!movModuloDragState || movModuloDragState.pointerId !== e.pointerId) return;
    const parent = card.offsetParent?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const dx = e.clientX - movModuloDragState.startX;
    const dy = e.clientY - movModuloDragState.startY;
    const maxLeft = Math.max(8, parent.width - card.offsetWidth - 8);
    const maxTop = Math.max(8, parent.height - card.offsetHeight - 8);
    card.style.left = Math.min(maxLeft, Math.max(8, movModuloDragState.left + dx)) + "px";
    card.style.top = Math.min(maxTop, Math.max(8, movModuloDragState.top + dy)) + "px";
  });

  function finDrag(e) {
    if (!movModuloDragState || movModuloDragState.pointerId !== e.pointerId) return;
    movModuloDragState = null;
    card.classList.remove("arrastrando");
    try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  handle.addEventListener("pointerup", finDrag);
  handle.addEventListener("pointercancel", finDrag);
}

function activarModuloMovimientosCatastrales() {
  const ws = document.getElementById("movimientosModuloWorkspace");
  const capasBar = document.getElementById("movimientosCapasMapa");
  const busquedaHost = document.getElementById("movimientosModuloBusqueda");
  const movHost = document.getElementById("movimientosModuloHost");
  const tabConsulta = document.getElementById("tabConsulta");
  const tabMov = document.getElementById("tabMovimientos");
  const card = document.getElementById("movimientosModuloCard");
  if (!ws || !busquedaHost || !movHost || !tabConsulta || !tabMov) return;

  if (!movModuloRestore.consultaParent) movModuloRestore.consultaParent = tabConsulta.parentElement;
  if (!movModuloRestore.movParent) movModuloRestore.movParent = tabMov.parentElement;

  busquedaHost.appendChild(tabConsulta);
  movHost.appendChild(tabMov);
  tabConsulta.classList.add("active");
  tabMov.classList.add("active");
  busquedaHost.classList.remove("colapsada");
  card?.classList.remove("minimizado");
  if (card) {
    card.style.left = "14px";
    card.style.top = "14px";
  }
  const btnMin = document.getElementById("movimientosModuloBtnMin");
  if (btnMin) {
    btnMin.textContent = "—";
    btnMin.title = "Minimizar panel";
  }

  ws.classList.remove("oculto");
  capasBar?.classList.remove("oculto");
  movModuloMontarCapasEnMapa();
  movModuloOcultarPanelCapas();

  document.body.classList.add("modo-movimientos-catastrales", "panel-oculto-activo");
  document.getElementById("panel")?.classList.add("panel-oculto");

  if (typeof aplicarCapasModuloMovimientos === "function") {
    aplicarCapasModuloMovimientos();
  } else if (typeof aplicarCapasVistaGeneral === "function") {
    aplicarCapasVistaGeneral();
  }
  if (typeof cerrarTablaResultados === "function") cerrarTablaResultados();
  if (typeof cargarMovimientosPadron === "function") cargarMovimientosPadron();
  movModuloInstalarArrastre();

  if (typeof claveSeleccionadaActual !== "undefined" && claveSeleccionadaActual) {
    actualizarMovimientosPredioAcciones(claveSeleccionadaActual);
  } else {
    limpiarMovimientosPredioAcciones();
  }

  setTimeout(function() {
    if (typeof map !== "undefined" && map) map.updateSize();
    if (typeof actualizarLayoutPrincipal === "function") actualizarLayoutPrincipal();
  }, 280);
}

function desactivarModuloMovimientosCatastrales() {
  const ws = document.getElementById("movimientosModuloWorkspace");
  const capasBar = document.getElementById("movimientosCapasMapa");
  const tabConsulta = document.getElementById("tabConsulta");
  const tabMov = document.getElementById("tabMovimientos");

  movModuloRestaurarCapasSidebar();
  movModuloOcultarPanelCapas();
  capasBar?.classList.add("oculto");
  limpiarMovimientosPredioAcciones();

  if (tabConsulta && movModuloRestore.consultaParent) {
    movModuloRestore.consultaParent.appendChild(tabConsulta);
  }
  if (tabMov && movModuloRestore.movParent) {
    movModuloRestore.movParent.appendChild(tabMov);
    tabMov.classList.remove("active");
  }

  ws?.classList.add("oculto");
  document.body.classList.remove("modo-movimientos-catastrales");
}

window.activarModuloMovimientosCatastrales = activarModuloMovimientosCatastrales;
window.desactivarModuloMovimientosCatastrales = desactivarModuloMovimientosCatastrales;
window.enModoMovimientosCatastrales = enModoMovimientosCatastrales;
window.movModuloToggleMinimizar = movModuloToggleMinimizar;
window.movModuloToggleBusqueda = movModuloToggleBusqueda;
window.movModuloToggleCapasPanel = movModuloToggleCapasPanel;
window.actualizarMovimientosPredioAcciones = actualizarMovimientosPredioAcciones;
window.limpiarMovimientosPredioAcciones = limpiarMovimientosPredioAcciones;
