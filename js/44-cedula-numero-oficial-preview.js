/* Cédula de número oficial — vista previa con plano cartográfico e impresión */

const LOGO_CEDULA_NUMOF_URL = "logomxli.png";

function cedulaNumofEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

async function prepararDatosCedulaNumeroOficial(movOpt) {
  const mov = movOpt || (typeof movimientoSeguimientoActual !== "undefined" ? movimientoSeguimientoActual : null);
  if (!mov) {
    alert("Seleccione un movimiento de número oficial.");
    return null;
  }
  if (typeof esMovimientoNumeroOficial === "function" && !esMovimientoNumeroOficial(mov)) {
    alert("Este movimiento no corresponde a número oficial.");
    return null;
  }
  if (String(mov.estado || "").toUpperCase() !== "APLICADO") {
    alert("La cédula se genera cuando el movimiento ya fue aplicado al padrón.");
    return null;
  }

  const clave = String(mov.clave_catastral || "").trim().toUpperCase();
  if (!clave) {
    alert("El movimiento no tiene clave catastral.");
    return null;
  }

  let movFull = mov;
  if (!mov.detalles && mov.id) {
    try {
      const r = await fetch(`${API}/movimientos/${encodeURIComponent(mov.id)}?_=${Date.now()}`, {
        cache: "no-store",
        headers: typeof authHeaders === "function" ? authHeaders() : {}
      });
      if (r.ok) movFull = await r.json();
    } catch (e) {}
  }

  const detNum = typeof obtenerDetalleNumofMovimiento === "function"
    ? obtenerDetalleNumofMovimiento(movFull)
    : { nuevo: "", anterior: "" };
  const numNuevo = String(detNum.nuevo || "").trim();
  const numAnterior = String(detNum.anterior || "").trim();

  let feature = null;
  try {
    const r = await fetch(`${API}/padron/${encodeURIComponent(clave)}/ficha?_=${Date.now()}`, {
      cache: "no-store",
      headers: typeof authHeaders === "function" ? authHeaders() : {}
    });
    if (r.ok) feature = await r.json();
  } catch (e) {}

  const p = feature?.properties || feature || {};
  const numof = numNuevo || String(p.numof || "").trim();
  const nombre = String(p.nombre_completo || "—").trim().toUpperCase();
  const colonia = String(p.colonia || "—").trim().toUpperCase();
  const seg = typeof segmentosClaveParaCedula === "function"
    ? segmentosClaveParaCedula(clave)
    : { manzana: "—", lote: "—", fraccion: "—" };
  const domicilio = typeof construirDomicilioFisicoCedula === "function"
    ? construirDomicilioFisicoCedula(p, numof)
    : String(p.calle || "—");
  const valoresFiscales = typeof calcularValoresFiscalesCedula === "function"
    ? await calcularValoresFiscalesCedula(p)
    : { valorUnit: null, valorFiscal: null, sup: 0 };
  const valorUnit = valoresFiscales.valorUnit;
  const valorFiscal = valoresFiscales.valorFiscal;
  const supDoc = valoresFiscales.sup || Number(p.sup_documental || p.sup_fisica || 0);
  const uso = String(p.descripcion_uso || "—").trim().toUpperCase();
  const tasa = p.porcentaje_tasa != null && typeof formatTasaMillar === "function"
    ? formatTasaMillar(p.porcentaje_tasa)
    : "—";
  const cpTxt = String(p.cp || "").trim();
  const zonahTxt = String(p.zona_homogenea || p.zonah || "—").trim().toUpperCase();
  const anioZona = typeof ANIO_FISCAL_ZONA_HOMOGENEA !== "undefined" ? ANIO_FISCAL_ZONA_HOMOGENEA : 2026;
  const valorUnitTxt = valorUnit != null
    ? ("$" + valorUnit.toLocaleString("es-MX", { minimumFractionDigits: 2 }) + " / m²")
    : "—";
  const valorFiscalTxt = valorFiscal != null
    ? ("$" + valorFiscal.toLocaleString("es-MX", { minimumFractionDigits: 2 }))
    : "—";
  const delegacion = String(p.delegacion || "MEXICALI").trim().toUpperCase();
  const fechaEmision = new Date().toLocaleString("es-MX");

  if (typeof seleccionarPorClave === "function") {
    try { await seleccionarPorClave(clave); } catch (e) {}
  }

  return {
    clave,
    numof,
    numAnterior,
    numNuevo,
    nombre,
    colonia,
    domicilio,
    seg,
    cpTxt,
    zonahTxt,
    anioZona,
    valorUnitTxt,
    valorFiscalTxt,
    supDoc,
    uso,
    tasa,
    delegacion,
    fechaEmision,
    p
  };
}

