/* Ficha Carta Urbana 2040 — vista previa e impresión */

const LOGO_FICHA_CARTA_URL = "logomxli.png";
const FICHA_CARTA_OL_CSS = typeof OL_FICHA_CSS !== "undefined"
  ? OL_FICHA_CSS
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const FICHA_CARTA_OL_JS = typeof OL_FICHA_CDN !== "undefined"
  ? OL_FICHA_CDN
  : "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const FICHA_CARTA_GEONODE_WMS = typeof POPUP_CARTA_GEONODE_WMS !== "undefined"
  ? POPUP_CARTA_GEONODE_WMS
  : "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";
const FICHA_CARTA_WMS_LAYER = typeof POPUP_CARTA_WMS_LAYER !== "undefined"
  ? POPUP_CARTA_WMS_LAYER
  : "usos_prop_au40";
const FICHA_CARTA_SECTORES_LAYER = typeof POPUP_CARTA_SECTORES_LAYER !== "undefined"
  ? POPUP_CARTA_SECTORES_LAYER
  : "sectores";

function fichaCartaEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaCartaVal(valor) {
  if (valor == null || String(valor).trim() === "") return "—";
  return String(valor).trim();
}

const FICHA_CARTA_SIMBOLOGIA = [
  { label: "Reservas integrales de ocupación condicionada", swatch: "sim-reservas" },
  { label: "Infraestructura - Propuesto", swatch: "sim-infra-prop" },
  { label: "Equipamiento - Propuesto", swatch: "sim-eq-prop" },
  { label: "Conservación - Propuesto", swatch: "sim-cons-prop" },
  { label: "Área verde - Propuesto", swatch: "sim-verde-prop" },
  { label: "Almacenamiento y servicios - Propuesto", swatch: "sim-almac-prop" },
  { label: "Comercio y servicios - Propuesto", swatch: "sim-com-prop" },
  { label: "Mixto (com-eq-ind) - Propuesto", swatch: "sim-mix-cei-prop" },
  { label: "Mixto (hab-com) - Propuesto", swatch: "sim-mix-hc-prop" },
  { label: "Mixto (hab-eq) - Propuesto", swatch: "sim-mix-he-prop" },
  { label: "Industrial - Propuesto", swatch: "sim-ind-prop" },
  { label: "Habitacional - Propuesto", swatch: "sim-hab-prop" },
  { label: "Equipamiento - Existente", swatch: "sim-eq-ex" },
  { label: "Conservación - Existente", swatch: "sim-cons-ex" },
  { label: "Área verde - Existente", swatch: "sim-verde-ex" },
  { label: "Infraestructura - Existente", swatch: "sim-infra-ex" },
  { label: "Comercio y servicios - Existente", swatch: "sim-com-ex" },
  { label: "Almacenamiento y servicios - Existente", swatch: "sim-almac-ex" },
  { label: "Mixto - Existente", swatch: "sim-mix-ex" },
  { label: "Industrial - Existente", swatch: "sim-ind-ex" },
  { label: "Habitacional - Existente", swatch: "sim-hab-ex" }
];

function fichaCartaSimbologiaHtml() {
  return FICHA_CARTA_SIMBOLOGIA.map(function(item) {
    return `<span class="sim-item"><i class="sim-swatch ${item.swatch}"></i><span class="sim-text">${fichaCartaEsc(item.label)}</span></span>`;
  }).join("");
}

function fichaCartaSectorCodigo(cartaData) {
  if (!cartaData) return "—";
  return fichaCartaVal(
    cartaData.sector?.codigo
    || (typeof popupCartaExtraerSector === "function" ? popupCartaExtraerSector(cartaData.sector?.properties) : "")
    || (typeof popupCartaExtraerSector === "function" ? popupCartaExtraerSector(cartaData.carta_urbana?.properties) : "")
  );
}

function fichaCartaAtributos(cartaData) {
  return cartaData?.carta_urbana?.atributos
    || (typeof popupCartaNormalizarAtributos === "function"
      ? popupCartaNormalizarAtributos(cartaData?.carta_urbana?.properties)
      : {});
}

function serializarFeaturesCartaFicha(cartaData) {
  const features = [];
  if (cartaData?.geometry) {
    features.push({
      type: "Feature",
      geometry: cartaData.geometry,
      properties: {
        clave_catastral: cartaData.clave_catastral,
        es_consultado: true
      }
    });
  }
  if (cartaData?.carta_urbana?.geometry) {
    features.push({
      type: "Feature",
      geometry: cartaData.carta_urbana.geometry,
      properties: { es_zona: true }
    });
  }
  return {
    type: "FeatureCollection",
    features,
    wmsLayer: cartaData?.wms_layer || FICHA_CARTA_WMS_LAYER,
    sectoresLayer: FICHA_CARTA_SECTORES_LAYER
  };
}

