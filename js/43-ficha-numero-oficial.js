/* Ficha de Número Oficial — vista previa e impresión */

const LOGO_FICHA_NUMOF_URL = "logomxli.png";
const FICHA_NUMOF_OL_CSS = typeof OL_FICHA_CSS !== "undefined"
  ? OL_FICHA_CSS
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const FICHA_NUMOF_OL_JS = typeof OL_FICHA_CDN !== "undefined"
  ? OL_FICHA_CDN
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const FICHA_NUMOF_GEONODE_WMS = typeof POPUP_NUMOF_GEONODE_WMS !== "undefined"
  ? POPUP_NUMOF_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const FICHA_NUMOF_CATASTRO_WMS = typeof POPUP_NUMOF_CATASTRO_WMS !== "undefined"
  ? POPUP_NUMOF_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";

function fichaNumofEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaNumofFormatearFecha(valor) {
  if (!valor) return "";
  try {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor).trim();
    return d.toLocaleDateString("es-MX");
  } catch (e) {
    return String(valor).trim();
  }
}

async function cargarDatosComplementariosFichaNumof(clave, numofActual) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  let fechaAlta = "";
  let numAnterior = "";
  if (!claveNorm) return { fechaAlta, numAnterior };

  const headers = typeof authHeaders === "function" ? authHeaders() : {};
  const apiBase = typeof API !== "undefined" ? API : "/api/catastro";

  try {
    const r = await fetch(`${apiBase}/expediente/${encodeURIComponent(claveNorm)}?_=${Date.now()}`, {
      cache: "no-store",
      headers
    });
    if (r.ok) {
      const ex = await r.json();
      const fa = ex?.properties?.fecha_alta ?? ex?.fecha_alta;
      fechaAlta = fichaNumofFormatearFecha(fa);
    }
  } catch (e) {
    console.warn("Ficha numof: no se pudo cargar fecha de alta:", e);
  }

  try {
    const r = await fetch(`${apiBase}/movimientos/historial/${encodeURIComponent(claveNorm)}/numero-oficial?_=${Date.now()}`, {
      cache: "no-store",
      headers
    });
    if (r.ok) {
      const data = await r.json();
      const rows = data?.historial || [];
      for (let i = 0; i < rows.length; i++) {
        const anterior = String(rows[i]?.valor_anterior ?? "").trim();
        if (!anterior) continue;
        numAnterior = anterior;
        break;
      }
    }
  } catch (e) {
    console.warn("Ficha numof: no se pudo cargar historial de número oficial:", e);
  }

  return { fechaAlta, numAnterior };
}

function fichaNumofEtiqueta(props) {
  if (typeof popupNumofEtiqueta === "function") return popupNumofEtiqueta(props);
  const num = String(props?.numof ?? "").trim();
  if (!num) return "";
  const limpiar = function(valor) {
    const v = String(valor ?? "").trim();
    if (!v || v === "0" || v.toUpperCase() === "NULL") return "";
    if (/^\d+$/.test(v) && Number(v) === 0) return "";
    return v;
  };
  const letra = limpiar(props?.letra);
  const numint = limpiar(props?.numint);
  const sufijo = letra || numint;
  return sufijo ? `${num}-${sufijo}` : num;
}

function fichaNumofLayerPanelHtml() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "consultado", checkboxId: "numofChkConsultado", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "codigos", checkboxId: "numofChkCodigosWms", dotClass: "dot-orange", label: "Códigos postales", checked: true, opacity: 100 },
        { id: "otra", checkboxId: "numofChkOtra", dotClass: "dot-amber", label: "Otras calles", checked: true, opacity: 100 },
        { id: "misma", checkboxId: "numofChkMisma", dotClass: "dot-green", label: "Misma calle", checked: true, opacity: 100 },
        { id: "prediosWms", checkboxId: "numofChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: true, opacity: 85 },
        { id: "colonias", checkboxId: "numofChkColoniasWms", dotClass: "dot-purple", label: "Colonias", checked: false, opacity: 55 }
      ], {
        opPrefix: "numofOp",
        toggleFn: "toggleCapaFichaNumof",
        opacityFn: "cambiarOpacidadCapaFichaNumof",
        subirFn: "subirCapaFichaNumof",
        bajarFn: "bajarCapaFichaNumof"
      })
    : "";

  return `<div id="numofLayerPanel" class="numof-layer-panel oculto">
    <div class="grupo ficha-capas-overlay" id="numofCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    <div class="grupo">
      <strong>Base mapas</strong>
      <label><input type="radio" name="numofBasemap" value="googleHybrid" checked onchange="cambiarBaseFichaNumof()"> Google Hybrid</label>
      <label><input type="radio" name="numofBasemap" value="googleRoad" onchange="cambiarBaseFichaNumof()"> Google Road</label>
      <label><input type="radio" name="numofBasemap" value="esri" onchange="cambiarBaseFichaNumof()"> ESRI Satellite</label>
      <label><input type="radio" name="numofBasemap" value="osm" onchange="cambiarBaseFichaNumof()"> OpenStreetMap</label>
    </div>
  </div>`;
}

