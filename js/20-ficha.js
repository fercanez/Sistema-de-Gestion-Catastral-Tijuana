function toggleSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === "none" ? "block" : "none";
}

function toggleHistorial() {
  toggleSection("timeline-expediente");
}


function abrirFichaFlotante() {
  const ficha = document.getElementById("fichaFlotante");
  if (!ficha) return;
  ficha.classList.remove("oculto");
  ficha.classList.remove("minimizada");
  ficha.style.left = "";
  ficha.style.top = "";
  ficha.style.right = "";
  ficha.style.bottom = "";
  actualizarLayoutPrincipal();
}

function cerrarFichaFlotante() {
  const ficha = document.getElementById("fichaFlotante");
  if (!ficha) return;
  ficha.classList.add("oculto");
  ficha.classList.remove("minimizada");
  ficha.style.left = "";
  ficha.style.top = "";
  ficha.style.right = "";
  ficha.style.bottom = "";
  actualizarBreadcrumbPredio(null);
  actualizarLayoutPrincipal();
}

function minimizarFichaFlotante() {
  const ficha = document.getElementById("fichaFlotante");
  if (!ficha) return;
  ficha.classList.toggle("minimizada");
  if (ficha.classList.contains("minimizada")) {
    ficha.style.bottom = "auto";
    ficha.style.height = "auto";
  } else {
    ficha.style.left = "";
    ficha.style.top = "";
    ficha.style.right = "";
    ficha.style.bottom = "";
    ficha.style.height = "";
  }
  setTimeout(() => {
    if (typeof map !== "undefined" && map) map.updateSize();
  }, 150);
}

