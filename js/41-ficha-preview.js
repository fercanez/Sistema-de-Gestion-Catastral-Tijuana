/* Ficha Catastral — ventana de vista previa (patrón fcgeonodo / codigos.zip) */

const LOGO_FICHA_URL = "logomxli.png";
const OL_FICHA_CDN = "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const OL_FICHA_CSS = "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const GEOSERVER_CATASTRO_WMS = "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const GEOSERVER_GEONODE_WMS = "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";

function fichaVentanaEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaVentanaLayerPanel() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "chkPredioSel", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "cotas", checkboxId: "chkCotasPreview", dotClass: "dot-amber", label: "Cotas", checked: true, opacity: 100 },
        { id: "vertices", checkboxId: "chkVerticesPreview", dotClass: "dot-cyan", label: "Vértices", checked: true, opacity: 100 },
        { id: "prediosWms", checkboxId: "chkPrediosWMS", dotClass: "dot-red", label: "Predios (WMS)", checked: true, opacity: 100 },
        { id: "codigos", checkboxId: "chkCodigosWMS", dotClass: "dot-orange", label: "Códigos postales", checked: false, opacity: 100 },
        { id: "colonias", checkboxId: "chkColoniasWMS", dotClass: "dot-purple", label: "Colonias", checked: false, opacity: 55 }
      ], {
        opPrefix: "fichaGenOp",
        toggleFn: "toggleCapaFichaGeneral",
        opacityFn: "cambiarOpacidadCapaFichaGeneral",
        subirFn: "subirCapaFichaGeneral",
        bajarFn: "bajarCapaFichaGeneral"
      })
    : "";

  const inner = `<div class="grupo ficha-capas-overlay" id="fichaGenCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    ${typeof htmlFichaPreviewBasemapRadios === "function"
      ? htmlFichaPreviewBasemapRadios("basemap", "cambiarBasePreview")
      : ""}`;

  return typeof htmlFichaPreviewLayerPanel === "function"
    ? htmlFichaPreviewLayerPanel("fichaGenLayerPanel", inner)
    : `<div id="fichaGenLayerPanel" class="ficha-preview-layer-panel oculto">${inner}</div>`;
}

function urlStreetViewFichaVentana(lat, lon, heading, pitch) {
  if (lat == null || lon == null) return "";
  const latN = Number(lat).toFixed(7);
  const lonN = Number(lon).toFixed(7);
  const h = Math.round(heading || 0) % 360;
  const p = Math.max(-90, Math.min(90, Math.round(pitch || 0)));
  return "https://maps.google.com/maps?q=&layer=c&cbll=" + latN + "," + lonN +
    "&cbp=12," + h + "," + p + ",0,0&output=svembed";
}

function leerVistaStreetPopupParaFicha() {
  try {
    const fr = document.getElementById("popupStreetViewFrame");
    const src = fr?.getAttribute("src") || fr?.src || "";
    if (!src || src.indexOf("cbll=") < 0) return null;
    const m = src.match(/cbp=12,(-?\d+),(-?\d+)/);
    if (!m) return null;
    return { heading: parseInt(m[1], 10), pitch: parseInt(m[2], 10) };
  } catch (e) {
    return null;
  }
}

