/* Ficha análisis zonas homogéneas — vista previa, capas WMS e impresión oficio horizontal */

const LOGO_FICHA_ANALISIS_ZONA_URL = "logomxli.png";
const FICHA_ANALISIS_OL_CSS = typeof OL_FICHA_CSS !== "undefined"
  ? OL_FICHA_CSS
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const FICHA_ANALISIS_OL_JS = typeof OL_FICHA_CDN !== "undefined"
  ? OL_FICHA_CDN
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const FICHA_ANALISIS_GEONODE_WMS = typeof POPUP_ZONA_GEONODE_WMS !== "undefined"
  ? POPUP_ZONA_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const FICHA_ANALISIS_CATASTRO_WMS = typeof POPUP_ZONA_CATASTRO_WMS !== "undefined"
  ? POPUP_ZONA_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const FICHA_ANALISIS_WMS_ZONAS = typeof POPUP_ZONA_WMS_LAYER !== "undefined"
  ? POPUP_ZONA_WMS_LAYER
  : "zonas_homogeneas";

function fichaAnalisisEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaAnalisisFormatMoneda(valor) {
  if (typeof formatoMoneda === "function") return formatoMoneda(valor);
  if (valor == null || valor === "") return "—";
  return "$" + Number(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function serializarFeaturesAnalisisZona(geoData) {
  const features = [];
  if (geoData?.geometry) {
    features.push({
      type: "Feature",
      geometry: geoData.geometry,
      properties: { es_zona: true, codigo: geoData.codigo || "" }
    });
  }
  return {
    type: "FeatureCollection",
    features,
    centroide: geoData?.centroide || null,
    wmsLayer: FICHA_ANALISIS_WMS_ZONAS,
    codigo: geoData?.codigo || ""
  };
}

function fichaAnalisisLayerPanelHtml() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "zona", checkboxId: "analisisChkZona", dotClass: "dot-blue", label: "Zona analizada (negro)", checked: true, opacity: 100 },
        { id: "zonasWms", checkboxId: "analisisChkZonasWms", dotClass: "dot-green", label: "Zonas homogéneas (WMS)", checked: true, opacity: 72 },
        { id: "prediosWms", checkboxId: "analisisChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: false, opacity: 45 },
        { id: "coloniasWms", checkboxId: "analisisChkColoniasWms", dotClass: "dot-purple", label: "Colonias (WMS)", checked: false, opacity: 55 }
      ], {
        opPrefix: "analisisOp",
        toggleFn: "toggleCapaFichaAnalisis",
        opacityFn: "cambiarOpacidadCapaFichaAnalisis",
        subirFn: "subirCapaFichaAnalisis",
        bajarFn: "bajarCapaFichaAnalisis"
      })
    : "";

  return `<div id="analisisLayerPanel" class="analisis-layer-panel oculto">
    <div class="grupo ficha-capas-overlay analisis-capas-overlay" id="analisisCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    <div class="grupo">
      <strong>Base mapas</strong>
      <label><input type="radio" name="analisisBasemap" value="googleHybrid" checked onchange="cambiarBaseFichaAnalisis()"> Google Hybrid</label>
      <label><input type="radio" name="analisisBasemap" value="googleRoad" onchange="cambiarBaseFichaAnalisis()"> Google Road</label>
      <label><input type="radio" name="analisisBasemap" value="esri" onchange="cambiarBaseFichaAnalisis()"> ESRI Satellite</label>
      <label><input type="radio" name="analisisBasemap" value="osm" onchange="cambiarBaseFichaAnalisis()"> OpenStreetMap</label>
    </div>
  </div>`;
}