function buildCedulaNumofLayoutScript() {
  return `
  const FICHA_PAPEL_CEDULA={carta:{ancho:8.5,alto:11}};

  function mapInToPx(mapIn){
    const inch=parseFloat(mapIn);
    if(isNaN(inch)||inch<=0)return 320;
    return Math.max(220,Math.round(inch*96));
  }

  function aplicarAltoMapaNumof(){
    const mapEl=document.getElementById("previewNumofMap");
    const wrapEl=document.getElementById("previewNumofMapWrap");
    const mapIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-map").trim();
    if(mapIn&&wrapEl){
      const px=mapInToPx(mapIn);
      const pxCss=px+"px";
      wrapEl.style.height=pxCss;
      wrapEl.style.minHeight=pxCss;
      wrapEl.style.maxHeight=pxCss;
      ["previewNumofMapPlaceholder","previewNumofMapLoading","previewNumofMapPrintImg"].forEach(function(id){
        const el=document.getElementById(id);
        if(el){el.style.height="100%";el.style.minHeight="100%";}
      });
      if(mapEl){mapEl.style.width="100%";mapEl.style.height="100%";}
    }
    if(typeof previewMapNumof!=="undefined"&&previewMapNumof){
      previewMapNumof.updateSize();
      try{previewMapNumof.renderSync();}catch(e){}
    }
  }

  function medirReservadoCedulaIn(){
    const cont=document.querySelector(".contenedor");
    if(!cont)return 4.35;
    let px=0;
    Array.from(cont.children).forEach(function(el){
      if(el.classList.contains("ficha-marca-agua-overlay")||el.classList.contains("aviso-marca-ficha-consulta"))return;
      if(el.classList.contains("seccion-mapa")){
        const head=el.querySelector(".media-head");
        if(head)px+=head.getBoundingClientRect().height;
        return;
      }
      px+=el.getBoundingClientRect().height;
    });
    return Math.max(2.35,px/96+0.02);
  }

  function ajustarPapelNumof(opciones){
    opciones=opciones||{};
    const esImpresion=!!opciones.impresion;
    const p=FICHA_PAPEL_CEDULA.carta;
    const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",p.ancho+"in");
    root.style.setProperty("--ficha-alto",p.alto+"in");
    document.body.classList.add("papel-carta");
    document.body.classList.toggle("ficha-numof-layout-impresion",esImpresion);

    let reservado=medirReservadoCedulaIn();
    const margenPagina=esImpresion?0.06:0.1;
    const altoPagina=esImpresion?(p.alto-margenPagina*2):p.alto;
    let mapIn=altoPagina-reservado-(esImpresion?0.01:0.04);
    mapIn=Math.max(2.45,+mapIn.toFixed(2));
    root.style.setProperty("--ficha-media-map",mapIn+"in");
    requestAnimationFrame(aplicarAltoMapaNumof);
  }

  function initLayoutCedula(){
    setTimeout(function(){ajustarPapelNumof({});},80);
    setTimeout(function(){ajustarPapelNumof({});},400);
  }

  window.ajustarPapelNumof=ajustarPapelNumof;
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initLayoutCedula);}
  else{initLayoutCedula();}
  window.addEventListener("resize",function(){
    clearTimeout(window.__cedulaResizeT);
    window.__cedulaResizeT=setTimeout(function(){ajustarPapelNumof({});},160);
  });
  `;
}