function buildFichaVentanaStreetScript(lat, lon, headingInicial, pitchInicial) {
  if (lat == null || lon == null) {
    return `document.getElementById("previewStreetVacio").style.display="block";`;
  }
  const latJs = Number(lat);
  const lonJs = Number(lon);
  const h0 = Math.round(Number(headingInicial) || 0) % 360;
  const p0 = Math.max(-90, Math.min(90, Math.round(Number(pitchInicial) || 0)));
  return `
  let streetHeading=${h0},streetPitch=${p0},streetViewListo=false;
  const streetLat=${latJs},streetLon=${lonJs};

  function urlStreetViewVentana(){
    const latN=streetLat.toFixed(7),lonN=streetLon.toFixed(7);
    const h=Math.round(streetHeading)%360;
    const p=Math.max(-90,Math.min(90,Math.round(streetPitch)));
    return "https://maps.google.com/maps?q=&layer=c&cbll="+latN+","+lonN+"&cbp=12,"+h+","+p+",0,0&output=svembed";
  }

  function programarAjusteStreetFill(){
    if(typeof ajustarStreetFrameFill==="function"){
      [0,120,400].forEach(function(ms){setTimeout(ajustarStreetFrameFill,ms);});
    }
  }

  function vincularStreetFrameLoad(){
    const iframe=document.getElementById("previewStreetFrame");
    if(!iframe||iframe.dataset.loadBound==="1")return;
    iframe.dataset.loadBound="1";
    iframe.addEventListener("load",function(){
      streetViewListo=true;
      programarAjusteStreetFill();
    });
  }

  function normalizarStreetUrl(u){
    if(!u)return "";
    try{
      const x=new URL(u,window.location.href);
      return x.pathname+x.search;
    }catch(e){
      return String(u).split("#")[0];
    }
  }

  function actualizarStreetViewVentana(opciones){
    opciones=opciones||{};
    const iframe=document.getElementById("previewStreetFrame");
    const vacio=document.getElementById("previewStreetVacio");
    if(!iframe)return;
    vincularStreetFrameLoad();
    const nuevaUrl=urlStreetViewVentana();
    const urlActual=iframe.getAttribute("src")||iframe.src||"";
    const debeRecargar=!!opciones.forzar||!urlActual||urlActual.indexOf("cbll=")<0||
      normalizarStreetUrl(urlActual)!==normalizarStreetUrl(nuevaUrl);
    iframe.style.display="block";
    iframe.classList.remove("street-iframe-oculto");
    if(vacio)vacio.style.display="none";
    if(debeRecargar){
      streetViewListo=false;
      iframe.src=nuevaUrl;
    }else{
      programarAjusteStreetFill();
    }
  }

  function rotarStreetViewVentana(delta){
    streetHeading=(streetHeading+delta+360)%360;
    actualizarStreetViewVentana();
  }

  function centrarStreetViewVentana(){
    streetHeading=0;
    streetPitch=0;
    actualizarStreetViewVentana();
  }

  window.rotarStreetViewVentana=rotarStreetViewVentana;
  window.centrarStreetViewVentana=centrarStreetViewVentana;
  window.actualizarStreetViewVentana=actualizarStreetViewVentana;

  function limpiarStreetSnapshotImpresion(){
    const img=document.getElementById("previewStreetPrintImg");
    const wrap=document.querySelector(".street-frame-wrap");
    if(wrap){
      wrap.classList.remove("street-print-listo");
      wrap.style.removeProperty("--ficha-street-print-bg");
    }
    if(!img)return;
    img.classList.remove("activo");
    img.removeAttribute("src");
    img.style.removeProperty("width");
    img.style.removeProperty("height");
    img.style.removeProperty("object-fit");
  }

  function recortarStreetCoverCanvas(src,frameW,frameH){
    const frameAspect=frameW/Math.max(frameH,1);
    const imgAspect=src.width/src.height;
    let sx=0,sy=0,cropW=src.width,cropH=src.height;
    if(imgAspect>frameAspect){
      cropW=src.height*frameAspect;
      sx=(src.width-cropW)/2;
    }else if(imgAspect<frameAspect){
      cropH=src.width/frameAspect;
      sy=(src.height-cropH)/2;
    }
    const outW=Math.max(frameW,Math.round(frameW*2));
    const outH=Math.max(frameH,Math.round(frameH*2));
    const c=document.createElement("canvas");
    c.width=outW;
    c.height=outH;
    c.getContext("2d").drawImage(src,sx,sy,cropW,cropH,0,0,outW,outH);
    return c.toDataURL("image/png");
  }

  async function activarStreetSnapshotImpresion(){
    let img=document.getElementById("previewStreetPrintImg");
    const wrap=document.querySelector(".street-frame-wrap");
    if(!img){
      if(!wrap)return;
      img=document.createElement("img");
      img.id="previewStreetPrintImg";
      img.className="street-print-snapshot";
      img.alt="";
      wrap.appendChild(img);
    }
    const h=Math.round(streetHeading)%360;
    const p=Math.max(-90,Math.min(90,Math.round(streetPitch)));
    const loc=encodeURIComponent(streetLat.toFixed(6)+","+streetLon.toFixed(6));
    const dims=(typeof medirStreetFramePrintPx==="function")?medirStreetFramePrintPx():
      ((typeof medirMediaBodyPx==="function")?medirMediaBodyPx(".seccion-street .media-body"):{w:800,h:280});
    const frameAspect=dims.w/Math.max(dims.h,1);
    let sw=640,sh=Math.round(640/frameAspect);
    if(sh>640){sh=640;sw=Math.round(640*frameAspect);}
    sw=Math.max(320,sw);
    sh=Math.max(120,sh);
    const url="https://maps.googleapis.com/maps/api/streetview?size="+sw+"x"+sh+"&location="+loc+
      "&fov=90&pitch="+p+"&heading="+h+"&source=outdoor";
    return new Promise(function(resolve){
      const tmp=new Image();
      tmp.crossOrigin="anonymous";
      tmp.onload=function(){
        try{
          const dataUrl=recortarStreetCoverCanvas(tmp,dims.w,dims.h);
          img.src=dataUrl;
          img.classList.add("activo");
          if(wrap){
            wrap.style.setProperty("--ficha-street-print-bg","url("+dataUrl+")");
            wrap.classList.add("street-print-listo");
          }
        }catch(e){}
        resolve();
      };
      tmp.onerror=function(){resolve();};
      tmp.src=url;
    });
  }

  window.activarStreetSnapshotImpresion=activarStreetSnapshotImpresion;
  window.limpiarStreetSnapshotImpresion=limpiarStreetSnapshotImpresion;
  vincularStreetFrameLoad();
  actualizarStreetViewVentana({forzar:false});
  setTimeout(function(){if(typeof ajustarMediosPapel==="function")ajustarMediosPapel();},120);
  programarAjusteStreetFill();
  `;
}