function buildFichaAnalisisChartScript(catalogoJson) {
  const cat = JSON.stringify(catalogoJson || null);
  return `
  const catalogoAnalisisFicha=${cat};
  const ANALISIS_CHART_COLORES={2023:"#059669",2024:"#dc2626",2025:"#ea580c",2026:"#2563eb",2027:"#16a34a"};
  function colorAnioAnalisisFicha(an,idx){
    const y=parseInt(an,10);
    if(!Number.isNaN(y)&&ANALISIS_CHART_COLORES[y])return ANALISIS_CHART_COLORES[y];
    return ANALISIS_CHART_COLORES[an]||["#059669","#dc2626","#ea580c","#2563eb"][idx%4];
  }
  function dibujarChartFichaAnalisis(canvasOpt){
    const canvas=canvasOpt||document.getElementById("previewAnalisisChart");
    if(!canvas)return null;
    const ctx=canvas.getContext("2d");
    const W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
    const reg=catalogoAnalisisFicha;
    if(!reg){
      ctx.fillStyle="#94a3b8";ctx.font="14px Segoe UI,sans-serif";ctx.textAlign="center";
      ctx.fillText("Sin datos de evolución",W/2,H/2);return null;
    }
    let anios=(reg.anios||[]).slice();
    if(!anios.length){
      [2023,2024,2025,2026,2027].forEach(function(a){if(reg["valor_"+a]!=null)anios.push(a);});
    }
    const datos=anios.map(function(an){
      let v=reg["valor_"+an];
      if(v==null&&reg.evolucion){const it=reg.evolucion.find(function(e){return e.anio===an;});v=it?.valor_m2;}
      return{anio:an,valor:v!=null?Number(v):null};
    }).filter(function(d){return d.valor!=null;});
    if(!datos.length){
      ctx.fillStyle="#94a3b8";ctx.font="14px Segoe UI,sans-serif";ctx.textAlign="center";
      ctx.fillText("Sin valores registrados",W/2,H/2);return null;
    }
    const padL=52,padR=20,padT=28,padB=48,chartW=W-padL-padR,chartH=H-padT-padB;
    const maxVal=Math.max.apply(null,datos.map(function(d){return d.valor;}))*1.12;
    const barW=Math.min(68,chartW/(datos.length*1.8));
    const gap=(chartW-barW*datos.length)/(datos.length+1);
    ctx.strokeStyle="#cbd5e1";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(padL,padT);ctx.lineTo(padL,padT+chartH);ctx.lineTo(padL+chartW,padT+chartH);ctx.stroke();
    ctx.fillStyle="#64748b";ctx.font="10px Segoe UI,sans-serif";ctx.textAlign="right";
    for(let i=0;i<=4;i++){
      const yVal=maxVal*(1-i/4),y=padT+(chartH*i)/4;
      ctx.fillText("$"+yVal.toLocaleString("es-MX",{maximumFractionDigits:0}),padL-6,y+4);
      ctx.strokeStyle="#f1f5f9";ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+chartW,y);ctx.stroke();
    }
    ctx.textAlign="center";
    datos.forEach(function(d,i){
      const x=padL+gap+i*(barW+gap),h=(d.valor/maxVal)*chartH,y=padT+chartH-h;
      ctx.fillStyle=colorAnioAnalisisFicha(d.anio,i);ctx.fillRect(x,y,barW,h);
      ctx.fillStyle="#0f172a";ctx.font="bold 10px Segoe UI,sans-serif";
      ctx.fillText("$"+d.valor.toLocaleString("es-MX",{maximumFractionDigits:0}),x+barW/2,y-5);
      ctx.fillStyle="#475569";ctx.font="11px Segoe UI,sans-serif";
      ctx.fillText(String(d.anio),x+barW/2,padT+chartH+16);
    });
    ctx.fillStyle="#334155";ctx.font="bold 11px Segoe UI,sans-serif";
    ctx.fillText(reg.clave_zonah||reg.codigo_zona_homogenea||"",W/2,H-6);
    try{return canvas.toDataURL("image/png");}catch(e){return null;}
  }
  function initChartFichaAnalisis(){
    dibujarChartFichaAnalisis();
    const variacion=document.getElementById("previewAnalisisVariacion");
    const reg=catalogoAnalisisFicha;
    if(!variacion||!reg)return;
    if(reg.variacion_pct!=null){
      const signo=reg.variacion_abs>=0?"+":"";
      const anios=reg.anios||[2023,2024,2025,2026];
      const desde=reg.variacion_desde||anios[0],hasta=reg.variacion_hasta||anios[anios.length-1];
      variacion.innerHTML="Variación "+desde+"→"+hasta+": <b>"+signo+reg.variacion_pct+"%</b>";
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initChartFichaAnalisis);
  else initChartFichaAnalisis();
  `;
}

