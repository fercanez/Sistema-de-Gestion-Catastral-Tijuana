/* Importador de cartografía — Predios Tijuana SHP → PostGIS */

function importadorSetMensaje(texto, tipo) {
  const el = document.getElementById("importadorMensaje");
  if (!el) return;
  el.innerText = texto || "";
  el.className = "admin-mensaje importador-mensaje " + (tipo || "");
}

function importadorSetLog(texto) {
  const el = document.getElementById("importadorLog");
  if (!el) return;
  el.textContent = texto || "";
  el.scrollTop = el.scrollHeight;
}

function importadorHeaders(extra) {
  const token = typeof obtenerTokenInstitucional === "function" ? obtenerTokenInstitucional() : "";
  return Object.assign({ "Authorization": "Bearer " + token }, extra || {});
}

function importadorTablaSeleccionada() {
  return document.getElementById("importadorTabla")?.value || "predios_tijuana_prueba";
}

function importadorActualizarModo() {
  const tabla = importadorTablaSeleccionada();
  const modo = document.getElementById("importadorModo");
  const destino = document.getElementById("importadorTablaDestino");
  if (modo) modo.innerText = tabla === "predios_tijuana" ? "Producción" : "Prueba";
  if (destino) destino.innerText = tabla;
}

async function importadorSubirPredios() {
  importadorActualizarModo();

  const input = document.getElementById("importadorArchivosShape");
  const tabla = importadorTablaSeleccionada();
  const srid = document.getElementById("importadorSrid")?.value || "32611";
  const confirmar = document.getElementById("importadorConfirmarProduccion")?.checked === true;

  if (!input || !input.files || !input.files.length) {
    importadorSetMensaje("Seleccione los archivos .shp, .dbf, .shx, .prj y .cpg, o un ZIP.", "error");
    return;
  }

  if (tabla === "predios_tijuana" && !confirmar) {
    importadorSetMensaje("Para producción debe marcar la autorización de reemplazo.", "error");
    return;
  }

  const nombres = Array.from(input.files).map(f => f.name.toLowerCase());
  const tieneZip = nombres.some(n => n.endsWith(".zip"));
  if (!tieneZip) {
    for (const ext of [".shp", ".dbf", ".shx"]) {
      if (!nombres.some(n => n.endsWith(ext))) {
        importadorSetMensaje("Falta archivo requerido: " + ext, "error");
        return;
      }
    }
  }

  const fd = new FormData();
  Array.from(input.files).forEach(f => fd.append("files", f));
  fd.append("tabla", tabla);
  fd.append("srid", srid);
  fd.append("confirmar_produccion", confirmar ? "true" : "false");

  importadorSetMensaje("Subiendo archivos e iniciando importación. No cierre esta ventana.", "info");
  importadorSetLog("Subiendo archivos...\n");

  try {
    const r = await fetch(API + "/admin/cartografia/importar-predios", {
      method: "POST",
      headers: importadorHeaders(),
      body: fd
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.detail || "Error al importar predios");
    }

    importadorSetMensaje("Importación finalizada correctamente.", "ok");
    importadorSetLog(data.log || JSON.stringify(data, null, 2));

    if (document.getElementById("importadorUltima")) {
      document.getElementById("importadorUltima").innerText = new Date().toLocaleString("es-MX");
    }

    await importadorValidarTabla(tabla);
  } catch (e) {
    importadorSetMensaje(e.message || "Error de importación", "error");
    importadorSetLog((document.getElementById("importadorLog")?.textContent || "") + "\nERROR: " + (e.message || e));
  }
}

async function importadorConsultarEstado() {
  importadorActualizarModo();
  try {
    const r = await fetch(API + "/admin/cartografia/importador-estado", {
      headers: importadorHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "No se pudo consultar estado");
    const destino = document.getElementById("importadorEstadoTabla");
    if (destino) {
      destino.innerHTML = `
        <table class="admin-table">
          <tbody>
            <tr><th>Script</th><td>${data.script || "—"}</td></tr>
            <tr><th>Disponible</th><td>${data.script_existe ? "Sí" : "No"}</td></tr>
            <tr><th>Base</th><td>${data.database || "—"}</td></tr>
            <tr><th>Esquema</th><td>${data.schema || "public"}</td></tr>
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    importadorSetMensaje(e.message || "No se pudo consultar estado", "error");
  }
}

async function importadorValidarTabla(tabla) {
  const destino = document.getElementById("importadorEstadoTabla");
  if (destino) destino.innerHTML = "<div style='padding:10px;'>Validando " + tabla + "...</div>";
  try {
    const r = await fetch(API + "/admin/cartografia/validar-tabla?tabla=" + encodeURIComponent(tabla), {
      headers: importadorHeaders()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "No se pudo validar tabla");

    if (destino) {
      destino.innerHTML = `
        <table class="admin-table">
          <thead><tr><th>Tabla</th><th>Registros</th><th>SRID</th><th>Tipo</th><th>Geom inválidas</th></tr></thead>
          <tbody>
            <tr>
              <td><b>${data.tabla}</b></td>
              <td>${Number(data.registros || 0).toLocaleString("es-MX")}</td>
              <td>${data.srid || "—"}</td>
              <td>${data.tipo_geometria || "—"}</td>
              <td>${data.invalidas ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      `;
    }
  } catch (e) {
    if (destino) destino.innerHTML = '<div style="padding:10px;color:#991b1b;">' + (e.message || e) + "</div>";
  }
}

document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("importadorTabla")?.addEventListener("change", importadorActualizarModo);
  importadorActualizarModo();
});

window.importadorSubirPredios = importadorSubirPredios;
window.importadorConsultarEstado = importadorConsultarEstado;
window.importadorValidarTabla = importadorValidarTabla;
