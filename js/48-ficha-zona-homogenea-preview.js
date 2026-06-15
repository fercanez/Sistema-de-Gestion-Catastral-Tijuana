/* Ficha de zona homogénea — vista previa e impresión (mapa + gráfica evolución) */

const LOGO_FICHA_ZONA_URL = "logomxli.png";
const FICHA_ZONA_OL_CSS = typeof OL_FICHA_CSS !== "undefined"
  ? OL_FICHA_CSS
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const FICHA_ZONA_OL_JS = typeof OL_FICHA_CDN !== "undefined"
  ? OL_FICHA_CDN
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const FICHA_ZONA_GEONODE_WMS = typeof POPUP_ZONA_GEONODE_WMS !== "undefined"
  ? POPUP_ZONA_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const FICHA_ZONA_CATASTRO_WMS = typeof POPUP_ZONA_CATASTRO_WMS !== "undefined"
  ? POPUP_ZONA_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const FICHA_ZONA_WMS_LAYER = typeof POPUP_ZONA_WMS_LAYER !== "undefined"
  ? POPUP_ZONA_WMS_LAYER
  : "zonas_homogeneas";

function fichaZonaEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaZonaVal(valor) {
  if (valor == null || String(valor).trim() === "") return "—";
  return String(valor).trim();
}

function fichaZonaFormatMoneda(valor) {
  if (typeof formatoMoneda === "function") return formatoMoneda(valor);
  if (valor == null || valor === "") return "—";
  return "$" + Number(valor).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fichaZonaAtributos(zonaData) {
  return zonaData?.zona_carto?.atributos
    || (typeof popupZonaNormalizarAtributos === "function"
      ? popupZonaNormalizarAtributos(zonaData?.zona_carto?.properties)
      : {});
}

function serializarFeaturesZonaFicha(zonaData) {
  const features = [];
  if (zonaData?.geometry) {
    features.push({
      type: "Feature",
      geometry: zonaData.geometry,
      properties: { clave_catastral: zonaData.clave_catastral, es_consultado: true }
    });
  }
  if (zonaData?.zona_carto?.geometry) {
    features.push({
      type: "Feature",
      geometry: zonaData.zona_carto.geometry,
      properties: { es_zona: true }
    });
  }
  return {
    type: "FeatureCollection",
    features,
    wmsLayer: zonaData?.wms_layer || FICHA_ZONA_WMS_LAYER,
    centroide: zonaData?.centroide || null,
    catalogo: zonaData?.catalogo || null,
    zonah: zonaData?.zonah || ""
  };
}

function fichaZonaLayerPanelHtml() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "zonaChkPredio", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "zona", checkboxId: "zonaChkZona", dotClass: "dot-amber", label: "Límite zona homogénea", checked: true, opacity: 100 },
        { id: "zonasWms", checkboxId: "zonaChkZonasWms", dotClass: "dot-green", label: "Zonas homogéneas (WMS)", checked: true, opacity: 72 },
        { id: "prediosWms", checkboxId: "zonaChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: false, opacity: 45 }
      ], {
        opPrefix: "zonaOp",
        toggleFn: "toggleCapaFichaZona",
        opacityFn: "cambiarOpacidadCapaFichaZona",
        subirFn: "subirCapaFichaZona",
        bajarFn: "bajarCapaFichaZona"
      })
    : "";

  return `<div id="zonaLayerPanel" class="zona-layer-panel oculto">
    <div class="grupo ficha-capas-overlay zona-capas-overlay" id="zonaCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    <div class="grupo">
      <strong>Base mapas</strong>
      <label><input type="radio" name="zonaBasemap" value="googleHybrid" checked onchange="cambiarBaseFichaZona()"> Google Hybrid</label>
      <label><input type="radio" name="zonaBasemap" value="googleRoad" onchange="cambiarBaseFichaZona()"> Google Road</label>
      <label><input type="radio" name="zonaBasemap" value="esri" onchange="cambiarBaseFichaZona()"> ESRI Satellite</label>
      <label><input type="radio" name="zonaBasemap" value="osm" onchange="cambiarBaseFichaZona()"> OpenStreetMap</label>
    </div>
  </div>`;
}