function mostrarFichaTab(tabId, boton) {
  document.querySelectorAll(".ficha-tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".ficha-tab-btn").forEach(b => b.classList.remove("active"));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add("active");
  if (boton) boton.classList.add("active");
}

function inicializarFichaDraggable() {
  const ficha = document.getElementById("fichaFlotante");
  const header = document.getElementById("fichaFlotanteHeader");
  if (!ficha || !header || ficha.dataset.dragReady === "1") return;
  ficha.dataset.dragReady = "1";

  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  header.addEventListener("mousedown", function(e) {
    if (e.target.tagName === "BUTTON") return;
    dragging = true;
    const rect = ficha.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    const maxX = window.innerWidth - ficha.offsetWidth - 8;
    const maxY = window.innerHeight - 45;
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    x = Math.max(8, Math.min(x, maxX));
    y = Math.max(8, Math.min(y, maxY));
    ficha.style.left = x + "px";
    ficha.style.top = y + "px";
    ficha.style.right = "auto";
  });

  document.addEventListener("mouseup", function() {
    dragging = false;
    document.body.style.userSelect = "";
  });
}

function htmlAdministrarCopropietariosFicha(clave, styleExtra = "margin-top:8px;") {
  const c = String(clave || "").replace(/'/g, "\\'");
  return `
    <button type="button" class="btn-expediente-externo perm-editar-catastro" style="${styleExtra}" onclick="abrirModalCopropietarios('${c}')">
      👥 Administrar propietarios / copropietarios
    </button>
    <div class="solo-lectura-catastro" style="${styleExtra}font-size:12px;color:#64748b;padding:6px 8px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;">
      Solo consulta. Para modificar titularidad utilice la pestaña Movimientos o solicite apoyo al área de catastro.
    </div>
  `;
}

function pintarFichaFlotante(p) {
  const contenedor = document.getElementById("fichaFlotanteBody");
  const claveHeader = document.getElementById("fichaFlotanteClave");
  if (!contenedor) return;

  const fichaBox = document.getElementById("fichaFlotante");
  if (fichaBox) {
    fichaBox.classList.remove("estado-adeudo", "estado-sin-adeudo");
    fichaBox.classList.add(Number(p.adeudo_total || 0) > 0 ? "estado-adeudo" : "estado-sin-adeudo");
  }

  if (claveHeader) claveHeader.innerText = val(p.clave_catastral);
  actualizarBreadcrumbPredio(p.clave_catastral, p);

  const adeudoTotal = Number(p.adeudo_total || 0);
  const adeudoBadge = adeudoTotal > 0
    ? `<span class="badge-warn">CON ADEUDO</span>`
    : `<span class="badge-ok">SIN ADEUDO</span>`;

  const avance = porcentajeExpediente(p);

  contenedor.innerHTML = `
    <div class="ficha-status-box">
      <div class="big">${val(p.clave_catastral)}</div>
      <div>${val(p.nombre_completo || p.propietario)}</div>
      <div style="margin-top:5px;">
        ${p.dibujado ? '<span class="badge-ok">DIBUJADO</span>' : '<span class="badge-warn">SIN GEOMETRÍA DIRECTA</span>'}
        ${Number(p.adeudo_total || 0) > 0 ? '<span class="badge-fiscal-adeudo">CON ADEUDO</span>' : '<span class="badge-fiscal-ok">SIN ADEUDO</span>'}
      </div>
    </div>

    <div class="ficha-tabs">
      <button type="button" class="ficha-tab-btn active" onclick="mostrarFichaTab('fichaTabIdentificacion', this)">Identificación</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabValores', this)">Valores</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabExpediente', this)">Expediente</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabUbicacion', this)">Ubicación</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabAdeudos', this)">Adeudos</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabDocumentos', this)">Docs</button>
      <button type="button" class="ficha-tab-btn" onclick="mostrarFichaTab('fichaTabTitularidad', this); cargarTitularidadFicha('${p.clave_catastral || ''}')">Titularidad</button>
    </div>

    <div id="fichaTabIdentificacion" class="ficha-tab-panel active">
      <div class="ficha-mini-row"><div class="label">Clave</div><div class="value">${val(p.clave_catastral)}</div></div>
      <div class="ficha-mini-row"><div class="label">Nombre / Razón social</div><div class="value">${val(p.nombre_completo || p.propietario)}</div></div>
      <div class="ficha-mini-row"><div class="label">Tipo persona</div><div class="value">${val(p.tipo_persona)}</div></div>
      <div class="ficha-mini-row"><div class="label">RFC</div><div class="value">${val(p.rfc)}</div></div>
      <div class="ficha-mini-row"><div class="label">Titularidad</div><div class="value">${val(p.tipo_titularidad)}</div></div>
      <div class="ficha-mini-row"><div class="label">% Propiedad</div><div class="value">${val(p.porcentaje_propiedad)}</div></div>
      ${htmlAdministrarCopropietariosFicha(p.clave_catastral, "margin-top:10px;width:100%;")}
    </div>

    <div id="fichaTabTitularidad" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Nombre visible</div><div class="value">${val(p.nombre_completo || p.propietario)}</div></div>
      <div class="ficha-mini-row"><div class="label">Titulares</div><div class="value">${val(p.total_titulares || 1)}</div></div>
      <div class="ficha-mini-row"><div class="label">Suma propiedad</div><div class="value">${val(p.suma_porcentaje || p.porcentaje_propiedad || 100)}%</div></div>
      <div id="fichaTitularidadDetalle" style="margin-top:8px;">Cargando titularidad...</div>
      ${htmlAdministrarCopropietariosFicha(p.clave_catastral)}
    </div>

    <div id="fichaTabUbicacion" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Delegación</div><div class="value">${val(p.delegacion)}</div></div>
      <div class="ficha-mini-row"><div class="label">Colonia</div><div class="value">${val(p.colonia)}</div></div>
      <div class="ficha-mini-row"><div class="label">Calle</div><div class="value">${val(p.calle)}</div></div>
      <div class="ficha-mini-row"><div class="label">Número oficial</div><div class="value">${val(p.numof)}</div></div>
      <div class="ficha-mini-row"><div class="label">Interior</div><div class="value">${val(p.numint)}</div></div>
      <div class="ficha-mini-row"><div class="label">CP</div><div class="value">${val(p.cp)}</div></div>
    </div>

    <div id="fichaTabValores" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Zona homogénea</div><div class="value">${val(p.zona_homogenea || p.zonah)}</div></div>
      <div class="ficha-mini-row"><div class="label">Uso predial</div><div class="value">${val(p.descripcion_uso)}</div></div>
      <div class="ficha-mini-row"><div class="label">ID tasa</div><div class="value">${val(p.id_tasa)}</div></div>
      <div class="ficha-mini-row"><div class="label">Tasa</div><div class="value">${val(p.porcentaje_tasa)}%</div></div>
      <div class="ficha-mini-row"><div class="label">Sup. documental</div><div class="value">${formatoNumero(p.sup_documental)} m²</div></div>
      <div class="ficha-mini-row"><div class="label">Sup. física</div><div class="value">${formatoNumero(p.sup_fisica)} m²</div></div>
      <div class="ficha-mini-row"><div class="label">Sup. construcción</div><div class="value">${formatoNumero(p.sup_const)} m²</div></div>
      <div class="ficha-mini-row"><div class="label">Valor 2026</div><div class="value">${formatoMoneda(p.valor2026)}</div></div>
    </div>

    <div id="fichaTabAdeudos" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Adeudo 2026</div><div class="value">${formatoMoneda(p.adeudo_2026)}</div></div>
      <div class="ficha-mini-row"><div class="label">Adeudo total</div><div class="value">${formatoMoneda(p.adeudo_total)}</div></div>
      <div class="ficha-mini-row"><div class="label">Estado</div><div class="value">${adeudoBadge}</div></div>
      <div class="ficha-mini-row"><div class="label">Dibujado</div><div class="value">${p.dibujado ? "Sí" : "No / padrón sin geometría directa"}</div></div>
      <div class="ficha-mini-row"><div class="label">Condominio</div><div class="value">${val(p.condominio)}</div></div>
    </div>

    <div id="fichaTabExpediente" class="ficha-tab-panel">
      <div class="ficha-mini-row"><div class="label">Avance</div><div class="value"><span class="${claseAvanceExpediente(avance)}">${avance}% - ${textoAvanceExpediente(avance)}</span></div></div>
      <div class="ficha-mini-row"><div class="label">Documentos</div><div class="value">${indicador(p.tiene_documentos)}</div></div>
      <div class="ficha-mini-row"><div class="label">Cartografía</div><div class="value">${indicador(p.tiene_cartografia)}</div></div>
      <div class="ficha-mini-row"><div class="label">Construcción</div><div class="value">${indicador(p.tiene_construccion)}</div></div>
      <div class="ficha-mini-row"><div class="label">Avalúo</div><div class="value">${indicador(p.tiene_avaluo)}</div></div>
      <div class="ficha-mini-row"><div class="label">Inspección</div><div class="value">${indicador(p.tiene_inspeccion)}</div></div>
      <div class="ficha-mini-row"><div class="label">RPPC</div><div class="value">${indicador(p.tiene_rppc)}</div></div>
      <div class="ficha-mini-row"><div class="label">Fotografía</div><div class="value">${indicador(p.tiene_fotografia)}</div></div>
      <div class="ficha-mini-row"><div class="label">Cédula</div><div class="value">${indicador(p.tiene_cedula)}</div></div>
    </div>

    <div id="fichaTabDocumentos" class="ficha-tab-panel">
      <a class="btn-expediente-externo" href="${urlExpedienteExterno(p.clave_catastral)}" target="_blank" rel="noopener noreferrer">
        📂 Abrir expediente documental externo
      </a>
      <div class="ficha-mini-row"><div class="label">Repositorio</div><div class="value">Mexicali / Documentación</div></div>
      <div class="ficha-mini-row"><div class="label">Clave enviada</div><div class="value">${val(p.clave_catastral)}</div></div>
      <div class="ficha-mini-row"><div class="label">Historial</div><div class="value">Disponible en ficha institucional</div></div>
    </div>
  `;

  abrirFichaFlotante();
  aplicarPermisosVisuales(obtenerRolSesion());
}

function pintarFicha(p) {
  pintarFichaFlotante(p);
  const adeudoTotal = Number(p.adeudo_total || 0);
  const adeudoBadge = adeudoTotal > 0
    ? `<span class="badge-warn">CON ADEUDO</span>`
    : `<span class="badge-ok">SIN ADEUDO</span>`;

  document.getElementById("ficha").innerHTML = `
    <div class="ficha-title" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Ficha predial institucional</span>
      <span style="font-style:italic; font-size:14px;">${val(p.clave_catastral)}</span>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-identificacion')" style="cursor:pointer;">Identificación ▼</div>
      <div id="sec-identificacion" style="display:none;">
        <div class="ficha-row"><b>Clave:</b><span>${val(p.clave_catastral)}</span></div>
        <div class="ficha-row"><b>Propietario:</b><span>${val(p.nombre_completo || p.propietario)}</span></div>
        <div class="ficha-row"><b>Tipo persona:</b><span>${val(p.tipo_persona)}</span></div>
        <div class="ficha-row"><b>RFC:</b><span>${val(p.rfc)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-ubicacion')" style="cursor:pointer;">Ubicación ▼</div>
      <div id="sec-ubicacion" style="display:none;">
        <div class="ficha-row"><b>Delegación:</b><span>${val(p.delegacion)}</span></div>
        <div class="ficha-row"><b>Colonia:</b><span>${val(p.colonia)}</span></div>
        <div class="ficha-row"><b>Calle:</b><span>${val(p.calle)}</span></div>
        <div class="ficha-row"><b>Número oficial:</b><span>${val(p.numof)}</span></div>
        <div class="ficha-row"><b>Número interior:</b><span>${val(p.numint)}</span></div>
        <div class="ficha-row"><b>Letra:</b><span>${val(p.letra)}</span></div>
        <div class="ficha-row"><b>CP:</b><span>${val(p.cp)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-catastral')" style="cursor:pointer;">Información catastral ▼</div>
      <div id="sec-catastral" style="display:none;">
        <div class="ficha-row"><b>Zona homogénea:</b><span>${val(p.zona_homogenea || p.zonah)}</span></div>
        <div class="ficha-row"><b>Uso predial:</b><span>${val(p.descripcion_uso)}</span></div>
        <div class="ficha-row"><b>ID tasa:</b><span>${val(p.id_tasa)}</span></div>
        <div class="ficha-row"><b>Tasa:</b><span>${val(p.porcentaje_tasa)}%</span></div>
        <div class="ficha-row"><b>Condominio:</b><span>${val(p.condominio)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-superficies')" style="cursor:pointer;">Superficies y valores ▼</div>
      <div id="sec-superficies" style="display:none;">
        <div class="ficha-row"><b>Sup. documental:</b><span>${formatoNumero(p.sup_documental)} m²</span></div>
        <div class="ficha-row"><b>Sup. física:</b><span>${formatoNumero(p.sup_fisica)} m²</span></div>
        <div class="ficha-row"><b>Sup. construcción:</b><span>${formatoNumero(p.sup_const)} m²</span></div>
        <div class="ficha-row"><b>Valor 2026:</b><span>${formatoMoneda(p.valor2026)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-adeudos')" style="cursor:pointer;">Adeudos y cartografía ▼</div>
      <div id="sec-adeudos" style="display:none;">
        <div class="ficha-row"><b>Adeudo 2026:</b><span>${formatoMoneda(p.adeudo_2026)}</span></div>
        <div class="ficha-row"><b>Adeudo total:</b><span>${formatoMoneda(p.adeudo_total)}</span></div>
        <div class="ficha-row"><b>Estado:</b><span>${adeudoBadge}</span></div>
        <div class="ficha-row"><b>Dibujado:</b><span>${p.dibujado ? "Sí" : "No / padrón sin geometría directa"}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-expediente')" style="cursor:pointer;">Expediente integral ▼</div>
      <div id="sec-expediente" style="display:none;">
        <div class="ficha-row"><b>Avance expediente:</b><span><span class="${claseAvanceExpediente(porcentajeExpediente(p))}">${porcentajeExpediente(p)}% - ${textoAvanceExpediente(porcentajeExpediente(p))}</span></span></div>
        <div class="ficha-row"><b>Documentos:</b><span>${indicador(p.tiene_documentos)}</span></div>
        <div class="ficha-row"><b>Cartografía:</b><span>${indicador(p.tiene_cartografia)}</span></div>
        <div class="ficha-row"><b>Construcción:</b><span>${indicador(p.tiene_construccion)}</span></div>
        <div class="ficha-row"><b>Avalúo:</b><span>${indicador(p.tiene_avaluo)}</span></div>
        <div class="ficha-row"><b>Inspección:</b><span>${indicador(p.tiene_inspeccion)}</span></div>
        <div class="ficha-row"><b>RPPC:</b><span>${indicador(p.tiene_rppc)}</span></div>
        <div class="ficha-row"><b>Fotografía:</b><span>${indicador(p.tiene_fotografia)}</span></div>
        <div class="ficha-row"><b>Cédula:</b><span>${indicador(p.tiene_cedula)}</span></div>
        <div class="ficha-row"><b>Historial:</b><span>${indicador(p.tiene_historial)}</span></div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-titularidad'); cargarTitularidadFicha('${p.clave_catastral || ''}')" style="cursor:pointer;">Titularidad / copropietarios ▼</div>
      <div id="sec-titularidad" style="display:none; padding-top: 5px;">
        <div class="ficha-row"><b>Nombre visible:</b><span>${val(p.nombre_completo || p.propietario)}</span></div>
        <div class="ficha-row"><b>Total titulares:</b><span>${val(p.total_titulares || 1)}</span></div>
        <div class="ficha-row"><b>Suma propiedad:</b><span>${val(p.suma_porcentaje || p.porcentaje_propiedad || 100)}%</span></div>
        <div id="fichaTitularidadDetallePanel">Cargando titularidad...</div>
        ${htmlAdministrarCopropietariosFicha(p.clave_catastral)}
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleSection('sec-documentos')" style="cursor:pointer;">Documentos del expediente ▼</div>
      <div id="sec-documentos" style="display:none; padding-top: 5px;">
        <a class="btn-expediente-externo" href="${urlExpedienteExterno(p.clave_catastral)}" target="_blank" rel="noopener noreferrer">
          📂 Abrir expediente documental externo
        </a>
        <div>Cargando documentos locales...</div>
      </div>
    </div>

    <div class="ficha-section">
      <div class="ficha-subtitle" onclick="toggleHistorial()" style="cursor:pointer;">Historial institucional ▼</div>
      <div id="timeline-expediente" style="display:none; padding-top: 5px;">Cargando historial...</div>
    </div>
  `;

  cargarHistorial(p.clave_catastral);
  cargarDocumentos(p.clave_catastral);
  aplicarPermisosVisuales(obtenerRolSesion());
}

async function cargarHistorial(clave) {
  const contenedor = document.getElementById("timeline-expediente");
  if (!contenedor || !clave) return;

  try {
    const r = await fetch(`${API}/expediente/${clave}/historial`, { headers: authHeaders() });
    if (!r.ok) {
      contenedor.innerHTML = "No fue posible cargar historial.";
      return;
    }

    const data = await r.json();
    const historial = data.historial || [];

    if (historial.length === 0) {
      contenedor.innerHTML = "Sin movimientos registrados.";
      return;
    }

    let html = "";
    historial.forEach(item => {
      const fecha = item.fecha_modificacion
        ? new Date(item.fecha_modificacion).toLocaleString("es-MX")
        : "Sin fecha";

      html += `
        <div class="timeline-item">
          <div class="timeline-fecha">${fecha}</div>
          <div class="timeline-mov">${item.tipo_movimiento || item.accion || "MOVIMIENTO"}</div>
          <div class="timeline-user">Usuario: ${item.usuario_modifico || "Sin usuario"}</div>
          <div class="timeline-obs">${item.observaciones || "Sin observaciones"}</div>
        </div>
      `;
    });
    contenedor.innerHTML = html;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = "No fue posible cargar historial.";
  }
}

async function cargarDocumentos(clave) {
  const contenedor = document.getElementById("sec-documentos");
  if (!contenedor || !clave) return;

  try {
    const r = await fetch(`${API}/expediente/${clave}/documentos`, { headers: authHeaders() });
    if (!r.ok) {
      contenedor.innerHTML = "No fue posible cargar documentos.";
      return;
    }

    const data = await r.json();
    const documentos = data.documentos || [];

    if (documentos.length === 0) {
      contenedor.innerHTML += "<div>Sin documentos locales registrados.</div>";
      return;
    }

    let html = "";
    documentos.forEach(doc => {
      const urlDoc = `${API}/documentos/${clave}/${doc.nombre_archivo}`;
      html += `
        <div class="timeline-item">
          <div class="timeline-fecha">${doc.tipo_documento || "DOCUMENTO"}</div>
          <div class="timeline-user">${doc.nombre_archivo || ""}</div>
          <div class="timeline-obs">${doc.descripcion || "Sin descripción"}</div>
          <div class="timeline-obs">Año: ${doc.anio || "Sin dato"}</div>
          <button style="margin-top:5px; padding:4px;" onclick="window.open('${urlDoc}', '_blank')">Abrir documento</button>
        </div>
      `;
    });
    contenedor.innerHTML = html;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = "No fue posible cargar documentos.";
  }
}

function pintarMensajeNoDibujado(p) {
  vectorSource.clear();
  limpiarContornoSeleccion();
  document.getElementById("ficha").innerHTML = `
    <div style="background:#fff3cd; border:2px solid #ff9800; color:#7a4a00; padding:10px; border-radius:8px; margin-bottom:10px; font-weight:bold;">
      ⚠ PREDIO NO DIBUJADO EN CARTOGRAFÍA<br>
      La clave existe en el padrón institucional, pero aún no tiene geometría ligada.
    </div>

    <div class="ficha-title">Ficha predial institucional</div>
    <div class="ficha-row"><b>Clave:</b><span>${val(p.clave_catastral)}</span></div>
    <div class="ficha-row"><b>Propietario:</b><span>${val(p.nombre_completo || p.propietario)}</span></div>
    <div class="ficha-row"><b>Delegación:</b><span>${val(p.delegacion)}</span></div>
    <div class="ficha-row"><b>Colonia:</b><span>${val(p.colonia)}</span></div>
    <div class="ficha-row"><b>Calle:</b><span>${val(p.calle)}</span></div>
    <div class="ficha-row"><b>Número:</b><span>${val(p.numof)}</span></div>
    <div class="ficha-row"><b>Zona homogénea:</b><span>${val(p.zona_homogenea || p.zonah)}</span></div>
    <div class="ficha-row"><b>Uso:</b><span>${val(p.descripcion_uso)}</span></div>
    <div class="ficha-row"><b>Sup. documental:</b><span>${formatoNumero(p.sup_documental)} m²</span></div>
    <div class="ficha-row"><b>Valor 2026:</b><span>${formatoMoneda(p.valor2026)}</span></div>
    <div class="ficha-section"><div class="ficha-row"><b>Estatus cartográfico:</b><span class="badge-warn">NO DIBUJADO</span></div></div>
  `;
}


function aplicarFiscalAFeature(feature, ficha) {
  if (!feature || !ficha) return;

  feature.set("adeudo_total", Number(ficha.adeudo_total || 0));
  feature.set("adeudo_2026", Number(ficha.adeudo_2026 || 0));
  feature.set("info_fiscal", true);
  feature.set("seleccionado", true);
}

function aplicarFiscalFeatureCollection(features, fichaSeleccionada = null) {
  features.forEach(f => {
    f.set("info_fiscal", false);
    f.set("seleccionado", false);

    if (
      fichaSeleccionada &&
      String(f.get("clave_catastral")) === String(fichaSeleccionada.clave_catastral)
    ) {
      aplicarFiscalAFeature(f, fichaSeleccionada);
    }
  });
}

function toggleAdeudosFiscal() {
  const chk = document.getElementById("chkAdeudosFiscal");
  if (!chk) return;

  vectorSource.getFeatures().forEach(f => {
    if (!chk.checked) {
      f.set("info_fiscal", false);
    } else if (f.get("adeudo_total") !== undefined) {
      f.set("info_fiscal", true);
    }
    f.changed();
  });
}

function urlExpedienteExterno(clave) {
  return `https://www.mexicali.gob.mx/webpub/consultacatastro/documentacion.aspx?${encodeURIComponent(String(clave || "").trim().toUpperCase())}`;
}

function abrirExpedienteExterno(clave) {
  if (!clave) return;
  window.open(urlExpedienteExterno(clave), "_blank", "noopener,noreferrer");
}

function pintarGeoJSON(featureGeojson, hacerZoom = true) {
  vectorSource.clear();
  if (!featureGeojson) {
    limpiarContornoSeleccion();
    return;
  }

  const format = new ol.format.GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857"
  });

  const feature = format.readFeature(featureGeojson);
  const clave = featureGeojson.properties?.clave_catastral || feature.get("clave_catastral");
  if (clave) feature.set("clave_catastral", clave);
  feature.set("seleccionado", true);
  if (featureGeojson.properties) {
    aplicarFiscalAFeature(feature, featureGeojson.properties);
  }
  vectorSource.addFeature(feature);
  aplicarSeleccionVisualPredio(clave, feature.getGeometry());

  if (hacerZoom) {
    hacerZoomAPredio(clave, feature.getGeometry());
  }
}

