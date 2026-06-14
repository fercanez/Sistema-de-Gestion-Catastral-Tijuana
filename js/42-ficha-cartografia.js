/* Ficha Cartografía — impresión legal (oficio) desde Construcciones/Medidas */

const FICHA_CARTO_LOGO = "logomxli.png";
const FICHA_CARTO_OL_JS = "https://cdn.jsdelivr.net/npm/ol@v9.2.4/dist/ol.js";
const FICHA_CARTO_OL_CSS = "https://cdn.jsdelivr.net/npm/ol@v9.2.4/ol.css";
const FICHA_CARTO_WMS_CATASTRO = "https://fcnarqnodo.hopto.org/geoserver/catastro_bc/wms";
const FICHA_CARTO_WMS_GEONODE = "https://fcnarqnodo.hopto.org/geoserver/geonode/wms";

function fichaCartoEsc(valor) {
  return typeof escapeHtml === "function" ? escapeHtml(valor) : String(valor ?? "");
}

function fichaCartoFormatNum(valor) {
  return typeof formatoNumero === "function" ? formatoNumero(valor) : valor;
}

function fichaCartoDms(ang) {
  if (typeof popupConstrDms === "function") return popupConstrDms(ang);
  const d = Math.floor(ang);
  const mFloat = (ang - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${d}°${m}'${s.toFixed(0)}"`;
}

function fichaCartoFormatUtm(value) {
  if (typeof popupConstrFormatUtm === "function") return popupConstrFormatUtm(value);
  return Number(value).toFixed(3);
}

function fichaCartoFormatTipo(tipo) {
  const t = String(tipo || "").trim();
  if (!t) return "—";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

async function cargarDatosFichaCartografia(clave) {
  const claveNorm = String(clave || "").trim().toUpperCase();
  if (!claveNorm) return null;

  const datos = typeof cargarDatosFichaCatastral === "function"
    ? await cargarDatosFichaCatastral(claveNorm)
    : null;
  if (!datos) return null;

  const extra = typeof popupConstrRecopilarDatosFichaCartografia === "function"
    ? await popupConstrRecopilarDatosFichaCartografia(claveNorm, datos.p)
    : { cuadro: { filas: [], area: 0, perimetro: 0 }, construcciones: [], featureGeoJSON: null };

  const supConst = Number(datos.p?.sup_const || 0);
  return Object.assign({}, datos, {
    cuadro: extra.cuadro || { filas: [], area: 0, perimetro: 0 },
    construcciones: extra.construcciones || [],
    featureGeoJSON: extra.featureGeoJSON || null,
    construccionesGeoJSON: extra.construccionesGeoJSON || null,
    supConst,
    tieneConst: datos.p?.tiene_construccion === true || supConst > 0
  });
}

function htmlFilasCuadroCarto(cuadro) {
  const filas = cuadro?.filas || [];
  if (!filas.length) {
    return `<tr><td colspan="6">Sin geometría para cuadro de construcción.</td></tr>`;
  }
  return filas.map(f => `
    <tr>
      <td>P${f.n}</td>
      <td>P${f.n} - P${f.sig}</td>
      <td>${f.dist.toFixed(2)}</td>
      <td>${fichaCartoDms(f.ang)}</td>
      <td>${fichaCartoFormatUtm(f.este)}</td>
      <td>${fichaCartoFormatUtm(f.norte)}</td>
    </tr>
  `).join("");
}

function htmlConstruccionesCarto(lista) {
  if (!lista?.length) {
    return `<div class="ficha-carto-vacio">No se encontraron construcciones en la capa para esta clave.</div>`;
  }
  const filas = lista.map(c => {
    const sup = c.suphor != null ? Number(c.suphor).toFixed(3) : "—";
    const per = c.perimetro != null ? Number(c.perimetro).toFixed(4) : "—";
    return `
      <tr>
        <td>${fichaCartoEsc(c.claveconst ?? "—")}</td>
        <td>${fichaCartoEsc(c.niveles ?? "—")}</td>
        <td>${sup !== "—" ? sup : "—"}</td>
        <td>${fichaCartoEsc(fichaCartoFormatTipo(c.tipo))}</td>
        <td>${per !== "—" ? per : "—"}</td>
      </tr>
    `;
  }).join("");
  return `
    <table class="tabla-construcciones">
      <thead>
        <tr>
          <th>Clave const.</th>
          <th>Niveles</th>
          <th>Sup. hor. (m²)</th>
          <th>Tipo</th>
          <th>Perímetro (m)</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;
}

function serializarFeatureCarto(datos) {
  if (datos.featureGeoJSON) {
    try {
      return JSON.stringify(datos.featureGeoJSON);
    } catch (e) {}
  }
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
    console.warn("No se pudo serializar geometría cartográfica:", e);
  }
  return null;
}

function fichaCartoLayerPanel() {
  const capas = typeof fichaMapaCapasItemsHtml === "function"
    ? fichaMapaCapasItemsHtml([
        { id: "predio", checkboxId: "chkCartoPredioSel", dotClass: "dot-blue", label: "Predio consultado", checked: true, opacity: 100 },
        { id: "cotas", checkboxId: "chkCartoCotas", dotClass: "dot-amber", label: "Cotas", checked: true, opacity: 100 },
        { id: "vertices", checkboxId: "chkCartoVertices", dotClass: "dot-cyan", label: "Vértices", checked: true, opacity: 100 },
        { id: "constrVec", checkboxId: "chkCartoConstruccionesVec", dotClass: "dot-orange", label: "Construcciones (vector)", checked: true, opacity: 100 },
        { id: "constrWms", checkboxId: "chkCartoConstruccionesWMS", dotClass: "dot-purple", label: "Construcciones (WMS)", checked: true, opacity: 88 },
        { id: "prediosWms", checkboxId: "chkCartoPrediosWMS", dotClass: "dot-red", label: "Predios (WMS)", checked: true, opacity: 85 },
        { id: "colonias", checkboxId: "chkCartoColoniasWMS", dotClass: "dot-green", label: "Colonias", checked: false, opacity: 55 }
      ], {
        opPrefix: "fichaCartoOp",
        toggleFn: "toggleCapaFichaCarto",
        opacityFn: "cambiarOpacidadCapaFichaCarto",
        subirFn: "subirCapaFichaCarto",
        bajarFn: "bajarCapaFichaCarto"
      })
    : "";

  const inner = `<div class="grupo ficha-capas-overlay" id="fichaCartoCapasOverlayList">
      <strong>Capas del plano</strong>
      ${capas}
    </div>
    ${typeof htmlFichaPreviewBasemapRadios === "function"
      ? htmlFichaPreviewBasemapRadios("cartoBasemap", "cambiarBaseCarto", [
          ["googleHybrid", "Google Hybrid", true],
          ["googleSat", "Google Satellite", false],
          ["esri", "ESRI Satellite", false],
          ["osm", "OpenStreetMap", false]
        ])
      : ""}`;

  return typeof htmlFichaPreviewLayerPanel === "function"
    ? htmlFichaPreviewLayerPanel("fichaCartoLayerPanel", inner)
    : `<div id="fichaCartoLayerPanel" class="ficha-preview-layer-panel oculto">${inner}</div>`;
}

function buildFichaCartoMapScript(featureGeoJSONString, construccionesGeoJSONString) {
  const constrJson = construccionesGeoJSONString || "null";
  const capasRuntime = typeof buildFichaMapaCapasRuntimeScript === "function"
    ? buildFichaMapaCapasRuntimeScript({
        ordenDef: {
          predio: 35,
          cotas: 42,
          vertices: 42,
          constrVec: 28,
          constrWms: 18,
          prediosWms: 12,
          colonias: 5
        },
        capaProp: {
          predio: "predioLayer",
          prediosWms: "capaPredios",
          colonias: "capaColonias",
          constrWms: "capaConstruccionesWms",
          constrVec: "construccionesVectorLayer",
          cotas: "cotasLayer",
          vertices: "cotasLayer"
        },
        chkMap: {
          predio: "chkCartoPredioSel",
          prediosWms: "chkCartoPrediosWMS",
          colonias: "chkCartoColoniasWMS",
          constrWms: "chkCartoConstruccionesWMS",
          constrVec: "chkCartoConstruccionesVec",
          cotas: "chkCartoCotas",
          vertices: "chkCartoVertices"
        },
        optionalIds: ["colonias", "constrVec"],
        linkedZIndexIds: ["cotas", "vertices"],
        capasVar: "cartoCapas",
        mapVar: "cartoMap",
        overlayListId: "fichaCartoCapasOverlayList",
        opPrefix: "fichaCartoOp",
        toggleFn: "toggleCapaFichaCarto",
        opacityFn: "cambiarOpacidadCapaFichaCarto",
        subirFn: "subirCapaFichaCarto",
        bajarFn: "bajarCapaFichaCarto",
        initFn: "inicializarOrdenCapasFichaCarto"
      })
    : "";

  return `
  const featureGeoJSON=${featureGeoJSONString};
  const construccionesGeoJSON=${constrJson};
  let cartoMap=null,predioSource=null,cotasSource=null;
  let cartoCapas={};
  let mostrarCotasCarto=true,mostrarVerticesCarto=true;
  ${capasRuntime}

  function obtenerCoordsCarto(feature){
    const geom=feature.getGeometry();
    let polygon=null;
    if(geom instanceof ol.geom.Polygon)polygon=geom;
    else if(geom instanceof ol.geom.MultiPolygon){
      const polys=geom.getPolygons();
      if(!polys||!polys.length)return null;
      polygon=polys.reduce((m,a)=>a.getArea()>m.getArea()?a:m,polys[0]);
    }else return null;
    const coords=polygon.getCoordinates()[0].slice();
    if(coords.length>1){
      const p=coords[0],u=coords[coords.length-1];
      if(p[0]===u[0]&&p[1]===u[1])coords.pop();
    }
    return coords;
  }

  function distMetrosCarto(a,b){
    return ol.sphere.getDistance(
      ol.proj.transform(a,"EPSG:3857","EPSG:4326"),
      ol.proj.transform(b,"EPSG:3857","EPSG:4326")
    );
  }

  function angLineaCarto(p,q){
    const pp=cartoMap.getPixelFromCoordinate(p),qp=cartoMap.getPixelFromCoordinate(q);
    let a=Math.atan2(qp[1]-pp[1],qp[0]-pp[0]);
    if(a>Math.PI/2)a-=Math.PI;
    if(a<-Math.PI/2)a+=Math.PI;
    return a;
  }

  function ptCotaCarto(p,q,c){
    const mid=[(p[0]+q[0])/2,(p[1]+q[1])/2],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.sqrt(dx*dx+dy*dy);
    if(len===0)return mid;
    let nx=-dy/len,ny=dx/len;
    if((nx*(mid[0]-c[0])+ny*(mid[1]-c[1]))<0){nx*=-1;ny*=-1;}
    const s=(cartoMap.getView().getResolution()||1)*24;
    return[mid[0]+nx*s,mid[1]+ny*s];
  }

  function ptVertCarto(p,c){
    const vx=p[0]-c[0],vy=p[1]-c[1],len=Math.sqrt(vx*vx+vy*vy);
    if(len===0)return p;
    const s=(cartoMap.getView().getResolution()||1)*18;
    return[p[0]+(vx/len)*s,p[1]+(vy/len)*s];
  }

  function regenerarCotasCarto(){
    if(!cartoMap||!predioSource||!cotasSource)return;
    cotasSource.clear();
    const feats=predioSource.getFeatures();
    if(!feats||!feats.length)return;
    const coords=obtenerCoordsCarto(feats[0]);
    if(!coords||coords.length<3)return;
    const c=[coords.reduce((s,x)=>s+x[0],0)/coords.length,coords.reduce((s,x)=>s+x[1],0)/coords.length];
    for(let i=0;i<coords.length;i++){
      const n=(i+1)%coords.length,p=coords[i],q=coords[n];
      cotasSource.addFeature(new ol.Feature({geometry:new ol.geom.LineString([p,q]),tipo:"linea"}));
      cotasSource.addFeature(new ol.Feature({geometry:new ol.geom.Point(ptCotaCarto(p,q,c)),tipo:"cota",texto:distMetrosCarto(p,q).toFixed(2)+" m",rotation:angLineaCarto(p,q)}));
      cotasSource.addFeature(new ol.Feature({geometry:new ol.geom.Point(p),tipo:"vertice_punto"}));
      cotasSource.addFeature(new ol.Feature({geometry:new ol.geom.Point(ptVertCarto(p,c)),tipo:"vertice_texto",texto:"P"+(i+1)}));
    }
  }

  function estiloCotasCarto(feature){
    const tipo=feature.get("tipo");
    if(tipo==="linea"){
      if(!mostrarCotasCarto)return null;
      return new ol.style.Style({stroke:new ol.style.Stroke({color:"#003cff",width:2,lineDash:[8,5]})});
    }
    if(tipo==="cota"){
      if(!mostrarCotasCarto)return null;
      return new ol.style.Style({
        text:new ol.style.Text({
          text:feature.get("texto")||"",
          font:"bold 11px Arial",
          rotation:feature.get("rotation")||0,
          rotateWithView:false,
          fill:new ol.style.Fill({color:"#003cff"}),
          stroke:new ol.style.Stroke({color:"#ffffff",width:4}),
          overflow:true
        })
      });
    }
    if(tipo==="vertice_punto"){
      if(!mostrarVerticesCarto)return null;
      return new ol.style.Style({
        image:new ol.style.Circle({
          radius:4,
          fill:new ol.style.Fill({color:"#ffffff"}),
          stroke:new ol.style.Stroke({color:"#e53935",width:2})
        })
      });
    }
    if(tipo==="vertice_texto"){
      if(!mostrarVerticesCarto)return null;
      return new ol.style.Style({
        text:new ol.style.Text({
          text:feature.get("texto")||"",
          font:"bold 11px Arial",
          fill:new ol.style.Fill({color:"#ffffff"}),
          stroke:new ol.style.Stroke({color:"#e53935",width:4}),
          overflow:true
        })
      });
    }
    return null;
  }

  function iniciarMapaCarto(){
    cartoCapas.baseGoogleHybrid=new ol.layer.Tile({visible:true,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    cartoCapas.baseGoogleSat=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",crossOrigin:"anonymous"})});
    cartoCapas.baseEsri=new ol.layer.Tile({visible:false,source:new ol.source.XYZ({url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",crossOrigin:"anonymous"})});
    cartoCapas.baseOSM=new ol.layer.Tile({visible:false,source:new ol.source.OSM()});

    cartoCapas.capaColonias=new ol.layer.Tile({
      visible:false,opacity:0.55,zIndex:fichaCapaOrdenDef.colonias,
      source:new ol.source.TileWMS({
        url:"${FICHA_CARTO_WMS_GEONODE}",
        params:{LAYERS:"colonias",TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",crossOrigin:"anonymous"
      })
    });

    cartoCapas.capaPredios=new ol.layer.Tile({
      visible:true,opacity:0.85,zIndex:fichaCapaOrdenDef.prediosWms,
      source:new ol.source.TileWMS({
        url:"${FICHA_CARTO_WMS_CATASTRO}",
        params:{LAYERS:"catastro_bc:predios_oficial",TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",crossOrigin:"anonymous"
      })
    });

    cartoCapas.capaConstruccionesWms=new ol.layer.Tile({
      visible:true,opacity:0.88,zIndex:fichaCapaOrdenDef.constrWms,
      source:new ol.source.TileWMS({
        url:"${FICHA_CARTO_WMS_GEONODE}",
        params:{LAYERS:"geonode:construccionesmxli",TILED:true,VERSION:"1.1.1",FORMAT:"image/png",TRANSPARENT:true},
        serverType:"geoserver",crossOrigin:"anonymous"
      })
    });

    predioSource=new ol.source.Vector({
      features:new ol.format.GeoJSON().readFeatures({type:"FeatureCollection",features:[featureGeoJSON]},{
        dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"
      })
    });

    cartoCapas.predioLayer=new ol.layer.Vector({
      source:predioSource,
      zIndex:fichaCapaOrdenDef.predio,
      style:[
        new ol.style.Style({stroke:new ol.style.Stroke({color:"#ffffff",width:6})}),
        new ol.style.Style({stroke:new ol.style.Stroke({color:"#003cff",width:4,lineDash:[10,6]}),fill:new ol.style.Fill({color:"rgba(0,60,255,0.12)"})})
      ]
    });

    cartoCapas.construccionesVectorLayer=null;
    if(construccionesGeoJSON&&construccionesGeoJSON.features&&construccionesGeoJSON.features.length){
      const srcConstr=new ol.source.Vector({
        features:new ol.format.GeoJSON().readFeatures(construccionesGeoJSON,{
          dataProjection:"EPSG:3857",featureProjection:"EPSG:3857"
        })
      });
      cartoCapas.construccionesVectorLayer=new ol.layer.Vector({
        visible:true,
        zIndex:fichaCapaOrdenDef.constrVec,
        source:srcConstr,
        style:new ol.style.Style({
          stroke:new ol.style.Stroke({color:"#e65100",width:2}),
          fill:new ol.style.Fill({color:"rgba(255,152,0,0.35)"})
        })
      });
    }

    cotasSource=new ol.source.Vector();
    cartoCapas.cotasLayer=new ol.layer.Vector({source:cotasSource,zIndex:fichaCapaOrdenDef.cotas,style:estiloCotasCarto});

    const layers=[
      cartoCapas.baseGoogleHybrid,cartoCapas.baseGoogleSat,cartoCapas.baseEsri,cartoCapas.baseOSM,
      cartoCapas.capaColonias,cartoCapas.capaPredios,cartoCapas.capaConstruccionesWms
    ];
    if(cartoCapas.construccionesVectorLayer)layers.push(cartoCapas.construccionesVectorLayer);
    layers.push(cartoCapas.predioLayer,cartoCapas.cotasLayer);

    cartoMap=new ol.Map({
      target:"cartoMap",
      layers:layers,
      view:new ol.View({center:ol.proj.fromLonLat([-115.468,32.624]),zoom:18})
    });

    if(typeof inicializarOrdenCapasFichaCarto==="function")inicializarOrdenCapasFichaCarto();

    cartoMap.getView().on("change:resolution",function(){regenerarCotasCarto();});
    cartoMap.on("moveend",function(){regenerarCotasCarto();});

    function refrescar(){
      if(typeof ajustarLayoutFichaCarto==="function")ajustarLayoutFichaCarto();
      if(typeof actualizarCapasCarto==="function")actualizarCapasCarto();
      if(!cartoMap)return;
      cartoMap.updateSize();
      try{cartoMap.renderSync();}catch(e){}
      centrarMapaCarto();
    }
    setTimeout(refrescar,80);
    setTimeout(refrescar,500);
    setTimeout(refrescar,1400);
  }

  function centrarMapaCarto(){
    if(!cartoMap||!predioSource)return;
    cartoMap.updateSize();
    cartoMap.getView().fit(predioSource.getExtent(),{padding:[40,40,40,40],maxZoom:20,duration:300});
    setTimeout(regenerarCotasCarto,350);
  }

  function actualizarCapasCarto(){
    if(!cartoCapas.predioLayer)return;
    ["predio","prediosWms","colonias","constrWms","constrVec","cotas","vertices"].forEach(function(id){
      toggleCapaFichaCarto(id);
    });
  }

  const _toggleCapaFichaCartoBase=toggleCapaFichaCarto;
  function toggleCapaFichaCarto(id){
    if(id==="cotas"||id==="vertices"){
      mostrarCotasCarto=document.getElementById("chkCartoCotas")?.checked??true;
      mostrarVerticesCarto=document.getElementById("chkCartoVertices")?.checked??true;
      if(cartoCapas.cotasLayer){
        cartoCapas.cotasLayer.setVisible(mostrarCotasCarto||mostrarVerticesCarto);
        cartoCapas.cotasLayer.changed();
      }
      cartoMap&&cartoMap.render();
      return;
    }
    if(id==="constrVec"&&!cartoCapas.construccionesVectorLayer)return;
    _toggleCapaFichaCartoBase(id);
  }

  function cambiarBaseCarto(){
    if(!cartoMap)return;
    const c=document.querySelector('input[name="cartoBasemap"]:checked');
    const v=c?c.value:"googleHybrid";
    cartoCapas.baseGoogleHybrid.setVisible(v==="googleHybrid");
    cartoCapas.baseGoogleSat.setVisible(v==="googleSat");
    cartoCapas.baseEsri.setVisible(v==="esri");
    cartoCapas.baseOSM.setVisible(v==="osm");
  }

  function toggleLayerPanelCarto(){
    document.getElementById("fichaCartoLayerPanel")?.classList.toggle("oculto");
  }

  window.centrarMapaCarto=centrarMapaCarto;
  window.actualizarCapasCarto=actualizarCapasCarto;
  window.cambiarBaseCarto=cambiarBaseCarto;
  window.toggleLayerPanelCarto=toggleLayerPanelCarto;

  const script=document.createElement("script");
  script.src="${FICHA_CARTO_OL_JS}";
  script.onload=function(){ iniciarMapaCarto(); };
  script.onerror=function(){
    const el=document.getElementById("cartoMap");
    if(el)el.innerHTML="<div class='ficha-carto-vacio'>No se pudo cargar OpenLayers.</div>";
  };
  document.body.appendChild(script);
  `;
}

function buildFichaCartoLayoutScript(numCuadro, numConstr) {
  return `
  function ajustarLayoutFichaCarto(opciones){
    opciones=opciones||{};
    const esImpresion=!!opciones.impresion;
    let reservado=3.35;
    reservado+=${numCuadro}*0.135+${numConstr}*0.125;
    if(esImpresion)reservado=Math.max(3.1,reservado-0.08);
    let mapIn=Math.max(3.35,Math.min(5.9,13.85-reservado));
    if(esImpresion)mapIn=Math.max(3.2,mapIn-0.05);
    document.documentElement.style.setProperty("--ficha-carto-map",mapIn.toFixed(2)+"in");
    const mapEl=document.getElementById("cartoMap");
    const wrap=document.getElementById("cartoMapWrap");
    if(mapEl){mapEl.style.height=mapIn.toFixed(2)+"in";mapEl.style.minHeight=mapIn.toFixed(2)+"in";}
    if(wrap){wrap.style.height=mapIn.toFixed(2)+"in";wrap.style.minHeight=mapIn.toFixed(2)+"in";}
    if(typeof cartoMap!=="undefined"&&cartoMap){
      cartoMap.updateSize();
      try{cartoMap.renderSync();}catch(e){}
    }
  }

  function esperarMapaCartoListo(callback){
    let paso=0;
    function tick(){
      ajustarLayoutFichaCarto({impresion:true});
      if(typeof centrarMapaCarto==="function")centrarMapaCarto();
      if(typeof cartoMap!=="undefined"&&cartoMap){
        cartoMap.updateSize();
        try{cartoMap.renderSync();}catch(e){}
      }
      paso++;
      if(paso>=8){
        setTimeout(callback,180);
        return;
      }
      setTimeout(tick,paso<3?220:320);
    }
    tick();
  }

  function imprimirFichaCartoVentana(){
    esperarMapaCartoListo(function(){
      window.print();
    });
  }

  function imprimirAhoraCarto(){
    imprimirFichaCartoVentana();
  }

  window.imprimirFichaCartoVentana=imprimirFichaCartoVentana;
  window.imprimirAhoraCarto=imprimirAhoraCarto;
  window.ajustarLayoutFichaCarto=ajustarLayoutFichaCarto;

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){ajustarLayoutFichaCarto();});
  }else{
    ajustarLayoutFichaCarto();
  }
  setTimeout(function(){ajustarLayoutFichaCarto();},700);
  setTimeout(function(){ajustarLayoutFichaCarto();},1600);
  window.addEventListener("resize",function(){
    clearTimeout(window.__fichaCartoResizeT);
    window.__fichaCartoResizeT=setTimeout(function(){ajustarLayoutFichaCarto();},160);
  });
  `;
}

function construirHtmlFichaCartografiaVentana(datos) {
  const supTxt = datos.supDoc ? Number(datos.supDoc).toFixed(2) + " m²" : "—";
  const supConstTxt = datos.supConst ? Number(datos.supConst).toFixed(2) + " m²" : "—";
  const cuadro = datos.cuadro || { filas: [], area: 0, perimetro: 0 };
  const construcciones = datos.construcciones || [];
  const fechaPie = new Date().toLocaleDateString("es-MX");
  const featureStr = serializarFeatureCarto(datos);
  const constrGeoStr = datos.construccionesGeoJSON
    ? JSON.stringify(datos.construccionesGeoJSON)
    : "null";
  const mapScript = featureStr
    ? buildFichaCartoMapScript(featureStr, constrGeoStr)
    : `document.getElementById("cartoMap").innerHTML="<div class='ficha-carto-vacio'>Sin geometría cartográfica para este predio.</div>";`;
  const layoutScript = buildFichaCartoLayoutScript(cuadro.filas.length, construcciones.length);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ficha Cartografía ${fichaCartoEsc(datos.clave)}</title>
<link rel="stylesheet" href="${FICHA_CARTO_OL_CSS}">
<style>
:root{
  --guinda:#703341;
  --guinda-claro:#d8bdc5;
  --ficha-ancho:8.5in;
  --ficha-alto:14in;
  --ficha-carto-map:4.8in;
}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f3f3;color:#1e293b;}
body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
.toolbar{position:sticky;top:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.toolbar button{border:none;background:var(--guinda);color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;}
.toolbar button.sec{background:#666;}
.toolbar .toolbar-info{font-size:11px;color:#64748b;font-weight:700;margin-right:auto;}
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
  background:var(--guinda)!important;color:#fff!important;padding:8px 10px;min-height:64px;
  display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;
  border-bottom:3px solid #c9a227;
}
.enc-logo{justify-self:start;display:flex;align-items:center;}
.enc-logo img{height:50px;max-width:220px;object-fit:contain;background:#fff;padding:3px 8px;border-radius:6px;}
.enc-centro{text-align:center;justify-self:center;padding:0 6px;max-width:62%;}
.enc-centro h1{margin:0;font-size:15px;font-weight:800;color:#fff!important;letter-spacing:.55px;line-height:1.15;}
.enc-centro h2{margin:3px 0 0;font-size:9px;font-weight:600;color:#fff!important;opacity:.95;}
.enc-der{justify-self:end;text-align:right;font-size:9px;font-weight:700;color:#fff!important;line-height:1.25;text-transform:uppercase;}
.enc-der b{display:block;font-size:14px;margin-top:2px;text-transform:none;letter-spacing:.5px;}
.seccion-marco{margin:4px 6px 5px;border:1px solid var(--guinda-claro);border-radius:4px;overflow:hidden;background:#fff;box-sizing:border-box;}
.seccion-datos .ficha-linea{padding:4px 8px;font-size:9px;border-bottom:1px solid #efe6e8;line-height:1.35;}
.ficha-etiq{color:#1e293b;font-weight:700;text-transform:uppercase;}
.ficha-valor,.ficha-valor-nombre{font-size:10px;font-weight:800;color:var(--guinda);}
.grid{display:grid;grid-template-columns:repeat(4,1fr);background:#fff;}
.campo{border-right:1px solid #efe6e8;border-bottom:1px solid #efe6e8;padding:3px 6px;min-height:28px;box-sizing:border-box;}
.campo:nth-child(4n){border-right:none;}
.campo.full{grid-column:span 4;border-right:none;}
.label{font-size:8px;color:#1e293b;font-weight:700;text-transform:uppercase;margin-bottom:1px;}
.valor{font-size:10px;font-weight:800;color:var(--guinda);line-height:1.2;word-break:break-word;}
.media-head{background:var(--guinda);color:#fff;padding:4px 8px;font-size:9px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;}
.seccion-mapa .media-body{position:relative;background:#f1f5f9;overflow:hidden;height:var(--ficha-carto-map);}
#cartoMapWrap{position:relative;width:100%;height:var(--ficha-carto-map);min-height:var(--ficha-carto-map);}
#cartoMap{width:100%;height:100%;min-height:var(--ficha-carto-map);background:#eaeaea;position:relative;}
.resumen-medicion{display:grid;grid-template-columns:repeat(5,1fr);gap:0;background:#faf5f3;border-bottom:1px solid #efe6e8;}
.resumen-medicion div{padding:4px 6px;border-right:1px solid #efe6e8;font-size:8px;box-sizing:border-box;}
.resumen-medicion div:last-child{border-right:none;}
.resumen-medicion span{display:block;color:#1e293b;font-weight:700;text-transform:uppercase;font-size:7px;margin-bottom:1px;}
.resumen-medicion b{display:block;color:var(--guinda);font-size:9px;font-weight:800;}
.tabla-cuadro,.tabla-construcciones{width:100%;border-collapse:collapse;font-size:8px;}
.tabla-cuadro th,.tabla-cuadro td,.tabla-construcciones th,.tabla-construcciones td{border:1px solid #e2d6da;padding:2px 4px;text-align:center;vertical-align:middle;}
.tabla-cuadro thead th,.tabla-construcciones thead th{background:#f5ecee;color:#1e293b;font-weight:800;text-transform:uppercase;font-size:7px;}
.tabla-cuadro tfoot td{font-size:7px;font-weight:700;color:#475569;text-align:left;padding:4px 6px;}
.tabla-scroll{max-height:none;overflow:visible;}
.sub-head{background:#f5ecee;color:var(--guinda);padding:4px 8px;font-size:8px;font-weight:800;text-transform:uppercase;border-bottom:1px solid var(--guinda-claro);}
.ficha-carto-vacio{padding:12px;text-align:center;color:#64748b;font-size:9px;}
.layer-panel{display:none;}
${typeof FICHA_MAPA_CAPAS_PANEL_CSS !== "undefined" ? FICHA_MAPA_CAPAS_PANEL_CSS : ""}
${typeof FICHA_PREVIEW_LAYER_PANEL_CSS !== "undefined" ? FICHA_PREVIEW_LAYER_PANEL_CSS : ""}
.aviso-impresion{text-align:center;font-size:10px;color:#64748b;padding:5px 8px 6px;font-style:italic;}
.pie{text-align:center;font-size:8px;color:var(--guinda);font-weight:700;padding:3px 6px 4px;border-top:1px solid var(--guinda-claro);}
@media print{
  @page{size:8.5in 14in portrait;margin:4mm;}
  html,body{background:#fff!important;height:auto!important;}
  .toolbar,.aviso-impresion,.ficha-preview-layer-panel{display:none!important;}
  .contenedor{
    width:var(--ficha-ancho)!important;max-width:var(--ficha-ancho)!important;
    min-height:calc(var(--ficha-alto) - 0.12in)!important;margin:0 auto!important;
    box-shadow:none!important;border:1px solid var(--guinda)!important;border-radius:0!important;
    page-break-inside:avoid;break-inside:avoid;
  }
  .seccion-marco{margin:1px 3px 2px;}
  .encabezado{min-height:auto;padding:3px 7px;}
  .enc-logo img{height:38px;}
  .enc-centro h1{font-size:12px;}
  .enc-centro h2{font-size:8px;}
  .seccion-mapa .media-body,#cartoMapWrap,#cartoMap{height:var(--ficha-carto-map)!important;min-height:var(--ficha-carto-map)!important;}
}
</style>
</head>
<body>
  <div class="toolbar">
    <span class="toolbar-info">Ficha cartografía · Oficio 8.5×14</span>
    <button type="button" onclick="centrarMapaCarto()">Centrar</button>
    <button type="button" class="sec" onclick="toggleLayerPanelCarto()">Capas</button>
    <button type="button" onclick="imprimirAhoraCarto()">Imprimir / PDF</button>
    <button type="button" class="sec" onclick="window.close()">Cerrar</button>
  </div>
  ${fichaCartoLayerPanel()}
  <div class="aviso-impresion">Ajuste capas y zoom del mapa. Pulse «Imprimir / PDF» para guardar como PDF (Oficio 8.5×14).</div>

  <div class="contenedor">
    <div class="encabezado">
      <div class="enc-logo"><img src="${FICHA_CARTO_LOGO}" alt="Logo"></div>
      <div class="enc-centro">
        <h1>FICHA CARTOGRAFIA</h1>
        <h2>Catastro Mexicali</h2>
      </div>
      <div class="enc-der">Clave Catastral<b>${fichaCartoEsc(datos.clave)}</b></div>
    </div>

    <section class="seccion-marco seccion-datos">
      <div class="ficha-linea"><span class="ficha-etiq">Fecha y hora de consulta:</span> <span class="ficha-valor">${fichaCartoEsc(datos.fechaConsulta)}</span></div>
      <div class="ficha-linea"><span class="ficha-etiq">Nombre registrado:</span> <span class="ficha-valor-nombre">${fichaCartoEsc(datos.nombre)}</span></div>
      <div class="grid">
        <div class="campo"><div class="label">Colonia</div><div class="valor">${fichaCartoEsc(datos.colonia)}</div></div>
        <div class="campo"><div class="label">Calle</div><div class="valor">${fichaCartoEsc(datos.calle)}</div></div>
        <div class="campo"><div class="label">Número oficial</div><div class="valor">${fichaCartoEsc(datos.numof)}</div></div>
        <div class="campo"><div class="label">Superficie</div><div class="valor">${fichaCartoEsc(supTxt)}</div></div>
        <div class="campo"><div class="label">Manzana</div><div class="valor">${fichaCartoEsc(datos.seg?.manzana || "—")}</div></div>
        <div class="campo"><div class="label">Lote</div><div class="valor">${fichaCartoEsc(datos.seg?.lote || "—")}</div></div>
        <div class="campo"><div class="label">Zona homogénea</div><div class="valor">${fichaCartoEsc(datos.zonah)}</div></div>
        <div class="campo"><div class="label">Valor /m²</div><div class="valor">${fichaCartoEsc(datos.valorUnitTxt)}</div></div>
        <div class="campo full"><div class="label">Uso predial</div><div class="valor">${fichaCartoEsc(datos.uso)}</div></div>
      </div>
    </section>

    <section class="seccion-marco seccion-mapa">
      <div class="media-head">Medición cartográfica</div>
      <div class="media-body" id="cartoMapWrap">
        <div id="cartoMap"></div>
      </div>
    </section>

    <section class="seccion-marco seccion-medicion">
      <div class="media-head">Datos de medición y construcciones</div>
      <div class="resumen-medicion">
        <div><span>Sup. documental</span><b>${fichaCartoEsc(supTxt)}</b></div>
        <div><span>Sup. construcción (padrón)</span><b>${fichaCartoEsc(supConstTxt)}</b></div>
        <div><span>Área UTM calculada</span><b>${cuadro.area ? cuadro.area.toFixed(2) + " m²" : "—"}</b></div>
        <div><span>Perímetro UTM</span><b>${cuadro.perimetro ? cuadro.perimetro.toFixed(2) + " m" : "—"}</b></div>
        <div><span>Construcción registrada</span><b>${datos.tieneConst ? "Sí" : "No"}</b></div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-cuadro">
          <thead>
            <tr>
              <th>Vértice</th><th>Lado</th><th>Dist. (m)</th><th>Ángulo</th><th>Este</th><th>Norte</th>
            </tr>
          </thead>
          <tbody>${htmlFilasCuadroCarto(cuadro)}</tbody>
          <tfoot>
            <tr>
              <td colspan="6">Área: ${cuadro.area ? cuadro.area.toFixed(2) : "0.00"} m² — Perímetro: ${cuadro.perimetro ? cuadro.perimetro.toFixed(2) : "0.00"} m · EPSG:32611 (UTM 11N)</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <section class="seccion-marco seccion-construcciones">
      <div class="sub-head">Construcciones de la clave (capa cartográfica)${construcciones.length ? ` — ${construcciones.length} registros` : ""}</div>
      <div class="tabla-scroll">${htmlConstruccionesCarto(construcciones)}</div>
    </section>

    <div class="pie">${fichaCartoEsc(fechaPie)}</div>
  </div>

  <script>${layoutScript}<\/script>
  <script>${mapScript}<\/script>
</body>
</html>`;
}

async function abrirVentanaFichaCartografia() {
  const clave = String(
    window.predioSeleccionado?.clave_catastral ||
    (typeof claveSeleccionadaActual !== "undefined" ? claveSeleccionadaActual : "") ||
    ""
  ).trim().toUpperCase();

  if (!clave) {
    alert("Seleccione un predio en el panel de análisis.");
    return null;
  }

  const datos = await cargarDatosFichaCartografia(clave);
  if (!datos) {
    alert("No se pudieron cargar los datos cartográficos del predio.");
    return null;
  }

  const win = window.open("", "_blank", "width=1200,height=900");
  if (!win) {
    alert("El navegador bloqueó la ventana emergente. Permita ventanas emergentes para este sitio.");
    return null;
  }

  win.document.open();
  win.document.write(construirHtmlFichaCartografiaVentana(datos));
  win.document.close();
  return win;
}

async function exportarPdfFichaCartografia() {
  const win = await abrirVentanaFichaCartografia();
  if (win) {
    setTimeout(() => {
      try {
        if (typeof win.imprimirFichaCartoVentana === "function") win.imprimirFichaCartoVentana();
        else if (typeof win.imprimirAhoraCarto === "function") win.imprimirAhoraCarto();
        else win.print();
      } catch (e) {
        alert("Se abrió la ficha cartográfica. Pulse «Imprimir / PDF» y elija «Guardar como PDF».");
      }
    }, 3200);
  }
}

window.cargarDatosFichaCartografia = cargarDatosFichaCartografia;
window.abrirVentanaFichaCartografia = abrirVentanaFichaCartografia;
window.exportarPdfFichaCartografia = exportarPdfFichaCartografia;