function buildFichaZonaChartScript(catalogoJson) {
  const cat = JSON.stringify(catalogoJson || null);
  return `
  const catalogoZonaFicha=${cat};
  const ZONA_CHART_COLORES={2024:"#dc2626",2025:"#ea580c",2026:"#2563eb",2027:"#16a34a"};
  function colorAnioZonaFicha(an,idx){return ZONA_CHART_COLORES[an]||["#dc2626","#ea580c","#2563eb","#16a34a"][idx%4];}
  function dibujarChartFichaZona(canvasOpt){
    const canvas=canvasOpt||document.getElementById("previewZonaChart");
    if(!canvas)return null;
    const ctx=canvas.getContext("2d");
    const W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
    const reg=catalogoZonaFicha;
    if(!reg){
      ctx.fillStyle="#94a3b8";ctx.font="14px Segoe UI,sans-serif";ctx.textAlign="center";
      ctx.fillText("Sin datos de evolución",W/2,H/2);return null;
    }
    const anios=(reg.anios||[2024,2025,2026]).length?reg.anios:[2024,2025,2026];
    if(!reg.anios&&typeof reg.valor_2024==="undefined"){
      anios.length=0;
      [2024,2025,2026,2027].forEach(function(a){if(reg["valor_"+a]!=null)anios.push(a);});
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
    ctx.fillStyle="#703341";ctx.font="bold 15px Segoe UI,sans-serif";ctx.textAlign="center";
    ctx.fillText("ZONA HOMOGÉNEA · VALOR × AÑO",W/2,22);
    const padL=58,padR=24,padT=36,padB=56,chartW=W-padL-padR,chartH=H-padT-padB;
    const maxVal=Math.max.apply(null,datos.map(function(d){return d.valor;}))*1.12;
    const barW=Math.min(72,chartW/(datos.length*1.8));
    const gap=(chartW-barW*datos.length)/(datos.length+1);
    ctx.strokeStyle="#cbd5e1";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(padL,padT);ctx.lineTo(padL,padT+chartH);ctx.lineTo(padL+chartW,padT+chartH);ctx.stroke();
    ctx.fillStyle="#64748b";ctx.font="11px Segoe UI,sans-serif";ctx.textAlign="right";
    for(let i=0;i<=4;i++){
      const yVal=maxVal*(1-i/4),y=padT+(chartH*i)/4;
      ctx.fillText("$"+yVal.toLocaleString("es-MX",{maximumFractionDigits:0}),padL-8,y+4);
      ctx.strokeStyle="#f1f5f9";ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+chartW,y);ctx.stroke();
    }
    ctx.textAlign="center";
    datos.forEach(function(d,i){
      const x=padL+gap+i*(barW+gap),h=(d.valor/maxVal)*chartH,y=padT+chartH-h;
      ctx.fillStyle=colorAnioZonaFicha(d.anio,i);ctx.fillRect(x,y,barW,h);
      ctx.fillStyle="#0f172a";ctx.font="bold 11px Segoe UI,sans-serif";
      ctx.fillText("$"+d.valor.toLocaleString("es-MX",{maximumFractionDigits:0}),x+barW/2,y-6);
      ctx.fillStyle="#475569";ctx.font="12px Segoe UI,sans-serif";
      ctx.fillText(String(d.anio),x+barW/2,padT+chartH+18);
    });
    ctx.fillStyle="#334155";ctx.font="bold 12px Segoe UI,sans-serif";
    ctx.fillText(reg.clave_zonah||reg.codigo_zona_homogenea||"",W/2,H-8);
    try{return canvas.toDataURL("image/png");}catch(e){return null;}
  }
  function initChartFichaZona(){
    dibujarChartFichaZona();
    const variacion=document.getElementById("previewZonaVariacion");
    const reg=catalogoZonaFicha;
    if(!variacion||!reg)return;
    if(reg.variacion_pct!=null){
      const signo=reg.variacion_abs>=0?"+":"";
      const desde=reg.variacion_desde||2024,hasta=reg.variacion_hasta||2026;
      variacion.innerHTML="Variación "+desde+"→"+hasta+": <b>"+signo+reg.variacion_pct+"%</b>";
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initChartFichaZona);
  else initChartFichaZona();
  `;
}