async function obtenerFichaPorClave(clave) {
  const resExp = await fetch(`${API}/expediente/${clave}`, { headers: authHeaders() });
  if (!resExp.ok) return null;
  const expedienteGeojson = await resExp.json();
  return expedienteGeojson.properties || null;
}

function extraerGeojsonPrefetchDesdeCapas(claveNorm) {
  if (!claveNorm) return null;
  try {
    const format = new ol.format.GeoJSON({
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    const fuentes = [];
    if (typeof resultadosSource !== "undefined" && resultadosSource) fuentes.push(resultadosSource);
    if (typeof vectorSource !== "undefined" && vectorSource) fuentes.push(vectorSource);
    for (let i = 0; i < fuentes.length; i++) {
      const f = fuentes[i].getFeatures().find(function(x) {
        return String(x.get("clave_catastral") || "").toUpperCase() === claveNorm;
      });
      if (f?.getGeometry()) return format.writeFeatureObject(f);
    }
  } catch (e) {}
  return window._cacheFeaturePredioPorClave?.[claveNorm] || null;
}

async function cargarDesdeBusqueda(registro, opciones) {
  opciones = opciones || {};
  const clave = registro?.clave_catastral;
  if (!clave) return;

  const claveNorm = String(clave).trim().toUpperCase();
  const geojsonPrefetch = opciones.geojsonPrefetch
    || extraerGeojsonPrefetchDesdeCapas(claveNorm);
  const featurePrefetch = opciones.featurePrefetch
    || window._cacheFeaturePredioPorClave?.[claveNorm]
    || geojsonPrefetch;

  if (typeof seleccionarPorClave === "function") {
    await seleccionarPorClave(claveNorm, "busqueda", {
      geojsonPrefetch: geojsonPrefetch,
      featurePrefetch: featurePrefetch
    });
  }

  if (claveSeleccionadaActual === claveNorm) return;

  if (esPredioDibujadoBusqueda(registro)) {
    document.getElementById("ficha").innerHTML = `
      <div class="ficha-title">Ficha predial institucional</div>
      <div class="ficha-row"><b>Clave:</b><span>${val(registro.clave_catastral)}</span></div>
      <div class="ficha-row"><b>Propietario:</b><span>${val(registro.nombre_completo || registro.propietario)}</span></div>
      <div class="ficha-row"><b>Estatus:</b><span class="badge-ok">DIBUJADO EN CARTOGRAFÍA</span></div>
      <div class="ficha-section">No se pudo cargar la ficha completa del predio.</div>
    `;
    return;
  }

  pintarMensajeNoDibujado(registro);
}


function mostrarTab(tabId, boton) {
  document.querySelectorAll(".tab-content").forEach(t => {
    t.classList.remove("active");
    t.style.display = "none";
  });

  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));

  const tab = document.getElementById(tabId);
  if (tab) {
    tab.classList.add("active");
    tab.style.display = tabId === "tabConsulta" ? "flex" : "block";
    tab.scrollTop = 0;
  }

  if (boton) boton.classList.add("active");
  actualizarBreadcrumbModulo(tabId);

  if (tabId === "tabAdministracion") {
    setTimeout(function() {
      if (typeof abrirModuloAdministracion === "function") abrirModuloAdministracion();
    }, 120);
  }

  if (tabId === "tabMovimientos" && typeof sincronizarClavesMovimientoConPredioActivo === "function") {
    sincronizarClavesMovimientoConPredioActivo();
  }

  if (tabId === "tabAnalisisZonas" && typeof abrirModuloAnalisisZonas === "function") {
    setTimeout(function() { abrirModuloAnalisisZonas(); }, 120);
  }

  if (tabId === "tabCondominios" && typeof abrirModuloAnalisisCondominios === "function") {
    setTimeout(function() {
      cargarResumenCondominiosTab();
      abrirModuloAnalisisCondominios();
    }, 120);
  }

  setTimeout(() => {
    if (typeof map !== "undefined" && map) map.updateSize();
  }, 150);
}