function buildFichaAnalisisMapScript(featuresJson) {
  const geoJson = JSON.stringify(featuresJson || { type: "FeatureCollection", features: [] });
  const capasRuntime = typeof buildFichaMapaCapasRuntimeScript === "function"
    ? buildFichaMapaCapasRuntimeScript({
        ordenDef: { zona: 50, coloniasWms: 8, prediosWms: 10, zonasWms: 6 },
        capaProp: {
          zona: "capaZona",
          coloniasWms: "capaColonias",
          prediosWms: "capaPredios",
          zonasWms: "capaZonasWms"
        },
        chkMap: {
          zona: "analisisChkZona",
          coloniasWms: "analisisChkColoniasWms",
          prediosWms: "analisisChkPrediosWms",
          zonasWms: "analisisChkZonasWms"
        },
        optionalIds: ["coloniasWms", "prediosWms"],
        capasVar: "window.__analisisPreviewCapas",
        mapVar: "previewMapAnalisis",
        overlayListId: "analisisCapasOverlayList",
        opPrefix: "analisisOp",
        toggleFn: "toggleCapaFichaAnalisis",
        opacityFn: "cambiarOpacidadCapaFichaAnalisis",
        subirFn: "subirCapaFichaAnalisis",
        bajarFn: "bajarCapaFichaAnalisis",
        initFn: "inicializarOrdenCapasFichaAnalisis"
      })
    : "";

  return `
  let previewMapAnalisis=null;
  const featuresAnalisis=${geoJson};
  ${capasRuntime}

  function crearWmsAnalisis(url,layers,visible,opacity,zIndex){
    return new ol.layer.Tile({visible:!!visible,opacity:opacity==null?0.72:opacity,zIndex:zIndex==null?6:zIndex,
      source:new ol.source.TileWMS({url:url,params:{LAYERS:layers,TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},serverType:"geoserver",crossOrigin:"anonymous"})});
  }
  function estiloZonaAnalisis(){
    return[
      new ol.style.Style({zIndex:49,stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.92)",width:7,lineDash:[10,6]})}),
      new ol.style.Style({zIndex:50,stroke:new ol.style.Stroke({color:"#111827",width:5,lineDash:[10,6]})})
    ];
  }
  function mostrarErrorMapaAnalisis(msg){
    const el=document.getElementById("previewAnalisisMap");
    if(el)el.innerHTML='<div class="analisis-map-error">'+String(msg||"Error de mapa")+'</div>';
    document.getElementById("previewAnalisisMapLoading")?.classList.add("oculto");
    const btn=document.getElementById("btnImprimirAnalisis");if(btn){btn.disabled=false;btn.textContent="Imprimir / Guardar PDF";}
  }
  function iniciarMapaFichaAnalisis(){
    const targetEl=document.getElementById("previewAnalisisMap");
    if(!targetEl||typeof ol==="undefined"||!ol.Map){mostrarErrorMapaAnalisis("OpenLayers no está disponible.");return;}
    if(previewMapAnalisis)return;
    const wmsLayer=featuresAnalisis.wmsLayer||"${FICHA_ANALISIS_WMS_ZONAS}";
    const baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseGoogleRoad=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    const baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});
    const capaZonasWms=crearWmsAnalisis("${FICHA_ANALISIS_GEONODE_WMS}",wmsLayer,true,0.72,6);
    const capaPredios=crearWmsAnalisis("${FICHA_ANALISIS_CATASTRO_WMS}","catastro_bc:predios_oficial",false,0.45,10);
    const capaColonias=crearWmsAnalisis("${FICHA_ANALISIS_GEONODE_WMS}","colonias",false,0.55,8);
    const srcZona=new ol.source.Vector();
    const format=new ol.format.GeoJSON({dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"});
    (featuresAnalisis.features||[]).forEach(function(f){
      const feats=format.readFeatures({type:"Feature",geometry:f.geometry,properties:f.properties||{}});
      srcZona.addFeatures(feats);
    });
    const capaZona=new ol.layer.Vector({source:srcZona,zIndex:50,style:estiloZonaAnalisis()});
    previewMapAnalisis=new ol.Map({target:"previewAnalisisMap",layers:[baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaZonasWms,capaColonias,capaPredios,capaZona],
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:15}),controls:[]});
    window.__analisisPreviewCapas={baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaZonasWms,capaColonias,capaPredios,capaZona};
    window.__analisisVistaUsuario=false;
    if(typeof inicializarOrdenCapasFichaAnalisis==="function")inicializarOrdenCapasFichaAnalisis();
    if(typeof actualizarCapasFichaAnalisis==="function")actualizarCapasFichaAnalisis();
    function marcarVistaUsuarioAnalisis(){window.__analisisVistaUsuario=true;}
    targetEl.addEventListener("wheel",marcarVistaUsuarioAnalisis,{passive:true});
    previewMapAnalisis.on("pointerdrag",marcarVistaUsuarioAnalisis);
    function marcarMapaListoAnalisis(){
      document.getElementById("previewAnalisisMapLoading")?.classList.add("oculto");
      const btn=document.getElementById("btnImprimirAnalisis");if(btn){btn.disabled=false;btn.textContent="Imprimir / Guardar PDF";}
      const aviso=document.getElementById("analisisMapaEstado");if(aviso)aviso.textContent="Mapa listo. Ajuste capas y pulse «Imprimir / Guardar PDF».";
    }
    function centrar(forzar){
      if(!previewMapAnalisis)return;
      if(!forzar&&window.__analisisVistaUsuario)return;
      if(typeof aplicarAltoMapaAnalisis==="function")aplicarAltoMapaAnalisis();
      previewMapAnalisis.updateSize();
      const ext=srcZona.getExtent();
      let fitExt=ext;
      if(ext&&Number.isFinite(ext[0])&&typeof ol.extent.buffer==="function")fitExt=ol.extent.buffer(ext,180);
      if(fitExt&&Number.isFinite(fitExt[0])){
        previewMapAnalisis.getView().fit(fitExt,{padding:[36,36,36,36],maxZoom:17,duration:forzar?0:250});
      }else if(featuresAnalisis.centroide&&featuresAnalisis.centroide.lon!=null){
        previewMapAnalisis.getView().setCenter(ol.proj.fromLonLat([featuresAnalisis.centroide.lon,featuresAnalisis.centroide.lat]));
        previewMapAnalisis.getView().setZoom(16);
      }
      try{previewMapAnalisis.renderSync();}catch(e){}
    }
    window.centrarMapaFichaAnalisis=function(){window.__analisisVistaUsuario=false;centrar(true);};
    previewMapAnalisis.once("rendercomplete",function(){marcarMapaListoAnalisis();centrar(true);});
    setTimeout(function(){centrar(true);},120);
    setTimeout(function(){centrar(true);},700);
    setTimeout(function(){centrar(true);},1400);
  }
  function bootMapaFichaAnalisis(){
    function arrancar(){
      if(typeof ajustarPapelAnalisis==="function")ajustarPapelAnalisis({});
      if(typeof aplicarAltoMapaAnalisis==="function")aplicarAltoMapaAnalisis();
      try{iniciarMapaFichaAnalisis();}catch(e){mostrarErrorMapaAnalisis("No se pudo iniciar el plano.");}
    }
    if(typeof ol!=="undefined"&&ol.Map){setTimeout(arrancar,100);return;}
    const s=document.createElement("script");s.src="${FICHA_ANALISIS_OL_JS}";
    s.onload=function(){setTimeout(arrancar,100);};s.onerror=function(){mostrarErrorMapaAnalisis("No se pudo cargar OpenLayers.");};
    document.body.appendChild(s);
  }
  function toggleLayerPanelAnalisis(){document.getElementById("analisisLayerPanel")?.classList.toggle("oculto");}
  function actualizarCapasFichaAnalisis(){
    ["zona","zonasWms","prediosWms","coloniasWms"].forEach(toggleCapaFichaAnalisis);
  }
  window.actualizarCapasFichaAnalisis=actualizarCapasFichaAnalisis;
  function cambiarBaseFichaAnalisis(){
    const c=window.__analisisPreviewCapas;if(!c)return;
    const v=document.querySelector('input[name="analisisBasemap"]:checked')?.value||"googleHybrid";
    c.baseGoogleHybrid.setVisible(v==="googleHybrid");c.baseGoogleRoad.setVisible(v==="googleRoad");
    c.baseEsri.setVisible(v==="esri");c.baseOSM.setVisible(v==="osm");previewMapAnalisis&&previewMapAnalisis.render();
  }
  function zoomMasAnalisis(){if(previewMapAnalisis){window.__analisisVistaUsuario=true;previewMapAnalisis.getView().setZoom((previewMapAnalisis.getView().getZoom()||16)+1);}}
  function zoomMenosAnalisis(){if(previewMapAnalisis){window.__analisisVistaUsuario=true;previewMapAnalisis.getView().setZoom((previewMapAnalisis.getView().getZoom()||16)-1);}}
  function capturarMapaFichaAnalisis(mapInst,timeoutMs){
    timeoutMs=timeoutMs||5000;
    return new Promise(function(resolve){
      let resuelto=false;
      const fin=function(img){if(!resuelto){resuelto=true;resolve(img);}};
      if(!mapInst||typeof mapInst.once!=="function"){fin(null);return;}
      setTimeout(function(){fin(null);},timeoutMs);
      try{
        const target=mapInst.getTargetElement?mapInst.getTargetElement():null;
        mapInst.once("rendercomplete",function(){
          try{
            const size=mapInst.getSize(),canvasFinal=document.createElement("canvas");
            canvasFinal.width=size[0];canvasFinal.height=size[1];
            const ctx=canvasFinal.getContext("2d");
            const scope=target||document;
            Array.prototype.forEach.call(scope.querySelectorAll(".ol-layer canvas, canvas.ol-layer"),function(canvas){
              try{
                if(canvas.width>0){
                  const opacity=canvas.parentNode.style.opacity||canvas.style.opacity;
                  ctx.globalAlpha=opacity===""?1:Number(opacity);
                  let matrix;const transform=canvas.style.transform;
                  if(transform&&transform.startsWith("matrix"))matrix=transform.match(/^matrix\\(([^\\(]*)\\)$/)[1].split(",").map(Number);
                  else matrix=[1,0,0,1,0,0];
                  CanvasRenderingContext2D.prototype.setTransform.apply(ctx,matrix);
                  ctx.drawImage(canvas,0,0);
                }
              }catch(e){}
            });
            ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
            fin(canvasFinal.toDataURL("image/png"));
          }catch(e){fin(null);}
        });
        mapInst.renderSync();
      }catch(e){fin(null);}
    });
  }
  function prepararImpresionAnalisis(){
    return new Promise(function(resolve){
      esperarLayoutImpresionAnalisis(function(){
        document.body.classList.add("ficha-analisis-imprimiendo");
        const imgMap=document.getElementById("previewAnalisisMapPrintImg");
        const imgChart=document.getElementById("previewAnalisisChartPrintImg");
        let chartOk=false;
        if(typeof dibujarChartFichaAnalisis==="function"){
          const off=document.createElement("canvas");
          off.width=1200;off.height=150;
          const chartUrl=dibujarChartFichaAnalisis(off);
          if(chartUrl&&imgChart){
            imgChart.src=chartUrl;
            imgChart.classList.add("activo");
            chartOk=true;
          }
        }
        if(!previewMapAnalisis||!imgMap){
          resolve(chartOk);
          return;
        }
        previewMapAnalisis.updateSize();
        try{previewMapAnalisis.renderSync();}catch(e){}
        setTimeout(function(){
          capturarMapaFichaAnalisis(previewMapAnalisis,6000).then(function(dataUrl){
            if(dataUrl){
              imgMap.src=dataUrl;
              imgMap.classList.add("activo");
              document.getElementById("previewAnalisisMapWrap")?.classList.add("analisis-print-listo");
            }
            resolve(!!dataUrl||chartOk);
          });
        },420);
      });
    });
  }
  function esperarLayoutImpresionAnalisis(callback){
    let paso=0;
    function tick(){
      if(typeof ajustarPapelAnalisis==="function")ajustarPapelAnalisis({impresion:true});
      if(typeof aplicarAltoMapaAnalisis==="function")aplicarAltoMapaAnalisis();
      if(previewMapAnalisis){previewMapAnalisis.updateSize();try{previewMapAnalisis.renderSync();}catch(e){}}
      paso++;
      if(paso>=4){setTimeout(callback,180);return;}
      setTimeout(tick,paso<2?120:180);
    }
    tick();
  }
  function imprimirFichaAnalisis(){
    const btn=document.getElementById("btnImprimirAnalisis");if(btn)btn.disabled=true;
    prepararImpresionAnalisis().then(function(){
      function onAfterPrint(){restaurarImpresionAnalisis();if(btn)btn.disabled=false;window.removeEventListener("afterprint",onAfterPrint);}
      window.addEventListener("afterprint",onAfterPrint);
      setTimeout(function(){window.print();},500);
    });
  }
  function restaurarImpresionAnalisis(){
    document.body.classList.remove("ficha-analisis-imprimiendo");
    ["previewAnalisisMapPrintImg","previewAnalisisChartPrintImg"].forEach(function(id){
      const el=document.getElementById(id);if(el){el.classList.remove("activo");el.removeAttribute("src");}
    });
    document.getElementById("previewAnalisisMapWrap")?.classList.remove("analisis-print-listo");
    if(typeof ajustarPapelAnalisis==="function")ajustarPapelAnalisis({});
    if(previewMapAnalisis){previewMapAnalisis.updateSize();try{previewMapAnalisis.renderSync();}catch(e){}}
  }
  window.toggleLayerPanelAnalisis=toggleLayerPanelAnalisis;window.cambiarBaseFichaAnalisis=cambiarBaseFichaAnalisis;
  window.zoomMasAnalisis=zoomMasAnalisis;window.zoomMenosAnalisis=zoomMenosAnalisis;window.imprimirFichaAnalisis=imprimirFichaAnalisis;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootMapaFichaAnalisis);else bootMapaFichaAnalisis();
  `;
}