function buildFichaNumofMapScript(featuresJson, mapaInicialJson) {
  const geoJson = JSON.stringify(featuresJson || { type: "FeatureCollection", features: [] });
  const mapaInicial = JSON.stringify(mapaInicialJson || "");
  const capasRuntime = typeof buildFichaMapaCapasRuntimeScript === "function"
    ? buildFichaMapaCapasRuntimeScript({
        ordenDef: {
          consultado: 35,
          codigos: 28,
          otra: 14,
          misma: 12,
          prediosWms: 8,
          colonias: 5
        },
        capaProp: {
          consultado: "capaConsultado",
          misma: "capaMisma",
          otra: "capaOtra",
          prediosWms: "capaPredios",
          codigos: "capaCodigos",
          colonias: "capaColonias"
        },
        chkMap: {
          consultado: "numofChkConsultado",
          misma: "numofChkMisma",
          otra: "numofChkOtra",
          prediosWms: "numofChkPrediosWms",
          codigos: "numofChkCodigosWms",
          colonias: "numofChkColoniasWms"
        },
        optionalIds: ["colonias"],
        capasVar: "window.__numofPreviewCapas",
        mapVar: "previewMapNumof",
        overlayListId: "numofCapasOverlayList",
        opPrefix: "numofOp",
        toggleFn: "toggleCapaFichaNumof",
        opacityFn: "cambiarOpacidadCapaFichaNumof",
        subirFn: "subirCapaFichaNumof",
        bajarFn: "bajarCapaFichaNumof",
        initFn: "inicializarOrdenCapasFichaNumof"
      })
    : "";

  return `
  let previewMapNumof=null;
  const featuresNumof=${geoJson};
  const mapaInicialFicha=${mapaInicial};
  ${capasRuntime}

  function crearWmsNumof(url,layers,visible,opacity,zIndex){
    return new ol.layer.Tile({
      visible:!!visible,
      opacity:opacity==null?0.85:opacity,
      zIndex:zIndex==null?5:zIndex,
      source:new ol.source.TileWMS({
        url:url,
        params:{LAYERS:layers,TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",
        crossOrigin:"anonymous"
      })
    });
  }

  function etiquetaNumofMap(props){
    if(typeof popupNumofEtiqueta==="function")return popupNumofEtiqueta(props);
    const num=String((props&&props.numof)||"").trim();
    if(!num)return "";
    function sufijoValido(v){
      v=String(v||"").trim();
      if(!v||v==="0"||v.toUpperCase()==="NULL")return "";
      if(/^\\d+$/.test(v)&&Number(v)===0)return "";
      return v;
    }
    const letra=sufijoValido(props&&props.letra);
    const numint=sufijoValido(props&&props.numint);
    const sufijo=letra||numint;
    return sufijo?num+"-"+sufijo:num;
  }

  function estiloNumofPreview(tipo,props){
    const etiqueta=tipo==="consultado"?etiquetaNumofMap(props)||"ESTE":etiquetaNumofMap(props);
    if(tipo==="consultado"){
      return [
        new ol.style.Style({zIndex:40,stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.98)",width:8}),fill:new ol.style.Fill({color:"rgba(30,64,175,0.58)"})}),
        new ol.style.Style({zIndex:41,stroke:new ol.style.Stroke({color:"#1e3a8a",width:4}),fill:new ol.style.Fill({color:"rgba(37,99,235,0.48)"}),
          text:new ol.style.Text({text:etiqueta,font:"bold 14px Arial",fill:new ol.style.Fill({color:"#fff"}),stroke:new ol.style.Stroke({color:"#1e3a8a",width:4}),overflow:true})})
      ];
    }
    let stroke="#ea580c",fill="rgba(234,88,12,0.22)",zIndex=12;
    if(tipo==="misma"){stroke="#15803d";fill="rgba(21,128,61,0.24)";zIndex=10;}
    return new ol.style.Style({zIndex,stroke:new ol.style.Stroke({color:stroke,width:2}),fill:new ol.style.Fill({color:fill}),
      text:new ol.style.Text({text:etiqueta,font:"bold 12px Arial",fill:new ol.style.Fill({color:"#111827"}),stroke:new ol.style.Stroke({color:"#fff",width:3}),overflow:true})});
  }

  function iniciarMapaFichaNumof(){
    const targetEl=document.getElementById("previewNumofMap");
    if(!targetEl||typeof ol==="undefined"||!ol.Map){
      mostrarErrorMapaNumof("OpenLayers no está disponible.");
      return;
    }
    if(previewMapNumof)return;

    const baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseGoogleRoad=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    const baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});
    const capaPredios=crearWmsNumof("${FICHA_NUMOF_CATASTRO_WMS}","catastro_bc:predios_oficial",true,0.85,fichaCapaOrdenDef.prediosWms);
    const capaColonias=crearWmsNumof("${FICHA_NUMOF_GEONODE_WMS}","colonias",false,0.55,fichaCapaOrdenDef.colonias);
    const capaCodigos=crearWmsNumof("${FICHA_NUMOF_GEONODE_WMS}","codigos_postales_bc_utm1",true,1,fichaCapaOrdenDef.codigos);

    const srcConsultado=new ol.source.Vector();
    const srcMisma=new ol.source.Vector();
    const srcOtra=new ol.source.Vector();
    const format=new ol.format.GeoJSON({dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"});
    (featuresNumof.features||[]).forEach(function(f){
      const p=f.properties||{};
      const feats=format.readFeatures({type:"Feature",geometry:f.geometry,properties:p});
      if(p.es_consultado)srcConsultado.addFeatures(feats);
      else if(p.misma_calle)srcMisma.addFeatures(feats);
      else srcOtra.addFeatures(feats);
    });

    const capaConsultado=new ol.layer.Vector({source:srcConsultado,zIndex:fichaCapaOrdenDef.consultado,style:function(ft){return estiloNumofPreview("consultado",ft.getProperties());}});
    const capaMisma=new ol.layer.Vector({source:srcMisma,zIndex:fichaCapaOrdenDef.misma,style:function(ft){return estiloNumofPreview("misma",ft.getProperties());}});
    const capaOtra=new ol.layer.Vector({source:srcOtra,zIndex:fichaCapaOrdenDef.otra,style:function(ft){return estiloNumofPreview("otra",ft.getProperties());}});

    previewMapNumof=new ol.Map({
      target:"previewNumofMap",
      layers:[baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaPredios,capaColonias,capaMisma,capaOtra,capaConsultado,capaCodigos],
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:18}),
      controls:(function(){
        if(ol.control&&ol.control.defaults&&ol.control.defaults.defaults){
          return ol.control.defaults.defaults({zoom:false,rotate:false,attribution:false});
        }
        return [];
      })()
    });
    window.__numofPreviewCapas={baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaCodigos,capaPredios,capaColonias,capaConsultado,capaMisma,capaOtra};
    window.__numofVistaUsuario=false;
    window.__numofCentradoInicial=false;
    if(typeof inicializarOrdenCapasFichaNumof==="function")inicializarOrdenCapasFichaNumof();
    if(typeof actualizarCapasFichaNumof==="function")actualizarCapasFichaNumof();

    function marcarVistaUsuarioNumof(){
      window.__numofVistaUsuario=true;
    }

    targetEl.addEventListener("wheel",marcarVistaUsuarioNumof,{passive:true});
    previewMapNumof.on("pointerdrag",marcarVistaUsuarioNumof);

    function guardarVistaMapaNumof(){
      if(!previewMapNumof)return null;
      const v=previewMapNumof.getView();
      return{center:v.getCenter(),zoom:v.getZoom(),rotation:v.getRotation()};
    }

    function restaurarVistaMapaNumof(estado){
      if(!previewMapNumof||!estado)return;
      const v=previewMapNumof.getView();
      if(estado.center)v.setCenter(estado.center);
      if(estado.zoom!=null)v.setZoom(estado.zoom);
      if(estado.rotation!=null)v.setRotation(estado.rotation);
    }

    window.guardarVistaMapaNumof=guardarVistaMapaNumof;
    window.restaurarVistaMapaNumof=restaurarVistaMapaNumof;

    function marcarMapaListoNumof(){
      document.getElementById("previewNumofMapPlaceholder")?.classList.remove("activo");
      document.getElementById("previewNumofMapLoading")?.classList.add("oculto");
      const btn=document.getElementById("btnImprimirNumof");
      if(btn){
        btn.disabled=false;
        btn.textContent=document.title.indexOf("Cédula")>=0?"Imprimir cédula":"Imprimir / PDF";
      }
      const aviso=document.getElementById("numofMapaEstado");
      if(aviso){
        aviso.textContent=document.title.indexOf("Cédula")>=0
          ? "Mapa listo. Acérquese, aleje o arrastre; la vista se conserva al imprimir."
          : "Mapa listo. Ajuste capas y zoom, luego pulse «Imprimir / PDF».";
      }
    }

    function centrar(forzar){
      if(!previewMapNumof)return;
      if(!forzar&&window.__numofVistaUsuario)return;
      if(typeof aplicarAltoMapaNumof==="function")aplicarAltoMapaNumof();
      previewMapNumof.updateSize();
      const ext=ol.extent.createEmpty();
      [srcConsultado,srcMisma,srcOtra].forEach(function(s){ol.extent.extend(ext,s.getExtent());});
      if(Number.isFinite(ext[0])){
        previewMapNumof.getView().fit(ext,{padding:[40,40,40,40],maxZoom:19,duration:250});
      }
      try{previewMapNumof.renderSync();}catch(e){}
      window.__numofCentradoInicial=true;
    }

    function centrarMapaUsuario(){
      window.__numofVistaUsuario=false;
      centrar(true);
    }

    previewMapNumof.once("rendercomplete",marcarMapaListoNumof);
    setTimeout(function(){centrar(false);},80);
    setTimeout(function(){centrar(false);},450);
    window.centrarMapaFichaNumof=centrarMapaUsuario;
  }

  function mostrarErrorMapaNumof(msg){
    document.getElementById("previewNumofMapLoading")?.classList.add("oculto");
    const el=document.getElementById("previewNumofMap");
    if(el)el.innerHTML="<div class='numof-map-error'>"+msg+"</div>";
  }

  function bootMapaFichaNumof(){
    if(mapaInicialFicha){
      const ph=document.getElementById("previewNumofMapPlaceholder");
      if(ph&&!ph.getAttribute("src"))ph.src=mapaInicialFicha;
    }
    function arrancar(){
      if(typeof ajustarPapelNumof==="function")ajustarPapelNumof({});
      if(typeof aplicarAltoMapaNumof==="function")aplicarAltoMapaNumof();
      try{iniciarMapaFichaNumof();}
      catch(e){mostrarErrorMapaNumof("No se pudo iniciar el plano cartográfico.");}
    }
    if(typeof ol!=="undefined"&&ol.Map){
      setTimeout(arrancar,100);
      return;
    }
    const s=document.createElement("script");
    s.src="${FICHA_NUMOF_OL_JS}";
    s.onload=function(){setTimeout(arrancar,100);};
    s.onerror=function(){mostrarErrorMapaNumof("No se pudo cargar OpenLayers.");};
    document.body.appendChild(s);
  }

  function toggleLayerPanelNumof(){
    document.getElementById("numofLayerPanel")?.classList.toggle("oculto");
  }

  function actualizarCapasFichaNumof(){
    ["consultado","misma","otra","prediosWms","codigos","colonias"].forEach(toggleCapaFichaNumof);
  }

  function cambiarBaseFichaNumof(){
    const c=window.__numofPreviewCapas;
    if(!c)return;
    const v=document.querySelector('input[name="numofBasemap"]:checked')?.value||"googleHybrid";
    c.baseGoogleHybrid.setVisible(v==="googleHybrid");
    c.baseGoogleRoad.setVisible(v==="googleRoad");
    c.baseEsri.setVisible(v==="esri");
    c.baseOSM.setVisible(v==="osm");
    previewMapNumof&&previewMapNumof.render();
  }

  function zoomMasNumof(){
    if(previewMapNumof){
      window.__numofVistaUsuario=true;
      const v=previewMapNumof.getView();
      v.setZoom((v.getZoom()||18)+1);
    }
  }
  function zoomMenosNumof(){
    if(previewMapNumof){
      window.__numofVistaUsuario=true;
      const v=previewMapNumof.getView();
      v.setZoom((v.getZoom()||18)-1);
    }
  }

  function capturarMapaFichaNumof(mapInst,timeoutMs){
    timeoutMs=timeoutMs||3500;
    return new Promise(function(resolve){
      let resuelto=false;
      function finalizar(img){
        if(!resuelto){resuelto=true;resolve(img);}
      }
      if(!mapInst||typeof mapInst.once!=="function"){finalizar(null);return;}
      setTimeout(function(){finalizar(null);},timeoutMs);
      try{
        const target=mapInst.getTargetElement?mapInst.getTargetElement():null;
        mapInst.once("rendercomplete",function(){
          try{
            const size=mapInst.getSize();
            if(!size||!size[0]||!size[1]){finalizar(null);return;}
            const canvasFinal=document.createElement("canvas");
            canvasFinal.width=size[0];
            canvasFinal.height=size[1];
            const ctx=canvasFinal.getContext("2d");
            const scope=target||document;
            Array.prototype.forEach.call(scope.querySelectorAll(".ol-layer canvas, canvas.ol-layer"),function(canvas){
              try{
                if(canvas.width>0){
                  const opacity=canvas.parentNode.style.opacity||canvas.style.opacity;
                  ctx.globalAlpha=opacity===""?1:Number(opacity);
                  let matrix;
                  const transform=canvas.style.transform;
                  if(transform&&transform.startsWith("matrix")){
                    matrix=transform.match(/^matrix\\(([^\\(]*)\\)$/)[1].split(",").map(Number);
                  }else{
                    matrix=[1,0,0,1,0,0];
                  }
                  CanvasRenderingContext2D.prototype.setTransform.apply(ctx,matrix);
                  ctx.drawImage(canvas,0,0);
                }
              }catch(e){}
            });
            ctx.setTransform(1,0,0,1,0,0);
            ctx.globalAlpha=1;
            finalizar(canvasFinal.toDataURL("image/png"));
          }catch(e){finalizar(null);}
        });
        mapInst.renderSync();
      }catch(e){finalizar(null);}
    });
  }

  function esperarLayoutImpresionNumof(callback){
    const vistaGuardada=typeof guardarVistaMapaNumof==="function"?guardarVistaMapaNumof():null;
    let paso=0;
    const maxPasos=4;
    function tick(){
      if(typeof ajustarPapelNumof==="function")ajustarPapelNumof({impresion:true});
      if(typeof aplicarAltoMapaNumof==="function")aplicarAltoMapaNumof();
      if(previewMapNumof){
        previewMapNumof.updateSize();
        if(vistaGuardada&&typeof restaurarVistaMapaNumof==="function")restaurarVistaMapaNumof(vistaGuardada);
        try{previewMapNumof.renderSync();}catch(e){}
      }
      paso++;
      if(paso>=maxPasos){
        setTimeout(callback,140);
        return;
      }
      setTimeout(tick,paso<2?120:180);
    }
    tick();
  }

  function prepararMapaImpresionNumof(){
    document.body.classList.add("ficha-numof-imprimiendo");
    const img=document.getElementById("previewNumofMapPrintImg");
    const wrap=document.getElementById("previewNumofMapWrap");
    if(!previewMapNumof||!img){
      return Promise.resolve(false);
    }
    const vistaGuardada=typeof guardarVistaMapaNumof==="function"?guardarVistaMapaNumof():null;
    if(typeof ajustarPapelNumof==="function")ajustarPapelNumof({impresion:true});
    if(typeof aplicarAltoMapaNumof==="function")aplicarAltoMapaNumof();
    previewMapNumof.updateSize();
    if(vistaGuardada&&typeof restaurarVistaMapaNumof==="function")restaurarVistaMapaNumof(vistaGuardada);
    try{previewMapNumof.renderSync();}catch(e){}
    return new Promise(function(resolve){
      setTimeout(function(){
        capturarMapaFichaNumof(previewMapNumof,5000).then(function(dataUrl){
          if(dataUrl){
            img.src=dataUrl;
            img.classList.add("activo");
            img.style.objectFit="cover";
            img.style.objectPosition="center center";
            if(wrap)wrap.classList.add("numof-print-listo");
            resolve(true);
            return;
          }
          resolve(false);
        });
      },500);
    });
  }

  function restaurarMapaImpresionNumof(){
    document.body.classList.remove("ficha-numof-imprimiendo");
    const img=document.getElementById("previewNumofMapPrintImg");
    const wrap=document.getElementById("previewNumofMapWrap");
    if(img){
      img.classList.remove("activo");
      img.removeAttribute("src");
    }
    if(wrap)wrap.classList.remove("numof-print-listo");
    if(typeof ajustarPapelNumof==="function")ajustarPapelNumof({});
    if(previewMapNumof){
      previewMapNumof.updateSize();
      try{previewMapNumof.renderSync();}catch(e){}
    }
  }

  function imprimirFichaNumof(){
    const btn=document.getElementById("btnImprimirNumof");
    if(btn)btn.disabled=true;
    esperarLayoutImpresionNumof(function(){
      prepararMapaImpresionNumof().then(function(ok){
        if(!ok&&previewMapNumof){
          previewMapNumof.updateSize();
          try{previewMapNumof.renderSync();}catch(e){}
        }
        setTimeout(function(){
          if(btn)btn.disabled=false;
          window.print();
        },320);
      });
    });
    window.addEventListener("afterprint",function(){
      restaurarMapaImpresionNumof();
    },{once:true});
  }

  window.toggleLayerPanelNumof=toggleLayerPanelNumof;
  window.actualizarCapasFichaNumof=actualizarCapasFichaNumof;
  window.cambiarBaseFichaNumof=cambiarBaseFichaNumof;
  window.zoomMasNumof=zoomMasNumof;
  window.zoomMenosNumof=zoomMenosNumof;
  window.imprimirFichaNumof=imprimirFichaNumof;

  window.iniciarMapaFichaNumof=iniciarMapaFichaNumof;
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){setTimeout(bootMapaFichaNumof,180);});
  }else{
    setTimeout(bootMapaFichaNumof,180);
  }
  `;
}