function buildFichaZonaMapScript(featuresJson, mapaInicialJson) {
  const geoJson = JSON.stringify(featuresJson || { type: "FeatureCollection", features: [] });
  const mapaInicial = JSON.stringify(mapaInicialJson || "");
  const capasRuntime = typeof buildFichaMapaCapasRuntimeScript === "function"
    ? buildFichaMapaCapasRuntimeScript({
        ordenDef: { predio: 38, zona: 50, prediosWms: 8, zonasWms: 6 },
        capaProp: {
          predio: "capaPredio",
          zona: "capaZona",
          prediosWms: "capaPredios",
          zonasWms: "capaZonasWms"
        },
        chkMap: {
          predio: "zonaChkPredio",
          zona: "zonaChkZona",
          zonasWms: "zonaChkZonasWms",
          prediosWms: "zonaChkPrediosWms"
        },
        optionalIds: ["prediosWms"],
        capasVar: "window.__zonaPreviewCapas",
        mapVar: "previewMapZona",
        overlayListId: "zonaCapasOverlayList",
        opPrefix: "zonaOp",
        toggleFn: "toggleCapaFichaZona",
        opacityFn: "cambiarOpacidadCapaFichaZona",
        subirFn: "subirCapaFichaZona",
        bajarFn: "bajarCapaFichaZona",
        initFn: "inicializarOrdenCapasFichaZona"
      })
    : "";

  return `
  let previewMapZona=null;
  const featuresZona=${geoJson};
  const mapaInicialFicha=${mapaInicial};
  ${capasRuntime}

  function crearWmsZona(url,layers,visible,opacity,zIndex){
    return new ol.layer.Tile({visible:!!visible,opacity:opacity==null?0.72:opacity,zIndex:zIndex==null?6:zIndex,
      source:new ol.source.TileWMS({url:url,params:{LAYERS:layers,TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},serverType:"geoserver",crossOrigin:"anonymous"})});
  }
  function estiloPredioZona(){return[
    new ol.style.Style({zIndex:38,stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.92)",width:6,lineDash:[8,6]})}),
    new ol.style.Style({zIndex:39,stroke:new ol.style.Stroke({color:"#111827",width:4,lineDash:[6,5]})})
  ];}
  function estiloZonaLimite(){return[
    new ol.style.Style({zIndex:49,stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.9)",width:6,lineDash:[8,5]})}),
    new ol.style.Style({zIndex:50,stroke:new ol.style.Stroke({color:"#dc2626",width:4,lineDash:[8,5]})})
  ];}
  let zonaPreviewOverlay=null,zonaPreviewOverlayEl=null;
  function ocultarTooltipZonaPreview(){
    if(zonaPreviewOverlayEl)zonaPreviewOverlayEl.classList.add("oculto");
    if(zonaPreviewOverlay)zonaPreviewOverlay.setPosition(undefined);
  }
  function htmlTooltipZonaPreview(cod,desc,val){
    const v=val!=null?"$"+Number(val).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
    return '<div class="popup-zona-tooltip-inner"><button type="button" class="popup-zona-tooltip-cerrar" onclick="ocultarTooltipZonaPreview()" title="Cerrar">×</button><strong class="popup-zona-tooltip-codigo">'+String(cod||"Zona")+'</strong>'+(desc?'<span class="popup-zona-tooltip-desc">'+String(desc)+'</span>':"")+'<span class="popup-zona-tooltip-valor">Valor 2026: <b>'+v+'</b></span></div>';
  }
  async function resolverValor2026Preview(cod,props){
    const cat=featuresZona.catalogo,c=String(cod||"").trim().toUpperCase();
    if(cat){
      const cc=String(cat.clave_zonah||cat.codigo_zona_homogenea||"").toUpperCase();
      if(cc&&(cc===c||cc.indexOf(c)>=0||c.indexOf(cc)>=0)){
        if(cat.valor_2026!=null)return cat.valor_2026;
        const ev=(cat.evolucion||[]).find(function(e){return e.anio===2026;});
        if(ev&&ev.valor_m2!=null)return ev.valor_m2;
      }
    }
    const raw=props&&(props.valor_2026||props.valor2026||props.valor_m2);
    if(raw!=null&&String(raw).trim()!==""){const n=Number(String(raw).replace(/[$,]/g,""));if(!isNaN(n))return n;}
    return null;
  }
  async function consultarZonaWmsPreview(lon,lat){
    const layers=["${FICHA_ZONA_WMS_LAYER}","geonode:${FICHA_ZONA_WMS_LAYER}"];
    const delta=0.00045,bbox=(lon-delta)+","+(lat-delta)+","+(lon+delta)+","+(lat+delta);
    for(let i=0;i<layers.length;i++){
      const layer=layers[i];
      const params=new URLSearchParams({SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetFeatureInfo",LAYERS:layer,QUERY_LAYERS:layer,STYLES:"",BBOX:bbox,WIDTH:"101",HEIGHT:"101",X:"50",Y:"50",SRS:"EPSG:4326",INFO_FORMAT:"application/json",FEATURE_COUNT:"5"});
      try{
        const r=await fetch("${FICHA_ZONA_GEONODE_WMS}?"+params.toString(),{cache:"no-store"});
        if(!r.ok)continue;
        const data=await r.json();
        if((data.features||[]).length)return data.features[0].properties||{};
      }catch(e){}
    }
    return null;
  }
  function initClickZonaPreview(){
    if(!previewMapZona||zonaPreviewOverlay)return;
    zonaPreviewOverlayEl=document.createElement("div");
    zonaPreviewOverlayEl.className="popup-zona-map-tooltip oculto";
    zonaPreviewOverlay=new ol.Overlay({element:zonaPreviewOverlayEl,offset:[0,-14],positioning:"bottom-center",stopEvent:true});
    previewMapZona.addOverlay(zonaPreviewOverlay);
    previewMapZona.on("singleclick",async function(evt){
      const coord=evt.coordinate,lonLat=ol.proj.toLonLat(coord);
      zonaPreviewOverlayEl.innerHTML='<div class="popup-zona-tooltip-inner"><span class="popup-zona-tooltip-cargando">Consultando zona…</span></div>';
      zonaPreviewOverlayEl.classList.remove("oculto");
      zonaPreviewOverlay.setPosition(coord);
      const props=await consultarZonaWmsPreview(lonLat[0],lonLat[1]);
      if(!props){ocultarTooltipZonaPreview();return;}
      let cod=featuresZona.zonah||"";
      Object.keys(props).forEach(function(k){
        const kl=String(k).toLowerCase();
        if(!cod&&(kl.indexOf("zonah")>=0||kl.indexOf("codigo")>=0||kl.indexOf("homogenea")>=0)){
          const v=String(props[k]||"").trim();if(v)cod=v.toUpperCase();
        }
      });
      const desc=props.descripcion||props.nombre||props.zona||"";
      const val=await resolverValor2026Preview(cod,props);
      zonaPreviewOverlayEl.innerHTML=htmlTooltipZonaPreview(cod,desc,val);
    });
  }
  function mostrarErrorMapaZona(msg){
    const el=document.getElementById("previewZonaMap");
    if(el)el.innerHTML='<div class="zona-map-error">'+String(msg||"Error de mapa")+'</div>';
    document.getElementById("previewZonaMapLoading")?.classList.add("oculto");
    const btn=document.getElementById("btnImprimirZona");if(btn){btn.disabled=false;btn.textContent="Imprimir / PDF";}
  }
  function iniciarMapaFichaZona(){
    const targetEl=document.getElementById("previewZonaMap");
    if(!targetEl||typeof ol==="undefined"||!ol.Map){mostrarErrorMapaZona("OpenLayers no está disponible.");return;}
    if(previewMapZona)return;
    const wmsLayer=featuresZona.wmsLayer||"${FICHA_ZONA_WMS_LAYER}";
    const baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseGoogleRoad=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    const baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});
    const capaZonasWms=crearWmsZona("${FICHA_ZONA_GEONODE_WMS}",wmsLayer,true,0.72,6);
    const capaPredios=crearWmsZona("${FICHA_ZONA_CATASTRO_WMS}","catastro_bc:predios_oficial",false,0.45,8);
    const srcPredio=new ol.source.Vector();const srcZona=new ol.source.Vector();
    const format=new ol.format.GeoJSON({dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"});
    (featuresZona.features||[]).forEach(function(f){
      const p=f.properties||{};const feats=format.readFeatures({type:"Feature",geometry:f.geometry,properties:p});
      if(p.es_consultado)srcPredio.addFeatures(feats);else if(p.es_zona)srcZona.addFeatures(feats);
    });
    const capaPredio=new ol.layer.Vector({source:srcPredio,zIndex:38,style:estiloPredioZona()});
    const capaZona=new ol.layer.Vector({source:srcZona,zIndex:50,style:estiloZonaLimite()});
    previewMapZona=new ol.Map({target:"previewZonaMap",layers:[baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaZonasWms,capaPredios,capaZona,capaPredio],
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:16}),controls:[]});
    window.__zonaPreviewCapas={baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaZonasWms,capaPredios,capaPredio,capaZona};
    window.__zonaVistaUsuario=false;
    if(typeof inicializarOrdenCapasFichaZona==="function")inicializarOrdenCapasFichaZona();
    if(typeof actualizarCapasFichaZona==="function")actualizarCapasFichaZona();
    initClickZonaPreview();
    function marcarVistaUsuarioZona(){window.__zonaVistaUsuario=true;}
    targetEl.addEventListener("wheel",marcarVistaUsuarioZona,{passive:true});
    previewMapZona.on("pointerdrag",marcarVistaUsuarioZona);
    function marcarMapaListoZona(){
      document.getElementById("previewZonaMapPlaceholder")?.classList.remove("activo");
      document.getElementById("previewZonaMapLoading")?.classList.add("oculto");
      const btn=document.getElementById("btnImprimirZona");if(btn){btn.disabled=false;btn.textContent="Imprimir / PDF";}
      const aviso=document.getElementById("zonaMapaEstado");if(aviso)aviso.textContent="Mapa listo. Pulse «Imprimir / PDF».";
    }
    function extentCentradoPredioYZona(extPredio,extZona){
      const bufferM=240,ratioMax=5;
      if(!extPredio||!Number.isFinite(extPredio[0])){
        if(extZona&&Number.isFinite(extZona[0]))return extZona.slice();
        return null;
      }
      let ext=extPredio.slice();
      if(extZona&&Number.isFinite(extZona[0])){
        const ap=ol.extent.getWidth(extPredio)*ol.extent.getHeight(extPredio);
        const az=ol.extent.getWidth(extZona)*ol.extent.getHeight(extZona);
        if(ap>0&&az<=ap*ratioMax){
          ext=ol.extent.createEmpty();
          ol.extent.extend(ext,extPredio);
          ol.extent.extend(ext,extZona);
        }
      }
      if(typeof ol.extent.buffer==="function")ext=ol.extent.buffer(ext,bufferM);
      return ext;
    }
    function centrar(forzar){
      if(!previewMapZona)return;
      if(!forzar&&window.__zonaVistaUsuario)return;
      if(typeof aplicarAltoMapaZona==="function")aplicarAltoMapaZona();
      previewMapZona.updateSize();
      const ext=extentCentradoPredioYZona(srcPredio.getExtent(),srcZona.getExtent());
      if(ext&&Number.isFinite(ext[0])){
        previewMapZona.getView().fit(ext,{padding:[48,48,48,48],maxZoom:18,duration:forzar?0:250});
      }else if(featuresZona.centroide&&featuresZona.centroide.lon!=null){
        previewMapZona.getView().setCenter(ol.proj.fromLonLat([featuresZona.centroide.lon,featuresZona.centroide.lat]));
        previewMapZona.getView().setZoom(17);
      }
      document.getElementById("previewZonaMapPlaceholder")?.classList.remove("activo");
      try{previewMapZona.renderSync();}catch(e){}
    }
    window.centrarMapaFichaZona=function(){window.__zonaVistaUsuario=false;centrar(true);};
    previewMapZona.once("rendercomplete",function(){
      marcarMapaListoZona();
      centrar(true);
    });
    setTimeout(function(){centrar(true);},120);
    setTimeout(function(){centrar(true);},650);
    setTimeout(function(){centrar(true);},1400);
  }
  function bootMapaFichaZona(){
    function arrancar(){
      if(typeof ajustarPapelZona==="function")ajustarPapelZona({});
      if(typeof aplicarAltoMapaZona==="function")aplicarAltoMapaZona();
      try{iniciarMapaFichaZona();}catch(e){mostrarErrorMapaZona("No se pudo iniciar el plano.");}
    }
    if(typeof ol!=="undefined"&&ol.Map){setTimeout(arrancar,100);return;}
    const s=document.createElement("script");s.src="${FICHA_ZONA_OL_JS}";
    s.onload=function(){setTimeout(arrancar,100);};s.onerror=function(){mostrarErrorMapaZona("No se pudo cargar OpenLayers.");};
    document.body.appendChild(s);
  }
  function toggleLayerPanelZona(){document.getElementById("zonaLayerPanel")?.classList.toggle("oculto");}
  function actualizarCapasFichaZona(){
    ["predio","zona","zonasWms","prediosWms"].forEach(toggleCapaFichaZona);
  }
  window.actualizarCapasFichaZona=actualizarCapasFichaZona;
  function cambiarBaseFichaZona(){
    const c=window.__zonaPreviewCapas;if(!c)return;
    const v=document.querySelector('input[name="zonaBasemap"]:checked')?.value||"googleHybrid";
    c.baseGoogleHybrid.setVisible(v==="googleHybrid");c.baseGoogleRoad.setVisible(v==="googleRoad");
    c.baseEsri.setVisible(v==="esri");c.baseOSM.setVisible(v==="osm");previewMapZona&&previewMapZona.render();
  }
  function zoomMasZona(){if(previewMapZona){window.__zonaVistaUsuario=true;previewMapZona.getView().setZoom((previewMapZona.getView().getZoom()||16)+1);}}
  function zoomMenosZona(){if(previewMapZona){window.__zonaVistaUsuario=true;previewMapZona.getView().setZoom((previewMapZona.getView().getZoom()||16)-1);}}
  function capturarMapaFichaZona(mapInst,timeoutMs){
    timeoutMs=timeoutMs||3500;
    return new Promise(function(resolve){
      let resuelto=false;function finalizar(img){if(!resuelto){resuelto=true;resolve(img);}}
      if(!mapInst||typeof mapInst.once!=="function"){finalizar(null);return;}
      setTimeout(function(){finalizar(null);},timeoutMs);
      try{
        const target=mapInst.getTargetElement?mapInst.getTargetElement():null;
        mapInst.once("rendercomplete",function(){
          try{
            const size=mapInst.getSize();if(!size||!size[0]||!size[1]){finalizar(null);return;}
            const canvasFinal=document.createElement("canvas");canvasFinal.width=size[0];canvasFinal.height=size[1];
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
                  }else{matrix=[1,0,0,1,0,0];}
                  CanvasRenderingContext2D.prototype.setTransform.apply(ctx,matrix);
                  ctx.drawImage(canvas,0,0);
                }
              }catch(e){}
            });
            ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;
            finalizar(canvasFinal.toDataURL("image/png"));
          }catch(e){finalizar(null);}
        });mapInst.renderSync();
      }catch(e){finalizar(null);}
    });
  }
  function esperarLayoutImpresionZona(callback){
    let paso=0;
    function tick(){
      if(typeof ajustarPapelZona==="function")ajustarPapelZona({impresion:true});
      if(typeof aplicarAltoMapaZona==="function")aplicarAltoMapaZona();
      if(previewMapZona){previewMapZona.updateSize();try{previewMapZona.renderSync();}catch(e){}}
      paso++;
      if(paso>=4){setTimeout(callback,140);return;}
      setTimeout(tick,paso<2?120:180);
    }
    tick();
  }
  function prepararImpresionZona(){
    document.body.classList.add("ficha-zona-imprimiendo");
    const imgMap=document.getElementById("previewZonaMapPrintImg");
    const imgChart=document.getElementById("previewZonaChartPrintImg");
    if(typeof dibujarChartFichaZona==="function"){
      const chartUrl=dibujarChartFichaZona(document.getElementById("previewZonaChart"));
      if(chartUrl&&imgChart){imgChart.src=chartUrl;imgChart.classList.add("activo");}
    }
    if(!previewMapZona||!imgMap)return Promise.resolve(false);
    if(typeof ajustarPapelZona==="function")ajustarPapelZona({impresion:true});
    if(typeof aplicarAltoMapaZona==="function")aplicarAltoMapaZona();
    previewMapZona.updateSize();try{previewMapZona.renderSync();}catch(e){}
    return new Promise(function(resolve){
      setTimeout(function(){
        capturarMapaFichaZona(previewMapZona,5000).then(function(dataUrl){
          if(dataUrl){imgMap.src=dataUrl;imgMap.classList.add("activo");document.getElementById("previewZonaMapWrap")?.classList.add("zona-print-listo");}
          resolve(!!dataUrl);
        });
      },500);
    });
  }
  function restaurarImpresionZona(){
    document.body.classList.remove("ficha-zona-imprimiendo");
    ["previewZonaMapPrintImg","previewZonaChartPrintImg"].forEach(function(id){
      const el=document.getElementById(id);if(el){el.classList.remove("activo");el.removeAttribute("src");}
    });
    document.getElementById("previewZonaMapWrap")?.classList.remove("zona-print-listo");
    if(typeof ajustarPapelZona==="function")ajustarPapelZona({});
    if(previewMapZona){previewMapZona.updateSize();try{previewMapZona.renderSync();}catch(e){}}
  }
  function imprimirFichaZona(){
    const btn=document.getElementById("btnImprimirZona");if(btn)btn.disabled=true;
    esperarLayoutImpresionZona(function(){
      prepararImpresionZona().then(function(){
        function onAfterPrint(){restaurarImpresionZona();if(btn)btn.disabled=false;window.removeEventListener("afterprint",onAfterPrint);}
        window.addEventListener("afterprint",onAfterPrint);
        setTimeout(function(){window.print();},400);
      });
    });
  }
  window.toggleLayerPanelZona=toggleLayerPanelZona;window.cambiarBaseFichaZona=cambiarBaseFichaZona;
  window.zoomMasZona=zoomMasZona;window.zoomMenosZona=zoomMenosZona;window.imprimirFichaZona=imprimirFichaZona;
  window.ocultarTooltipZonaPreview=ocultarTooltipZonaPreview;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootMapaFichaZona);else bootMapaFichaZona();
  `;
}