function buildFichaAnalisisLayoutScript() {
  return `
  const FICHA_PAPEL_ANALISIS={carta:{ancho:8.5,alto:11},legal:{ancho:8.5,alto:14}};
  let fichaAnalisisPapel="legal",fichaAnalisisOrientacion="landscape";
  function dimensionesPaginaAnalisis(){
    const base=FICHA_PAPEL_ANALISIS[fichaAnalisisPapel]||FICHA_PAPEL_ANALISIS.legal;
    return fichaAnalisisOrientacion==="landscape"?{ancho:base.alto,alto:base.ancho}:{ancho:base.ancho,alto:base.alto};
  }
  function aplicarReglaPaginaAnalisis(){
    let style=document.getElementById("analisisPageRule");
    if(!style){style=document.createElement("style");style.id="analisisPageRule";document.head.appendChild(style);}
    const d=dimensionesPaginaAnalisis(),ori=fichaAnalisisOrientacion==="landscape"?"landscape":"portrait";
    style.textContent="@media print{@page{size:"+d.ancho+"in "+d.alto+"in "+ori+";margin:3mm;}}";
  }
  function mapInToPx(mapIn){const inch=parseFloat(mapIn);return isNaN(inch)||inch<=0?320:Math.max(180,Math.round(inch*96));}
  function aplicarAltoMapaAnalisis(){
    const mapEl=document.getElementById("previewAnalisisMap");
    const wrapEl=document.getElementById("previewAnalisisMapWrap");
    const mapIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-map").trim();
    if(mapIn&&wrapEl){
      const px=mapInToPx(mapIn),pxCss=px+"px";
      wrapEl.style.height=pxCss;wrapEl.style.minHeight=pxCss;wrapEl.style.maxHeight=pxCss;
      ["previewAnalisisMapLoading","previewAnalisisMapPrintImg"].forEach(function(id){
        const el=document.getElementById(id);if(el){el.style.height="100%";el.style.minHeight="100%";}
      });
      if(mapEl){mapEl.style.width="100%";mapEl.style.height="100%";}
    }
    const chartIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-chart").trim();
    const chartWrap=document.getElementById("previewAnalisisChartWrap");
    if(chartIn&&chartWrap){
      const px=mapInToPx(chartIn),pxCss=px+"px";
      chartWrap.style.minHeight=pxCss;
      const cv=document.getElementById("previewAnalisisChart");
      if(cv){cv.style.maxHeight=pxCss;}
    }
    if(typeof previewMapAnalisis!=="undefined"&&previewMapAnalisis){previewMapAnalisis.updateSize();try{previewMapAnalisis.renderSync();}catch(e){}}
  }
  function medirReservadoAnalisisIn(){
    const cont=document.querySelector(".contenedor");
    if(!cont)return fichaAnalisisOrientacion==="landscape"?0.98:2.0;
    let px=0;
    Array.from(cont.children).forEach(function(el){
      if(el.classList.contains("seccion-mapa")||el.classList.contains("seccion-grafica"))return;
      px+=el.getBoundingClientRect().height;
    });
    cont.querySelectorAll(".seccion-mapa .media-head,.seccion-grafica .media-head").forEach(function(h){
      px+=h.getBoundingClientRect().height;
    });
    const variacion=document.getElementById("previewAnalisisVariacion");
    if(variacion)px+=variacion.getBoundingClientRect().height;
    const minRes=fichaAnalisisOrientacion==="landscape"?0.92:1.75;
    return Math.max(minRes,px/96+0.015);
  }
  function chartReservadoAnalisisIn(esImpresion){
    if(fichaAnalisisOrientacion==="landscape")return esImpresion?1.08:0.98;
    return esImpresion?1.22:1.42;
  }
  function ajustarPapelAnalisis(opciones){
    opciones=opciones||{};const esImpresion=!!opciones.impresion;const d=dimensionesPaginaAnalisis();const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",d.ancho+"in");root.style.setProperty("--ficha-alto",d.alto+"in");
    document.body.classList.remove("papel-carta","papel-legal","orient-portrait","orient-landscape");
    document.body.classList.add("papel-"+fichaAnalisisPapel,"orient-"+fichaAnalisisOrientacion);
    aplicarReglaPaginaAnalisis();
    const margenPagina=esImpresion?0.04:0.06,altoPagina=esImpresion?(d.alto-margenPagina*2):d.alto;
    let reservado=medirReservadoAnalisisIn();
    const chartIn=chartReservadoAnalisisIn(esImpresion);
    root.style.setProperty("--ficha-media-chart",chartIn+"in");
    let mapIn=altoPagina-reservado-chartIn-(esImpresion?0.03:0.04);
    const maxMap=altoPagina-reservado-chartIn-0.02;
    if(fichaAnalisisOrientacion==="landscape"){
      const minMap=esImpresion?4.35:5.0;
      mapIn=Math.max(minMap,Math.min(+maxMap.toFixed(2),+mapIn.toFixed(2)));
    }else{
      const minMap=esImpresion?2.55:2.95;
      mapIn=Math.max(minMap,Math.min(+maxMap.toFixed(2),+mapIn.toFixed(2)));
    }
    root.style.setProperty("--ficha-media-map",mapIn+"in");
    const contenidoAlto=(reservado+mapIn+chartIn+0.01).toFixed(2);
    root.style.setProperty("--ficha-contenido-alto",contenidoAlto+"in");
    requestAnimationFrame(aplicarAltoMapaAnalisis);
  }
  function setTamanoPapelAnalisis(tipo){fichaAnalisisPapel=(tipo==="legal")?"legal":"carta";requestAnimationFrame(function(){ajustarPapelAnalisis({});});}
  function setOrientacionAnalisis(tipo){fichaAnalisisOrientacion=(tipo==="landscape")?"landscape":"portrait";requestAnimationFrame(function(){ajustarPapelAnalisis({});});}
  window.ajustarPapelAnalisis=ajustarPapelAnalisis;window.setTamanoPapelAnalisis=setTamanoPapelAnalisis;
  window.setOrientacionAnalisis=setOrientacionAnalisis;window.aplicarAltoMapaAnalisis=aplicarAltoMapaAnalisis;
  function initLayoutAnalisis(){
    setTimeout(function(){ajustarPapelAnalisis({});},80);
    setTimeout(function(){ajustarPapelAnalisis({});},500);
    setTimeout(function(){
      ajustarPapelAnalisis({});
      if(typeof centrarMapaFichaAnalisis==="function")centrarMapaFichaAnalisis();
    },1400);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initLayoutAnalisis);
  else initLayoutAnalisis();
  window.addEventListener("resize",function(){
    clearTimeout(window.__analisisResizeT);
    window.__analisisResizeT=setTimeout(function(){
      ajustarPapelAnalisis({});
      if(typeof centrarMapaFichaAnalisis==="function")centrarMapaFichaAnalisis();
    },160);
  });
  `;
}