function buildCedulaNumofAccionesScript() {
  return `
  function descargarCedulaPdf(){
    const btn=document.getElementById("btnDescargarCedulaPdf");
    if(btn)btn.disabled=true;
    if(typeof esperarLayoutImpresionNumof!=="function"||typeof prepararMapaImpresionNumof!=="function"){
      alert("Espere a que cargue el plano cartográfico.");
      if(btn)btn.disabled=false;
      return;
    }
    esperarLayoutImpresionNumof(function(){
      prepararMapaImpresionNumof().then(function(){
        const img=document.getElementById("previewNumofMapPrintImg");
        const mapaImg=img&&img.classList.contains("activo")?img.src:null;
        if(window.opener&&typeof window.opener.exportarCedulaNumeroOficialPdf==="function"){
          window.opener.exportarCedulaNumeroOficialPdf(window.__cedulaNumofDatos,mapaImg);
        }else{
          alert("Use «Imprimir cédula» y elija «Guardar como PDF» en el diálogo de impresión.");
        }
        if(typeof restaurarMapaImpresionNumof==="function")restaurarMapaImpresionNumof();
        if(btn)btn.disabled=false;
      });
    });
  }
  window.descargarCedulaPdf=descargarCedulaPdf;
  `;
}

function construirHtmlCedulaNumeroOficialVentana(datos, numofData, opciones) {
  opciones = opciones || {};
  const baseHref = String(opciones.baseHref || "./");
  const mapaInicial = String(opciones.mapaInicial || "");
  const clave = cedulaNumofEsc(datos.clave || "—");
  const numof = cedulaNumofEsc(datos.numof || "—");
  const numAnterior = String(datos.numAnterior || "").trim();
  const numNuevo = String(datos.numNuevo || datos.numof || "").trim();
  const mostrarAnterior = numAnterior && numAnterior !== numNuevo;
  const mostrarZona = !(typeof puedeVerDatosZonaHomogenea === "function") || puedeVerDatosZonaHomogenea();
  const buildMap = typeof buildFichaNumofMapScript === "function" ? buildFichaNumofMapScript : null;
  const layerPanel = typeof fichaNumofLayerPanelHtml === "function" ? fichaNumofLayerPanelHtml() : "";
  const mapScript = buildMap
    ? buildMap(numofData || { type: "FeatureCollection", features: [] }, mapaInicial)
    : "function imprimirFichaNumof(){window.print();}";
  const layoutScript = buildCedulaNumofLayoutScript();
  const accionesScript = buildCedulaNumofAccionesScript();
  const datosJson = JSON.stringify(datos).replace(/<\//g, "<\\\\/");
  const placeholderActivo = mapaInicial ? " activo" : "";

  return `<!DOCTYPE html>
<html lang="es" class="papel-carta">
<head>
<meta charset="UTF-8">
<base href="${cedulaNumofEsc(baseHref)}">
<title>Cédula Número Oficial ${clave}</title>
<link rel="stylesheet" href="${typeof FICHA_NUMOF_OL_CSS !== "undefined" ? FICHA_NUMOF_OL_CSS : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css"}">
<style>
:root{--guinda:#703341;--guinda-claro:#d8bdc5;--texto:#283040;--fondo-seccion:#f5f7fa;--ficha-ancho:8.5in;--ficha-alto:11in;--ficha-media-map:3.85in;}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar button:disabled{opacity:.55;cursor:not-allowed;}
.numof-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;font-size:12px;}
.numof-layer-panel.oculto{display:none!important;}
.numof-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.numof-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
.contenedor{width:min(100%,var(--ficha-ancho));max-width:var(--ficha-ancho);margin:12px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);border:1px solid var(--guinda);border-radius:6px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;}
.enc-inst{background:var(--guinda)!important;color:#fff!important;padding:7px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;}
.enc-logo img{height:44px;max-width:200px;object-fit:contain;background:#fff;padding:2px 6px;border-radius:6px;}
.enc-texto{font-size:9px;line-height:1.3;font-weight:700;}
.enc-texto .titulo-sistema{font-size:12px;font-weight:900;display:block;margin-bottom:1px;}
.enc-meta{text-align:right;font-size:8px;font-weight:700;line-height:1.4;}
.titulo-doc{padding:6px 12px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}
.titulo-doc h1{margin:0;font-size:15px;color:var(--texto);}
.titulo-doc p{margin:1px 0 0;font-size:8px;color:#64748b;}
.caja-numof{background:var(--guinda);color:#fff;border-radius:5px;padding:4px 12px;text-align:center;min-width:76px;}
.caja-numof .lbl{font-size:6.5px;font-weight:800;letter-spacing:.35px;}
.caja-numof .num{font-size:19px;font-weight:900;line-height:1.05;}
.seccion{border:1px solid var(--guinda);border-radius:5px;margin:5px 12px 0;overflow:hidden;background:var(--fondo-seccion);}
.seccion-head{background:var(--guinda);color:#fff;padding:3px 7px;font-size:7px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;}
.seccion-body{padding:4px 6px 5px;font-size:7.5px;line-height:1.35;}
.grid-ident{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;}
.grid-ident .full{grid-column:1/-1;}
.grid-ident .k{font-size:6.5px;font-weight:800;color:var(--guinda);text-transform:uppercase;display:block;}
.grid-ident .v{font-size:7.5px;font-weight:700;color:var(--texto);word-break:break-word;}
.grid-catastro{display:grid;grid-template-columns:repeat(5,1fr);gap:2px 6px;}
.grid-catastro .gc{min-width:0;}
.grid-catastro .k{font-size:6px;font-weight:800;color:var(--guinda);text-transform:uppercase;display:block;line-height:1.15;}
.grid-catastro .v{font-size:7px;font-weight:700;color:var(--texto);word-break:break-word;line-height:1.2;}
.seccion-mapa{margin:5px 12px 0;border:1px solid var(--guinda);border-radius:5px;overflow:hidden;flex:0 0 auto;display:flex;flex-direction:column;}
.seccion-mapa .media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:8px;font-weight:800;letter-spacing:.45px;text-transform:uppercase;}
.numof-map-wrap{position:relative;width:100%;height:var(--ficha-media-map);min-height:var(--ficha-media-map);max-height:var(--ficha-media-map);overflow:hidden;background:#eaeaea;border-top:2px solid var(--guinda);box-sizing:border-box;}
#previewNumofMap{position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#eaeaea;}
.numof-map-placeholder,.numof-map-print-snapshot{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;background:#eaeaea;z-index:1;}
.numof-map-placeholder.activo{display:block;z-index:3;}
.numof-map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(234,234,234,.92);color:#703341;font-size:12px;font-weight:700;z-index:4;}
.numof-map-loading.oculto{display:none!important;}
.pie-cedula{display:flex;justify-content:space-between;padding:5px 12px 7px;font-size:7px;color:#64748b;border-top:1px solid var(--guinda-claro);margin-top:5px;}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:6px 8px;font-style:italic;}
@page{size:8.5in 11in portrait;margin:3mm;}
@media print{
  html,body{width:8.5in;height:auto;margin:0!important;padding:0!important;background:#fff!important;}
  .toolbar,.numof-layer-panel,.aviso-impresion{display:none!important;}
  .contenedor{margin:0!important;box-shadow:none!important;border:none!important;border-radius:0!important;width:8.5in!important;max-width:8.5in!important;}
  body.ficha-numof-imprimiendo #previewNumofMap{display:none!important;}
  body.ficha-numof-imprimiendo .numof-map-print-snapshot.activo{display:block!important;z-index:5!important;}
}
</style>
</head>
<body class="cedula-numof-preview">
  <div class="toolbar">
    <button type="button" onclick="zoomMasNumof()">Zoom +</button>
    <button type="button" onclick="zoomMenosNumof()">Zoom −</button>
    <button type="button" class="sec" onclick="centrarMapaFichaNumof&&centrarMapaFichaNumof()">Centrar</button>
    <button type="button" class="sec" onclick="toggleLayerPanelNumof()">Capas</button>
    <button type="button" id="btnImprimirNumof" disabled onclick="imprimirFichaNumof()">Cargando mapa…</button>
    <button type="button" class="sec" id="btnDescargarCedulaPdf" disabled onclick="descargarCedulaPdf()">Descargar PDF</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${layerPanel}
  <div class="aviso-impresion" id="numofMapaEstado">Vista previa de la cédula · cargando plano cartográfico…</div>

  <div class="contenedor">
    <header class="enc-inst">
      <div style="display:flex;gap:10px;align-items:center;">
        <div class="enc-logo"><img src="${LOGO_CEDULA_NUMOF_URL}" alt="Gobierno de Mexicali"></div>
        <div class="enc-texto">
          <span class="titulo-sistema">Sistema de Gestión Catastral</span>
          Dirección de Catastro · H. Ayuntamiento de Mexicali<br>
          Estado de Baja California, México
        </div>
      </div>
      <div class="enc-meta">
        Fecha: ${cedulaNumofEsc(datos.fechaEmision)}<br>
        Clave: <b>${clave}</b>
      </div>
    </header>

    <div class="titulo-doc">
      <div>
        <h1>Cédula de número oficial</h1>
        <p>Asignación de domicilio fiscal · predio urbano</p>
      </div>
      <div class="caja-numof">
        <div class="lbl">NÚMERO OFICIAL</div>
        <div class="num">${numof}</div>
      </div>
    </div>

    <section class="seccion">
      <div class="seccion-head">Identificación del predio</div>
      <div class="seccion-body grid-ident">
        <div class="full"><span class="k">Propietario</span><span class="v">${cedulaNumofEsc(datos.nombre)}</span></div>
        <div><span class="k">Colonia</span><span class="v">${cedulaNumofEsc(datos.colonia)}</span></div>
        <div><span class="k">Delegación</span><span class="v">${cedulaNumofEsc(datos.delegacion)}</span></div>
        <div class="full"><span class="k">Domicilio</span><span class="v">${cedulaNumofEsc(datos.domicilio)}${datos.cpTxt ? ", C.P. " + cedulaNumofEsc(datos.cpTxt) : ""}</span></div>
      </div>
    </section>

    <section class="seccion">
      <div class="seccion-head">Datos catastrales y valores fiscales</div>
      <div class="seccion-body grid-catastro">
        <div class="gc"><span class="k">Manzana</span><span class="v">${cedulaNumofEsc(datos.seg?.manzana || "—")}</span></div>
        <div class="gc"><span class="k">Lote</span><span class="v">${cedulaNumofEsc(datos.seg?.lote || "—")}</span></div>
        <div class="gc"><span class="k">Fracción</span><span class="v">${cedulaNumofEsc(datos.seg?.fraccion === "—" ? "—" : datos.seg?.fraccion || "—")}</span></div>
        <div class="gc"><span class="k">Sup. doc.</span><span class="v">${datos.supDoc ? cedulaNumofEsc(datos.supDoc + " m²") : "—"}</span></div>
        <div class="gc"><span class="k">Uso</span><span class="v">${cedulaNumofEsc(datos.uso)}</span></div>
        <div class="gc"><span class="k">Tasa</span><span class="v">${cedulaNumofEsc(datos.tasa)}</span></div>
        ${mostrarZona ? `<div class="gc"><span class="k">Zona H.</span><span class="v">${cedulaNumofEsc(datos.zonahTxt)} · ${cedulaNumofEsc(datos.anioZona)}</span></div>` : ""}
        <div class="gc"><span class="k">V. unit.</span><span class="v">${cedulaNumofEsc(datos.valorUnitTxt)}</span></div>
        <div class="gc"><span class="k">V. fiscal</span><span class="v">${cedulaNumofEsc(datos.valorFiscalTxt)}</span></div>
        ${mostrarAnterior ? `<div class="gc"><span class="k">No. ant.</span><span class="v">${cedulaNumofEsc(numAnterior)}</span></div>` : ""}
      </div>
    </section>

    <section class="seccion-mapa">
      <div class="media-head">Ubicación cartográfica del predio</div>
      <div class="numof-map-wrap" id="previewNumofMapWrap">
        <img id="previewNumofMapPlaceholder" class="numof-map-placeholder${placeholderActivo}" alt="">
        <div id="previewNumofMapLoading" class="numof-map-loading${mapaInicial ? " oculto" : ""}">Cargando plano…</div>
        <img id="previewNumofMapPrintImg" class="numof-map-print-snapshot" alt="">
        <div id="previewNumofMap"></div>
      </div>
    </section>

    <div class="pie-cedula">
      <span>Documento para impresión y firma · Cobro de número oficial</span>
      <span>${new Date().toLocaleDateString("es-MX")}</span>
    </div>
  </div>

  <script>window.__cedulaNumofDatos=${datosJson};window.__numofPreservarVistaImpresion=true;<\/script>
  <script>${layoutScript}<\/script>
  <script>${mapScript}<\/script>
  <script>
  (function(){
    const btnPdf=document.getElementById("btnDescargarCedulaPdf");
    const btnImp=document.getElementById("btnImprimirNumof");
    function syncPdfBtn(){
      if(btnPdf&&btnImp&&!btnImp.disabled){
        btnPdf.disabled=false;
        btnPdf.textContent="Descargar PDF";
      }
    }
    setInterval(syncPdfBtn,400);
    const obs=new MutationObserver(syncPdfBtn);
    if(btnImp)obs.observe(btnImp,{attributes:true,attributeFilter:["disabled"]});
  })();
  ${accionesScript}
  <\/script>
</body>
</html>`;
}

async function aplicarNumofMovimientoEnDatosMapa(numofData, numof) {
  if (!numofData?.features?.length) return numofData;
  const num = String(numof || "").trim();
  if (!num) return numofData;
  numofData.features.forEach(function(f) {
    if (f.properties?.es_consultado) f.properties.numof = num;
  });
  if (numofData.consultado) numofData.consultado.numof = num;
  return numofData;
}

async function abrirPreviewCedulaNumeroOficial(movOpt) {
  const datos = await prepararDatosCedulaNumeroOficial(movOpt);
  if (!datos) return null;

  let numofData = null;
  const p = datos.p || {};
  if (typeof cargarNumerosOficialesCercanos === "function") {
    try {
      numofData = await cargarNumerosOficialesCercanos(datos.clave, p);
      if (typeof popupNumofCompletarCodigoPostal === "function") {
        numofData = await popupNumofCompletarCodigoPostal(numofData, p);
      }
      numofData = await aplicarNumofMovimientoEnDatosMapa(numofData, datos.numof);
    } catch (e) {
      alert(e.message || "No se pudieron cargar los números oficiales para el plano.");
      return null;
    }
  }

  if (!numofData?.features?.length) {
    alert("Sin geometría cartográfica para la cédula de número oficial.");
    return null;
  }

  let mapaInicial = "";
  if (typeof popupNumofCapturarMapaDataUrl === "function" && typeof popupNumofMap !== "undefined" && popupNumofMap
      && popupNumofClaveActual === datos.clave) {
    try {
      mapaInicial = await popupNumofCapturarMapaDataUrl() || "";
    } catch (e) {
      console.warn("Cédula numof: captura popup:", e);
    }
  }

  const baseHref = window.location.href.replace(/[^/]*$/, "");
  const htmlFicha = construirHtmlCedulaNumeroOficialVentana(datos, numofData, { baseHref, mapaInicial });
  if (typeof abrirVentanaHtmlFichaInstitucional === "function") {
    return abrirVentanaHtmlFichaInstitucional(htmlFicha, "width=1200,height=920");
  }
  const win = window.open("", "_blank", "width=1200,height=920");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes.");
    return null;
  }
  win.document.open();
  win.document.write(
    typeof escribirHtmlFichaVentanaConMarcaConsulta === "function"
      ? escribirHtmlFichaVentanaConMarcaConsulta(htmlFicha)
      : htmlFicha
  );
  win.document.close();
  return win;
}