function fichaCartaHtmlLayerItem(id, opts) {
  const { checkboxId, dotClass, label, checked, opacity } = opts;
  const chk = checked ? "checked" : "";
  const op = opacity == null ? 100 : opacity;
  return `
    <div class="layer-item carta-layer-item" data-layer-id="${id}">
      <div class="layer-top">
        <label class="layer-name">
          <input type="checkbox" id="${checkboxId}" ${chk} onchange="toggleCapaFichaCarta('${id}')">
          <span class="layer-dot ${dotClass}"></span>
          <b>${label}</b>
        </label>
        <span id="cartaOp${id}Txt" class="layer-percent">${op}%</span>
      </div>
      <input type="range" min="0" max="100" value="${op}" id="cartaOp${id}"
        oninput="cambiarOpacidadCapaFichaCarta('${id}', this.value)">
      <div class="layer-actions">
        <button type="button" onclick="subirCapaFichaCarta('${id}')">↑ Subir</button>
        <button type="button" onclick="bajarCapaFichaCarta('${id}')">↓ Bajar</button>
      </div>
    </div>`;
}

function fichaCartaLayerPanelHtml() {
  const capas = [
    fichaCartaHtmlLayerItem("predio", {
      checkboxId: "cartaChkPredio",
      dotClass: "dot-amber",
      label: "Predio consultado",
      checked: true,
      opacity: 100
    }),
    fichaCartaHtmlLayerItem("sectores", {
      checkboxId: "cartaChkSectores",
      dotClass: "dot-blue",
      label: "Sectores",
      checked: true,
      opacity: 100
    }),
    fichaCartaHtmlLayerItem("zona", {
      checkboxId: "cartaChkZona",
      dotClass: "dot-orange",
      label: "Polígono de zona",
      checked: true,
      opacity: 100
    }),
    fichaCartaHtmlLayerItem("carta", {
      checkboxId: "cartaChkUsos",
      dotClass: "dot-green",
      label: "Usos propuestos 2040",
      checked: true,
      opacity: 88
    }),
    fichaCartaHtmlLayerItem("prediosWms", {
      checkboxId: "cartaChkPrediosWms",
      dotClass: "dot-red",
      label: "Predios (WMS)",
      checked: false,
      opacity: 45
    }),
    fichaCartaHtmlLayerItem("colonias", {
      checkboxId: "cartaChkColoniasWms",
      dotClass: "dot-purple",
      label: "Colonias",
      checked: false,
      opacity: 45
    })
  ].join("");

  return `<div id="cartaLayerPanel" class="carta-layer-panel oculto">
    <div class="grupo ficha-capas-overlay carta-capas-overlay" id="cartaCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    <div class="grupo">
      <strong>Base mapas</strong>
      <label><input type="radio" name="cartaBasemap" value="googleHybrid" checked onchange="cambiarBaseFichaCarta()"> Google Hybrid</label>
      <label><input type="radio" name="cartaBasemap" value="googleRoad" onchange="cambiarBaseFichaCarta()"> Google Road</label>
      <label><input type="radio" name="cartaBasemap" value="esri" onchange="cambiarBaseFichaCarta()"> ESRI Satellite</label>
      <label><input type="radio" name="cartaBasemap" value="osm" onchange="cambiarBaseFichaCarta()"> OpenStreetMap</label>
    </div>
  </div>`;
}