/* --- v11: zoom automático a uno o varios resultados --- */
let resultadosLayer = null;
let resultadosSource = null;

function inicializarLayerResultadosBusqueda() {
  if (resultadosLayer) return;

  resultadosSource = new ol.source.Vector();

  resultadosLayer = new ol.layer.Vector({
    source: resultadosSource,
    zIndex: 85,
    style: estiloResultadoBusqueda
  });

  map.addLayer(resultadosLayer);
}

async function obtenerGeojsonPorClaveParaZoom(clave, dibujado) {
  if (!clave) return null;
  if (dibujado === false || dibujado === 0 || String(dibujado).toLowerCase() === "false") {
    return null;
  }

  try {
    const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: authHeaders()
    });

    if (r.ok) {
      const data = await r.json();
      const claveNorm = String(clave || "").trim().toUpperCase();
      if (data && data.geometry) {
        window._cacheFeaturePredioPorClave = window._cacheFeaturePredioPorClave || {};
        window._cacheFeaturePredioPorClave[claveNorm] = data;
        return data;
      }
      if (data && data.geojson && data.geojson.geometry) return data.geojson;
      if (data && data.feature && data.feature.geometry) return data.feature;
      return null;
    }
  } catch (e) {
    /* sin geometría disponible */
  }

  return null;
}