async function exportarCedulaNumeroOficialPdf(datos, mapaImg) {
  if (!datos) {
    alert("Sin datos para generar la cédula.");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Generador PDF no disponible.");
    return;
  }

  const p = datos.p || {};
  const clave = datos.clave;
  const numof = datos.numof;
  const numAnterior = datos.numAnterior;
  const numNuevo = datos.numNuevo || numof;
  const nombre = datos.nombre;
  const colonia = datos.colonia;
  const domicilio = datos.domicilio;
  const seg = datos.seg || {};
  const cpTxt = datos.cpTxt;
  const zonahTxt = datos.zonahTxt;
  const valorUnitTxt = datos.valorUnitTxt;
  const valorFiscalTxt = datos.valorFiscalTxt;
  const supDoc = datos.supDoc;
  const uso = datos.uso;
  const tasa = datos.tasa;
  const fechaEmision = datos.fechaEmision || new Date().toLocaleString("es-MX");
  const anioZona = datos.anioZona || 2026;
  const mostrarZona = !(typeof puedeVerDatosZonaHomogenea === "function") || puedeVerDatosZonaHomogenea();

  const logoImg = typeof obtenerLogoInstitucionalDataUrl === "function"
    ? await obtenerLogoInstitucionalDataUrl()
    : null;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const guinda = [112, 51, 65];
  const grisTexto = [40, 48, 60];
  const grisClaro = [245, 247, 250];
  const midX = pageW / 2;
  const textoPdfFn = typeof textoPdf === "function" ? textoPdf : function(v) { return v == null || v === "" ? "Sin dato" : String(v); };

  doc.setFillColor(...guinda);
  doc.rect(0, 0, pageW, 32, "F");
  if (logoImg) {
    try { doc.addImage(logoImg, "PNG", 12, 4, 38, 18); } catch (e) {}
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Sistema de Gestión Catastral", logoImg ? 54 : 14, 12);
  doc.setFontSize(10);
  doc.text("Dirección de Catastro · H. Ayuntamiento de Mexicali", logoImg ? 54 : 14, 19);
  doc.setFontSize(9);
  doc.text("Estado de Baja California, México", logoImg ? 54 : 14, 25);
  doc.text("Fecha: " + fechaEmision, pageW - 14, 12, { align: "right" });
  doc.text("Clave: " + clave, pageW - 14, 19, { align: "right" });

  doc.setTextColor(...grisTexto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Cédula de número oficial", 14, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Asignación de domicilio fiscal · predio urbano", 14, 50);

  doc.setFillColor(...guinda);
  doc.roundedRect(pageW - 58, 38, 44, 16, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("NÚMERO OFICIAL", pageW - 36, 43.5, { align: "center" });
  doc.setFontSize(17);
  doc.text(String(numof || "—"), pageW - 36, 51, { align: "center" });

  function marcoSeccionCedula(yTop, h, titulo) {
    doc.setDrawColor(...guinda);
    doc.setLineWidth(0.45);
    doc.setFillColor(...grisClaro);
    doc.roundedRect(14, yTop, pageW - 28, h, 2, 2, "FD");
    doc.setFillColor(...guinda);
    doc.roundedRect(14, yTop, pageW - 28, 7, 2, 2, "F");
    doc.rect(14, yTop + 4, pageW - 28, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(titulo, 18, yTop + 4.8);
  }

  function rowCedula(label, value, x1, x2, yy) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...guinda);
    doc.setFontSize(7);
    doc.text(label, x1, yy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...grisTexto);
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(textoPdfFn(value), Math.max(8, x2 - x1 - 26)), x1 + 26, yy);
  }

  function celdaInline(label, value, x, yy) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...guinda);
    doc.text(label + ":", x, yy);
    const lw = doc.getTextWidth(label + ": ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...grisTexto);
    doc.text(String(value || "—"), x + lw + 0.5, yy);
  }

  let y = 56;
  const hIdent = 22;
  marcoSeccionCedula(y, hIdent, "IDENTIFICACIÓN DEL PREDIO");
  rowCedula("Propietario", nombre, 18, pageW - 18, y + 11);
  rowCedula("Colonia", colonia, 18, midX - 2, y + 15);
  rowCedula("Delegación", String(datos.delegacion || "MEXICALI"), midX + 2, pageW - 18, y + 15);
  rowCedula("Domicilio", domicilio + (cpTxt ? ", C.P. " + cpTxt : ""), 18, pageW - 18, y + 19);

  y += hIdent + 3;
  const hDatos = numAnterior && numAnterior !== numNuevo ? 28 : 24;
  marcoSeccionCedula(y, hDatos, "DATOS CATASTRALES Y VALORES FISCALES");
  const c1 = 18, c2 = 58, c3 = 98, c4 = 138;
  celdaInline("Manzana", seg.manzana, c1, y + 11);
  celdaInline("Lote", seg.lote, c2, y + 11);
  celdaInline("Fracción", seg.fraccion === "—" ? "—" : seg.fraccion, c3, y + 11);
  celdaInline("Sup. doc.", supDoc ? (supDoc + " m²") : "—", c4, y + 11);
  rowCedula("Uso", uso, 18, midX - 2, y + 15);
  rowCedula("Tasa", tasa, midX + 2, pageW - 18, y + 15);
  if (mostrarZona) rowCedula("Zona H.", zonahTxt + " · " + anioZona, 18, midX - 2, y + 19);
  rowCedula("V. unit.", valorUnitTxt, midX + 2, pageW - 18, y + 19);
  rowCedula("V. fiscal", valorFiscalTxt, 18, midX - 2, y + 23);
  if (numAnterior && numAnterior !== numNuevo) {
    rowCedula("No. ant.", numAnterior, midX + 2, pageW - 18, y + 23);
  }

  y += hDatos + 3;
  const mapY = y;
  const mapH = pageH - mapY - 20;
  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.45);
  doc.setFillColor(252, 252, 253);
  doc.roundedRect(14, mapY, pageW - 28, mapH, 2, 2, "FD");
  doc.setFillColor(...guinda);
  doc.roundedRect(14, mapY, pageW - 28, 7, 2, 2, "F");
  doc.rect(14, mapY + 4, pageW - 28, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("UBICACIÓN CARTOGRÁFICA DEL PREDIO", 18, mapY + 4.8);
  const mapInnerY = mapY + 9;
  const mapInnerH = mapH - 11;
  doc.setDrawColor(...guinda);
  doc.setLineWidth(0.35);
  doc.rect(16, mapInnerY, pageW - 32, mapInnerH);
  if (mapaImg) {
    try {
      doc.addImage(mapaImg, "PNG", 17, mapInnerY + 1, pageW - 34, mapInnerH - 2);
    } catch (e) {
      console.warn("Cédula PDF: no se pudo insertar mapa:", e);
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("Croquis no disponible.", pageW / 2, mapInnerY + mapInnerH / 2, { align: "center" });
  }

  doc.setDrawColor(...guinda);
  doc.line(14, pageH - 16, pageW - 14, pageH - 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 110, 125);
  doc.text("Documento para impresión y firma · Cobro de número oficial", 14, pageH - 10);
  doc.text(new Date().toLocaleDateString("es-MX"), pageW - 14, pageH - 10, { align: "right" });

  doc.save("cedula_numero_oficial_" + clave + "_" + String(numof || "sn") + ".pdf");
}

async function imprimirCedulaNumeroOficial(movOpt) {
  return abrirPreviewCedulaNumeroOficial(movOpt);
}

window.prepararDatosCedulaNumeroOficial = prepararDatosCedulaNumeroOficial;
window.abrirPreviewCedulaNumeroOficial = abrirPreviewCedulaNumeroOficial;
window.exportarCedulaNumeroOficialPdf = exportarCedulaNumeroOficialPdf;
window.imprimirCedulaNumeroOficial = imprimirCedulaNumeroOficial;