function buildFichaZonaLayoutScript() {
  return `
  const FICHA_PAPEL_ZONA={carta:{ancho:8.5,alto:11},legal:{ancho:8.5,alto:14}};
  let fichaZonaPapel="carta",fichaZonaOrientacion="portrait";
  function dimensionesPaginaZona(){
    const base=FICHA_PAPEL_ZONA[fichaZonaPapel]||FICHA_PAPEL_ZONA.carta;
    return fichaZonaOrientacion==="landscape"?{ancho:base.alto,alto:base.ancho}:{ancho:base.ancho,alto:base.alto};
  }
  function aplicarReglaPaginaZona(){
    let style=document.getElementById("zonaPageRule");
    if(!style){style=document.createElement("style");style.id="zonaPageRule";document.head.appendChild(style);}
    const d=dimensionesPaginaZona(),ori=fichaZonaOrientacion==="landscape"?"landscape":"portrait";
    style.textContent="@media print{@page{size:"+d.ancho+"in "+d.alto+"in "+ori+";margin:3mm;}}";
  }
  function mapInToPx(mapIn){const inch=parseFloat(mapIn);return isNaN(inch)||inch<=0?320:Math.max(200,Math.round(inch*96));}
  function aplicarAltoMapaZona(){
    const mapEl=document.getElementById("previewZonaMap");
    const wrapEl=document.getElementById("previewZonaMapWrap");
    const mapIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-map").trim();
    if(mapIn&&wrapEl){
      const px=mapInToPx(mapIn),pxCss=px+"px";
      wrapEl.style.height=pxCss;wrapEl.style.minHeight=pxCss;wrapEl.style.maxHeight=pxCss;
      ["previewZonaMapPlaceholder","previewZonaMapLoading","previewZonaMapPrintImg"].forEach(function(id){
        const el=document.getElementById(id);if(el){el.style.height="100%";el.style.minHeight="100%";}
      });
      if(mapEl){mapEl.style.width="100%";mapEl.style.height="100%";}
    }
    if(typeof previewMapZona!=="undefined"&&previewMapZona){previewMapZona.updateSize();try{previewMapZona.renderSync();}catch(e){}}
  }
  function medirReservadoZonaIn(){
    const cont=document.querySelector(".contenedor");if(!cont)return 5.4;
    let px=0;
    Array.from(cont.children).forEach(function(el){
      if(el.classList.contains("seccion-mapa")){
        const head=el.querySelector(".media-head");if(head)px+=head.getBoundingClientRect().height;
        return;
      }
      px+=el.getBoundingClientRect().height;
    });
    return Math.max(3.4,px/96+0.05);
  }
  function ajustarPapelZona(opciones){
    opciones=opciones||{};const esImpresion=!!opciones.impresion;const d=dimensionesPaginaZona();const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",d.ancho+"in");root.style.setProperty("--ficha-alto",d.alto+"in");
    document.body.classList.remove("papel-carta","papel-legal","orient-portrait","orient-landscape");
    document.body.classList.add("papel-"+fichaZonaPapel,"orient-"+fichaZonaOrientacion);
    aplicarReglaPaginaZona();
    const margenPagina=esImpresion?0.06:0.1,altoPagina=esImpresion?(d.alto-margenPagina*2):d.alto;
    let reservado=medirReservadoZonaIn();
    let mapIn=altoPagina-reservado-(esImpresion?0.06:0.08);
    const minMap=esImpresion?1.65:(fichaZonaOrientacion==="landscape"?3.2:2.0);
    mapIn=Math.max(minMap,+mapIn.toFixed(2));
    root.style.setProperty("--ficha-media-map",mapIn+"in");
    if(esImpresion){
      root.style.setProperty("--ficha-contenido-alto",(reservado+mapIn+0.02).toFixed(2)+"in");
    }else{
      root.style.removeProperty("--ficha-contenido-alto");
    }
    requestAnimationFrame(aplicarAltoMapaZona);
  }
  function setTamanoPapelZona(tipo){fichaZonaPapel=(tipo==="legal")?"legal":"carta";requestAnimationFrame(function(){ajustarPapelZona({});});}
  function setOrientacionZona(tipo){fichaZonaOrientacion=(tipo==="landscape")?"landscape":"portrait";requestAnimationFrame(function(){ajustarPapelZona({});});}
  window.ajustarPapelZona=ajustarPapelZona;window.setTamanoPapelZona=setTamanoPapelZona;window.setOrientacionZona=setOrientacionZona;window.aplicarAltoMapaZona=aplicarAltoMapaZona;
  function initLayoutZona(){
    setTimeout(function(){ajustarPapelZona({});},80);
    setTimeout(function(){ajustarPapelZona({});},500);
    setTimeout(function(){
      ajustarPapelZona({});
      if(typeof centrarMapaFichaZona==="function")centrarMapaFichaZona();
    },1400);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initLayoutZona);
  else initLayoutZona();
  window.addEventListener("resize",function(){
    clearTimeout(window.__zonaResizeT);
    window.__zonaResizeT=setTimeout(function(){
      ajustarPapelZona({});
      if(typeof centrarMapaFichaZona==="function")centrarMapaFichaZona();
    },160);
  });
  `;
}