function esPredioDibujadoBusqueda(p) {
  return p?.dibujado === true || p?.dibujado === 1 || String(p?.dibujado || "").toLowerCase() === "true";
}

async function zoomAResultadosBusqueda(resultados) {
  if (!Array.isArray(resultados) || resultados.length === 0) return;

  inicializarLayerResultadosBusqueda();
  resultadosSource.clear();

  const format = new ol.format.GeoJSON();

  // Un solo resultado: una sola /ficha (+ /expediente si aplica), sin consultas duplicadas.
  if (resultados.length === 1 && resultados[0].clave_catastral) {
    const p = resultados[0];
    const clave = p.clave_catastral;
    let featurePrefetch = null;
    if (esPredioDibujadoBusqueda(p)) {
      featurePrefetch = await obtenerGeojsonPorClaveParaZoom(clave, p.dibujado);
      if (featurePrefetch?.geometry) {
        const feature = format.readFeature(featurePrefetch, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857"
        });
        feature.set("clave_catastral", clave);
        feature.set("adeudo_total", Number(p.adeudo_total || featurePrefetch.properties?.adeudo_total || 0));
        feature.set("info_fiscal", true);
        feature.set("seleccionado", false);
        feature.set("principal", true);
        resultadosSource.addFeature(feature);
      }
    }
    await seleccionarPorClave(clave, "busqueda", {
      geojsonPrefetch: featurePrefetch,
      featurePrefetch: featurePrefetch
    });
    return;
  }

  const dibujados = resultados.filter(esPredioDibujadoBusqueda);
  const limite = Math.min(dibujados.length || resultados.length, 50);
  const candidatos = (dibujados.length ? dibujados : resultados).slice(0, limite);

  const promesas = candidatos.map(async (p, idx) => {
    const clave = p.clave_catastral;
    const geo = await obtenerGeojsonPorClaveParaZoom(clave, p.dibujado);
    if (!geo || !geo.geometry) return null;

    const feature = format.readFeature(geo, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });

    feature.set("clave_catastral", clave);
    feature.set("adeudo_total", Number(p.adeudo_total || geo.properties?.adeudo_total || 0));
    feature.set("info_fiscal", true);
    feature.set("seleccionado", false);
    feature.set("principal", idx === 0 && resultados.length === 1);

    resultadosSource.addFeature(feature);
    return feature;
  });

  await Promise.all(promesas);

  const features = resultadosSource.getFeatures();
  if (features.length === 0) return;

  const extent = resultadosSource.getExtent();

  if (extent && !ol.extent.isEmpty(extent)) {
    const w = ol.extent.getWidth(extent);
    const h = ol.extent.getHeight(extent);
    const buf = Math.max(w * 0.14, h * 0.14, 48);
    const extentManzana = ol.extent.buffer(extent, buf);

    marcarIgnorarClickMapa(900);
    map.getView().fit(extentManzana, {
      padding: obtenerPaddingMapaFit(),
      duration: 650,
      maxZoom: 16.5
    });
  }

  const chkFiscal = document.getElementById("chkAdeudosFiscal");
  if (chkFiscal && resultados.length > 1) {
    chkFiscal.checked = true;
    toggleAdeudosFiscal();
  }
  aplicarVisibilidadLeyendaIntegrada(document.getElementById("chkLeyenda")?.checked !== false);
  refrescarLeyendaDespuesDeCambio();
}

