/**
 * DITHER.js — 180+ dithering, halftone, sketch, painterly & artistic algorithms
 * Every algorithm: apply(Float32Array pixels, w, h, params) → Uint8ClampedArray
 */

const DitherAlgorithms = (() => {
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function mkRand(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

  function errorDiffusion(px, w, h, matrix, strength, serpentine) {
    const out = new Uint8ClampedArray(w * h), buf = new Float32Array(px);
    for (let y = 0; y < h; y++) {
      const ltr = !serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x, old = clamp(buf[i]), nv = old > 128 ? 255 : 0;
        out[i] = nv;
        const err = (old - nv) * strength;
        for (const [mdx, mdy, mw] of matrix) {
          const nx = x + (ltr ? mdx : -mdx), ny = y + mdy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) buf[ny*w+nx] += err * mw;
        }
      }
    }
    return out;
  }

  function bayerMatrix(sz) {
    if (sz === 2) return [[0,2],[3,1]];
    const h2 = sz/2, s = bayerMatrix(h2), m = Array.from({length:sz}, ()=> new Array(sz));
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const q = (y < h2 ? 0 : 2) + (x < h2 ? 0 : 1);
      m[y][x] = 4 * s[y%h2][x%h2] + [0,2,3,1][q];
    }
    return m;
  }
  function normBayer(sz) { const m = bayerMatrix(sz), n = sz*sz; return m.map(r => r.map(v => (v+.5)/n)); }

  // Simple edge detection helper
  function sobelAt(px, x, y, w, h) {
    if (x < 1 || x >= w-1 || y < 1 || y >= h-1) return { mag: 0, ang: 0 };
    const gx = clamp(px[(y-1)*w+x+1]) + 2*clamp(px[y*w+x+1]) + clamp(px[(y+1)*w+x+1])
             - clamp(px[(y-1)*w+x-1]) - 2*clamp(px[y*w+x-1]) - clamp(px[(y+1)*w+x-1]);
    const gy = clamp(px[(y+1)*w+x-1]) + 2*clamp(px[(y+1)*w+x]) + clamp(px[(y+1)*w+x+1])
             - clamp(px[(y-1)*w+x-1]) - 2*clamp(px[(y-1)*w+x]) - clamp(px[(y-1)*w+x+1]);
    return { mag: Math.sqrt(gx*gx + gy*gy), ang: Math.atan2(gy, gx) };
  }

  const A = [];

  function addED(id, name, matrix, cat='classic') {
    A.push({ id, name, category: cat, params: [
      { id:'strength', label:'Diffusion', min:0, max:1, step:.01, default:1 },
      { id:'serpentine', label:'Serpentine', type:'checkbox', default: id==='floyd-steinberg' }
    ], apply(px,w,h,p) { return errorDiffusion(px,w,h,matrix,p.strength,p.serpentine); }});
  }

  // ═══════════════════════════════════════════
  // CLASSIC ERROR DIFFUSION (10)
  // ═══════════════════════════════════════════
  addED('floyd-steinberg','Floyd-Steinberg',[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]]);
  addED('atkinson','Atkinson',(()=>{ const f=1/8; return [[1,0,f],[2,0,f],[-1,1,f],[0,1,f],[1,1,f],[0,2,f]]; })());
  addED('jarvis','Jarvis-Judice-Ninke',(()=>{ const d=48; return [[1,0,7/d],[2,0,5/d],[-2,1,3/d],[-1,1,5/d],[0,1,7/d],[1,1,5/d],[2,1,3/d],[-2,2,1/d],[-1,2,3/d],[0,2,5/d],[1,2,3/d],[2,2,1/d]]; })());
  addED('stucki','Stucki',(()=>{ const d=42; return [[1,0,8/d],[2,0,4/d],[-2,1,2/d],[-1,1,4/d],[0,1,8/d],[1,1,4/d],[2,1,2/d],[-2,2,1/d],[-1,2,2/d],[0,2,4/d],[1,2,2/d],[2,2,1/d]]; })());
  addED('burkes','Burkes',(()=>{ const d=32; return [[1,0,8/d],[2,0,4/d],[-2,1,2/d],[-1,1,4/d],[0,1,8/d],[1,1,4/d],[2,1,2/d]]; })());
  addED('sierra','Sierra',(()=>{ const d=32; return [[1,0,5/d],[2,0,3/d],[-2,1,2/d],[-1,1,4/d],[0,1,5/d],[1,1,4/d],[2,1,2/d],[-1,2,2/d],[0,2,3/d],[1,2,2/d]]; })());
  addED('sierra-lite','Sierra Lite',[[1,0,.5],[-1,1,.25],[0,1,.25]]);
  addED('stevenson-arce','Stevenson-Arce',(()=>{ const d=200; return [[2,0,32/d],[-3,1,12/d],[-1,1,26/d],[1,1,30/d],[3,1,16/d],[-2,2,12/d],[0,2,26/d],[2,2,12/d],[-3,3,5/d],[-1,3,12/d],[1,3,12/d],[3,3,5/d]]; })());
  addED('fan','Zhigang Fan',[[1,0,7/16],[2,0,1/16],[-1,1,3/16],[0,1,5/16]]);
  addED('shiau-fan','Shiau-Fan',[[1,0,4/8],[-3,1,1/8],[-1,1,1/8],[0,1,2/8]]);

  // ═══════════════════════════════════════════
  // ORDERED & PATTERN (12)
  // ═══════════════════════════════════════════
  A.push({ id:'ordered', name:'Ordered (Bayer)', category:'ordered', params:[
    {id:'size',label:'Matrix',type:'select',options:[{value:2,label:'2x2'},{value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'}],default:4},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128}
  ], apply(px,w,h,p) {
    const sz=+p.size, b=normBayer(sz), sp=p.spread, o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const i=y*w+x; o[i]=(clamp(px[i])+(b[y%sz][x%sz]-.5)*sp)>128?255:0; }
    return o;
  }});

  A.push({ id:'clustered-dot', name:'Clustered Dot', category:'ordered', params:[
    {id:'size',label:'Cluster Size',min:3,max:12,step:1,default:6},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128}
  ], apply(px,w,h,p) {
    const sz=p.size, o=new Uint8ClampedArray(w*h);
    // Build clustered dot threshold matrix
    const mat=Array.from({length:sz},()=>new Array(sz));
    const cx=sz/2,cy=sz/2;
    const indices=[];
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++) indices.push({x,y,d:Math.sqrt((x-cx+.5)**2+(y-cy+.5)**2)});
    indices.sort((a,b)=>a.d-b.d);
    for(let i=0;i<indices.length;i++) mat[indices[i].y][indices[i].x]=(i+.5)/(sz*sz);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x; o[i]=(clamp(px[i])+(mat[y%sz][x%sz]-.5)*p.spread)>128?255:0;
    }
    return o;
  }});

  A.push({ id:'blue-noise', name:'Blue Noise', category:'ordered', params:[
    {id:'scale',label:'Scale',min:1,max:8,step:1,default:2},
    {id:'strength',label:'Strength',min:0,max:255,step:1,default:128}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),sc=p.scale;
    // Generate pseudo blue-noise via golden ratio hash
    const phi = 1.618033988749895;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const sx=Math.floor(x/sc),sy=Math.floor(y/sc);
      let bn=(sx*phi+sy*phi*phi)%1;
      bn=((bn*2654435761)>>>0)/4294967296;
      const i=y*w+x;
      o[i]=(clamp(px[i])+(bn-.5)*p.strength)>128?255:0;
    }
    return o;
  }});

  A.push({ id:'void-cluster', name:'Void & Cluster', category:'ordered', params:[
    {id:'size',label:'Pattern Size',min:4,max:16,step:4,default:8},
    {id:'spread',label:'Spread',min:32,max:255,step:1,default:160}
  ], apply(px,w,h,p) {
    const sz=p.size, o=new Uint8ClampedArray(w*h);
    // Approximation of void-and-cluster noise
    const mat=Array.from({length:sz},(_,y)=>Array.from({length:sz},(_,x)=>{
      let v=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const ny=((y+dy)%sz+sz)%sz,nx=((x+dx)%sz+sz)%sz;
        v+=Math.sin(nx*2.39996+ny*7.11)*0.5+0.5;}
      return v;
    }));
    // Normalize
    let min=Infinity,max=-Infinity;
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++){if(mat[y][x]<min)min=mat[y][x];if(mat[y][x]>max)max=mat[y][x];}
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++) mat[y][x]=(mat[y][x]-min)/(max-min);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x; o[i]=(clamp(px[i])+(mat[y%sz][x%sz]-.5)*p.spread)>128?255:0;
    }
    return o;
  }});

  A.push({ id:'checkerboard', name:'Checkerboard', category:'ordered', params:[
    {id:'size',label:'Cell Size',min:1,max:16,step:1,default:2},
    {id:'bias',label:'Threshold Bias',min:-128,max:128,step:1,default:0}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),sz=p.size;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const checker=(Math.floor(x/sz)+Math.floor(y/sz))%2;
      o[i]=clamp(px[i])>(128+p.bias+checker*40-20)?255:0;
    }
    return o;
  }});

  A.push({ id:'threshold-map', name:'Threshold Map', category:'ordered', params:[
    {id:'mapType',label:'Map',type:'select',options:[{value:'perlin',label:'Perlin-like'},{value:'worley',label:'Worley'},{value:'fbm',label:'FBM'}],default:'perlin'},
    {id:'scale',label:'Scale',min:.005,max:.1,step:.005,default:.02},
    {id:'contrast',label:'Contrast',min:.1,max:3,step:.1,default:1}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),sc=p.scale;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let threshold;
      if(p.mapType==='perlin'){threshold=(Math.sin(x*sc*6.28)*Math.cos(y*sc*6.28)+Math.sin((x+y)*sc*3.14)*.5+1.5)/3;}
      else if(p.mapType==='worley'){
        const gx=Math.floor(x*sc*2),gy=Math.floor(y*sc*2);
        let minD=1e9;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const cx2=(gx+dx+.5+Math.sin((gx+dx)*12.9898+(gy+dy)*78.233)*.5)/sc/2;
          const cy2=(gy+dy+.5+Math.sin((gy+dy)*12.9898+(gx+dx)*78.233)*.5)/sc/2;
          const d=Math.sqrt((x-cx2)**2+(y-cy2)**2)*sc;if(d<minD)minD=d;}
        threshold=Math.min(1,minD*2);}
      else{let n=0,amp=1,freq=1,ma=0;for(let oc=0;oc<4;oc++){
        n+=(Math.sin(x*sc*freq*6.28)*Math.cos(y*sc*freq*4.17)+1)/2*amp;ma+=amp;amp*=.5;freq*=2;}
        threshold=n/ma;}
      threshold=.5+(threshold-.5)*p.contrast;
      o[y*w+x]=clamp(px[y*w+x])/255>threshold?255:0;
    }return o;
  }});

  A.push({ id:'truchet', name:'Truchet Tiles', category:'ordered', params:[
    {id:'tileSize',label:'Tile Size',min:4,max:24,step:2,default:10},
    {id:'style',label:'Style',type:'select',options:[{value:'arc',label:'Quarter Arcs'},{value:'triangle',label:'Triangles'},{value:'maze',label:'Maze'}],default:'arc'},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed),ts=p.tileSize;
    for(let ty=0;ty<h;ty+=ts)for(let tx=0;tx<w;tx+=ts){
      const midX=Math.min(w-1,tx+ts/2),midY=Math.min(h-1,ty+ts/2);
      const v=clamp(px[midY*w+midX])/255;const flip=v<.5;
      for(let dy=0;dy<ts&&ty+dy<h;dy++)for(let dx=0;dx<ts&&tx+dx<w;dx++){
        const nx=dx/ts,ny=dy/ts;let inside=false;
        if(p.style==='arc'){
          if(flip){const d1=Math.sqrt(nx*nx+ny*ny),d2=Math.sqrt((1-nx)**2+(1-ny)**2);inside=d1<.5||d2<.5;}
          else{const d1=Math.sqrt((1-nx)**2+ny*ny),d2=Math.sqrt(nx*nx+(1-ny)**2);inside=d1<.5||d2<.5;}
        }else if(p.style==='triangle'){inside=flip?nx+ny<1:nx+ny>1;}
        else{inside=flip?(dx<ts/2)===(dy<ts/2):(dx<ts/2)!==(dy<ts/2);}
        if(inside&&v<.7)o[(ty+dy)*w+tx+dx]=0;
      }}return o;
  }});

  // ═══════════════════════════════════════════
  // HALFTONE & SCREEN (8)
  // ═══════════════════════════════════════════
  A.push({ id:'halftone', name:'Halftone', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:30,step:1,default:6},
    {id:'angle',label:'Angle',min:0,max:180,step:1,default:45},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'line',label:'Line'},{value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'ring',label:'Ring'},{value:'ellipse',label:'Ellipse'}],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:0}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h), ds=p.dotSize, ang=p.angle*Math.PI/180;
    const cos=Math.cos(ang), sin=Math.sin(ang), soft=p.softness;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const rx=x*cos+y*sin, ry=-x*sin+y*cos;
      const cx=((rx%ds)+ds)%ds, cy=((ry%ds)+ds)%ds;
      const nx=(cx/ds-.5)*2, ny=(cy/ds-.5)*2;
      let d;
      if(p.shape==='circle') d=Math.sqrt(nx*nx+ny*ny);
      else if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='line') d=Math.abs(ny);
      else if(p.shape==='cross') d=Math.min(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='ring') d=Math.abs(Math.sqrt(nx*nx+ny*ny)-.5)*2;
      else if(p.shape==='ellipse') d=Math.sqrt(nx*nx*1.5+ny*ny*0.7);
      else d=Math.max(Math.abs(nx),Math.abs(ny))*(0.5+0.5*Math.cos(Math.atan2(ny,nx)*4));
      const val=clamp(px[y*w+x])/255, t=(1-val)*1.42;
      if(soft>0){ const s2=d-t; o[y*w+x]=clamp(128-s2/soft*128); }
      else o[y*w+x]=d<t?255:0;
    }
    return o;
  }});

  A.push({ id:'cmyk-halftone', name:'CMYK Halftone', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:20,step:1,default:6},
    {id:'cAngle',label:'C Angle',min:0,max:90,step:5,default:15},
    {id:'mAngle',label:'M Angle',min:0,max:90,step:5,default:75},
    {id:'yAngle',label:'Y Angle',min:0,max:90,step:5,default:0},
    {id:'kAngle',label:'K Angle',min:0,max:90,step:5,default:45},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    // For grayscale, simulate K plate only
    const ang=p.kAngle*Math.PI/180;
    const cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      const d=Math.sqrt(nx*nx+ny*ny);
      const val=clamp(px[y*w+x])/255,t=(1-val)*1.42;
      if(p.softness>0){const s2=d-t;o[y*w+x]=clamp(128-s2/p.softness*128);}
      else o[y*w+x]=d<t?0:255;
    }
    return o;
  }});

  A.push({ id:'stochastic-screen', name:'Stochastic Screen', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:1,max:8,step:1,default:2},
    {id:'regularity',label:'Regularity',min:0,max:1,step:.05,default:.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ds=p.dotSize;
    for(let y=0;y<h;y+=ds)for(let x=0;x<w;x+=ds){
      const v=clamp(px[y*w+x])/255;
      const jx=(r()-.5)*(1-p.regularity)*ds*2;
      const jy=(r()-.5)*(1-p.regularity)*ds*2;
      const dotR=ds*(1-v)*0.7+0.5;
      for(let dy=-ds;dy<=ds*2;dy++)for(let dx=-ds;dx<=ds*2;dx++){
        const fx=x+dx+Math.round(jx),fy=y+dy+Math.round(jy);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const dist=Math.sqrt((dx-ds/2)**2+(dy-ds/2)**2);
          if(dist<dotR) o[fy*w+fx]=0;
          else if(o[fy*w+fx]===0);
          else o[fy*w+fx]=255;
        }
      }
    }
    return o;
  }});

  A.push({ id:'am-halftone', name:'AM Halftone', category:'halftone', params:[
    {id:'lpi',label:'Lines/Inch',min:2,max:20,step:1,default:8},
    {id:'angle',label:'Screen Angle',min:0,max:90,step:5,default:45},
    {id:'gain',label:'Dot Gain',min:0,max:1,step:.05,default:.2}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),cell=Math.max(2,Math.round(w/p.lpi/6));
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%cell)+cell)%cell,cy2=((ry%cell)+cell)%cell;
      const nx=(cx2/cell-.5)*2,ny=(cy2/cell-.5)*2;
      const d=Math.sqrt(nx*nx+ny*ny);
      const val=clamp(px[y*w+x])/255;
      const t=(1-val)*(1+p.gain)*1.2;
      o[y*w+x]=d<t?0:255;
    }
    return o;
  }});

  A.push({ id:'fm-halftone', name:'FM Halftone', category:'halftone', params:[
    {id:'minDot',label:'Min Dot',min:1,max:4,step:1,default:1},
    {id:'maxDot',label:'Max Dot',min:2,max:8,step:1,default:4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const step=p.maxDot;
    for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
      const v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
      if(v>0.95)continue;
      const dotR=p.minDot+(p.maxDot-p.minDot)*(1-v);
      const cx2=x+Math.floor(r()*step*.5),cy2=y+Math.floor(r()*step*.5);
      for(let dy=-p.maxDot;dy<=p.maxDot;dy++)for(let dx=-p.maxDot;dx<=p.maxDot;dx++){
        const fx=cx2+dx,fy=cy2+dy;
        if(fx>=0&&fx<w&&fy>=0&&fy<h&&Math.sqrt(dx*dx+dy*dy)<=dotR)o[fy*w+fx]=0;
      }
    }
    return o;
  }});

  A.push({ id:'mezzotint', name:'Mezzotint', category:'halftone', params:[
    {id:'style',label:'Style',type:'select',options:[{value:'fine',label:'Fine'},{value:'medium',label:'Medium'},{value:'coarse',label:'Coarse'},{value:'worm',label:'Worm'},{value:'stroke',label:'Stroke'}],default:'medium'},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const sizes={fine:1,medium:2,coarse:4,worm:2,stroke:3};
    const sz=sizes[p.style]||2;
    if(p.style==='worm'||p.style==='stroke'){
      o.fill(255);
      const count=w*h/(sz*sz)*0.8;
      for(let i=0;i<count;i++){
        let cx2=r()*w,cy2=r()*h;
        const sv=clamp(px[Math.min(h-1,Math.round(cy2))*w+Math.min(w-1,Math.round(cx2))])/255;
        if(r()<sv)continue;
        const len=p.style==='worm'?Math.round(3+r()*8):Math.round(2+r()*5);
        const ang2=r()*Math.PI;
        for(let t=0;t<len;t++){
          const fx=Math.round(cx2),fy=Math.round(cy2);
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;
          cx2+=Math.cos(ang2)*(p.style==='worm'?1+r():1.5);
          cy2+=Math.sin(ang2)*(p.style==='worm'?1+r():1.5);
        }
      }
    } else {
      for(let y=0;y<h;y+=sz)for(let x=0;x<w;x+=sz){
        const v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
        const ink=r()>v?0:255;
        for(let dy=0;dy<sz&&y+dy<h;dy++)for(let dx=0;dx<sz&&x+dx<w;dx++)
          o[(y+dy)*w+x+dx]=ink;
      }
    }
    return o;
  }});

  A.push({ id:'newsprint', name:'Newsprint', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:16,step:1,default:6},
    {id:'angle',label:'Angle',min:0,max:90,step:5,default:45},
    {id:'paperTone',label:'Paper Tone',min:200,max:255,step:1,default:240},
    {id:'inkDensity',label:'Ink Density',min:.5,max:1,step:.05,default:.85}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      const d=Math.sqrt(nx*nx+ny*ny);
      const val=clamp(px[y*w+x])/255;
      const t=(1-val)*p.inkDensity*1.42;
      o[y*w+x]=d<t?clamp(val*40):p.paperTone;
    }
    return o;
  }});

  A.push({ id:'rosette', name:'Rosette Pattern', category:'halftone', params:[
    {id:'dotSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'petals',label:'Petals',min:3,max:8,step:1,default:6},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.2}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const cx2=((x%ds)+ds)%ds,cy2=((y%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      const ang2=Math.atan2(ny,nx);
      const r2=Math.sqrt(nx*nx+ny*ny);
      const petal=0.5+0.5*Math.cos(ang2*p.petals);
      const d=r2*(1-petal*0.3);
      const val=clamp(px[y*w+x])/255,t=(1-val)*1.3;
      if(p.softness>0){const s2=d-t;o[y*w+x]=clamp(128-s2/p.softness*128);}
      else o[y*w+x]=d<t?0:255;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // LINES & HATCHING (15)
  // ═══════════════════════════════════════════
  A.push({ id:'horizontal-lines', name:'Horizontal Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:4},
    {id:'thickness',label:'Thickness',min:1,max:10,step:1,default:2}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const v=clamp(px[y*w+x])/255; const linePhase=y%p.spacing; o[y*w+x]=linePhase<p.thickness&&v<(1-linePhase/p.spacing)?0:255; }
    return o;
  }});

  A.push({ id:'vertical-lines', name:'Vertical Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:4},
    {id:'thickness',label:'Thickness',min:1,max:10,step:1,default:2}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const v=clamp(px[y*w+x])/255; const linePhase=x%p.spacing; o[y*w+x]=linePhase<p.thickness&&v<(1-linePhase/p.spacing)?0:255; }
    return o;
  }});

  A.push({ id:'diagonal-lines', name:'Diagonal Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:5},
    {id:'angle',label:'Angle',min:0,max:180,step:5,default:45},
    {id:'thickness',label:'Thickness',min:1,max:8,step:1,default:2}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h), ang=p.angle*Math.PI/180;
    const cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const proj=Math.abs((x*cos+y*sin)%p.spacing);
      const v=clamp(px[y*w+x])/255;
      const lineWidth=p.thickness*(1-v);
      o[y*w+x]=proj<lineWidth?0:255;
    }
    return o;
  }});

  A.push({ id:'crosshatch', name:'Crosshatch', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:20,step:1,default:6},
    {id:'layers',label:'Layers',min:1,max:4,step:1,default:3},
    {id:'angle',label:'Base Angle',min:0,max:90,step:5,default:45}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h); o.fill(255);
    const angles=[p.angle,p.angle+90,p.angle+45,p.angle+135];
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const v=clamp(px[y*w+x])/255;
      const layersNeeded=Math.ceil((1-v)*p.layers);
      for(let l=0;l<layersNeeded;l++){
        const a=angles[l%4]*Math.PI/180;
        const proj=Math.abs((x*Math.cos(a)+y*Math.sin(a))%p.spacing);
        const thresh=0.4+(l*0.15);
        if(proj<1.5&&v<thresh) { o[y*w+x]=0; break; }
      }
    }
    return o;
  }});

  A.push({ id:'crosshatch-variable', name:'Variable Crosshatch', category:'lines', params:[
    {id:'layers',label:'Max Layers',min:1,max:6,step:1,default:3},
    {id:'baseSpacing',label:'Base Spacing',min:3,max:15,step:1,default:5},
    {id:'baseAngle',label:'Base Angle',min:0,max:90,step:5,default:45},
    {id:'angleStep',label:'Angle Step',min:20,max:90,step:5,default:60},
    {id:'densityResponse',label:'Density Response',min:.2,max:2,step:.1,default:.8},
    {id:'lineWeight',label:'Line Weight',min:.5,max:3,step:.1,default:1.2},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      const layersNeeded=Math.ceil((1-v)**p.densityResponse*p.layers);
      for(let l=0;l<layersNeeded;l++){
        const ang=(p.baseAngle+l*p.angleStep)*Math.PI/180;
        const spacing=p.baseSpacing*(1+l*0.3);
        const proj=Math.abs((x*Math.cos(ang)+y*Math.sin(ang))%spacing);
        if(proj<p.lineWeight){o[y*w+x]=0;break;}
      }
    }
    return o;
  }});

  A.push({ id:'contour-hatch', name:'Contour Hatching', category:'lines', params:[
    {id:'spacing',label:'Line Spacing',min:3,max:15,step:1,default:5},
    {id:'thickness',label:'Line Width',min:.5,max:3,step:.25,default:1},
    {id:'curvature',label:'Curvature',min:0,max:1,step:.05,default:.6}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      if(v>.92)continue;
      // Use gradient direction for contour-following
      const e=sobelAt(px,x,y,w,h);
      // Hatch perpendicular to gradient (along contour)
      const hatchAng=e.ang+Math.PI/2;
      const proj=Math.abs((x*Math.cos(hatchAng)+y*Math.sin(hatchAng))%p.spacing);
      const lineW=p.thickness*(1-v*0.5);
      if(proj<lineW) o[y*w+x]=0;
    }
    return o;
  }});

  A.push({ id:'engraving', name:'Engraving Lines', category:'lines', params:[
    {id:'lineSpacing',label:'Line Spacing',min:2,max:10,step:1,default:3},
    {id:'angle',label:'Angle',min:0,max:180,step:5,default:45},
    {id:'thickness',label:'Swell',min:.5,max:4,step:.25,default:1.5},
    {id:'curvature',label:'Curvature',min:0,max:1,step:.05,default:.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      // Perpendicular distance to line
      const proj=(x*cos+y*sin);
      const lineIdx=Math.round(proj/p.lineSpacing);
      const distToLine=Math.abs(proj-lineIdx*p.lineSpacing);
      // Line swell based on darkness
      const swell=p.thickness*(1-v);
      // Curvature: modulate based on local value
      const curveOffset=p.curvature*(v-.5)*p.lineSpacing*0.5;
      const adjustedDist=Math.abs(proj+curveOffset-lineIdx*p.lineSpacing);
      if(adjustedDist<swell) o[y*w+x]=0;
    }
    return o;
  }});

  A.push({ id:'stipple', name:'Stipple', category:'lines', params:[
    {id:'density',label:'Density',min:500,max:20000,step:500,default:8000},
    {id:'dotSize',label:'Dot Size',min:1,max:4,step:1,default:1},
    {id:'regularity',label:'Regularity',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.density;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      const v=clamp(px[y*w+x])/255;
      if(r()<v)continue; // more dots in dark areas
      // Regularity: push toward grid
      const gx=p.regularity>0?Math.round(x/(p.dotSize*3))*(p.dotSize*3):x;
      const gy=p.regularity>0?Math.round(y/(p.dotSize*3))*(p.dotSize*3):y;
      const fx=Math.round(x*(1-p.regularity)+gx*p.regularity);
      const fy=Math.round(y*(1-p.regularity)+gy*p.regularity);
      for(let dy=-p.dotSize+1;dy<p.dotSize;dy++)for(let dx=-p.dotSize+1;dx<p.dotSize;dx++){
        if(dx*dx+dy*dy<p.dotSize*p.dotSize){
          const px2=fx+dx,py2=fy+dy;
          if(px2>=0&&px2<w&&py2>=0&&py2<h) o[py2*w+px2]=0;
        }
      }
    }
    return o;
  }});

  A.push({ id:'wave-lines', name:'Wave Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:20,step:1,default:6},
    {id:'amplitude',label:'Amplitude',min:0,max:10,step:.5,default:3},
    {id:'frequency',label:'Frequency',min:.01,max:.2,step:.01,default:.05}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      const wave=Math.sin(x*p.frequency)*p.amplitude*(1-v);
      const proj=(y+wave)%p.spacing;
      const lineW=1.5*(1-v);
      if(Math.abs(proj)<lineW||Math.abs(proj-p.spacing)<lineW) o[y*w+x]=0;
    }
    return o;
  }});

  A.push({ id:'concentric-lines', name:'Concentric Lines', category:'lines', params:[
    {id:'spacing',label:'Ring Spacing',min:3,max:20,step:1,default:6},
    {id:'centerX',label:'Center X',min:0,max:1,step:.05,default:.5},
    {id:'centerY',label:'Center Y',min:0,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    const cx2=w*p.centerX,cy2=h*p.centerY;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      const ring=dist%p.spacing;
      const lineW=1.5*(1-v);
      if(ring<lineW) o[y*w+x]=0;
    }
    return o;
  }});

  A.push({ id:'spiral-lines', name:'Spiral Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:15,step:1,default:5},
    {id:'tightness',label:'Tightness',min:.5,max:3,step:.1,default:1},
    {id:'centerX',label:'Center X',min:0,max:1,step:.05,default:.5},
    {id:'centerY',label:'Center Y',min:0,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    const cx2=w*p.centerX,cy2=h*p.centerY;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      const ang2=Math.atan2(y-cy2,x-cx2);
      const spiral=(dist-ang2/(2*Math.PI)*p.spacing*p.tightness)%p.spacing;
      const lineW=1.2*(1-v);
      if(Math.abs(spiral)<lineW||Math.abs(spiral-p.spacing)<lineW) o[y*w+x]=0;
    }
    return o;
  }});

  A.push({ id:'woodcut', name:'Woodcut', category:'lines', params:[
    {id:'lineWidth',label:'Line Width',min:1,max:6,step:1,default:3},
    {id:'contrast',label:'Contrast',min:.5,max:3,step:.1,default:1.5},
    {id:'angle',label:'Grain Angle',min:0,max:180,step:5,default:30},
    {id:'variation',label:'Variation',min:0,max:1,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255;
      v=Math.pow(v,1/p.contrast); // boost contrast
      const proj=x*cos+y*sin;
      const wobble=Math.sin(proj*0.1+r()*p.variation*10)*p.variation*2;
      const linePhase=(proj+wobble)%(p.lineWidth*2);
      const cutWidth=p.lineWidth*(1-v)*1.5;
      if(linePhase<cutWidth&&v<0.75) o[y*w+x]=0;
    }
    return o;
  }});

  A.push({ id:'linocut', name:'Linocut', category:'lines', params:[
    {id:'blockSize',label:'Block Size',min:2,max:10,step:1,default:4},
    {id:'cutDepth',label:'Cut Depth',min:.3,max:1,step:.05,default:.6},
    {id:'texture',label:'Texture',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);const r=mkRand(p.seed),bs=p.blockSize;
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
      const v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
      const cut=v>p.cutDepth;
      for(let dy=0;dy<bs&&y+dy<h;dy++)for(let dx=0;dx<bs&&x+dx<w;dx++){
        if(cut){
          o[(y+dy)*w+x+dx]=255; // cut away (white)
        }else{
          // Ink with texture
          const tex=r()<p.texture?255:0;
          o[(y+dy)*w+x+dx]=tex;
        }
      }
    }
    return o;
  }});

  A.push({ id:'etching', name:'Etching', category:'lines', params:[
    {id:'lineSpacing',label:'Line Spacing',min:2,max:8,step:1,default:3},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:75},
    {id:'depth',label:'Depth',min:.3,max:1,step:.05,default:.7},
    {id:'irregularity',label:'Irregularity',min:0,max:1,step:.05,default:.2},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const a1=45*Math.PI/180,a2=(45+p.crossAngle)*Math.PI/180;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      if(v>p.depth)continue;
      const wobble=(r()-.5)*p.irregularity*2;
      // Primary lines
      const p1=Math.abs((x*Math.cos(a1)+y*Math.sin(a1)+wobble)%p.lineSpacing);
      if(p1<1){o[y*w+x]=0;continue;}
      // Cross lines for darker values
      if(v<p.depth*0.6){
        const p2=Math.abs((x*Math.cos(a2)+y*Math.sin(a2)+wobble)%p.lineSpacing);
        if(p2<0.8)o[y*w+x]=0;
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ARTISTIC & PAINTERLY (12)
  // ═══════════════════════════════════════════
  A.push({ id:'overshot-sketch', name:'Overshot Sketch', category:'artistic', params:[
    {id:'lineCount',label:'Lines',min:500,max:8000,step:500,default:3000},
    {id:'overshoot',label:'Overshoot',min:0,max:1,step:.05,default:.4},
    {id:'wobble',label:'Wobble',min:0,max:1,step:.05,default:.3},
    {id:'thickness',label:'Thickness',min:1,max:3,step:1,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      const v=clamp(px[y*w+x])/255;
      if(r()>1-v+.08)continue;
      let ang=r()*Math.PI;
      if(x>2&&x<w-3&&y>2&&y<h-3){
        const gx=clamp(px[y*w+x+1])-clamp(px[y*w+x-1]);
        const gy=clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]);
        ang=Math.atan2(gx,-gy)+r()*.4;}
      const baseLen=(1-v)*15+5;
      const ovLen=baseLen*(1+p.overshoot*(r()*.5+.5));
      const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-ovLen/2;t<ovLen/2;t++){
        const wobbleX=(r()-.5)*p.wobble*2,wobbleY=(r()-.5)*p.wobble*2;
        for(let ww=0;ww<p.thickness;ww++){
          const fx=Math.round(x+dx*t+wobbleX-dy*ww),fy=Math.round(y+dy*t+wobbleY+dx*ww);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const edgeFade=Math.abs(t)/(ovLen/2);
            if(edgeFade<.85||r()>.3)o[fy*w+fx]=Math.min(o[fy*w+fx],edgeFade>.7?128:0);
          }}}
    }return o;
  }});

  A.push({ id:'gesture-drawing', name:'Gesture Drawing', category:'artistic', params:[
    {id:'strokes',label:'Strokes',min:200,max:5000,step:200,default:1500},
    {id:'strokeLen',label:'Stroke Length',min:10,max:80,step:5,default:30},
    {id:'speed',label:'Speed/Looseness',min:0,max:1,step:.05,default:.6},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let s=0;s<p.strokes;s++){
      let cx2=r()*w,cy2=r()*h;
      const sv=clamp(px[Math.min(h-1,Math.round(cy2))*w+Math.min(w-1,Math.round(cx2))])/255;
      if(sv>.85&&r()>.2)continue;
      let prevAng=r()*Math.PI*2;
      for(let t=0;t<p.strokeLen;t++){
        const ix=Math.max(0,Math.min(w-1,Math.round(cx2))),iy=Math.max(0,Math.min(h-1,Math.round(cy2)));
        const v=clamp(px[iy*w+ix]);
        let gx=0,gy=0;
        if(ix>0&&ix<w-1){gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]);}
        if(iy>0&&iy<h-1){gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);}
        let ang=Math.atan2(-gx,gy);
        ang=ang*(1-p.speed)+prevAng*p.speed*.5+(r()-.5)*p.speed*2;
        prevAng=ang;
        cx2+=Math.cos(ang)*2;cy2+=Math.sin(ang)*2;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const pressure=1-Math.abs(t/p.strokeLen-.5)*2;
          if(v<200||r()<.2)o[fy*w+fx]=Math.min(o[fy*w+fx],clamp(255-v*pressure*.8));}
      }
    }return o;
  }});

  A.push({ id:'scribble', name:'Scribble Fill', category:'artistic', params:[
    {id:'density',label:'Density',min:.5,max:5,step:.1,default:2},
    {id:'loopSize',label:'Loop Size',min:3,max:30,step:1,default:10},
    {id:'chaos',label:'Chaos',min:0,max:1,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const sp=Math.max(2,Math.round(8/p.density));
    for(let sy=0;sy<h;sy+=sp)for(let sx=0;sx<w;sx+=sp){
      const v=clamp(px[Math.min(h-1,sy)*w+Math.min(w-1,sx)])/255;
      if(v>.9)continue;
      const loops=Math.ceil((1-v)*p.density*3);
      let cx2=sx+r()*sp,cy2=sy+r()*sp;
      for(let l=0;l<loops;l++){
        const ang0=r()*Math.PI*2;const rad=p.loopSize*(1-v)*.5+2;
        for(let t=0;t<20;t++){
          const a=ang0+t*.3+r()*p.chaos;
          const nx=cx2+Math.cos(a)*rad*(1+r()*p.chaos);
          const ny=cy2+Math.sin(a)*rad*(1+r()*p.chaos);
          const fx=Math.round(nx),fy=Math.round(ny);
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;
          cx2+=(r()-.5)*p.chaos*4;cy2+=(r()-.5)*p.chaos*4;
        }}
    }return o;
  }});

  A.push({ id:'ink-splatter', name:'Ink Splatter', category:'artistic', params:[
    {id:'splatCount',label:'Splats',min:20,max:500,step:10,default:100},
    {id:'maxRadius',label:'Max Radius',min:2,max:40,step:1,default:15},
    {id:'drips',label:'Drip Length',min:0,max:30,step:1,default:8},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let s=0;s<p.splatCount;s++){
      const cx2=Math.floor(r()*w),cy2=Math.floor(r()*h);
      const v=clamp(px[cy2*w+cx2])/255;
      if(v>.7&&r()>.3)continue;
      const rad=p.maxRadius*(1-v)*(r()*.5+.5);
      for(let dy=-rad-2;dy<=rad+2;dy++)for(let dx=-rad-2;dx<=rad+2;dx++){
        const dist=Math.sqrt(dx*dx+dy*dy)+r()*3-1.5;
        if(dist<=rad){const fx=cx2+dx,fy=cy2+dy;
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;}}
      const drops=Math.floor(r()*5*(1-v));
      for(let d=0;d<drops;d++){
        const da=r()*Math.PI*2,dd=rad+r()*rad;
        const dr2=r()*3+1;
        const dcx=Math.round(cx2+Math.cos(da)*dd),dcy=Math.round(cy2+Math.sin(da)*dd);
        for(let dy=-dr2;dy<=dr2;dy++)for(let dx=-dr2;dx<=dr2;dx++){
          if(dx*dx+dy*dy<=dr2*dr2){const fx=dcx+dx,fy=dcy+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;}}}
      if(p.drips>0){const dLen=Math.floor(r()*p.drips*(1-v));
        for(let d=0;d<dLen;d++){const dx=cx2+Math.floor(r()*rad*2-rad);
          const dy2=cy2+Math.floor(rad)+d;
          if(dx>=0&&dx<w&&dy2>=0&&dy2<h)o[dy2*w+dx]=r()<.7?0:128;}}
    }return o;
  }});

  A.push({ id:'color-blots', name:'Color Blots', category:'artistic', params:[
    {id:'blotCount',label:'Blots',min:50,max:500,step:25,default:150},
    {id:'blotSize',label:'Blot Size',min:4,max:30,step:1,default:12},
    {id:'opacity',label:'Opacity',min:.2,max:1,step:.05,default:.7},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i]*.3+180);
    const r=mkRand(p.seed);
    for(let b=0;b<p.blotCount;b++){
      const cx2=Math.floor(r()*w),cy2=Math.floor(r()*h);
      const srcV=clamp(px[cy2*w+cx2]);
      const rad=p.blotSize*(r()*.5+.5);
      for(let dy=-rad-3;dy<=rad+3;dy++)for(let dx=-rad-3;dx<=rad+3;dx++){
        const dist=Math.sqrt(dx*dx+dy*dy)+(r()-.5)*rad*.4;
        if(dist<=rad){const fx=cx2+Math.round(dx),fy=cy2+Math.round(dy);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const edgeFade=Math.max(0,1-dist/rad);
            const alpha=edgeFade*p.opacity;
            o[fy*w+fx]=clamp(o[fy*w+fx]*(1-alpha)+srcV*alpha);
          }}}
    }return o;
  }});

  A.push({ id:'rough-pencil', name:'Rough Pencil', category:'artistic', params:[
    {id:'strokes',label:'Strokes',min:1000,max:10000,step:500,default:4000},
    {id:'pressure',label:'Pressure',min:.3,max:1,step:.05,default:.7},
    {id:'angle',label:'Hatching Angle',min:0,max:180,step:5,default:135},
    {id:'variation',label:'Angle Variation',min:0,max:90,step:5,default:30},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const baseAng=p.angle*Math.PI/180;
    for(let i=0;i<p.strokes;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      const v=clamp(px[y*w+x])/255;
      if(r()>1-v+.1)continue;
      const ang=baseAng+(r()-.5)*p.variation*Math.PI/90;
      const len=(1-v)*12+3;const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-len/2;t<len/2;t++){
        const fx=Math.round(x+dx*t+(r()-.5)*.8);
        const fy=Math.round(y+dy*t+(r()-.5)*.8);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const mark=clamp(255-(1-v)*255*p.pressure*(1-Math.abs(t/len)));
          o[fy*w+fx]=Math.min(o[fy*w+fx],mark);
        }}
    }return o;
  }});

  A.push({ id:'dry-brush-strokes', name:'Dry Brush', category:'artistic', params:[
    {id:'strokeLen',label:'Stroke Length',min:5,max:50,step:1,default:20},
    {id:'width',label:'Width',min:2,max:12,step:1,default:5},
    {id:'dryness',label:'Dryness',min:0,max:1,step:.05,default:.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const sp=Math.max(2,Math.round(p.width*1.5));
    for(let sy=0;sy<h;sy+=sp)for(let sx=0;sx<w;sx+=sp){
      const v=clamp(px[Math.min(h-1,sy)*w+Math.min(w-1,sx)]);
      if(v>220&&r()>.2)continue;
      let ang=r()*Math.PI;
      const ix=Math.min(w-2,Math.max(1,sx)),iy=Math.min(h-2,Math.max(1,sy));
      const gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]);
      const gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);
      ang=Math.atan2(gx,-gy)+(r()-.5)*.5;
      const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-p.strokeLen/2;t<p.strokeLen/2;t++){
        for(let ww=-p.width/2;ww<p.width/2;ww++){
          if(r()<p.dryness*.6)continue;
          const fx=Math.round(sx+dx*t-dy*ww+(r()-.5));
          const fy=Math.round(sy+dy*t+dx*ww+(r()-.5));
          if(fx>=0&&fx<w&&fy>=0&&fy<h){o[fy*w+fx]=Math.min(o[fy*w+fx],v);}
        }}
    }return o;
  }});

  A.push({ id:'blind-contour', name:'Blind Contour', category:'artistic', params:[
    {id:'lines',label:'Lines',min:20,max:200,step:10,default:60},
    {id:'lineLen',label:'Line Length',min:50,max:500,step:25,default:200},
    {id:'wobble',label:'Wobble',min:0,max:1,step:.05,default:.5},
    {id:'edgeSensitivity',label:'Edge Sensitivity',min:.5,max:3,step:.1,default:1.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let l=0;l<p.lines;l++){
      let cx2=r()*w,cy2=r()*h;
      for(let tries=0;tries<20;tries++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2))),iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]),gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);
        if(Math.sqrt(gx*gx+gy*gy)>30*p.edgeSensitivity)break;
        cx2=r()*w;cy2=r()*h;}
      for(let t=0;t<p.lineLen;t++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2))),iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const gx=clamp(px[iy*w+ix+1])-clamp(px[iy*w+ix-1]);
        const gy=clamp(px[(iy+1)*w+ix])-clamp(px[(iy-1)*w+ix]);
        const ang=Math.atan2(-gx,gy);
        cx2+=Math.cos(ang)*1.5+(r()-.5)*p.wobble*3;
        cy2+=Math.sin(ang)*1.5+(r()-.5)*p.wobble*3;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=0;
      }
    }return o;
  }});

  A.push({ id:'charcoal', name:'Charcoal', category:'artistic', params:[
    {id:'grain',label:'Grain',min:0,max:1,step:.05,default:.5},
    {id:'smudge',label:'Smudge',min:0,max:1,step:.05,default:.3},
    {id:'darkness',label:'Darkness',min:.5,max:2,step:.05,default:1.2},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    // Start with darkened, contrasted source
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255;
      v=Math.pow(v,p.darkness);
      // Paper grain
      const grain=(r()-.5)*p.grain*80;
      // Patchy application
      const patch=r()<0.1?40:0;
      o[i]=clamp(v*255+grain+patch);
    }
    // Smudge pass (horizontal blur)
    if(p.smudge>0){
      const rad=Math.round(p.smudge*5);
      const tmp=new Uint8ClampedArray(o);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let sum=0,n2=0;
        for(let dx=-rad;dx<=rad;dx++){
          const nx=x+dx;if(nx>=0&&nx<w){sum+=tmp[y*w+nx];n2++;}
        }
        o[y*w+x]=clamp(sum/n2*p.smudge+tmp[y*w+x]*(1-p.smudge));
      }
    }
    return o;
  }});

  A.push({ id:'watercolor', name:'Watercolor Wash', category:'artistic', params:[
    {id:'wetness',label:'Wetness',min:1,max:15,step:1,default:6},
    {id:'pigment',label:'Pigment',min:.3,max:1,step:.05,default:.7},
    {id:'bleed',label:'Edge Bleed',min:0,max:1,step:.05,default:.4},
    {id:'paperGrain',label:'Paper Grain',min:0,max:50,step:1,default:15},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    // Wet-on-wet blur
    const buf=new Float32Array(px);
    const rad=p.wetness;
    const tmp=new Float32Array(w*h);
    // Blur pass
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let sum=0,n2=0;
      for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
        const nx=x+dx,ny=y+dy;
        if(nx>=0&&nx<w&&ny>=0&&ny<h){sum+=buf[ny*w+nx];n2++;}
      }
      tmp[y*w+x]=sum/n2;
    }
    // Pigment pooling at edges
    for(let i=0;i<w*h;i++){
      let v=tmp[i]*p.pigment+buf[i]*(1-p.pigment);
      // Paper grain
      v+=((r()-.5)*p.paperGrain);
      // Edge bleed: darken edges where gradient is high
      const x=i%w,y=Math.floor(i/w);
      if(x>0&&x<w-1&&y>0&&y<h-1){
        const gx=Math.abs(buf[i+1]-buf[i-1]);
        const gy=Math.abs(buf[i+w]-buf[i-w]);
        v-=(gx+gy)*p.bleed*0.1;
      }
      o[i]=clamp(v);
    }
    return o;
  }});

  A.push({ id:'ink-wash', name:'Ink Wash', category:'artistic', params:[
    {id:'layers',label:'Layers',min:1,max:6,step:1,default:3},
    {id:'spread',label:'Spread',min:2,max:12,step:1,default:5},
    {id:'opacity',label:'Layer Opacity',min:.2,max:.8,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    const buf=new Float32Array(w*h);buf.fill(255);
    for(let layer=0;layer<p.layers;layer++){
      const threshold=255*(layer+1)/(p.layers+1);
      const rad=p.spread*(1+layer*0.5);
      for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){
        const v=clamp(px[y*w+x]);
        if(v>threshold)continue;
        // Spread wash
        const washR=rad*(1+r()*0.5);
        for(let dy=-washR;dy<=washR;dy++)for(let dx=-washR;dx<=washR;dx++){
          const fx=x+Math.round(dx+(r()-.5)*3),fy=y+Math.round(dy+(r()-.5)*3);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const dist=Math.sqrt(dx*dx+dy*dy);
            const fade=Math.max(0,1-dist/washR);
            buf[fy*w+fx]=Math.min(buf[fy*w+fx],buf[fy*w+fx]*(1-fade*p.opacity)+v*fade*p.opacity);
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  // ═══════════════════════════════════════════
  // RECONSTRUCTIVE (6) — paintstroke-by-paintstroke
  // ═══════════════════════════════════════════
  A.push({ id:'oil-paint', name:'Oil Paint', category:'reconstructive', params:[
    {id:'brushSize',label:'Brush Size',min:2,max:15,step:1,default:6},
    {id:'detail',label:'Detail Passes',min:1,max:5,step:1,default:3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    // Start blank
    const buf=new Float32Array(w*h);buf.fill(200);
    // Multiple passes with decreasing brush size
    for(let pass=0;pass<p.detail;pass++){
      const bs=Math.max(1,Math.round(p.brushSize/(pass+1)));
      const sp=Math.max(1,Math.round(bs*0.7));
      for(let y=0;y<h;y+=sp)for(let x=0;x<w;x+=sp){
        // Sample source color at this point
        const sx=Math.min(w-1,x+Math.round((r()-.5)*bs));
        const sy=Math.min(h-1,Math.max(0,y+Math.round((r()-.5)*bs)));
        const srcV=clamp(px[sy*w+sx]);
        // Edge direction for stroke angle
        const e=sobelAt(px,Math.min(w-2,Math.max(1,x)),Math.min(h-2,Math.max(1,y)),w,h);
        const ang=e.ang+Math.PI/2; // Along edge
        const len=bs*2*(0.5+r()*0.5);
        const dx=Math.cos(ang),dy=Math.sin(ang);
        // Paint stroke
        for(let t=-len/2;t<len/2;t++){
          for(let ww=-bs/3;ww<bs/3;ww++){
            const fx=Math.round(x+dx*t-dy*ww+(r()-.5));
            const fy=Math.round(y+dy*t+dx*ww+(r()-.5));
            if(fx>=0&&fx<w&&fy>=0&&fy<h){
              const edgeFade=1-Math.abs(t)/(len/2);
              const brushFade=1-Math.abs(ww)/(bs/3);
              const alpha=edgeFade*brushFade*0.8;
              buf[fy*w+fx]=buf[fy*w+fx]*(1-alpha)+srcV*alpha;
            }
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'pointillism', name:'Pointillism', category:'reconstructive', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:10,step:1,default:4},
    {id:'density',label:'Density',min:.3,max:1,step:.05,default:.7},
    {id:'jitter',label:'Color Jitter',min:0,max:40,step:1,default:15},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(240);const r=mkRand(p.seed);
    const ds=p.dotSize;
    for(let y=0;y<h;y+=Math.max(1,Math.round(ds*0.7)))
      for(let x=0;x<w;x+=Math.max(1,Math.round(ds*0.7))){
        if(r()>p.density)continue;
        const jx=Math.round((r()-.5)*ds);
        const jy=Math.round((r()-.5)*ds);
        const sx=Math.min(w-1,Math.max(0,x+jx));
        const sy=Math.min(h-1,Math.max(0,y+jy));
        const srcV=clamp(px[sy*w+sx])+(r()-.5)*p.jitter*2;
        const dotR=ds*(0.3+r()*0.7);
        for(let dy=-ds;dy<=ds;dy++)for(let dx=-ds;dx<=ds;dx++){
          const dist=Math.sqrt(dx*dx+dy*dy);
          if(dist<dotR){
            const fx=x+jx+dx,fy=y+jy+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h){
              const fade=1-dist/dotR;
              o[fy*w+fx]=clamp(o[fy*w+fx]*(1-fade*0.8)+srcV*fade*0.8);
            }
          }
        }
    }
    return o;
  }});

  A.push({ id:'palette-knife', name:'Palette Knife', category:'reconstructive', params:[
    {id:'size',label:'Knife Size',min:4,max:20,step:1,default:10},
    {id:'smear',label:'Smear Length',min:5,max:40,step:1,default:15},
    {id:'pressure',label:'Pressure',min:.3,max:1,step:.05,default:.7},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const buf=new Float32Array(px); // start from source
    const sp=Math.max(2,Math.round(p.size*0.8));
    for(let y=0;y<h;y+=sp)for(let x=0;x<w;x+=sp){
      // Edge direction for smear
      const e=sobelAt(px,Math.min(w-2,Math.max(1,x)),Math.min(h-2,Math.max(1,y)),w,h);
      const ang=e.ang+Math.PI/2+(r()-.5)*0.5;
      const dx=Math.cos(ang),dy=Math.sin(ang);
      // Pick up paint from starting point
      let paint=clamp(buf[y*w+x]);
      const len=p.smear*(0.5+r()*0.5);
      for(let t=0;t<len;t++){
        const fx=Math.round(x+dx*t),fy=Math.round(y+dy*t);
        if(fx<0||fx>=w||fy<0||fy>=h)break;
        for(let ww=-p.size/3;ww<p.size/3;ww++){
          const wx2=Math.round(fx-dy*ww),wy2=Math.round(fy+dx*ww);
          if(wx2>=0&&wx2<w&&wy2>=0&&wy2<h){
            const decay=1-t/len;
            const alpha=decay*p.pressure*0.6;
            // Mix paint with surface
            paint=paint*0.98+buf[wy2*w+wx2]*0.02;
            buf[wy2*w+wx2]=buf[wy2*w+wx2]*(1-alpha)+paint*alpha;
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'impasto', name:'Impasto', category:'reconstructive', params:[
    {id:'thickness',label:'Paint Thickness',min:1,max:8,step:1,default:4},
    {id:'highlight',label:'Highlight Strength',min:0,max:1,step:.05,default:.5},
    {id:'direction',label:'Light Dir',min:0,max:360,step:15,default:135},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const lightAng=p.direction*Math.PI/180;
    const lx=Math.cos(lightAng),ly=Math.sin(lightAng);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x]);
      // Simulate thick paint with emboss lighting
      if(x>0&&x<w-1&&y>0&&y<h-1){
        const gx=(clamp(px[y*w+x+1])-clamp(px[y*w+x-1]))/2;
        const gy=(clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]))/2;
        const dot=(gx*lx+gy*ly)*p.thickness*p.highlight/255;
        v=clamp(v+dot*60+(r()-.5)*p.thickness*3);
      }
      o[y*w+x]=v;
    }
    return o;
  }});

  A.push({ id:'mosaic-tiles', name:'Mosaic Tiles', category:'reconstructive', params:[
    {id:'tileSize',label:'Tile Size',min:3,max:20,step:1,default:8},
    {id:'grout',label:'Grout Width',min:0,max:3,step:1,default:1},
    {id:'irregularity',label:'Irregularity',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ts=p.tileSize;
    // Pre-compute tile centers with jitter
    const cols=Math.ceil(w/ts),rows=Math.ceil(h/ts);
    const centers=[];
    for(let ty=0;ty<rows;ty++){
      centers[ty]=[];
      for(let tx=0;tx<cols;tx++){
        centers[ty][tx]={
          x:tx*ts+ts/2+(r()-.5)*ts*p.irregularity,
          y:ty*ts+ts/2+(r()-.5)*ts*p.irregularity
        };
      }
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const tileX=Math.floor(x/ts),tileY=Math.floor(y/ts);
      // Find nearest center
      let minD=Infinity,nearV=128;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const ty=tileY+dy,tx2=tileX+dx;
        if(ty>=0&&ty<rows&&tx2>=0&&tx2<cols){
          const c=centers[ty][tx2];
          const d=Math.sqrt((x-c.x)**2+(y-c.y)**2);
          if(d<minD){
            minD=d;
            const sx=Math.min(w-1,Math.max(0,Math.round(c.x)));
            const sy=Math.min(h-1,Math.max(0,Math.round(c.y)));
            nearV=clamp(px[sy*w+sx]);
          }
        }
      }
      // Grout
      if(p.grout>0){
        const inTileX=(x%ts),inTileY=(y%ts);
        if(inTileX<p.grout||inTileY<p.grout||inTileX>=ts-p.grout||inTileY>=ts-p.grout){
          o[y*w+x]=220; continue;
        }
      }
      o[y*w+x]=nearV;
    }
    return o;
  }});

  A.push({ id:'stained-glass', name:'Stained Glass', category:'reconstructive', params:[
    {id:'cellSize',label:'Cell Size',min:5,max:25,step:1,default:12},
    {id:'leadWidth',label:'Lead Width',min:1,max:4,step:1,default:2},
    {id:'lightEffect',label:'Light Effect',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),cs=p.cellSize;
    const numCells=Math.ceil(w*h/(cs*cs));
    const cellPts=[];
    for(let i=0;i<numCells;i++) cellPts.push({x:r()*w,y:r()*h});
    // Grid-accelerated nearest-neighbor lookup
    const gridSize=cs*2;
    const gw=Math.ceil(w/gridSize),gh=Math.ceil(h/gridSize);
    const grid=new Array(gw*gh);
    for(let i=0;i<grid.length;i++) grid[i]=[];
    for(let i=0;i<numCells;i++){
      const gx=Math.min(gw-1,Math.floor(cellPts[i].x/gridSize));
      const gy=Math.min(gh-1,Math.floor(cellPts[i].y/gridSize));
      grid[gy*gw+gx].push(i);
    }
    for(let y=0;y<h;y++){
      const gy0=Math.floor(y/gridSize);
      for(let x=0;x<w;x++){
        const gx0=Math.floor(x/gridSize);
        let min1=Infinity,min2=Infinity,nearIdx=0;
        // Search 3x3 neighborhood of grid cells
        for(let dy=-1;dy<=1;dy++){
          const gy=gy0+dy;
          if(gy<0||gy>=gh) continue;
          for(let dx=-1;dx<=1;dx++){
            const gx=gx0+dx;
            if(gx<0||gx>=gw) continue;
            const cell=grid[gy*gw+gx];
            for(let k=0;k<cell.length;k++){
              const ci=cell[k];
              const d=(x-cellPts[ci].x)**2+(y-cellPts[ci].y)**2;
              if(d<min1){min2=min1;min1=d;nearIdx=ci;}
              else if(d<min2) min2=d;
            }
          }
        }
        const edgeDist=Math.sqrt(min2)-Math.sqrt(min1);
        if(edgeDist<p.leadWidth){
          o[y*w+x]=20;
        } else {
          const cp=cellPts[nearIdx];
          const sx=Math.min(w-1,Math.max(0,Math.round(cp.x)));
          const sy=Math.min(h-1,Math.max(0,Math.round(cp.y)));
          let v=clamp(px[sy*w+sx]);
          v=clamp(v+edgeDist*p.lightEffect*2);
          o[y*w+x]=v;
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // SKETCH & DRAWING (8)
  // ═══════════════════════════════════════════
  A.push({ id:'multi-line-sketch', name:'Multi-Line Sketch', category:'sketch', params:[
    {id:'lineCount',label:'Lines',min:1000,max:10000,step:500,default:5000},
    {id:'passes',label:'Line Passes',min:1,max:5,step:1,default:3},
    {id:'overshoot',label:'Overshoot',min:0,max:.8,step:.05,default:.35},
    {id:'angleSpread',label:'Angle Spread',min:0,max:60,step:5,default:25},
    {id:'wobble',label:'Wobble',min:0,max:1,step:.05,default:.2},
    {id:'thickness',label:'Thickness',min:1,max:3,step:1,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      const v=clamp(px[y*w+x])/255;
      if(r()>1-v+.05)continue;
      // Base direction from gradient
      let baseAng=r()*Math.PI;
      if(x>2&&x<w-3&&y>2&&y<h-3){
        const gx=clamp(px[y*w+x+1])-clamp(px[y*w+x-1]);
        const gy=clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]);
        baseAng=Math.atan2(gx,-gy);
      }
      // Draw multiple passes over same area with slight angle variation
      for(let pass=0;pass<p.passes;pass++){
        const ang=baseAng+(r()-.5)*p.angleSpread*Math.PI/90;
        const baseLen=(1-v)*15+4;
        const len=baseLen*(1+p.overshoot*(r()*.5+.5));
        const dx=Math.cos(ang),dy=Math.sin(ang);
        const offsetX=(r()-.5)*3,offsetY=(r()-.5)*3;
        for(let t=-len/2;t<len/2;t++){
          const wx=(r()-.5)*p.wobble*1.5,wy=(r()-.5)*p.wobble*1.5;
          for(let ww=0;ww<p.thickness;ww++){
            const fx=Math.round(x+dx*t+wx-dy*ww+offsetX);
            const fy=Math.round(y+dy*t+wy+dx*ww+offsetY);
            if(fx>=0&&fx<w&&fy>=0&&fy<h){
              const edgeFade=Math.abs(t)/(len/2);
              const opacity=edgeFade>.8?clamp(128+r()*80):0;
              o[fy*w+fx]=Math.min(o[fy*w+fx],opacity);
            }
          }
        }
      }
    }
    return o;
  }});

  A.push({ id:'angular-sketch', name:'Angular Sketch', category:'sketch', params:[
    {id:'lineCount',label:'Lines',min:500,max:8000,step:500,default:3000},
    {id:'segmentLen',label:'Segment Length',min:3,max:20,step:1,default:8},
    {id:'segments',label:'Segments/Line',min:2,max:8,step:1,default:4},
    {id:'angleChange',label:'Max Turn',min:10,max:90,step:5,default:45},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      let cx2=Math.floor(r()*w),cy2=Math.floor(r()*h);
      const v=clamp(px[cy2*w+cx2])/255;
      if(r()>1-v+.08)continue;
      let ang=r()*Math.PI*2;
      for(let seg=0;seg<p.segments;seg++){
        ang+=(r()-.5)*p.angleChange*Math.PI/90;
        const dx=Math.cos(ang),dy=Math.sin(ang);
        for(let t=0;t<p.segmentLen;t++){
          const fx=Math.round(cx2+dx*t),fy=Math.round(cy2+dy*t);
          if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=0;
        }
        cx2+=Math.round(Math.cos(ang)*p.segmentLen);
        cy2+=Math.round(Math.sin(ang)*p.segmentLen);
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
      }
    }
    return o;
  }});

  A.push({ id:'illustrator-sketch', name:'Illustrator Sketch', category:'sketch', params:[
    {id:'lines',label:'Lines',min:50,max:400,step:25,default:150},
    {id:'smoothness',label:'Smoothness',min:.5,max:1,step:.05,default:.8},
    {id:'lineLen',label:'Line Length',min:30,max:300,step:10,default:120},
    {id:'edgeWeight',label:'Edge Weight',min:.5,max:3,step:.1,default:1.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let l=0;l<p.lines;l++){
      // Start near edges
      let cx2=r()*w,cy2=r()*h;
      for(let tries=0;tries<30;tries++){
        const e=sobelAt(px,Math.min(w-2,Math.max(1,Math.round(cx2))),Math.min(h-2,Math.max(1,Math.round(cy2))),w,h);
        if(e.mag>20)break;
        cx2=r()*w;cy2=r()*h;
      }
      let prevAng=0;
      for(let t=0;t<p.lineLen;t++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2)));
        const iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const e=sobelAt(px,ix,iy,w,h);
        let ang=e.ang+Math.PI/2;
        // Smooth direction changes (illustrator style = clean lines)
        ang=prevAng*p.smoothness+ang*(1-p.smoothness);
        prevAng=ang;
        cx2+=Math.cos(ang)*1.5;
        cy2+=Math.sin(ang)*1.5;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          // Thicker at edges
          const lineW=Math.max(1,Math.round(e.mag/80*p.edgeWeight));
          for(let ww=0;ww<lineW;ww++){
            const wx2=fx+Math.round(-Math.sin(ang)*ww);
            const wy2=fy+Math.round(Math.cos(ang)*ww);
            if(wx2>=0&&wx2<w&&wy2>=0&&wy2<h) o[wy2*w+wx2]=0;
          }
        }
      }
    }
    return o;
  }});

  A.push({ id:'form-sketch', name:'Form-Following Sketch', category:'sketch', params:[
    {id:'lineCount',label:'Lines',min:500,max:6000,step:500,default:2500},
    {id:'lineLen',label:'Line Length',min:10,max:60,step:5,default:25},
    {id:'overshoot',label:'Overshoot',min:0,max:.6,step:.05,default:.3},
    {id:'curvature',label:'Form Following',min:.2,max:1,step:.05,default:.7},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const sx=Math.floor(r()*w),sy=Math.floor(r()*h);
      const v=clamp(px[sy*w+sx])/255;
      if(r()>1-v+.1)continue;
      const len=p.lineLen*(1-v*0.5)*(1+p.overshoot*r());
      let cx2=sx,cy2=sy;
      let prevAng=r()*Math.PI*2;
      for(let t=0;t<len;t++){
        const ix=Math.max(1,Math.min(w-2,Math.round(cx2)));
        const iy=Math.max(1,Math.min(h-2,Math.round(cy2)));
        const e=sobelAt(px,ix,iy,w,h);
        // Follow form (perpendicular to gradient)
        let ang=e.ang+Math.PI/2;
        ang=prevAng*(1-p.curvature)+ang*p.curvature;
        prevAng=ang;
        cx2+=Math.cos(ang)*1.5;cy2+=Math.sin(ang)*1.5;
        if(cx2<0||cx2>=w||cy2<0||cy2>=h)break;
        const fx=Math.round(cx2),fy=Math.round(cy2);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          // Lighter at ends
          const edgeFade=Math.abs(t/len-.5)*2;
          if(edgeFade<.8||r()>.4)o[fy*w+fx]=Math.min(o[fy*w+fx],edgeFade>.7?140:0);
        }
      }
    }
    return o;
  }});

  A.push({ id:'contour-drawing', name:'Contour Drawing', category:'sketch', params:[
    {id:'lines',label:'Contour Lines',min:10,max:30,step:1,default:15},
    {id:'thickness',label:'Thickness',min:1,max:4,step:1,default:2},
    {id:'smoothing',label:'Smoothing',min:0,max:1,step:.05,default:.6}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    // Draw lines at fixed brightness levels
    const step=255/(p.lines+1);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const v=clamp(px[y*w+x]);
      // Check if this pixel crosses a contour level
      for(let level=1;level<=p.lines;level++){
        const threshold=level*step;
        const vn=clamp(px[y*w+x+1]),vs=clamp(px[(y+1)*w+x]);
        if((v>=threshold&&vn<threshold)||(v<threshold&&vn>=threshold)||
           (v>=threshold&&vs<threshold)||(v<threshold&&vs>=threshold)){
          // Draw with thickness
          for(let dy=-p.thickness+1;dy<p.thickness;dy++)for(let dx=-p.thickness+1;dx<p.thickness;dx++){
            if(dx*dx+dy*dy<p.thickness*p.thickness){
              const fx=x+dx,fy=y+dy;
              if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=0;
            }
          }
          break;
        }
      }
    }
    return o;
  }});

  A.push({ id:'pen-ink', name:'Pen & Ink', category:'sketch', params:[
    {id:'lineWeight',label:'Line Weight',min:.5,max:3,step:.25,default:1},
    {id:'crosshatch',label:'Crosshatch',type:'checkbox',default:true},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:true},
    {id:'fillDensity',label:'Fill Density',min:2,max:10,step:1,default:5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    // Hatching fill
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=clamp(px[y*w+x])/255;
      // Primary hatching
      const proj1=Math.abs((x*0.707+y*0.707)%p.fillDensity);
      if(proj1<p.lineWeight&&v<0.75) {o[y*w+x]=0;continue;}
      // Crosshatch for darker areas
      if(p.crosshatch&&v<0.45){
        const proj2=Math.abs((x*0.707-y*0.707)%p.fillDensity);
        if(proj2<p.lineWeight) {o[y*w+x]=0;continue;}
      }
      // Very dark = solid fill
      if(v<0.15) {o[y*w+x]=0;continue;}
    }
    // Edge lines
    if(p.edgeLines){
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>60) o[y*w+x]=0;
      }
    }
    return o;
  }});

  A.push({ id:'comic-lines', name:'Comic Lines', category:'sketch', params:[
    {id:'edgeThreshold',label:'Edge Threshold',min:20,max:120,step:5,default:50},
    {id:'lineThickness',label:'Line Thickness',min:1,max:4,step:1,default:2},
    {id:'screenDots',label:'Screen Dots',type:'checkbox',default:true},
    {id:'screenSize',label:'Screen Size',min:3,max:12,step:1,default:6}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);
    // Edge detection for outlines
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const e=sobelAt(px,x,y,w,h);
      if(e.mag>p.edgeThreshold){
        for(let dy=-p.lineThickness+1;dy<p.lineThickness;dy++)for(let dx=-p.lineThickness+1;dx<p.lineThickness;dx++){
          if(dx*dx+dy*dy<p.lineThickness*p.lineThickness){
            const fx=x+dx,fy=y+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=0;
          }
        }
      }
    }
    // Halftone screen for shading
    if(p.screenDots){
      const ds=p.screenSize;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        if(o[y*w+x]===0)continue; // don't overwrite lines
        const v=clamp(px[y*w+x])/255;
        if(v>0.6)continue; // only shade darker areas
        const cx2=((x%ds)+ds)%ds,cy2=((y%ds)+ds)%ds;
        const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
        const d=Math.sqrt(nx*nx+ny*ny);
        const t=(1-v)*1.2;
        if(d<t*0.7) o[y*w+x]=0;
      }
    }
    return o;
  }});

  A.push({ id:'architectural', name:'Architectural Sketch', category:'sketch', params:[
    {id:'lineWeight',label:'Line Weight',min:.5,max:3,step:.25,default:1.5},
    {id:'hatching',label:'Hatching Density',min:3,max:12,step:1,default:6},
    {id:'edgeSensitivity',label:'Edge Detail',min:20,max:100,step:5,default:40},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(255);const r=mkRand(p.seed);
    // Clean edge lines (architectural style - precise)
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const e=sobelAt(px,x,y,w,h);
      if(e.mag>p.edgeSensitivity){
        const lw=Math.round(Math.min(p.lineWeight,1+e.mag/200));
        for(let dd=0;dd<lw;dd++){
          const fx=x+Math.round(Math.cos(e.ang)*dd);
          const fy=y+Math.round(Math.sin(e.ang)*dd);
          if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=0;
        }
      }
    }
    // Shadow hatching (45 degrees, consistent spacing)
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(o[y*w+x]===0)continue;
      const v=clamp(px[y*w+x])/255;
      if(v>0.65)continue;
      const proj=Math.abs((x+y)%p.hatching);
      if(proj<1) o[y*w+x]=clamp(100+v*155);
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // EXOTIC & RARE (6)
  // ═══════════════════════════════════════════
  A.push({ id:'mandelbrot-dither', name:'Fractal Dither', category:'exotic', params:[
    {id:'iterations',label:'Detail',min:5,max:50,step:5,default:20},
    {id:'zoom',label:'Zoom',min:.5,max:5,step:.1,default:1},
    {id:'mix',label:'Image Mix',min:0,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    const zf=p.zoom;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const cr=(x/w*3-2)/zf,ci=(y/h*2-1)/zf;
      let zr=0,zi=0,iter=0;
      while(zr*zr+zi*zi<4&&iter<p.iterations){const tr=zr*zr-zi*zi+cr;zi=2*zr*zi+ci;zr=tr;iter++;}
      const fracVal=iter/p.iterations;
      const imgVal=clamp(px[y*w+x])/255;
      const v=(fracVal*p.mix+imgVal*(1-p.mix));
      o[y*w+x]=v>.5?255:0;
    }return o;
  }});

  A.push({ id:'reaction-diffusion', name:'Reaction-Diffusion', category:'exotic', params:[
    {id:'iterations',label:'Iterations',min:5,max:50,step:5,default:15},
    {id:'feed',label:'Feed Rate',min:.01,max:.08,step:.005,default:.055},
    {id:'kill',label:'Kill Rate',min:.04,max:.07,step:.002,default:.062},
    {id:'imageMix',label:'Image Influence',min:0,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    let a=new Float32Array(w*h),b=new Float32Array(w*h);
    a.fill(1);
    // Seed B from dark areas of image
    for(let i=0;i<w*h;i++) if(clamp(px[i])/255<0.5) b[i]=1;
    const dA=1,dB=.5;
    for(let iter=0;iter<p.iterations;iter++){
      const na=new Float32Array(w*h),nb=new Float32Array(w*h);
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const i=y*w+x;
        const lapA=a[i-1]+a[i+1]+a[i-w]+a[i+w]-4*a[i];
        const lapB=b[i-1]+b[i+1]+b[i-w]+b[i+w]-4*b[i];
        const abb=a[i]*b[i]*b[i];
        const f=p.feed*(1-clamp(px[i])/255*p.imageMix);
        na[i]=a[i]+dA*lapA-abb+f*(1-a[i]);
        nb[i]=b[i]+dB*lapB+abb-(p.kill+f)*b[i];
      }
      a=na;b=nb;
    }
    for(let i=0;i<w*h;i++) o[i]=clamp((1-b[i])*255);
    return o;
  }});

  A.push({ id:'pixel-sort', name:'Pixel Sort', category:'exotic', params:[
    {id:'threshold',label:'Threshold',min:10,max:200,step:5,default:80},
    {id:'direction',label:'Direction',type:'select',options:[{value:'h',label:'Horizontal'},{value:'v',label:'Vertical'},{value:'d',label:'Diagonal'}],default:'h'},
    {id:'mode',label:'Mode',type:'select',options:[{value:'dark',label:'Dark First'},{value:'light',label:'Light First'}],default:'dark'}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const buf=new Float32Array(px);
    if(p.direction==='h'){
      for(let y=0;y<h;y++){
        let start=-1;
        for(let x=0;x<=w;x++){
          const v=x<w?clamp(buf[y*w+x]):256;
          const inRange=v<p.threshold;
          if(inRange&&start===-1) start=x;
          else if(!inRange&&start!==-1){
            const seg=[];
            for(let sx=start;sx<x;sx++) seg.push(clamp(buf[y*w+sx]));
            seg.sort((a2,b2)=>p.mode==='dark'?a2-b2:b2-a2);
            for(let sx=start;sx<x;sx++) buf[y*w+sx]=seg[sx-start];
            start=-1;
          }
        }
      }
    } else if(p.direction==='v'){
      for(let x=0;x<w;x++){
        let start=-1;
        for(let y=0;y<=h;y++){
          const v=y<h?clamp(buf[y*w+x]):256;
          const inRange=v<p.threshold;
          if(inRange&&start===-1) start=y;
          else if(!inRange&&start!==-1){
            const seg=[];
            for(let sy=start;sy<y;sy++) seg.push(clamp(buf[sy*w+x]));
            seg.sort((a2,b2)=>p.mode==='dark'?a2-b2:b2-a2);
            for(let sy=start;sy<y;sy++) buf[sy*w+x]=seg[sy-start];
            start=-1;
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'voronoi-dither', name:'Voronoi Dither', category:'exotic', params:[
    {id:'cells',label:'Cells',min:50,max:1000,step:50,default:300},
    {id:'style',label:'Style',type:'select',options:[{value:'flat',label:'Flat'},{value:'edge',label:'Edges Only'},{value:'mixed',label:'Mixed'}],default:'flat'},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const pts=[];
    for(let i=0;i<p.cells;i++) pts.push({x:r()*w,y:r()*h});
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let min1=Infinity,min2=Infinity,nearIdx=0;
      for(let i=0;i<pts.length;i++){
        const d=(x-pts[i].x)**2+(y-pts[i].y)**2;
        if(d<min1){min2=min1;min1=d;nearIdx=i;}
        else if(d<min2)min2=d;
      }
      if(p.style==='edge'){
        o[y*w+x]=(Math.sqrt(min2)-Math.sqrt(min1))<2?0:255;
      } else if(p.style==='mixed'){
        const edge=Math.sqrt(min2)-Math.sqrt(min1)<2;
        const cp=pts[nearIdx];
        const sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))]);
        o[y*w+x]=edge?0:sv;
      } else {
        const cp=pts[nearIdx];
        o[y*w+x]=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))]);
      }
    }
    return o;
  }});

  A.push({ id:'hilbert-dither', name:'Hilbert Curve', category:'exotic', params:[
    {id:'order',label:'Curve Order',min:3,max:7,step:1,default:5},
    {id:'strength',label:'Diffusion',min:.5,max:1,step:.05,default:.85}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const n=1<<p.order;
    const buf=new Float32Array(px);
    // Generate Hilbert curve path
    function hilbert(rx,ry,d,s) {
      if(s===1) return [rx,ry];
      const h2=s>>1;
      let pts=[];
      if(d===0) pts=hilbert(ry,rx,0,h2);
      else if(d===1) pts=hilbert(rx,ry,1,h2);
      else if(d===2) pts=hilbert(s-1-ry,s-1-rx,2,h2);
      else pts=hilbert(s-1-rx,s-1-ry,3,h2);
      return pts;
    }
    // Simplified: just do error diffusion along scanline but with threshold modulation
    const errBuf=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      const old=clamp(buf[i]+errBuf[i]);
      const nv=old>128?255:0;
      o[i]=nv;
      const err=(old-nv)*p.strength;
      // Spread error in a curved pattern
      const phase=(x+y*3)%4;
      if(phase===0&&x+1<w) errBuf[i+1]+=err*0.5;
      if(phase===1&&y+1<h) errBuf[i+w]+=err*0.5;
      if(phase===2&&x>0) errBuf[i-1]+=err*0.3;
      if(phase===3&&y+1<h&&x+1<w) errBuf[i+w+1]+=err*0.4;
      if(x+1<w) errBuf[i+1]+=err*0.2;
      if(y+1<h) errBuf[i+w]+=err*0.15;
    }
    return o;
  }});

  A.push({ id:'dbs', name:'Direct Binary Search', category:'exotic', params:[
    {id:'iterations',label:'Iterations',min:1,max:5,step:1,default:2},
    {id:'neighborhood',label:'Neighborhood',min:2,max:6,step:1,default:3}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    // Initial threshold
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i])>128?255:0;
    // Iteratively swap/toggle pixels to minimize error
    const nb=p.neighborhood;
    for(let iter=0;iter<p.iterations;iter++){
      let improved=false;
      for(let y=nb;y<h-nb;y+=2)for(let x=nb;x<w-nb;x+=2){
        const i=y*w+x;
        // Calculate current local error
        let errCurrent=0,errToggled=0;
        for(let dy=-nb;dy<=nb;dy++)for(let dx=-nb;dx<=nb;dx++){
          const ni=(y+dy)*w+x+dx;
          const target=clamp(px[ni]);
          const dist=Math.sqrt(dx*dx+dy*dy)+1;
          const weight=1/dist;
          errCurrent+=(target-o[ni])**2*weight;
        }
        // Try toggling
        const newV=o[i]===0?255:0;
        const oldV=o[i];
        o[i]=newV;
        for(let dy=-nb;dy<=nb;dy++)for(let dx=-nb;dx<=nb;dx++){
          const ni=(y+dy)*w+x+dx;
          const target=clamp(px[ni]);
          const dist=Math.sqrt(dx*dx+dy*dy)+1;
          errToggled+=(target-o[ni])**2/dist;
        }
        if(errToggled>=errCurrent) o[i]=oldV; // revert
        else improved=true;
      }
      if(!improved)break;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // DIGITAL & GLITCH (10)
  // ═══════════════════════════════════════════
  A.push({ id:'hue-shift', name:'Hue Scatter', category:'digital', params:[
    {id:'amount',label:'Scatter Amount',min:0,max:60,step:1,default:20},
    {id:'valueLink',label:'Link to Value',min:0,max:1,step:.05,default:.5},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255;
      const scatter=(r()-.5)*p.amount*(1-v*p.valueLink);
      o[i]=clamp(px[i]+scatter);
    }return o;
  }});

  A.push({ id:'channel-noise', name:'Channel Noise', category:'digital', params:[
    {id:'red',label:'Red Noise',min:0,max:80,step:1,default:30},
    {id:'green',label:'Green Noise',min:0,max:80,step:1,default:15},
    {id:'blue',label:'Blue Noise',min:0,max:80,step:1,default:40},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const rn=(r()-.5)*p.red,gn=(r()-.5)*p.green,bn=(r()-.5)*p.blue;
      o[i]=clamp(px[i]+rn*.3+gn*.5+bn*.2);
    }return o;
  }});

  A.push({ id:'color-bleed', name:'Color Bleed', category:'digital', params:[
    {id:'amount',label:'Bleed Amount',min:1,max:20,step:1,default:5},
    {id:'direction',label:'Direction',type:'select',options:[{value:'right',label:'Right'},{value:'down',label:'Down'},{value:'diagonal',label:'Diagonal'},{value:'radial',label:'Radial'}],default:'right'},
    {id:'decay',label:'Decay',min:.5,max:.99,step:.01,default:.9}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    const buf=new Float32Array(px);
    if(p.direction==='right'){
      for(let y=0;y<h;y++){let carry=0;for(let x=0;x<w;x++){
        carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/20)+carry*(p.amount/20);}}
    }else if(p.direction==='down'){
      for(let x=0;x<w;x++){let carry=0;for(let y=0;y<h;y++){
        carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/20)+carry*(p.amount/20);}}
    }else if(p.direction==='diagonal'){
      for(let d=0;d<w+h;d++){let carry=0;for(let y=Math.max(0,d-w+1);y<=Math.min(d,h-1);y++){
        const x=d-y;if(x<w){carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/20)+carry*(p.amount/20);}}}
    }else{
      const cx2=w/2,cy2=h/2;for(let a=0;a<360;a+=1){const rad=a*Math.PI/180;
        let carry=0;for(let r2=0;r2<Math.max(w,h);r2++){
          const x=Math.round(cx2+Math.cos(rad)*r2),y=Math.round(cy2+Math.sin(rad)*r2);
          if(x>=0&&x<w&&y>=0&&y<h){carry=carry*p.decay+buf[y*w+x]*(1-p.decay);buf[y*w+x]=buf[y*w+x]*(1-p.amount/40)+carry*(p.amount/40);}}}
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'rgb-shift', name:'RGB Shift', category:'digital', params:[
    {id:'rShift',label:'Red Shift',min:-15,max:15,step:1,default:3},
    {id:'gShift',label:'Green Shift',min:-15,max:15,step:1,default:0},
    {id:'bShift',label:'Blue Shift',min:-15,max:15,step:1,default:-3},
    {id:'axis',label:'Axis',type:'select',options:[{value:'h',label:'Horizontal'},{value:'v',label:'Vertical'},{value:'both',label:'Both'}],default:'h'}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let sx1=x,sy1=y,sx2=x,sy2=y,sx3=x,sy3=y;
      if(p.axis==='h'||p.axis==='both'){sx1=((x+p.rShift)%w+w)%w;sx3=((x+p.bShift)%w+w)%w;}
      if(p.axis==='v'||p.axis==='both'){sy1=((y+p.rShift)%h+h)%h;sy3=((y+p.bShift)%h+h)%h;}
      const r2=clamp(px[sy1*w+sx1]),g=clamp(px[sy2*w+sx2]),b=clamp(px[sy3*w+sx3]);
      o[y*w+x]=Math.round(r2*.3+g*.5+b*.2);
    }return o;
  }});

  A.push({ id:'color-quantize-noise', name:'Quantize + Noise', category:'digital', params:[
    {id:'levels',label:'Levels',min:2,max:12,step:1,default:4},
    {id:'noise',label:'Dither Noise',min:0,max:1,step:.05,default:.5},
    {id:'bandShift',label:'Band Shift',min:0,max:30,step:1,default:10},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),n2=p.levels;
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255+(r()-.5)*p.noise/n2;
      const band=Math.round(Math.max(0,Math.min(1,v))*(n2-1));
      const shift=(r()-.5)*p.bandShift;
      o[i]=clamp(band/(n2-1)*255+shift);
    }return o;
  }});

  A.push({ id:'duotone-split', name:'Duotone Split', category:'digital', params:[
    {id:'splitPoint',label:'Split Point',min:0,max:255,step:1,default:128},
    {id:'darkShift',label:'Dark Shift',min:-60,max:60,step:1,default:-20},
    {id:'lightShift',label:'Light Shift',min:-60,max:60,step:1,default:20},
    {id:'crossover',label:'Crossover Width',min:0,max:60,step:1,default:20}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i]);const sp=p.splitPoint;
      let shift;
      if(v<sp-p.crossover) shift=p.darkShift;
      else if(v>sp+p.crossover) shift=p.lightShift;
      else { const t=(v-(sp-p.crossover))/(p.crossover*2); shift=p.darkShift*(1-t)+p.lightShift*t; }
      o[i]=clamp(v+shift);
    }return o;
  }});

  A.push({ id:'solarize', name:'Solarize', category:'digital', params:[
    {id:'threshold',label:'Threshold',min:60,max:200,step:5,default:128},
    {id:'amount',label:'Amount',min:0,max:1,step:.05,default:1}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i]);
      const solarized=v>p.threshold?255-v:v;
      o[i]=clamp(v*(1-p.amount)+solarized*p.amount);
    }
    return o;
  }});

  A.push({ id:'posterize', name:'Posterize', category:'digital', params:[
    {id:'levels',label:'Levels',min:2,max:8,step:1,default:4},
    {id:'dither',label:'Dither Amount',min:0,max:1,step:.05,default:0},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255;
      v+=((r()-.5)*p.dither/p.levels);
      const band=Math.round(Math.max(0,Math.min(1,v))*(p.levels-1));
      o[i]=clamp(band/(p.levels-1)*255);
    }
    return o;
  }});

  A.push({ id:'glitch-blocks', name:'Glitch Blocks', category:'digital', params:[
    {id:'blockSize',label:'Block Size',min:4,max:30,step:2,default:12},
    {id:'probability',label:'Glitch Probability',min:.05,max:.5,step:.05,default:.15},
    {id:'shift',label:'Max Shift',min:5,max:50,step:5,default:20},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),bs=p.blockSize;
    // Copy source first
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i]);
    // Apply random block shifts
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
      if(r()>p.probability)continue;
      const shiftX=Math.round((r()-.5)*p.shift*2);
      const shiftY=Math.round((r()-.5)*p.shift*0.5);
      for(let dy=0;dy<bs&&y+dy<h;dy++)for(let dx=0;dx<bs&&x+dx<w;dx++){
        const sx=((x+dx+shiftX)%w+w)%w;
        const sy=((y+dy+shiftY)%h+h)%h;
        o[(y+dy)*w+x+dx]=clamp(px[sy*w+sx]);
      }
    }
    return o;
  }});

  A.push({ id:'data-bend', name:'Data Bend', category:'digital', params:[
    {id:'intensity',label:'Intensity',min:1,max:20,step:1,default:5},
    {id:'chunkSize',label:'Chunk Size',min:10,max:200,step:10,default:50},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const buf=new Float32Array(px);
    // Treat pixel data as raw bytes and corrupt
    for(let i=0;i<p.intensity;i++){
      const start=Math.floor(r()*w*h);
      const len=Math.floor(r()*p.chunkSize);
      const op=Math.floor(r()*4);
      for(let j=start;j<Math.min(start+len,w*h);j++){
        if(op===0) buf[j]=255-buf[j]; // invert
        else if(op===1) buf[j]=buf[Math.min(w*h-1,j+Math.floor(r()*20))]; // repeat
        else if(op===2) buf[j]=(buf[j]+128)%256; // shift
        else buf[j]=buf[j]^(Math.floor(r()*256)); // xor
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  // ═══════════════════════════════════════════
  // EFFECTS & TRANSFORMS (12)
  // ═══════════════════════════════════════════
  A.push({ id:'photographic-grain', name:'Photo Grain', category:'effects', params:[
    {id:'size',label:'Grain Size',min:1,max:6,step:1,default:2},
    {id:'amount',label:'Amount',min:0,max:100,step:1,default:40},
    {id:'luminanceResponse',label:'Shadow Bias',min:0,max:1,step:.05,default:.6},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),gs=p.size;
    for(let y=0;y<h;y+=gs)for(let x=0;x<w;x+=gs){
      const v=clamp(px[y*w+x])/255;
      const response=1-v*p.luminanceResponse;
      const noise=(r()-.5)*p.amount*response;
      for(let dy=0;dy<gs&&y+dy<h;dy++)for(let dx=0;dx<gs&&x+dx<w;dx++)
        o[(y+dy)*w+x+dx]=clamp(px[(y+dy)*w+x+dx]+noise+(r()-.5)*5);
    }return o;
  }});

  A.push({ id:'kodachrome-grain', name:'Kodachrome Grain', category:'effects', params:[
    {id:'grain',label:'Grain Intensity',min:0,max:80,step:1,default:30},
    {id:'warmth',label:'Warmth',min:0,max:50,step:1,default:15},
    {id:'satBoost',label:'Contrast Boost',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:55}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255;
      const curved=v<.5?2*v*v:1-2*(1-v)*(1-v);
      const boosted=v*(1-p.satBoost)+curved*p.satBoost;
      const warm=p.warmth*(1-v)*.5;
      o[i]=clamp(boosted*255+warm+(r()-.5)*p.grain*(1-v*.5));
    }return o;
  }});

  A.push({ id:'halation', name:'Halation', category:'effects', params:[
    {id:'radius',label:'Bloom Radius',min:2,max:30,step:1,default:10},
    {id:'threshold',label:'Threshold',min:100,max:240,step:5,default:180},
    {id:'strength',label:'Strength',min:0,max:1,step:.05,default:.4},
    {id:'tint',label:'Warm Tint',min:0,max:40,step:1,default:15}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),rad=p.radius;
    const bloom=new Float32Array(w*h);
    const temp=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n2=0;
      for(let dx=-rad;dx<=rad;dx++){const nx=x+dx;if(nx>=0&&nx<w){const v=clamp(px[y*w+nx]);
        if(v>p.threshold){s+=v;n2++;}}}temp[y*w+x]=n2>0?s/n2:0;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n2=0;
      for(let dy=-rad;dy<=rad;dy++){const ny=y+dy;if(ny>=0&&ny<h){const v=temp[ny*w+x];
        if(v>0){s+=v;n2++;}}}bloom[y*w+x]=n2>0?s/n2:0;}
    for(let i=0;i<w*h;i++){
      o[i]=clamp(clamp(px[i])+bloom[i]*p.strength+p.tint*(bloom[i]/255));
    }return o;
  }});

  A.push({ id:'silver-gelatin', name:'Silver Gelatin', category:'effects', params:[
    {id:'grain',label:'Grain',min:0,max:60,step:1,default:20},
    {id:'contrast',label:'Contrast',min:.5,max:2,step:.05,default:1.3},
    {id:'fog',label:'Fog Level',min:0,max:40,step:1,default:8},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:99}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255;
      v=Math.pow(v,1/p.contrast);
      v=v*(255-p.fog)+p.fog;
      const grain=(r()-.5)*p.grain;
      const cl=(r()<.15)?(r()-.5)*p.grain*2:0;
      o[i]=clamp(v+grain+cl);
    }return o;
  }});

  A.push({ id:'risograph-grain', name:'Riso Texture', category:'effects', params:[
    {id:'dotSize',label:'Dot Size',min:1,max:6,step:1,default:2},
    {id:'inkNoise',label:'Ink Noise',min:0,max:1,step:.05,default:.5},
    {id:'dryAreas',label:'Dry Areas',min:0,max:1,step:.05,default:.3},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:321}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ds=p.dotSize;
    for(let y=0;y<h;y+=ds)for(let x=0;x<w;x+=ds){
      const v=clamp(px[y*w+x])/255;
      const inkCoverage=r()<p.dryAreas&&v<.7?v*.5:v;
      const noise=(r()-.5)*p.inkNoise*80;
      for(let dy=0;dy<ds&&y+dy<h;dy++)for(let dx=0;dx<ds&&x+dx<w;dx++){
        const jitter=(r()-.5)*20*p.inkNoise;
        o[(y+dy)*w+x+dx]=clamp(inkCoverage*255+noise+jitter);
      }}return o;
  }});

  A.push({ id:'lith-print', name:'Lith Print', category:'effects', params:[
    {id:'infectious',label:'Infectious Dev.',min:0,max:1,step:.05,default:.6},
    {id:'grain',label:'Grain',min:0,max:60,step:1,default:25},
    {id:'highlight',label:'Highlight Color',min:0,max:40,step:1,default:15},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:111}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      const v=clamp(px[i])/255;
      let lithV;
      if(v<.4) lithV=v*v*p.infectious*2;
      else lithV=.4*p.infectious+(.6-.4)*(v-.4)/.6+v*(1-p.infectious);
      const warm=v>.6?p.highlight*(v-.6)/.4:0;
      o[i]=clamp(lithV*255+warm+(r()-.5)*p.grain*(1-v*.3));
    }return o;
  }});

  A.push({ id:'cyanotype', name:'Cyanotype Grain', category:'effects', params:[
    {id:'exposure',label:'Exposure',min:.5,max:2,step:.05,default:1},
    {id:'grain',label:'Paper Grain',min:0,max:50,step:1,default:20},
    {id:'bleed',label:'Chemical Bleed',min:0,max:5,step:1,default:2},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:77}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    let buf=new Float32Array(w*h);
    for(let i=0;i<w*h;i++) buf[i]=255-clamp(px[i]*p.exposure);
    if(p.bleed>0){const next=new Float32Array(buf);const bl=p.bleed;
      for(let y=bl;y<h-bl;y++)for(let x=bl;x<w-bl;x++){let s=0,n2=0;
        for(let dy=-bl;dy<=bl;dy++)for(let dx=-bl;dx<=bl;dx++){s+=buf[(y+dy)*w+x+dx];n2++;}
        next[y*w+x]=s/n2;}buf=next;}
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]+(r()-.5)*p.grain);
    return o;
  }});

  A.push({ id:'screen-grain', name:'Screen Grain', category:'effects', params:[
    {id:'pixelSize',label:'Pixel Size',min:1,max:4,step:1,default:1},
    {id:'scanlines',label:'Scanline Strength',min:0,max:1,step:.05,default:.3},
    {id:'noise',label:'Signal Noise',min:0,max:60,step:1,default:20},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ps=p.pixelSize;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const sx=Math.floor(x/ps)*ps,sy=Math.floor(y/ps)*ps;
      let v=clamp(px[Math.min(h-1,sy)*w+Math.min(w-1,sx)]);
      v*=1-p.scanlines*(y%2===0?.1:.0);
      v+=((r()-.5)*p.noise);
      o[y*w+x]=clamp(v);
    }return o;
  }});

  A.push({ id:'edge-glow', name:'Edge Glow', category:'effects', params:[
    {id:'threshold',label:'Edge Threshold',min:10,max:100,step:5,default:30},
    {id:'glow',label:'Glow Strength',min:0,max:1,step:.05,default:.5},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const e=sobelAt(px,x,y,w,h);
      const edgeV=Math.min(255,e.mag*p.glow*2);
      const v=clamp(px[y*w+x]);
      o[y*w+x]=p.invert?clamp(edgeV):clamp(v+edgeV*(1-v/255));
    }
    return o;
  }});

  A.push({ id:'emboss', name:'Emboss', category:'effects', params:[
    {id:'direction',label:'Light Direction',min:0,max:360,step:15,default:135},
    {id:'strength',label:'Strength',min:.5,max:3,step:.1,default:1},
    {id:'blend',label:'Source Blend',min:0,max:1,step:.05,default:.3}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const ang=p.direction*Math.PI/180;
    const dx2=Math.round(Math.cos(ang)),dy2=Math.round(Math.sin(ang));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      const nx=x+dx2,ny=y+dy2;
      let embossV=128;
      if(nx>=0&&nx<w&&ny>=0&&ny<h){
        embossV=128+(clamp(px[i])-clamp(px[ny*w+nx]))*p.strength;
      }
      o[i]=clamp(embossV*(1-p.blend)+clamp(px[i])*p.blend);
    }
    return o;
  }});

  A.push({ id:'vignette', name:'Vignette', category:'effects', params:[
    {id:'strength',label:'Strength',min:0,max:1,step:.05,default:.5},
    {id:'radius',label:'Radius',min:.3,max:1.5,step:.05,default:.8},
    {id:'softness',label:'Softness',min:.1,max:1,step:.05,default:.5}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const cx2=w/2,cy2=h/2;
    const maxDist=Math.sqrt(cx2*cx2+cy2*cy2)*p.radius;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      const t=Math.max(0,(dist-maxDist*(1-p.softness))/(maxDist*p.softness));
      const darken=1-Math.min(1,t)*p.strength;
      o[y*w+x]=clamp(clamp(px[y*w+x])*darken);
    }
    return o;
  }});

  A.push({ id:'bilateral-filter', name:'Bilateral Filter', category:'effects', params:[
    {id:'radius',label:'Radius',min:1,max:8,step:1,default:3},
    {id:'sigmaSpatial',label:'Spatial Sigma',min:1,max:10,step:.5,default:3},
    {id:'sigmaRange',label:'Range Sigma',min:5,max:80,step:5,default:30}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),rad=p.radius;
    const ss2=2*p.sigmaSpatial*p.sigmaSpatial;
    const sr2=2*p.sigmaRange*p.sigmaRange;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const cv=clamp(px[y*w+x]);
      let sum=0,wSum=0;
      for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
        const nx=x+dx,ny=y+dy;
        if(nx>=0&&nx<w&&ny>=0&&ny<h){
          const nv=clamp(px[ny*w+nx]);
          const spatialW=Math.exp(-(dx*dx+dy*dy)/ss2);
          const rangeW=Math.exp(-((cv-nv)**2)/sr2);
          const weight=spatialW*rangeW;
          sum+=nv*weight;wSum+=weight;
        }
      }
      o[y*w+x]=clamp(wSum>0?sum/wSum:cv);
    }
    return o;
  }});

  return A;
})();