function buildFichaVentanaMapScript(featureGeoJSONString) {
  const capasRuntime = typeof buildFichaMapaCapasRuntimeScript === "function"
    ? buildFichaMapaCapasRuntimeScript({
        ordenDef: {
          predio: 35,
          cotas: 42,
          vertices: 42,
          prediosWms: 12,
          codigos: 8,
          colonias: 5
        },
        capaProp: {
          predio: "predioLayer",
          prediosWms: "capaPredios",
          colonias: "capaColonias",
          codigos: "capaCodigos",
          cotas: "capaCotasPreview",
          vertices: "capaCotasPreview"
        },
        chkMap: {
          predio: "chkPredioSel",
          prediosWms: "chkPrediosWMS",
          colonias: "chkColoniasWMS",
          codigos: "chkCodigosWMS",
          cotas: "chkCotasPreview",
          vertices: "chkVerticesPreview"
        },
        optionalIds: ["colonias", "codigos"],
        linkedZIndexIds: ["cotas", "vertices"],
        capasVar: "window.__fichaGenCapas",
        mapVar: "previewMap",
        overlayListId: "fichaGenCapasOverlayList",
        opPrefix: "fichaGenOp",
        toggleFn: "toggleCapaFichaGeneral",
        opacityFn: "cambiarOpacidadCapaFichaGeneral",
        subirFn: "subirCapaFichaGeneral",
        bajarFn: "bajarCapaFichaGeneral",
        initFn: "inicializarOrdenCapasFichaGeneral"
      })
    : "";

  return `
  const featureGeoJSON=${featureGeoJSONString};
  let previewMap=null,predioSource=null,capaCotasSource=null,baseGoogleHybrid=null,baseGoogleRoad=null,baseEsri=null,baseOSM=null;
  let capaPredios=null,capaColonias=null,capaCodigos=null,predioLayer=null,capaCotasPreview=null;
  let mostrarCotasPreview=true,mostrarVerticesPreview=true;
  ${capasRuntime}

  function crearCapaWMS(url,layers,visible=true,opacity=1){
    return new ol.layer.Tile({
      visible,opacity,
      source:new ol.source.TileWMS({
        url:url,
        params:{LAYERS:layers,TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",
        crossOrigin:"anonymous"
      })
    });
  }

  function obtenerCoords(feature){
    const geom=feature.getGeometry();
    let polygon=null;
    if(geom instanceof ol.geom.Polygon){
      polygon=geom;
    }else if(geom instanceof ol.geom.MultiPolygon){
      const polys=geom.getPolygons();
      if(!polys||polys.length===0)return null;
      polygon=polys.reduce((m,a)=>a.getArea()>m.getArea()?a:m,polys[0]);
    }else{
      return null;
    }
    const coords=polygon.getCoordinates()[0].slice();
    if(coords.length>1){
      const p=coords[0],u=coords[coords.length-1];
      if(p[0]===u[0]&&p[1]===u[1])coords.pop();
    }
    return coords;
  }

  function distMetros(a,b){
    return ol.sphere.getDistance(
      ol.proj.transform(a,"EPSG:3857","EPSG:4326"),
      ol.proj.transform(b,"EPSG:3857","EPSG:4326")
    );
  }

  function angLinea(p,q){
    const pp=previewMap.getPixelFromCoordinate(p),qp=previewMap.getPixelFromCoordinate(q);
    let a=Math.atan2(qp[1]-pp[1],qp[0]-pp[0]);
    if(a>Math.PI/2)a-=Math.PI;
    if(a<-Math.PI/2)a+=Math.PI;
    return a;
  }

  function ptCota(p,q,c){
    const mid=[(p[0]+q[0])/2,(p[1]+q[1])/2],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.sqrt(dx*dx+dy*dy);
    if(len===0)return mid;
    let nx=-dy/len,ny=dx/len;
    if((nx*(mid[0]-c[0])+ny*(mid[1]-c[1]))<0){nx*=-1;ny*=-1;}
    const s=(previewMap.getView().getResolution()||1)*24;
    return[mid[0]+nx*s,mid[1]+ny*s];
  }

  function ptVert(p,c){
    const vx=p[0]-c[0],vy=p[1]-c[1],len=Math.sqrt(vx*vx+vy*vy);
    if(len===0)return p;
    const s=(previewMap.getView().getResolution()||1)*18;
    return[p[0]+(vx/len)*s,p[1]+(vy/len)*s];
  }

  function regenerarCotasPreview(){
    if(!previewMap||!predioSource||!capaCotasSource)return;
    capaCotasSource.clear();
    const feats=predioSource.getFeatures();
    if(!feats||feats.length===0)return;
    const coords=obtenerCoords(feats[0]);
    if(!coords||coords.length<3)return;
    const c=[coords.reduce((s,x)=>s+x[0],0)/coords.length,coords.reduce((s,x)=>s+x[1],0)/coords.length];
    for(let i=0;i<coords.length;i++){
      const n=(i+1)%coords.length,p=coords[i],q=coords[n];
      capaCotasSource.addFeature(new ol.Feature({geometry:new ol.geom.LineString([p,q]),tipo:"linea"}));
      capaCotasSource.addFeature(new ol.Feature({geometry:new ol.geom.Point(ptCota(p,q,c)),tipo:"cota",texto:distMetros(p,q).toFixed(2)+" m",rotation:angLinea(p,q)}));
      capaCotasSource.addFeature(new ol.Feature({geometry:new ol.geom.Point(p),tipo:"vertice_punto"}));
      capaCotasSource.addFeature(new ol.Feature({geometry:new ol.geom.Point(ptVert(p,c)),tipo:"vertice_texto",texto:"P"+(i+1)}));
    }
  }

  function estiloCotas(feature){
    const tipo=feature.get("tipo");
    if(tipo==="linea"){
      if(!mostrarCotasPreview)return null;
      return new ol.style.Style({stroke:new ol.style.Stroke({color:"#703341",width:2,lineDash:[8,5]})});
    }
    if(tipo==="cota"){
      if(!mostrarCotasPreview)return null;
      return new ol.style.Style({
        text:new ol.style.Text({
          text:feature.get("texto")||"",
          font:"bold 11px Arial",
          rotation:feature.get("rotation")||0,
          rotateWithView:false,
          fill:new ol.style.Fill({color:"#703341"}),
          stroke:new ol.style.Stroke({color:"#ffffff",width:4}),
          overflow:true
        })
      });
    }
    if(tipo==="vertice_punto"){
      if(!mostrarVerticesPreview)return null;
      return new ol.style.Style({
        image:new ol.style.Circle({
          radius:4,
          fill:new ol.style.Fill({color:"#ffffff"}),
          stroke:new ol.style.Stroke({color:"#007bff",width:2})
        })
      });
    }
    if(tipo==="vertice_texto"){
      if(!mostrarVerticesPreview)return null;
      return new ol.style.Style({
        text:new ol.style.Text({
          text:feature.get("texto")||"",
          font:"bold 11px Arial",
          fill:new ol.style.Fill({color:"#ffffff"}),
          stroke:new ol.style.Stroke({color:"#007bff",width:4}),
          overflow:true
        })
      });
    }
    return null;
  }

  function iniciarMapaOL(){
    baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    baseGoogleRoad=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});

    capaPredios=crearCapaWMS("${GEOSERVER_CATASTRO_WMS}","catastro_bc:predios_oficial",true,1);
    capaColonias=crearCapaWMS("${GEOSERVER_GEONODE_WMS}","colonias",false,0.55);
    capaCodigos=crearCapaWMS("${GEOSERVER_GEONODE_WMS}","codigos_postales_bc_utm1",false,1);

    predioSource=new ol.source.Vector({
      features:new ol.format.GeoJSON().readFeatures({
        type:"FeatureCollection",
        features:[featureGeoJSON]
      },{
        dataProjection:"EPSG:4326",
        featureProjection:"EPSG:3857"
      })
    });

    predioLayer=new ol.layer.Vector({
      source:predioSource,
      zIndex:fichaCapaOrdenDef.predio,
      style:[
        new ol.style.Style({stroke:new ol.style.Stroke({color:"#ffffff",width:6})}),
        new ol.style.Style({stroke:new ol.style.Stroke({color:"#003cff",width:4,lineDash:[10,6]}),fill:new ol.style.Fill({color:"rgba(0,60,255,0.12)"})})
      ]
    });

    capaCotasSource=new ol.source.Vector();
    capaCotasPreview=new ol.layer.Vector({source:capaCotasSource,zIndex:fichaCapaOrdenDef.cotas,style:estiloCotas});

    window.__fichaGenCapas={
      predioLayer,capaPredios,capaColonias,capaCodigos,capaCotasPreview
    };

    previewMap=new ol.Map({
      target:"previewMap",
      layers:[baseGoogleHybrid,baseGoogleRoad,baseEsri,baseOSM,capaCodigos,capaColonias,capaPredios,predioLayer,capaCotasPreview],
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:18})
    });

    if(typeof inicializarOrdenCapasFichaGeneral==="function")inicializarOrdenCapasFichaGeneral();
    if(typeof actualizarCapasPreview==="function")actualizarCapasPreview();

    previewMap.getView().on("change:resolution",function(){regenerarCotasPreview();});
    previewMap.on("moveend",function(){regenerarCotasPreview();});

    function refrescarMapaPreview(){
      if(typeof aplicarAltoMediosPx==="function")aplicarAltoMediosPx();
      if(!previewMap)return;
      previewMap.updateSize();
      try{previewMap.renderSync();}catch(e){}
      centrarPredio();
    }

    setTimeout(refrescarMapaPreview,80);
    setTimeout(refrescarMapaPreview,450);
    setTimeout(refrescarMapaPreview,1300);
  }

  function toggleLayerPanel(){
    document.getElementById("fichaGenLayerPanel")?.classList.toggle("oculto");
  }

  function actualizarCapasPreview(){
    if(!previewMap)return;
    ["predio","prediosWms","colonias","codigos","cotas","vertices"].forEach(function(id){
      toggleCapaFichaGeneral(id);
    });
  }

  const _toggleCapaFichaGeneralBase=toggleCapaFichaGeneralCore;
  function toggleCapaFichaGeneral(id){
    if(id==="cotas"||id==="vertices"){
      mostrarCotasPreview=document.getElementById("chkCotasPreview")?.checked??true;
      mostrarVerticesPreview=document.getElementById("chkVerticesPreview")?.checked??true;
      if(capaCotasPreview){
        capaCotasPreview.setVisible(mostrarCotasPreview||mostrarVerticesPreview);
        capaCotasPreview.changed();
      }
      previewMap&&previewMap.render();
      return;
    }
    _toggleCapaFichaGeneralBase(id);
  }

  function cambiarBasePreview(){
    if(!previewMap)return;
    const c=document.querySelector('input[name="basemap"]:checked');
    const v=c?c.value:"googleHybrid";
    baseGoogleHybrid.setVisible(v==="googleHybrid");
    baseGoogleRoad.setVisible(v==="googleRoad");
    baseEsri.setVisible(v==="esri");
    baseOSM.setVisible(v==="osm");
  }

  function centrarPredio(){
    if(typeof centrarStreetViewVentana==="function")centrarStreetViewVentana();
    if(!previewMap||!predioSource)return;
    previewMap.updateSize();
    previewMap.getView().fit(predioSource.getExtent(),{padding:[50,50,50,50],maxZoom:20,duration:300});
    setTimeout(regenerarCotasPreview,350);
  }

  function zoomMas(){
    if(!previewMap)return;
    const v=previewMap.getView();
    v.setZoom((v.getZoom()||18)+1);
    setTimeout(regenerarCotasPreview,150);
  }

  function zoomMenos(){
    if(!previewMap)return;
    const v=previewMap.getView();
    v.setZoom((v.getZoom()||18)-1);
    setTimeout(regenerarCotasPreview,150);
  }

  function capturarMapaPreviewPdf(mapInst,timeoutMs){
    timeoutMs=timeoutMs||2500;
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

  window.capturarMapaPreviewPdf=capturarMapaPreviewPdf;
  function imprimirAhora(){
    if(typeof imprimirFichaVentana==="function")return imprimirFichaVentana();
    window.print();
  }

  window.zoomMas=zoomMas;
  window.zoomMenos=zoomMenos;
  window.centrarPredio=centrarPredio;
  window.imprimirAhora=imprimirAhora;
  window.toggleLayerPanel=toggleLayerPanel;
  window.actualizarCapasPreview=actualizarCapasPreview;
  window.cambiarBasePreview=cambiarBasePreview;

  const script=document.createElement("script");
  script.src="${OL_FICHA_CDN}";
  script.onload=function(){ iniciarMapaOL(); };
  script.onerror=function(){
    const el=document.getElementById("previewMap");
    if(el) el.innerHTML="<div style='padding:20px;color:#900;'>No se pudo cargar OpenLayers.</div>";
  };
  document.body.appendChild(script);
  `;
}

