/* Casio Modder — sheet editor, LCD renderer and real-size PDF export. */
(() => {
'use strict';

// ---------- constants ----------
const PAPERS = { A4:[210,297], Letter:[215.9,279.4], A5:[148,210], A3:[297,420], Legal:[215.9,355.6] };
// Approximate visible LCD window sizes (mm). Casio publishes no insert sizes — users can override.
const MODELS = {
  F91W: { w:21.0, h:11.0, note:'F-91W (module 593). 21 × 11 mm measured screen.' },
  A158: { w:23.5, h:12.5, note:'A158W / A168W. Approx. 23.5 × 12.5 mm, estimated from photos — measure yours and fine-tune.' },
  CUSTOM: { note:'Enter the exact size you measured with calipers.' },
};
const PRESETS = [
  ['#c7d3c0','#9fb39a'],['#ff9a8b','#ff6a88','#ff99ac'],['#00c6ff','#0072ff'],['#f6d365','#fda085'],
  ['#a1c4fd','#c2e9fb'],['#d4fc79','#96e6a1'],['#fbc2eb','#a6c1ee'],['#e0c3fc','#8ec5fc'],
  ['#fdfbfb','#ebedee'],['#1e50ff','#e60012'],['#43e97b','#38f9d7'],['#fa709a','#fee140'],
];
const STORE_KEY = 'casio-modder-v2';

// ---------- state ----------
const S = {
  paper:'A4', orient:'p', model:'F91W', cw:21, ch:11, margin:10, gap:4, bleed:0,
  cutlines:true, cropmarks:true, ruler:true, showDigits:true,
  segColor:'#1a1a1a', ghost:0.08,
  cells:[], images:{}, // images: id -> dataURL
};
let selected = new Set([0]);
let active = 0;
const imgCache = new Map();

const blankCell = () => ({ fill:'none', img:null, zoom:1, rot:0, ox:0, oy:0, flip:false, fit:'cover',
  bri:1, con:1, sat:1, gtype:'linear', gang:90, stops:[{c:'#c7d3c0',p:0},{c:'#8fa58a',p:1}], solid:'#c7d3c0' });

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
function getImage(id){
  if (!id || !S.images[id]) return null;
  let im = imgCache.get(id);
  if (!im){
    im = new Image();
    im.onload = () => { refreshAll(); };
    im.src = S.images[id];
    imgCache.set(id, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
function save(){
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch(e){ try { localStorage.setItem(STORE_KEY, JSON.stringify({...S, images:{}, cells:S.cells.map(c=>({...c,img:null,fill:c.fill==='image'?'none':c.fill}))})); } catch(_){} }
}
function load(){
  try { const d = JSON.parse(localStorage.getItem(STORE_KEY)||'null'); if (d) Object.assign(S, d); } catch(e){}
}

// ---------- geometry ----------
function pageSize(){
  const [a,b] = PAPERS[S.paper];
  return S.orient === 'p' ? [a,b] : [b,a];
}
function grid(){
  const [pw,ph] = pageSize();
  const m = S.margin, g = S.gap, b = S.bleed;
  const cw = S.cw + 2*b, ch = S.ch + 2*b;
  const cols = Math.max(0, Math.floor((pw - 2*m + g) / (cw + g)));
  const rows = Math.max(0, Math.floor((ph - 2*m - (S.ruler?8:0) + g) / (ch + g)));
  const usedW = cols*cw + (cols-1)*g, usedH = rows*ch + (rows-1)*g;
  const x0 = (pw - usedW)/2 + b, y0 = m + (ph - 2*m - (S.ruler?8:0) - usedH)/2 + b;
  const pos = [];
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++)
    pos.push({ x: x0 + c*(cw+g), y: y0 + r*(ch+g) });
  return { pw, ph, cols, rows, pos };
}

// ---------- LCD 7-segment rendering ----------
const SEG = { '0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgedc','7':'abc','8':'abcdefg','9':'abcdfg',
  'A':'abcefg','S':'afgcd','U':'bcdef','T':'fged','H':'bcefg','F':'aefg','M':'abcef','W':'bcdef','R':'eg','P':'abefg','O':'abcdef','E':'adefg',' ':'' };
function segPolys(w,h,t){
  const e = t/2, m = h/2;
  // each segment: polygon in local unit box (w × h), hexagonal ends
  const H = (x1,x2,y) => [[x1+e,y],[x1+t,y-e],[x2-t,y-e],[x2-e,y],[x2-t,y+e],[x1+t,y+e]];
  const V = (x,y1,y2) => [[x,y1+e],[x+e,y1+t],[x+e,y2-t],[x,y2-e],[x-e,y2-t],[x-e,y1+t]];
  return { a:H(e,w-e,e), g:H(e,w-e,m), d:H(e,w-e,h-e), f:V(e,e,m), b:V(w-e,e,m), e:V(e,m,h-e), c:V(w-e,m,h-e) };
}
function drawDigit(ctx,x,y,w,h,ch,color,ghost){
  const t = Math.max(1, w*0.26), skew = 0;
  const polys = segPolys(w,h,t*0.9);
  const on = SEG[ch] ?? '';
  ctx.save();
  ctx.translate(x + skew*h, y);
  ctx.transform(1,0,-skew,1,0,0);
  for (const k of 'abcdefg'){
    const lit = on.includes(k);
    if (!lit && ghost <= 0) continue;
    ctx.globalAlpha = lit ? 0.92 : ghost;
    ctx.fillStyle = color;
    ctx.beginPath();
    polys[k].forEach(([px,py],i)=> i?ctx.lineTo(px,py):ctx.moveTo(px,py));
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function drawText(ctx,str,x,y,w,h,color,ghost,gap=0.22){
  const n = str.length, dw = w/(n + (n-1)*gap);
  for (let i=0;i<n;i++) drawDigit(ctx, x + i*dw*(1+gap), y, dw, h, str[i], color, ghost);
}
function nowParts(){
  const d = new Date(), days=['SU','MO','TU','WE','TH','FR','SA'];
  let hh = d.getHours(); const pm = hh>=12; hh = hh%12 || 12;
  return { day:days[d.getDay()], date:String(d.getDate()).padStart(2,' '), hh:String(hh).padStart(2,' '),
    mm:String(d.getMinutes()).padStart(2,'0'), ss:String(d.getSeconds()).padStart(2,'0'), pm };
}
function drawLCD(ctx,W,H,model,color,ghost){
  const p = nowParts();
  const lbl = (txt,x,y,size) => { ctx.save(); ctx.globalAlpha=.9; ctx.fillStyle=color; ctx.font=`700 ${size}px Archivo, sans-serif`; ctx.fillText(txt,x,y); ctx.restore(); };
  // fractional layout of the LCD window, tuned to resemble each module
  const L = model === 'A158'
    ? { day:[.33,.08,.24,.27], date:[.69,.08,.24,.27], hm:[.07,.42,.68,.48], ss:[.79,.56,.15,.34], pm:[.07,.10] }
    : { day:[.34,.08,.22,.27], date:[.70,.08,.22,.27], hm:[.08,.42,.66,.49], ss:[.79,.57,.15,.34], pm:[.08,.10] };
  const R = a => [a[0]*W, a[1]*H, a[2]*W, a[3]*H];
  drawText(ctx, p.day, ...R(L.day), color, ghost);
  drawText(ctx, p.date, ...R(L.date), color, ghost);
  const [hx,hy,hw,hh] = R(L.hm);
  const half = hw*0.44;
  drawText(ctx, p.hh, hx, hy, half, hh, color, ghost);
  drawText(ctx, p.mm, hx+hw-half, hy, half, hh, color, ghost);
  // colon
  ctx.save(); ctx.fillStyle=color; ctx.globalAlpha=.92;
  const cx = hx + hw/2, r = Math.max(1,hh*0.065);
  ctx.fillRect(cx-r, hy+hh*0.28-r, 2*r, 2*r); ctx.fillRect(cx-r, hy+hh*0.70-r, 2*r, 2*r);
  ctx.restore();
  drawText(ctx, p.ss, ...R(L.ss), color, ghost);
  ctx.textBaseline='top';
  lbl(p.pm ? 'PM' : 'AM', L.pm[0]*W, L.pm[1]*H, Math.max(6,H*0.13));
}

// ---------- cell rendering ----------
/** Draws a cell fill into ctx over a W×H window; pad = extra bleed area in px on every side. */
function renderCell(cell, ctx, W, H, { digits=false, pad=0, model=S.model, segColor=S.segColor, ghost=S.ghost, empty=true } = {}){
  ctx.save();
  ctx.clearRect(0,0,W+2*pad,H+2*pad);
  ctx.translate(pad,pad);
  const fw = W+2*pad, fh = H+2*pad;
  if (cell.fill === 'solid'){
    ctx.fillStyle = cell.solid; ctx.fillRect(-pad,-pad,fw,fh);
  } else if (cell.fill === 'gradient'){
    let g;
    if (cell.gtype === 'radial'){
      g = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.hypot(W,H)/2);
    } else {
      const a = (cell.gang-90)*Math.PI/180, cx=W/2, cy=H/2;
      const L = (Math.abs(W*Math.cos(a)) + Math.abs(H*Math.sin(a)))/2;
      g = ctx.createLinearGradient(cx-Math.cos(a)*L, cy-Math.sin(a)*L, cx+Math.cos(a)*L, cy+Math.sin(a)*L);
    }
    [...cell.stops].sort((x,y)=>x.p-y.p).forEach(s=>g.addColorStop(Math.min(1,Math.max(0,s.p)), s.c));
    ctx.fillStyle = g; ctx.fillRect(-pad,-pad,fw,fh);
  } else if (cell.fill === 'image'){
    const im = getImage(cell.img);
    if (im){
      const base = cell.fit === 'contain'
        ? Math.min(W/im.naturalWidth, H/im.naturalHeight)
        : Math.max(W/im.naturalWidth, H/im.naturalHeight);
      const s = base*cell.zoom;
      ctx.save();
      ctx.filter = `brightness(${cell.bri}) contrast(${cell.con}) saturate(${cell.sat})`;
      ctx.translate(W/2 + cell.ox*W, H/2 + cell.oy*H);
      ctx.rotate(cell.rot*Math.PI/180);
      ctx.scale(cell.flip?-s:s, s);
      ctx.drawImage(im, -im.naturalWidth/2, -im.naturalHeight/2);
      ctx.restore();
    }
  } else if (empty){
    ctx.fillStyle = '#f3f3f3'; ctx.fillRect(0,0,W,H);
  }
  if (digits) drawLCD(ctx, W, H, model, segColor, ghost);
  ctx.restore();
}

// ---------- sheet DOM ----------
const paperEl = $('paper-el');
let pxPerMm = 3;
function buildSheet(){
  const G = grid();
  const n = G.pos.length;
  while (S.cells.length < n) S.cells.push(blankCell());
  const wrap = $('paper-wrap');
  pxPerMm = Math.max(1.5, Math.min(4, (wrap.clientWidth - 40) / G.pw));
  paperEl.style.width = G.pw*pxPerMm + 'px';
  paperEl.style.height = G.ph*pxPerMm + 'px';
  paperEl.innerHTML = '';
  const b = S.bleed;
  G.pos.forEach((p,i)=>{
    const d = document.createElement('div');
    d.className = 'cell'; d.dataset.i = i;
    Object.assign(d.style, { left:p.x*pxPerMm+'px', top:p.y*pxPerMm+'px', width:S.cw*pxPerMm+'px', height:S.ch*pxPerMm+'px' });
    const c = document.createElement('canvas');
    d.append(c);
    const idx = document.createElement('span'); idx.className='idx'; idx.textContent = i+1; d.append(idx);
    d.addEventListener('click', e => onCellClick(i, e));
    paperEl.append(d);
  });
  if (S.ruler){
    const r = document.createElement('div');
    Object.assign(r.style,{position:'absolute',left:(G.pw/2-25)*pxPerMm+'px',top:(G.ph-S.margin/2-2)*pxPerMm+'px',width:50*pxPerMm+'px',height:'0',borderTop:'1px solid #000'});
    paperEl.append(r);
  }
  [...selected].forEach(i=>{ if (i>=n) selected.delete(i); });
  if (active >= n) active = 0;
  if (!selected.size && n) selected.add(0);
  $('grid-stat').textContent = `${G.cols} × ${G.rows} = ${n} cells\npage ${G.pw.toFixed(1)} × ${G.ph.toFixed(1)} mm`;
  $('grid-stat').style.whiteSpace='pre';
  refreshAll();
}
function refreshCell(i){
  const d = paperEl.querySelector(`.cell[data-i="${i}"]`); if (!d) return;
  const c = d.querySelector('canvas');
  const dpr = Math.min(2, window.devicePixelRatio||1);
  const W = Math.round(S.cw*pxPerMm*dpr), H = Math.round(S.ch*pxPerMm*dpr);
  c.width = W; c.height = H;
  const cell = S.cells[i];
  renderCell(cell, c.getContext('2d'), W, H, { digits: S.showDigits && cell.fill!=='none' });
  d.classList.toggle('filled', cell.fill!=='none');
  d.classList.toggle('sel', selected.has(i));
  d.classList.toggle('active', i===active);
}
function refreshAll(){
  const n = paperEl.querySelectorAll('.cell').length;
  for (let i=0;i<n;i++) refreshCell(i);
  drawPreview();
  $('sel-count').textContent = selected.size > 1 ? `${selected.size} selected` : `#${active+1}`;
}
function onCellClick(i,e){
  if (e.shiftKey || e.ctrlKey || e.metaKey){
    if (selected.has(i) && selected.size>1) selected.delete(i); else selected.add(i);
  } else { selected = new Set([i]); }
  active = selected.has(i) ? i : [...selected][0];
  syncControls(); refreshAll();
}

// ---------- editor ----------
const pv = $('preview');
function drawPreview(){
  const W = 600, H = Math.round(600*S.ch/S.cw);
  if (pv.width!==W || pv.height!==H){ pv.width=W; pv.height=H; }
  const cell = S.cells[active]; if (!cell) return;
  renderCell(cell, pv.getContext('2d'), W, H, { digits: $('preview-digits').checked, empty:false });
}
function edit(fn){
  for (const i of selected){ fn(S.cells[i]); }
  refreshAll(); save();
}
function syncControls(){
  const c = S.cells[active]; if (!c) return;
  $('zoom').value=c.zoom; $('rot').value=c.rot; $('ox').value=c.ox; $('oy').value=c.oy;
  $('bri').value=c.bri; $('con').value=c.con; $('sat').value=c.sat;
  $('gang').value=c.gang; $('solid').value=c.solid;
  $('o-zoom').textContent = (+c.zoom).toFixed(2)+'×'; $('o-rot').textContent = c.rot+'°'; $('o-ang').textContent = c.gang+'°';
  const fill = c.fill==='none' ? (document.querySelector('#fill-seg .active')?.dataset.fill||'image') : c.fill;
  setSeg('fill-seg','fill',fill); showPane(fill);
  setSeg('gtype-seg','g',c.gtype);
  buildStops();
}
function setSeg(id,key,val){ document.querySelectorAll(`#${id} button`).forEach(b=>b.classList.toggle('active', b.dataset[key]===val)); }
function showPane(f){ document.querySelectorAll('.fill-pane').forEach(p=>p.classList.toggle('hidden', p.dataset.pane!==f)); }
function buildStops(){
  const c = S.cells[active], box = $('stops'); box.innerHTML='';
  c.stops.forEach((s,k)=>{
    const row = document.createElement('div'); row.className='stop';
    row.innerHTML = `<input type="color" value="${s.c}"><input type="range" min="0" max="1" step="0.01" value="${s.p}"><button title="Remove">✕</button>`;
    const [col,pos,del] = row.children;
    col.oninput = () => edit(x=>{ x.fill='gradient'; x.stops=clone(c.stops); x.stops[k].c=col.value; });
    pos.oninput = () => edit(x=>{ x.fill='gradient'; x.stops=clone(c.stops); x.stops[k].p=+pos.value; });
    del.onclick = () => { if (c.stops.length<=2) return; const st = c.stops.filter((_,j)=>j!==k); edit(x=>{x.fill='gradient'; x.stops=clone(st);}); buildStops(); };
    box.append(row);
  });
}
function bindRange(id, key, fmt){
  $(id).addEventListener('input', e => {
    const v = +e.target.value;
    if (fmt) $(fmt[0]).textContent = fmt[1](v);
    edit(c => { c[key]=v; if (['zoom','rot','ox','oy','bri','con','sat'].includes(key) && c.img) c.fill='image'; if (key==='gang') c.fill='gradient'; });
  });
}

// ---------- controls wiring ----------
function readLayoutInputs(){
  S.paper=$('paper').value; S.orient=$('orient').value;
  S.cw=+$('cw').value||S.cw; S.ch=+$('ch').value||S.ch;
  S.margin=+$('margin').value; S.gap=+$('gap').value; S.bleed=+$('bleed').value;
  S.cutlines=$('cutlines').checked; S.cropmarks=$('cropmarks').checked; S.ruler=$('ruler').checked;
  save(); buildSheet();
}
function applyModel(m){
  S.model = m; setSeg('model-seg','model',m);
  if (MODELS[m].w){ S.cw = MODELS[m].w; S.ch = MODELS[m].h; $('cw').value=S.cw; $('ch').value=S.ch; }
  $('cw').disabled = $('ch').disabled = false;
  $('model-note').textContent = MODELS[m].note;
  save(); buildSheet();
}
function init(){
  load();
  S.cells = S.cells.map(c=>({...blankCell(), ...c}));
  $('paper').value=S.paper; $('orient').value=S.orient; $('cw').value=S.cw; $('ch').value=S.ch;
  $('margin').value=S.margin; $('gap').value=S.gap; $('bleed').value=S.bleed;
  $('cutlines').checked=S.cutlines; $('cropmarks').checked=S.cropmarks; $('ruler').checked=S.ruler;
  $('show-digits').checked=S.showDigits; $('seg-color').value=S.segColor; $('ghost').value=S.ghost;
  setSeg('model-seg','model',S.model); $('model-note').textContent = MODELS[S.model].note;

  ['paper','orient','margin','gap','bleed','cutlines','cropmarks','ruler'].forEach(id=>$(id).addEventListener('change', readLayoutInputs));
  ['cw','ch'].forEach(id=>$(id).addEventListener('change', ()=>{ S.model='CUSTOM'; setSeg('model-seg','model','CUSTOM'); $('model-note').textContent=MODELS.CUSTOM.note; readLayoutInputs(); }));
  document.querySelectorAll('#model-seg button').forEach(b=>b.onclick=()=>applyModel(b.dataset.model));
  $('show-digits').onchange = e => { S.showDigits=e.target.checked; save(); refreshAll(); };
  $('preview-digits').onchange = drawPreview;
  $('seg-color').oninput = e => { S.segColor=e.target.value; save(); refreshAll(); };
  $('ghost').oninput = e => { S.ghost=+e.target.value; save(); refreshAll(); };

  document.querySelectorAll('#fill-seg button').forEach(b=>b.onclick=()=>{
    const f=b.dataset.fill; setSeg('fill-seg','fill',f); showPane(f);
    edit(c=>{ if (f!=='image' || c.img) c.fill=f; });
  });
  document.querySelectorAll('#gtype-seg button').forEach(b=>b.onclick=()=>{ setSeg('gtype-seg','g',b.dataset.g); edit(c=>{c.fill='gradient'; c.gtype=b.dataset.g;}); });

  bindRange('zoom','zoom',['o-zoom',v=>v.toFixed(2)+'×']);
  bindRange('rot','rot',['o-rot',v=>v+'°']);
  bindRange('ox','ox'); bindRange('oy','oy');
  bindRange('bri','bri'); bindRange('con','con'); bindRange('sat','sat');
  bindRange('gang','gang',['o-ang',v=>v+'°']);
  $('solid').oninput = e => edit(c=>{ c.fill='solid'; c.solid=e.target.value; });

  $('file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => downscale(rd.result).then(url => {
      const id = 'img'+Date.now().toString(36);
      S.images[id] = url;
      edit(c=>{ Object.assign(c,{fill:'image', img:id, zoom:1, rot:0, ox:0, oy:0, flip:false, fit:'cover'}); });
      syncControls(); gcImages();
    });
    rd.readAsDataURL(f); e.target.value='';
  };
  $('fit-cover').onclick = () => { edit(c=>{c.fit='cover'; c.zoom=1; c.ox=0; c.oy=0;}); syncControls(); };
  $('fit-contain').onclick = () => { edit(c=>{c.fit='contain'; c.zoom=1; c.ox=0; c.oy=0;}); syncControls(); };
  $('flip').onclick = () => edit(c=>{c.flip=!c.flip;});
  $('reset-img').onclick = () => { edit(c=>Object.assign(c,{zoom:1,rot:0,ox:0,oy:0,flip:false,fit:'cover',bri:1,con:1,sat:1})); syncControls(); };
  $('add-stop').onclick = () => { const st = clone(S.cells[active].stops); st.push({c:'#ffffff',p:1}); edit(c=>{c.fill='gradient'; c.stops=clone(st);}); buildStops(); };
  $('rand-grad').onclick = () => { const r=()=>'#'+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0');
    const st=[{c:r(),p:0},{c:r(),p:1}], ang=Math.floor(Math.random()*360); edit(c=>{c.fill='gradient'; c.stops=clone(st); c.gang=ang;}); syncControls(); };
  const pre = $('presets');
  PRESETS.forEach(cols=>{
    const b=document.createElement('button'); b.style.background=`linear-gradient(90deg,${cols.join(',')})`;
    b.onclick=()=>{ const st=cols.map((c,k)=>({c,p:k/(cols.length-1)})); edit(c=>{c.fill='gradient'; c.stops=clone(st);}); syncControls(); };
    pre.append(b);
  });

  $('copy-all').onclick = () => { const src=clone(S.cells[active]); S.cells = S.cells.map(()=>clone(src)); refreshAll(); save(); };
  $('fill-empty').onclick = () => { const src=clone(S.cells[active]); S.cells = S.cells.map(c=>c.fill==='none'?clone(src):c); refreshAll(); save(); };
  $('sel-all').onclick = () => { selected = new Set(S.cells.map((_,i)=>i).slice(0,paperEl.querySelectorAll('.cell').length)); refreshAll(); };
  $('sel-none').onclick = () => { selected = new Set([active]); refreshAll(); };
  $('clear-sel').onclick = () => { edit(c=>Object.assign(c, blankCell())); syncControls(); gcImages(); };
  $('export').onclick = exportPDF;

  // drag / wheel on preview
  let drag=null;
  pv.addEventListener('pointerdown', e=>{ drag={x:e.clientX,y:e.clientY,ox:S.cells[active].ox,oy:S.cells[active].oy}; pv.setPointerCapture(e.pointerId); });
  pv.addEventListener('pointermove', e=>{
    if (!drag) return; const r = pv.getBoundingClientRect();
    const dx=(e.clientX-drag.x)/r.width, dy=(e.clientY-drag.y)/r.height;
    edit(c=>{ c.ox = drag.ox+dx; c.oy = drag.oy+dy; });
    $('ox').value=S.cells[active].ox; $('oy').value=S.cells[active].oy;
  });
  pv.addEventListener('pointerup', ()=>drag=null);
  pv.addEventListener('wheel', e=>{
    e.preventDefault();
    const z = Math.min(6, Math.max(0.2, S.cells[active].zoom * (e.deltaY<0?1.06:1/1.06)));
    edit(c=>{ c.zoom=z; }); $('zoom').value=z; $('o-zoom').textContent=z.toFixed(2)+'×';
  }, {passive:false});

  // tabs
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+t.dataset.view));
  });
  window.addEventListener('resize', ()=>{ clearTimeout(init._r); init._r=setTimeout(buildSheet,150); });
  // keep digits ticking like a real watch
  setInterval(()=>{ if (S.showDigits || $('preview-digits').checked) refreshAll(); }, 1000);

  buildSheet(); syncControls();
}
/** Keep stored photos small enough for localStorage while staying sharp at print size. */
function downscale(url, max=1600){
  return new Promise(res=>{
    const im=new Image(); im.onload=()=>{
      const k=Math.min(1, max/Math.max(im.width,im.height));
      if (k===1) return res(url);
      const c=document.createElement('canvas'); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k);
      c.getContext('2d').drawImage(im,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',0.92));
    }; im.onerror=()=>res(url); im.src=url;
  });
}
function gcImages(){
  const used = new Set(S.cells.map(c=>c.img).filter(Boolean));
  Object.keys(S.images).forEach(k=>{ if(!used.has(k)){ delete S.images[k]; imgCache.delete(k);} });
  save();
}