function buildFichaCartaMapScript(featuresJson, mapaInicialJson) {
  const geoJson = JSON.stringify(featuresJson || { type: "FeatureCollection", features: [] });
  const mapaInicial = JSON.stringify(mapaInicialJson || "");
  return `
  let previewMapCarta=null;
  const featuresCarta=${geoJson};
  const mapaInicialFicha=${mapaInicial};
  const cartaCapaOrdenDef={predio:35,sectores:28,zona:18,carta:12,prediosWms:8,colonias:5};
  let cartaCapaOrdenEstado=Object.assign({},cartaCapaOrdenDef);
  const cartaCapaProp={predio:"capaPredio",sectores:"capaSectores",zona:"capaZona",carta:"capaUsos",prediosWms:"capaPredios",colonias:"capaColonias"};

  function obtenerCapaFichaCarta(id){
    const c=window.__cartaPreviewCapas;
    if(!c)return null;
    const k=cartaCapaProp[id];
    return k?c[k]:null;
  }

  function aplicarZIndexCapaFichaCarta(id){
    const capa=obtenerCapaFichaCarta(id);
    if(capa&&typeof capa.setZIndex==="function")capa.setZIndex(cartaCapaOrdenEstado[id]||5);
  }

  function actualizarOrdenVisualCapasFicha(){
    const cont=document.getElementById("cartaCapasOverlayList");
    if(!cont)return;
    Array.from(cont.querySelectorAll(".layer-item"))
      .sort(function(a,b){
        const za=cartaCapaOrdenEstado[a.dataset.layerId]||0;
        const zb=cartaCapaOrdenEstado[b.dataset.layerId]||0;
        return zb-za;
      })
      .forEach(function(item){cont.appendChild(item);});
  }

  function inicializarOrdenCapasFicha(){
    Object.keys(cartaCapaProp).forEach(function(id){
      const capa=obtenerCapaFichaCarta(id);
      if(capa){
        capa.set("layerId",id);
        aplicarZIndexCapaFichaCarta(id);
      }
    });
    actualizarOrdenVisualCapasFicha();
  }

  function cambiarOpacidadCapaFichaCarta(id,valor){
    const opacidad=Number(valor)/100;
    const txt=document.getElementById("cartaOp"+id+"Txt");
    if(txt)txt.innerText=valor+"%";
    const capa=obtenerCapaFichaCarta(id);
    if(capa&&typeof capa.setOpacity==="function")capa.setOpacity(opacidad);
    previewMapCarta&&previewMapCarta.render();
  }

  function subirCapaFichaCarta(id){
    cartaCapaOrdenEstado[id]=(cartaCapaOrdenEstado[id]||0)+10;
    aplicarZIndexCapaFichaCarta(id);
    actualizarOrdenVisualCapasFicha();
    previewMapCarta&&previewMapCarta.render();
  }

  function bajarCapaFichaCarta(id){
    cartaCapaOrdenEstado[id]=(cartaCapaOrdenEstado[id]||0)-10;
    aplicarZIndexCapaFichaCarta(id);
    actualizarOrdenVisualCapasFicha();
    previewMapCarta&&previewMapCarta.render();
  }

  function toggleCapaFichaCarta(id){
    const chkMap={carta:"cartaChkUsos",sectores:"cartaChkSectores",predio:"cartaChkPredio",zona:"cartaChkZona",prediosWms:"cartaChkPrediosWms",colonias:"cartaChkColoniasWms"};
    const capa=obtenerCapaFichaCarta(id);
    if(!capa)return;
    const chkId=chkMap[id];
    const visible=id==="colonias"||id==="prediosWms"
      ?document.getElementById(chkId)?.checked===true
      :document.getElementById(chkId)?.checked!==false;
    capa.setVisible(visible);
    previewMapCarta&&previewMapCarta.render();
  }

  function crearWmsCarta(url,layers,visible,opacity,zIndex){
    return new ol.layer.Tile({
      visible:!!visible,
      opacity:opacity==null?0.88:opacity,
      zIndex:zIndex==null?5:zIndex,
      source:new ol.source.TileWMS({
        url:url,
        params:{LAYERS:layers,TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",
        crossOrigin:"anonymous"
      })
    });
  }

  function estiloPredioCarta(){
    return [
      new ol.style.Style({zIndex:40,stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.92)",width:6,lineDash:[8,6]})}),
      new ol.style.Style({zIndex:41,stroke:new ol.style.Stroke({color:"#111827",width:4,lineDash:[6,5]})})
    ];
  }

  function estiloZonaCarta(){
    return new ol.style.Style({
      zIndex:20,
      stroke:new ol.style.Stroke({color:"#b45309",width:2,lineDash:[6,4]}),
      fill:new ol.style.Fill({color:"rgba(245,158,11,0.18)"})
    });
  }

  function iniciarMapaFichaCarta(){
    const targetEl=document.getElementById("previewCartaMap");
    if(!targetEl||typeof ol==="undefined"||!ol.Map){
      mostrarErrorMapaCarta("OpenLayers no está disponible.");
      return;
    }
    if(previewMapCarta)return;

    const wmsLayer=featuresCarta.wmsLayer||"${FICHA_CARTA_WMS_LAYER}";
    const sectoresLayer=featuresCarta.sectoresLayer||"${FICHA_CARTA_SECTORES_LAYER}";
    const baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseGoogleRoad=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    const baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    const baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});
    const capaUsos=crearWmsCarta("${FICHA_CARTA_GEONODE_WMS}",wmsLayer,true,0.88,cartaCapaOrdenDef.carta);
    const capaSectores=crearWmsCarta("${FICHA_CARTA_GEONODE_WMS}",sectoresLayer,true,1,cartaCapaOrdenDef.sectores);
    const capaPredios=crearWmsCarta("https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms","catastro_bc:predios_oficial",false,0.45,cartaCapaOrdenDef.prediosWms);
    const capaColonias=crearWmsCarta("${FICHA_CARTA_GEONODE_WMS}","colonias",false,0.45,cartaCapaOrdenDef.colonias);

    const srcPredio=new ol.source.Vector();
    const srcZona=new ol.source.Vector();
    const format=new ol.format.GeoJSON({dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"});
    (featuresCarta.features||[]).forEach(function(f){
      const p=f.properties||{};
      const feats=format.readFeatures({type:"Feature",geometry:f.geometry,properties:p});
      if(p.es_consultado)srcPredio.addFeatures(feats);
      else if(p.es_zona)srcZona.addFeatures(feats);
    });

    const capaPredio=new ol.layer.Vector({source:srcPredio,zIndex:cartaCapaOrdenDef.predio,style:estiloPredioCarta});
    const capaZona=new ol.layer.Vector({source:srcZona,zIndex:cartaCapaOrdenDef.zona,style:estiloZonaCarta});

    previewMapCarta=new ol.Map({
      target:"previewCartaMap",
      layers:[baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaUsos,capaSectores,capaPredios,capaColonias,capaZona,capaPredio],
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:18}),
      controls:[]
    });
    window.__cartaPreviewCapas={baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaUsos,capaSectores,capaPredios,capaColonias,capaPredio,capaZona};
    window.__cartaVistaUsuario=false;
    inicializarOrdenCapasFicha();

    function marcarVistaUsuarioCarta(){window.__cartaVistaUsuario=true;}
    targetEl.addEventListener("wheel",marcarVistaUsuarioCarta,{passive:true});
    previewMapCarta.on("pointerdrag",marcarVistaUsuarioCarta);

    function guardarVistaMapaCarta(){
      if(!previewMapCarta)return null;
      const v=previewMapCarta.getView();
      return{center:v.getCenter(),zoom:v.getZoom(),rotation:v.getRotation()};
    }
    function restaurarVistaMapaCarta(estado){
      if(!previewMapCarta||!estado)return;
      const v=previewMapCarta.getView();
      if(estado.center)v.setCenter(estado.center);
      if(estado.zoom!=null)v.setZoom(estado.zoom);
      if(estado.rotation!=null)v.setRotation(estado.rotation);
    }
    window.guardarVistaMapaCarta=guardarVistaMapaCarta;
    window.restaurarVistaMapaCarta=restaurarVistaMapaCarta;

    function marcarMapaListoCarta(){
      document.getElementById("previewCartaMapPlaceholder")?.classList.remove("activo");
      document.getElementById("previewCartaMapLoading")?.classList.add("oculto");
      const btn=document.getElementById("btnImprimirCarta");
      if(btn){btn.disabled=false;btn.textContent="Imprimir / PDF";}
      const aviso=document.getElementById("cartaMapaEstado");
      if(aviso)aviso.textContent="Mapa listo. Ajuste capas y zoom, luego pulse «Imprimir / PDF».";
    }

    function centrar(forzar){
      if(!previewMapCarta)return;
      if(!forzar&&window.__cartaVistaUsuario)return;
      if(typeof aplicarAltoMapaCarta==="function")aplicarAltoMapaCarta();
      previewMapCarta.updateSize();
      const ext=ol.extent.createEmpty();
      [srcPredio,srcZona].forEach(function(s){ol.extent.extend(ext,s.getExtent());});
      if(Number.isFinite(ext[0])){
        previewMapCarta.getView().fit(ext,{padding:[40,40,40,40],maxZoom:19,duration:250});
      }
      try{previewMapCarta.renderSync();}catch(e){}
    }

    function centrarMapaFichaCarta(){
      window.__cartaVistaUsuario=false;
      centrar(true);
    }

    previewMapCarta.once("rendercomplete",marcarMapaListoCarta);
    setTimeout(function(){centrar(false);},80);
    setTimeout(function(){centrar(false);},450);
    window.centrarMapaFichaCarta=centrarMapaFichaCarta;
  }

  function mostrarErrorMapaCarta(msg){
    document.getElementById("previewCartaMapLoading")?.classList.add("oculto");
    const el=document.getElementById("previewCartaMap");
    if(el)el.innerHTML="<div class='carta-map-error'>"+msg+"</div>";
  }

  function bootMapaFichaCarta(){
    if(mapaInicialFicha){
      const ph=document.getElementById("previewCartaMapPlaceholder");
      if(ph&&!ph.getAttribute("src"))ph.src=mapaInicialFicha;
    }
    function arrancar(){
      if(typeof ajustarPapelCarta==="function")ajustarPapelCarta({});
      if(typeof aplicarAltoMapaCarta==="function")aplicarAltoMapaCarta();
      try{iniciarMapaFichaCarta();}
      catch(e){mostrarErrorMapaCarta("No se pudo iniciar el plano cartográfico.");}
    }
    if(typeof ol!=="undefined"&&ol.Map){setTimeout(arrancar,100);return;}
    const s=document.createElement("script");
    s.src="${FICHA_CARTA_OL_JS}";
    s.onload=function(){setTimeout(arrancar,100);};
    s.onerror=function(){mostrarErrorMapaCarta("No se pudo cargar OpenLayers.");};
    document.body.appendChild(s);
  }

  function toggleLayerPanelCarta(){
    document.getElementById("cartaLayerPanel")?.classList.toggle("oculto");
  }

  function actualizarCapasFichaCarta(){
    ["carta","sectores","predio","zona","prediosWms","colonias"].forEach(toggleCapaFichaCarta);
  }

  function cambiarBaseFichaCarta(){
    const c=window.__cartaPreviewCapas;
    if(!c)return;
    const v=document.querySelector('input[name="cartaBasemap"]:checked')?.value||"googleHybrid";
    c.baseGoogleHybrid.setVisible(v==="googleHybrid");
    c.baseGoogleRoad.setVisible(v==="googleRoad");
    c.baseEsri.setVisible(v==="esri");
    c.baseOSM.setVisible(v==="osm");
    previewMapCarta&&previewMapCarta.render();
  }

  function zoomMasCarta(){
    if(previewMapCarta){
      window.__cartaVistaUsuario=true;
      const v=previewMapCarta.getView();
      v.setZoom((v.getZoom()||18)+1);
    }
  }
  function zoomMenosCarta(){
    if(previewMapCarta){
      window.__cartaVistaUsuario=true;
      const v=previewMapCarta.getView();
      v.setZoom((v.getZoom()||18)-1);
    }
  }

  function capturarMapaFichaCarta(mapInst,timeoutMs){
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

  function esperarLayoutImpresionCarta(callback){
    const vistaGuardada=typeof guardarVistaMapaCarta==="function"?guardarVistaMapaCarta():null;
    let paso=0;
    function tick(){
      if(typeof ajustarPapelCarta==="function")ajustarPapelCarta({impresion:true});
      if(typeof aplicarAltoMapaCarta==="function")aplicarAltoMapaCarta();
      if(previewMapCarta){
        previewMapCarta.updateSize();
        if(vistaGuardada&&typeof restaurarVistaMapaCarta==="function")restaurarVistaMapaCarta(vistaGuardada);
        try{previewMapCarta.renderSync();}catch(e){}
      }
      paso++;
      if(paso>=4){setTimeout(callback,140);return;}
      setTimeout(tick,paso<2?120:180);
    }
    tick();
  }

  function prepararMapaImpresionCarta(){
    document.body.classList.add("ficha-carta-imprimiendo");
    const img=document.getElementById("previewCartaMapPrintImg");
    const wrap=document.getElementById("previewCartaMapWrap");
    if(!previewMapCarta||!img)return Promise.resolve(false);
    const vistaGuardada=typeof guardarVistaMapaCarta==="function"?guardarVistaMapaCarta():null;
    if(typeof ajustarPapelCarta==="function")ajustarPapelCarta({impresion:true});
    if(typeof aplicarAltoMapaCarta==="function")aplicarAltoMapaCarta();
    previewMapCarta.updateSize();
    if(vistaGuardada&&typeof restaurarVistaMapaCarta==="function")restaurarVistaMapaCarta(vistaGuardada);
    try{previewMapCarta.renderSync();}catch(e){}
    return new Promise(function(resolve){
      setTimeout(function(){
        capturarMapaFichaCarta(previewMapCarta,5000).then(function(dataUrl){
          if(dataUrl){
            img.src=dataUrl;
            img.classList.add("activo");
            if(wrap)wrap.classList.add("carta-print-listo");
            resolve(true);
            return;
          }
          resolve(false);
        });
      },500);
    });
  }

  function restaurarMapaImpresionCarta(){
    document.body.classList.remove("ficha-carta-imprimiendo");
    const img=document.getElementById("previewCartaMapPrintImg");
    const wrap=document.getElementById("previewCartaMapWrap");
    if(img){img.classList.remove("activo");img.removeAttribute("src");}
    if(wrap)wrap.classList.remove("carta-print-listo");
    if(typeof ajustarPapelCarta==="function")ajustarPapelCarta({});
    if(previewMapCarta){previewMapCarta.updateSize();try{previewMapCarta.renderSync();}catch(e){}}
  }

  function imprimirFichaCarta(){
    const btn=document.getElementById("btnImprimirCarta");
    if(btn)btn.disabled=true;
    esperarLayoutImpresionCarta(function(){
      prepararMapaImpresionCarta().then(function(ok){
        if(!ok&&previewMapCarta){previewMapCarta.updateSize();try{previewMapCarta.renderSync();}catch(e){}}
        function onAfterPrint(){
          restaurarMapaImpresionCarta();
          if(btn)btn.disabled=false;
          window.removeEventListener("afterprint",onAfterPrint);
        }
        window.addEventListener("afterprint",onAfterPrint);
        setTimeout(function(){window.print();},400);
      });
    });
  }

  window.toggleLayerPanelCarta=toggleLayerPanelCarta;
  window.actualizarCapasFichaCarta=actualizarCapasFichaCarta;
  window.cambiarBaseFichaCarta=cambiarBaseFichaCarta;
  window.zoomMasCarta=zoomMasCarta;
  window.zoomMenosCarta=zoomMenosCarta;
  window.imprimirFichaCarta=imprimirFichaCarta;
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",bootMapaFichaCarta);}
  else{bootMapaFichaCarta();}
  `;
}