function buildFichaVentanaLayoutScript() {
  return `
  const FICHA_PAPEL={
    carta:{alto:11,ancho:8.5,ratioStreet:0.44},
    legal:{alto:14,ancho:8.5,ratioStreet:0.42}
  };
  let fichaPapelActual="carta";

  function aplicarReglaPaginaImpresion(){
    let style=document.getElementById("fichaPageRule");
    if(!style){
      style=document.createElement("style");
      style.id="fichaPageRule";
      document.head.appendChild(style);
    }
    const p=FICHA_PAPEL[fichaPapelActual]||FICHA_PAPEL.carta;
    style.textContent="@media print{@page{size:"+p.ancho+"in "+p.alto+"in portrait;margin:4mm;}}";
  }

  function medirMediaBodyPx(selector){
    const el=document.querySelector(selector);
    if(!el)return{w:640,h:240};
    const r=el.getBoundingClientRect();
    return{
      w:Math.max(200,r.width||el.clientWidth||640),
      h:Math.max(100,r.height||el.clientHeight||240)
    };
  }

  function medirStreetFramePrintPx(){
    if(typeof aplicarAltoMediosPx==="function")aplicarAltoMediosPx();
    const wrap=document.querySelector(".street-frame-wrap");
    const body=document.querySelector(".seccion-street .media-body");
    const ref=wrap||body;
    if(!ref)return{w:800,h:280};
    const r=ref.getBoundingClientRect();
    let w=Math.max(200,r.width||ref.clientWidth||700);
    let h=Math.max(120,r.height||ref.clientHeight||0);
    if(h<80){
      const streetIn=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-street").trim();
      const inch=parseFloat(streetIn);
      if(!isNaN(inch)&&inch>0)h=Math.round(inch*96);
    }
    h=Math.max(120,h);
    return{w:Math.round(w),h:Math.round(h)};
  }

  window.medirStreetFramePrintPx=medirStreetFramePrintPx;

  async function prepararMediosParaImpresion(){
    document.body.classList.add("ficha-imprimiendo");
    if(typeof activarStreetSnapshotImpresion==="function"){
      await activarStreetSnapshotImpresion();
    }
  }

  function restaurarMediosDespuesImpresion(){
    document.body.classList.remove("ficha-imprimiendo");
    if(typeof limpiarStreetSnapshotImpresion==="function")limpiarStreetSnapshotImpresion();
  }

  function ajustarStreetFrameFill(){
    const iframe=document.getElementById("previewStreetFrame");
    const wrap=document.querySelector(".street-frame-wrap");
    if(!iframe||!wrap)return;
    iframe.style.position="absolute";
    iframe.style.top="0";
    iframe.style.left="0";
    iframe.style.width="100%";
    iframe.style.height="100%";
    iframe.style.transform="none";
    iframe.style.transformOrigin="center center";
    iframe.style.border="0";
  }

  function medirReservadoContenidoIn(){
    const cont=document.querySelector(".contenedor");
    if(!cont)return 2.85;
    let px=0;
    Array.from(cont.children).forEach(function(el){
      if(el.classList.contains("seccion-media")){
        const head=el.querySelector(".media-head");
        if(head)px+=head.getBoundingClientRect().height;
        return;
      }
      if(el.classList.contains("aviso-impresion"))return;
      px+=el.getBoundingClientRect().height;
    });
    const marcos=cont.querySelectorAll(".seccion-marco").length;
    px+=marcos*4;
    return Math.max(2.38,px/96+0.03);
  }

  function aplicarAltoMediosPx(){
    const streetBody=document.querySelector(".seccion-street .media-body");
    const mapBody=document.querySelector(".seccion-mapa .media-body");
    const mapEl=document.getElementById("previewMap");
    const streetVal=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-street").trim();
    const mapVal=getComputedStyle(document.documentElement).getPropertyValue("--ficha-media-map").trim();
    if(streetBody&&streetVal){
      streetBody.style.height=streetVal;
      const streetWrap=document.querySelector(".street-frame-wrap");
      if(streetWrap){streetWrap.style.height=streetVal;}
    }
    if(mapBody&&mapVal){
      mapBody.style.height=mapVal;
      const wrap=document.getElementById("previewMapWrap");
      if(wrap){wrap.style.height=mapVal;wrap.style.minHeight=mapVal;}
      if(mapEl){mapEl.style.height=mapVal;mapEl.style.minHeight=mapVal;}
    }
    if(typeof ajustarStreetFrameFill==="function")ajustarStreetFrameFill();
    if(typeof previewMap!=="undefined"&&previewMap){
      previewMap.updateSize();
      try{previewMap.renderSync();}catch(e){}
    }
  }

  function ajustarMediosPapel(opciones){
    opciones=opciones||{};
    const esImpresion=!!opciones.impresion;
    const p=FICHA_PAPEL[fichaPapelActual]||FICHA_PAPEL.carta;
    const margenVertical=esImpresion?0.08:0.2;
    let reservado=medirReservadoContenidoIn();
    if(esImpresion)reservado=Math.max(2.28,reservado-0.12);
    let util=Math.max(4.75,p.alto-margenVertical-reservado);
    if(esImpresion)util+=0.18;
    const streetIn=+(util*p.ratioStreet).toFixed(2);
    const mapIn=+(util-streetIn).toFixed(2);
    const root=document.documentElement;
    root.style.setProperty("--ficha-ancho",p.ancho+"in");
    root.style.setProperty("--ficha-alto",p.alto+"in");
    root.style.setProperty("--ficha-media-street",streetIn+"in");
    root.style.setProperty("--ficha-media-map",mapIn+"in");
    document.body.classList.remove("papel-carta","papel-legal");
    document.body.classList.add("papel-"+fichaPapelActual);
    aplicarReglaPaginaImpresion();
    requestAnimationFrame(aplicarAltoMediosPx);
  }

  function programarAjusteStreetFillVentana(){
    if(typeof programarAjusteStreetFill==="function"){
      programarAjusteStreetFill();
      return;
    }
    [0,150,400,900,1600,2400].forEach(function(ms){
      setTimeout(ajustarStreetFrameFill,ms);
    });
  }

  function setTamanoPapel(tipo){
    fichaPapelActual=(tipo==="legal")?"legal":"carta";
    const sel=document.getElementById("tamanoPapel");
    if(sel)sel.value=fichaPapelActual;
    requestAnimationFrame(function(){
      ajustarMediosPapel();
      programarAjusteStreetFillVentana();
    });
  }

  function esperarLayoutImpresion(callback){
    let paso=0;
    const maxPasos=6;
    function tick(){
      ajustarMediosPapel({impresion:true});
      aplicarAltoMediosPx();
      if(typeof ajustarStreetFrameFill==="function")ajustarStreetFrameFill();
      if(typeof previewMap!=="undefined"&&previewMap){
        previewMap.updateSize();
        try{previewMap.renderSync();}catch(e){}
      }
      paso++;
      if(paso>=maxPasos){
        setTimeout(callback,120);
        return;
      }
      setTimeout(tick,paso<3?160:240);
    }
    tick();
  }

  function imprimirFichaVentana(){
    ajustarMediosPapel({impresion:true});
    esperarLayoutImpresion(function(){
      prepararMediosParaImpresion().then(function(){
        function onAfterPrint(){
          restaurarMediosDespuesImpresion();
          ajustarMediosPapel({});
          window.removeEventListener("afterprint",onAfterPrint);
        }
        window.addEventListener("afterprint",onAfterPrint);
        if(typeof previewMap!=="undefined"&&previewMap){
          previewMap.updateSize();
          try{previewMap.renderSync();}catch(e){}
        }
        setTimeout(function(){window.print();},400);
      }).catch(function(){
        window.print();
      });
    });
  }

  window.setTamanoPapel=setTamanoPapel;
  window.ajustarMediosPapel=ajustarMediosPapel;
  window.aplicarAltoMediosPx=aplicarAltoMediosPx;
  window.ajustarStreetFrameFill=ajustarStreetFrameFill;
  window.imprimirFichaVentana=imprimirFichaVentana;
  window.medirMediaBodyPx=medirMediaBodyPx;

  function initLayoutFicha(){
    setTamanoPapel("carta");
    setTimeout(function(){ajustarMediosPapel();},120);
    setTimeout(function(){ajustarMediosPapel();},700);
    setTimeout(function(){ajustarMediosPapel();},1600);
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",initLayoutFicha);
  }else{
    initLayoutFicha();
  }
  window.addEventListener("resize",function(){
    clearTimeout(window.__fichaResizeT);
    window.__fichaResizeT=setTimeout(function(){
      ajustarMediosPapel();
      ajustarStreetFrameFill();
    },160);
  });
  `;
}