// ---------- PDF export ----------
function exportPDF(){
  const { jsPDF } = window.jspdf;
  const G = grid();
  const filled = G.pos.map((p,i)=>({p,i,c:S.cells[i]})).filter(x=>x.c.fill!=='none');
  if (!filled.length){ alert('Add a photo, gradient or color to at least one cell first.'); return; }
  const doc = new jsPDF({ unit:'mm', format:[G.pw,G.ph], orientation: G.pw>G.ph?'l':'p', compress:true });
  const PX = 24; // px per mm ≈ 610 dpi
  const b = S.bleed;
  const cv = document.createElement('canvas');
  for (const {p,c} of filled){
    const W = Math.round(S.cw*PX), H = Math.round(S.ch*PX), pad = Math.round(b*PX);
    cv.width = W+2*pad; cv.height = H+2*pad;
    const ctx = cv.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
    renderCell(c, ctx, W, H, { pad, digits:false, empty:false });
    doc.addImage(cv.toDataURL('image/jpeg',0.95), 'JPEG', p.x-b, p.y-b, S.cw+2*b, S.ch+2*b, undefined, 'FAST');
  }
  doc.setDrawColor(120); doc.setLineWidth(0.08);
  for (const {p} of filled){
    if (S.cutlines) doc.rect(p.x, p.y, S.cw, S.ch);
    if (S.cropmarks){
      const off = b + 0.6, len = Math.max(0.6, Math.min(2.5, S.gap/2 - 0.3 + b));
      const xs=[p.x, p.x+S.cw], ys=[p.y, p.y+S.ch];
      doc.setDrawColor(0);
      for (const x of xs) for (const y of ys){
        const sx = x===xs[0]?-1:1, sy = y===ys[0]?-1:1;
        doc.line(x+sx*off, y, x+sx*(off+len), y);
        doc.line(x, y+sy*off, x, y+sy*(off+len));
      }
      doc.setDrawColor(120);
    }
  }
  if (S.ruler){
    const y = G.ph - S.margin/2 - 2, x = G.pw/2 - 25;
    doc.setDrawColor(0); doc.setLineWidth(0.2);
    doc.line(x,y,x+50,y);
    for (let k=0;k<=50;k+=1) doc.line(x+k, y, x+k, y-(k%10===0?3:k%5===0?2:1));
    doc.setFontSize(6); doc.setTextColor(60);
    doc.text(`50 mm calibration — print at 100% / Actual size · ${S.cw} × ${S.ch} mm cells · casio-modder`, G.pw/2, y+3, {align:'center'});
  }
  doc.save(`casio-mod-${S.model}-${S.paper}.pdf`);
}

document.addEventListener('DOMContentLoaded', init);
})();
