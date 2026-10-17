/* Casio Modder — procedural 3D preview of the F-91W and A158/A168 with the user's LCD design. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const host = document.getElementById('three-host');
const $ = id => document.getElementById(id);
let renderer, scene, camera, controls, watch, lcdMat, lcdTex, lcdCanvas = document.createElement('canvas');
let model = 'F91W', started = false, dirty = true;

// Real-world case dimensions (mm)
const SPEC = {
  F91W: { w:35.2, h:38.2, d:8.5, lcdY:-1.2, metal:false, strapW:18 },
  A158: { w:36.3, h:38.6, d:9.6, lcdY:-0.8, metal:true,  strapW:18 },
};

function roundedRect(w,h,r){
  const s = new THREE.Shape(), x=-w/2, y=-h/2;
  s.moveTo(x+r,y); s.lineTo(x+w-r,y); s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r); s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h); s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r); s.quadraticCurveTo(x,y,x+r,y);
  return s;
}
/** ShapeGeometry with UVs normalised to 0..1 across the shape bounds. */
function faceGeometry(w,h,r){
  const g = new THREE.ShapeGeometry(roundedRect(w,h,r), 12);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i=0;i<p.count;i++) uv.setXY(i, (p.getX(i)+w/2)/w, (p.getY(i)+h/2)/h);
  return g;
}