function limpiarResultadosZoom() {
  if (resultadosSource) resultadosSource.clear();
  limpiarContornoSeleccion();
}

/* --- v7 OK DataGrid institucional --- */
const gridEstado = {
  todos: [],
  filtrados: [],
  pagina: 1,
  pageSize: 25,
  sortCampo: "clave_catastral",
  sortDir: "asc",
  totalReal: 0
};

const gridColumnasResultados = [
  { campo: "clave_catastral", titulo: "Clave" },
  { campo: "nombre_completo", titulo: "Nombre / Razón social" },
  { campo: "colonia", titulo: "Colonia" },
  { campo: "calle", titulo: "Calle" },
  { campo: "numof", titulo: "# Oficial" },
  { campo: "zona_homogenea", titulo: "Zona H." },
  { campo: "valor2026", titulo: "Valor", tipo: "moneda" },
  { campo: "descripcion_uso", titulo: "Uso" },
  { campo: "dibujado", titulo: "Cartografía", tipo: "booleano" }
];

function cerrarTablaResultados() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  if (tabla) {
    tabla.classList.add("oculto");
    tabla.classList.remove("minimizada");
  }
  document.body.classList.remove("tabla-resultados-minimizada");
  actualizarLayoutPrincipal();
}

function toggleTablaCompacta() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  if (tabla) tabla.classList.toggle("compacta");
}

