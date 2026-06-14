/* Ficha de ubicación en colonia — vista previa e impresión (formato institucional) */

const LOGO_FICHA_COLONIA_URL = "logomxli.png";
const FICHA_COLONIA_OL_CSS = typeof OL_FICHA_CSS !== "undefined"
  ? OL_FICHA_CSS
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const FICHA_COLONIA_OL_JS = typeof OL_FICHA_CDN !== "undefined"
  ? OL_FICHA_CDN
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const FICHA_COLONIA_GEONODE_WMS = typeof POPUP_COLONIA_GEONODE_WMS !== "undefined"
  ? POPUP_COLONIA_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const FICHA_COLONIA_CATASTRO_WMS = typeof POPUP_COLONIA_CATASTRO_WMS !== "undefined"
  ? POPUP_COLONIA_CATASTRO_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const FICHA_COLONIA_WMS_LAYER = typeof POPUP_COLONIA_WMS_LAYER !== "undefined"
  ? POPUP_COLONIA_WMS_LAYER
  : "colonias";

function fichaColoniaEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaColoniaVal(valor) {
  if (valor == null || String(valor).trim() === "") return "—";
  return String(valor).trim();
}

function fichaColoniaAtributos(coloniaData) {
  return coloniaData?.colonia_carto?.atributos
    || (typeof popupColoniaNormalizarAtributos === "function"
      ? popupColoniaNormalizarAtributos(coloniaData?.colonia_carto?.properties)
      : {});
}

function fichaColoniaNombreCarto(coloniaData) {
  const attrs = fichaColoniaAtributos(coloniaData);
  return fichaColoniaVal(attrs.nombre || coloniaData?.colonia || "");
}

function serializarFeaturesColoniaFicha(coloniaData) {
  const features = [];
  if (coloniaData?.geometry) {
    features.push({
      type: "Feature",
      geometry: coloniaData.geometry,
      properties: { clave_catastral: coloniaData.clave_catastral, es_consultado: true }
    });
  }
  if (coloniaData?.colonia_carto?.geometry) {
    features.push({
      type: "Feature",
      geometry: coloniaData.colonia_carto.geometry,
      properties: { es_colonia: true }
    });
  }
  return {
    type: "FeatureCollection",
    features,
    wmsLayer: coloniaData?.wms_layer || FICHA_COLONIA_WMS_LAYER
  };
}

function fichaColoniaLayerPanelHtml() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "coloniaChkPredio", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "colonia", checkboxId: "coloniaChkColonia", dotClass: "dot-purple", label: "Límite de colonia", checked: true, opacity: 100 },
        { id: "coloniasWms", checkboxId: "coloniaChkColoniasWms", dotClass: "dot-green", label: "Colonias (WMS)", checked: true, opacity: 72 },
        { id: "prediosWms", checkboxId: "coloniaChkPrediosWms", dotClass: "dot-red", label: "Predios (WMS)", checked: false, opacity: 45 }
      ], {
        opPrefix: "coloniaOp",
        toggleFn: "toggleCapaFichaColonia",
        opacityFn: "cambiarOpacidadCapaFichaColonia",
        subirFn: "subirCapaFichaColonia",
        bajarFn: "bajarCapaFichaColonia"
      })
    : "";

  return `<div id="coloniaLayerPanel" class="colonia-layer-panel oculto">
    <div class="grupo ficha-capas-overlay colonia-capas-overlay" id="coloniaCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    <div class="grupo">
      <strong>Base mapas</strong>
      <label><input type="radio" name="coloniaBasemap" value="googleHybrid" checked onchange="cambiarBaseFichaColonia()"> Google Hybrid</label>
      <label><input type="radio" name="coloniaBasemap" value="googleRoad" onchange="cambiarBaseFichaColonia()"> Google Road</label>
      <label><input type="radio" name="coloniaBasemap" value="esri" onchange="cambiarBaseFichaColonia()"> ESRI Satellite</label>
      <label><input type="radio" name="coloniaBasemap" value="osm" onchange="cambiarBaseFichaColonia()"> OpenStreetMap</label>
    </div>
  </div>`;
}