function serializarFeatureFichaVentana(datos) {
  try {
    if (datos.feature?.geometry) {
      return JSON.stringify({
        type: "Feature",
        geometry: datos.feature.geometry,
        properties: Object.assign({}, datos.feature.properties || {}, { clave_catastral: datos.clave })
      });
    }
    if (datos.geometry && typeof ol !== "undefined") {
      const feature = new ol.Feature({ geometry: datos.geometry });
      feature.set("clave_catastral", datos.clave);
      return JSON.stringify(new ol.format.GeoJSON().writeFeatureObject(feature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      }));
    }
  } catch (e) {
    console.warn("No se pudo serializar geometría de ficha:", e);
  }
  return null;
}

function construirHtmlFichaCatastralVentana(datos, featureGeoJSONString, streetVistaInicial) {
  const supTxt = datos.supDoc ? Number(datos.supDoc).toFixed(2) + " m²" : "—";
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const hIni = streetVistaInicial?.heading ?? 0;
  const pIni = streetVistaInicial?.pitch ?? 0;
  const streetUrl = urlStreetViewFichaVentana(datos.lat, datos.lon, hIni, pIni);
  const tieneStreet = !!streetUrl;
  const mapScript = featureGeoJSONString
    ? buildFichaVentanaMapScript(featureGeoJSONString)
    : `document.getElementById("previewMap").innerHTML="<div class='media-vacio'>Sin geometría cartográfica para este predio.</div>";`;
  const streetScript = buildFichaVentanaStreetScript(datos.lat, datos.lon, hIni, pIni);
  const layoutScript = buildFichaVentanaLayoutScript();

  return `<!DOCTYPE html>
<html lang="es" class="papel-carta">
<head>
<meta charset="UTF-8">
<title>Ficha Catastral ${fichaVentanaEsc(datos.clave)}</title>
<link rel="stylesheet" href="${OL_FICHA_CSS}">
<style>
:root{
  --guinda:#703341;
  --guinda-claro:#d8bdc5;
  --texto-valor:#1e293b;
  --ficha-ancho:8.5in;
  --ficha-alto:11in;
  --ficha-media-street:2.55in;
  --ficha-media-map:3.05in;
}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:var(--texto-valor);}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar select{border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font-size:12px;font-weight:600;background:#fff;color:#1e293b;}
.contenedor{
  width:min(100%,var(--ficha-ancho));
  max-width:var(--ficha-ancho);
  margin:12px auto;
  background:#fff;
  box-shadow:0 2px 10px rgba(0,0,0,.12);
  border:1px solid var(--guinda);
  border-radius:6px;
  overflow:hidden;
  box-sizing:border-box;
}
.encabezado{
  background:var(--guinda)!important;
  color:#fff!important;
  padding:8px 10px;
  min-height:64px;
  display:grid;
  grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
  align-items:center;
  gap:8px;
  border-bottom:3px solid #c9a227;
}
.enc-logo{justify-self:start;display:flex;align-items:center;}
.enc-logo img{height:50px;max-width:220px;object-fit:contain;background:#fff;padding:3px 8px;border-radius:6px;}
.enc-centro{text-align:center;justify-self:center;padding:0 6px;max-width:62%;}
.enc-centro h1{margin:0;font-size:15px;font-weight:800;color:#fff!important;letter-spacing:.55px;line-height:1.15;}
.enc-centro h2{margin:3px 0 0;font-size:9px;font-weight:600;color:#fff!important;opacity:.95;letter-spacing:.25px;}
.enc-der{justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:5px;}
.enc-id-item{text-align:right;font-size:9px;font-weight:700;color:#fff!important;line-height:1.25;text-transform:uppercase;letter-spacing:.3px;}
.enc-id-item b{display:block;font-size:14px;margin-top:2px;text-transform:none;letter-spacing:.5px;}
.seccion-marco{
  margin:4px 6px 5px;
  border:1px solid var(--guinda-claro);
  border-radius:4px;
  overflow:hidden;
  background:#fff;
  box-sizing:border-box;
}
.seccion-media{border-color:var(--guinda);}
.seccion-datos .ficha-linea{
  padding:4px 8px;
  font-size:9px;
  border-bottom:1px solid #efe6e8;
  line-height:1.35;
}
.ficha-etiq{color:#1e293b;font-weight:700;text-transform:uppercase;letter-spacing:.25px;}
.ficha-valor,.ficha-valor-nombre{font-size:10px;font-weight:800;color:var(--guinda);}
.grid{display:grid;grid-template-columns:repeat(4,1fr);background:#fff;}
.campo{border-right:1px solid #efe6e8;border-bottom:1px solid #efe6e8;padding:3px 6px;min-height:28px;box-sizing:border-box;}
.campo:nth-child(4n){border-right:none;}
.campo.full{grid-column:span 4;border-right:none;}
.label{font-size:8px;color:#1e293b;font-weight:700;text-transform:uppercase;margin-bottom:1px;letter-spacing:.35px;}
.valor{font-size:10px;font-weight:800;color:var(--guinda);line-height:1.2;word-break:break-word;}
.media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:9px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;gap:8px;}
.media-tools{display:flex;gap:4px;}
.media-tools button{border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.12);color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer;}
.seccion-street .media-body{position:relative;background:#1a1a1a;overflow:hidden;height:var(--ficha-media-street);}
.street-frame-wrap{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  overflow:hidden;
  background:#1a1a1a;
}
.seccion-street .media-vacio{position:absolute;inset:0;}
.seccion-mapa .media-body{position:relative;background:#f1f5f9;overflow:hidden;height:var(--ficha-media-map);}
.media-frame{
  box-sizing:border-box;
  border:0;
  display:block;
  background:#e2e8f0;
}
#previewStreetFrame.media-frame{
  display:block;
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  transform:none;
  border:0;
  background:#1a1a1a;
}
#previewStreetFrame.street-iframe-oculto{display:none!important;}
.street-print-snapshot{display:none!important;}
body.ficha-imprimiendo .street-print-snapshot.activo{display:none!important;}
#previewMap{
  width:100%;
  height:var(--ficha-media-map);
  min-height:var(--ficha-media-map);
  box-sizing:border-box;
  border:0;
  background:#eaeaea;
  position:relative;
}
.media-vacio{
  height:100%;
  min-height:var(--ficha-media-street);
  padding:14px;
  text-align:center;
  color:#64748b;
  font-size:10px;
  box-sizing:border-box;
  display:flex;
  align-items:center;
  justify-content:center;
}
#previewMapWrap{position:relative;width:100%;height:100%;min-height:var(--ficha-media-map);}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
${typeof FICHA_PREVIEW_LAYER_PANEL_CSS !== "undefined" ? FICHA_PREVIEW_LAYER_PANEL_CSS : ""}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:5px 8px 6px;font-style:italic;}
.pie{text-align:center;font-size:8px;color:var(--guinda);font-weight:700;padding:3px 6px 4px;border-top:1px solid var(--guinda-claro);}
@media print{
  html,body{background:#fff!important;height:auto!important;}
  .toolbar,.ficha-preview-layer-panel,.media-tools,.aviso-impresion{display:none!important;}
  .contenedor{
    width:var(--ficha-ancho)!important;
    max-width:var(--ficha-ancho)!important;
    min-height:calc(var(--ficha-alto) - 0.12in)!important;
    margin:0 auto!important;
    box-shadow:none!important;
    border:1px solid var(--guinda)!important;
    border-radius:0!important;
    page-break-inside:avoid;
    break-inside:avoid;
  }
  .seccion-marco{margin:1px 3px 2px;}
  .encabezado{min-height:auto;padding:3px 7px;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);}
  .enc-logo img{height:38px;max-width:180px;}
  .enc-centro h1{font-size:12px;}
  .enc-centro h2{font-size:8px;}
  .pie{padding:1px 4px 2px;margin-top:0;}
  .seccion-street .media-body{
    height:var(--ficha-media-street)!important;
    min-height:var(--ficha-media-street)!important;
    overflow:hidden!important;
    background:#1a1a1a!important;
  }
  .seccion-mapa .media-body,#previewMapWrap{
    height:var(--ficha-media-map)!important;
    min-height:var(--ficha-media-map)!important;
    overflow:hidden!important;
  }
  .street-frame-wrap{
    height:100%!important;
    width:100%!important;
    inset:0!important;
    position:absolute!important;
    overflow:hidden!important;
    background:#1a1a1a!important;
  }
  #previewStreetFrame{
    display:block!important;
    position:absolute!important;
    inset:0!important;
    width:100%!important;
    height:100%!important;
    transform:none!important;
    border:0!important;
    background:#1a1a1a!important;
  }
  body.ficha-imprimiendo .street-frame-wrap.street-print-listo #previewStreetFrame{
    visibility:hidden!important;
  }
  body.ficha-imprimiendo .street-frame-wrap.street-print-listo{
    background-color:#1a1a1a!important;
    background-image:var(--ficha-street-print-bg)!important;
    background-repeat:no-repeat!important;
    background-position:center center!important;
    background-size:cover!important;
    -webkit-print-color-adjust:exact!important;
    print-color-adjust:exact!important;
  }
  body.ficha-imprimiendo .street-frame-wrap.street-print-listo .street-print-snapshot{
    display:none!important;
  }
  body.ficha-imprimiendo .street-print-snapshot.activo{
    display:none!important;
  }
  .media-vacio{height:100%!important;min-height:100%!important;}
  #previewMap{
    height:var(--ficha-media-map)!important;
    min-height:var(--ficha-media-map)!important;
    overflow:hidden!important;
  }
}
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="zoomMas()">Zoom +</button>
    <button type="button" onclick="zoomMenos()">Zoom -</button>
    <button type="button" onclick="centrarPredio()">Centrar</button>
    <label class="toolbar-papel">
      <select id="tamanoPapel" onchange="setTamanoPapel(this.value)" title="Tamaño de hoja para vista previa e impresión">
        <option value="carta" selected>Carta 8.5×11</option>
        <option value="legal">Legal / Oficio 8.5×14</option>
      </select>
    </label>
    <button type="button" class="sec" onclick="toggleLayerPanel()">Capas</button>
    <button type="button" onclick="imprimirAhora()">Imprimir / PDF</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaVentanaLayerPanel()}
  <div class="aviso-impresion" id="fichaGenMapaEstado">Ajuste la vista de calle (↺ ↻) y el mapa. Cuando esté listo pulse «Imprimir / PDF».</div>

  <div class="contenedor">
    <div class="encabezado">
      <div class="enc-logo">
        <img src="${LOGO_FICHA_URL}" alt="Logo">
      </div>
      <div class="enc-centro">
        <h1>FICHA CATASTRAL GENERAL</h1>
        <h2>Catastro Mexicali</h2>
      </div>
      <div class="enc-der">
        <div class="enc-id-item">Clave Catastral<b>${fichaVentanaEsc(datos.clave)}</b></div>
        <div class="enc-id-item">Folio Real<b>${fichaVentanaEsc(datos.folioReal || "—")}</b></div>
      </div>
    </div>

    <section class="seccion-marco seccion-datos">
      <div class="ficha-linea"><span class="ficha-etiq">Fecha y hora de consulta:</span> <span class="ficha-valor">${fichaVentanaEsc(datos.fechaConsulta)}</span></div>
      <div class="ficha-linea"><span class="ficha-etiq">Nombre registrado:</span> <span class="ficha-valor-nombre">${fichaVentanaEsc(datos.nombre)}</span></div>
      <div class="grid">
        <div class="campo"><div class="label">Colonia</div><div class="valor">${fichaVentanaEsc(datos.colonia)}</div></div>
        <div class="campo"><div class="label">Calle</div><div class="valor">${fichaVentanaEsc(datos.calle)}</div></div>
        <div class="campo"><div class="label">Número oficial</div><div class="valor">${fichaVentanaEsc(datos.numof)}</div></div>
        <div class="campo"><div class="label">Superficie</div><div class="valor">${fichaVentanaEsc(supTxt)}</div></div>
        <div class="campo"><div class="label">Manzana</div><div class="valor">${fichaVentanaEsc(datos.seg?.manzana || "—")}</div></div>
        <div class="campo"><div class="label">Lote</div><div class="valor">${fichaVentanaEsc(datos.seg?.lote || "—")}</div></div>
        <div class="campo"><div class="label">Zona homogénea</div><div class="valor">${fichaVentanaEsc(datos.zonah)}</div></div>
        <div class="campo"><div class="label">Valor /m²</div><div class="valor">${fichaVentanaEsc(datos.valorUnitTxt)}</div></div>
        <div class="campo full"><div class="label">Uso predial</div><div class="valor">${fichaVentanaEsc(datos.uso)}</div></div>
      </div>
    </section>

    <section class="seccion-marco seccion-media seccion-street">
      <div class="media-head">
        <span>Vista de calle</span>
        <div class="media-tools">
          <button type="button" onclick="rotarStreetViewVentana(-15)" title="Girar izquierda">↺</button>
          <button type="button" onclick="rotarStreetViewVentana(15)" title="Girar derecha">↻</button>
        </div>
      </div>
      <div class="media-body">
        <div class="street-frame-wrap">
          <iframe id="previewStreetFrame" class="media-frame" title="Street View" loading="lazy" referrerpolicy="no-referrer-when-downgrade"${tieneStreet ? ` src="${streetUrl}"` : ""}></iframe>
          <img id="previewStreetPrintImg" class="street-print-snapshot" alt="">
        </div>
        <div id="previewStreetVacio" class="media-vacio"${tieneStreet ? ' style="display:none"' : ""}>Sin coordenadas para Street View.</div>
      </div>
    </section>

    <section class="seccion-marco seccion-media seccion-mapa">
      <div class="media-head"><span>Localización cartográfica</span></div>
      <div class="media-body" id="previewMapWrap">
        <div id="previewMap"></div>
      </div>
    </section>

    <div class="pie">${fichaVentanaEsc(fechaPie)}</div>
  </div>

  <script>${layoutScript}<\/script>
  <script>${streetScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirVentanaFichaCatastralGeneral() {
  const clave = String(
    window.predioSeleccionado?.clave_catastral ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio en el panel de análisis.");
    return null;
  }

  const datos = typeof cargarDatosFichaCatastral === "function"
    ? await cargarDatosFichaCatastral(clave)
    : null;

  if (!datos) {
    alert("No se pudieron cargar los datos del predio.");
    return null;
  }

  const featureGeoJSONString = serializarFeatureFichaVentana(datos);
  const streetVistaInicial = leerVistaStreetPopupParaFicha();
  const win = window.open("", "_blank", "width=1200,height=900");
  if (!win) {
    alert("El navegador bloqueó la ventana de vista previa. Permita ventanas emergentes para este sitio.");
    return null;
  }

  win.document.open();
  win.document.write(construirHtmlFichaCatastralVentana(datos, featureGeoJSONString, streetVistaInicial));
  win.document.close();
  return win;
}

async function abrirPreviewFichaCatastralGeneral() {
  return abrirVentanaFichaCatastralGeneral();
}

async function abrirImpresionFichaCatastralDesdePopup() {
  return abrirVentanaFichaCatastralGeneral();
}

async function exportarPdfDesdePreviewFicha() {
  return abrirVentanaFichaCatastralGeneral();
}

function imprimirPreviewFichaCatastral() {
  return abrirVentanaFichaCatastralGeneral();
}

function cerrarPreviewFichaCatastralGeneral() {}

window.abrirPreviewFichaCatastralGeneral = abrirPreviewFichaCatastralGeneral;
window.abrirVentanaFichaCatastralGeneral = abrirVentanaFichaCatastralGeneral;
window.abrirImpresionFichaCatastralDesdePopup = abrirImpresionFichaCatastralDesdePopup;
window.exportarPdfDesdePreviewFicha = exportarPdfDesdePreviewFicha;
window.imprimirPreviewFichaCatastral = imprimirPreviewFichaCatastral;
window.cerrarPreviewFichaCatastralGeneral = cerrarPreviewFichaCatastralGeneral;