function renderizarTablaResultados(resultados, totalReal = null) {
  gridEstado.todos = resultados || [];
  gridEstado.filtrados = [...gridEstado.todos];
  gridEstado.totalReal = Number(totalReal ?? gridEstado.todos.length ?? 0);
  gridEstado.pagina = 1;
  ordenarResultadosInterno();
  pintarDataGridResultados();
}

// Actualiza en caliente la fila de la tabla de resultados con los datos
// frescos de la ficha (p. ej. tras aplicar un cambio de nombre/RFC), para
// que la tabla no quede mostrando el dato anterior.
function actualizarFilaResultadoEnGrid(clave, ficha) {
  if (!clave || !ficha) return;
  if (!gridEstado || !Array.isArray(gridEstado.todos) || gridEstado.todos.length === 0) return;

  const claveNorm = String(clave).trim().toUpperCase();
  let cambiado = false;

  gridEstado.todos.forEach(row => {
    if (String(row.clave_catastral || "").trim().toUpperCase() !== claveNorm) return;

    gridColumnasResultados.forEach(col => {
      let v = ficha[col.campo];
      if (col.campo === "nombre_completo") {
        v = ficha.nombre_completo || ficha.propietario;
      } else if (col.campo === "zona_homogenea") {
        v = (ficha.zona_homogenea !== undefined && ficha.zona_homogenea !== null)
          ? ficha.zona_homogenea
          : ficha.zonah;
      }
      if (v !== undefined && v !== null) row[col.campo] = v;
    });

    if (ficha.rfc !== undefined && ficha.rfc !== null) row.rfc = ficha.rfc;
    if (ficha.tipo_persona !== undefined && ficha.tipo_persona !== null) row.tipo_persona = ficha.tipo_persona;

    cambiado = true;
  });

  if (cambiado) {
    ordenarResultadosInterno();
    pintarDataGridResultados();
  }
}