function buildFichaNumofLayoutScript() {
  return `
  const FICHA_PAPEL_NUMOF={carta:{ancho:8.5,alto:11}};

  function mapInToPx(mapIn){
    const inch=parseFloat(mapIn);
    if(isNaN(inch)||inch<=0)return 416;
    return Math.max(260,Math.round(inch*96));
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
      const ph=document.getElementById("previewNumofMapPlaceholder");
      const ld=document.getElementById("previewNumofMapLoading");
      const pr=document.getElementById("previewNumofMapPrintImg");
      if(ph){ph.style.height="100%";ph.style.minHeight="100%";}
      if(ld){ld.style.height="100%";ld.style.minHeight="100%";}
      if(pr){pr.style.height="100%";pr.style.minHeight="100%";}
      if(mapEl){
        mapEl.style.width="100%";
        mapEl.style.height="100%";
      }
    }
    if(typeof previewMapNumof!=="undefined"&&previewMapNumof){
      previewMapNumof.updateSize();
      try{previewMapNumof.renderSync();}catch(e){}
    }
  }

  function medirReservadoNumofIn(){
    const cont=document.querySelector(".contenedor");
    if(!cont)return 3.95;
    let px=0;
    Array.from(cont.children).forEach(function(el){
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
    const p=FICHA_PAPEL_NUMOF.carta;
    const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",p.ancho+"in");
    root.style.setProperty("--ficha-alto",p.alto+"in");
    document.body.classList.add("papel-carta");
    document.body.classList.toggle("ficha-numof-layout-impresion",esImpresion);

    let reservado=medirReservadoNumofIn();
    const margenPagina=esImpresion?0.06:0.1;
    const altoPagina=esImpresion?(p.alto-margenPagina*2):p.alto;
    let mapIn=altoPagina-reservado-(esImpresion?0.01:0.06);
    mapIn=Math.max(2.3,+mapIn.toFixed(2));
    root.style.setProperty("--ficha-media-map",mapIn+"in");
    if(esImpresion){
      root.style.setProperty("--ficha-contenido-alto",(reservado+mapIn).toFixed(2)+"in");
    }else{
      root.style.removeProperty("--ficha-contenido-alto");
    }
    requestAnimationFrame(aplicarAltoMapaNumof);
  }

  function initLayoutNumof(){
    setTimeout(function(){ajustarPapelNumof({});},80);
    setTimeout(function(){ajustarPapelNumof({});},500);
    setTimeout(function(){
      ajustarPapelNumof({});
      if(typeof centrarMapaFichaNumof==="function")centrarMapaFichaNumof();
    },1400);
  }

  window.ajustarPapelNumof=ajustarPapelNumof;
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initLayoutNumof);}
  else{initLayoutNumof();}
  window.addEventListener("resize",function(){
    clearTimeout(window.__numofResizeT);
    window.__numofResizeT=setTimeout(function(){ajustarPapelNumof({});},160);
  });
  `;
}