function construirHtmlFichaAnalisisZonaVentana(reg, geoData, opciones) {
  opciones = opciones || {};
  const baseHref = String(opciones.baseHref || "./");
  const cod = fichaAnalisisEsc(reg.clave_zonah || reg.codigo_zona_homogenea || geoData?.codigo || "—");
  const descripcion = fichaAnalisisEsc(reg.descripcion_col_fracc || "—");
  const zonaSector = fichaAnalisisEsc(
    "Zona: " + (reg.zona || "—") + " · Sector: " + (reg.sector || "—") + " · Subsector: " + (reg.subsector || "—")
  );
  const fechaTxt = new Date().toLocaleString("es-MX");
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const anios = (reg.anios && reg.anios.length)
    ? reg.anios.slice()
    : (typeof obtenerAniosAnalisisZonas === "function" ? obtenerAniosAnalisisZonas() : [2023, 2024, 2025, 2026]);
  const catalogoPayload = Object.assign({}, reg, { anios: anios });
  const featuresPayload = serializarFeaturesAnalisisZona(geoData);

  let valoresInline = anios.map(function(an) {
    const val = reg["valor_" + an] != null
      ? reg["valor_" + an]
      : ((reg.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
    return fichaAnalisisEsc(an + ": " + (val != null ? fichaAnalisisFormatMoneda(val) : "—"));
  }).join(" &nbsp;|&nbsp; ");

  const mapScript = buildFichaAnalisisMapScript(featuresPayload);
  const chartScript = buildFichaAnalisisChartScript(catalogoPayload);
  const layoutScript = buildFichaAnalisisLayoutScript();

  return `<!DOCTYPE html>
<html lang="es" class="papel-legal orient-landscape">
<head>
<meta charset="UTF-8">
<base href="${fichaAnalisisEsc(baseHref)}">
<title>Ficha zona homogénea ${cod}</title>
<link rel="stylesheet" href="${FICHA_ANALISIS_OL_CSS}">
<style>
:root{--guinda:#703341;--guinda-claro:#d8bdc5;--texto-valor:#1e293b;--ficha-ancho:14in;--ficha-alto:8.5in;--ficha-media-map:5.4in;--ficha-media-chart:0.98in;}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto-valor);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar button:disabled{opacity:.55;cursor:not-allowed;}
.toolbar-papel{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569;font-weight:700;}
.toolbar-papel select{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;color:#334155;background:#fff;}
.analisis-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(220px,1fr);gap:10px;font-size:12px;}
.analisis-layer-panel.oculto{display:none!important;}
.analisis-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.analisis-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
.contenedor{width:min(100%,var(--ficha-ancho));max-width:var(--ficha-ancho);min-height:var(--ficha-contenido-alto,var(--ficha-alto));height:auto;margin:12px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);border:1px solid var(--guinda);border-radius:6px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;}
.encabezado-compacto{background:var(--guinda)!important;color:#fff!important;padding:5px 10px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;border-bottom:2px solid #c9a227;}
.enc-logo img{height:38px;max-width:150px;object-fit:contain;background:#fff;padding:2px 6px;border-radius:4px;}
.enc-centro h1{margin:0;font-size:13px;font-weight:900;color:#fff!important;letter-spacing:.3px;line-height:1.15;}
.enc-centro .sub{margin:2px 0 0;font-size:8px;color:#f8e8ec;font-weight:600;}
.enc-meta{text-align:right;font-size:7.5px;line-height:1.35;color:#fff;font-weight:700;}
.grid-compacto{padding:4px 8px 5px;border-bottom:1px solid var(--guinda-claro);font-size:8px;line-height:1.35;background:#fafafa;}
.grid-compacto .fila{display:flex;flex-wrap:wrap;gap:4px 14px;margin:2px 0;}
.grid-compacto b{color:var(--guinda);}
.grid-compacto .valores{color:#334155;font-weight:700;}
.seccion-mapa,.seccion-grafica{border-top:1px solid var(--guinda-claro);flex:0 0 auto;display:flex;flex-direction:column;}
.seccion-grafica{min-height:var(--ficha-media-chart);}
.seccion-mapa .media-head,.seccion-grafica .media-head{background:var(--guinda);color:#fff;padding:2px 8px;font-size:7.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;flex:0 0 auto;}
.analisis-map-wrap{position:relative;width:100%;height:var(--ficha-media-map);min-height:var(--ficha-media-map);max-height:var(--ficha-media-map);flex:0 0 auto;overflow:hidden;background:#eaeaea;line-height:0;border-bottom:2px solid var(--guinda);box-sizing:border-box;}
#previewAnalisisMap{position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#eaeaea;}
.analisis-map-print{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;background:#eaeaea;z-index:1;}
.analisis-map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(234,234,234,.92);color:#703341;font-size:12px;font-weight:700;z-index:4;}
.analisis-map-loading.oculto{display:none!important;}
.analisis-chart-wrap{padding:2px 6px 1px;background:#fff;text-align:center;flex:0 0 auto;min-height:var(--ficha-media-chart);max-height:var(--ficha-media-chart);overflow:hidden;}
#previewAnalisisChart{width:100%;max-width:100%;height:auto;max-height:calc(var(--ficha-media-chart) - 0.22in);border:1px solid #e2e8f0;border-radius:4px;}
.analisis-chart-print{display:none;width:100%;max-width:100%;height:auto;max-height:calc(var(--ficha-media-chart) - 0.18in);margin:0 auto;object-fit:contain;}
.analisis-chart-print.activo{display:block;}
.preview-analisis-variacion{font-size:8px;color:#475569;margin-top:1px;font-weight:700;line-height:1.2;}
.pie-ficha{display:flex;justify-content:space-between;align-items:center;padding:3px 8px 4px;border-top:1px solid var(--guinda-claro);font-size:8px;color:var(--guinda);font-weight:700;flex:0 0 auto;}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:6px 8px;font-style:italic;}
.analisis-map-error{padding:20px;text-align:center;color:#b91c1c;font-size:12px;}
@media print{
  html,body{width:var(--ficha-ancho);height:auto;margin:0!important;padding:0!important;background:#fff!important;}
  .toolbar,.analisis-layer-panel,.aviso-impresion{display:none!important;}
  .contenedor{width:var(--ficha-ancho)!important;max-width:var(--ficha-ancho)!important;min-height:var(--ficha-alto)!important;height:var(--ficha-contenido-alto,var(--ficha-alto))!important;margin:0 auto!important;box-shadow:none!important;border-radius:0!important;page-break-after:avoid;page-break-inside:avoid;overflow:visible!important;}
  .seccion-mapa,.seccion-grafica{flex:0 0 auto!important;display:flex!important;}
  .seccion-grafica{min-height:var(--ficha-media-chart)!important;}
  .analisis-map-wrap{height:var(--ficha-media-map)!important;min-height:var(--ficha-media-map)!important;max-height:var(--ficha-media-map)!important;flex:0 0 auto!important;}
  #previewAnalisisMap{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;}
  body.ficha-analisis-imprimiendo .analisis-map-wrap.analisis-print-listo #previewAnalisisMap{display:none!important;}
  body.ficha-analisis-imprimiendo .analisis-map-print.activo{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  body.ficha-analisis-imprimiendo #previewAnalisisChart{display:none!important;}
  body.ficha-analisis-imprimiendo .analisis-chart-wrap{
    min-height:var(--ficha-media-chart)!important;
    max-height:none!important;
    overflow:visible!important;
    padding:2px 6px 1px!important;
  }
  body.ficha-analisis-imprimiendo .analisis-chart-print.activo{
    display:block!important;
    width:100%!important;
    max-width:100%!important;
    height:auto!important;
    max-height:calc(var(--ficha-media-chart) - 0.18in)!important;
    object-fit:contain!important;
    -webkit-print-color-adjust:exact!important;
    print-color-adjust:exact!important;
  }
  body.ficha-analisis-imprimiendo .preview-analisis-variacion{display:block!important;margin-top:1px!important;font-size:8px!important;}
  body.ficha-analisis-imprimiendo .pie-ficha{padding:2px 8px 3px!important;}
  body.ficha-analisis-imprimiendo .encabezado-compacto{padding:3px 8px!important;}
  body.ficha-analisis-imprimiendo .grid-compacto{padding:2px 6px 3px!important;font-size:7px!important;}
}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="zoomMasAnalisis()">Zoom +</button>
    <button type="button" onclick="zoomMenosAnalisis()">Zoom −</button>
    <button type="button" onclick="centrarMapaFichaAnalisis&&centrarMapaFichaAnalisis()">Centrar</button>
    <label class="toolbar-papel"><select id="tamanoPapelAnalisis" onchange="setTamanoPapelAnalisis(this.value)"><option value="carta">Carta 8.5×11</option><option value="legal" selected>Oficio 8.5×14</option></select></label>
    <label class="toolbar-papel"><select id="orientacionAnalisis" onchange="setOrientacionAnalisis(this.value)"><option value="portrait">Vertical</option><option value="landscape" selected>Horizontal</option></select></label>
    <button type="button" class="sec" onclick="toggleLayerPanelAnalisis()">Capas</button>
    <button type="button" id="btnImprimirAnalisis" disabled onclick="imprimirFichaAnalisis()">Cargando mapa…</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaAnalisisLayerPanelHtml()}
  <div class="aviso-impresion" id="analisisMapaEstado">Cargando plano cartográfico…</div>
  <div class="contenedor">
    <header class="encabezado-compacto">
      <div class="enc-logo"><img src="${LOGO_FICHA_ANALISIS_ZONA_URL}" alt="Gobierno de Mexicali"></div>
      <div class="enc-centro">
        <h1>FICHA DE ZONA HOMOGÉNEA</h1>
        <p class="sub">Ubicación cartográfica y evolución del valor unitario de suelo</p>
      </div>
      <div class="enc-meta">
        <div>${fichaAnalisisEsc(fechaTxt)}</div>
        <div>Código: ${cod}</div>
      </div>
    </header>
    <div class="grid-compacto">
      <div class="fila"><span><b>Código:</b> ${cod}</span><span><b>Descripción:</b> ${descripcion}</span></div>
      <div class="fila"><span>${zonaSector}</span></div>
      <div class="fila valores">${valoresInline}</div>
    </div>
    <section class="seccion-mapa">
      <div class="media-head">Ubicación cartográfica</div>
      <div class="analisis-map-wrap" id="previewAnalisisMapWrap">
        <div id="previewAnalisisMapLoading" class="analisis-map-loading">Cargando plano…</div>
        <img id="previewAnalisisMapPrintImg" class="analisis-map-print" alt="">
        <div id="previewAnalisisMap"></div>
      </div>
    </section>
    <section class="seccion-grafica">
      <div class="media-head">Evolución del valor unitario</div>
      <div class="analisis-chart-wrap" id="previewAnalisisChartWrap">
        <canvas id="previewAnalisisChart" width="1200" height="150"></canvas>
        <img id="previewAnalisisChartPrintImg" class="analisis-chart-print" alt="Gráfica evolución">
        <div class="preview-analisis-variacion" id="previewAnalisisVariacion"></div>
      </div>
    </section>
    <div class="pie-ficha"><span>${cod} · ${fichaAnalisisEsc(FICHA_ANALISIS_WMS_ZONAS)}</span><span>${fichaAnalisisEsc(fechaPie)}</span></div>
  </div>
  <script>${layoutScript}<\/script>
  <script>${chartScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirPreviewFichaAnalisisZonaHomogenea(regOpt) {
  const reg = regOpt || (typeof registroAnalisisZonasActual === "function" ? registroAnalisisZonasActual() : null);
  if (!reg) {
    alert("Seleccione una zona homogénea.");
    return null;
  }

  const cod = String(reg.clave_zonah || reg.codigo_zona_homogenea || "").trim().toUpperCase();
  if (!cod) {
    alert("La zona seleccionada no tiene código cartográfico.");
    return null;
  }

  let geoData = null;
  try {
    const r = await fetch(
      `${API}/padron/analisis/zonas-homogeneas/${encodeURIComponent(cod)}/geometria?_=${Date.now()}`,
      { cache: "no-store", headers: typeof authHeaders === "function" ? authHeaders() : {} }
    );
    const data = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(data.detail || r.statusText || "No se pudo consultar geometría");
    geoData = data;
  } catch (e) {
    alert(e.message || "No se pudo cargar la geometría cartográfica.");
    return null;
  }

  if (!geoData?.geometry) {
    alert("Sin geometría cartográfica para generar la ficha.");
    return null;
  }

  const baseHref = window.location.href.replace(/[^/]*$/, "");
  const htmlFicha = construirHtmlFichaAnalisisZonaVentana(reg, geoData, { baseHref });
  if (typeof abrirVentanaHtmlFichaInstitucional === "function") {
    return abrirVentanaHtmlFichaInstitucional(htmlFicha, "width=1280,height=940");
  }
  const win = window.open("", "_blank", "width=1280,height=940");
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

window.abrirPreviewFichaAnalisisZonaHomogenea = abrirPreviewFichaAnalisisZonaHomogenea;
window.construirHtmlFichaAnalisisZonaVentana = construirHtmlFichaAnalisisZonaVentana;