function construirHtmlFichaZonaVentana(datos, zonaData, opciones) {
  opciones = opciones || {};
  const baseHref = String(opciones.baseHref || "./");
  const mapaInicial = String(opciones.mapaInicial || "");
  const attrs = fichaZonaAtributos(zonaData);
  const cat = zonaData?.catalogo || {};
  const clave = fichaZonaEsc(datos?.clave || zonaData?.clave_catastral || "—");
  const codZonah = fichaZonaEsc(cat.clave_zonah || cat.codigo_zona_homogenea || zonaData?.zonah || "—");
  const descripcion = fichaZonaEsc(cat.descripcion_col_fracc || attrs.descripcion || "—");
  const delegacion = fichaZonaEsc(zonaData?.delegacion || datos?.p?.delegacion || "MEXICALI");
  const numof = String(datos?.numof || zonaData?.numof || datos?.p?.numof || "").trim();
  const domicilio = typeof construirDomicilioFisicoFicha === "function"
    ? fichaZonaEsc(construirDomicilioFisicoFicha(datos?.p || {}, numof))
    : fichaZonaEsc(`${zonaData?.calle || datos?.calle || ""} — ${zonaData?.colonia || datos?.colonia || ""}`);
  const tasa = zonaData?.porcentaje_tasa != null ? zonaData.porcentaje_tasa + "%" : "—";
  const valorPredio = fichaZonaFormatMoneda(zonaData?.valor2026 ?? datos?.p?.valor2026);
  const zonaSector = fichaZonaEsc([cat.zona || attrs.zona, cat.sector || attrs.sector].filter(Boolean).join(" · ") || "—");
  const subsector = fichaZonaEsc(cat.subsector || attrs.subsector || "—");
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const catalogoPayload = Object.assign({}, cat, { anios: zonaData?.anios || [2024, 2025, 2026] });
  const featuresPayload = serializarFeaturesZonaFicha(zonaData);
  const mapScript = buildFichaZonaMapScript(featuresPayload, mapaInicial);
  const chartScript = buildFichaZonaChartScript(catalogoPayload);
  const layoutScript = buildFichaZonaLayoutScript();
  const placeholderActivo = mapaInicial ? " activo" : "";

  const anios = catalogoPayload.anios || [2024, 2025, 2026];
  let valoresHtml = "";
  anios.forEach(function(an) {
    const val = cat["valor_" + an] != null
      ? cat["valor_" + an]
      : ((cat.evolucion || []).find(function(e) { return e.anio === an; })?.valor_m2);
    valoresHtml += `<div class="celda"><div class="label">Valor ${an}</div><div class="valor">${fichaZonaEsc(val != null ? fichaZonaFormatMoneda(val) : "—")}</div></div>`;
  });

  return `<!DOCTYPE html>
<html lang="es" class="papel-carta orient-portrait">
<head>
<meta charset="UTF-8">
<base href="${fichaZonaEsc(baseHref)}">
<title>Ficha zona homogénea ${clave}</title>
<link rel="stylesheet" href="${FICHA_ZONA_OL_CSS}">
<style>
:root{--guinda:#703341;--guinda-claro:#d8bdc5;--texto-valor:#1e293b;--ficha-ancho:8.5in;--ficha-alto:11in;--ficha-media-map:3.2in;}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto-valor);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar button:disabled{opacity:.55;cursor:not-allowed;}
.toolbar-papel{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569;font-weight:700;}
.toolbar-papel select{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;color:#334155;background:#fff;}
.zona-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(220px,1fr);gap:10px;font-size:12px;}
.zona-layer-panel.oculto{display:none!important;}
.zona-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.zona-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
.contenedor{width:min(100%,var(--ficha-ancho));max-width:var(--ficha-ancho);height:auto;min-height:0;margin:12px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);border:1px solid var(--guinda);border-radius:6px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;}
.encabezado{background:var(--guinda)!important;color:#fff!important;padding:10px 12px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;border-bottom:3px solid #c9a227;}
.enc-logo img{height:52px;max-width:220px;object-fit:contain;background:#fff;padding:3px 8px;border-radius:6px;}
.enc-centro{text-align:center;}
.enc-centro h1{margin:0;font-size:19px;font-weight:900;color:#fff!important;letter-spacing:.4px;}
.enc-centro .clave-zona{margin:5px 0 0;font-size:15px;font-weight:900;color:#fff!important;letter-spacing:.12em;}
.grid-datos{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--guinda-claro);}
.grid-datos .celda{border-right:1px solid #efe6e8;border-bottom:1px solid #efe6e8;padding:4px 7px;min-height:30px;box-sizing:border-box;}
.grid-datos .celda:last-child{border-right:none;}
.grid-datos .full{grid-column:span 4;border-right:none;}
.grid-datos .span2{grid-column:span 2;}
.grid-datos .span3{grid-column:span 3;}
.label{font-size:8px;color:#1e293b;font-weight:700;text-transform:uppercase;margin-bottom:1px;}
.valor,.grid-datos .valor{font-size:10px;font-weight:800;color:var(--guinda)!important;line-height:1.25;word-break:break-word;}
.valor-zonah{font-size:11px;font-weight:900;letter-spacing:.04em;}
.seccion-mapa,.seccion-grafica{border-top:1px solid var(--guinda-claro);flex:0 0 auto;display:flex;flex-direction:column;}
.seccion-mapa .media-head,.seccion-grafica .media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:9px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;flex:0 0 auto;}
.zona-map-wrap{position:relative;width:100%;height:var(--ficha-media-map);min-height:var(--ficha-media-map);max-height:var(--ficha-media-map);flex:0 0 auto;overflow:hidden;background:#eaeaea;line-height:0;border:2px solid var(--guinda);box-sizing:border-box;}
#previewZonaMap{position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#eaeaea;}
.zona-map-placeholder,.zona-map-print-snapshot{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;background:#eaeaea;z-index:1;}
.zona-map-placeholder.activo{display:block;z-index:3;}
.zona-map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(234,234,234,.92);color:#703341;font-size:12px;font-weight:700;z-index:4;}
.zona-map-loading.oculto{display:none!important;}
.zona-chart-wrap{padding:6px 8px 2px;background:#fff;border-top:1px solid var(--guinda-claro);text-align:center;flex:0 0 auto;}
#previewZonaChart{max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:4px;}
.zona-chart-print{display:none;max-width:100%;max-height:2.05in;height:auto;margin:0 auto;}
.zona-chart-print.activo{display:block;}
.preview-zona-variacion{font-size:10px;color:#475569;margin-top:3px;font-weight:700;}
.seccion-leyenda{display:flex;flex-wrap:wrap;gap:8px 14px;padding:4px 8px;border-top:1px solid var(--guinda-claro);background:#fafafa;font-size:8px;font-weight:700;color:#475569;flex:0 0 auto;}
.seccion-leyenda span{display:inline-flex;align-items:center;gap:5px;}
.leyenda-swatch{display:inline-block;width:12px;height:12px;border-radius:2px;border:1px solid rgba(0,0,0,.15);}
.leyenda-predio{background:transparent;border:3px dashed #111827;}
.leyenda-zona{background:transparent;border:3px dashed #dc2626;}
.leyenda-wms{background:rgba(34,197,94,0.2);border-color:#22c55e;}
.popup-zona-map-tooltip{min-width:160px;max-width:240px;background:#fff;border:2px solid #703341;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.28);padding:0;z-index:2000;}
.popup-zona-map-tooltip.oculto{display:none!important;}
.popup-zona-tooltip-inner{padding:8px 10px 8px;font-size:11px;color:#1e293b;line-height:1.35;position:relative;}
.popup-zona-tooltip-cerrar{position:absolute;top:2px;right:4px;border:none;background:transparent;color:#64748b;font-size:16px;font-weight:700;cursor:pointer;line-height:1;padding:2px 6px;}
.popup-zona-tooltip-codigo{display:block;color:#703341;font-size:12px;font-weight:800;margin-bottom:2px;padding-right:16px;}
.popup-zona-tooltip-desc{display:block;color:#475569;font-size:10px;margin-bottom:4px;}
.popup-zona-tooltip-valor{display:block;color:#334155;font-size:10px;}
.popup-zona-tooltip-valor b{color:#703341;font-size:11px;}
.popup-zona-tooltip-cargando{color:#64748b;font-style:italic;}
.pie-ficha{display:flex;justify-content:space-between;align-items:center;padding:5px 10px 6px;border-top:1px solid var(--guinda-claro);font-size:9px;color:var(--guinda);font-weight:700;flex:0 0 auto;}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:6px 8px;font-style:italic;}
@media print{
  html,body{width:var(--ficha-ancho);height:auto;margin:0!important;padding:0!important;background:#fff!important;}
  .toolbar,.zona-layer-panel,.aviso-impresion{display:none!important;}
  .contenedor{width:var(--ficha-ancho)!important;max-width:var(--ficha-ancho)!important;height:var(--ficha-contenido-alto,auto)!important;min-height:0!important;margin:0 auto!important;box-shadow:none!important;border-radius:0!important;page-break-after:avoid;page-break-inside:avoid;overflow:hidden!important;}
  .seccion-mapa,.seccion-grafica{flex:0 0 auto!important;}
  .zona-map-wrap{height:var(--ficha-media-map)!important;min-height:var(--ficha-media-map)!important;max-height:var(--ficha-media-map)!important;overflow:hidden!important;line-height:0!important;}
  #previewZonaMap{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;}
  body.ficha-zona-imprimiendo .zona-map-wrap.zona-print-listo #previewZonaMap{display:none!important;}
  body.ficha-zona-imprimiendo .zona-map-print-snapshot.activo{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  body.ficha-zona-imprimiendo #previewZonaChart{display:none!important;}
  body.ficha-zona-imprimiendo .zona-chart-print.activo{display:block!important;max-height:2.05in!important;width:auto!important;margin:0 auto!important;}
  body.ficha-zona-imprimiendo .zona-chart-wrap{padding:3px 6px 1px!important;}
  body.ficha-zona-imprimiendo .preview-zona-variacion{margin-top:2px!important;font-size:9px!important;}
  body.ficha-zona-imprimiendo .seccion-leyenda{padding:3px 6px!important;}
  body.ficha-zona-imprimiendo .pie-ficha{padding:3px 8px 4px!important;}
}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="zoomMasZona()">Zoom +</button>
    <button type="button" onclick="zoomMenosZona()">Zoom −</button>
    <button type="button" onclick="centrarMapaFichaZona&&centrarMapaFichaZona()">Centrar</button>
    <label class="toolbar-papel"><select id="tamanoPapelZona" onchange="setTamanoPapelZona(this.value)"><option value="carta" selected>Carta 8.5×11</option><option value="legal">Oficio 8.5×14</option></select></label>
    <label class="toolbar-papel"><select id="orientacionZona" onchange="setOrientacionZona(this.value)"><option value="portrait" selected>Vertical</option><option value="landscape">Horizontal</option></select></label>
    <button type="button" class="sec" onclick="toggleLayerPanelZona()">Capas</button>
    <button type="button" id="btnImprimirZona" disabled onclick="imprimirFichaZona()">Cargando mapa…</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaZonaLayerPanelHtml()}
  <div class="aviso-impresion" id="zonaMapaEstado">Cargando plano cartográfico…</div>
  <div class="contenedor">
    <header class="encabezado">
      <div class="enc-logo"><img src="${LOGO_FICHA_ZONA_URL}" alt="Gobierno de Mexicali"></div>
      <div class="enc-centro">
        <h1>FICHA DE ZONA HOMOGÉNEA</h1>
        <p class="clave-zona">${clave} · ${codZonah}</p>
      </div>
    </header>
    <div class="grid-datos">
      <div class="celda full"><div class="label">Domicilio físico</div><div class="valor">${domicilio}</div></div>
      <div class="celda span2"><div class="label">Código zonah</div><div class="valor valor-zonah">${codZonah}</div></div>
      <div class="celda span2"><div class="label">Descripción</div><div class="valor">${descripcion}</div></div>
      <div class="celda"><div class="label">Delegación</div><div class="valor">${delegacion}</div></div>
      <div class="celda"><div class="label">Zona / sector</div><div class="valor">${zonaSector}</div></div>
      <div class="celda"><div class="label">Subsector</div><div class="valor">${subsector}</div></div>
      <div class="celda"><div class="label">ID tasa / Tasa</div><div class="valor">${fichaZonaEsc(zonaData?.id_tasa || "—")} · ${fichaZonaEsc(tasa)}</div></div>
      ${valoresHtml}
      <div class="celda"><div class="label">Valor predio 2026</div><div class="valor">${valorPredio}</div></div>
    </div>
    <section class="seccion-mapa">
      <div class="media-head">Plano de ubicación · predio y zona homogénea</div>
      <div class="zona-map-wrap" id="previewZonaMapWrap">
        <img id="previewZonaMapPlaceholder" class="zona-map-placeholder${placeholderActivo}" alt="">
        <div id="previewZonaMapLoading" class="zona-map-loading${mapaInicial ? " oculto" : ""}">Cargando plano…</div>
        <img id="previewZonaMapPrintImg" class="zona-map-print-snapshot" alt="">
        <div id="previewZonaMap"></div>
      </div>
    </section>
    <section class="seccion-grafica">
      <div class="media-head">Evolución del valor unitario de suelo</div>
      <div class="zona-chart-wrap">
        <canvas id="previewZonaChart" width="680" height="210"></canvas>
        <img id="previewZonaChartPrintImg" class="zona-chart-print" alt="Gráfica evolución">
        <div class="preview-zona-variacion" id="previewZonaVariacion"></div>
      </div>
    </section>
    <section class="seccion-leyenda">
      <span><i class="leyenda-swatch leyenda-predio"></i> Predio consultado (negro punteado)</span>
      <span><i class="leyenda-swatch leyenda-zona"></i> Límite zona homogénea (rojo punteado)</span>
      <span><i class="leyenda-swatch leyenda-wms"></i> Zonas homogéneas (WMS) · clic para consultar</span>
    </section>
    <div class="pie-ficha"><span>${codZonah} · geonode:${FICHA_ZONA_WMS_LAYER}</span><span>${fichaZonaEsc(fechaPie)}</span></div>
  </div>
  <script>${layoutScript}<\/script>
  <script>${chartScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirPreviewFichaZonaHomogenea() {
  const clave = String(
    popupZonaClaveActual ||
    window.predioSeleccionado?.clave_catastral ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio con clave catastral.");
    return null;
  }

  let zonaData = popupZonaDatos;
  const p = window.predioSeleccionado || {};

  if (!zonaData || zonaData.clave_catastral !== clave) {
    if (typeof cargarZonaHomogenea === "function") {
      try {
        zonaData = await cargarZonaHomogenea(clave, p);
      } catch (e) {
        alert(e.message || "No se pudo consultar zona homogénea.");
        return null;
      }
    }
  }

  if (!zonaData?.geometry) {
    alert("Sin geometría cartográfica para generar la ficha.");
    return null;
  }

  const datos = typeof cargarDatosFichaCatastral === "function"
    ? await cargarDatosFichaCatastral(clave)
    : { clave, p, colonia: p.colonia || "—", calle: p.calle || "—", numof: p.numof || "", uso: p.descripcion_uso || "—" };

  if (!datos) {
    alert("No se pudieron cargar los datos del predio.");
    return null;
  }

  const baseHref = window.location.href.replace(/[^/]*$/, "");
  const mapaInicial = "";
  const win = window.open("", "_blank", "width=1200,height=920");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes.");
    return null;
  }

  win.document.open();
  win.document.write(construirHtmlFichaZonaVentana(datos, zonaData, { baseHref, mapaInicial }));
  win.document.close();
  return win;
}

window.abrirPreviewFichaZonaHomogenea = abrirPreviewFichaZonaHomogenea;
window.construirHtmlFichaZonaVentana = construirHtmlFichaZonaVentana;