function faceTexture(m, sp, lcdW, lcdH){
  const k = 24, c = document.createElement('canvas');
  c.width = Math.round(sp.w*k); c.height = Math.round(sp.h*k);
  const x = c.getContext('2d'), W=c.width, H=c.height;
  const cx = W/2, ly = H/2 - sp.lcdY*k;
  const lw = (lcdW+3)*k, lh = (lcdH+3)*k;
  const metal = sp.metal;
  // base
  if (metal){
    const g = x.createLinearGradient(0,0,W,H); g.addColorStop(0,'#d9dbde'); g.addColorStop(.5,'#9fa3a8'); g.addColorStop(1,'#e8eaec');
    x.fillStyle=g;
  } else x.fillStyle='#0d0d0e';
  x.fillRect(0,0,W,H);
  // inner panel around LCD
  x.fillStyle = metal ? '#1b1c1f' : '#151517';
  x.fillRect(cx-lw/2-1.5*k, ly-lh/2-5.2*k, lw+3*k, lh+10*k);
  // frame around LCD
  x.strokeStyle = metal ? '#c9ccd0' : '#b48a2c'; x.lineWidth = 0.35*k;
  x.strokeRect(cx-lw/2, ly-lh/2, lw, lh);
  const txt = (s,px,py,size,col,align='center',weight=800,stretch='')=>{ x.fillStyle=col; x.textAlign=align; x.textBaseline='middle'; x.font=`${weight} ${stretch} ${size*k}px Archivo, Arial, sans-serif`; x.fillText(s,px,py); };
  const top = ly-lh/2-2.6*k, bot = ly+lh/2+2.4*k;
  txt('CASIO', cx-lw/2, top, 3.0, '#ffffff', 'left', 900);
  if (m==='F91W'){
    txt('F-91W', cx+lw/2, top, 1.6, '#dcdcdc', 'right', 700);
    txt('LIGHT', cx, top, 1.4, '#dcdcdc', 'center', 700);
    x.fillStyle='#1e50ff'; x.fillRect(cx-lw/2, bot-1.1*k, lw*0.62, 2.2*k);
    txt('ALARM CHRONOGRAPH', cx-lw/2+lw*0.31, bot, 1.25, '#ffffff', 'center', 700);
    x.fillStyle='#e60012'; x.fillRect(cx-lw/2+lw*0.64, bot-1.1*k, lw*0.36, 2.2*k);
    txt('WATER', cx-lw/2+lw*0.82, bot, 1.25, '#ffffff', 'center', 700);
    txt('LIGHT', 2.0*k, H*0.32, 1.1, '#bbbbbb','left',700);
    txt('MODE', 2.0*k, H*0.70, 1.1, '#bbbbbb','left',700);
    txt('ALARM', W-2.0*k, H*0.70, 1.1, '#bbbbbb','right',700);
  } else {
    txt('ILLUMINATOR', cx+lw/2, top, 1.3, '#dcdcdc', 'right', 700);
    txt('ALARM CHRONOGRAPH', cx, bot, 1.3, '#dcdcdc', 'center', 700);
    txt('WATER RESIST', cx, bot+2.2*k, 1.1, '#9a9a9a', 'center', 600);
    txt('LIGHT', 3.0*k, 3.0*k, 1.2, '#333','left',800);
    txt('MODE', 3.0*k, H-3.0*k, 1.2, '#333','left',800);
    txt('START·STOP', W-3.0*k, 3.0*k, 1.1, '#333','right',800);
    txt('RESET', W-3.0*k, H-3.0*k, 1.1, '#333','right',800);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Bends a straight box (length along +y from 0) around the x-axis so the strap curves behind the wrist. */
function bend(geo, R, dir){
  const p = geo.attributes.position;
  for (let i=0;i<p.count;i++){
    const s = p.getY(i), t = p.getZ(i), th = s/R;
    p.setY(i, dir*(R+t)*Math.sin(th));
    p.setZ(i, (R+t)*Math.cos(th) - R);
  }
  geo.computeVertexNormals();
  return geo;
}

function build(){
  if (watch){ scene.remove(watch); watch.traverse(o=>{ o.geometry?.dispose(); }); }
  const sp = SPEC[model], S = window.CM.state;
  watch = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color:0xd5d8dc, metalness:1, roughness:0.28 });
  const resinMat = new THREE.MeshStandardMaterial({ color:0x111113, metalness:0, roughness:0.55 });
  const caseMat = sp.metal ? metalMat : resinMat;

  // case body
  const bev = 1.2;
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(sp.w-2*bev, sp.h-2*bev, 4), { depth: sp.d-2*bev, bevelEnabled:true, bevelSize:bev, bevelThickness:bev, bevelSegments:4, curveSegments:12 }), caseMat);
  body.position.z = bev; watch.add(body);
  const topZ = sp.d + 0.01;

  // face plate
  const lcdW = S.cw, lcdH = S.ch;
  const face = new THREE.Mesh(faceGeometry(sp.w-2.4, sp.h-2.4, 3.2), new THREE.MeshStandardMaterial({ map: faceTexture(model, {...sp, w:sp.w-2.4, h:sp.h-2.4}, lcdW, lcdH), roughness: sp.metal?0.35:0.6, metalness: sp.metal?0.6:0 }));
  face.position.z = topZ; watch.add(face);

  // LCD with the user's design
  lcdTex = new THREE.CanvasTexture(lcdCanvas); lcdTex.colorSpace = THREE.SRGBColorSpace; lcdTex.anisotropy = 8;
  lcdMat = new THREE.MeshStandardMaterial({ map: lcdTex, roughness:0.25, metalness:0, emissive:0x000000, emissiveMap: lcdTex });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(lcdW, lcdH), lcdMat);
  lcd.position.set(0, sp.lcdY, topZ + 0.02); watch.add(lcd);
  // crystal
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(lcdW+3, lcdH+3), new THREE.MeshPhysicalMaterial({ transparent:true, opacity:0.12, roughness:0.02, metalness:0, clearcoat:1, color:0xffffff }));
  glass.position.set(0, sp.lcdY, topZ + 0.3); watch.add(glass);

  // buttons
  const btnMat = sp.metal ? metalMat : new THREE.MeshStandardMaterial({ color:0x2a2a2d, roughness:0.4 });
  const btn = (x,y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,2.2,20), btnMat); m.rotation.z = Math.PI/2; m.position.set(x,y,sp.d/2); watch.add(m); };
  const bx = sp.w/2 + 0.6;
  if (model==='F91W'){ btn(-bx, sp.h*0.18); btn(-bx, -sp.h*0.2); btn(bx, -sp.h*0.2); }
  else { btn(-bx, sp.h*0.22); btn(-bx, -sp.h*0.22); btn(bx, sp.h*0.22); btn(bx, -sp.h*0.22); }

  // straps / bracelet
  const R = 26, L = 78, z0 = sp.d*0.45;
  for (const dir of [1,-1]){
    const grp = new THREE.Group();
    if (!sp.metal){
      const g = bend(new THREE.BoxGeometry(sp.strapW, L, 3.0, 1, 60, 1).translate(0, L/2, 0), R, dir);
      grp.add(new THREE.Mesh(g, resinMat));
    } else {
      const linkL = 3.6;
      for (let s=0; s<L; s+=linkL){
        for (const [xw, xo] of [[5.2,-6.2],[6.6,0],[5.2,6.2]]){
          const g = bend(new THREE.BoxGeometry(xw, linkL-0.35, 2.2, 1, 3, 1).translate(xo, s + linkL/2, 0), R, dir);
          grp.add(new THREE.Mesh(g, metalMat));
        }
      }
    }
    grp.position.set(0, dir*(sp.h/2 - 2), z0);
    watch.add(grp);
  }
  scene.add(watch);
  updateLCD();
}