function ordenarResultadosInterno() {
  gridEstado.filtrados.sort((a, b) => {
    let va = a[gridEstado.sortCampo];
    let vb = b[gridEstado.sortCampo];

    if (va === null || va === undefined) va = "";
    if (vb === null || vb === undefined) vb = "";

    const na = Number(va);
    const nb = Number(vb);

    if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== "" && String(vb).trim() !== "") {
      return gridEstado.sortDir === "asc" ? na - nb : nb - na;
    }

    va = String(va).toUpperCase();
    vb = String(vb).toUpperCase();

    if (va < vb) return gridEstado.sortDir === "asc" ? -1 : 1;
    if (va > vb) return gridEstado.sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

function ordenarResultados(campo) {
  if (gridEstado.sortCampo === campo) {
    gridEstado.sortDir = gridEstado.sortDir === "asc" ? "desc" : "asc";
  } else {
    gridEstado.sortCampo = campo;
    gridEstado.sortDir = "asc";
  }

  ordenarResultadosInterno();
  pintarDataGridResultados();
}

function pintarDataGridResultados() {
  const tabla = document.getElementById("tablaResultadosFlotante");
  const titulo = document.getElementById("tablaTitulo");
  const contenido = document.getElementById("tablaResultadosContenido");
  const resumen = document.getElementById("tablaResumen");
  const pagina = document.getElementById("tablaPagina");

  if (!tabla || !titulo || !contenido) return;

  titulo.innerText = "Resultados catastrales";

  if (gridEstado.filtrados.length === 0) {
    contenido.innerHTML = "<div style='padding:12px;'>Sin resultados.</div>";
    if (resumen) resumen.innerText = "0 de 0 registros";
    if (pagina) pagina.innerText = "1 / 1";
    tabla.classList.remove("oculto");
    if (document.getElementById("chkLeyenda")?.checked) aplicarVisibilidadLeyendaIntegrada(true);
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(gridEstado.filtrados.length / gridEstado.pageSize));
  if (gridEstado.pagina > totalPaginas) gridEstado.pagina = totalPaginas;

  const ini = (gridEstado.pagina - 1) * gridEstado.pageSize;
  const fin = ini + gridEstado.pageSize;
  const paginaDatos = gridEstado.filtrados.slice(ini, fin);

  let html = `
    <div class="resultados-table-wrap">
      <table class="resultados-table">
        <thead>
          <tr>
  `;

  gridColumnasResultados.forEach(col => {
    const sortClass =
      gridEstado.sortCampo === col.campo
        ? (gridEstado.sortDir === "asc" ? "sort-asc" : "sort-desc")
        : "";

    html += `<th class="sortable ${sortClass}" onclick="ordenarResultados('${col.campo}')">${col.titulo}</th>`;
  });

  html += `
          </tr>
        </thead>
        <tbody>
  `;

  paginaDatos.forEach((p, i) => {
    const idxGlobal = ini + i;
    html += `<tr data-idx="${idxGlobal}" onclick="seleccionarResultadoTabla(${idxGlobal})">`;

    gridColumnasResultados.forEach(col => {
      let valor = p[col.campo];

      if (col.tipo === "moneda") {
        valor = formatoMoneda(valor);
        html += `<td class="money">${valor}</td>`;
      } else if (col.tipo === "booleano") {
        valor = valor
          ? '<span class="badge-grid badge-grid-ok">DIBUJADO</span>'
          : '<span class="badge-grid badge-grid-warn">SIN GEOM.</span>';
        html += `<td class="center">${valor}</td>`;
      } else {
        html += `<td>${valor || ""}</td>`;
      }
    });

    html += "</tr>";
  });

  html += "</tbody></table></div>";
  contenido.innerHTML = html;

  if (resumen) {
    const totalReal = gridEstado.totalReal || gridEstado.filtrados.length;
    const cargados = gridEstado.todos.length;
    if (totalReal > cargados) {
      resumen.innerText = `${ini + 1}-${Math.min(fin, gridEstado.filtrados.length)} de ${cargados.toLocaleString("es-MX")} cargados · Total encontrado: ${totalReal.toLocaleString("es-MX")}`;
    } else {
      resumen.innerText = `${ini + 1}-${Math.min(fin, gridEstado.filtrados.length)} de ${gridEstado.filtrados.length.toLocaleString("es-MX")} registros`;
    }
  }
  if (pagina) pagina.innerText = `${gridEstado.pagina} / ${totalPaginas}`;

  tabla.classList.remove("oculto");
  tabla.classList.remove("minimizada");
  document.body.classList.remove("tabla-resultados-minimizada");
  if (document.getElementById("chkLeyenda")?.checked) {
    aplicarVisibilidadLeyendaIntegrada(true);
  }
  actualizarLayoutPrincipal();
}

async function seleccionarResultadoTabla(idx) {
  const p = gridEstado.filtrados[idx];
  if (!p) return;

  document.querySelectorAll(".resultados-table tr").forEach(tr => tr.classList.remove("resultado-activo"));
  const tr = document.querySelector(`.resultados-table tr[data-idx="${idx}"]`);
  if (tr) tr.classList.add("resultado-activo");

  document.getElementById("claveInput").value = p.clave_catastral;
  await cargarDesdeBusqueda(p);
}

function filtrarTablaResultados() {
  const filtro = (document.getElementById("filtroTablaResultados")?.value || "").toUpperCase();

  gridEstado.filtrados = gridEstado.todos.filter(p =>
    Object.values(p).some(v => String(v ?? "").toUpperCase().includes(filtro))
  );

  gridEstado.pagina = 1;
  ordenarResultadosInterno();
  pintarDataGridResultados();
}

function cambiarPageSizeResultados() {
  gridEstado.pageSize = Number(document.getElementById("pageSizeResultados")?.value || 25);
  gridEstado.pagina = 1;
  pintarDataGridResultados();
}

function paginaResultadosAnterior() {
  if (gridEstado.pagina > 1) {
    gridEstado.pagina--;
    pintarDataGridResultados();
  }
}

function paginaResultadosSiguiente() {
  const totalPaginas = Math.max(1, Math.ceil(gridEstado.filtrados.length / gridEstado.pageSize));
  if (gridEstado.pagina < totalPaginas) {
    gridEstado.pagina++;
    pintarDataGridResultados();
  }
}



/* --- v20: PDF institucional del predio seleccionado --- */