function construirHtmlFichaNumeroOficialVentana(datos, numofData, opciones) {
  opciones = opciones || {};
  const baseHref = String(opciones.baseHref || "./");
  const mapaInicial = String(opciones.mapaInicial || "");
  const cp = String(numofData?.consultado?.cp || datos.cp || "—").trim() || "—";
  const numof = String(numofData?.consultado?.numof || datos.numof || "—").trim();
  const numofTitulo = fichaNumofEtiqueta(numofData?.consultado || datos) || numof || "—";
  const nombre = fichaNumofEsc(datos.nombre || "—");
  const colonia = fichaNumofEsc(datos.colonia || "—");
  const clave = fichaNumofEsc(datos.clave || "—");
  const domicilio = typeof construirDomicilioFisicoFicha === "function"
    ? fichaNumofEsc(construirDomicilioFisicoFicha(datos.p || {}, numof))
    : fichaNumofEsc(`${datos.calle || ""} No. ${numof} — ${colonia}`);
  const seg = datos.seg || {};
  const supDoc = datos.supDoc ? Number(datos.supDoc).toFixed(1) + " m2" : "—";
  const supFis = datos.supFis ? Number(datos.supFis).toFixed(1) : "—";
  const tasa = datos.p?.porcentaje_tasa != null ? `${datos.p.porcentaje_tasa}%` : "—";
  const valorUnit = fichaNumofEsc(datos.valorUnitTxt || "—");
  const valorFiscal = datos.valorFiscal != null
    ? fichaNumofEsc("$" + Number(datos.valorFiscal).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    : "—";
  const uso = fichaNumofEsc(datos.uso || "—");
  const fechaAlta = fichaNumofEsc(datos.fechaAlta || "—");
  const numAnterior = fichaNumofEsc(datos.numAnterior || "—");
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const mapScript = buildFichaNumofMapScript(numofData || { type: "FeatureCollection", features: [] }, mapaInicial);
  const layoutScript = buildFichaNumofLayoutScript();
  const placeholderActivo = mapaInicial ? " activo" : "";

  return `<!DOCTYPE html>
<html lang="es" class="papel-carta">
<head>
<meta charset="UTF-8">
<base href="${fichaNumofEsc(baseHref)}">
<title>Ficha Número Oficial ${fichaNumofEsc(clave)}</title>
<link rel="stylesheet" href="${FICHA_NUMOF_OL_CSS}">
<style>
:root{--guinda:#703341;--guinda-claro:#d8bdc5;--texto-valor:#1e293b;--ficha-ancho:8.5in;--ficha-alto:11in;--ficha-media-map:4.35in;}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto-valor);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.numof-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(220px,1fr);gap:10px;font-size:12px;}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
.numof-layer-panel.oculto{display:none!important;}
.numof-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.numof-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
.contenedor{width:min(100%,var(--ficha-ancho));max-width:var(--ficha-ancho);height:auto;min-height:0;margin:12px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);border:1px solid var(--guinda);border-radius:6px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;}
.encabezado{background:var(--guinda)!important;color:#fff!important;padding:10px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:10px;border-bottom:3px solid #c9a227;}
.enc-logo img{height:52px;max-width:220px;object-fit:contain;background:#fff;padding:3px 8px;border-radius:6px;}
.enc-centro{text-align:center;}
.enc-centro .titulo-numof{margin:0;font-size:22px;font-weight:900;color:#fff!important;letter-spacing:.4px;}
.enc-centro .titulo-numof .cp{font-size:18px;font-weight:700;}
.enc-centro .nombre-prop{margin:6px 0 0;font-size:12px;font-weight:800;color:#fff!important;text-decoration:underline;text-underline-offset:3px;}
.enc-der{text-align:right;font-size:9px;font-weight:700;color:#fff!important;line-height:1.35;text-transform:uppercase;}
.enc-der b{display:block;font-size:13px;margin-top:2px;text-transform:none;}
.grid-datos{display:grid;grid-template-columns:1.4fr repeat(4,1fr);border-bottom:1px solid var(--guinda-claro);}
.grid-datos .celda{border-right:1px solid #efe6e8;border-bottom:1px solid #efe6e8;padding:4px 7px;min-height:30px;box-sizing:border-box;}
.grid-datos .celda:last-child{border-right:none;}
.grid-datos .full{grid-column:span 5;border-right:none;}
.grid-datos .span2{grid-column:span 2;}
.label{font-size:8px;color:#1e293b;font-weight:700;text-transform:uppercase;margin-bottom:1px;}
.valor{font-size:10px;font-weight:800;color:var(--guinda);line-height:1.25;word-break:break-word;}
.seccion-mapa{border-top:1px solid var(--guinda-claro);flex:0 0 auto;display:flex;flex-direction:column;}
.seccion-mapa .media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:9px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;flex:0 0 auto;}
.numof-map-wrap{position:relative;width:100%;height:var(--ficha-media-map);min-height:var(--ficha-media-map);max-height:var(--ficha-media-map);flex:0 0 auto;overflow:hidden;background:#eaeaea;line-height:0;border:2px solid var(--guinda);box-sizing:border-box;box-shadow:inset 0 0 0 1px rgba(201,162,39,.45);}
#previewNumofMap{position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#eaeaea;}
.numof-map-placeholder,.numof-map-print-snapshot{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;background:#eaeaea;z-index:1;}
.numof-map-placeholder.activo{display:block;z-index:3;}
.numof-map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(234,234,234,.92);color:#703341;font-size:12px;font-weight:700;z-index:4;}
.numof-map-loading.oculto{display:none!important;}
.numof-map-error{padding:16px;color:#991b1b;font-size:12px;font-weight:700;}
.toolbar button:disabled{opacity:.55;cursor:not-allowed;}
.pie-ficha{display:flex;justify-content:space-between;align-items:center;padding:6px 10px 8px;border-top:1px solid var(--guinda-claro);font-size:9px;color:var(--guinda);font-weight:700;flex:0 0 auto;}
.pie-ficha .cp-leyenda{color:#15803d;font-size:11px;font-weight:900;}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:6px 8px;font-style:italic;}
@page{size:8.5in 11in portrait;margin:3mm;}
@media print{
  html,body{width:8.5in;height:auto;margin:0!important;padding:0!important;background:#fff!important;}
  .toolbar,.numof-layer-panel,.aviso-impresion{display:none!important;}
  .contenedor{
    width:var(--ficha-ancho)!important;
    max-width:var(--ficha-ancho)!important;
    height:var(--ficha-contenido-alto,auto)!important;
    min-height:0!important;
    margin:0 auto!important;
    box-shadow:none!important;
    border-radius:0!important;
    page-break-after:avoid;
    page-break-inside:avoid;
  }
  .seccion-mapa{flex:0 0 auto!important;}
  .numof-map-wrap{
    height:var(--ficha-media-map)!important;
    min-height:var(--ficha-media-map)!important;
    max-height:var(--ficha-media-map)!important;
    overflow:hidden!important;
    border:2px solid var(--guinda)!important;
    box-shadow:inset 0 0 0 1px rgba(201,162,39,.45)!important;
  }
  #previewNumofMap{position:absolute!important;inset:0!important;height:100%!important;}
  body.ficha-numof-imprimiendo .numof-map-wrap.numof-print-listo #previewNumofMap{display:none!important;}
  body.ficha-numof-imprimiendo .numof-map-print-snapshot.activo,
  .numof-map-print-snapshot.activo{
    display:block!important;
    position:absolute!important;
    inset:0!important;
    width:100%!important;
    height:100%!important;
    object-fit:cover!important;
    object-position:center!important;
    -webkit-print-color-adjust:exact!important;
    print-color-adjust:exact!important;
  }
}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="zoomMasNumof()">Zoom +</button>
    <button type="button" onclick="zoomMenosNumof()">Zoom −</button>
    <button type="button" onclick="centrarMapaFichaNumof&&centrarMapaFichaNumof()">Centrar</button>
    <button type="button" class="sec" onclick="toggleLayerPanelNumof()">Capas</button>
    <button type="button" id="btnImprimirNumof" disabled onclick="imprimirFichaNumof()">Cargando mapa…</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaNumofLayerPanelHtml()}
  <div class="aviso-impresion" id="numofMapaEstado">Cargando plano cartográfico…</div>

  <div class="contenedor">
    <header class="encabezado">
      <div class="enc-logo"><img src="${LOGO_FICHA_NUMOF_URL}" alt="Gobierno de Mexicali"></div>
      <div class="enc-centro">
        <h1 class="titulo-numof">NÚMERO OFICIAL ${fichaNumofEsc(numofTitulo)} , <span class="cp">C.P. ${fichaNumofEsc(cp)}</span></h1>
        <p class="nombre-prop">${nombre}</p>
      </div>
      <div class="enc-der">
        Clave Catastral<br><b>${clave}</b>
        Colonia / Fracc.<br><b>${colonia}</b>
      </div>
    </header>

    <div class="grid-datos">
      <div class="celda full"><div class="label">Domicilio físico</div><div class="valor">${domicilio}</div></div>
      <div class="celda"><div class="label">Manzana</div><div class="valor">${fichaNumofEsc(seg.manzana || "—")}</div></div>
      <div class="celda"><div class="label">Lote</div><div class="valor">${fichaNumofEsc(seg.lote || "—")}</div></div>
      <div class="celda"><div class="label">Fracción</div><div class="valor">${fichaNumofEsc(seg.fraccion || "—")}</div></div>
      <div class="celda"><div class="label">Superficie</div><div class="valor">${fichaNumofEsc(supFis)}</div></div>
      <div class="celda"><div class="label">Superficie documental</div><div class="valor">${fichaNumofEsc(supDoc)}</div></div>
      <div class="celda span2"><div class="label">Uso de suelo predial</div><div class="valor">${uso}</div></div>
      <div class="celda"><div class="label">Tasa</div><div class="valor">${fichaNumofEsc(tasa)}</div></div>
      <div class="celda"><div class="label">Valor unitario terreno</div><div class="valor">${valorUnit} x m2</div></div>
      <div class="celda"><div class="label">Valor fiscal</div><div class="valor">${valorFiscal}</div></div>
      <div class="celda"><div class="label">Número anterior</div><div class="valor">${numAnterior}</div></div>
      <div class="celda"><div class="label">Fecha de alta</div><div class="valor">${fechaAlta}</div></div>
    </div>

    <section class="seccion-mapa">
      <div class="media-head">Plano de números oficiales</div>
      <div class="numof-map-wrap" id="previewNumofMapWrap">
        <img id="previewNumofMapPlaceholder" class="numof-map-placeholder${placeholderActivo}" alt="">
        <div id="previewNumofMapLoading" class="numof-map-loading${mapaInicial ? " oculto" : ""}">Cargando plano…</div>
        <img id="previewNumofMapPrintImg" class="numof-map-print-snapshot" alt="">
        <div id="previewNumofMap"></div>
      </div>
    </section>

    <div class="pie-ficha">
      <span class="cp-leyenda">${fichaNumofEsc(cp)} — Código postal correspondiente</span>
      <span>${fichaNumofEsc(fechaPie)}</span>
    </div>
  </div>

  <script>${layoutScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirPreviewFichaNumeroOficial() {
  const clave = String(
    window.predioSeleccionado?.clave_catastral ||
    popupNumofClaveActual ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio con número oficial.");
    return null;
  }

  let numofData = popupNumofDatos;
  if (!numofData || numofData.clave_catastral !== clave) {
    const p = window.predioSeleccionado || {};
    if (typeof cargarNumerosOficialesCercanos === "function") {
      try {
        numofData = await cargarNumerosOficialesCercanos(clave, p);
        numofData = await popupNumofCompletarCodigoPostal(numofData, p);
      } catch (e) {
        alert(e.message || "No se pudieron cargar los números oficiales para la ficha.");
        return null;
      }
    }
  }

  if (!numofData?.features?.length) {
    alert("Sin geometría cartográfica para generar la ficha de número oficial.");
    return null;
  }

  const datos = typeof cargarDatosFichaCatastral === "function"
    ? await cargarDatosFichaCatastral(clave)
    : null;

  if (!datos) {
    alert("No se pudieron cargar los datos del predio.");
    return null;
  }

  datos.cp = numofData.consultado?.cp || datos.p?.cp || "";
  datos.numof = numofData.consultado?.numof || datos.numof;

  const complementos = await cargarDatosComplementariosFichaNumof(clave, datos.numof);
  datos.fechaAlta = complementos.fechaAlta || "";
  datos.numAnterior = complementos.numAnterior || "";

  let mapaInicial = "";
  if (typeof popupNumofCapturarMapaDataUrl === "function" && popupNumofMap) {
    try {
      mapaInicial = await popupNumofCapturarMapaDataUrl() || "";
    } catch (e) {
      console.warn("Ficha numof: no se pudo capturar mapa del popup:", e);
    }
  }

  const baseHref = window.location.href.replace(/[^/]*$/, "");

  const win = window.open("", "_blank", "width=1200,height=920");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes.");
    return null;
  }

  win.document.open();
  win.document.write(construirHtmlFichaNumeroOficialVentana(datos, numofData, { baseHref, mapaInicial }));
  win.document.close();
  return win;
}

window.abrirPreviewFichaNumeroOficial = abrirPreviewFichaNumeroOficial;
window.buildFichaNumofMapScript = buildFichaNumofMapScript;
window.buildFichaNumofLayoutScript = buildFichaNumofLayoutScript;
window.fichaNumofLayerPanelHtml = fichaNumofLayerPanelHtml;