function updateLCD(){
  if (!started || !lcdTex) return;
  const sel = $('viewer-cell'), i = +sel.value || 0;
  window.CM.renderTexture(i, model, $('viewer-digits').checked, lcdCanvas);
  lcdTex.needsUpdate = true;
  const on = $('viewer-light').checked;
  lcdMat.emissive.set(on ? 0x6aa8ff : 0x000000);
  lcdMat.emissiveIntensity = on ? 0.55 : 0;
}

function fillCellSelect(){
  const sel = $('viewer-cell'), prev = sel.value;
  const idx = window.CM.filledIndices();
  sel.innerHTML = idx.length ? idx.map(i=>`<option value="${i}">Cell #${i+1}</option>`).join('') : '<option value="0">(empty — design a cell first)</option>';
  if ([...sel.options].some(o=>o.value===prev)) sel.value = prev;
}

function start(){
  if (started) { resize(); return; }
  started = true;
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.append(renderer.domElement);
  $('three-loading')?.remove();
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
  camera.position.set(25, -40, 95);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 35; controls.maxDistance = 250;
  controls.autoRotate = $('viewer-spin').checked; controls.autoRotateSpeed = 1.2;
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(30,40,80); scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.6));
  fillCellSelect(); build(); resize();
  new ResizeObserver(resize).observe(host);
  renderer.setAnimationLoop(()=>{ controls.update(); renderer.render(scene, camera); });
}
function resize(){
  if (!renderer) return;
  const w = host.clientWidth, h = host.clientHeight || 500;
  renderer.setSize(w,h); camera.aspect = w/h; camera.updateProjectionMatrix();
}

window.addEventListener('cm-view', e => { if (e.detail==='viewer'){ start(); fillCellSelect(); updateLCD(); } });
let last = 0;
window.addEventListener('cm-change', ()=>{ const t = performance.now(); if (t-last>250){ last=t; updateLCD(); } });
document.querySelectorAll('#viewer-model button').forEach(b=>b.onclick=()=>{
  model = b.dataset.vm;
  document.querySelectorAll('#viewer-model button').forEach(x=>x.classList.toggle('active',x===b));
  if (started) build();
});
['viewer-cell','viewer-digits','viewer-light'].forEach(id=>$(id).addEventListener('change', updateLCD));
$('viewer-spin').addEventListener('change', e=>{ if (controls) controls.autoRotate = e.target.checked; });
// default the viewer model to the sheet's model
if (window.CM?.state.model === 'A158'){ model='A158'; document.querySelectorAll('#viewer-model button').forEach(x=>x.classList.toggle('active',x.dataset.vm==='A158')); }