function buildFichaCartaLayoutScript() {
  return `
  const FICHA_PAPEL_CARTA={carta:{ancho:8.5,alto:11}};

  function mapInToPx(mapIn){
    const inch=parseFloat(mapIn);
    if(isNaN(inch)||inch<=0)return 320;
    return Math.max(220,Math.round(inch*96));
  }

  function aplicarAltoMapaCarta(){
    const mapEl=document.getElementById("previewCartaMap");
    const wrapEl=document.getElementById("previewCartaMapWrap");
    const mapIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-map").trim();
    if(mapIn&&wrapEl){
      const px=mapInToPx(mapIn);
      const pxCss=px+"px";
      wrapEl.style.height=pxCss;
      wrapEl.style.minHeight=pxCss;
      wrapEl.style.maxHeight=pxCss;
      ["previewCartaMapPlaceholder","previewCartaMapLoading","previewCartaMapPrintImg"].forEach(function(id){
        const el=document.getElementById(id);
        if(el){el.style.height="100%";el.style.minHeight="100%";}
      });
      if(mapEl){mapEl.style.width="100%";mapEl.style.height="100%";}
    }
    if(typeof previewMapCarta!=="undefined"&&previewMapCarta){
      previewMapCarta.updateSize();
      try{previewMapCarta.renderSync();}catch(e){}
    }
  }

  function medirReservadoCartaIn(){
    const cont=document.querySelector(".contenedor");
    if(!cont)return 4.35;
    let px=0;
    Array.from(cont.children).forEach(function(el){
      if(el.classList.contains("seccion-mapa")){
        const head=el.querySelector(".media-head");
        if(head)px+=head.getBoundingClientRect().height;
        return;
      }
      if(el.classList.contains("aviso-impresion"))return;
      px+=el.getBoundingClientRect().height;
    });
    return Math.max(2.35,px/96+0.02);
  }

  function ajustarPapelCarta(opciones){
    opciones=opciones||{};
    const esImpresion=!!opciones.impresion;
    const p=FICHA_PAPEL_CARTA.carta;
    const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",p.ancho+"in");
    root.style.setProperty("--ficha-alto",p.alto+"in");
    document.body.classList.add("papel-carta");
    document.body.classList.toggle("ficha-carta-layout-impresion",esImpresion);
    let reservado=medirReservadoCartaIn();
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
    requestAnimationFrame(aplicarAltoMapaCarta);
  }

  function initLayoutCarta(){
    setTimeout(function(){ajustarPapelCarta({});},80);
    setTimeout(function(){ajustarPapelCarta({});},500);
    setTimeout(function(){
      ajustarPapelCarta({});
      if(typeof centrarMapaFichaCarta==="function")centrarMapaFichaCarta();
    },1400);
  }

  window.ajustarPapelCarta=ajustarPapelCarta;
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initLayoutCarta);}
  else{initLayoutCarta();}
  window.addEventListener("resize",function(){
    clearTimeout(window.__cartaResizeT);
    window.__cartaResizeT=setTimeout(function(){ajustarPapelCarta({});},160);
  });
  `;
}