function buildFichaColoniaMapScript(featuresJson, mapaInicialJson) {
  const geoJson = JSON.stringify(featuresJson || { type: "FeatureCollection", features: [] });
  const mapaInicial = JSON.stringify(mapaInicialJson || "");
  const capasRuntime = typeof buildFichaMapaCapasRuntimeScript === "function"
    ? buildFichaMapaCapasRuntimeScript({
        ordenDef: { predio: 35, colonia: 22, prediosWms: 8, coloniasWms: 6 },
        capaProp: {
          predio: "capaPredio",
          colonia: "capaColonia",
          prediosWms: "capaPredios",
          coloniasWms: "capaColoniasWms"
        },
        chkMap: {
          predio: "coloniaChkPredio",
          colonia: "coloniaChkColonia",
          coloniasWms: "coloniaChkColoniasWms",
          prediosWms: "coloniaChkPrediosWms"
        },
        optionalIds: ["prediosWms"],
        capasVar: "window.__coloniaPreviewCapas",
        mapVar: "previewMapColonia",
        overlayListId: "coloniaCapasOverlayList",
        opPrefix: "coloniaOp",
        toggleFn: "toggleCapaFichaColonia",
        opacityFn: "cambiarOpacidadCapaFichaColonia",
        subirFn: "subirCapaFichaColonia",
        bajarFn: "bajarCapaFichaColonia",
        initFn: "inicializarOrdenCapasFichaColonia"
      })
    : "";

  return `
  let previewMapColonia=null;
  const featuresColonia=${geoJson};
  const mapaInicialFicha=${mapaInicial};
  ${capasRuntime}

  function crearWmsColonia(url,layers,visible,opacity,zIndex){
    return new ol.layer.Tile({
      visible:!!visible,
      opacity:opacity==null?0.72:opacity,
      zIndex:zIndex==null?6:zIndex,
      source:new ol.source.TileWMS({
        url:url,
        params:{LAYERS:layers,TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",
        crossOrigin:"anonymous"
      })
    });
  }

  function estiloPredioColonia(){
    return [
      new ol.style.Style({
        zIndex:40,
        stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.98)",width:8}),
        fill:new ol.style.Fill({color:"rgba(30,64,175,0.58)"})
      }),
      new ol.style.Style({
        zIndex:41,
        stroke:new ol.style.Stroke({color:"#1e3a8a",width:4}),
        fill:new ol.style.Fill({color:"rgba(37,99,235,0.52)"})
      })
    ];
  }

  function estiloColoniaLimite(){
    return [
      new ol.style.Style({stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.85)",width:5})}),
      new ol.style.Style({
        stroke:new ol.style.Stroke({color:"#7c3aed",width:3}),
        fill:new ol.style.Fill({color:"rgba(124,58,237,0.14)"})
      })
    ];
  }

  function mostrarErrorMapaColonia(msg){
    const el=document.getElementById("previewColoniaMap");
    if(el)el.innerHTML='<div class="colonia-map-error">'+String(msg||"Error de mapa")+'</div>';
    document.getElementById("previewColoniaMapLoading")?.classList.add("oculto");
    const btn=document.getElementById("btnImprimirColonia");
    if(btn){btn.disabled=false;btn.textContent="Imprimir / PDF";}
  }

  function iniciarMapaFichaColonia(){
    const targetEl=document.getElementById("previewColoniaMap");
    if(!targetEl||typeof ol==="undefined"||!ol.Map){
      mostrarErrorMapaColonia("OpenLayers no está disponible.");
      return;
    }
    if(previewMapColonia)return;

    const wmsLayer=featuresColonia.wmsLayer||"${FICHA_COLONIA_WMS_LAYER}";
    const baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseGoogleRoad=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    const baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});
    const capaColoniasWms=crearWmsColonia("${FICHA_COLONIA_GEONODE_WMS}",wmsLayer,true,0.72,6);
    const capaPredios=crearWmsColonia("${FICHA_COLONIA_CATASTRO_WMS}","catastro_bc:predios_oficial",false,0.45,8);

    const srcPredio=new ol.source.Vector();
    const srcColonia=new ol.source.Vector();
    const format=new ol.format.GeoJSON({dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"});
    (featuresColonia.features||[]).forEach(function(f){
      const p=f.properties||{};
      const feats=format.readFeatures({type:"Feature",geometry:f.geometry,properties:p});
      if(p.es_consultado)srcPredio.addFeatures(feats);
      else if(p.es_colonia)srcColonia.addFeatures(feats);
    });

    const capaPredio=new ol.layer.Vector({source:srcPredio,zIndex:35,style:estiloPredioColonia()});
    const capaColonia=new ol.layer.Vector({source:srcColonia,zIndex:22,style:estiloColoniaLimite()});

    previewMapColonia=new ol.Map({
      target:"previewColoniaMap",
      layers:[baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaColoniasWms,capaPredios,capaColonia,capaPredio],
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:16}),
      controls:[]
    });
    window.__coloniaPreviewCapas={baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaColoniasWms,capaPredios,capaPredio,capaColonia};
    window.__coloniaVistaUsuario=false;
    if(typeof inicializarOrdenCapasFichaColonia==="function")inicializarOrdenCapasFichaColonia();

    function marcarVistaUsuarioColonia(){window.__coloniaVistaUsuario=true;}
    targetEl.addEventListener("wheel",marcarVistaUsuarioColonia,{passive:true});
    previewMapColonia.on("pointerdrag",marcarVistaUsuarioColonia);

    function guardarVistaMapaColonia(){
      if(!previewMapColonia)return null;
      const v=previewMapColonia.getView();
      return{center:v.getCenter(),zoom:v.getZoom(),rotation:v.getRotation()};
    }
    function restaurarVistaMapaColonia(estado){
      if(!previewMapColonia||!estado)return;
      const v=previewMapColonia.getView();
      if(estado.center)v.setCenter(estado.center);
      if(estado.zoom!=null)v.setZoom(estado.zoom);
      if(estado.rotation!=null)v.setRotation(estado.rotation);
    }
    window.guardarVistaMapaColonia=guardarVistaMapaColonia;
    window.restaurarVistaMapaColonia=restaurarVistaMapaColonia;

    function marcarMapaListoColonia(){
      document.getElementById("previewColoniaMapPlaceholder")?.classList.remove("activo");
      document.getElementById("previewColoniaMapLoading")?.classList.add("oculto");
      const btn=document.getElementById("btnImprimirColonia");
      if(btn){btn.disabled=false;btn.textContent="Imprimir / PDF";}
      const aviso=document.getElementById("coloniaMapaEstado");
      if(aviso)aviso.textContent="Mapa listo. Elija tamaño/orientación, ajuste capas y pulse «Imprimir / PDF».";
    }

    function centrar(forzar){
      if(!previewMapColonia)return;
      if(!forzar&&window.__coloniaVistaUsuario)return;
      if(typeof aplicarAltoMapaColonia==="function")aplicarAltoMapaColonia();
      previewMapColonia.updateSize();
      const ext=ol.extent.createEmpty();
      [srcColonia,srcPredio].forEach(function(s){ol.extent.extend(ext,s.getExtent());});
      if(Number.isFinite(ext[0])){
        previewMapColonia.getView().fit(ext,{padding:[40,40,40,40],maxZoom:17,duration:250});
      }
      try{previewMapColonia.renderSync();}catch(e){}
    }

    function centrarMapaFichaColonia(){
      window.__coloniaVistaUsuario=false;
      centrar(true);
    }
    window.centrarMapaFichaColonia=centrarMapaFichaColonia;

    if(mapaInicialFicha){
      const img=document.getElementById("previewColoniaMapPlaceholder");
      if(img){img.src=mapaInicialFicha;img.classList.add("activo");}
      document.getElementById("previewColoniaMapLoading")?.classList.add("oculto");
      marcarMapaListoColonia();
    }else{
      previewMapColonia.once("rendercomplete",marcarMapaListoColonia);
      setTimeout(function(){centrar(false);},80);
      setTimeout(function(){centrar(false);},600);
    }
  }

  function bootMapaFichaColonia(){
    function arrancar(){
      if(typeof ajustarPapelColonia==="function")ajustarPapelColonia({});
      if(typeof aplicarAltoMapaColonia==="function")aplicarAltoMapaColonia();
      try{iniciarMapaFichaColonia();}
      catch(e){mostrarErrorMapaColonia("No se pudo iniciar el plano cartográfico.");}
    }
    if(typeof ol!=="undefined"&&ol.Map){setTimeout(arrancar,100);return;}
    const s=document.createElement("script");
    s.src="${FICHA_COLONIA_OL_JS}";
    s.onload=function(){setTimeout(arrancar,100);};
    s.onerror=function(){mostrarErrorMapaColonia("No se pudo cargar OpenLayers.");};
    document.body.appendChild(s);
  }

  function toggleLayerPanelColonia(){
    document.getElementById("coloniaLayerPanel")?.classList.toggle("oculto");
  }

  function cambiarBaseFichaColonia(){
    const c=window.__coloniaPreviewCapas;
    if(!c)return;
    const v=document.querySelector('input[name="coloniaBasemap"]:checked')?.value||"googleHybrid";
    c.baseGoogleHybrid.setVisible(v==="googleHybrid");
    c.baseGoogleRoad.setVisible(v==="googleRoad");
    c.baseEsri.setVisible(v==="esri");
    c.baseOSM.setVisible(v==="osm");
    previewMapColonia&&previewMapColonia.render();
  }

  function actualizarCapasFichaColonia(){
    ["predio","colonia","coloniasWms","prediosWms"].forEach(toggleCapaFichaColonia);
  }

  function zoomMasColonia(){
    if(previewMapColonia){
      window.__coloniaVistaUsuario=true;
      const v=previewMapColonia.getView();
      v.setZoom((v.getZoom()||16)+1);
    }
  }
  function zoomMenosColonia(){
    if(previewMapColonia){
      window.__coloniaVistaUsuario=true;
      const v=previewMapColonia.getView();
      v.setZoom((v.getZoom()||16)-1);
    }
  }

  function capturarMapaFichaColonia(mapInst,timeoutMs){
    timeoutMs=timeoutMs||3500;
    return new Promise(function(resolve){
      let resuelto=false;
      function finalizar(img){if(!resuelto){resuelto=true;resolve(img);}}
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
                  }else{matrix=[1,0,0,1,0,0];}
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

  function esperarLayoutImpresionColonia(callback){
    const vistaGuardada=typeof guardarVistaMapaColonia==="function"?guardarVistaMapaColonia():null;
    let paso=0;
    function tick(){
      if(typeof ajustarPapelColonia==="function")ajustarPapelColonia({impresion:true});
      if(typeof aplicarAltoMapaColonia==="function")aplicarAltoMapaColonia();
      if(previewMapColonia){
        previewMapColonia.updateSize();
        if(vistaGuardada&&typeof restaurarVistaMapaColonia==="function")restaurarVistaMapaColonia(vistaGuardada);
        try{previewMapColonia.renderSync();}catch(e){}
      }
      paso++;
      if(paso>=4){setTimeout(callback,140);return;}
      setTimeout(tick,paso<2?120:180);
    }
    tick();
  }

  function prepararMapaImpresionColonia(){
    document.body.classList.add("ficha-colonia-imprimiendo");
    const img=document.getElementById("previewColoniaMapPrintImg");
    const wrap=document.getElementById("previewColoniaMapWrap");
    if(!previewMapColonia||!img)return Promise.resolve(false);
    const vistaGuardada=typeof guardarVistaMapaColonia==="function"?guardarVistaMapaColonia():null;
    if(typeof ajustarPapelColonia==="function")ajustarPapelColonia({impresion:true});
    if(typeof aplicarAltoMapaColonia==="function")aplicarAltoMapaColonia();
    previewMapColonia.updateSize();
    if(vistaGuardada&&typeof restaurarVistaMapaColonia==="function")restaurarVistaMapaColonia(vistaGuardada);
    try{previewMapColonia.renderSync();}catch(e){}
    return new Promise(function(resolve){
      setTimeout(function(){
        capturarMapaFichaColonia(previewMapColonia,5000).then(function(dataUrl){
          if(dataUrl){
            img.src=dataUrl;
            img.classList.add("activo");
            if(wrap)wrap.classList.add("colonia-print-listo");
            resolve(true);
            return;
          }
          resolve(false);
        });
      },500);
    });
  }

  function restaurarMapaImpresionColonia(){
    document.body.classList.remove("ficha-colonia-imprimiendo");
    const img=document.getElementById("previewColoniaMapPrintImg");
    const wrap=document.getElementById("previewColoniaMapWrap");
    if(img){img.classList.remove("activo");img.removeAttribute("src");}
    if(wrap)wrap.classList.remove("colonia-print-listo");
    if(typeof ajustarPapelColonia==="function")ajustarPapelColonia({});
    if(previewMapColonia){previewMapColonia.updateSize();try{previewMapColonia.renderSync();}catch(e){}}
  }

  function imprimirFichaColonia(){
    const btn=document.getElementById("btnImprimirColonia");
    if(btn)btn.disabled=true;
    esperarLayoutImpresionColonia(function(){
      prepararMapaImpresionColonia().then(function(ok){
        if(!ok&&previewMapColonia){previewMapColonia.updateSize();try{previewMapColonia.renderSync();}catch(e){}}
        function onAfterPrint(){
          restaurarMapaImpresionColonia();
          if(btn)btn.disabled=false;
          window.removeEventListener("afterprint",onAfterPrint);
        }
        window.addEventListener("afterprint",onAfterPrint);
        setTimeout(function(){window.print();},400);
      });
    });
  }

  window.toggleLayerPanelColonia=toggleLayerPanelColonia;
  window.actualizarCapasFichaColonia=actualizarCapasFichaColonia;
  window.cambiarBaseFichaColonia=cambiarBaseFichaColonia;
  window.zoomMasColonia=zoomMasColonia;
  window.zoomMenosColonia=zoomMenosColonia;
  window.imprimirFichaColonia=imprimirFichaColonia;
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",bootMapaFichaColonia);}
  else{bootMapaFichaColonia();}
  `;
}