function construirHtmlFichaCartaUrbanaVentana(datos, cartaData, opciones) {
  opciones = opciones || {};
  const baseHref = String(opciones.baseHref || "./");
  const mapaInicial = String(opciones.mapaInicial || "");
  const attrs = fichaCartaAtributos(cartaData);
  const sector = fichaCartaSectorCodigo(cartaData);
  const usoPlan = fichaCartaVal(attrs.uso_permitido);
  const usoPadron = fichaCartaVal(cartaData?.uso_padron || datos?.uso || datos?.p?.descripcion_uso);
  const clave = fichaCartaEsc(datos?.clave || cartaData?.clave_catastral || "—");
  const coloniaTxt = fichaCartaEsc(cartaData?.colonia || datos?.colonia || "—");
  const delegacion = fichaCartaEsc(cartaData?.delegacion || datos?.p?.delegacion || "MEXICALI");
  const numof = String(datos?.numof || datos?.p?.numof || "").trim();
  const domicilio = typeof construirDomicilioFisicoFicha === "function"
    ? fichaCartaEsc(construirDomicilioFisicoFicha(datos?.p || {}, numof))
    : fichaCartaEsc(`${datos?.calle || ""} — ${coloniaTxt}`);
  const zona = fichaCartaVal(attrs.zona || attrs.nombre_zona);
  const densidad = fichaCartaVal(attrs.densidad);
  const nivel = fichaCartaVal(attrs.nivel);
  const instrumento = fichaCartaVal(attrs.instrumento);
  const observaciones = fichaCartaVal(attrs.observaciones);
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const featuresPayload = serializarFeaturesCartaFicha(cartaData);
  const mapScript = buildFichaCartaMapScript(featuresPayload, mapaInicial);
  const layoutScript = buildFichaCartaLayoutScript();
  const placeholderActivo = mapaInicial ? " activo" : "";

  return `<!DOCTYPE html>
<html lang="es" class="papel-carta">
<head>
<meta charset="UTF-8">
<base href="${fichaCartaEsc(baseHref)}">
<title>Ficha Carta Urbana 2040 ${clave}</title>
<link rel="stylesheet" href="${FICHA_CARTA_OL_CSS}">
<style>
:root{--guinda:#703341;--guinda-claro:#d8bdc5;--texto-valor:#1e293b;--ficha-ancho:8.5in;--ficha-alto:11in;--ficha-media-map:4.35in;}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto-valor);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar button:disabled{opacity:.55;cursor:not-allowed;}
.carta-layer-panel{background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(220px,1fr);gap:10px;font-size:12px;}
.carta-layer-panel.oculto{display:none!important;}
.carta-layer-panel label{display:block;margin:4px 0;cursor:pointer;}
.carta-layer-panel strong{display:block;margin-bottom:4px;color:#703341;}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
.contenedor{width:min(100%,var(--ficha-ancho));max-width:var(--ficha-ancho);height:auto;min-height:0;margin:12px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);border:1px solid var(--guinda);border-radius:6px;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;}
.encabezado{background:var(--guinda)!important;color:#fff!important;padding:10px 12px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;border-bottom:3px solid #c9a227;}
.enc-logo img{height:52px;max-width:220px;object-fit:contain;background:#fff;padding:3px 8px;border-radius:6px;}
.enc-centro{text-align:center;}
.enc-centro .titulo-carta{margin:0;font-size:20px;font-weight:900;color:#fff!important;letter-spacing:.4px;}
.enc-centro .clave-carta{margin:5px 0 0;font-size:15px;font-weight:900;color:#fff!important;letter-spacing:.12em;}
.seccion-simbologia{border-top:1px solid var(--guinda-claro);padding:4px 6px 5px;flex:0 0 auto;background:#fafafa;}
.seccion-simbologia .sim-head{font-size:7.5px;font-weight:800;color:var(--guinda);text-transform:uppercase;margin-bottom:3px;letter-spacing:.45px;}
.sim-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px 5px;align-items:start;}
.sim-item{display:flex;align-items:flex-start;gap:3px;min-width:0;}
.sim-swatch{flex:0 0 9px;width:9px;height:9px;margin-top:1px;border:1px solid #64748b;box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.sim-text{font-size:5.4px;line-height:1.12;font-weight:600;color:#1e293b;word-break:break-word;}
.sim-reservas{background:#c4b5fd;border-color:#7c3aed;}
.sim-infra-prop{background:#dbeafe;border-color:#93c5fd;}
.sim-eq-prop{background:#fff;border-color:#94a3b8;}
.sim-cons-prop{background:repeating-linear-gradient(45deg,#bbf7d0,#bbf7d0 1px,#86efac 1px,#86efac 2px);border-color:#16a34a;}
.sim-verde-prop{background:#fff;border-color:#94a3b8;}
.sim-almac-prop{background:#3b82f6;border-color:#1d4ed8;}
.sim-com-prop{background:repeating-linear-gradient(45deg,#fecaca,#fecaca 1px,#f87171 1px,#f87171 2px);border-color:#dc2626;}
.sim-mix-cei-prop{background:#fde68a;border-color:#d97706;}
.sim-mix-hc-prop{background:#fff;border-color:#94a3b8;}
.sim-mix-he-prop{background:#d9f99d;border-color:#65a30d;}
.sim-ind-prop{background:#fff;border:2px solid #9333ea;box-sizing:border-box;}
.sim-hab-prop{background:#fef08a;border-color:#ca8a04;}
.sim-eq-ex{background:#f97316;border-color:#c2410c;}
.sim-cons-ex{background:#65a30d;border-color:#3f6212;}
.sim-verde-ex{background:#84cc16;border-color:#4d7c0f;}
.sim-infra-ex{background:#06b6d4;border-color:#0e7490;}
.sim-com-ex{background:#fb7185;border-color:#e11d48;}
.sim-almac-ex{background:#1d4ed8;border-color:#1e3a8a;}
.sim-mix-ex{background:#ec4899;border-color:#be185d;}
.sim-ind-ex{background:#9333ea;border-color:#6b21a8;}
.sim-hab-ex{background:#eab308;border-color:#a16207;}
.grid-datos{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--guinda-claro);}
.grid-datos .celda{border-right:1px solid #efe6e8;border-bottom:1px solid #efe6e8;padding:4px 7px;min-height:30px;box-sizing:border-box;}
.grid-datos .celda:last-child{border-right:none;}
.grid-datos .full{grid-column:span 4;border-right:none;}
.grid-datos .span2{grid-column:span 2;}
.grid-datos .span3{grid-column:span 3;}
.label{font-size:8px;color:#1e293b;font-weight:700;text-transform:uppercase;margin-bottom:1px;}
.valor{font-size:10px;font-weight:800;color:var(--guinda);line-height:1.25;word-break:break-word;}
.valor-uso-plan{color:var(--guinda);font-size:10px;}
.valor-sector{color:var(--guinda);font-size:22px;font-weight:900;letter-spacing:.08em;line-height:1;}
.seccion-mapa{border-top:1px solid var(--guinda-claro);flex:0 0 auto;display:flex;flex-direction:column;}
.seccion-mapa .media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:9px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;flex:0 0 auto;}
.carta-map-wrap{position:relative;width:100%;height:var(--ficha-media-map);min-height:var(--ficha-media-map);max-height:var(--ficha-media-map);flex:0 0 auto;overflow:hidden;background:#eaeaea;line-height:0;border:2px solid var(--guinda);box-sizing:border-box;box-shadow:inset 0 0 0 1px rgba(201,162,39,.45);}
#previewCartaMap{position:absolute;inset:0;z-index:2;width:100%;height:100%;background:#eaeaea;}
.carta-map-placeholder,.carta-map-print-snapshot{display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;background:#eaeaea;z-index:1;}
.carta-map-placeholder.activo{display:block;z-index:3;}
.carta-map-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(234,234,234,.92);color:#703341;font-size:12px;font-weight:700;z-index:4;}
.carta-map-loading.oculto{display:none!important;}
.carta-map-error{padding:16px;color:#991b1b;font-size:12px;font-weight:700;}
.pie-ficha{display:flex;justify-content:space-between;align-items:center;padding:6px 10px 8px;border-top:1px solid var(--guinda-claro);font-size:9px;color:var(--guinda);font-weight:700;flex:0 0 auto;}
.pie-ficha .leyenda-carta{color:var(--guinda);font-size:11px;font-weight:900;}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:6px 8px;font-style:italic;}
@page{size:8.5in 11in portrait;margin:3mm;}
@media print{
  html,body{width:8.5in;height:auto;margin:0!important;padding:0!important;background:#fff!important;}
  .toolbar,.carta-layer-panel,.aviso-impresion{display:none!important;}
  .contenedor{width:var(--ficha-ancho)!important;max-width:var(--ficha-ancho)!important;height:var(--ficha-contenido-alto,auto)!important;min-height:0!important;margin:0 auto!important;box-shadow:none!important;border-radius:0!important;page-break-after:avoid;page-break-inside:avoid;}
  .seccion-mapa{flex:0 0 auto!important;}
  .carta-map-wrap{height:var(--ficha-media-map)!important;min-height:var(--ficha-media-map)!important;max-height:var(--ficha-media-map)!important;overflow:hidden!important;}
  #previewCartaMap{position:absolute!important;inset:0!important;height:100%!important;}
  body.ficha-carta-imprimiendo .carta-map-wrap.carta-print-listo #previewCartaMap{display:none!important;}
  body.ficha-carta-imprimiendo .carta-map-print-snapshot.activo,.carta-map-print-snapshot.activo{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  .seccion-simbologia,.sim-swatch{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="zoomMasCarta()">Zoom +</button>
    <button type="button" onclick="zoomMenosCarta()">Zoom −</button>
    <button type="button" onclick="centrarMapaFichaCarta&&centrarMapaFichaCarta()">Centrar</button>
    <button type="button" class="sec" onclick="toggleLayerPanelCarta()">Capas</button>
    <button type="button" id="btnImprimirCarta" disabled onclick="imprimirFichaCarta()">Cargando mapa…</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaCartaLayerPanelHtml()}
  <div class="aviso-impresion" id="cartaMapaEstado">Cargando plano cartográfico…</div>

  <div class="contenedor">
    <header class="encabezado">
      <div class="enc-logo"><img src="${LOGO_FICHA_CARTA_URL}" alt="Gobierno de Mexicali"></div>
      <div class="enc-centro">
        <h1 class="titulo-carta">CARTA URBANA 2040</h1>
        <p class="clave-carta">${clave}</p>
      </div>
    </header>

    <div class="grid-datos">
      <div class="celda full"><div class="label">Domicilio físico</div><div class="valor">${domicilio}</div></div>
      <div class="celda"><div class="label">Delegación</div><div class="valor">${delegacion}</div></div>
      <div class="celda span3"><div class="label">Uso en padrón</div><div class="valor">${fichaCartaEsc(usoPadron)}</div></div>
      <div class="celda"><div class="label">Sector</div><div class="valor valor-sector">${fichaCartaEsc(sector)}</div></div>
      <div class="celda span3"><div class="label">Uso permitido (plan)</div><div class="valor valor-uso-plan">${fichaCartaEsc(usoPlan)}</div></div>
      <div class="celda"><div class="label">Zona / clave</div><div class="valor">${fichaCartaEsc(zona)}</div></div>
      <div class="celda"><div class="label">Densidad</div><div class="valor">${fichaCartaEsc(densidad)}</div></div>
      <div class="celda"><div class="label">Nivel / altura</div><div class="valor">${fichaCartaEsc(nivel)}</div></div>
      <div class="celda"><div class="label">Instrumento / plan</div><div class="valor">${fichaCartaEsc(instrumento)}</div></div>
      <div class="celda full"><div class="label">Observaciones</div><div class="valor">${fichaCartaEsc(observaciones)}</div></div>
    </div>

    <section class="seccion-mapa">
      <div class="media-head">Plano Carta Urbana 2040 · Sector ${fichaCartaEsc(sector)} · ${fichaCartaEsc(usoPlan)}</div>
      <div class="carta-map-wrap" id="previewCartaMapWrap">
        <img id="previewCartaMapPlaceholder" class="carta-map-placeholder${placeholderActivo}" alt="">
        <div id="previewCartaMapLoading" class="carta-map-loading${mapaInicial ? " oculto" : ""}">Cargando plano…</div>
        <img id="previewCartaMapPrintImg" class="carta-map-print-snapshot" alt="">
        <div id="previewCartaMap"></div>
      </div>
    </section>

    <section class="seccion-simbologia">
      <div class="sim-head">Simbología · Usos de suelo propuestos Carta Urbana 2040</div>
      <div class="sim-grid">${fichaCartaSimbologiaHtml()}</div>
    </section>

    <div class="pie-ficha">
      <span class="leyenda-carta">Sector ${fichaCartaEsc(sector)} · ${fichaCartaEsc(usoPlan)}</span>
      <span>${fichaCartaEsc(fechaPie)}</span>
    </div>
  </div>

  <script>${layoutScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirPreviewFichaCartaUrbana() {
  const clave = String(
    popupCartaClaveActual ||
    window.predioSeleccionado?.clave_catastral ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio con clave catastral.");
    return null;
  }

  let cartaData = popupCartaDatos;
  const p = window.predioSeleccionado || {};

  if (!cartaData || cartaData.clave_catastral !== clave) {
    if (typeof cargarCartaUrbana2040 === "function") {
      try {
        cartaData = await cargarCartaUrbana2040(clave, p);
      } catch (e) {
        alert(e.message || "No se pudo consultar la carta urbana 2040.");
        return null;
      }
    }
  }

  if (!cartaData?.geometry) {
    alert("Sin geometría cartográfica para generar la ficha de carta urbana.");
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
  if (typeof popupCartaCapturarMapaDataUrl === "function" && popupCartaMap) {
    try {
      mapaInicial = await popupCartaCapturarMapaDataUrl() || "";
    } catch (e) {
      console.warn("Ficha carta: no se pudo capturar mapa del popup:", e);
    }
  }

  const baseHref = window.location.href.replace(/[^/]*$/, "");
  const win = window.open("", "_blank", "width=1200,height=920");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes.");
    return null;
  }

  win.document.open();
  win.document.write(construirHtmlFichaCartaUrbanaVentana(datos, cartaData, { baseHref, mapaInicial }));
  win.document.close();
  return win;
}

window.abrirPreviewFichaCartaUrbana = abrirPreviewFichaCartaUrbana;
window.construirHtmlFichaCartaUrbanaVentana = construirHtmlFichaCartaUrbanaVentana;