function buildFichaColoniaLayoutScript() {
  return `
  const FICHA_PAPEL_COLONIA={carta:{ancho:8.5,alto:11},legal:{ancho:8.5,alto:14}};
  let fichaColoniaPapel="carta";
  let fichaColoniaOrientacion="portrait";

  function dimensionesPaginaColonia(){
    const base=FICHA_PAPEL_COLONIA[fichaColoniaPapel]||FICHA_PAPEL_COLONIA.carta;
    if(fichaColoniaOrientacion==="landscape"){
      return{ancho:base.alto,alto:base.ancho};
    }
    return{ancho:base.ancho,alto:base.alto};
  }

  function aplicarReglaPaginaColonia(){
    let style=document.getElementById("coloniaPageRule");
    if(!style){
      style=document.createElement("style");
      style.id="coloniaPageRule";
      document.head.appendChild(style);
    }
    const d=dimensionesPaginaColonia();
    const ori=fichaColoniaOrientacion==="landscape"?"landscape":"portrait";
    style.textContent="@media print{@page{size:"+d.ancho+"in "+d.alto+"in "+ori+";margin:3mm;}}";
  }

  function mapInToPx(mapIn){
    const inch=parseFloat(mapIn);
    if(isNaN(inch)||inch<=0)return 320;
    return Math.max(220,Math.round(inch*96));
  }

  function aplicarAltoMapaColonia(){
    const mapEl=document.getElementById("previewColoniaMap");
    const wrapEl=document.getElementById("previewColoniaMapWrap");
    const mapIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-map").trim();
    if(mapIn&&wrapEl){
      const px=mapInToPx(mapIn);
      const pxCss=px+"px";
      wrapEl.style.height=pxCss;
      wrapEl.style.minHeight=pxCss;
      wrapEl.style.maxHeight=pxCss;
      ["previewColoniaMapPlaceholder","previewColoniaMapLoading","previewColoniaMapPrintImg"].forEach(function(id){
        const el=document.getElementById(id);
        if(el){el.style.height="100%";el.style.minHeight="100%";}
      });
      if(mapEl){mapEl.style.width="100%";mapEl.style.height="100%";}
    }
    if(typeof previewMapColonia!=="undefined"&&previewMapColonia){
      previewMapColonia.updateSize();
      try{previewMapColonia.renderSync();}catch(e){}
    }
  }

  function medirReservadoColoniaIn(){
    const cont=document.querySelector(".contenedor");
    if(!cont)return 4.1;
    let px=0;
    Array.from(cont.children).forEach(function(el){
      if(el.classList.contains("seccion-mapa")){
        const head=el.querySelector(".media-head");
        if(head)px+=head.getBoundingClientRect().height;
        return;
      }
      if(el.classList.contains("seccion-leyenda"))return;
      px+=el.getBoundingClientRect().height;
    });
    return Math.max(2.35,px/96+0.02);
  }

  function ajustarPapelColonia(opciones){
    opciones=opciones||{};
    const esImpresion=!!opciones.impresion;
    const d=dimensionesPaginaColonia();
    const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",d.ancho+"in");
    root.style.setProperty("--ficha-alto",d.alto+"in");
    document.body.classList.remove("papel-carta","papel-legal","orient-portrait","orient-landscape");
    document.body.classList.add("papel-"+fichaColoniaPapel);
    document.body.classList.add("orient-"+fichaColoniaOrientacion);
    aplicarReglaPaginaColonia();
    let reservado=medirReservadoColoniaIn();
    const margenPagina=esImpresion?0.06:0.1;
    const altoPagina=esImpresion?(d.alto-margenPagina*2):d.alto;
    let mapIn=altoPagina-reservado-(esImpresion?0.01:0.06);
    const minMap=fichaColoniaOrientacion==="landscape"?3.6:2.4;
    mapIn=Math.max(minMap,+mapIn.toFixed(2));
    root.style.setProperty("--ficha-media-map",mapIn+"in");
    if(esImpresion){
      root.style.setProperty("--ficha-contenido-alto",(reservado+mapIn).toFixed(2)+"in");
    }else{
      root.style.removeProperty("--ficha-contenido-alto");
    }
    requestAnimationFrame(aplicarAltoMapaColonia);
  }

  function setTamanoPapelColonia(tipo){
    fichaColoniaPapel=(tipo==="legal")?"legal":"carta";
    const sel=document.getElementById("tamanoPapelColonia");
    if(sel)sel.value=fichaColoniaPapel;
    requestAnimationFrame(function(){ajustarPapelColonia({});});
  }

  function setOrientacionColonia(tipo){
    fichaColoniaOrientacion=(tipo==="landscape")?"landscape":"portrait";
    const sel=document.getElementById("orientacionColonia");
    if(sel)sel.value=fichaColoniaOrientacion;
    requestAnimationFrame(function(){ajustarPapelColonia({});});
  }

  function initLayoutColonia(){
    setTimeout(function(){ajustarPapelColonia({});},80);
    setTimeout(function(){ajustarPapelColonia({});},500);
    setTimeout(function(){
      ajustarPapelColonia({});
      if(typeof centrarMapaFichaColonia==="function")centrarMapaFichaColonia();
    },1400);
  }

  window.ajustarPapelColonia=ajustarPapelColonia;
  window.setTamanoPapelColonia=setTamanoPapelColonia;
  window.setOrientacionColonia=setOrientacionColonia;
  window.aplicarAltoMapaColonia=aplicarAltoMapaColonia;
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initLayoutColonia);}
  else{initLayoutColonia();}
  window.addEventListener("resize",function(){
    clearTimeout(window.__coloniaResizeT);
    window.__coloniaResizeT=setTimeout(function(){ajustarPapelColonia({});},160);
  });
  `;
}

function construirHtmlFichaColoniaVentana(datos, coloniaData, opciones) {
  opciones = opciones || {};
  const baseHref = String(opciones.baseHref || "./");
  const mapaInicial = String(opciones.mapaInicial || "");
  const attrs = fichaColoniaAtributos(coloniaData);
  const clave = fichaColoniaEsc(datos?.clave || coloniaData?.clave_catastral || "—");
  const coloniaPadron = fichaColoniaEsc(coloniaData?.colonia || datos?.colonia || "—");
  const coloniaCarto = fichaColoniaEsc(fichaColoniaNombreCarto(coloniaData));
  const delegacion = fichaColoniaEsc(coloniaData?.delegacion || datos?.p?.delegacion || "MEXICALI");
  const numof = String(datos?.numof || coloniaData?.numof || datos?.p?.numof || "").trim();
  const domicilio = typeof construirDomicilioFisicoFicha === "function"
    ? fichaColoniaEsc(construirDomicilioFisicoFicha(datos?.p || {}, numof))
    : fichaColoniaEsc(`${coloniaData?.calle || datos?.calle || ""} — ${coloniaPadron}`);
  const usoPadron = fichaColoniaEsc(coloniaData?.uso_padron || datos?.uso || "—");
  const tipo = fichaColoniaEsc(attrs.tipo);
  const fraccionamiento = fichaColoniaEsc(attrs.fraccionamiento);
  const codigo = fichaColoniaEsc(attrs.codigo);
  const observaciones = fichaColoniaEsc(attrs.observaciones);
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const featuresPayload = serializarFeaturesColoniaFicha(coloniaData);
  const mapScript = buildFichaColoniaMapScript(featuresPayload, mapaInicial);
  const layoutScript = buildFichaColoniaLayoutScript();
  const placeholderActivo = mapaInicial ? " activo" : "";

  return `<!DOCTYPE html>
<html lang="es" class="papel-carta orient-portrait">
<head>
<meta charset="UTF-8">
<base href="${fichaColoniaEsc(baseHref)}">
<title>Ficha ubicación colonia ${clave}</title>
<link rel="stylesheet" href="${FICHA_COLONIA_OL_CSS}">
<style>
:root{--guinda:#703341;--guinda-claro:#d8bdc5;--texto-valor:#1e293b;--ficha-ancho:8.5in;--ficha-alto:11in;--ficha-media-map:4.35in;}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto-valor);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar button:disabled{opacity:.55;cursor:not-allowed;}
.toolbar-papel{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569;font-weight:700;}
.toolbar-papel select{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;color:#334155;background:#fff;}
.colonia-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(220px,1fr);gap:10px;font-size:12px;}
.colonia-layer-panel.oculto{display:none!important;}
.colonia-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.colonia-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
.contenedor{width:min(100%,var(--ficha-ancho));max-width:var(--ficha-ancho);height:auto;min-height:0;margin:12px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);border:1px solid var(--guinda);border-radius:6px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;}
.encabezado{background:var(--guinda)!important;color:#fff!important;padding:10px 12px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;border-bottom:3px solid #c9a227;}
.enc-logo img{height:52px;max-width:220px;object-fit:contain;background:#fff;padding:3px 8px;border-radius:6px;}
.enc-centro{text-align:center;}
.enc-centro .titulo-colonia{margin:0;font-size:20px;font-weight:900;color:#fff!important;letter-spacing:.4px;}
.enc-centro .clave-colonia{margin:5px 0 0;font-size:15px;font-weight:900;color:#fff!important;letter-spacing:.12em;}
.grid-datos{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--guinda-claro);}
.grid-datos .celda{border-right:1px solid #efe6e8;border-bottom:1px solid #efe6e8;padding:4px 7px;min-height:30px;box-sizing:border-box;}
.grid-datos .celda:last-child{border-right:none;}
.grid-datos .full{grid-column:span 4;border-right:none;}
.grid-datos .span2{grid-column:span 2;}
.grid-datos .span3{grid-column:span 3;}
.label{font-size:8px;color:#1e293b;font-weight:700;text-transform:uppercase;margin-bottom:1px;}
.valor,.grid-datos .valor{font-size:10px;font-weight:800;color:var(--guinda)!important;line-height:1.25;word-break:break-word;}
.valor-colonia-carto{font-size:11px;font-weight:800;letter-spacing:.02em;line-height:1.2;}
.seccion-mapa{border-top:1px solid var(--guinda-claro);flex:0 0 auto;display:flex;flex-direction:column;}
.seccion-mapa .media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:9px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;flex:0 0 auto;}
.colonia-map-wrap{position:relative;width:100%;height:var(--ficha-media-map);min-height:var(--ficha-media-map);max-height:var(--ficha-media-map);flex:0 0 auto;overflow:hidden;background:#eaeaea;line-height:0;border:2px solid var(--guinda);box-sizing:border-box;box-shadow:inset 0 0 0 1px rgba(201,162,39,.45);}
#previewColoniaMap{position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#eaeaea;}
.colonia-map-placeholder,.colonia-map-print-snapshot{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;background:#eaeaea;z-index:1;}
.colonia-map-placeholder.activo{display:block;z-index:3;}
.colonia-map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(234,234,234,.92);color:#703341;font-size:12px;font-weight:700;z-index:4;}
.colonia-map-loading.oculto{display:none!important;}
.colonia-map-error{padding:16px;color:#991b1b;font-size:12px;font-weight:700;}
.seccion-leyenda{display:flex;flex-wrap:wrap;gap:10px 16px;padding:5px 8px;border-top:1px solid var(--guinda-claro);background:#fafafa;font-size:8px;font-weight:700;color:#475569;}
.seccion-leyenda span{display:inline-flex;align-items:center;gap:5px;}
.leyenda-swatch{display:inline-block;width:12px;height:12px;border-radius:2px;border:1px solid rgba(0,0,0,.15);}
.leyenda-predio{background:rgba(37,99,235,.52);border:2px solid #1e3a8a;}
.leyenda-colonia{background:rgba(124,58,237,.14);border:2px solid #7c3aed;}
.leyenda-wms{background:rgba(34,197,94,.2);border-color:#22c55e;}
.pie-ficha{display:flex;justify-content:space-between;align-items:center;padding:6px 10px 8px;border-top:1px solid var(--guinda-claro);font-size:9px;color:var(--guinda);font-weight:700;flex:0 0 auto;}
.pie-ficha .leyenda-colonia-txt{color:var(--guinda);font-size:11px;font-weight:900;}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:6px 8px;font-style:italic;}
@media print{
  html,body{width:var(--ficha-ancho);height:auto;margin:0!important;padding:0!important;background:#fff!important;}
  .toolbar,.colonia-layer-panel,.aviso-impresion{display:none!important;}
  .contenedor{width:var(--ficha-ancho)!important;max-width:var(--ficha-ancho)!important;height:var(--ficha-contenido-alto,auto)!important;min-height:0!important;margin:0 auto!important;box-shadow:none!important;border-radius:0!important;page-break-after:avoid;page-break-inside:avoid;}
  .seccion-mapa{flex:0 0 auto!important;}
  .colonia-map-wrap{height:var(--ficha-media-map)!important;min-height:var(--ficha-media-map)!important;max-height:var(--ficha-media-map)!important;overflow:hidden!important;}
  #previewColoniaMap{position:absolute!important;inset:0!important;height:100%!important;}
  body.ficha-colonia-imprimiendo .colonia-map-wrap.colonia-print-listo #previewColoniaMap{display:none!important;}
  body.ficha-colonia-imprimiendo .colonia-map-print-snapshot.activo,.colonia-map-print-snapshot.activo{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="zoomMasColonia()">Zoom +</button>
    <button type="button" onclick="zoomMenosColonia()">Zoom −</button>
    <button type="button" onclick="centrarMapaFichaColonia&&centrarMapaFichaColonia()">Centrar</button>
    <label class="toolbar-papel">
      <select id="tamanoPapelColonia" onchange="setTamanoPapelColonia(this.value)" title="Tamaño de hoja">
        <option value="carta" selected>Carta 8.5×11</option>
        <option value="legal">Oficio 8.5×14</option>
      </select>
    </label>
    <label class="toolbar-papel">
      <select id="orientacionColonia" onchange="setOrientacionColonia(this.value)" title="Orientación de hoja">
        <option value="portrait" selected>Vertical</option>
        <option value="landscape">Horizontal</option>
      </select>
    </label>
    <button type="button" class="sec" onclick="toggleLayerPanelColonia()">Capas</button>
    <button type="button" id="btnImprimirColonia" disabled onclick="imprimirFichaColonia()">Cargando mapa…</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaColoniaLayerPanelHtml()}
  <div class="aviso-impresion" id="coloniaMapaEstado">Cargando plano cartográfico…</div>

  <div class="contenedor">
    <header class="encabezado">
      <div class="enc-logo"><img src="${LOGO_FICHA_COLONIA_URL}" alt="Gobierno de Mexicali"></div>
      <div class="enc-centro">
        <h1 class="titulo-colonia">FICHA DE UBICACIÓN EN COLONIA</h1>
        <p class="clave-colonia">${clave}</p>
      </div>
    </header>

    <div class="grid-datos">
      <div class="celda full"><div class="label">Domicilio físico</div><div class="valor">${domicilio}</div></div>
      <div class="celda"><div class="label">Delegación</div><div class="valor">${delegacion}</div></div>
      <div class="celda span3"><div class="label">Uso en padrón</div><div class="valor">${usoPadron}</div></div>
      <div class="celda"><div class="label">Colonia (padrón)</div><div class="valor">${coloniaPadron}</div></div>
      <div class="celda span3"><div class="label">Colonia (cartografía)</div><div class="valor valor-colonia-carto">${coloniaCarto}</div></div>
      <div class="celda"><div class="label">Tipo / clasificación</div><div class="valor">${tipo}</div></div>
      <div class="celda"><div class="label">Fraccionamiento</div><div class="valor">${fraccionamiento}</div></div>
      <div class="celda"><div class="label">Código / clave</div><div class="valor">${codigo}</div></div>
      <div class="celda"><div class="label">Número oficial</div><div class="valor">${fichaColoniaEsc(numof || "—")}</div></div>
      <div class="celda full"><div class="label">Observaciones (capa)</div><div class="valor">${observaciones}</div></div>
    </div>

    <section class="seccion-mapa">
      <div class="media-head">Plano de ubicación · ${coloniaCarto}</div>
      <div class="colonia-map-wrap" id="previewColoniaMapWrap">
        <img id="previewColoniaMapPlaceholder" class="colonia-map-placeholder${placeholderActivo}" alt="">
        <div id="previewColoniaMapLoading" class="colonia-map-loading${mapaInicial ? " oculto" : ""}">Cargando plano…</div>
        <img id="previewColoniaMapPrintImg" class="colonia-map-print-snapshot" alt="">
        <div id="previewColoniaMap"></div>
      </div>
    </section>

    <section class="seccion-leyenda">
      <span><i class="leyenda-swatch leyenda-predio"></i> Predio consultado</span>
      <span><i class="leyenda-swatch leyenda-colonia"></i> Límite de colonia</span>
      <span><i class="leyenda-swatch leyenda-wms"></i> Colonias (WMS)</span>
    </section>

    <div class="pie-ficha">
      <span class="leyenda-colonia-txt">${coloniaCarto} · geonode:${FICHA_COLONIA_WMS_LAYER}</span>
      <span>${fichaColoniaEsc(fechaPie)}</span>
    </div>
  </div>

  <script>${layoutScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirPreviewFichaColonia() {
  const clave = String(
    popupColoniaClaveActual ||
    window.predioSeleccionado?.clave_catastral ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio con clave catastral.");
    return null;
  }

  let coloniaData = popupColoniaDatos;
  const p = window.predioSeleccionado || {};

  if (!coloniaData || coloniaData.clave_catastral !== clave) {
    if (typeof cargarColoniaFraccionamiento === "function") {
      try {
        coloniaData = await cargarColoniaFraccionamiento(clave, p);
      } catch (e) {
        alert(e.message || "No se pudo consultar colonia/fraccionamiento.");
        return null;
      }
    }
  }

  if (!coloniaData?.geometry) {
    alert("Sin geometría cartográfica para generar la ficha de ubicación.");
    return null;
  }

  const datos = typeof cargarDatosFichaCatastral === "function"
    ? await cargarDatosFichaCatastral(clave)
    : {
      clave,
      nombre: p.nombre_completo || "—",
      colonia: p.colonia || "—",
      calle: p.calle || "—",
      numof: p.numof || "",
      uso: p.descripcion_uso || "—",
      p
    };

  if (!datos) {
    alert("No se pudieron cargar los datos del predio.");
    return null;
  }

  let mapaInicial = "";
  if (typeof popupColoniaCapturarMapaDataUrl === "function" && popupColoniaMap) {
    try {
      mapaInicial = await popupColoniaCapturarMapaDataUrl() || "";
    } catch (e) {
      console.warn("Ficha colonia: no se pudo capturar mapa del popup:", e);
    }
  }

  const baseHref = window.location.href.replace(/[^/]*$/, "");
  const win = window.open("", "_blank", "width=1200,height=920");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes.");
    return null;
  }

  win.document.open();
  win.document.write(construirHtmlFichaColoniaVentana(datos, coloniaData, { baseHref, mapaInicial }));
  win.document.close();
  return win;
}

window.abrirPreviewFichaColonia = abrirPreviewFichaColonia;
window.construirHtmlFichaColoniaVentana = construirHtmlFichaColoniaVentana;
