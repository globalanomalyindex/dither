/**
 * DITHER.js — 180+ dithering, halftone, sketch, painterly & artistic algorithms
 * Every algorithm: apply(Float32Array pixels, w, h, params) → Uint8ClampedArray
 */

const DitherAlgorithms = (() => {
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function mkRand(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

  function errorDiffusion(px, w, h, matrix, strength, serpentine, threshold, noise, errorScale, seed, gamma) {
    const out = new Uint8ClampedArray(w * h), buf = new Float32Array(px);
    const thr = threshold != null ? threshold : 128;
    const es = errorScale != null ? errorScale : 1;
    const ns = noise || 0;
    const gm = gamma != null ? gamma : 1;
    const r = ns > 0 ? mkRand(seed || 42) : null;
    for (let y = 0; y < h; y++) {
      const ltr = !serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x;
        let old = clamp(buf[i]);
        if (gm !== 1) old = Math.pow(old / 255, gm) * 255;
        if (r) old = clamp(old + (r() - 0.5) * ns * 2);
        const nv = old > thr ? 255 : 0;
        out[i] = nv;
        const err = (old - nv) * strength * es;
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

  // Precompute full-image sobel magnitude + angle grids. Calling sobelAt()
  // inside a hot loop (4000 dabs × bbox pixels × per-pixel edge checks) is
  // what makes painterly algorithms slow. Precomputing once is ~O(w*h) and
  // makes per-dab/per-pixel edge lookups O(1). Returns
  // { mag: Float32Array, ang: Float32Array } sized w*h.
  function sobelField(px, w, h) {
    const mag = new Float32Array(w * h);
    const ang = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      const ym1 = (y - 1) * w, yp1 = (y + 1) * w, yr = y * w;
      for (let x = 1; x < w - 1; x++) {
        const gx = px[ym1 + x + 1] + 2*px[yr + x + 1] + px[yp1 + x + 1]
                 - px[ym1 + x - 1] - 2*px[yr + x - 1] - px[yp1 + x - 1];
        const gy = px[yp1 + x - 1] + 2*px[yp1 + x] + px[yp1 + x + 1]
                 - px[ym1 + x - 1] - 2*px[ym1 + x] - px[ym1 + x + 1];
        const i = yr + x;
        mag[i] = Math.sqrt(gx*gx + gy*gy);
        ang[i] = Math.atan2(gy, gx);
      }
    }
    return { mag, ang };
  }

  // Local detail / variance grid, downsampled for speed. Used to let
  // painterly algorithms place fewer, larger strokes in low-variance areas
  // (sky, walls) and many small strokes in detailed areas. Block size is
  // coarse (8px) — gives a chunky "this area is busy / this one is smooth"
  // map without much cost. Returns Float32Array same size as px, with each
  // cell holding the local luminance standard deviation (0..~100).
  function detailField(px, w, h, block) {
    const B = block || 8;
    const d = new Float32Array(w * h);
    const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const blockStd = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let sum = 0, sumSq = 0, n = 0;
        const x0 = bx * B, y0 = by * B;
        const x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
        for (let yy = y0; yy < y1; yy++) {
          const yr = yy * w;
          for (let xx = x0; xx < x1; xx++) {
            const v = px[yr + xx]; sum += v; sumSq += v * v; n++;
          }
        }
        if (n > 0) {
          const mean = sum / n;
          const varc = Math.max(0, sumSq / n - mean * mean);
          blockStd[by * bw + bx] = Math.sqrt(varc);
        }
      }
    }
    // Expand block grid back to full resolution (nearest-neighbor)
    for (let y = 0; y < h; y++) {
      const by = (y / B) | 0;
      const brow = by * bw;
      const drow = y * w;
      for (let x = 0; x < w; x++) {
        d[drow + x] = blockStd[brow + ((x / B) | 0)];
      }
    }
    return d;
  }

  const A = [];

  function addED(id, name, matrix, cat='classic') {
    A.push({ id, name, category: cat, params: [
      { id:'strength', label:'Diffusion', min:0, max:1, step:.01, default:1 },
      { id:'serpentine', label:'Serpentine', type:'checkbox', default: id==='floyd-steinberg' },
      { id:'threshold', label:'Threshold', min:0, max:255, step:1, default:128 },
      { id:'noise', label:'Noise', min:0, max:100, step:1, default:0 },
      { id:'errorScale', label:'Error Scale', min:.1, max:3, step:.05, default:1 },
      { id:'gamma', label:'Gamma', min:.2, max:3, step:.05, default:1 },
      { id:'seed', label:'Seed', min:1, max:999, step:1, default:42 }
    ], apply(px,w,h,p) { return errorDiffusion(px,w,h,matrix,p.strength,p.serpentine,p.threshold,p.noise,p.errorScale,p.seed,p.gamma); }});
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
    {id:'size',label:'Matrix',type:'select',options:[{value:2,label:'2x2'},{value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'},{value:32,label:'32x32'},{value:64,label:'64x64'}],default:4},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'noise',label:'Noise',min:0,max:80,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const sz=+p.size, b=normBayer(sz), sp=p.spread, o=new Uint8ClampedArray(w*h);
    const ang=p.rotation*Math.PI/180, cosA=Math.cos(ang), sinA=Math.sin(ang);
    const r=p.noise>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA), ry=Math.round(-x*sinA+y*cosA);
      const bx=((rx%sz)+sz)%sz, by=((ry%sz)+sz)%sz;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      v+=(b[by][bx]-.5)*sp;
      if(r) v+=(r()-.5)*p.noise;
      const result=v>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'clustered-dot', name:'Clustered Dot', category:'ordered', params:[
    {id:'size',label:'Cluster Size',min:3,max:12,step:1,default:6},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const sz=p.size, o=new Uint8ClampedArray(w*h);
    const mat=Array.from({length:sz},()=>new Array(sz));
    const cx=sz/2,cy=sz/2;
    const indices=[];
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++) indices.push({x,y,d:Math.sqrt((x-cx+.5)**2+(y-cy+.5)**2)});
    indices.sort((a,b)=>a.d-b.d);
    for(let i=0;i<indices.length;i++) mat[indices[i].y][indices[i].x]=(i+.5)/(sz*sz);
    const ang=p.rotation*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA),ry=Math.round(-x*sinA+y*cosA);
      const bx=((rx%sz)+sz)%sz,by=((ry%sz)+sz)%sz;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=(v+(mat[by][bx]-.5)*p.spread)>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'blue-noise', name:'Blue Noise', category:'ordered', params:[
    {id:'scale',label:'Scale',min:1,max:8,step:1,default:2},
    {id:'strength',label:'Strength',min:0,max:255,step:1,default:128},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'warp',label:'Warp',min:0,max:1,step:.05,default:0},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),sc=p.scale;
    const phi = 1.618033988749895;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      let sx=Math.floor(x/sc),sy=Math.floor(y/sc);
      if(p.warp>0){
        const v=clamp(px[y*w+x])/255;
        sx+=Math.round(v*p.warp*4); sy+=Math.round(v*p.warp*4);
      }
      let bn=(sx*phi+sy*phi*phi)%1;
      bn=((bn*2654435761)>>>0)/4294967296;
      const i=y*w+x;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=(v+(bn-.5)*p.strength)>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'void-cluster', name:'Void & Cluster', category:'ordered', params:[
    {id:'size',label:'Pattern Size',min:4,max:16,step:4,default:8},
    {id:'spread',label:'Spread',min:32,max:255,step:1,default:160},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const sz=p.size, o=new Uint8ClampedArray(w*h);
    const mat=Array.from({length:sz},(_,y)=>Array.from({length:sz},(_,x)=>{
      let v=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const ny=((y+dy)%sz+sz)%sz,nx=((x+dx)%sz+sz)%sz;
        v+=Math.sin(nx*2.39996+ny*7.11)*0.5+0.5;}
      return v;
    }));
    let mn=Infinity,mx=-Infinity;
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++){if(mat[y][x]<mn)mn=mat[y][x];if(mat[y][x]>mx)mx=mat[y][x];}
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++) mat[y][x]=(mat[y][x]-mn)/(mx-mn);
    const ang=p.rotation*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA),ry=Math.round(-x*sinA+y*cosA);
      const bx=((rx%sz)+sz)%sz,by=((ry%sz)+sz)%sz;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=(v+(mat[by][bx]-.5)*p.spread)>p.threshold?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'checkerboard', name:'Checkerboard', category:'ordered', params:[
    {id:'size',label:'Cell Size',min:1,max:16,step:1,default:2},
    {id:'bias',label:'Threshold Bias',min:-128,max:128,step:1,default:0},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'contrast',label:'Check Contrast',min:0,max:120,step:1,default:40},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),sz=p.size;
    const ang=p.rotation*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=y*w+x;
      const rx=Math.round(x*cosA+y*sinA),ry=Math.round(-x*sinA+y*cosA);
      const checker=(Math.floor(((rx%sz)+sz)/sz)+Math.floor(((ry%sz)+sz)/sz))%2;
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      const result=v>(128+p.bias+checker*p.contrast-p.contrast/2)?255:0;
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'threshold-map', name:'Threshold Map', category:'ordered', params:[
    {id:'mapType',label:'Map',type:'select',options:[{value:'perlin',label:'Perlin-like'},{value:'worley',label:'Worley'},{value:'fbm',label:'FBM'}],default:'perlin'},
    {id:'scale',label:'Scale',min:.005,max:.1,step:.005,default:.02},
    {id:'contrast',label:'Contrast',min:.1,max:3,step:.1,default:1},
    {id:'offsetX',label:'Offset X',min:-100,max:100,step:1,default:0},
    {id:'offsetY',label:'Offset Y',min:-100,max:100,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h),sc=p.scale;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const mx=x+p.offsetX,my=y+p.offsetY;
      let threshold;
      if(p.mapType==='perlin'){threshold=(Math.sin(mx*sc*6.28)*Math.cos(my*sc*6.28)+Math.sin((mx+my)*sc*3.14)*.5+1.5)/3;}
      else if(p.mapType==='worley'){
        const gx=Math.floor(mx*sc*2),gy=Math.floor(my*sc*2);
        let minD=1e9;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const cx2=(gx+dx+.5+Math.sin((gx+dx)*12.9898+(gy+dy)*78.233)*.5)/sc/2;
          const cy2=(gy+dy+.5+Math.sin((gy+dy)*12.9898+(gx+dx)*78.233)*.5)/sc/2;
          const d=Math.sqrt((mx-cx2)**2+(my-cy2)**2)*sc;if(d<minD)minD=d;}
        threshold=Math.min(1,minD*2);}
      else{let n=0,amp=1,freq=1,ma=0;for(let oc=0;oc<4;oc++){
        n+=(Math.sin(mx*sc*freq*6.28)*Math.cos(my*sc*freq*4.17)+1)/2*amp;ma+=amp;amp*=.5;freq*=2;}
        threshold=n/ma;}
      threshold=.5+(threshold-.5)*p.contrast;
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const result=v>threshold?255:0;
      o[y*w+x]=p.invert?255-result:result;
    }return o;
  }});

  A.push({ id:'truchet', name:'Truchet Tiles', category:'ordered', params:[
    {id:'tileSize',label:'Tile Size',min:4,max:24,step:2,default:10},
    {id:'style',label:'Style',type:'select',options:[{value:'arc',label:'Quarter Arcs'},{value:'triangle',label:'Triangles'},{value:'maze',label:'Maze'}],default:'arc'},
    {id:'lineWidth',label:'Line Width',min:.1,max:.8,step:.05,default:.5},
    {id:'contrast',label:'Contrast',min:.3,max:1,step:.05,default:.7},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed),ts=p.tileSize;
    for(let ty=0;ty<h;ty+=ts)for(let tx=0;tx<w;tx+=ts){
      const midX=Math.min(w-1,tx+ts/2),midY=Math.min(h-1,ty+ts/2);
      let v=clamp(px[midY*w+midX])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const flip=v<.5;
      for(let dy=0;dy<ts&&ty+dy<h;dy++)for(let dx=0;dx<ts&&tx+dx<w;dx++){
        const nx=dx/ts,ny=dy/ts;let inside=false;
        if(p.style==='arc'){
          if(flip){const d1=Math.sqrt(nx*nx+ny*ny),d2=Math.sqrt((1-nx)**2+(1-ny)**2);inside=d1<p.lineWidth||d2<p.lineWidth;}
          else{const d1=Math.sqrt((1-nx)**2+ny*ny),d2=Math.sqrt(nx*nx+(1-ny)**2);inside=d1<p.lineWidth||d2<p.lineWidth;}
        }else if(p.style==='triangle'){inside=flip?nx+ny<1:nx+ny>1;}
        else{inside=flip?(dx<ts/2)===(dy<ts/2):(dx<ts/2)!==(dy<ts/2);}
        if(inside&&v<p.contrast)o[(ty+dy)*w+tx+dx]=p.invert?255:0;
      }}return o;
  }});

  // ═══════════════════════════════════════════
  // HALFTONE & SCREEN (8)
  // ═══════════════════════════════════════════
  A.push({ id:'halftone', name:'Halftone', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:30,step:1,default:6},
    {id:'angle',label:'Angle',min:0,max:180,step:1,default:45},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'line',label:'Line'},{value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'ring',label:'Ring'},{value:'ellipse',label:'Ellipse'}],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:0},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.42},
    {id:'jitter',label:'Jitter',min:0,max:1,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h), ds=p.dotSize, ang=p.angle*Math.PI/180;
    const cos=Math.cos(ang), sin=Math.sin(ang), soft=p.softness;
    const r=p.jitter>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let rx=x*cos+y*sin, ry=-x*sin+y*cos;
      if(r){rx+=(r()-.5)*p.jitter*ds;ry+=(r()-.5)*p.jitter*ds;}
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
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.dotGain;
      let result;
      if(soft>0){ const s2=d-t; result=clamp(128-s2/soft*128); }
      else result=d<t?255:0;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'cmyk-halftone', name:'CMYK Halftone', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:20,step:1,default:6},
    {id:'cAngle',label:'C Angle',min:0,max:90,step:5,default:15},
    {id:'mAngle',label:'M Angle',min:0,max:90,step:5,default:75},
    {id:'yAngle',label:'Y Angle',min:0,max:90,step:5,default:0},
    {id:'kAngle',label:'K Angle',min:0,max:90,step:5,default:45},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.42},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'ellipse',label:'Ellipse'}],default:'circle'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const ang=p.kAngle*Math.PI/180;
    const cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      let d;
      if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='ellipse') d=Math.sqrt(nx*nx*1.5+ny*ny*0.7);
      else d=Math.sqrt(nx*nx+ny*ny);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.dotGain;
      let result;
      if(p.softness>0){const s2=d-t;result=clamp(128-s2/p.softness*128);}
      else result=d<t?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'stochastic-screen', name:'Stochastic Screen', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:1,max:8,step:1,default:2},
    {id:'regularity',label:'Regularity',min:0,max:1,step:.05,default:.5},
    {id:'dotScale',label:'Dot Scale',min:.2,max:2,step:.05,default:.7},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),ds=p.dotSize;
    o.fill(p.invert?0:255);
    for(let y=0;y<h;y+=ds)for(let x=0;x<w;x+=ds){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const jx=(r()-.5)*(1-p.regularity)*ds*2;
      const jy=(r()-.5)*(1-p.regularity)*ds*2;
      const dotR=ds*(1-v)*p.dotScale+0.5;
      for(let dy=-ds;dy<=ds*2;dy++)for(let dx=-ds;dx<=ds*2;dx++){
        const fx=x+dx+Math.round(jx),fy=y+dy+Math.round(jy);
        if(fx>=0&&fx<w&&fy>=0&&fy<h){
          const dist=Math.sqrt((dx-ds/2)**2+(dy-ds/2)**2);
          if(dist<dotR) o[fy*w+fx]=p.invert?255:0;
        }
      }
    }
    return o;
  }});

  A.push({ id:'am-halftone', name:'AM Halftone', category:'halftone', params:[
    {id:'lpi',label:'Lines/Inch',min:2,max:20,step:1,default:8},
    {id:'angle',label:'Screen Angle',min:0,max:90,step:5,default:45},
    {id:'gain',label:'Dot Gain',min:0,max:1,step:.05,default:.2},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'},{value:'line',label:'Line'}],default:'circle'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),cell=Math.max(2,Math.round(w/p.lpi/6));
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%cell)+cell)%cell,cy2=((ry%cell)+cell)%cell;
      const nx=(cx2/cell-.5)*2,ny=(cy2/cell-.5)*2;
      let d;
      if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else if(p.shape==='line') d=Math.abs(ny);
      else d=Math.sqrt(nx*nx+ny*ny);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*(1+p.gain)*1.2;
      const result=d<t?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'fm-halftone', name:'FM Halftone', category:'halftone', params:[
    {id:'minDot',label:'Min Dot',min:1,max:4,step:1,default:1},
    {id:'maxDot',label:'Max Dot',min:2,max:8,step:1,default:4},
    {id:'cutoff',label:'White Cutoff',min:.8,max:1,step:.01,default:.95},
    {id:'spacing',label:'Spacing',min:.3,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const step=Math.max(1,Math.round(p.maxDot*p.spacing));
    for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
      let v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
      if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.cutoff)continue;
      const dotR=p.minDot+(p.maxDot-p.minDot)*(1-v);
      const cx2=x+Math.floor(r()*step*.5),cy2=y+Math.floor(r()*step*.5);
      for(let dy=-p.maxDot;dy<=p.maxDot;dy++)for(let dx=-p.maxDot;dx<=p.maxDot;dx++){
        const fx=cx2+dx,fy=cy2+dy;
        if(fx>=0&&fx<w&&fy>=0&&fy<h&&Math.sqrt(dx*dx+dy*dy)<=dotR)o[fy*w+fx]=p.invert?255:0;
      }
    }
    return o;
  }});

  A.push({ id:'mezzotint', name:'Mezzotint', category:'halftone', params:[
    {id:'style',label:'Style',type:'select',options:[{value:'fine',label:'Fine'},{value:'medium',label:'Medium'},{value:'coarse',label:'Coarse'},{value:'worm',label:'Worm'},{value:'stroke',label:'Stroke'}],default:'medium'},
    {id:'density',label:'Density',min:.2,max:2,step:.05,default:.8},
    {id:'angle',label:'Angle Bias',min:0,max:180,step:5,default:0},
    {id:'length',label:'Mark Length',min:.5,max:3,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    const sizes={fine:1,medium:2,coarse:4,worm:2,stroke:3};
    const sz=sizes[p.style]||2;
    const inkV=p.invert?255:0, paperV=p.invert?0:255;
    if(p.style==='worm'||p.style==='stroke'){
      o.fill(paperV);
      const count=w*h/(sz*sz)*p.density;
      const angBias=p.angle*Math.PI/180;
      for(let i=0;i<count;i++){
        let cx2=r()*w,cy2=r()*h;
        let sv=clamp(px[Math.min(h-1,Math.round(cy2))*w+Math.min(w-1,Math.round(cx2))])/255;
        if(p.gamma!==1) sv=Math.pow(sv,p.gamma);
        if(r()<sv)continue;
        const baseLen=p.style==='worm'?Math.round(3+r()*8):Math.round(2+r()*5);
        const len=Math.round(baseLen*p.length);
        const ang2=p.angle>0?angBias+(r()-.5)*1:r()*Math.PI;
        for(let t=0;t<len;t++){
          const fx=Math.round(cx2),fy=Math.round(cy2);
          if(fx>=0&&fx<w&&fy>=0&&fy<h)o[fy*w+fx]=inkV;
          cx2+=Math.cos(ang2)*(p.style==='worm'?1+r():1.5);
          cy2+=Math.sin(ang2)*(p.style==='worm'?1+r():1.5);
        }
      }
    } else {
      for(let y=0;y<h;y+=sz)for(let x=0;x<w;x+=sz){
        let v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
        if(p.gamma!==1) v=Math.pow(v,p.gamma);
        const ink=r()>v?inkV:paperV;
        for(let dy=0;dy<sz&&y+dy<h;dy++)for(let dx=0;dx<sz&&x+dx<w;dx++)
          o[(y+dy)*w+x+dx]=ink;
      }
    }
    return o;
  }});

  A.push({ id:'newsprint', name:'Newsprint', category:'halftone', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:16,step:1,default:6},
    {id:'angle',label:'Angle',min:0,max:90,step:5,default:45},
    {id:'paperTone',label:'Paper Tone',min:150,max:255,step:1,default:240},
    {id:'inkDensity',label:'Ink Density',min:.3,max:1.5,step:.05,default:.85},
    {id:'inkDarkness',label:'Ink Darkness',min:0,max:80,step:1,default:40},
    {id:'bleed',label:'Ink Bleed',min:0,max:1,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'shape',label:'Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'}],default:'circle'}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      let d;
      if(p.shape==='diamond') d=Math.abs(nx)+Math.abs(ny);
      else if(p.shape==='square') d=Math.max(Math.abs(nx),Math.abs(ny));
      else d=Math.sqrt(nx*nx+ny*ny);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.inkDensity*1.42;
      if(d<t){
        const edge=p.bleed>0?clamp(val*p.inkDarkness+(d/t)*p.bleed*60):clamp(val*p.inkDarkness);
        o[y*w+x]=edge;
      } else o[y*w+x]=p.paperTone;
    }
    return o;
  }});

  A.push({ id:'rosette', name:'Rosette Pattern', category:'halftone', params:[
    {id:'dotSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'petals',label:'Petals',min:3,max:12,step:1,default:6},
    {id:'petalDepth',label:'Petal Depth',min:0,max:1,step:.05,default:.3},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.2},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.3},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),ds=p.dotSize;
    const rAng=p.rotation*Math.PI/180,cosR=Math.cos(rAng),sinR=Math.sin(rAng);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const rx=x*cosR+y*sinR,ry=-x*sinR+y*cosR;
      const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
      const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
      const ang2=Math.atan2(ny,nx);
      const r2=Math.sqrt(nx*nx+ny*ny);
      const petal=0.5+0.5*Math.cos(ang2*p.petals);
      const d=r2*(1-petal*p.petalDepth);
      let val=clamp(px[y*w+x])/255; if(p.gamma!==1) val=Math.pow(val,p.gamma);
      const t=(1-val)*p.dotGain;
      let result;
      if(p.softness>0){const s2=d-t;result=clamp(128-s2/p.softness*128);}
      else result=d<t?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // LINES & HATCHING (15)
  // ═══════════════════════════════════════════
  A.push({ id:'horizontal-lines', name:'Horizontal Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:4},
    {id:'thickness',label:'Thickness',min:1,max:10,step:1,default:2},
    {id:'wobble',label:'Wobble',min:0,max:5,step:.25,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const wy=r?y+Math.sin(x*0.1)*p.wobble*2+(r()-.5)*p.wobble:y;
      const linePhase=((wy%p.spacing)+p.spacing)%p.spacing;
      const result=linePhase<p.thickness&&v<(1-linePhase/p.spacing)?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'vertical-lines', name:'Vertical Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:4},
    {id:'thickness',label:'Thickness',min:1,max:10,step:1,default:2},
    {id:'wobble',label:'Wobble',min:0,max:5,step:.25,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const wx=r?x+Math.sin(y*0.1)*p.wobble*2+(r()-.5)*p.wobble:x;
      const linePhase=((wx%p.spacing)+p.spacing)%p.spacing;
      const result=linePhase<p.thickness&&v<(1-linePhase/p.spacing)?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'diagonal-lines', name:'Diagonal Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:2,max:20,step:1,default:5},
    {id:'angle',label:'Angle',min:0,max:180,step:5,default:45},
    {id:'thickness',label:'Thickness',min:1,max:8,step:1,default:2},
    {id:'wobble',label:'Wobble',min:0,max:3,step:.1,default:0},
    {id:'taper',label:'Taper',min:0,max:1,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h), ang=p.angle*Math.PI/180;
    const cos=Math.cos(ang),sin=Math.sin(ang);
    const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const wb=r?(r()-.5)*p.wobble:0;
      const proj=Math.abs((x*cos+y*sin+wb)%p.spacing);
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const lineWidth=p.thickness*(1-v*p.taper);
      const result=proj<lineWidth?0:255;
      o[y*w+x]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'crosshatch', name:'Crosshatch', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:20,step:1,default:6},
    {id:'layers',label:'Layers',min:1,max:6,step:1,default:3},
    {id:'angle',label:'Base Angle',min:0,max:90,step:5,default:45},
    {id:'lineWeight',label:'Line Weight',min:.5,max:4,step:.25,default:1.5},
    {id:'wobble',label:'Wobble',min:0,max:3,step:.1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h); o.fill(p.invert?0:255);
    const angles=[p.angle,p.angle+90,p.angle+45,p.angle+135,p.angle+22,p.angle+67];
    const r=p.wobble>0?mkRand(p.seed):null;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const layersNeeded=Math.ceil((1-v)*p.layers);
      for(let l=0;l<layersNeeded;l++){
        const a=angles[l%6]*Math.PI/180;
        const wb=r?(r()-.5)*p.wobble:0;
        const proj=Math.abs((x*Math.cos(a)+y*Math.sin(a)+wb)%p.spacing);
        const thresh=0.4+(l*0.12);
        if(proj<p.lineWeight&&v<thresh) { o[y*w+x]=p.invert?255:0; break; }
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
    {id:'thickness',label:'Line Width',min:.5,max:4,step:.25,default:1},
    {id:'curvature',label:'Curvature',min:0,max:1,step:.05,default:.6},
    {id:'cutoff',label:'White Cutoff',min:.7,max:1,step:.01,default:.92},
    {id:'densityLayers',label:'Density Layers',min:1,max:3,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.cutoff)continue;
      const e=sobelAt(px,x,y,w,h);
      const hatchAng=e.ang+Math.PI/2;
      const proj=Math.abs((x*Math.cos(hatchAng)+y*Math.sin(hatchAng))%p.spacing);
      const lineW=p.thickness*(1-v*0.5);
      if(proj<lineW){o[y*w+x]=p.invert?255:0;continue;}
      if(p.densityLayers>=2&&v<.5){
        const proj2=Math.abs((x*Math.cos(hatchAng+.5)+y*Math.sin(hatchAng+.5))%(p.spacing*1.3));
        if(proj2<lineW*.7){o[y*w+x]=p.invert?255:0;continue;}
      }
      if(p.densityLayers>=3&&v<.25){
        const proj3=Math.abs((x*Math.cos(hatchAng+1)+y*Math.sin(hatchAng+1))%(p.spacing*1.6));
        if(proj3<lineW*.5) o[y*w+x]=p.invert?255:0;
      }
    }
    return o;
  }});

  A.push({ id:'engraving', name:'Engraving Lines', category:'lines', params:[
    {id:'lineSpacing',label:'Line Spacing',min:2,max:10,step:1,default:3},
    {id:'angle',label:'Angle',min:0,max:180,step:5,default:45},
    {id:'thickness',label:'Swell',min:.5,max:4,step:.25,default:1.5},
    {id:'curvature',label:'Curvature',min:0,max:1,step:.05,default:.5},
    {id:'crosshatch',label:'Cross Lines',type:'checkbox',default:false},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:90},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    const ang2=(p.angle+p.crossAngle)*Math.PI/180,cos2=Math.cos(ang2),sin2=Math.sin(ang2);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const proj=(x*cos+y*sin);
      const lineIdx=Math.round(proj/p.lineSpacing);
      const swell=p.thickness*(1-v);
      const curveOffset=p.curvature*(v-.5)*p.lineSpacing*0.5;
      const adjustedDist=Math.abs(proj+curveOffset-lineIdx*p.lineSpacing);
      if(adjustedDist<swell){o[y*w+x]=p.invert?255:0;continue;}
      if(p.crosshatch&&v<.45){
        const proj2=(x*cos2+y*sin2);
        const lineIdx2=Math.round(proj2/p.lineSpacing);
        const co2=p.curvature*(v-.5)*p.lineSpacing*0.5;
        const ad2=Math.abs(proj2+co2-lineIdx2*p.lineSpacing);
        if(ad2<swell*.7) o[y*w+x]=p.invert?255:0;
      }
    }
    return o;
  }});

  A.push({ id:'stipple', name:'Stipple', category:'lines', params:[
    {id:'density',label:'Density',min:500,max:30000,step:500,default:8000},
    {id:'dotSize',label:'Dot Size',min:1,max:6,step:1,default:1},
    {id:'variableSize',label:'Variable Size',type:'checkbox',default:false},
    {id:'regularity',label:'Regularity',min:0,max:1,step:.05,default:.3},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const inkV=p.invert?255:0;
    for(let i=0;i<p.density;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(r()<v)continue;
      const ds=p.variableSize?Math.max(1,Math.round(p.dotSize*(1-v))):p.dotSize;
      const gx=p.regularity>0?Math.round(x/(ds*3))*(ds*3):x;
      const gy=p.regularity>0?Math.round(y/(ds*3))*(ds*3):y;
      const fx=Math.round(x*(1-p.regularity)+gx*p.regularity);
      const fy=Math.round(y*(1-p.regularity)+gy*p.regularity);
      for(let dy=-ds+1;dy<ds;dy++)for(let dx=-ds+1;dx<ds;dx++){
        if(dx*dx+dy*dy<ds*ds){
          const px2=fx+dx,py2=fy+dy;
          if(px2>=0&&px2<w&&py2>=0&&py2<h) o[py2*w+px2]=inkV;
        }
      }
    }
    return o;
  }});

  A.push({ id:'wave-lines', name:'Wave Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:20,step:1,default:6},
    {id:'amplitude',label:'Amplitude',min:0,max:15,step:.5,default:3},
    {id:'frequency',label:'Frequency',min:.01,max:.3,step:.01,default:.05},
    {id:'thickness',label:'Thickness',min:.5,max:5,step:.25,default:1.5},
    {id:'harmonics',label:'Harmonics',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      let wave=0;
      for(let h2=1;h2<=p.harmonics;h2++) wave+=Math.sin(x*p.frequency*h2)*(p.amplitude/h2);
      wave*=(1-v);
      const proj=((y+wave)%p.spacing+p.spacing)%p.spacing;
      const lineW=p.thickness*(1-v);
      if(proj<lineW||p.spacing-proj<lineW) o[y*w+x]=p.invert?255:0;
    }
    return o;
  }});

  A.push({ id:'concentric-lines', name:'Concentric Lines', category:'lines', params:[
    {id:'spacing',label:'Ring Spacing',min:3,max:20,step:1,default:6},
    {id:'centerX',label:'Center X',min:0,max:1,step:.05,default:.5},
    {id:'centerY',label:'Center Y',min:0,max:1,step:.05,default:.5},
    {id:'thickness',label:'Thickness',min:.5,max:5,step:.25,default:1.5},
    {id:'wobble',label:'Wobble',min:0,max:5,step:.25,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const cx2=w*p.centerX,cy2=h*p.centerY;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      let dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      if(p.wobble>0){const a=Math.atan2(y-cy2,x-cx2);dist+=Math.sin(a*8)*p.wobble;}
      const ring=dist%p.spacing;
      const lineW=p.thickness*(1-v);
      if(ring<lineW) o[y*w+x]=p.invert?255:0;
    }
    return o;
  }});

  A.push({ id:'spiral-lines', name:'Spiral Lines', category:'lines', params:[
    {id:'spacing',label:'Spacing',min:3,max:15,step:1,default:5},
    {id:'tightness',label:'Tightness',min:.5,max:3,step:.1,default:1},
    {id:'centerX',label:'Center X',min:0,max:1,step:.05,default:.5},
    {id:'centerY',label:'Center Y',min:0,max:1,step:.05,default:.5},
    {id:'thickness',label:'Thickness',min:.3,max:4,step:.1,default:1.2},
    {id:'direction',label:'Direction',type:'select',options:[{value:'cw',label:'Clockwise'},{value:'ccw',label:'Counter-CW'},{value:'double',label:'Double Spiral'}],default:'cw'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const cx2=w*p.centerX,cy2=h*p.centerY;
    const dir=p.direction==='ccw'?-1:1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
      const ang2=Math.atan2(y-cy2,x-cx2)*dir;
      const spiral=((dist-ang2/(2*Math.PI)*p.spacing*p.tightness)%p.spacing+p.spacing)%p.spacing;
      const lineW=p.thickness*(1-v);
      let hit=spiral<lineW||p.spacing-spiral<lineW;
      if(!hit&&p.direction==='double'){
        const spiral2=((dist+ang2/(2*Math.PI)*p.spacing*p.tightness)%p.spacing+p.spacing)%p.spacing;
        hit=spiral2<lineW||p.spacing-spiral2<lineW;
      }
      if(hit) o[y*w+x]=p.invert?255:0;
    }
    return o;
  }});

  A.push({ id:'woodcut', name:'Woodcut', category:'lines', params:[
    {id:'lineWidth',label:'Line Width',min:1,max:8,step:1,default:3},
    {id:'contrast',label:'Contrast',min:.5,max:3,step:.1,default:1.5},
    {id:'angle',label:'Grain Angle',min:0,max:180,step:5,default:30},
    {id:'variation',label:'Variation',min:0,max:1,step:.05,default:.4},
    {id:'cutoff',label:'Cut Depth',min:.4,max:1,step:.05,default:.75},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:false},
    {id:'edgeWeight',label:'Edge Weight',min:20,max:120,step:5,default:50},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const ang=p.angle*Math.PI/180,cos=Math.cos(ang),sin=Math.sin(ang);
    const inkV=p.invert?255:0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255;
      v=Math.pow(v,1/p.contrast);
      const proj=x*cos+y*sin;
      const wobble=Math.sin(proj*0.1+r()*p.variation*10)*p.variation*2;
      const linePhase=(proj+wobble)%(p.lineWidth*2);
      const cutWidth=p.lineWidth*(1-v)*1.5;
      if(linePhase<cutWidth&&v<p.cutoff) o[y*w+x]=inkV;
      if(p.edgeLines){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>p.edgeWeight) o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  A.push({ id:'linocut', name:'Linocut', category:'lines', params:[
    {id:'blockSize',label:'Block Size',min:2,max:10,step:1,default:4},
    {id:'cutDepth',label:'Cut Depth',min:.2,max:1,step:.05,default:.6},
    {id:'texture',label:'Texture',min:0,max:1,step:.05,default:.3},
    {id:'angle',label:'Grain Angle',min:0,max:180,step:5,default:0},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:false},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);const r=mkRand(p.seed),bs=p.blockSize;
    const ang=p.angle*Math.PI/180,cosA=Math.cos(ang),sinA=Math.sin(ang);
    const cutV=p.invert?0:255, inkV=p.invert?255:0, texV=p.invert?0:255;
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
      let v=clamp(px[Math.min(h-1,y)*w+Math.min(w-1,x)])/255;
      if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const cut=v>p.cutDepth;
      for(let dy=0;dy<bs&&y+dy<h;dy++)for(let dx=0;dx<bs&&x+dx<w;dx++){
        if(cut){
          o[(y+dy)*w+x+dx]=cutV;
        }else{
          const grainCheck=p.angle>0?Math.sin(((x+dx)*cosA+(y+dy)*sinA)*0.5)>.3:true;
          const tex=r()<p.texture&&grainCheck?texV:inkV;
          o[(y+dy)*w+x+dx]=tex;
        }
      }
    }
    if(p.edgeLines){
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>50) o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  A.push({ id:'etching', name:'Etching', category:'lines', params:[
    {id:'lineSpacing',label:'Line Spacing',min:2,max:10,step:1,default:3},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:75},
    {id:'baseAngle',label:'Base Angle',min:0,max:90,step:5,default:45},
    {id:'depth',label:'Depth',min:.2,max:1,step:.05,default:.7},
    {id:'lineWeight',label:'Line Weight',min:.3,max:3,step:.1,default:1},
    {id:'crossWeight',label:'Cross Weight',min:.3,max:2,step:.1,default:.8},
    {id:'irregularity',label:'Irregularity',min:0,max:1,step:.05,default:.2},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const a1=p.baseAngle*Math.PI/180,a2=(p.baseAngle+p.crossAngle)*Math.PI/180;
    const inkV=p.invert?255:0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.depth)continue;
      const wobble=(r()-.5)*p.irregularity*2;
      const p1=Math.abs((x*Math.cos(a1)+y*Math.sin(a1)+wobble)%p.lineSpacing);
      if(p1<p.lineWeight){o[y*w+x]=inkV;continue;}
      if(v<p.depth*0.6){
        const p2=Math.abs((x*Math.cos(a2)+y*Math.sin(a2)+wobble)%p.lineSpacing);
        if(p2<p.crossWeight)o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ARTISTIC & PAINTERLY (12)
  // ═══════════════════════════════════════════
  A.push({ id:'overshot-sketch', name:'Overshot Sketch', category:'artistic', params:[
    {id:'lineCount',label:'Lines',min:500,max:12000,step:500,default:3000},
    {id:'overshoot',label:'Overshoot',min:0,max:1.5,step:.05,default:.4},
    {id:'wobble',label:'Wobble',min:0,max:2,step:.05,default:.3},
    {id:'thickness',label:'Thickness',min:1,max:5,step:1,default:1},
    {id:'minLength',label:'Min Length',min:2,max:15,step:1,default:5},
    {id:'maxLength',label:'Max Length',min:8,max:40,step:1,default:15},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) { const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    for(let i=0;i<p.lineCount;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(r()>1-v+.08)continue;
      let ang=r()*Math.PI;
      if(x>2&&x<w-3&&y>2&&y<h-3){
        const gx=clamp(px[y*w+x+1])-clamp(px[y*w+x-1]);
        const gy=clamp(px[(y+1)*w+x])-clamp(px[(y-1)*w+x]);
        ang=Math.atan2(gx,-gy)+r()*.4;}
      const baseLen=(1-v)*p.maxLength+p.minLength;
      const ovLen=baseLen*(1+p.overshoot*(r()*.5+.5));
      const dx=Math.cos(ang),dy=Math.sin(ang);
      for(let t=-ovLen/2;t<ovLen/2;t++){
        const wobbleX=(r()-.5)*p.wobble*2,wobbleY=(r()-.5)*p.wobble*2;
        for(let ww=0;ww<p.thickness;ww++){
          const fx=Math.round(x+dx*t+wobbleX-dy*ww),fy=Math.round(y+dy*t+wobbleY+dx*ww);
          if(fx>=0&&fx<w&&fy>=0&&fy<h){
            const edgeFade=Math.abs(t)/(ovLen/2);
            if(edgeFade<.85||r()>.3){
              const mark=edgeFade>.7?128:0;
              o[fy*w+fx]=p.invert?Math.max(o[fy*w+fx],255-mark):Math.min(o[fy*w+fx],mark);
            }
          }}}
    }return o;
  }});

  A.push({ id:'gesture-drawing', name:'Gesture Drawing', category:'artistic', params:[
    {id:'strokes',label:'Strokes',min:200,max:8000,step:200,default:1500},
    {id:'strokeLen',label:'Stroke Length',min:10,max:120,step:5,default:30},
    {id:'speed',label:'Speed/Looseness',min:0,max:1,step:.05,default:.6},
    {id:'thickness',label:'Thickness',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
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
    {id:'splatCount',label:'Splats',min:20,max:800,step:10,default:100},
    {id:'maxRadius',label:'Max Radius',min:2,max:60,step:1,default:15},
    {id:'drips',label:'Drip Length',min:0,max:50,step:1,default:8},
    {id:'droplets',label:'Droplet Count',min:0,max:10,step:1,default:5},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
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
    {id:'darkness',label:'Darkness',min:.5,max:3,step:.05,default:1.2},
    {id:'patchiness',label:'Patchiness',min:0,max:.5,step:.02,default:.1},
    {id:'blurRadius',label:'Smudge Radius',min:1,max:10,step:1,default:5},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255;
      v=Math.pow(v,p.darkness);
      const grain=(r()-.5)*p.grain*80;
      const patch=r()<p.patchiness?40:0;
      o[i]=clamp(v*255+grain+patch);
    }
    if(p.smudge>0){
      const rad=Math.round(p.blurRadius*p.smudge);
      const tmp=new Uint8ClampedArray(o);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let sum=0,n2=0;
        for(let dx=-rad;dx<=rad;dx++){
          const nx=x+dx;if(nx>=0&&nx<w){sum+=tmp[y*w+nx];n2++;}
        }
        o[y*w+x]=clamp(sum/n2*p.smudge+tmp[y*w+x]*(1-p.smudge));
      }
    }
    if(p.invert) for(let i=0;i<w*h;i++) o[i]=255-o[i];
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
    {id:'brushSize',label:'Brush Size',min:2,max:20,step:1,default:6},
    {id:'detail',label:'Detail Passes',min:1,max:6,step:1,default:3},
    {id:'strokeLength',label:'Stroke Length',min:.3,max:2,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
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
    {id:'dotSize',label:'Dot Size',min:2,max:15,step:1,default:4},
    {id:'density',label:'Density',min:.2,max:1,step:.05,default:.7},
    {id:'jitter',label:'Color Jitter',min:0,max:60,step:1,default:15},
    {id:'background',label:'Background',min:200,max:255,step:1,default:240},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
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
    // — Core shape —
    {id:'size',label:'Knife Size',min:4,max:40,step:1,default:10},
    {id:'smear',label:'Smear Length',min:5,max:100,step:1,default:15},
    {id:'pressure',label:'Pressure',min:.1,max:1.5,step:.05,default:.9},
    // — Pixel-paint behavior (NEW defaults are crisp/dithered, like paint engine) —
    {id:'strokeStyle',label:'Stroke Style',type:'select',options:[
      {value:'pixel',label:'Pixel (sharp, dithered, samples source)'},
      {value:'blend',label:'Blend (smooth/legacy)'}
    ],default:'pixel'},
    {id:'coverageDensity',label:'Coverage Density',min:.1,max:1,step:.05,default:.85},
    {id:'sampleDrift',label:'Sample Drift',min:0,max:1,step:.05,default:.55},
    {id:'sampleJitter',label:'Sample Jitter (px)',min:0,max:12,step:.5,default:2},
    {id:'canvasStart',label:'Canvas',type:'select',options:[
      {value:'underpaint',label:'Painterly underpaint (mosaic of source tones)'},
      {value:'source',label:'From source (filter feel)'},
      {value:'clean',label:'From blank canvas'}
    ],default:'underpaint'},
    {id:'bgTone',label:'Blank BG Tone',min:0,max:255,step:1,default:255},
    {id:'underpaintBlock',label:'Underpaint Block Size',min:4,max:40,step:1,default:14},
    {id:'underpaintPosterize',label:'Underpaint Posterize',min:2,max:32,step:1,default:12},
    // — Detail awareness (human-like placement) —
    {id:'detailAware',label:'Detail Awareness',min:0,max:2,step:.05,default:1},
    {id:'sizeByDetail',label:'Size by Detail',min:0,max:1.5,step:.05,default:.8},
    {id:'skipSmoothAreas',label:'Skip Smooth Areas',min:0,max:1,step:.05,default:.4},
    // — Wet paint (bleed/streak/smudge) —
    {id:'wetBleed',label:'Wet Bleed',min:0,max:1,step:.05,default:0},
    {id:'wetSmudge',label:'Wet Smudge',min:0,max:1,step:.05,default:0},
    {id:'wetStreak',label:'Wet Streak',min:0,max:1,step:.05,default:0},
    {id:'colorVariety',label:'Color Variety (multi-color stroke)',min:0,max:1,step:.05,default:.2},
    // — Intensity & layering —
    {id:'intensity',label:'Intensity',min:.3,max:3,step:.05,default:1.2},
    {id:'layers',label:'Layered Passes',min:1,max:5,step:1,default:1},
    // — Light/shadow/edge sensitivity —
    {id:'edgeSensitivity',label:'Edge Sensitivity',min:0,max:2,step:.05,default:0},
    {id:'lightShadowBias',label:'Light/Shadow Bias',min:-1,max:1,step:.05,default:0},
    {id:'sizeByLight',label:'Size from Luminance',min:-1,max:1,step:.05,default:0},
    {id:'lengthByEdge',label:'Length from Edge',min:0,max:1,step:.05,default:0},
    {id:'pressureByEdge',label:'Pressure from Edge',min:0,max:1,step:.05,default:0},
    // — Stroke randomness —
    {id:'angleJitter',label:'Angle Jitter',min:0,max:2,step:.05,default:.5},
    {id:'pressureJitter',label:'Pressure Jitter',min:0,max:1,step:.05,default:0},
    // — Blend-mode legacy control —
    {id:'colorPickup',label:'Color Pickup (blend only)',min:-1,max:1,step:.05,default:0},
    // — Brush shape —
    {id:'brushShape',label:'Brush Shape',type:'select',options:[
      {value:'default',label:'Built-in knife edge'},
      {value:'0',label:'Round Soft'},
      {value:'1',label:'Round Hard'},
      {value:'2',label:'Flat'},
      {value:'3',label:'Splatter'},
      {value:'4',label:'Noise'},
      {value:'5',label:'Stipple'},
      {value:'6',label:'Rake'},
      {value:'7',label:'Dry Brush'},
      {value:'8',label:'Charcoal'},
      {value:'9',label:'Fan'}
    ],default:'default'},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    // Sync drain: runs the generator to completion with no yields. Zero
    // behavioral diff vs. the original synchronous body.
    const gen = this._gen(px, w, h, p);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  },
  // Cooperative async variant: yields between chunks of rows and between
  // layers. Checks signal.cancelled at each yield point and calls onProgress
  // with a snapshot of the in-progress canvas so the UI can paint block-by-
  // block progress instead of freezing. Same output as apply().
  async applyAsync(px, w, h, p, ctx) {
    const signal = (ctx && ctx.signal) || { cancelled: false };
    const onProgress = (ctx && ctx.onProgress) || null;
    const gen = this._gen(px, w, h, p);
    let r = gen.next();
    let lastProg = 0;
    while (!r.done) {
      if (signal.cancelled) { try { gen.return(); } catch(_){} return r.value || new Uint8ClampedArray(w*h); }
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (onProgress && r.value && now - lastProg > 60) {
        lastProg = now;
        onProgress(new Uint8ClampedArray(r.value));
      }
      await new Promise(res => setTimeout(res, 0));
      r = gen.next();
    }
    return r.value;
  },
  *_gen(px, w, h, p) {
    const o = new Uint8ClampedArray(w*h);

    const strokeStyle = p.strokeStyle || 'pixel';
    const intensity     = (p.intensity     != null) ? p.intensity     : 1;
    const layers        = Math.max(1, (p.layers    != null) ? p.layers|0 : 1);
    const edgeSens      = (p.edgeSensitivity != null) ? p.edgeSensitivity : 0;
    const lsBias        = (p.lightShadowBias != null) ? p.lightShadowBias : 0;
    const sizeByLight   = (p.sizeByLight  != null) ? p.sizeByLight  : 0;
    const lengthByEdge  = (p.lengthByEdge != null) ? p.lengthByEdge : 0;
    const pressureByEdge= (p.pressureByEdge != null) ? p.pressureByEdge : 0;
    const angleJitter   = (p.angleJitter  != null) ? p.angleJitter  : 0.5;
    const pressureJit   = (p.pressureJitter != null) ? p.pressureJitter : 0;
    const coverageDensity = (p.coverageDensity != null) ? p.coverageDensity : 0.85;
    const sampleDrift   = (p.sampleDrift  != null) ? p.sampleDrift  : 0.55;
    const sampleJitter  = (p.sampleJitter != null) ? p.sampleJitter : 2;
    const canvasStart   = p.canvasStart || 'underpaint';
    const bgTone        = (p.bgTone != null) ? p.bgTone : 255;
    const underpaintBlock    = (p.underpaintBlock    != null) ? p.underpaintBlock|0    : 14;
    const underpaintPosterize= (p.underpaintPosterize!= null) ? p.underpaintPosterize|0: 12;
    const colorPickup   = (p.colorPickup != null) ? p.colorPickup : 0;
    const detailAware    = (p.detailAware     != null) ? p.detailAware     : 1;
    const sizeByDetail   = (p.sizeByDetail    != null) ? p.sizeByDetail    : 0.8;
    const skipSmoothAreas= (p.skipSmoothAreas != null) ? p.skipSmoothAreas : 0.4;
    const wetBleed       = (p.wetBleed        != null) ? p.wetBleed        : 0;
    const wetSmudge      = (p.wetSmudge       != null) ? p.wetSmudge       : 0;
    const wetStreak      = (p.wetStreak       != null) ? p.wetStreak       : 0;
    const colorVariety   = (p.colorVariety    != null) ? p.colorVariety    : 0.2;
    const brushShape    = p.brushShape || 'default';
    const seedI         = (p.seed|0) || 42;

    // Spatial hash → [0,1). Deterministic per (x,y,k); identical across RGB
    // channels in color mode so stroke samples come from the SAME source
    // positions in R, G, B — producing real multi-color strokes.
    function sh(a, b, k) {
      let h = Math.imul((a|0) + 374761393, 0x9E3779B1) ^
              Math.imul((b|0) + 2246822519, 0x85EBCA77) ^
              Math.imul((k|0) + 3266489917, 0xC2B2AE3D) ^ seedI;
      h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // PaintEngine brush mask
    let bMask = null, bSize = 0;
    if (brushShape !== 'default' && typeof PaintEngine !== 'undefined' && PaintEngine.getBrushMask) {
      const bi = parseInt(brushShape, 10);
      if (!isNaN(bi)) {
        const b = PaintEngine.getBrushMask(bi);
        if (b) { bMask = b.mask; bSize = b.size; }
      }
    }

    // Legacy blend mode keeps the old alpha-blend path (documented as a
    // non-default fallback for users who want the smooth feel).
    if (strokeStyle === 'blend') {
      return _paletteKnifeBlend(px, w, h, p, {
        intensity, layers, edgeSens, lsBias, sizeByLight, lengthByEdge,
        pressureByEdge, angleJitter, pressureJit, colorPickup, bMask, bSize
      });
    }

    // PIXEL mode — sharp, dithered, real source pixels in every stroke.
    // Start canvas:
    //   'underpaint' = mosaic of posterized source colors (painterly base;
    //                  output looks RECONSTRUCTED from paint, not filtered)
    //   'source'     = raw source (filter feel; minimal stroke coverage leaves
    //                  the image legible everywhere)
    //   'clean'      = blank bgTone (classic impressionism base, reveals paint
    //                  only where strokes land)
    if (canvasStart === 'clean') {
      for (let i = 0; i < w*h; i++) o[i] = bgTone;
    } else if (canvasStart === 'underpaint') {
      const bsz = Math.max(3, underpaintBlock);
      const steps = Math.max(2, Math.min(32, underpaintPosterize));
      const blocksW = Math.ceil(w / bsz);
      const blocksH = Math.ceil(h / bsz);
      const blockVals = new Uint8ClampedArray(blocksW * blocksH);
      for (let by = 0; by < blocksH; by++) {
        for (let bx = 0; bx < blocksW; bx++) {
          // 4-sample grid within the block; average + posterize + slight
          // stochastic tone jitter (hash-based) to prevent banding.
          let sum = 0, cnt = 0;
          for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
            const xs = Math.min(w-1, bx*bsz + Math.floor((sx+0.5)*bsz/2));
            const ys = Math.min(h-1, by*bsz + Math.floor((sy+0.5)*bsz/2));
            sum += clamp(px[ys*w+xs]); cnt++;
          }
          const avg = sum / cnt;
          const q = Math.round(avg / 255 * (steps-1)) / (steps-1) * 255;
          blockVals[by*blocksW+bx] = Math.max(0, Math.min(255, q | 0));
        }
      }
      // Fill o with block value + small per-pixel hash-dither so the base
      // is painterly-mottled, not purely blocky.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const bx = (x / bsz) | 0, by = (y / bsz) | 0;
          const base = blockVals[by*blocksW + bx];
          const dither = (sh(x, y, 300) - 0.5) * 10;  // ~±5 of tone jitter
          o[y*w+x] = Math.max(0, Math.min(255, (base + dither) | 0));
        }
      }
    } else {
      for (let i = 0; i < w*h; i++) o[i] = clamp(px[i]);
    }

    // Precompute edge field + detail field once — the old code was calling
    // sobelAt() per pixel inside hot loops, which dominated the runtime.
    const sf = sobelField(px, w, h);
    const edgeMag = sf.mag, edgeAng = sf.ang;
    const needDetail = detailAware > 0 || sizeByDetail > 0 || skipSmoothAreas > 0;
    const detail = needDetail ? detailField(px, w, h, 8) : null;

    const baseSp = Math.max(2, Math.round(p.size * 0.8));

    // Chunk cadence for cooperative yielding: `yield o` here lets applyAsync
    // pause the browser event loop + report progress. In sync apply() drain,
    // these yields become no-op wrappers.
    const ROW_CHUNK = 12;

    for (let layer = 0; layer < layers; layer++) {
      const layerAng = (layers > 1) ? (layer / layers) * Math.PI * 0.35 : 0;
      const ox = (layer * (baseSp >> 1)) % baseSp;
      const oy = (layer * (baseSp >> 2)) % baseSp;

      let rowsThisChunk = 0;
      for (let y = oy; y < h; y += baseSp) {
        for (let x = ox; x < w; x += baseSp) {
        const ex = Math.min(w-2, Math.max(1, x));
        const ey = Math.min(h-2, Math.max(1, y));
        const eIdx = ey * w + ex;
        const eMag = edgeMag[eIdx], eAng = edgeAng[eIdx];
        const edgeN = Math.min(1, eMag / 120);
        const lum = clamp(px[y*w+x]) / 255;

        // — Detail-aware placement: smooth-area strokes get skipped more
        //   aggressively so the knife doesn't plaster a flat sky with 50
        //   identical strokes (a human would just put a few big ones).
        let localDetail = 0;  // 0..1
        if (detail) {
          localDetail = Math.min(1, detail[y * w + x] / 40);
          if (skipSmoothAreas > 0) {
            const keepProb = localDetail + (1 - skipSmoothAreas * 0.8);
            if (sh(x, y, 120) > Math.min(1, keepProb)) continue;
          }
        }

        // Per-stroke random decisions use position-hash, NOT a call-ordered
        // RNG, so R/G/B channels make identical decisions (coherent color).
        if (edgeSens > 0) {
          const accept = 1 - edgeSens * 0.5 + edgeN * edgeSens * 0.9;
          if (sh(x, y, 1) > accept) continue;
        }
        if (lsBias !== 0) {
          const target = lsBias > 0 ? lum : (1 - lum);
          if (sh(x, y, 2) > 0.3 + target * Math.abs(lsBias) * 0.7) continue;
        }

        const ang = eAng + Math.PI/2 + (sh(x, y, 3) - 0.5) * angleJitter + layerAng;
        const dx = Math.cos(ang), dy = Math.sin(ang);

        // Detail-aware knife size: in smooth regions, make strokes bigger
        // and longer (painterly sky sweep); in detailed regions, keep small.
        let detailSizeMul = 1;
        if (detail && sizeByDetail > 0) {
          const smoothFactor = 1 - localDetail;
          detailSizeMul = 1 + smoothFactor * sizeByDetail * 3.0;
        }

        const sizeMul = 1 + (sizeByLight > 0 ? lum : (1 - lum)) * Math.abs(sizeByLight) * 1.8;
        const knifeW = Math.max(1.5, p.size * sizeMul * detailSizeMul);

        const lenBase = p.smear * (0.5 + sh(x, y, 4) * 0.5) * detailSizeMul;
        const realSmearLen = lenBase * (1 + edgeN * lengthByEdge * 2.5);
        // WET STREAK extends the smear with a decaying tail — long painterly
        // drag from a loaded brush.
        const streakExt = wetStreak > 0 ? realSmearLen * wetStreak * 1.5 : 0;
        const smearLen = realSmearLen + streakExt;

        const jitterMul = pressureJit > 0 ? (1 + (sh(x, y, 5) - 0.5) * pressureJit) : 1;
        const edgeBoost = pressureByEdge > 0 ? (1 + edgeN * pressureByEdge * 2) : 1;
        const pressure = Math.max(0, Math.min(2, p.pressure * intensity * jitterMul * edgeBoost));

        // Color-variety radius: lets a single stroke reveal multiple source
        // colors via additional per-pixel sample offsets. Like fiber-bundle
        // behavior in the paint engine.
        const varietyRadius = colorVariety * knifeW * 0.6;
        const smudgeDrag = wetSmudge * realSmearLen * 0.5;

        // Sample-origin drift: sampleDrift=0 → stroke keeps smearing the
        // origin pixel. sampleDrift=1 → each stamp samples from the CURRENT
        // stroke position. Mid = partial smear that reveals color variation.
        const originX = x, originY = y;

        // Brush-stamp inner loop
        if (bMask && bSize > 0) {
          const stampSz = Math.max(1, knifeW * 0.5);
          const invStamp = 1 / (2 * stampSz);
          const halfMask = (bSize - 1) / 2;
          for (let t = 0; t < smearLen; t++) {
            const fx = Math.round(x + dx*t), fy = Math.round(y + dy*t);
            if (fx < 0 || fx >= w || fy < 0 || fy >= h) break;
            // Decay: during real smear it linearly fades; in streak-tail it
            // fades faster (so you get a long thinning tail not a uniform bar).
            const inReal = t < realSmearLen;
            const decay = inReal
              ? 1 - t / realSmearLen
              : Math.max(0, 1 - (t - realSmearLen) / Math.max(1e-6, streakExt)) * 0.5;
            // Drifting sample origin along the stroke
            let sOrigX = originX + (fx - originX) * sampleDrift;
            let sOrigY = originY + (fy - originY) * sampleDrift;
            // WET SMUDGE drags the sample back along stroke — colors from
            // earlier in the stroke bleed into the tail.
            if (wetSmudge > 0) {
              const dragT = t / Math.max(1, realSmearLen);
              sOrigX -= dx * smudgeDrag * Math.min(1, dragT);
              sOrigY -= dy * smudgeDrag * Math.min(1, dragT);
            }

            for (let by = -stampSz; by <= stampSz; by++) {
              const wy2 = Math.round(fy + by);
              if (wy2 < 0 || wy2 >= h) continue;
              for (let bx = -stampSz; bx <= stampSz; bx++) {
                const wx2 = Math.round(fx + bx);
                if (wx2 < 0 || wx2 >= w) continue;
                const lxr =  bx * dx + by * dy;
                const lyr = -bx * dy + by * dx;
                const mx = Math.round(halfMask + lxr * invStamp * bSize);
                const my = Math.round(halfMask + lyr * invStamp * bSize);
                if (mx < 0 || mx >= bSize || my < 0 || my >= bSize) continue;
                const maskV = bMask[my * bSize + mx];
                if (maskV < 0.01) continue;
                const prob = Math.min(1, maskV * decay * pressure * coverageDensity);
                if (sh(wx2, wy2, 10 + ((t|0) & 3)) > prob) continue;
                const jx = sampleJitter > 0 ? (sh(wx2, wy2, 20) - 0.5) * sampleJitter * 2 : 0;
                const jy = sampleJitter > 0 ? (sh(wx2, wy2, 21) - 0.5) * sampleJitter * 2 : 0;
                const vx = varietyRadius > 0 ? (sh(wx2, wy2, 50 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
                const vy = varietyRadius > 0 ? (sh(wx2, wy2, 51 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
                const sXi = Math.max(0, Math.min(w-1, Math.round(sOrigX + jx + vx)));
                const sYi = Math.max(0, Math.min(h-1, Math.round(sOrigY + jy + vy)));
                o[wy2 * w + wx2] = clamp(px[sYi * w + sXi]);
              }
            }
          }
        } else {
          // Built-in knife edge — a narrow perpendicular strip
          const halfKnife = Math.max(1, knifeW / 3);
          for (let t = 0; t < smearLen; t++) {
            const fx = Math.round(x + dx*t), fy = Math.round(y + dy*t);
            if (fx < 0 || fx >= w || fy < 0 || fy >= h) break;
            const inReal = t < realSmearLen;
            const decay = inReal
              ? 1 - t / realSmearLen
              : Math.max(0, 1 - (t - realSmearLen) / Math.max(1e-6, streakExt)) * 0.5;
            let sOrigX = originX + (fx - originX) * sampleDrift;
            let sOrigY = originY + (fy - originY) * sampleDrift;
            if (wetSmudge > 0) {
              const dragT = t / Math.max(1, realSmearLen);
              sOrigX -= dx * smudgeDrag * Math.min(1, dragT);
              sOrigY -= dy * smudgeDrag * Math.min(1, dragT);
            }
            for (let ww = -halfKnife; ww < halfKnife; ww++) {
              const wx2 = Math.round(fx - dy*ww);
              const wy2 = Math.round(fy + dx*ww);
              if (wx2 < 0 || wx2 >= w || wy2 < 0 || wy2 >= h) continue;
              const edgeFalloff = 1 - Math.abs(ww) / Math.max(1, halfKnife);
              const prob = Math.min(1, edgeFalloff * decay * pressure * coverageDensity);
              if (sh(wx2, wy2, 10 + ((t|0) & 3)) > prob) continue;
              const jx = sampleJitter > 0 ? (sh(wx2, wy2, 20) - 0.5) * sampleJitter * 2 : 0;
              const jy = sampleJitter > 0 ? (sh(wx2, wy2, 21) - 0.5) * sampleJitter * 2 : 0;
              const vx = varietyRadius > 0 ? (sh(wx2, wy2, 50 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
              const vy = varietyRadius > 0 ? (sh(wx2, wy2, 51 + (t & 3)) - 0.5) * varietyRadius * 2 : 0;
              const sXi = Math.max(0, Math.min(w-1, Math.round(sOrigX + jx + vx)));
              const sYi = Math.max(0, Math.min(h-1, Math.round(sOrigY + jy + vy)));
              o[wy2 * w + wx2] = clamp(px[sYi * w + sXi]);
            }
          }
        }
        }  // end x-loop
        rowsThisChunk++;
        if (rowsThisChunk >= ROW_CHUNK) {
          rowsThisChunk = 0;
          yield o;  // cooperative pause — applyAsync sees this; sync drain ignores.
        }
      }  // end y-loop
      yield o;
    }

    // — Post-pass: WET BLEED (capillary spread, crisp) —
    //   Dithered pixel-swap with random neighbor; no blur because we COPY
    //   source-palette pixels rather than averaging.
    if (wetBleed > 0) {
      const bleedRadius = Math.max(1, Math.round(wetBleed * 3));
      const bleedProb = wetBleed * 0.45;
      const tmp = new Uint8ClampedArray(o);
      for (let y = 1; y < h - 1; y++) {
        const yr = y * w;
        for (let x = 1; x < w - 1; x++) {
          if (sh(x, y, 200) > bleedProb) continue;
          const dx = Math.round((sh(x, y, 201) - 0.5) * 2 * bleedRadius);
          const dy = Math.round((sh(x, y, 202) - 0.5) * 2 * bleedRadius);
          const nx = Math.max(0, Math.min(w-1, x + dx));
          const ny = Math.max(0, Math.min(h-1, y + dy));
          o[yr + x] = tmp[ny * w + nx];
        }
        if ((y & 31) === 0) yield o;
      }
    }

    return o;
  }});

  // Legacy smooth-blend implementation kept for the 'blend' stroke style.
  function _paletteKnifeBlend(px, w, h, p, ctx) {
    const { intensity, layers, edgeSens, lsBias, sizeByLight, lengthByEdge,
            pressureByEdge, angleJitter, pressureJit, colorPickup, bMask, bSize } = ctx;
    const o = new Uint8ClampedArray(w*h);
    const r = mkRand(p.seed);
    const buf = new Float32Array(px);
    const baseSp = Math.max(2, Math.round(p.size * 0.8));

    for (let layer = 0; layer < layers; layer++) {
      const layerAng = (layers > 1) ? (layer / layers) * Math.PI * 0.35 : 0;
      const ox = (layer * (baseSp >> 1)) % baseSp;
      const oy = (layer * (baseSp >> 2)) % baseSp;
      for (let y = oy; y < h; y += baseSp) for (let x = ox; x < w; x += baseSp) {
        const e = sobelAt(px, Math.min(w-2, Math.max(1, x)), Math.min(h-2, Math.max(1, y)), w, h);
        const edgeN = Math.min(1, e.mag / 120);
        const lum = clamp(buf[y*w+x]) / 255;
        if (edgeSens > 0) { const accept = 1 - edgeSens * 0.5 + edgeN * edgeSens * 0.9; if (r() > accept) continue; }
        if (lsBias !== 0) { const target = lsBias > 0 ? lum : (1 - lum); if (r() > 0.3 + target * Math.abs(lsBias) * 0.7) continue; }
        const ang = e.ang + Math.PI/2 + (r() - 0.5) * angleJitter + layerAng;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const sizeMul = 1 + (sizeByLight > 0 ? lum : (1 - lum)) * Math.abs(sizeByLight) * 1.8;
        const knifeW = p.size * sizeMul;
        const lenBase = p.smear * (0.5 + r() * 0.5);
        const smearLen = lenBase * (1 + edgeN * lengthByEdge * 2.5);
        const jitterMul = pressureJit > 0 ? (1 + (r() - 0.5) * pressureJit) : 1;
        const edgeBoost = pressureByEdge > 0 ? (1 + edgeN * pressureByEdge * 2) : 1;
        const pressure = Math.max(0, Math.min(2, p.pressure * intensity * jitterMul * edgeBoost));
        let paint = clamp(buf[y*w+x]);
        for (let t = 0; t < smearLen; t++) {
          const fx = Math.round(x + dx*t), fy = Math.round(y + dy*t);
          if (fx < 0 || fx >= w || fy < 0 || fy >= h) break;
          if (bMask && bSize > 0) {
            const stampSz = Math.max(1, knifeW * 0.5);
            const invStamp = 1 / (2 * stampSz);
            const halfMask = (bSize - 1) / 2;
            for (let by = -stampSz; by <= stampSz; by++) {
              const wy2 = Math.round(fy + by); if (wy2 < 0 || wy2 >= h) continue;
              for (let bx = -stampSz; bx <= stampSz; bx++) {
                const wx2 = Math.round(fx + bx); if (wx2 < 0 || wx2 >= w) continue;
                const lxr =  bx * dx + by * dy;
                const lyr = -bx * dy + by * dx;
                const mx = Math.round(halfMask + lxr * invStamp * bSize);
                const my = Math.round(halfMask + lyr * invStamp * bSize);
                if (mx < 0 || mx >= bSize || my < 0 || my >= bSize) continue;
                const maskV = bMask[my * bSize + mx]; if (maskV < 0.01) continue;
                const decay = 1 - t/smearLen;
                const alpha = Math.min(1, decay * pressure * 0.6 * maskV);
                const stickiness = Math.max(0.5, Math.min(1, 0.98 + colorPickup * 0.02));
                paint = paint * stickiness + buf[wy2*w+wx2] * (1 - stickiness);
                buf[wy2*w+wx2] = buf[wy2*w+wx2] * (1 - alpha) + paint * alpha;
              }
            }
          } else {
            const halfKnife = knifeW / 3;
            for (let ww = -halfKnife; ww < halfKnife; ww++) {
              const wx2 = Math.round(fx - dy*ww);
              const wy2 = Math.round(fy + dx*ww);
              if (wx2 >= 0 && wx2 < w && wy2 >= 0 && wy2 < h) {
                const decay = 1 - t/smearLen;
                const alpha = Math.min(1, decay * pressure * 0.6);
                const stickiness = Math.max(0.5, Math.min(1, 0.98 + colorPickup * 0.02));
                paint = paint * stickiness + buf[wy2*w+wx2] * (1 - stickiness);
                buf[wy2*w+wx2] = buf[wy2*w+wx2] * (1 - alpha) + paint * alpha;
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < w*h; i++) o[i] = clamp(buf[i]);
    return o;
  }

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
    {id:'lines',label:'Contour Lines',min:3,max:50,step:1,default:15},
    {id:'thickness',label:'Thickness',min:1,max:6,step:1,default:2},
    {id:'smoothing',label:'Smoothing',min:0,max:1,step:.05,default:.6},
    {id:'fillBetween',label:'Fill Between',type:'checkbox',default:false},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const inkV=p.invert?255:0;
    const step=255/(p.lines+1);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      let v=clamp(px[y*w+x]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      let vn=clamp(px[y*w+x+1]); if(p.gamma!==1) vn=Math.pow(vn/255,p.gamma)*255;
      let vs=clamp(px[(y+1)*w+x]); if(p.gamma!==1) vs=Math.pow(vs/255,p.gamma)*255;
      if(p.fillBetween){
        const band=Math.floor(v/step);
        if(band%2===0) o[y*w+x]=inkV;
        continue;
      }
      for(let level=1;level<=p.lines;level++){
        const threshold=level*step;
        if((v>=threshold&&vn<threshold)||(v<threshold&&vn>=threshold)||
           (v>=threshold&&vs<threshold)||(v<threshold&&vs>=threshold)){
          for(let dy=-p.thickness+1;dy<p.thickness;dy++)for(let dx=-p.thickness+1;dx<p.thickness;dx++){
            if(dx*dx+dy*dy<p.thickness*p.thickness){
              const fx=x+dx,fy=y+dy;
              if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
            }
          }
          break;
        }
      }
    }
    return o;
  }});

  A.push({ id:'pen-ink', name:'Pen & Ink', category:'sketch', params:[
    {id:'lineWeight',label:'Line Weight',min:.3,max:4,step:.1,default:1},
    {id:'hatchAngle',label:'Hatch Angle',min:0,max:180,step:5,default:45},
    {id:'fillDensity',label:'Fill Density',min:2,max:15,step:1,default:5},
    {id:'crosshatch',label:'Crosshatch',type:'checkbox',default:true},
    {id:'crossAngle',label:'Cross Angle',min:30,max:150,step:5,default:90},
    {id:'crossThreshold',label:'Cross Threshold',min:.1,max:.8,step:.05,default:.45},
    {id:'solidThreshold',label:'Solid Fill',min:0,max:.4,step:.02,default:.15},
    {id:'edgeLines',label:'Edge Lines',type:'checkbox',default:true},
    {id:'edgeThreshold',label:'Edge Threshold',min:20,max:150,step:5,default:60},
    {id:'edgeWeight',label:'Edge Weight',min:1,max:4,step:1,default:1},
    {id:'hatchCutoff',label:'Hatch Cutoff',min:.4,max:1,step:.05,default:.75},
    {id:'wobble',label:'Wobble',min:0,max:2,step:.1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const inkV=p.invert?255:0;
    const a1=p.hatchAngle*Math.PI/180;
    const cos1=Math.cos(a1),sin1=Math.sin(a1);
    const a2=(p.hatchAngle+p.crossAngle)*Math.PI/180;
    const cos2=Math.cos(a2),sin2=Math.sin(a2);
    // Hatching fill
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      const wb=p.wobble>0?(r()-.5)*p.wobble:0;
      // Primary hatching
      const proj1=Math.abs((x*cos1+y*sin1+wb)%p.fillDensity);
      if(proj1<p.lineWeight&&v<p.hatchCutoff) {o[y*w+x]=inkV;continue;}
      // Crosshatch for darker areas
      if(p.crosshatch&&v<p.crossThreshold){
        const proj2=Math.abs((x*cos2+y*sin2+wb)%p.fillDensity);
        if(proj2<p.lineWeight) {o[y*w+x]=inkV;continue;}
      }
      // Very dark = solid fill
      if(v<p.solidThreshold) {o[y*w+x]=inkV;continue;}
    }
    // Edge lines
    if(p.edgeLines){
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const e=sobelAt(px,x,y,w,h);
        if(e.mag>p.edgeThreshold){
          for(let ew=0;ew<p.edgeWeight;ew++){
            const fx=x+Math.round(Math.cos(e.ang)*ew),fy=y+Math.round(Math.sin(e.ang)*ew);
            if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
          }
        }
      }
    }
    return o;
  }});

  A.push({ id:'comic-lines', name:'Comic Lines', category:'sketch', params:[
    {id:'edgeThreshold',label:'Edge Threshold',min:10,max:150,step:5,default:50},
    {id:'lineThickness',label:'Line Thickness',min:1,max:6,step:1,default:2},
    {id:'screenDots',label:'Screen Dots',type:'checkbox',default:true},
    {id:'screenSize',label:'Screen Size',min:3,max:16,step:1,default:6},
    {id:'screenAngle',label:'Screen Angle',min:0,max:90,step:5,default:0},
    {id:'screenShape',label:'Screen Shape',type:'select',options:[{value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'line',label:'Lines'}],default:'circle'},
    {id:'shadeCutoff',label:'Shade Cutoff',min:.3,max:.9,step:.05,default:.6},
    {id:'fillDensity',label:'Fill Density',min:.3,max:1.5,step:.05,default:.7},
    {id:'solidBlacks',label:'Solid Blacks',min:0,max:.3,step:.02,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);
    const inkV=p.invert?255:0, paperV=p.invert?0:255;
    // Edge detection for outlines
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const e=sobelAt(px,x,y,w,h);
      if(e.mag>p.edgeThreshold){
        for(let dy=-p.lineThickness+1;dy<p.lineThickness;dy++)for(let dx=-p.lineThickness+1;dx<p.lineThickness;dx++){
          if(dx*dx+dy*dy<p.lineThickness*p.lineThickness){
            const fx=x+dx,fy=y+dy;
            if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
          }
        }
      }
    }
    // Screen for shading
    if(p.screenDots){
      const ds=p.screenSize;
      const sAng=p.screenAngle*Math.PI/180,cosS=Math.cos(sAng),sinS=Math.sin(sAng);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        if(o[y*w+x]===inkV)continue;
        let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
        if(v<p.solidBlacks){o[y*w+x]=inkV;continue;}
        if(v>p.shadeCutoff)continue;
        const rx=x*cosS+y*sinS,ry=-x*sinS+y*cosS;
        const cx2=((rx%ds)+ds)%ds,cy2=((ry%ds)+ds)%ds;
        const nx=(cx2/ds-.5)*2,ny=(cy2/ds-.5)*2;
        let d;
        if(p.screenShape==='diamond') d=Math.abs(nx)+Math.abs(ny);
        else if(p.screenShape==='line') d=Math.abs(ny);
        else d=Math.sqrt(nx*nx+ny*ny);
        const t=(1-v)*1.2*p.fillDensity;
        if(d<t) o[y*w+x]=inkV;
      }
    }
    return o;
  }});

  A.push({ id:'architectural', name:'Architectural Sketch', category:'sketch', params:[
    {id:'lineWeight',label:'Line Weight',min:.5,max:4,step:.25,default:1.5},
    {id:'hatching',label:'Hatching Density',min:3,max:15,step:1,default:6},
    {id:'hatchAngle',label:'Hatch Angle',min:0,max:180,step:5,default:45},
    {id:'edgeSensitivity',label:'Edge Detail',min:10,max:150,step:5,default:40},
    {id:'shadowCutoff',label:'Shadow Cutoff',min:.3,max:1,step:.05,default:.65},
    {id:'hatchWeight',label:'Hatch Weight',min:.3,max:3,step:.1,default:1},
    {id:'crosshatch',label:'Cross-hatch',type:'checkbox',default:false},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);o.fill(p.invert?0:255);const r=mkRand(p.seed);
    const inkV=p.invert?255:0;
    const hAng=p.hatchAngle*Math.PI/180,cosH=Math.cos(hAng),sinH=Math.sin(hAng);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const e=sobelAt(px,x,y,w,h);
      if(e.mag>p.edgeSensitivity){
        const lw=Math.round(Math.min(p.lineWeight,1+e.mag/200));
        for(let dd=0;dd<lw;dd++){
          const fx=x+Math.round(Math.cos(e.ang)*dd);
          const fy=y+Math.round(Math.sin(e.ang)*dd);
          if(fx>=0&&fx<w&&fy>=0&&fy<h) o[fy*w+fx]=inkV;
        }
      }
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(o[y*w+x]===inkV)continue;
      let v=clamp(px[y*w+x])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      if(v>p.shadowCutoff)continue;
      const proj=Math.abs((x*cosH+y*sinH)%p.hatching);
      if(proj<p.hatchWeight) o[y*w+x]=p.invert?clamp(255-(100+v*155)):clamp(100+v*155);
      if(p.crosshatch&&v<p.shadowCutoff*.5){
        const proj2=Math.abs((-x*sinH+y*cosH)%(p.hatching*1.3));
        if(proj2<p.hatchWeight*.7) o[y*w+x]=p.invert?clamp(255-(80+v*155)):clamp(80+v*155);
      }
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
    {id:'iterations',label:'Iterations',min:5,max:80,step:5,default:15},
    {id:'feed',label:'Feed Rate',min:.01,max:.08,step:.002,default:.055},
    {id:'kill',label:'Kill Rate',min:.04,max:.07,step:.001,default:.062},
    {id:'imageMix',label:'Image Influence',min:0,max:1,step:.05,default:.5},
    {id:'scale',label:'Scale',min:.2,max:2,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
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
    for(let i=0;i<w*h;i++){let v=(1-b[i])*255;if(p.gamma!==1)v=Math.pow(clamp(v)/255,p.gamma)*255;o[i]=p.invert?255-clamp(v):clamp(v);}
    return o;
  }});

  A.push({ id:'pixel-sort', name:'Pixel Sort', category:'exotic', params:[
    {id:'threshold',label:'Threshold',min:10,max:240,step:5,default:80},
    {id:'upperThreshold',label:'Upper Threshold',min:30,max:255,step:5,default:255},
    {id:'direction',label:'Direction',type:'select',options:[{value:'h',label:'Horizontal'},{value:'v',label:'Vertical'},{value:'d',label:'Diagonal'}],default:'h'},
    {id:'mode',label:'Mode',type:'select',options:[{value:'dark',label:'Dark First'},{value:'light',label:'Light First'},{value:'random',label:'Random'}],default:'dark'},
    {id:'minRunLength',label:'Min Run',min:1,max:50,step:1,default:1},
    {id:'maxRunLength',label:'Max Run',min:10,max:500,step:10,default:500},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    const buf=new Float32Array(px);
    if(p.gamma!==1) for(let i=0;i<w*h;i++) buf[i]=Math.pow(clamp(buf[i])/255,p.gamma)*255;
    const rng=p.mode==='random'?mkRand(p.seed):null;
    function sortSeg(seg){
      if(seg.length<p.minRunLength)return seg;
      const s=seg.slice(0,Math.min(seg.length,p.maxRunLength));
      if(p.mode==='random'){s.sort(()=>rng()-.5);}
      else s.sort((a2,b2)=>p.mode==='dark'?a2-b2:b2-a2);
      return s.concat(seg.slice(s.length));
    }
    if(p.direction==='h'){
      for(let y=0;y<h;y++){
        let start=-1;
        for(let x=0;x<=w;x++){
          const v=x<w?clamp(buf[y*w+x]):256;
          const inRange=v>=p.threshold&&v<=p.upperThreshold;
          if(inRange&&start===-1) start=x;
          else if(!inRange&&start!==-1){
            const seg=[];
            for(let sx=start;sx<x;sx++) seg.push(clamp(buf[y*w+sx]));
            const sorted=sortSeg(seg);
            for(let sx=start;sx<x;sx++) buf[y*w+sx]=sorted[sx-start];
            start=-1;
          }
        }
      }
    } else if(p.direction==='v'){
      for(let x=0;x<w;x++){
        let start=-1;
        for(let y=0;y<=h;y++){
          const v=y<h?clamp(buf[y*w+x]):256;
          const inRange=v>=p.threshold&&v<=p.upperThreshold;
          if(inRange&&start===-1) start=y;
          else if(!inRange&&start!==-1){
            const seg=[];
            for(let sy=start;sy<y;sy++) seg.push(clamp(buf[sy*w+x]));
            const sorted=sortSeg(seg);
            for(let sy=start;sy<y;sy++) buf[sy*w+x]=sorted[sy-start];
            start=-1;
          }
        }
      }
    }
    for(let i=0;i<w*h;i++) o[i]=clamp(buf[i]);
    return o;
  }});

  A.push({ id:'voronoi-dither', name:'Voronoi Dither', category:'exotic', params:[
    {id:'cells',label:'Cells',min:50,max:2000,step:50,default:300},
    {id:'style',label:'Style',type:'select',options:[{value:'flat',label:'Flat'},{value:'edge',label:'Edges Only'},{value:'mixed',label:'Mixed'},{value:'stippled',label:'Stippled'}],default:'flat'},
    {id:'edgeWidth',label:'Edge Width',min:.5,max:5,step:.25,default:2},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
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
      const edgeDist=Math.sqrt(min2)-Math.sqrt(min1);
      let result;
      if(p.style==='edge'){
        result=edgeDist<p.edgeWidth?0:255;
      } else if(p.style==='mixed'){
        const cp=pts[nearIdx];
        let sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))]);
        if(p.gamma!==1) sv=Math.pow(sv/255,p.gamma)*255;
        result=edgeDist<p.edgeWidth?0:sv;
      } else if(p.style==='stippled'){
        const cp=pts[nearIdx];
        let sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))])/255;
        if(p.gamma!==1) sv=Math.pow(sv,p.gamma);
        result=sv>.5?255:edgeDist<p.edgeWidth?0:255;
      } else {
        const cp=pts[nearIdx];
        let sv=clamp(px[Math.min(h-1,Math.round(cp.y))*w+Math.min(w-1,Math.round(cp.x))]);
        if(p.gamma!==1) sv=Math.pow(sv/255,p.gamma)*255;
        result=sv;
      }
      o[y*w+x]=p.invert?255-clamp(result):clamp(result);
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
    {id:'threshold',label:'Threshold',min:20,max:240,step:5,default:128},
    {id:'amount',label:'Amount',min:0,max:1,step:.05,default:1},
    {id:'curve',label:'Curve',type:'select',options:[{value:'linear',label:'Linear'},{value:'sine',label:'Sine Wave'},{value:'tri',label:'Triangle'}],default:'linear'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i]); if(p.gamma!==1) v=Math.pow(v/255,p.gamma)*255;
      let solarized;
      if(p.curve==='sine') solarized=Math.abs(Math.sin(v/255*Math.PI))*255;
      else if(p.curve==='tri') solarized=v<128?v*2:510-v*2;
      else solarized=v>p.threshold?255-v:v;
      o[i]=clamp(v*(1-p.amount)+solarized*p.amount);
    }
    return o;
  }});

  A.push({ id:'posterize', name:'Posterize', category:'digital', params:[
    {id:'levels',label:'Levels',min:2,max:16,step:1,default:4},
    {id:'dither',label:'Dither Amount',min:0,max:1,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed);
    for(let i=0;i<w*h;i++){
      let v=clamp(px[i])/255; if(p.gamma!==1) v=Math.pow(v,p.gamma);
      v+=((r()-.5)*p.dither/p.levels);
      const band=Math.round(Math.max(0,Math.min(1,v))*(p.levels-1));
      let result=clamp(band/(p.levels-1)*255);
      o[i]=p.invert?255-result:result;
    }
    return o;
  }});

  A.push({ id:'glitch-blocks', name:'Glitch Blocks', category:'digital', params:[
    {id:'blockSize',label:'Block Size',min:4,max:40,step:2,default:12},
    {id:'probability',label:'Glitch Probability',min:.02,max:.7,step:.02,default:.15},
    {id:'shift',label:'Max Shift',min:5,max:80,step:5,default:20},
    {id:'corruption',label:'Corruption',type:'select',options:[{value:'shift',label:'Shift'},{value:'invert',label:'Invert'},{value:'noise',label:'Noise'},{value:'mirror',label:'Mirror'},{value:'mixed',label:'Mixed'}],default:'shift'},
    {id:'vertShift',label:'Vertical Shift',min:0,max:1,step:.05,default:.25},
    {id:'scanlines',label:'Scanlines',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o=new Uint8ClampedArray(w*h),r=mkRand(p.seed),bs=p.blockSize;
    for(let i=0;i<w*h;i++) o[i]=clamp(px[i]);
    for(let y=0;y<h;y+=bs)for(let x=0;x<w;x+=bs){
      if(r()>p.probability)continue;
      const shiftX=Math.round((r()-.5)*p.shift*2);
      const shiftY=Math.round((r()-.5)*p.shift*p.vertShift*2);
      const mode=p.corruption==='mixed'?['shift','invert','noise','mirror'][Math.floor(r()*4)]:p.corruption;
      for(let dy=0;dy<bs&&y+dy<h;dy++)for(let dx=0;dx<bs&&x+dx<w;dx++){
        const di=(y+dy)*w+x+dx;
        if(mode==='invert') o[di]=255-clamp(px[di]);
        else if(mode==='noise') o[di]=clamp(px[di]+(r()-.5)*120);
        else if(mode==='mirror') o[di]=clamp(px[(y+dy)*w+Math.min(w-1,Math.max(0,w-1-(x+dx)))]);
        else{const sx=((x+dx+shiftX)%w+w)%w,sy=((y+dy+shiftY)%h+h)%h;o[di]=clamp(px[sy*w+sx]);}
      }
    }
    if(p.scanlines){for(let y=0;y<h;y+=2)for(let x=0;x<w;x++) o[y*w+x]=clamp(o[y*w+x]*.85);}
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

  // ═══════════════════════════════════════════
  // ASCII & CHARACTER (8)
  // ═══════════════════════════════════════════

  function asciiRamp(charset) {
    const ramps = {
      'standard':    ' .:-=+*#%@',
      'detailed':    ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
      'blocks':      ' ░▒▓█',
      'blocks-ext':  ' ·░▒▓▊█',
      'box-light':   ' ·┄┈╌─│┌┐└┘├┤┬┴┼',
      'box-heavy':   ' ╍═║╔╗╚╝╠╣╦╩╬█',
      'box-double':  ' ═║╔╗╚╝╠╣╦╩╬░▒▓█',
      'slashes':     ' /\\|─XVY*#',
      'dots':        ' ·•●○◦◎◉⊙⊚',
      'braille':     ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿⡀⡁⡂⡃⡄⡅⡆⡇⣀⣄⣆⣇⣠⣤⣦⣧⣰⣴⣶⣷⣸⣼⣾⣿',
      'math':        ' ·±×÷≈≠≤≥∞∑∏∫√∂∆Ω',
      'stars':       ' ·✦✧★☆✪✫✬✭✮✯',
      'arrows':      ' ←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓',
      'geometric':   ' ▪▫◊◇◆△▲▽▼□■○●',
      'currency':    ' ¢€£¥₹₽₿$∮∯∰',
    };
    return ramps[charset] || ramps['standard'];
  }


  // ── Glyph rendering system ──
  // Renders actual Unicode characters as pixel bitmaps via canvas
  const _glyphCache = {};
  function getGlyphs(rampStr, cw, ch, fontScale) {
    const fs = fontScale || 1.0;
    const key = rampStr + '|' + cw + '|' + ch + '|' + fs;
    if (_glyphCache[key]) return _glyphCache[key];
    const cvs = document.createElement('canvas');
    cvs.width = cw; cvs.height = ch;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    const fontSize = Math.max(4, Math.floor(Math.min(cw * 1.6, ch * 0.92) * fs));
    ctx.font = fontSize + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = [...rampStr];
    const glyphs = [], coverages = [];
    for (const c of chars) {
      ctx.clearRect(0, 0, cw, ch);
      if (c !== ' ') {
        ctx.fillStyle = '#fff';
        ctx.fillText(c, cw / 2, ch / 2);
      }
      const id = ctx.getImageData(0, 0, cw, ch);
      const bm = new Uint8Array(cw * ch);
      let sum = 0;
      for (let i = 0; i < cw * ch; i++) {
        bm[i] = id.data[i * 4 + 3]; // alpha channel = glyph shape
        sum += bm[i];
      }
      glyphs.push(bm);
      coverages.push(sum / (cw * ch * 255));
    }
    // Build coverage-sorted index (light to dark)
    const sortIdx = coverages.map((_, i) => i).sort((a, b) => coverages[a] - coverages[b]);
    const result = {
      glyphs, coverages, sortIdx,
      sortedGlyphs: sortIdx.map(i => glyphs[i]),
      sortedCoverages: sortIdx.map(i => coverages[i]),
      cw, ch, count: chars.length
    };
    _glyphCache[key] = result;
    return result;
  }

  // Pick a glyph index from sorted list by target coverage (0=lightest, 1=darkest)
  function pickGlyphIdx(sortedCoverages, target) {
    const n = sortedCoverages.length;
    if (n === 0) return 0;
    if (target <= 0) return 0;
    if (target >= 1) return n - 1;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedCoverages[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(sortedCoverages[lo - 1] - target) < Math.abs(sortedCoverages[lo] - target)) lo--;
    return lo;
  }

  // Compute cell stats: average brightness, edge magnitude, edge angle, local contrast
  function cellStats(px, cx, cy, cw, ch, w, h) {
    let sum = 0, count = 0, mn = 255, mx = 0;
    for (let dy = 0; dy < ch && cy + dy < h; dy++) {
      for (let dx = 0; dx < cw && cx + dx < w; dx++) {
        const v = clamp(px[(cy + dy) * w + cx + dx]);
        sum += v; count++;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const avg = count > 0 ? sum / count : 128;
    const contrast = mx - mn;
    const midX = Math.min(w - 2, Math.max(1, cx + (cw >> 1)));
    const midY = Math.min(h - 2, Math.max(1, cy + (ch >> 1)));
    const edge = sobelAt(px, midX, midY, w, h);
    return { avg, contrast, edgeMag: edge.mag, edgeAng: edge.ang, mn, mx };
  }

  // Stamp a glyph bitmap into the output array
  function stampGlyph(out, glyph, cx, cy, cw, ch, w, h, inkDark, inkLight) {
    for (let dy = 0; dy < ch && cy + dy < h; dy++) {
      for (let dx = 0; dx < cw && cx + dx < w; dx++) {
        const alpha = glyph[dy * cw + dx] / 255;
        out[(cy + dy) * w + cx + dx] = Math.round(inkLight * (1 - alpha) + inkDark * alpha);
      }
    }
  }

  const charsetOptions = [
    {value:'standard',label:'Standard .:-=+*#%@'},{value:'detailed',label:'Detailed (70 chars)'},
    {value:'blocks',label:'Blocks ░▒▓█'},{value:'blocks-ext',label:'Blocks Extended'},
    {value:'box-light',label:'Box Light ┌─┐'},{value:'box-heavy',label:'Box Heavy ╔═╗'},
    {value:'box-double',label:'Box Double ═║╬'},{value:'slashes',label:'Slashes /\\|'},
    {value:'dots',label:'Dots ·•●'},{value:'braille',label:'Braille ⠿⣿'},
    {value:'math',label:'Math ±×÷∞'},{value:'stars',label:'Stars ★✦✯'},
    {value:'arrows',label:'Arrows ←↑→↓'},{value:'geometric',label:'Geometric ◆▲●'},
    {value:'currency',label:'Currency $€£¥'}
  ];

  // ── 1. ASCII Art (main algorithm) ──
  A.push({ id:'ascii-standard', name:'ASCII Art', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'standard'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'contrast',label:'Ink Contrast',min:0,max:1,step:.05,default:.9},
    {id:'edgeBoost',label:'Edge Boost',min:0,max:2,step:.1,default:.3},
    {id:'shadowDetail',label:'Shadow Detail',min:0,max:2,step:.1,default:1},
    {id:'highlightDetail',label:'Highlight Detail',min:0,max:2,step:.1,default:1},
    {id:'noise',label:'Noise',min:0,max:50,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const r = p.noise > 0 ? mkRand(p.seed) : null;
    const inkDark = Math.round(255 * (1 - p.contrast));
    const inkLight = 255;
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.edgeBoost > 0 && st.edgeMag > 20) {
          const edgeFactor = Math.min(1, st.edgeMag / 200) * p.edgeBoost;
          brightness = brightness * (1 - edgeFactor * 0.4);
        }
        if (brightness < 0.5) {
          brightness = 0.5 * Math.pow(brightness / 0.5, p.shadowDetail);
        } else {
          brightness = 1 - 0.5 * Math.pow((1 - brightness) / 0.5, p.highlightDetail);
        }
        if (r) brightness = Math.max(0, Math.min(1, brightness + (r() - 0.5) * p.noise / 255));
        if (p.invert) brightness = 1 - brightness;
        const target = 1 - brightness;
        const gi = pickGlyphIdx(gl.sortedCoverages, target);
        stampGlyph(o, gl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, inkDark, inkLight);
      }
    }
    return o;
  }});

  // ── 2. ASCII Edge Detection ──
  A.push({ id:'ascii-edge', name:'ASCII Edges', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:16,step:1,default:8},
    {id:'edgeCharset',label:'Edge Characters',type:'select',options:[
      {value:'slashes',label:'Slashes /\\|─'},{value:'box-light',label:'Box Light ┌─┐'},
      {value:'box-heavy',label:'Box Heavy ╔═╗'},{value:'box-double',label:'Box Double ═║╬'},
      {value:'arrows',label:'Arrows ←↑→↓'},{value:'geometric',label:'Geometric ◆▲●'}
    ],default:'slashes'},
    {id:'fillCharset',label:'Fill Characters',type:'select',options:charsetOptions,default:'standard'},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:150,step:5,default:30},
    {id:'edgeStrength',label:'Edge Darkness',min:0,max:1,step:.05,default:.8},
    {id:'fillOpacity',label:'Fill Opacity',min:0,max:1,step:.05,default:.7},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h); o.fill(255);
    const cs = p.cellSize;
    const edgeRamp = asciiRamp(p.edgeCharset);
    const fillRamp = asciiRamp(p.fillCharset);
    const egl = getGlyphs(edgeRamp, cs, cs, p.fontScale);
    const fgl = getGlyphs(fillRamp, cs, cs, p.fontScale);
    const edgeChars = [...edgeRamp];
    const hChars = new Set('─━═╌╍┄┈—–▬→←↔⇐⇒');
    const vChars = new Set('│┃║┆┇┊╎▮↑↓↕⇑⇓');
    const drChars = new Set('/╱↗↙◣');
    const dlChars = new Set('\\╲↘↖◢');
    const dirBuckets = { h: [], v: [], dr: [], dl: [], x: [] };
    for (let i = 0; i < edgeChars.length; i++) {
      const c = edgeChars[i]; if (c === ' ') continue;
      if (hChars.has(c)) dirBuckets.h.push(i);
      else if (vChars.has(c)) dirBuckets.v.push(i);
      else if (drChars.has(c)) dirBuckets.dr.push(i);
      else if (dlChars.has(c)) dirBuckets.dl.push(i);
      else dirBuckets.x.push(i);
    }
    const fallback = edgeChars.length > 1 ? edgeChars.length - 1 : 0;
    for (const k of ['h','v','dr','dl','x']) if (!dirBuckets[k].length) dirBuckets[k].push(fallback);
    const r = mkRand(p.seed);
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        if (st.edgeMag > p.edgeThreshold) {
          const a = (st.edgeAng + Math.PI) % Math.PI;
          let bucket;
          if (a < Math.PI / 6 || a > 5 * Math.PI / 6) bucket = dirBuckets.h;
          else if (a > Math.PI / 3 && a < 2 * Math.PI / 3) bucket = dirBuckets.v;
          else if (a >= Math.PI / 6 && a <= Math.PI / 3) bucket = dirBuckets.dr;
          else bucket = dirBuckets.dl;
          const bi = bucket[Math.floor(r() * bucket.length)];
          const edgeDark = Math.round(255 * (1 - p.edgeStrength));
          stampGlyph(o, egl.glyphs[bi], cx, cy, cs, cs, w, h, edgeDark, 255);
        } else {
          const target = 1 - brightness;
          const gi = pickGlyphIdx(fgl.sortedCoverages, target * p.fillOpacity);
          stampGlyph(o, fgl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, 0, 255);
        }
      }
    }
    return o;
  }});

  // ── 3. Block Mosaic ──
  A.push({ id:'ascii-blocks', name:'Block Mosaic', category:'ascii', params:[
    {id:'cellW',label:'Cell Width',min:2,max:12,step:1,default:4},
    {id:'cellH',label:'Cell Height',min:2,max:12,step:1,default:6},
    {id:'charset',label:'Style',type:'select',options:[
      {value:'blocks',label:'Blocks ░▒▓█'},{value:'blocks-ext',label:'Extended ·░▒▓▊█'},
      {value:'geometric',label:'Geometric ▪▫◊◇◆'},{value:'dots',label:'Dots ·•●○'},
      {value:'braille',label:'Braille ⠿⣿'},{value:'standard',label:'ASCII .:-=+*#%@'}
    ],default:'blocks'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'dither',label:'Dither Amount',min:0,max:1,step:.05,default:.15},
    {id:'edgeDetect',label:'Edge Sharpening',min:0,max:2,step:.1,default:0},
    {id:'contrast',label:'Contrast',min:0,max:1,step:.05,default:.85},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cw = p.cellW, ch = p.cellH;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cw, ch, p.fontScale);
    const r = mkRand(p.seed);
    const inkDark = Math.round(255 * (1 - p.contrast));
    for (let cy = 0; cy < h; cy += ch) {
      for (let cx = 0; cx < w; cx += cw) {
        const st = cellStats(px, cx, cy, cw, ch, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        if (p.edgeDetect > 0 && st.edgeMag > 15) {
          const ef = Math.min(1, st.edgeMag / 150) * p.edgeDetect;
          brightness = brightness < 0.5 ? brightness * (1 - ef * 0.5) : brightness + (1 - brightness) * ef * 0.5;
        }
        if (p.dither > 0) brightness = Math.max(0, Math.min(1, brightness + (r() - 0.5) * p.dither));
        const target = 1 - brightness;
        const gi = pickGlyphIdx(gl.sortedCoverages, target);
        stampGlyph(o, gl.sortedGlyphs[gi], cx, cy, cw, ch, w, h, inkDark, 255);
      }
    }
    return o;
  }});

  // ── 4. ASCII Halftone ──
  A.push({ id:'ascii-halftone', name:'ASCII Halftone', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:16,step:1,default:8},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'dots'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'angle',label:'Screen Angle',min:0,max:90,step:5,default:45},
    {id:'frequency',label:'Screen Frequency',min:.5,max:3,step:.1,default:1},
    {id:'contrast',label:'Contrast',min:0,max:1,step:.05,default:.85},
    {id:'dotGain',label:'Dot Gain',min:-.5,max:.5,step:.05,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const ang = p.angle * Math.PI / 180, cosA = Math.cos(ang), sinA = Math.sin(ang);
    const inkDark = Math.round(255 * (1 - p.contrast));
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        const ncx = (cx / cs) * p.frequency, ncy = (cy / cs) * p.frequency;
        const rx = ncx * cosA + ncy * sinA;
        const ry = -ncx * sinA + ncy * cosA;
        const screenVal = (Math.sin(rx * Math.PI) * Math.sin(ry * Math.PI) + 1) / 2;
        const modulated = brightness + (screenVal - 0.5) * 0.3 + p.dotGain;
        const clamped = Math.max(0, Math.min(1, modulated));
        const target = 1 - clamped;
        const gi = pickGlyphIdx(gl.sortedCoverages, target);
        stampGlyph(o, gl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, inkDark, 255);
      }
    }
    return o;
  }});

  // ── 5. Matrix Rain ──
  A.push({ id:'ascii-matrix', name:'Matrix Rain', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:14,step:1,default:7},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'standard'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'density',label:'Column Density',min:.1,max:1,step:.05,default:.65},
    {id:'trail',label:'Trail Length',min:3,max:30,step:1,default:10},
    {id:'brightness',label:'Glow Brightness',min:.3,max:1,step:.05,default:.8},
    {id:'imageBlend',label:'Image Influence',min:0,max:1,step:.05,default:.5},
    {id:'randomChars',label:'Random Characters',type:'checkbox',default:true},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h); o.fill(0);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    const cols = Math.ceil(w / cs), rows = Math.ceil(h / cs);
    for (let col = 0; col < cols; col++) {
      if (r() > p.density) continue;
      const startRow = Math.floor(r() * rows);
      for (let row = startRow; row < startRow + p.trail && row < rows; row++) {
        const cy = row * cs, cx = col * cs;
        if (cy >= h || cx >= w) continue;
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brt = st.avg / 255;
        if (p.gamma !== 1) brt = Math.pow(brt, p.gamma);
        const fade = 1 - (row - startRow) / p.trail;
        const imgInfluence = brt * p.imageBlend + (1 - p.imageBlend);
        const intensity = fade * p.brightness * imgInfluence;
        let gi;
        if (p.randomChars) {
          gi = Math.floor(r() * gl.count);
        } else {
          const target = 1 - brt;
          gi = pickGlyphIdx(gl.sortedCoverages, target);
          gi = gl.sortIdx[gi]; // convert back to unsorted index
        }
        const glyph = gl.glyphs[gi];
        for (let dy = 0; dy < cs && cy + dy < h; dy++) {
          for (let dx = 0; dx < cs && cx + dx < w; dx++) {
            const alpha = glyph[dy * cs + dx] / 255;
            const v = Math.round(alpha * intensity * 255);
            const idx = (cy + dy) * w + cx + dx;
            o[idx] = Math.max(o[idx], v);
          }
        }
      }
    }
    return o;
  }});

  // ── 6. Braille Render ──
  A.push({ id:'ascii-braille', name:'Braille Render', category:'ascii', params:[
    {id:'dotSize',label:'Dot Size',min:2,max:6,step:1,default:3},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'adaptiveThreshold',label:'Adaptive Threshold',min:0,max:1,step:.05,default:.3},
    {id:'edgeWeight',label:'Edge Weight',min:0,max:2,step:.1,default:.5},
    {id:'noise',label:'Noise',min:0,max:60,step:1,default:0},
    {id:'dotShape',label:'Dot Shape',type:'select',options:[
      {value:'round',label:'Round'},{value:'square',label:'Square'},{value:'diamond',label:'Diamond'}
    ],default:'round'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    o.fill(p.invert ? 0 : 255);
    const ds = p.dotSize;
    const cellW = ds * 2, cellH = ds * 4;
    const rnd = p.noise > 0 ? mkRand(p.seed) : null;
    const dotR = ds / 2;
    for (let cy = 0; cy < h; cy += cellH) {
      for (let cx = 0; cx < w; cx += cellW) {
        let localSum = 0, localCount = 0;
        for (let dy = 0; dy < cellH && cy + dy < h; dy++) {
          for (let dx = 0; dx < cellW && cx + dx < w; dx++) {
            localSum += clamp(px[(cy + dy) * w + cx + dx]);
            localCount++;
          }
        }
        const localAvg = localCount > 0 ? localSum / localCount : 128;
        const thr = p.threshold * (1 - p.adaptiveThreshold) + localAvg * p.adaptiveThreshold;
        for (let dotY = 0; dotY < 4; dotY++) {
          for (let dotX = 0; dotX < 2; dotX++) {
            const scy = cy + dotY * ds, scx = cx + dotX * ds;
            let sum = 0, cnt = 0;
            for (let sy = 0; sy < ds && scy + sy < h; sy++) {
              for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                sum += clamp(px[(scy + sy) * w + scx + sx]);
                cnt++;
              }
            }
            if (cnt === 0) continue;
            let val = sum / cnt;
            if (p.gamma !== 1) val = Math.pow(val / 255, p.gamma) * 255;
            if (p.edgeWeight > 0) {
              const emx = Math.min(w - 2, Math.max(1, scx + (ds >> 1)));
              const emy = Math.min(h - 2, Math.max(1, scy + (ds >> 1)));
              const e = sobelAt(px, emx, emy, w, h);
              if (e.mag > 15) val -= e.mag * p.edgeWeight * 0.5;
            }
            if (rnd) val += (rnd() - 0.5) * p.noise;
            const isDark = p.invert ? val > thr : val < thr;
            if (isDark) {
              const centerX = dotR, centerY = dotR;
              for (let sy = 0; sy < ds && scy + sy < h; sy++) {
                for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                  let inside = false;
                  if (p.dotShape === 'round') {
                    const ddx = sx - centerX + 0.5, ddy = sy - centerY + 0.5;
                    inside = Math.sqrt(ddx * ddx + ddy * ddy) <= dotR;
                  } else if (p.dotShape === 'diamond') {
                    inside = Math.abs(sx - centerX + 0.5) + Math.abs(sy - centerY + 0.5) <= dotR;
                  } else {
                    inside = true;
                  }
                  if (inside) {
                    o[(scy + sy) * w + scx + sx] = p.invert ? 255 : 0;
                  }
                }
              }
            }
          }
        }
      }
    }
    return o;
  }});

  // ── 7. Box Drawing ──
  A.push({ id:'ascii-box-drawing', name:'Box Drawing', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:16,step:1,default:8},
    {id:'charset',label:'Style',type:'select',options:[
      {value:'box-light',label:'Light ┌─┐│└┘'},{value:'box-heavy',label:'Heavy ╔═╗║'},
      {value:'box-double',label:'Double ═║╔╗╚╝'},{value:'slashes',label:'Slashes /\\|─'},
      {value:'geometric',label:'Geometric ◆▲●'}
    ],default:'box-light'},
    {id:'fillCharset',label:'Fill Style',type:'select',options:charsetOptions,default:'blocks'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:120,step:5,default:25},
    {id:'fillOpacity',label:'Fill Density',min:0,max:1,step:.05,default:.6},
    {id:'lineWeight',label:'Line Darkness',min:0,max:1,step:.05,default:.9},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h); o.fill(255);
    const cs = p.cellSize;
    const edgeRamp = asciiRamp(p.charset);
    const fillRamp = asciiRamp(p.fillCharset);
    const egl = getGlyphs(edgeRamp, cs, cs, p.fontScale);
    const fgl = getGlyphs(fillRamp, cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    const lineDark = Math.round(255 * (1 - p.lineWeight));
    const edgeChars = [...edgeRamp];
    const hChars = new Set('─━═╌╍┄┈—–▬→←↔⇐⇒');
    const vChars = new Set('│┃║┆┇┊╎▮↑↓↕⇑⇓');
    const drChars = new Set('/╱↗↙◣');
    const dlChars = new Set('\\╲↘↖◢');
    const dirBuckets = { h: [], v: [], dr: [], dl: [], x: [] };
    for (let i = 0; i < edgeChars.length; i++) {
      const c = edgeChars[i]; if (c === ' ') continue;
      if (hChars.has(c)) dirBuckets.h.push(i);
      else if (vChars.has(c)) dirBuckets.v.push(i);
      else if (drChars.has(c)) dirBuckets.dr.push(i);
      else if (dlChars.has(c)) dirBuckets.dl.push(i);
      else dirBuckets.x.push(i);
    }
    const fb = edgeChars.length > 1 ? edgeChars.length - 1 : 0;
    for (const k of ['h','v','dr','dl','x']) if (!dirBuckets[k].length) dirBuckets[k].push(fb);
    for (let cy = 0; cy < h; cy += cs) {
      for (let cx = 0; cx < w; cx += cs) {
        const st = cellStats(px, cx, cy, cs, cs, w, h);
        let brightness = st.avg / 255;
        if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
        if (p.invert) brightness = 1 - brightness;
        if (st.edgeMag > p.edgeThreshold) {
          const a = (st.edgeAng + Math.PI) % Math.PI;
          let bucket;
          if (a < Math.PI / 6 || a > 5 * Math.PI / 6) bucket = dirBuckets.h;
          else if (a > Math.PI / 3 && a < 2 * Math.PI / 3) bucket = dirBuckets.v;
          else if (a >= Math.PI / 6 && a <= Math.PI / 3) bucket = dirBuckets.dr;
          else bucket = dirBuckets.dl;
          const bi = bucket[Math.floor(r() * bucket.length)];
          stampGlyph(o, egl.glyphs[bi], cx, cy, cs, cs, w, h, lineDark, 255);
        } else if (p.fillOpacity > 0) {
          const target = (1 - brightness) * p.fillOpacity;
          const gi = pickGlyphIdx(fgl.sortedCoverages, target);
          stampGlyph(o, fgl.sortedGlyphs[gi], cx, cy, cs, cs, w, h, 0, 255);
        }
      }
    }
    return o;
  }});

  // ── 8. Typewriter ──
  A.push({ id:'ascii-typewriter', name:'Typewriter', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:14,step:1,default:7},
    {id:'charset',label:'Characters',type:'select',options:charsetOptions,default:'detailed'},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'overprint',label:'Overprint Passes',min:1,max:5,step:1,default:2},
    {id:'jitter',label:'Registration Jitter',min:0,max:4,step:1,default:1},
    {id:'inkDensity',label:'Ink Density',min:.2,max:1,step:.05,default:.7},
    {id:'inkVariation',label:'Ink Variation',min:0,max:.5,step:.05,default:.15},
    {id:'paperTone',label:'Paper Tone',min:200,max:255,step:1,default:240},
    {id:'edgeBoost',label:'Edge Darkening',min:0,max:2,step:.1,default:.3},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    const cs = p.cellSize;
    const ramp = asciiRamp(p.charset);
    const gl = getGlyphs(ramp, cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    o.fill(p.invert ? 255 - p.paperTone : p.paperTone);
    for (let pass = 0; pass < p.overprint; pass++) {
      const ox = Math.round((r() - 0.5) * p.jitter);
      const oy = Math.round((r() - 0.5) * p.jitter);
      const passInkVar = 1 - r() * p.inkVariation;
      for (let cy = 0; cy < h; cy += cs) {
        for (let cx = 0; cx < w; cx += cs) {
          const st = cellStats(px, cx, cy, cs, cs, w, h);
          let brightness = st.avg / 255;
          if (p.gamma !== 1) brightness = Math.pow(brightness, p.gamma);
          if (p.invert) brightness = 1 - brightness;
          if (p.edgeBoost > 0 && st.edgeMag > 20) {
            const ef = Math.min(1, st.edgeMag / 200) * p.edgeBoost;
            brightness *= (1 - ef * 0.4);
          }
          const target = 1 - brightness;
          const gi = pickGlyphIdx(gl.sortedCoverages, target);
          const glyph = gl.sortedGlyphs[gi];
          const inkStr = p.inkDensity * passInkVar * (0.5 + r() * 0.5);
          for (let dy = 0; dy < cs && cy + dy + oy >= 0 && cy + dy + oy < h; dy++) {
            for (let dx = 0; dx < cs && cx + dx + ox >= 0 && cx + dx + ox < w; dx++) {
              const fy = cy + dy + oy, fx = cx + dx + ox;
              if (fx < 0 || fx >= w || fy < 0 || fy >= h) continue;
              const alpha = glyph[dy * cs + dx] / 255;
              const inkAmount = alpha * inkStr;
              const idx = fy * w + fx;
              if (p.invert) {
                o[idx] = Math.min(255, o[idx] + Math.round(inkAmount * 255));
              } else {
                o[idx] = Math.max(0, Math.round(o[idx] * (1 - inkAmount)));
              }
            }
          }
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // CLASSIC EXTENSIONS (2 — Riemersma, Ostromoukhov)
  // ═══════════════════════════════════════════

  // Hilbert curve walk — produces (x,y) sequence for any rect (clamps to fit
  // a power-of-2 covering). Used by Riemersma dither.
  function* hilbertWalk(w, h) {
    const order = Math.ceil(Math.log2(Math.max(w, h)));
    const N = 1 << order;
    function rot(n, x, y, rx, ry) {
      if (ry === 0) {
        if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
        return [y, x];
      }
      return [x, y];
    }
    for (let d = 0; d < N * N; d++) {
      let x = 0, y = 0, t = d;
      for (let s = 1; s < N; s *= 2) {
        const rx = 1 & (t / 2);
        const ry = 1 & (t ^ rx);
        [x, y] = rot(s, x, y, rx, ry);
        x += s * rx; y += s * ry;
        t = Math.floor(t / 4);
      }
      if (x < w && y < h) yield [x, y];
    }
  }

  A.push({ id:'riemersma', name:'Riemersma (Hilbert)', category:'classic', params:[
    {id:'historySize',label:'History',min:4,max:32,step:1,default:16},
    {id:'decay',label:'Decay',min:.05,max:.4,step:.01,default:.16},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const buf = new Float32Array(px);
    const N = p.historySize;
    const history = new Float32Array(N);
    const weights = new Float32Array(N);
    // exponential weights: latest sample has the largest weight, sums to 1
    let wsum = 0;
    for (let i = 0; i < N; i++) {
      weights[i] = Math.exp(-p.decay * (N - 1 - i));
      wsum += weights[i];
    }
    for (let i = 0; i < N; i++) weights[i] /= wsum;
    let head = 0;
    for (const [x, y] of hilbertWalk(w, h)) {
      const i = y * w + x;
      let v = buf[i];
      if (p.gamma !== 1) v = Math.pow(Math.max(0, v) / 255, p.gamma) * 255;
      // accumulated diffused error from history
      let acc = 0;
      for (let k = 0; k < N; k++) acc += history[k] * weights[k];
      v += acc;
      const nv = v > p.threshold ? 255 : 0;
      const err = v - nv;
      // push error into history (newest at head)
      history[head] = err;
      head = (head + 1) % N;
      o[i] = p.invert ? 255 - nv : nv;
    }
    return o;
  }});

  // Ostromoukhov variable-coefficient Floyd-Steinberg.
  // Coefficients vary per intensity level (3 weights per row, /sum)
  const OSTRO = (() => {
    // Compact 16-entry table interpolated to 256.
    // Source pattern: Ostromoukhov 2001 "A Simple and Efficient Error-Diffusion Algorithm"
    const seed = [
      [13,0,5],[1,0,0],[7,3,5],[5,3,2],[4,2,3],[10,6,7],[7,3,4],[8,4,5],
      [11,5,6],[5,2,3],[7,3,4],[6,3,3],[5,2,3],[7,3,4],[1,0,1],[7,3,5]
    ];
    const T = new Array(256);
    for (let i = 0; i < 256; i++) {
      const f = i / 16, lo = Math.min(15, Math.floor(f)), hi = Math.min(15, lo + 1), t = f - lo;
      const a = seed[lo], b = seed[hi];
      const r = a[0]*(1-t) + b[0]*t;
      const dl = a[1]*(1-t) + b[1]*t;
      const d = a[2]*(1-t) + b[2]*t;
      const s = r + dl + d || 1;
      T[i] = [r/s, dl/s, d/s];
    }
    return T;
  })();

  A.push({ id:'ostromoukhov', name:'Ostromoukhov', category:'classic', params:[
    {id:'strength',label:'Diffusion',min:0,max:1,step:.01,default:1},
    {id:'serpentine',label:'Serpentine',type:'checkbox',default:true},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'noise',label:'Noise',min:0,max:60,step:1,default:0},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h), buf = new Float32Array(px);
    const r = p.noise > 0 ? mkRand(p.seed) : null;
    for (let y = 0; y < h; y++) {
      const ltr = !p.serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x;
        let v = clamp(buf[i]);
        if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
        if (r) v = clamp(v + (r() - 0.5) * p.noise * 2);
        const idx = Math.max(0, Math.min(255, Math.round(v)));
        const nv = v > p.threshold ? 255 : 0;
        o[i] = nv;
        const err = (v - nv) * p.strength;
        const [wr, wdl, wd] = OSTRO[idx];
        const xr = x + (ltr ? 1 : -1);
        const xl = x + (ltr ? -1 : 1);
        if (xr >= 0 && xr < w)            buf[y*w + xr]     += err * wr;
        if (y + 1 < h && xl >= 0 && xl < w) buf[(y+1)*w + xl] += err * wdl;
        if (y + 1 < h)                    buf[(y+1)*w + x]   += err * wd;
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // IMAGE-AWARE (5) — algorithms that read edges/gradients/luminance
  // and let those features steer the dithering / hatching.
  // ═══════════════════════════════════════════

  // Helper: build sobel magnitude + gradient angle fields once.
  function gradientFields(px, w, h) {
    const mag = new Float32Array(w * h);
    const ang = new Float32Array(w * h);
    let maxMag = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y*w + x;
        const tl = px[i-w-1], t = px[i-w], tr = px[i-w+1];
        const l  = px[i-1],            r  = px[i+1];
        const bl = px[i+w-1], b = px[i+w], br = px[i+w+1];
        const gx = (tr + 2*r + br) - (tl + 2*l + bl);
        const gy = (bl + 2*b + br) - (tl + 2*t + tr);
        const m = Math.sqrt(gx*gx + gy*gy);
        mag[i] = m; ang[i] = Math.atan2(gy, gx);
        if (m > maxMag) maxMag = m;
      }
    }
    if (maxMag > 0) for (let k = 0; k < mag.length; k++) mag[k] /= maxMag;
    return { mag, ang, maxMag };
  }

  // 1) Edge-Aware Floyd-Steinberg — diffusion strength scales with edges so
  // sharp boundaries stay crisp while flat areas get full diffusion.
  A.push({ id:'edge-aware-fs', name:'Edge-Aware Floyd-Steinberg', category:'image-aware', params:[
    {id:'baseStrength',label:'Base Diffusion',min:0,max:1,step:.01,default:1},
    {id:'edgeStrength',label:'Edge Bias',min:-1,max:1,step:.05,default:-.7,
     hint:'negative = preserve edges, positive = enhance diffusion at edges'},
    {id:'edgeRadius',label:'Edge Smoothing',min:0,max:5,step:1,default:1},
    {id:'serpentine',label:'Serpentine',type:'checkbox',default:true},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h), buf = new Float32Array(px);
    const { mag } = gradientFields(px, w, h);
    // Optional smoothing of edge field with a small box blur
    let edgeField = mag;
    if (p.edgeRadius > 0) {
      const er = p.edgeRadius, tmp = new Float32Array(w*h), out2 = new Float32Array(w*h);
      const k = er * 2 + 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dx = -er; dx <= er; dx++) {
          const xx = Math.min(w-1, Math.max(0, x+dx)); s += mag[y*w+xx];
        } tmp[y*w+x] = s/k;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dy = -er; dy <= er; dy++) {
          const yy = Math.min(h-1, Math.max(0, y+dy)); s += tmp[yy*w+x];
        } out2[y*w+x] = s/k;
      }
      edgeField = out2;
    }
    const matrix = [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];
    for (let y = 0; y < h; y++) {
      const ltr = !p.serpentine || (y % 2 === 0);
      const sx = ltr ? 0 : w-1, ex = ltr ? w : -1, dx = ltr ? 1 : -1;
      for (let x = sx; x !== ex; x += dx) {
        const i = y*w+x;
        let v = clamp(buf[i]);
        if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
        const nv = v > p.threshold ? 255 : 0;
        o[i] = nv;
        const e = edgeField[i]; // 0-1
        const localStr = Math.max(0, Math.min(2, p.baseStrength * (1 + p.edgeStrength * e)));
        const err = (v - nv) * localStr;
        for (const [mdx, mdy, mw] of matrix) {
          const nx = x + (ltr ? mdx : -mdx), ny = y + mdy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) buf[ny*w+nx] += err * mw;
        }
      }
    }
    return o;
  }});

  // 2) Structure-Tensor Hatching — strokes oriented along the dominant
  // local gradient direction (perpendicular = isophote tangent).
  A.push({ id:'structure-hatch', name:'Structure-Tensor Hatch', category:'image-aware', params:[
    {id:'spacing',label:'Stroke Spacing',min:2,max:20,step:1,default:5},
    {id:'length',label:'Stroke Length',min:3,max:40,step:1,default:12},
    {id:'thickness',label:'Thickness',min:1,max:4,step:1,default:1},
    {id:'follow',label:'Follow Edges',min:0,max:1,step:.05,default:1,
     hint:'1 = strokes follow gradient, 0 = horizontal hatching'},
    {id:'darkBias',label:'Dark Bias',min:0,max:2,step:.05,default:1,
     hint:'how strongly tone affects stroke density'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const { mag, ang } = gradientFields(px, w, h);
    const sp = p.spacing, len = p.length, th = p.thickness;
    for (let y = 0; y < h; y += sp) for (let x = 0; x < w; x += sp) {
      const i = y*w+x;
      let v = clamp(px[i])/255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      // Probability of placing a stroke here based on darkness * darkBias
      const density = Math.pow(1 - v, p.darkBias);
      if (density < 0.05) continue;
      // Stroke direction = isophote tangent = perpendicular to gradient
      const a = ang[i] || 0;
      const baseAng = a + Math.PI / 2;
      const dirAng = baseAng * p.follow; // 0 = horizontal, 1 = full follow
      const dxs = Math.cos(dirAng), dys = Math.sin(dirAng);
      const half = (len * density) / 2;
      const ink = p.invert ? 255 : 0;
      for (let t = -half; t <= half; t += 0.5) {
        const sx = Math.round(x + t * dxs), sy = Math.round(y + t * dys);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        for (let dty = -Math.floor(th/2); dty <= Math.floor(th/2); dty++)
          for (let dtx = -Math.floor(th/2); dtx <= Math.floor(th/2); dtx++) {
            const fx = sx + dtx, fy = sy + dty;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
          }
      }
    }
    return o;
  }});

  // 3) Adaptive Halftone — dot size modulated by local variance so detailed
  // areas get smaller dots (more resolution) and flat areas get larger dots.
  A.push({ id:'adaptive-halftone', name:'Adaptive Halftone', category:'image-aware', params:[
    {id:'baseSize',label:'Base Dot Size',min:3,max:24,step:1,default:8},
    {id:'sizeVariance',label:'Size Adaptation',min:0,max:1,step:.05,default:.6,
     hint:'how much local detail shrinks dots'},
    {id:'angle',label:'Angle',min:0,max:90,step:1,default:45},
    {id:'shape',label:'Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},{value:'square',label:'Square'}
    ],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const { mag } = gradientFields(px, w, h);
    // Dilate edge field with a local-window mean for variance proxy
    const winR = 4, winK = (winR*2+1)*(winR*2+1);
    const variance = new Float32Array(w*h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -winR; dy <= winR; dy++) for (let dx = -winR; dx <= winR; dx++) {
        const xx = Math.max(0, Math.min(w-1, x+dx));
        const yy = Math.max(0, Math.min(h-1, y+dy));
        s += mag[yy*w+xx];
      }
      variance[y*w+x] = s / winK;
    }
    const ang = p.angle * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // Local cell size: shrink in detailed regions
      const localSize = Math.max(2, p.baseSize * (1 - variance[y*w+x] * p.sizeVariance));
      const rx = x*ca + y*sa, ry = -x*sa + y*ca;
      const cx = ((rx % localSize) + localSize) % localSize;
      const cy = ((ry % localSize) + localSize) % localSize;
      const nx = (cx/localSize - .5)*2, ny2 = (cy/localSize - .5)*2;
      let d;
      if (p.shape === 'diamond') d = Math.abs(nx) + Math.abs(ny2);
      else if (p.shape === 'square') d = Math.max(Math.abs(nx), Math.abs(ny2));
      else d = Math.sqrt(nx*nx + ny2*ny2);
      let val = clamp(px[y*w+x]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      const t = (1 - val) * 1.42;
      let result;
      if (p.softness > 0) { const s2 = d - t; result = clamp(128 - s2/p.softness*128); }
      else result = d < t ? 0 : 255;
      o[y*w+x] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 4) Flow-Field Stipple — stipples placed along streamlines that follow
  // the image gradient field. Areas with strong direction get coherent
  // stipple flows; flat areas get isotropic dots.
  A.push({ id:'flow-stipple', name:'Flow-Field Stipple', category:'image-aware', params:[
    {id:'density',label:'Density',min:50,max:1500,step:50,default:500,
     hint:'number of seed points per 100k pixels'},
    {id:'streamLen',label:'Stream Length',min:2,max:30,step:1,default:10},
    {id:'streamStep',label:'Step Size',min:.5,max:3,step:.25,default:1},
    {id:'dotSize',label:'Dot Size',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const { ang } = gradientFields(px, w, h);
    const ink = p.invert ? 255 : 0;
    const r = mkRand(p.seed);
    const nSeeds = Math.round(p.density * (w * h) / 100000);
    for (let s = 0; s < nSeeds; s++) {
      let x = r() * w, y = r() * h;
      // Reject seeds in highlights based on luminance (probabilistic)
      const sv = clamp(px[Math.floor(y)*w + Math.floor(x)]) / 255;
      const darkness = 1 - (p.gamma !== 1 ? Math.pow(sv, p.gamma) : sv);
      if (r() > darkness) continue;
      // Walk along (and against) the gradient tangent for streamLen steps
      for (let dir = -1; dir <= 1; dir += 2) {
        let cx = x, cy = y;
        for (let k = 0; k < p.streamLen; k++) {
          const ix = Math.floor(cx), iy = Math.floor(cy);
          if (ix < 0 || ix >= w || iy < 0 || iy >= h) break;
          // Stamp dot
          for (let dy = 0; dy < p.dotSize; dy++) for (let dx = 0; dx < p.dotSize; dx++) {
            const fx = ix + dx, fy = iy + dy;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
          }
          // Step along isophote tangent (perpendicular to gradient)
          const a = (ang[iy*w+ix] || 0) + Math.PI / 2;
          cx += Math.cos(a) * p.streamStep * dir;
          cy += Math.sin(a) * p.streamStep * dir;
        }
      }
    }
    return o;
  }});

  // 5) Contour Stipple — stipples concentrated on iso-luminance contours
  // (sharp edges in tone). Like a topographic map of the image.
  A.push({ id:'contour-stipple', name:'Contour Stipple', category:'image-aware', params:[
    {id:'levels',label:'Tone Levels',min:3,max:24,step:1,default:8,
     hint:'number of contour bands'},
    {id:'density',label:'Stipple Density',min:.1,max:1,step:.05,default:.5},
    {id:'dotSize',label:'Dot Size',min:1,max:4,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const r = mkRand(p.seed);
    const ink = p.invert ? 255 : 0;
    const step = 255 / p.levels;
    for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
      const i = y*w+x;
      let v = clamp(px[i]);
      if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      const band = Math.floor(v / step);
      // Check if any 4-neighbor is in a different band → on contour
      const bandT = Math.floor(clamp(px[i-w]) / step);
      const bandB = Math.floor(clamp(px[i+w]) / step);
      const bandL = Math.floor(clamp(px[i-1]) / step);
      const bandR = Math.floor(clamp(px[i+1]) / step);
      const onContour = (band !== bandT) || (band !== bandB) || (band !== bandL) || (band !== bandR);
      if (onContour && r() < p.density) {
        for (let dy = 0; dy < p.dotSize; dy++) for (let dx = 0; dx < p.dotSize; dx++) {
          const fx = x + dx, fy = y + dy;
          if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ADVANCED IMAGE-AWARE PATTERNS (5)
  // Ordered & halftone algorithms that read the image deeply: they let
  // image gradients, edges, tone zones, or local detail steer pattern
  // size, screen angle, dot density, and stroke flow.
  // ═══════════════════════════════════════════

  // Reusable detail field: returns 0-1 per pixel.
  // mode: 'edges' (sobel mag), 'variance' (windowed stddev), 'luminance' (raw).
  // radius: post-smoothing box-blur radius.
  function detailField(px, w, h, mode, radius) {
    const n = w * h;
    let field = new Float32Array(n);
    if (mode === 'luminance') {
      for (let i = 0; i < n; i++) field[i] = clamp(px[i]) / 255;
    } else if (mode === 'variance') {
      const winR = 3, winK = (winR*2+1)*(winR*2+1);
      let maxV = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, ss = 0;
        for (let dy = -winR; dy <= winR; dy++) for (let dx = -winR; dx <= winR; dx++) {
          const xx = Math.max(0, Math.min(w-1, x+dx));
          const yy = Math.max(0, Math.min(h-1, y+dy));
          const v = px[yy*w+xx];
          s += v; ss += v*v;
        }
        const mean = s / winK;
        const variance = ss / winK - mean * mean;
        const sd = Math.sqrt(Math.max(0, variance));
        field[y*w+x] = sd;
        if (sd > maxV) maxV = sd;
      }
      if (maxV > 0) for (let i = 0; i < n; i++) field[i] /= maxV;
    } else {
      // edges
      const g = gradientFields(px, w, h);
      field = g.mag;
    }
    if (radius > 0) {
      const r = radius, k = r * 2 + 1;
      const tmp = new Float32Array(n), out2 = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dx = -r; dx <= r; dx++) {
          const xx = Math.max(0, Math.min(w-1, x+dx)); s += field[y*w+xx];
        } tmp[y*w+x] = s/k;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0; for (let dy = -r; dy <= r; dy++) {
          const yy = Math.max(0, Math.min(h-1, y+dy)); s += tmp[yy*w+x];
        } out2[y*w+x] = s/k;
      }
      field = out2;
    }
    return field;
  }

  // Local-region gradient: average gradient direction over a region of
  // `regionSize` pixels so the orientation is stable (not per-pixel noise).
  function regionGradients(px, w, h, regionSize) {
    const { mag, ang } = gradientFields(px, w, h);
    if (regionSize <= 1) return { mag, ang };
    const r = Math.max(1, Math.floor(regionSize / 2));
    const k = r * 2 + 1;
    const angOut = new Float32Array(w * h);
    const magOut = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sumX = 0, sumY = 0, sumM = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.max(0, Math.min(w-1, x+dx));
        const yy = Math.max(0, Math.min(h-1, y+dy));
        const i = yy*w+xx;
        const m = mag[i];
        if (m > 0) {
          // Use vector with double-angle to handle 180° symmetry of orientation
          const a2 = ang[i] * 2;
          sumX += Math.cos(a2) * m;
          sumY += Math.sin(a2) * m;
        }
        sumM += m; n++;
      }
      angOut[y*w+x] = Math.atan2(sumY, sumX) / 2;
      magOut[y*w+x] = sumM / n;
    }
    return { mag: magOut, ang: angOut };
  }

  // 1) Adaptive Bayer — matrix size varies per pixel based on detail.
  // High-detail areas get small matrices (more dither resolution),
  // flat areas get big matrices (smoother gradients).
  A.push({ id:'adaptive-bayer', name:'Adaptive Bayer', category:'image-aware', params:[
    {id:'minSize',label:'Min Matrix',type:'select',options:[
      {value:2,label:'2x2'},{value:4,label:'4x4'},{value:8,label:'8x8'}
    ],default:2},
    {id:'maxSize',label:'Max Matrix',type:'select',options:[
      {value:8,label:'8x8'},{value:16,label:'16x16'},{value:32,label:'32x32'},{value:64,label:'64x64'}
    ],default:16},
    {id:'detailMode',label:'Detail Source',type:'select',options:[
      {value:'edges',label:'Edges (Sobel)'},
      {value:'variance',label:'Local Variance'},
      {value:'luminance',label:'Luminance'}
    ],default:'edges'},
    {id:'detailRadius',label:'Smoothing',min:0,max:10,step:1,default:2,
     hint:'blur the detail map before sampling'},
    {id:'detailInfluence',label:'Influence',min:-1,max:1,step:.05,default:1,
     hint:'+1: detail = small matrix · 0: fixed · -1: inverted'},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'rotation',label:'Rotation',min:0,max:90,step:1,default:0},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const minS = +p.minSize, maxS = +p.maxSize;
    // Pre-build all Bayer matrices we might need (powers of 2)
    const sizes = [];
    for (let s = minS; s <= maxS; s *= 2) sizes.push(s);
    if (sizes[sizes.length-1] !== maxS) sizes.push(maxS);
    const mats = {};
    for (const s of sizes) mats[s] = normBayer(s);
    const field = detailField(px, w, h, p.detailMode, p.detailRadius);
    const ang = p.rotation * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      let d = field[i]; // 0-1
      // Map detail to matrix size choice
      // detailInfluence > 0: high detail → small matrix
      const t = p.detailInfluence >= 0 ? 1 - d * p.detailInfluence : 1 + d * p.detailInfluence;
      const tt = Math.max(0, Math.min(1, t));
      // Pick a matrix size by linear interpolation across the size list, snap to nearest
      const idxF = tt * (sizes.length - 1);
      const idx = Math.round(idxF);
      const sz = sizes[idx];
      const mat = mats[sz];
      const rx = Math.round(x*ca + y*sa), ry = Math.round(-x*sa + y*ca);
      const bx = ((rx % sz) + sz) % sz, by = ((ry % sz) + sz) % sz;
      let v = clamp(px[i]); if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      v += (mat[by][bx] - .5) * p.spread;
      const result = v > p.threshold ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 2) Gradient-Aligned Halftone — screen angle follows local image
  // gradient. Dots along edges become coherent flowing rows instead of
  // a fixed grid. Region size lets you control coarse vs fine alignment.
  A.push({ id:'gradient-halftone', name:'Gradient-Aligned Halftone', category:'image-aware', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:24,step:1,default:8},
    {id:'baseAngle',label:'Base Angle',min:0,max:180,step:1,default:45},
    {id:'gradInfluence',label:'Gradient Follow',min:0,max:1,step:.05,default:.7,
     hint:'0 = fixed angle, 1 = fully follow image gradient'},
    {id:'regionSize',label:'Sample Region',min:1,max:32,step:1,default:8,
     hint:'larger = smoother orientation, smaller = more local'},
    {id:'shape',label:'Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'square',label:'Square'},{value:'line',label:'Line'},
      {value:'cross',label:'Cross'},{value:'ellipse',label:'Ellipse'}
    ],default:'circle'},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.42},
    {id:'edgeBoost',label:'Edge Boost',min:0,max:1,step:.05,default:0,
     hint:'enlarge dots near edges to outline detail'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h), ds = p.dotSize;
    const baseRad = p.baseAngle * Math.PI / 180;
    const { mag, ang } = regionGradients(px, w, h, p.regionSize);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      // Per-pixel screen angle: lerp between base angle and gradient-tangent angle
      const tangent = (ang[i] || 0) + Math.PI / 2;
      const a = baseRad * (1 - p.gradInfluence) + tangent * p.gradInfluence;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = x*ca + y*sa, ry = -x*sa + y*ca;
      const cx = ((rx % ds) + ds) % ds, cy = ((ry % ds) + ds) % ds;
      const nx = (cx/ds - .5) * 2, ny = (cy/ds - .5) * 2;
      let d;
      if (p.shape === 'diamond') d = Math.abs(nx) + Math.abs(ny);
      else if (p.shape === 'square') d = Math.max(Math.abs(nx), Math.abs(ny));
      else if (p.shape === 'line') d = Math.abs(ny);
      else if (p.shape === 'cross') d = Math.min(Math.abs(nx), Math.abs(ny));
      else if (p.shape === 'ellipse') d = Math.sqrt(nx*nx*1.5 + ny*ny*0.7);
      else d = Math.sqrt(nx*nx + ny*ny);
      let val = clamp(px[i]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      const t = (1 - val) * p.dotGain * (1 + p.edgeBoost * mag[i]);
      let result;
      if (p.softness > 0) { const s2 = d - t; result = clamp(128 - s2/p.softness*128); }
      else result = d < t ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 3) Tone-Zone Pattern — three different patterns blended by image tone.
  // Different look for shadows, midtones, and highlights with smooth bands.
  A.push({ id:'tone-zone-pattern', name:'Tone-Zone Pattern', category:'image-aware', params:[
    {id:'shadowPattern',label:'Shadows',type:'select',options:[
      {value:'bayer-2',label:'Bayer 2x2'},{value:'bayer-4',label:'Bayer 4x4'},
      {value:'bayer-8',label:'Bayer 8x8'},{value:'lines-h',label:'Lines H'},
      {value:'lines-v',label:'Lines V'},{value:'cross',label:'Cross-hatch'},
      {value:'dots',label:'Dots'},{value:'noise',label:'Noise'}
    ],default:'lines-h'},
    {id:'midPattern',label:'Midtones',type:'select',options:[
      {value:'bayer-2',label:'Bayer 2x2'},{value:'bayer-4',label:'Bayer 4x4'},
      {value:'bayer-8',label:'Bayer 8x8'},{value:'lines-h',label:'Lines H'},
      {value:'lines-v',label:'Lines V'},{value:'cross',label:'Cross-hatch'},
      {value:'dots',label:'Dots'},{value:'noise',label:'Noise'}
    ],default:'bayer-4'},
    {id:'highPattern',label:'Highlights',type:'select',options:[
      {value:'bayer-2',label:'Bayer 2x2'},{value:'bayer-4',label:'Bayer 4x4'},
      {value:'bayer-8',label:'Bayer 8x8'},{value:'lines-h',label:'Lines H'},
      {value:'lines-v',label:'Lines V'},{value:'cross',label:'Cross-hatch'},
      {value:'dots',label:'Dots'},{value:'noise',label:'Noise'}
    ],default:'dots'},
    {id:'shadowMid',label:'Shadow/Mid Split',min:30,max:120,step:1,default:80},
    {id:'midHigh',label:'Mid/High Split',min:130,max:230,step:1,default:175},
    {id:'feather',label:'Band Feather',min:1,max:60,step:1,default:25},
    {id:'patternScale',label:'Pattern Scale',min:1,max:8,step:1,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    const r = mkRand(p.seed);
    const noise = new Float32Array(w*h);
    for (let i = 0; i < w*h; i++) noise[i] = r();
    const bay2 = normBayer(2), bay4 = normBayer(4), bay8 = normBayer(8);
    const sc = p.patternScale;
    function patternThresh(name, x, y) {
      const xs = Math.floor(x / sc), ys = Math.floor(y / sc);
      switch (name) {
        case 'bayer-2': return bay2[ys%2][xs%2];
        case 'bayer-4': return bay4[ys%4][xs%4];
        case 'bayer-8': return bay8[ys%8][xs%8];
        case 'lines-h': return ((ys % 4) < 2) ? 0.3 : 0.7;
        case 'lines-v': return ((xs % 4) < 2) ? 0.3 : 0.7;
        case 'cross': {
          const a = (xs % 4) < 2, b = (ys % 4) < 2;
          return (a !== b) ? 0.35 : 0.65;
        }
        case 'dots': {
          const dx = (xs % 4) - 2, dy = (ys % 4) - 2;
          return Math.sqrt(dx*dx + dy*dy) / 3;
        }
        case 'noise': return noise[(y%h)*w + (x%w)];
        default: return 0.5;
      }
    }
    const sm = p.shadowMid, mh = p.midHigh, fe = p.feather;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      let v = clamp(px[i]);
      if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      // Compute per-zone weights using soft transitions
      let wS = 0, wM = 0, wH = 0;
      if (v <= sm - fe) wS = 1;
      else if (v <= sm + fe) {
        const t = (v - (sm - fe)) / (fe * 2);
        wS = 1 - t; wM = t;
      } else if (v <= mh - fe) wM = 1;
      else if (v <= mh + fe) {
        const t = (v - (mh - fe)) / (fe * 2);
        wM = 1 - t; wH = t;
      } else wH = 1;
      // Blend pattern thresholds by zone weight
      const tS = patternThresh(p.shadowPattern, x, y);
      const tM = patternThresh(p.midPattern, x, y);
      const tH = patternThresh(p.highPattern, x, y);
      const blendT = (tS * wS + tM * wM + tH * wH) * 255;
      const result = v > blendT ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // 4) Flow Halftone — halftone "rows" curve to follow image gradient
  // streamlines instead of being a rigid grid. Creates intricate
  // contour-following dot patterns.
  A.push({ id:'flow-halftone', name:'Flow Halftone', category:'image-aware', params:[
    {id:'dotSize',label:'Dot Size',min:3,max:20,step:1,default:7},
    {id:'lineSpacing',label:'Row Spacing',min:3,max:24,step:1,default:8},
    {id:'flowStrength',label:'Flow Strength',min:0,max:1,step:.05,default:.7,
     hint:'0 = straight grid, 1 = fully curved'},
    {id:'regionSize',label:'Sample Region',min:2,max:32,step:1,default:10},
    {id:'shape',label:'Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'square',label:'Square'}
    ],default:'circle'},
    {id:'dotGain',label:'Dot Gain',min:.5,max:2.5,step:.05,default:1.4},
    {id:'softness',label:'Softness',min:0,max:1,step:.05,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const { ang } = regionGradients(px, w, h, p.regionSize);
    const ds = p.dotSize, sp = p.lineSpacing;
    // Build cumulative-warp coordinates: each pixel's "row" follows the
    // gradient field. We construct a warped Y coordinate by integrating
    // the perpendicular component of a unit-along-isophote direction.
    const warpY = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = y;
      for (let x = 0; x < w; x++) {
        const i = y*w+x;
        // Tangent direction (perpendicular to gradient)
        const a = (ang[i] || 0) + Math.PI/2;
        // Warp Y coordinate by tangent's Y component scaled by flowStrength
        if (x > 0) acc += -Math.sin(a) * p.flowStrength;
        warpY[i] = acc;
      }
    }
    const warpX = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = x;
      for (let y = 0; y < h; y++) {
        const i = y*w+x;
        const a = (ang[i] || 0) + Math.PI/2;
        if (y > 0) acc += Math.cos(a) * p.flowStrength;
        warpX[i] = acc;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      const wx = warpX[i], wy = warpY[i];
      const cellY = Math.floor(wy / sp);
      const localY = wy - cellY * sp; // 0..sp
      const cellX = Math.floor(wx / ds);
      const localX = wx - cellX * ds; // 0..ds
      // Map to dot-cell normalized coords (-1..1)
      const nx = (localX/ds - .5) * 2;
      const ny = (localY/sp - .5) * 2;
      let d;
      if (p.shape === 'diamond') d = Math.abs(nx) + Math.abs(ny);
      else if (p.shape === 'square') d = Math.max(Math.abs(nx), Math.abs(ny));
      else d = Math.sqrt(nx*nx + ny*ny);
      let val = clamp(px[i]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      const t = (1 - val) * p.dotGain;
      let inside;
      if (p.softness > 0) { const s2 = d - t; inside = (128 - s2/p.softness*128) > 128; }
      else inside = d < t;
      if (inside) o[i] = ink;
    }
    return o;
  }});

  // 5) Hyper-Ordered — Bayer with per-pixel rotation set by gradient angle.
  // Pattern itself rotates to follow image features at every pixel.
  A.push({ id:'hyper-ordered', name:'Hyper-Ordered (Rotating Bayer)', category:'image-aware', params:[
    {id:'size',label:'Matrix',type:'select',options:[
      {value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'},{value:32,label:'32x32'}
    ],default:8},
    {id:'rotInfluence',label:'Rotation Follow',min:0,max:1,step:.05,default:.6,
     hint:'how much gradient rotates the pattern locally'},
    {id:'regionSize',label:'Region Size',min:2,max:32,step:1,default:6},
    {id:'spread',label:'Spread',min:0,max:255,step:1,default:128},
    {id:'edgePush',label:'Edge Threshold Bias',min:-1,max:1,step:.05,default:0,
     hint:'+: brighten edges. -: darken edges.'},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const sz = +p.size, mat = normBayer(sz), o = new Uint8ClampedArray(w*h);
    const { mag, ang } = regionGradients(px, w, h, p.regionSize);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      // Rotation angle follows local gradient (lerp from 0)
      const theta = (ang[i] || 0) * p.rotInfluence;
      const ca = Math.cos(theta), sa = Math.sin(theta);
      const rx = Math.round(x*ca + y*sa), ry = Math.round(-x*sa + y*ca);
      const bx = ((rx % sz) + sz) % sz, by = ((ry % sz) + sz) % sz;
      let v = clamp(px[i]); if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
      v += (mat[by][bx] - .5) * p.spread;
      const thr = p.threshold - p.edgePush * 80 * mag[i];
      const result = v > thr ? 255 : 0;
      o[i] = p.invert ? 255 - result : result;
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // SCENE UNDERSTANDING
  // Approximates global scene properties an artist would read first:
  // where the light is coming from, mean tone, contrast, edge density,
  // and tone-zone histogram peaks. Used by every "scene-aware" algo
  // below so they can make artistic decisions, not just local ones.
  // ═══════════════════════════════════════════
  function analyzeScene(px, w, h) {
    const n = w * h;
    // Pass 1: weighted bright/dark centroids + sums
    let bX = 0, bY = 0, bW = 0;
    let dX = 0, dY = 0, dW = 0;
    let sum = 0, sumSq = 0;
    let pBright = 0, pMid = 0, pDark = 0;
    // Sample-stride for big images (cap at ~150k samples)
    const stride = Math.max(1, Math.floor(Math.sqrt(n / 150000)));
    for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
      const v = clamp(px[y*w+x]);
      const ln = v / 255;
      sum += ln; sumSq += ln * ln;
      if (ln > 0.5) { const wt = (ln - 0.5) * 2; bX += x*wt; bY += y*wt; bW += wt; pBright++; }
      if (ln < 0.5) { const wt = (0.5 - ln) * 2; dX += x*wt; dY += y*wt; dW += wt; pDark++; }
      if (ln >= 0.4 && ln <= 0.6) pMid++;
    }
    const samples = Math.ceil(w/stride) * Math.ceil(h/stride);
    const meanLum = sum / samples;
    const variance = sumSq / samples - meanLum * meanLum;
    const contrast = Math.min(1, Math.sqrt(Math.max(0, variance)) * 2);
    let lightX = 0, lightY = 0, lightStrength = 0;
    if (bW > 0 && dW > 0) {
      const bcx = bX / bW, bcy = bY / bW;
      const dcx = dX / dW, dcy = dY / dW;
      const vx = bcx - dcx, vy = bcy - dcy;
      const m = Math.sqrt(vx*vx + vy*vy) || 1;
      lightX = vx / m; lightY = vy / m;
      // Strength: how separated bright vs dark are, normalized to image diagonal
      const diag = Math.sqrt(w*w + h*h);
      lightStrength = Math.min(1, m / (diag * 0.5));
    }
    // Pass 2: edge density (cheap sample on a coarse grid)
    let edgeAcc = 0, edgeN = 0;
    const eStride = Math.max(2, stride);
    for (let y = 1; y < h - 1; y += eStride) for (let x = 1; x < w - 1; x += eStride) {
      edgeAcc += sobelAt(px, x, y, w, h).mag; edgeN++;
    }
    const maxPossibleEdge = 1020; // 4*255 typical sobel ceiling
    const edgeDensity = Math.min(1, (edgeAcc / Math.max(1, edgeN)) / maxPossibleEdge * 4);
    return {
      lightX, lightY, lightStrength,
      meanLum, contrast, edgeDensity,
      brightFrac: pBright / samples,
      midFrac: pMid / samples,
      darkFrac: pDark / samples,
      // Suggested artistic stroke angle: perpendicular to light direction
      hatchAngle: Math.atan2(lightY, lightX) + Math.PI / 2
    };
  }

  // ═══════════════════════════════════════════
  // SCENE-AWARE PATTERNS (3 advanced + 3 ASCII)
  // ═══════════════════════════════════════════

  // 6) Adaptive Bayer Pro — every dot's shape, size, color, edge, and
  // anisotropy is steered by image content + global scene understanding.
  A.push({ id:'adaptive-bayer-pro', name:'Adaptive Bayer Pro', category:'image-aware', params:[
    {id:'matrixSize',label:'Matrix',type:'select',options:[
      {value:4,label:'4x4'},{value:8,label:'8x8'},{value:16,label:'16x16'}
    ],default:8},
    {id:'cellSize',label:'Cell Size',min:2,max:32,step:1,default:6,
     hint:'physical pixel size of each dot cell'},
    {id:'sizeByDetail',label:'Size · Detail',min:-1,max:1,step:.05,default:.6,
     hint:'+: shrink in detail, -: grow in detail'},
    {id:'sizeByTone',label:'Size · Tone',min:-1,max:1,step:.05,default:.5,
     hint:'+: bigger in shadows, -: bigger in highlights'},
    {id:'shape',label:'Base Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'square',label:'Square'},{value:'cross',label:'Cross'},{value:'star',label:'Star'}
    ],default:'circle'},
    {id:'shapeByZone',label:'Shape · Zone',min:0,max:1,step:.05,default:.5,
     hint:'shape morphs across tone zones (shadow/mid/highlight)'},
    {id:'edgeHalo',label:'Edge Halo',min:0,max:1,step:.05,default:.4,
     hint:'soften dot edges near image edges'},
    {id:'anisotropy',label:'Light Trails',min:0,max:1,step:.05,default:.3,
     hint:'elongate dots toward scene light direction'},
    {id:'modulation',label:'Modulation',min:0,max:1,step:.05,default:0,
     hint:'sine-wave threshold for stripe interference'},
    {id:'modFreq',label:'Mod Frequency',min:.01,max:.5,step:.01,default:.1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const matSize = +p.matrixSize, mat = normBayer(matSize);
    const scene = analyzeScene(px, w, h);
    const { mag } = gradientFields(px, w, h);
    const cs = p.cellSize;
    // Light-trail orientation: anisotropy stretches along scene light dir
    const lightAng = Math.atan2(scene.lightY, scene.lightX);
    const aniCos = Math.cos(lightAng), aniSin = Math.sin(lightAng);
    function shapeDist(name, nx, ny) {
      switch (name) {
        case 'diamond': return Math.abs(nx) + Math.abs(ny);
        case 'square':  return Math.max(Math.abs(nx), Math.abs(ny));
        case 'cross':   return Math.min(Math.abs(nx), Math.abs(ny)) * 2;
        case 'star': {
          const r2 = Math.sqrt(nx*nx + ny*ny);
          const a = Math.atan2(ny, nx);
          return r2 * (1 + 0.5 * Math.cos(5 * a));
        }
        default: return Math.sqrt(nx*nx + ny*ny);
      }
    }
    // Cell-grid loop: each cell renders a dot whose properties are scene/local-aware
    for (let cy = 0; cy < h; cy += cs) for (let cx = 0; cx < w; cx += cs) {
      const midX = Math.min(w-1, cx + (cs >> 1));
      const midY = Math.min(h-1, cy + (cs >> 1));
      const i = midY * w + midX;
      // Per-cell tone, detail
      let v = clamp(px[i]) / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      const detail = mag[i]; // 0-1
      // Bayer threshold offset for this cell
      const bx = ((cx / cs) | 0) % matSize, by = ((cy / cs) | 0) % matSize;
      const bayerT = mat[by][bx];
      // Modulated threshold
      const mod = p.modulation > 0
        ? Math.sin((cx + cy) * p.modFreq) * 0.5 * p.modulation : 0;
      // Per-cell dot radius driven by tone + detail
      const toneR = (1 - v) * (1 + p.sizeByTone * (1 - v));
      const detailMul = p.sizeByDetail >= 0
        ? 1 - detail * p.sizeByDetail
        : 1 + detail * (-p.sizeByDetail);
      const radius = Math.max(0, Math.min(1, (toneR * detailMul + mod) * 1.2));
      // Skip empty highlights
      if (radius < bayerT - 0.4) continue;
      // Shape morph: blend distance metrics across zones
      const shapeIdx = ['circle','diamond','square','cross','star'].indexOf(p.shape);
      const shapeOptions = ['circle','diamond','square','cross','star'];
      let chosenShape = p.shape;
      if (p.shapeByZone > 0) {
        // Shadow → cross/star, mid → diamond/square, highlight → circle
        let zoneShape;
        if (v < 0.33) zoneShape = 'star';
        else if (v < 0.66) zoneShape = 'diamond';
        else zoneShape = 'circle';
        // Probabilistic mix using bayerT as the dither (deterministic per cell)
        chosenShape = bayerT < p.shapeByZone ? zoneShape : p.shape;
      }
      // Edge halo: soften near edges by widening fall-off
      const halo = p.edgeHalo * detail;
      // Render dot inside cell with anisotropy along scene light
      const ani = p.anisotropy * scene.lightStrength;
      for (let dy = 0; dy < cs && cy + dy < h; dy++) {
        for (let dx = 0; dx < cs && cx + dx < w; dx++) {
          const nx0 = (dx + 0.5) / cs * 2 - 1;
          const ny0 = (dy + 0.5) / cs * 2 - 1;
          // Anisotropic transform: stretch along light direction
          let nx = nx0, ny = ny0;
          if (ani > 0) {
            // Rotate into light frame, scale, rotate back
            const u = nx*aniCos + ny*aniSin;
            const t = -nx*aniSin + ny*aniCos;
            const stretch = 1 + ani * 1.2;
            nx = (u/stretch) * aniCos - t * aniSin;
            ny = (u/stretch) * aniSin + t * aniCos;
          }
          const d = shapeDist(chosenShape, nx, ny);
          const insideR = radius;
          const fx = cx + dx, fy = cy + dy;
          const ii = fy*w + fx;
          if (halo > 0) {
            // Smooth falloff from 1 inside to 0 at radius+halo
            const t = (insideR - d) / Math.max(0.0001, halo);
            const a = Math.max(0, Math.min(1, t));
            o[ii] = Math.round(o[ii] * (1 - a) + ink * a);
          } else {
            if (d < insideR) o[ii] = ink;
          }
        }
      }
    }
    return o;
  }});

  // 7) Light-Aware Cross-Hatch — strokes drawn perpendicular to estimated
  // scene light direction (the way a hatching artist would). Adds cross
  // strokes in shadow zones, light strokes in highlights.
  A.push({ id:'light-hatch', name:'Light-Aware Cross-Hatch', category:'image-aware', params:[
    {id:'spacing',label:'Stroke Spacing',min:2,max:20,step:1,default:5},
    {id:'length',label:'Stroke Length',min:3,max:30,step:1,default:8},
    {id:'thickness',label:'Thickness',min:1,max:3,step:1,default:1},
    {id:'crossThreshold',label:'Cross Threshold',min:0,max:1,step:.05,default:.5,
     hint:'darkness above which cross-hatching kicks in'},
    {id:'crossAngle',label:'Cross Angle',min:30,max:90,step:5,default:60,
     hint:'degrees offset for the second hatch direction'},
    {id:'lightOverride',label:'Light Direction',min:-180,max:180,step:5,default:0,
     hint:'manual override: 0 uses scene-detected light'},
    {id:'sketchiness',label:'Sketchiness',min:0,max:1,step:.05,default:.2,
     hint:'wobble + breaks for hand-drawn feel'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const r = mkRand(p.seed);
    const scene = analyzeScene(px, w, h);
    // Use scene hatch angle (perpendicular to light) unless overridden
    const baseAng = p.lightOverride !== 0
      ? p.lightOverride * Math.PI / 180
      : scene.hatchAngle;
    const cross1A = baseAng;
    const cross2A = baseAng + p.crossAngle * Math.PI / 180;
    const sp = p.spacing, lenBase = p.length;
    function drawStroke(cx, cy, dirAng, density) {
      const dx = Math.cos(dirAng), dy = Math.sin(dirAng);
      const len = lenBase * density;
      const wob = p.sketchiness * 1.5;
      // Optional break in middle for sketchiness
      const breakAt = p.sketchiness > 0.5 ? (r() < (p.sketchiness - 0.5) * 2 ? r() * len : -1) : -1;
      for (let t = -len/2; t <= len/2; t += 0.5) {
        if (breakAt > 0 && Math.abs(t - (breakAt - len/2)) < 0.6) continue;
        const wx = wob > 0 ? Math.sin(t * 0.4) * wob : 0;
        const sx = Math.round(cx + t * dx + (-dy) * wx);
        const sy = Math.round(cy + t * dy + dx * wx);
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        for (let dty = -Math.floor(p.thickness/2); dty <= Math.floor(p.thickness/2); dty++)
          for (let dtx = -Math.floor(p.thickness/2); dtx <= Math.floor(p.thickness/2); dtx++) {
            const fx = sx + dtx, fy = sy + dty;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) o[fy*w+fx] = ink;
          }
      }
    }
    for (let y = 0; y < h; y += sp) for (let x = 0; x < w; x += sp) {
      let v = clamp(px[y*w+x]) / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      const darkness = 1 - v;
      if (darkness < 0.05) continue;
      // Layer 1: always present, density scales with darkness
      drawStroke(x, y, cross1A, Math.min(1, darkness * 1.2));
      // Layer 2: cross-hatch only in zones above crossThreshold
      if (darkness > p.crossThreshold) {
        const d2 = (darkness - p.crossThreshold) / Math.max(0.05, 1 - p.crossThreshold);
        drawStroke(x, y, cross2A, d2);
      }
    }
    return o;
  }});

  // 8) Scene-Aware Halftone — combines tone-zone shape switching, edge
  // proximity sizing, light-driven anisotropy, and global scene contrast
  // adjustment in one image-aware halftone.
  A.push({ id:'scene-halftone', name:'Scene-Aware Halftone', category:'image-aware', params:[
    {id:'dotSize',label:'Cell Size',min:3,max:24,step:1,default:8},
    {id:'shadowShape',label:'Shadow Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'square',label:'Square'}
    ],default:'star'},
    {id:'midShape',label:'Mid Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'square',label:'Square'}
    ],default:'diamond'},
    {id:'highlightShape',label:'Highlight Shape',type:'select',options:[
      {value:'circle',label:'Circle'},{value:'diamond',label:'Diamond'},
      {value:'cross',label:'Cross'},{value:'star',label:'Star'},{value:'square',label:'Square'}
    ],default:'circle'},
    {id:'lightTrails',label:'Light Trails',min:0,max:1,step:.05,default:.4,
     hint:'dots stretch along detected light direction'},
    {id:'edgeBoost',label:'Edge Boost',min:0,max:1.5,step:.05,default:.6},
    {id:'autoContrast',label:'Auto Contrast',min:0,max:1,step:.05,default:.7,
     hint:'use scene contrast to auto-tune dot gain'},
    {id:'angle',label:'Base Angle',min:0,max:90,step:1,default:45},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h);
    o.fill(p.invert ? 0 : 255);
    const ink = p.invert ? 255 : 0;
    const ds = p.dotSize;
    const scene = analyzeScene(px, w, h);
    const { mag } = gradientFields(px, w, h);
    // Auto-tune dot gain by scene contrast (high-contrast scene → less gain)
    const dotGain = (1.4 + (1 - scene.contrast) * 0.6) * (1 - p.autoContrast)
                  + 1.4 * p.autoContrast * (1 + (1 - scene.contrast) * 0.4);
    const ang = p.angle * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const lightAng = Math.atan2(scene.lightY, scene.lightX);
    const lc = Math.cos(lightAng), ls = Math.sin(lightAng);
    function dist(name, nx, ny) {
      switch (name) {
        case 'diamond': return Math.abs(nx) + Math.abs(ny);
        case 'square':  return Math.max(Math.abs(nx), Math.abs(ny));
        case 'cross':   return Math.min(Math.abs(nx), Math.abs(ny)) * 2;
        case 'star': {
          const r2 = Math.sqrt(nx*nx + ny*ny), a = Math.atan2(ny, nx);
          return r2 * (1 + 0.4 * Math.cos(5 * a));
        }
        default: return Math.sqrt(nx*nx + ny*ny);
      }
    }
    const ani = p.lightTrails * scene.lightStrength;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w+x;
      let val = clamp(px[i]) / 255;
      if (p.gamma !== 1) val = Math.pow(val, p.gamma);
      // Shape selection by tone zone
      const shape = val < 0.33 ? p.shadowShape : (val < 0.66 ? p.midShape : p.highlightShape);
      // Cell coords with rotation
      const rx = x*ca + y*sa, ry = -x*sa + y*ca;
      const cx = ((rx % ds) + ds) % ds, cy = ((ry % ds) + ds) % ds;
      let nx = (cx/ds - .5) * 2, ny = (cy/ds - .5) * 2;
      if (ani > 0) {
        const u = nx*lc + ny*ls;
        const t = -nx*ls + ny*lc;
        const stretch = 1 + ani * 1.5;
        nx = (u/stretch) * lc - t * ls;
        ny = (u/stretch) * ls + t * lc;
      }
      const d = dist(shape, nx, ny);
      const t = (1 - val) * dotGain * (1 + p.edgeBoost * mag[i]);
      if (d < t) o[i] = ink;
    }
    return o;
  }});

  // ─────────────────────────────────────────────
  // SCENE-AWARE ASCII (3)
  // ─────────────────────────────────────────────

  // 9) ASCII Light-Aware — character density falls off with distance
  // from the scene's lit centroid, like a sketched chiaroscuro.
  A.push({ id:'ascii-light', name:'ASCII Light-Aware', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'charset',label:'Character Set',type:'select',options:charsetOptions,default:'standard'},
    {id:'lightFalloff',label:'Light Falloff',min:0,max:1,step:.05,default:.5,
     hint:'how strongly distance from lit centroid darkens characters'},
    {id:'shadowDepth',label:'Shadow Depth',min:0,max:1,step:.05,default:.3,
     hint:'extra darkness for cells far from light'},
    {id:'invertLight',label:'Invert Light',type:'checkbox',default:false},
    {id:'fontScale',label:'Font Scale',min:.5,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const ramp = asciiRamp(p.charset);
    const cs = p.cellSize;
    const g = getGlyphs(ramp, cs, cs, p.fontScale);
    const scene = analyzeScene(px, w, h);
    // Lit centroid in image coords (recompute from scene light direction
    // by stepping from center along light vec)
    const cx = w / 2, cy = h / 2;
    const litX = cx + scene.lightX * w * 0.4;
    const litY = cy + scene.lightY * h * 0.4;
    const maxDist = Math.sqrt(w*w + h*h) / 2;
    for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
      const stats = cellStats(px, x, y, cs, cs, w, h);
      let v = stats.avg / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      // Distance to lit centroid → 0 (at center) to 1 (corners)
      const dx = (x + cs/2) - litX, dy = (y + cs/2) - litY;
      const distNorm = Math.min(1, Math.sqrt(dx*dx + dy*dy) / maxDist);
      const litFactor = p.invertLight ? distNorm : (1 - distNorm);
      // Lit areas → lighter chars (lower coverage), shadow → darker chars
      const adjusted = v * (1 - p.lightFalloff) + litFactor * p.lightFalloff;
      const finalCov = Math.max(0, Math.min(1, 1 - adjusted - (1 - litFactor) * p.shadowDepth));
      const idx = pickGlyphIdx(g.sortedCoverages, finalCov);
      stampGlyph(o, g.sortedGlyphs[idx], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
    }
    return o;
  }});

  // 10) ASCII Edge-Following — picks a glyph that matches the local edge
  // orientation. Horizontal edges → "─", vertical → "│", diagonals → "/" "\".
  A.push({ id:'ascii-edge-flow', name:'ASCII Edge-Following', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:200,step:5,default:60,
     hint:'Sobel magnitude above which directional chars take over'},
    {id:'fillCharset',label:'Fill Charset',type:'select',options:charsetOptions,default:'standard'},
    {id:'edgeStyle',label:'Edge Glyphs',type:'select',options:[
      {value:'box-light',label:'Light Lines  ─│┌┐'},
      {value:'box-heavy',label:'Heavy Lines  ═║╔╗'},
      {value:'slashes',label:'Slashes  /\\|─'},
      {value:'arrows',label:'Arrows  ←↑→↓'}
    ],default:'box-light'},
    {id:'fontScale',label:'Font Scale',min:.5,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;
    const fillRamp = asciiRamp(p.fillCharset);
    const fillG = getGlyphs(fillRamp, cs, cs, p.fontScale);
    // Build a directional glyph palette: horiz, vert, diag↘, diag↗
    const dirs = {
      'box-light':  ['─', '│', '╲', '╱', '┼'],
      'box-heavy':  ['═', '║', '╲', '╱', '╬'],
      'slashes':    ['─', '|', '\\', '/', 'X'],
      'arrows':     ['→', '↑', '↘', '↗', '+']
    };
    const charSet = dirs[p.edgeStyle] || dirs['box-light'];
    const dirGlyphs = charSet.map(c => getGlyphs(c, cs, cs, p.fontScale).glyphs[0]);
    for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
      const stats = cellStats(px, x, y, cs, cs, w, h);
      let v = stats.avg / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      if (stats.edgeMag > p.edgeThreshold) {
        // Pick directional glyph based on angle (4 buckets + cross)
        // Sobel angle: 0 = →, π/2 = ↓, π = ←
        let a = stats.edgeAng;
        // Wrap to 0..π (orientation, not direction)
        while (a < 0) a += Math.PI;
        while (a >= Math.PI) a -= Math.PI;
        // Edge orientation perpendicular to gradient: line direction = a + π/2
        const lineA = (a + Math.PI / 2) % Math.PI;
        let idx;
        if      (lineA < Math.PI * 0.125 || lineA >= Math.PI * 0.875) idx = 0; // horizontal
        else if (lineA < Math.PI * 0.375) idx = 3;                              // ↗
        else if (lineA < Math.PI * 0.625) idx = 1;                              // vertical
        else                                  idx = 2;                              // ↘
        // High-contrast cells use the "cross" cell
        if (stats.contrast > 200) idx = 4;
        stampGlyph(o, dirGlyphs[idx], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      } else {
        const cov = 1 - v;
        const gi = pickGlyphIdx(fillG.sortedCoverages, cov);
        stampGlyph(o, fillG.sortedGlyphs[gi], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      }
    }
    return o;
  }});

  // 11) ASCII Tone-Zone — separate character sets for shadows / midtones /
  // highlights, with feathered transitions. Good for layered graphic looks.
  A.push({ id:'ascii-tone-zone', name:'ASCII Tone-Zone', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'shadowSet',label:'Shadow Charset',type:'select',options:charsetOptions,default:'blocks'},
    {id:'midSet',label:'Mid Charset',type:'select',options:charsetOptions,default:'standard'},
    {id:'highSet',label:'Highlight Charset',type:'select',options:charsetOptions,default:'dots'},
    {id:'shadowMid',label:'Shadow/Mid Split',min:.05,max:.5,step:.05,default:.33},
    {id:'midHigh',label:'Mid/Highlight Split',min:.5,max:.95,step:.05,default:.66},
    {id:'feather',label:'Feather',min:0,max:.3,step:.01,default:.08},
    {id:'fontScale',label:'Font Scale',min:.5,max:1.5,step:.05,default:1},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;
    const shG = getGlyphs(asciiRamp(p.shadowSet), cs, cs, p.fontScale);
    const mdG = getGlyphs(asciiRamp(p.midSet),    cs, cs, p.fontScale);
    const hiG = getGlyphs(asciiRamp(p.highSet),   cs, cs, p.fontScale);
    const r = mkRand(p.seed);
    for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
      const stats = cellStats(px, x, y, cs, cs, w, h);
      let v = stats.avg / 255;
      if (p.gamma !== 1) v = Math.pow(v, p.gamma);
      // Determine zone weights with feathered transitions
      const sm = p.shadowMid, mh = p.midHigh, fe = p.feather;
      let wS = 0, wM = 0, wH = 0;
      if (v <= sm - fe) wS = 1;
      else if (v <= sm + fe) { const t = (v - (sm - fe)) / (fe * 2); wS = 1 - t; wM = t; }
      else if (v <= mh - fe) wM = 1;
      else if (v <= mh + fe) { const t = (v - (mh - fe)) / (fe * 2); wM = 1 - t; wH = t; }
      else wH = 1;
      // Probabilistic zone pick using cell-level rand for crisp boundaries
      const pick = r();
      let zoneG;
      if (pick < wS) zoneG = shG;
      else if (pick < wS + wM) zoneG = mdG;
      else zoneG = hiG;
      const cov = 1 - v;
      const gi = pickGlyphIdx(zoneG.sortedCoverages, cov);
      stampGlyph(o, zoneG.sortedGlyphs[gi], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ASCII BINARY — 0s and 1s only, dithered
  // ═══════════════════════════════════════════
  // Each cell becomes either '0' or '1' based on local brightness. Uses a
  // Bayer matrix for controlled patterning (not random) so you can dial
  // between hard threshold (posterized) and heavily dithered "Matrix"
  // printouts. Optional edge-bias picks '1' (denser glyph) on strong edges
  // to preserve silhouettes.
  A.push({ id:'ascii-binary', name:'ASCII Binary 01', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'bayer',label:'Bayer Size',type:'select',options:[
      {value:0,label:'None (hard)'},{value:2,label:'2×2'},
      {value:4,label:'4×4'},{value:8,label:'8×8'},{value:16,label:'16×16'}
    ],default:4},
    {id:'spread',label:'Dither Spread',min:0,max:255,step:1,default:128},
    {id:'edgeBias',label:'Edge Bias',min:0,max:2,step:.05,default:.6},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255},
    {id:'invert',label:'Invert',type:'checkbox',default:false}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;
    // Build glyph bitmaps for '0' and '1' at the chosen cell size/scale
    const gSet = getGlyphs(' 01', cs, cs, p.fontScale);
    // Indices: 0 = space, 1 = '0', 2 = '1' (in input order; gSet.glyphs preserves order)
    const gZero = gSet.glyphs[1];
    const gOne = gSet.glyphs[2];
    const bSize = +p.bayer;
    const b = bSize > 0 ? normBayer(bSize) : null;
    for (let y = 0; y < h; y += cs) {
      for (let x = 0; x < w; x += cs) {
        const stats = cellStats(px, x, y, cs, cs, w, h);
        let v = stats.avg;
        if (p.gamma !== 1) v = Math.pow(v/255, p.gamma) * 255;
        if (b) {
          const by = ((y/cs)|0) % bSize, bx = ((x/cs)|0) % bSize;
          v += (b[by][bx] - 0.5) * p.spread;
        }
        // Edge pixels bias toward '1' (denser glyph) so silhouettes pop
        if (p.edgeBias > 0 && stats.edgeMag > 25) {
          v -= stats.edgeMag * p.edgeBias * 0.4;
        }
        let isOne = v < p.threshold;
        if (p.invert) isOne = !isOne;
        const gl = isOne ? gOne : gZero;
        stampGlyph(o, gl, x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // ASCII PRO — ultimate image-aware ASCII
  // ═══════════════════════════════════════════
  // Combines ALL charsets (rare math/stars/arrows/currency glyphs included)
  // into one huge coverage-sorted ramp, then picks the best glyph per cell
  // by BOTH coverage AND edge direction. When a cell has a strong gradient,
  // we prefer an orientation-matching glyph (|, /, ─, \) regardless of
  // coverage — this preserves structure like hair strands, skylines, wires.
  // A blue-noise jitter lets the same brightness level pick different
  // "synonymous" glyphs in adjacent cells so flat regions don't repeat.
  A.push({ id:'ascii-pro', name:'ASCII Pro', category:'ascii', params:[
    {id:'cellSize',label:'Cell Size',min:4,max:20,step:1,default:8},
    {id:'fontScale',label:'Font Scale',min:.5,max:2,step:.1,default:1},
    {id:'charPool',label:'Character Pool',type:'select',options:[
      {value:'ultra',label:'Ultra (all sets + rare)'},
      {value:'wide',label:'Wide (letters + symbols)'},
      {value:'structural',label:'Structural (box + slashes)'},
      {value:'celestial',label:'Celestial (stars + math)'}
    ],default:'ultra'},
    {id:'edgeAware',label:'Edge Awareness',min:0,max:1,step:.05,default:.7},
    {id:'edgeThreshold',label:'Edge Threshold',min:5,max:200,step:5,default:40},
    {id:'contrastBoost',label:'Contrast Boost',min:0,max:2,step:.05,default:.5},
    {id:'shadowDetail',label:'Shadow Detail',min:0,max:2,step:.1,default:1.2},
    {id:'highlightDetail',label:'Highlight Detail',min:0,max:2,step:.1,default:0.8},
    {id:'jitter',label:'Synonym Jitter',min:0,max:1,step:.05,default:.25},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'inkDark',label:'Ink Dark',min:0,max:255,step:1,default:0},
    {id:'inkLight',label:'Ink Light',min:0,max:255,step:1,default:255},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w*h); o.fill(p.inkLight);
    const cs = p.cellSize;

    // Build the combined character pool. We also tag each character by
    // whether it's orientation-biased (which axis it "leans" toward).
    const pools = {
      ultra:      ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$·•●○◦◎◉⊙⊚░▒▓█┄┈╌─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬±×÷≈≠≤≥∞∑∏∫√∂∆Ω✦✧★☆✪✫✬✭✮✯◊◇◆△▲▽▼□■',
      wide:       ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
      structural: ' ·─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬/\\|—┄┈╌╍_=-',
      celestial:  ' ·✦✧★☆✪✫✬✭✮✯±×÷≈≠≤≥∞∑∏∫√∂∆Ω◊◇◆'
    };
    const rampStr = pools[p.charPool] || pools.ultra;
    const gSet = getGlyphs(rampStr, cs, cs, p.fontScale);

    // Tag orientation for each character: 0=none, 1=vertical, 2=horizontal,
    // 3=diag-down-right (/), 4=diag-down-left (\). Checked against input-order
    // character list, then mapped through sortIdx below.
    const chars = [...rampStr];
    const inputOri = chars.map(c => {
      if ('|│║┃╎╏╽╿⎸⎹'.includes(c)) return 1;
      if ('─━═╌╍━┄┈_-—–'.includes(c)) return 2;
      if ('/╱⁄'.includes(c)) return 3;
      if ('\\╲'.includes(c)) return 4;
      return 0;
    });
    // sortedOri[i] = orientation of the i-th glyph in sortedGlyphs
    const sortedOri = gSet.sortIdx.map(i => inputOri[i]);
    const sortedGlyphs = gSet.sortedGlyphs, sortedCov = gSet.sortedCoverages;

    // For edge-aware picks: partition sorted-index ranges by orientation
    // so we can quickly find an oriented glyph with ~target coverage.
    function pickOriented(targetCov, ori) {
      // Find nearest sorted index matching that orientation
      let best = -1, bestD = Infinity;
      for (let i = 0; i < sortedOri.length; i++) {
        if (sortedOri[i] !== ori) continue;
        const d = Math.abs(sortedCov[i] - targetCov);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    const rnd = mkRand(p.seed);

    for (let y = 0; y < h; y += cs) {
      for (let x = 0; x < w; x += cs) {
        const stats = cellStats(px, x, y, cs, cs, w, h);
        let vN = stats.avg / 255;
        if (p.gamma !== 1) vN = Math.pow(vN, p.gamma);

        // Contrast boost near zone boundaries
        if (p.contrastBoost > 0) {
          const mid = 0.5;
          vN = mid + (vN - mid) * (1 + p.contrastBoost);
          vN = Math.max(0, Math.min(1, vN));
        }
        // Zone-specific detail weighting
        if (vN < 0.4 && p.shadowDetail !== 1) {
          // Dark: push toward darker glyphs as shadowDetail rises
          vN = Math.max(0, vN * (1 / Math.max(0.1, p.shadowDetail)));
        } else if (vN > 0.6 && p.highlightDetail !== 1) {
          // Bright: push toward lighter glyphs when highlightDetail < 1
          vN = 1 - (1 - vN) * (1 / Math.max(0.1, p.highlightDetail));
        }
        if (p.invert) vN = 1 - vN;

        // Target coverage = darkness
        let targetCov = 1 - vN;

        // Edge-aware glyph override: if gradient is strong enough, try to
        // pick an orientation-aligned glyph with similar coverage.
        let glyphIdx = -1;
        if (p.edgeAware > 0 && stats.edgeMag > p.edgeThreshold) {
          const ang = stats.edgeAng;
          const deg = (ang * 180 / Math.PI + 360) % 180;
          // Gradient direction is perpendicular to the edge line itself, so
          // map gradient angle to the best matching stroke orientation.
          let ori;
          if (deg < 22.5 || deg >= 157.5) ori = 1;       // gradient ~horizontal → vertical stroke
          else if (deg < 67.5) ori = 3;                   // diag-down-right stroke
          else if (deg < 112.5) ori = 2;                  // horizontal stroke
          else ori = 4;                                   // diag-down-left
          const oi = pickOriented(targetCov, ori);
          if (oi >= 0) {
            // Mix between plain coverage pick and oriented pick
            const purePick = pickGlyphIdx(sortedCov, targetCov);
            const mix = Math.min(1, (stats.edgeMag - p.edgeThreshold) / 80 * p.edgeAware);
            glyphIdx = rnd() < mix ? oi : purePick;
          }
        }
        if (glyphIdx < 0) {
          glyphIdx = pickGlyphIdx(sortedCov, targetCov);
          // Synonym jitter: in flat areas pick a neighboring glyph with
          // near-identical coverage to break up repetition
          if (p.jitter > 0 && stats.contrast < 25) {
            const j = Math.round((rnd() - 0.5) * p.jitter * 6);
            glyphIdx = Math.max(0, Math.min(sortedGlyphs.length - 1, glyphIdx + j));
          }
        }
        stampGlyph(o, sortedGlyphs[glyphIdx], x, y, cs, cs, w, h, p.inkDark, p.inkLight);
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // BRAILLE ADVANCED — image-aware variable block sizes
  // ═══════════════════════════════════════════
  // Unlike the basic Braille Render (uniform cellW=2*ds × cellH=4*ds grid),
  // this one picks per-region BLOCK SIZE based on local image complexity:
  //   • High edge magnitude → small blocks (preserve detail)
  //   • High contrast      → small-to-medium blocks
  //   • Low contrast flat  → large blocks (abstract/stylized)
  //   • Shadow vs highlight → different dot-density bias
  // Blocks are placed via a greedy quad-tree style pass: start with coarse
  // blocks and subdivide any that exceed a complexity threshold.
  A.push({ id:'ascii-braille-pro', name:'Braille Advanced (Image-Aware)', category:'ascii', params:[
    {id:'minDot',label:'Min Dot Size',min:1,max:4,step:1,default:2},
    {id:'maxDot',label:'Max Dot Size',min:2,max:8,step:1,default:5},
    {id:'edgeSensitivity',label:'Edge Sensitivity',min:0,max:2,step:.05,default:1},
    {id:'contrastSensitivity',label:'Contrast Sensitivity',min:0,max:2,step:.05,default:.8},
    {id:'shadowBias',label:'Shadow Dot Bias',min:-1,max:1,step:.05,default:.2},
    {id:'highlightBias',label:'Highlight Dot Bias',min:-1,max:1,step:.05,default:-.2},
    {id:'threshold',label:'Threshold',min:0,max:255,step:1,default:128},
    {id:'adaptiveThreshold',label:'Adaptive Threshold',min:0,max:1,step:.05,default:.4},
    {id:'opArtMoire',label:'Op-Art Moiré',min:0,max:1,step:.05,default:0},
    {id:'dotShape',label:'Dot Shape',type:'select',options:[
      {value:'round',label:'Round'},{value:'square',label:'Square'},{value:'diamond',label:'Diamond'}
    ],default:'round'},
    {id:'gamma',label:'Gamma',min:.2,max:3,step:.05,default:1},
    {id:'invert',label:'Invert',type:'checkbox',default:false},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const o = new Uint8ClampedArray(w * h);
    o.fill(p.invert ? 0 : 255);
    const minD = Math.min(p.minDot, p.maxDot);
    const maxD = Math.max(p.minDot, p.maxDot);
    const rnd = mkRand(p.seed);

    // Precompute a local complexity score per coarse block so we can
    // choose dot sizes. Score combines edge magnitude and contrast.
    function complexityAt(cx, cy, cw, ch) {
      const stats = cellStats(px, cx, cy, cw, ch, w, h);
      const edgeN = Math.min(1, stats.edgeMag / 255) * p.edgeSensitivity;
      const contN = Math.min(1, stats.contrast / 128) * p.contrastSensitivity;
      return { score: Math.max(edgeN, contN), stats };
    }

    // Walk the image in coarse chunks (maxD * 2 wide, maxD * 4 tall = one
    // braille cell at maximum dot size). For each chunk, compute complexity
    // and pick a dot size that scales with 1 - complexity.
    const coarseW = maxD * 2, coarseH = maxD * 4;
    for (let cy = 0; cy < h; cy += coarseH) {
      for (let cx = 0; cx < w; cx += coarseW) {
        const comp = complexityAt(cx, cy, coarseW, coarseH);
        // score=1 → minD, score=0 → maxD
        const range = maxD - minD;
        const ds = Math.max(1, Math.round(maxD - comp.score * range));
        const dotR = ds / 2;

        // For each sub-cell at this dot size inside the coarse region
        for (let by = cy; by < cy + coarseH && by < h; by += ds * 4) {
          for (let bx = cx; bx < cx + coarseW && bx < w; bx += ds * 2) {
            // Local luminance for adaptive threshold inside this sub-cell
            let localSum = 0, localCount = 0;
            for (let dy = 0; dy < ds * 4 && by + dy < h; dy++) {
              for (let dx = 0; dx < ds * 2 && bx + dx < w; dx++) {
                localSum += clamp(px[(by + dy) * w + bx + dx]);
                localCount++;
              }
            }
            const localAvg = localCount > 0 ? localSum / localCount : 128;
            const thr0 = p.threshold * (1 - p.adaptiveThreshold) + localAvg * p.adaptiveThreshold;
            // Luminance-based dot bias: dark regions get extra dots
            // (shadowBias>0), highlights fewer dots (highlightBias<0).
            const lumN = localAvg / 255;
            let bias = 0;
            if (lumN < 0.4) bias = p.shadowBias * (1 - lumN / 0.4) * 30;
            else if (lumN > 0.6) bias = p.highlightBias * ((lumN - 0.6) / 0.4) * 30;
            const thr = thr0 + bias;

            // Emit the 2×4 dot pattern for this braille cell
            for (let dotY = 0; dotY < 4; dotY++) {
              for (let dotX = 0; dotX < 2; dotX++) {
                const scy = by + dotY * ds, scx = bx + dotX * ds;
                if (scy >= h || scx >= w) continue;
                let sum = 0, cnt = 0;
                for (let sy = 0; sy < ds && scy + sy < h; sy++) {
                  for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                    sum += clamp(px[(scy + sy) * w + scx + sx]);
                    cnt++;
                  }
                }
                if (cnt === 0) continue;
                let val = sum / cnt;
                if (p.gamma !== 1) val = Math.pow(val/255, p.gamma) * 255;
                // Op-Art moiré: add rotating sinusoidal bias based on block
                // index so alternating grids create a Riley-style illusion
                if (p.opArtMoire > 0) {
                  const mx = (scx + scy) * 0.22;
                  const my = (scx - scy) * 0.18;
                  val += (Math.sin(mx) + Math.cos(my)) * 40 * p.opArtMoire;
                }
                const isDark = p.invert ? val > thr : val < thr;
                if (isDark) {
                  const centerX = dotR, centerY = dotR;
                  for (let sy = 0; sy < ds && scy + sy < h; sy++) {
                    for (let sx = 0; sx < ds && scx + sx < w; sx++) {
                      let inside = false;
                      if (p.dotShape === 'round') {
                        const ddx = sx - centerX + 0.5, ddy = sy - centerY + 0.5;
                        inside = Math.sqrt(ddx * ddx + ddy * ddy) <= dotR;
                      } else if (p.dotShape === 'diamond') {
                        inside = Math.abs(sx - centerX + 0.5) + Math.abs(sy - centerY + 0.5) <= dotR;
                      } else {
                        inside = true;
                      }
                      if (inside) {
                        o[(scy + sy) * w + scx + sx] = p.invert ? 255 : 0;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return o;
  }});

  // ═══════════════════════════════════════════
  // IMPRESSIONISM — directional dabs + op-art illusion modes
  // ═══════════════════════════════════════════
  // Inspired by Monet/Van Gogh: short brush dabs aligned to the perpendicular
  // of the local image gradient, colored/shaded by local luminance. Supports
  // several "optical illusion" variants that bend the dab placement to
  // produce Riley-style op-art or subtle chromatic-aberration feel.
  A.push({ id:'impressionism', name:'Impressionism / Op-Art', category:'artistic', params:[
    // — Core (same defaults as legacy) —
    {id:'dabCount',label:'Dab Count',min:500,max:40000,step:100,default:4000},
    {id:'dabLen',label:'Dab Length',min:2,max:60,step:1,default:8},
    {id:'dabWidth',label:'Dab Width',min:1,max:16,step:1,default:2},
    {id:'flowStrength',label:'Gradient Alignment',min:0,max:1,step:.05,default:.85},
    {id:'lumModulation',label:'Luminance Modulation',min:0,max:2,step:.05,default:1},
    {id:'edgeBoost',label:'Edge Dab Density',min:0,max:2,step:.05,default:.8},
    // — Pixel-paint behavior (NEW defaults are crisp/dithered, like paint engine) —
    {id:'dabStyle',label:'Dab Style',type:'select',options:[
      {value:'pixel',label:'Pixel (sharp, dithered, samples source)'},
      {value:'blend',label:'Blend (smooth/legacy)'}
    ],default:'pixel'},
    {id:'coverageDensity',label:'Coverage Density',min:.1,max:1,step:.05,default:.85},
    {id:'sampleDrift',label:'Sample Drift',min:0,max:1,step:.05,default:.55},
    {id:'sampleJitter',label:'Sample Jitter (px)',min:0,max:12,step:.5,default:2},
    {id:'canvasStart',label:'Canvas',type:'select',options:[
      {value:'underpaint',label:'Painterly underpaint (mosaic of source tones)'},
      {value:'source',label:'From source (coherent color)'},
      {value:'clean',label:'From blank canvas (classic)'}
    ],default:'underpaint'},
    {id:'underpaintBlock',label:'Underpaint Block Size',min:4,max:40,step:1,default:14},
    {id:'underpaintPosterize',label:'Underpaint Posterize',min:2,max:32,step:1,default:12},
    // — Detail awareness (human-like placement) —
    {id:'detailAware',label:'Detail Awareness',min:0,max:2,step:.05,default:1},
    {id:'sizeByDetail',label:'Size by Detail',min:0,max:1.5,step:.05,default:.7},
    {id:'skipSmoothAreas',label:'Skip Smooth Areas',min:0,max:1,step:.05,default:.5},
    // — Wet paint (bleed/streak/smudge) —
    {id:'wetBleed',label:'Wet Bleed',min:0,max:1,step:.05,default:0},
    {id:'wetSmudge',label:'Wet Smudge',min:0,max:1,step:.05,default:0},
    {id:'wetStreak',label:'Wet Streak',min:0,max:1,step:.05,default:0},
    {id:'colorVariety',label:'Color Variety (multi-color stroke)',min:0,max:1,step:.05,default:.25},
    // — Intensity & adaptive —
    {id:'intensity',label:'Intensity',min:.3,max:3,step:.05,default:1},
    {id:'layers',label:'Layered Passes',min:1,max:4,step:1,default:1},
    {id:'adaptiveDensity',label:'Adaptive Density (detail)',min:0,max:2,step:.05,default:0},
    {id:'edgeBreak',label:'Edge Break (stop at edges)',min:0,max:1,step:.05,default:0},
    {id:'darkStrokeWeight',label:'Dark-First Weight',min:0,max:1,step:.05,default:0},
    {id:'opacityByLum',label:'Opacity by Luminance',min:0,max:1,step:.05,default:0},
    // — Per-dab jitter / impurities —
    {id:'sizeJitter',label:'Size Jitter',min:0,max:1,step:.05,default:0},
    {id:'lengthJitter',label:'Length Jitter',min:0,max:1,step:.05,default:0},
    {id:'angleJitter',label:'Angle Jitter',min:0,max:1,step:.05,default:0},
    {id:'scatter',label:'Position Scatter',min:0,max:30,step:.5,default:0},
    {id:'impurities',label:'Impurities (tone jitter)',min:0,max:1,step:.05,default:0},
    {id:'strokeCurve',label:'Stroke Curve',min:0,max:1,step:.05,default:0},
    // — Illusion modes (unchanged) —
    {id:'illusion',label:'Illusion Mode',type:'select',options:[
      {value:'none',label:'None'},
      {value:'riley',label:'Riley Moiré (wavy bands)'},
      {value:'radial',label:'Radial Starburst'},
      {value:'chromabber',label:'Chromatic Split'},
      {value:'spiral',label:'Spiral Twist'}
    ],default:'none'},
    {id:'illusionStrength',label:'Illusion Strength',min:0,max:1,step:.05,default:.5},
    // — Brush shape (optional PaintEngine mask) —
    {id:'brushShape',label:'Dab Shape',type:'select',options:[
      {value:'default',label:'Built-in soft ellipse'},
      {value:'0',label:'Round Soft'},
      {value:'1',label:'Round Hard'},
      {value:'2',label:'Flat'},
      {value:'3',label:'Splatter'},
      {value:'4',label:'Noise'},
      {value:'5',label:'Stipple'},
      {value:'6',label:'Rake'},
      {value:'7',label:'Dry Brush'},
      {value:'8',label:'Charcoal'},
      {value:'9',label:'Fan'}
    ],default:'default'},
    {id:'bgTone',label:'Background Tone',min:0,max:255,step:1,default:255},
    {id:'softness',label:'Dab Softness',min:0,max:1,step:.05,default:.4},
    {id:'seed',label:'Seed',min:1,max:999,step:1,default:42}
  ], apply(px,w,h,p) {
    const gen = this._gen(px, w, h, p);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  },
  async applyAsync(px, w, h, p, ctx) {
    const signal = (ctx && ctx.signal) || { cancelled: false };
    const onProgress = (ctx && ctx.onProgress) || null;
    const gen = this._gen(px, w, h, p);
    let r = gen.next();
    let lastProg = 0;
    while (!r.done) {
      if (signal.cancelled) { try { gen.return(); } catch(_){} return r.value || new Uint8ClampedArray(w*h); }
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (onProgress && r.value && now - lastProg > 60) {
        lastProg = now;
        onProgress(new Uint8ClampedArray(r.value));
      }
      await new Promise(res => setTimeout(res, 0));
      r = gen.next();
    }
    return r.value;
  },
  *_gen(px, w, h, p) {
    const o = new Uint8ClampedArray(w*h);
    const bgTone = (p.bgTone != null) ? p.bgTone : 255;
    const canvasStart = p.canvasStart || 'underpaint';
    const dabStyle = p.dabStyle || 'pixel';
    const underpaintBlock    = (p.underpaintBlock    != null) ? p.underpaintBlock|0    : 14;
    const underpaintPosterize= (p.underpaintPosterize!= null) ? p.underpaintPosterize|0: 12;
    const seedUnder          = (p.seed|0) || 42;
    function shUnder(a, b, k) {
      let h = Math.imul((a|0) + 374761393, 0x9E3779B1) ^
              Math.imul((b|0) + 2246822519, 0x85EBCA77) ^
              Math.imul((k|0) + 3266489917, 0xC2B2AE3D) ^ seedUnder;
      h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // Initial canvas:
    //   'underpaint' = posterized mosaic of source tones (painterly RECONSTRUCTION
    //                  — output reads as paint-built-up, not filter-overlayed)
    //   'source'     = raw source pixels (filter feel; coherent across channels)
    //   'clean'      = bgTone (classic canvas, paint revealed only where dabs land)
    if (dabStyle === 'pixel' && canvasStart === 'source') {
      for (let i = 0; i < w*h; i++) o[i] = clamp(px[i]);
    } else if (dabStyle === 'pixel' && canvasStart === 'underpaint') {
      const bsz = Math.max(3, underpaintBlock);
      const steps = Math.max(2, Math.min(32, underpaintPosterize));
      const blocksW = Math.ceil(w / bsz);
      const blocksH = Math.ceil(h / bsz);
      const blockVals = new Uint8ClampedArray(blocksW * blocksH);
      for (let by = 0; by < blocksH; by++) {
        for (let bx = 0; bx < blocksW; bx++) {
          let sum = 0, cnt = 0;
          for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
            const xs = Math.min(w-1, bx*bsz + Math.floor((sx+0.5)*bsz/2));
            const ys = Math.min(h-1, by*bsz + Math.floor((sy+0.5)*bsz/2));
            sum += clamp(px[ys*w+xs]); cnt++;
          }
          const avg = sum / cnt;
          const q = Math.round(avg / 255 * (steps-1)) / (steps-1) * 255;
          blockVals[by*blocksW+bx] = Math.max(0, Math.min(255, q | 0));
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const bx = (x / bsz) | 0, by = (y / bsz) | 0;
          const base = blockVals[by*blocksW + bx];
          const dither = (shUnder(x, y, 300) - 0.5) * 10;
          o[y*w+x] = Math.max(0, Math.min(255, (base + dither) | 0));
        }
      }
    } else {
      o.fill(bgTone);
    }

    // — Param normalization (defaults preserve legacy behavior) —
    const intensity        = (p.intensity        != null) ? p.intensity        : 1;
    const layers           = Math.max(1, (p.layers != null) ? p.layers|0 : 1);
    const adaptiveDensity  = (p.adaptiveDensity  != null) ? p.adaptiveDensity  : 0;
    const edgeBreak        = (p.edgeBreak        != null) ? p.edgeBreak        : 0;
    const darkStrokeWeight = (p.darkStrokeWeight != null) ? p.darkStrokeWeight : 0;
    const opacityByLum     = (p.opacityByLum     != null) ? p.opacityByLum     : 0;
    const sizeJitter       = (p.sizeJitter       != null) ? p.sizeJitter       : 0;
    const lengthJitter     = (p.lengthJitter     != null) ? p.lengthJitter     : 0;
    const angleJitter      = (p.angleJitter      != null) ? p.angleJitter      : 0;
    const scatter          = (p.scatter          != null) ? p.scatter          : 0;
    const impurities       = (p.impurities       != null) ? p.impurities       : 0;
    const strokeCurve      = (p.strokeCurve      != null) ? p.strokeCurve      : 0;
    const coverageDensity  = (p.coverageDensity  != null) ? p.coverageDensity  : 0.85;
    const sampleDrift      = (p.sampleDrift      != null) ? p.sampleDrift      : 0.55;
    const sampleJitter     = (p.sampleJitter     != null) ? p.sampleJitter     : 2;
    const detailAware      = (p.detailAware      != null) ? p.detailAware      : 1;
    const sizeByDetail     = (p.sizeByDetail     != null) ? p.sizeByDetail     : 0.7;
    const skipSmoothAreas  = (p.skipSmoothAreas  != null) ? p.skipSmoothAreas  : 0.5;
    const wetBleed         = (p.wetBleed         != null) ? p.wetBleed         : 0;
    const wetSmudge        = (p.wetSmudge        != null) ? p.wetSmudge        : 0;
    const wetStreak        = (p.wetStreak        != null) ? p.wetStreak        : 0;
    const colorVariety     = (p.colorVariety     != null) ? p.colorVariety     : 0.25;
    const brushShape       = p.brushShape || 'default';
    const seedI            = (p.seed|0) || 42;

    // Spatial hash → [0,1). Deterministic per (a,b,k); identical across RGB
    // channels in color mode so dabs sample coherent source colors (real
    // multi-color per dab — like the paint engine).
    function sh(a, b, k) {
      let h = Math.imul((a|0) + 374761393, 0x9E3779B1) ^
              Math.imul((b|0) + 2246822519, 0x85EBCA77) ^
              Math.imul((k|0) + 3266489917, 0xC2B2AE3D) ^ seedI;
      h = Math.imul(h ^ (h >>> 15), 0x85EBCA77);
      h = Math.imul(h ^ (h >>> 13), 0xC2B2AE3D);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // Brush mask (optional, from PaintEngine)
    let bMask = null, bSize = 0;
    if (brushShape !== 'default' && typeof PaintEngine !== 'undefined' && PaintEngine.getBrushMask) {
      const bi = parseInt(brushShape, 10);
      if (!isNaN(bi)) {
        const b = PaintEngine.getBrushMask(bi);
        if (b) { bMask = b.mask; bSize = b.size; }
      }
    }

    // Legacy blend path kept for the 'blend' dab style.
    if (dabStyle === 'blend') {
      return _impressionismBlend(px, w, h, p, { bMask, bSize });
    }

    // PIXEL mode — hard writes of sampled source pixels, dithered coverage.
    const cx0 = w / 2, cy0 = h / 2;
    const maxR = Math.sqrt(cx0 * cx0 + cy0 * cy0);
    let totalDabs = Math.round(p.dabCount * intensity) * layers;

    // Precompute edge field + detail field once (huge speedup vs per-pixel
    // sobelAt in the inner loops). Also used to drive detail-aware sizing.
    const sf = sobelField(px, w, h);
    const edgeMag = sf.mag, edgeAng = sf.ang;
    const needDetail = detailAware > 0 || sizeByDetail > 0 || skipSmoothAreas > 0;
    const detail = needDetail ? detailField(px, w, h, 8) : null;

    // When detail-awareness is active, reduce total dabs (a human would
    // not paint 4000 strokes in a flat sky; we redistribute them).
    if (detailAware > 0) {
      totalDabs = Math.round(totalDabs * (1 - detailAware * 0.15));
    }

    // Chunk cadence for cooperative yielding — yield every N dabs so
    // applyAsync can paint progress + respond to cancellation. Sync drain
    // ignores these yields, so zero perf cost in the sync path.
    const DAB_CHUNK = 500;

    for (let i = 0; i < totalDabs; i++) {
      if (i > 0 && (i % DAB_CHUNK) === 0) yield o;
      // Dab origin — position-hash so channels agree on locations.
      let x = Math.floor(sh(i, 0, 100) * w);
      let y = Math.floor(sh(i, 0, 101) * h);

      // — Detail-aware placement: skip low-detail candidates more aggressively
      //   (a human doesn't waste 50 strokes on a smooth sky — a few large
      //   painterly dabs are enough).
      let localDetail = 0;  // 0..1, roughly
      if (detail) {
        localDetail = Math.min(1, detail[y * w + x] / 40);
        if (skipSmoothAreas > 0) {
          // Keep ALL detail strokes, skip up to ~80% of smooth-area strokes.
          const keepProb = localDetail + (1 - skipSmoothAreas * 0.8);
          if (sh(i, 0, 120) > Math.min(1, keepProb)) continue;
        }
      }

      // Edge-boost / adaptive-density acceptance (uses precomputed fields)
      if (p.edgeBoost > 0 || adaptiveDensity > 0) {
        const ci = Math.min(h-2, Math.max(1, y)) * w + Math.min(w-2, Math.max(1, x));
        const mag0 = edgeMag[ci];
        let accept = 0.4 + Math.min(1, mag0 / 120) * p.edgeBoost * 0.6;
        if (adaptiveDensity > 0 && detail) {
          accept += Math.min(1, (detail[y*w+x] / 50) * 2) * adaptiveDensity * 0.8;
        }
        if (sh(i, 0, 102) > accept) continue;
      }

      // Position scatter
      if (scatter > 0) {
        x += Math.round((sh(i, 0, 103) - 0.5) * scatter * 2);
        y += Math.round((sh(i, 0, 104) - 0.5) * scatter * 2);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
      }

      const srcVal = clamp(px[y * w + x]);
      const lumN = srcVal / 255;
      // Dark-first weighting: probabilistically skip light areas
      if (darkStrokeWeight > 0 && sh(i, 0, 105) < lumN * darkStrokeWeight) continue;

      // Base stroke direction (perpendicular to gradient) — precomputed
      const cIdx = Math.min(h-2, Math.max(1, y)) * w + Math.min(w-2, Math.max(1, x));
      const eMag = edgeMag[cIdx], eAng = edgeAng[cIdx];
      let dirAng = eMag > 5 ? eAng + Math.PI / 2 : sh(i, 0, 106) * Math.PI * 2;
      dirAng = dirAng * p.flowStrength + (sh(i, 0, 107) * Math.PI * 2) * (1 - p.flowStrength);
      if (angleJitter > 0) dirAng += (sh(i, 0, 108) - 0.5) * angleJitter * Math.PI;

      // Illusion modulation (unchanged)
      let ox = 0, oy = 0;
      const dx0 = x - cx0, dy0 = y - cy0;
      const rN = Math.sqrt(dx0*dx0 + dy0*dy0) / maxR;
      const phi = Math.atan2(dy0, dx0);
      if (p.illusion === 'riley') dirAng += Math.sin(y * 0.05) * p.illusionStrength * 1.2;
      else if (p.illusion === 'radial') dirAng = phi * (1 - p.illusionStrength) + dirAng * (1 - p.illusionStrength) * 0.5 + phi * p.illusionStrength;
      else if (p.illusion === 'chromabber') { const ofs = rN * p.illusionStrength * 6; ox = Math.cos(phi)*ofs; oy = Math.sin(phi)*ofs; }
      else if (p.illusion === 'spiral') dirAng += (phi + rN * Math.PI * 2 * p.illusionStrength);

      // Detail-aware sizing: smooth regions → big painterly dabs,
      // detail regions → small precise dabs. sizeByDetail controls strength.
      // (Classic impressionist behavior: broad sky strokes, tight feature strokes.)
      let detailSizeMul = 1;
      if (detail && sizeByDetail > 0) {
        // smoothFactor: 0 where lots of detail, 1 where smooth
        const smoothFactor = 1 - localDetail;
        detailSizeMul = 1 + smoothFactor * sizeByDetail * 3.0; // up to 4x in skies
      }

      // Dab size + length modulation
      const lenMul = 1 + (1 - srcVal/255) * p.lumModulation * 0.4;
      let len = p.dabLen * lenMul * detailSizeMul;
      if (lengthJitter > 0) len *= (1 + (sh(i, 0, 109) - 0.5) * lengthJitter * 1.5);
      let width = p.dabWidth * detailSizeMul;
      if (sizeJitter > 0) width *= (1 + (sh(i, 0, 110) - 0.5) * sizeJitter * 1.5);
      width = Math.max(0.5, width);
      len   = Math.max(1, len);

      const opacMul = 1 + (1 - lumN) * opacityByLum;
      const curveAmp = strokeCurve * len * 0.15;

      // Impurities: shift sample origin for this dab (dirty paint)
      const impX = impurities > 0 ? (sh(i, 0, 111) - 0.5) * impurities * 10 : 0;
      const impY = impurities > 0 ? (sh(i, 0, 112) - 0.5) * impurities * 10 : 0;

      // — Wet-paint per-dab offsets —
      // STREAK extends the stroke beyond its "real" length with decaying
      // coverage and sample-drift. The stroke looks like it was pulled with
      // a loaded brush — long tail of diminishing color.
      const streakLen = wetStreak > 0 ? len * (0.5 + wetStreak * 1.5) : 0;
      // SMUDGE drags the sample origin ALONG the stroke direction for every
      // stamp — colors from earlier in the stroke bleed forward, like when
      // your brush hasn't fully released the pigment from the start-point.
      const smudgeDrag = wetSmudge * len * 0.6;
      // COLOR VARIETY: this stroke's "fiber bundle" — an additional
      // per-pixel sample offset that lets a single stroke reveal multiple
      // source colors. Hashed per-dab and per-pixel for a painterly mix.
      const varietyRadius = colorVariety * (Math.max(width, len) * 0.35);

      const cosA = Math.cos(dirAng), sinA = Math.sin(dirAng);
      const halfLen = Math.max(len, streakLen) / 2, halfW = width / 2;
      const bboxR = Math.ceil(Math.max(halfLen, halfW)) + 1;

      // Main rasterize loop — use `stamp()` helper for both brush-mask and
      // built-in ellipse paths. Unified so wet-paint effects apply uniformly.
      const useMask = (bMask && bSize > 0);
      const halfLenReal = len / 2;
      for (let ty = -bboxR; ty <= bboxR; ty++) for (let tx = -bboxR; tx <= bboxR; tx++) {
        const lx = tx * cosA + ty * sinA;    // along stroke
        const ly = -tx * sinA + ty * cosA;   // perpendicular
        const dn = lx / halfLenReal;
        const dw = ly / halfW;

        // Coverage profile — maskV or soft ellipse. For streak extension,
        // coverage fades from the end of the real dab out along +stroke.
        let maskV;
        if (useMask) {
          // Brush mask — allow extension beyond real length via streak tail
          if (dn < -1 || dn > 1 + streakLen/len || Math.abs(dw) > 1) continue;
          // Map dn∈[-1,1] to mask x; dn>1 falls into streak tail
          const inDab = (dn >= -1 && dn <= 1);
          const mx = inDab ? Math.round((dn + 1) * 0.5 * (bSize - 1))
                           : (bSize - 1);
          const my = Math.round((dw + 1) * 0.5 * (bSize - 1));
          if (mx < 0 || mx >= bSize || my < 0 || my >= bSize) continue;
          maskV = bMask[my * bSize + mx];
          if (!inDab) {
            // Streak falloff — exponentially decaying tail beyond dab
            const streakT = (dn - 1) / Math.max(1e-6, streakLen / len);
            maskV *= Math.max(0, 1 - streakT);
          }
          if (maskV < 0.01) continue;
        } else {
          const dnA = Math.abs(dn), dwA = Math.abs(dw);
          const r2 = dnA*dnA + dwA*dwA;
          if (r2 > 1) {
            // Streak extension: only allowed forward along stroke
            if (streakLen <= 0 || dn <= 1 || Math.abs(dw) > 1) continue;
            const streakT = (dn - 1) / Math.max(1e-6, streakLen / len);
            if (streakT > 1) continue;
            maskV = (1 - streakT) * (1 - Math.abs(dw)) * 0.7;
            if (maskV < 0.01) continue;
          } else {
            maskV = p.softness > 0 ? (1 - Math.pow(r2, 0.5 + p.softness * 2)) : 1;
          }
        }

        let pxx = x + tx + ox;
        let pyy = y + ty + oy;
        if (curveAmp > 0) {
          const sn = dn;
          pxx += Math.sin(sn * Math.PI) * curveAmp * (-sinA);
          pyy += Math.sin(sn * Math.PI) * curveAmp * cosA;
        }
        pxx = Math.round(pxx); pyy = Math.round(pyy);
        if (pxx < 0 || pxx >= w || pyy < 0 || pyy >= h) continue;

        if (edgeBreak > 0) {
          const e2mag = edgeMag[pyy * w + pxx];
          if (sh(pxx, pyy, 30) < Math.min(1, e2mag / 120) * edgeBreak) continue;
        }

        // Dithered coverage threshold
        const prob = Math.min(1, maskV * opacMul * coverageDensity);
        if (sh(pxx, pyy, 31 + (i & 7)) > prob) continue;

        // — Sample origin: drift from dab center towards pixel, plus impurities
        //   and smudge drag along stroke direction.
        let sOx = x + (pxx - x) * sampleDrift + impX;
        let sOy = y + (pyy - y) * sampleDrift + impY;
        if (wetSmudge > 0) {
          // "Drag" the sample back along stroke direction by dn∈[-1..streakT]
          // — pixels at the end of the stroke reveal colors from the start.
          const dragT = Math.max(0, dn + 1) * 0.5;  // 0 at start, 1 at end
          sOx -= cosA * smudgeDrag * dragT;
          sOy -= sinA * smudgeDrag * dragT;
        }

        // Jitter + color variety (fiber-style multi-color within a stroke)
        const jx = sampleJitter > 0 ? (sh(pxx, pyy, 40) - 0.5) * sampleJitter * 2 : 0;
        const jy = sampleJitter > 0 ? (sh(pxx, pyy, 41) - 0.5) * sampleJitter * 2 : 0;
        const vx = varietyRadius > 0 ? (sh(pxx, pyy, 50 + (i & 3)) - 0.5) * varietyRadius * 2 : 0;
        const vy = varietyRadius > 0 ? (sh(pxx, pyy, 51 + (i & 3)) - 0.5) * varietyRadius * 2 : 0;

        const sXi = Math.max(0, Math.min(w-1, Math.round(sOx + jx + vx)));
        const sYi = Math.max(0, Math.min(h-1, Math.round(sOy + jy + vy)));
        // HARD write — no blending.
        o[pyy * w + pxx] = clamp(px[sYi * w + sXi]);
      }
    }

    // — Post-pass: WET BLEED (capillary spread) —
    //   Dithered pixel-swap with neighbors, so wet color creeps outward
    //   without blurring — same "crisp bleed" approach as the paint engine's
    //   wetLayer evolution. Seeded by position so it's deterministic &
    //   coherent across RGB channels.
    if (wetBleed > 0) {
      const bleedRadius = Math.max(1, Math.round(wetBleed * 3));
      const bleedProb = wetBleed * 0.45;
      const tmp = new Uint8ClampedArray(o);
      for (let y = 1; y < h - 1; y++) {
        const yr = y * w;
        for (let x = 1; x < w - 1; x++) {
          if (sh(x, y, 200) > bleedProb) continue;
          // Pick a neighbor to copy from (dithered random direction)
          const dx = Math.round((sh(x, y, 201) - 0.5) * 2 * bleedRadius);
          const dy = Math.round((sh(x, y, 202) - 0.5) * 2 * bleedRadius);
          const nx = Math.max(0, Math.min(w-1, x + dx));
          const ny = Math.max(0, Math.min(h-1, y + dy));
          o[yr + x] = tmp[ny * w + nx];
        }
      }
    }

    return o;
  }});

  // Legacy alpha-blend implementation kept for the 'blend' dab style.
  function _impressionismBlend(px, w, h, p, ctx) {
    const { bMask, bSize } = ctx;
    const o = new Uint8ClampedArray(w*h);
    o.fill((p.bgTone != null) ? p.bgTone : 255);
    const rnd = mkRand(p.seed);
    const cx0 = w / 2, cy0 = h / 2;
    const maxR = Math.sqrt(cx0 * cx0 + cy0 * cy0);

    const intensity        = (p.intensity        != null) ? p.intensity        : 1;
    const layers           = Math.max(1, (p.layers != null) ? p.layers|0 : 1);
    const adaptiveDensity  = (p.adaptiveDensity  != null) ? p.adaptiveDensity  : 0;
    const edgeBreak        = (p.edgeBreak        != null) ? p.edgeBreak        : 0;
    const darkStrokeWeight = (p.darkStrokeWeight != null) ? p.darkStrokeWeight : 0;
    const opacityByLum     = (p.opacityByLum     != null) ? p.opacityByLum     : 0;
    const sizeJitter       = (p.sizeJitter       != null) ? p.sizeJitter       : 0;
    const lengthJitter     = (p.lengthJitter     != null) ? p.lengthJitter     : 0;
    const angleJitter      = (p.angleJitter      != null) ? p.angleJitter      : 0;
    const scatter          = (p.scatter          != null) ? p.scatter          : 0;
    const impurities       = (p.impurities       != null) ? p.impurities       : 0;
    const strokeCurve      = (p.strokeCurve      != null) ? p.strokeCurve      : 0;

    const totalDabs = Math.round(p.dabCount * intensity) * layers;

    function trySample() {
      const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h);
      if (p.edgeBoost > 0 || adaptiveDensity > 0) {
        const e = sobelAt(px, Math.min(w-2, Math.max(1, x)), Math.min(h-2, Math.max(1, y)), w, h);
        let accept = 0.4 + Math.min(1, e.mag / 120) * p.edgeBoost * 0.6;
        if (adaptiveDensity > 0) {
          let sum = 0, sumSq = 0, n = 0;
          for (let dyy = -3; dyy <= 3; dyy += 3) for (let dxx = -3; dxx <= 3; dxx += 3) {
            const nx = x + dxx, ny = y + dyy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const v = px[ny*w+nx]; sum += v; sumSq += v*v; n++;
            }
          }
          if (n > 0) {
            const mean = sum / n;
            const varc = Math.max(0, sumSq / n - mean*mean);
            accept += Math.min(1, varc / 2500) * adaptiveDensity * 0.8;
          }
        }
        if (rnd() > accept) return null;
      }
      return [x, y];
    }

    for (let i = 0; i < totalDabs; i++) {
      const s = trySample();
      if (!s) continue;
      let [x, y] = s;

      if (scatter > 0) {
        x += Math.round((rnd() - 0.5) * scatter * 2);
        y += Math.round((rnd() - 0.5) * scatter * 2);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
      }

      const srcVal = clamp(px[y * w + x]);
      const ink = 255 - srcVal;
      const lumN = srcVal / 255;
      if (ink < 8 && p.lumModulation > 0.5) continue;
      if (darkStrokeWeight > 0 && rnd() < lumN * darkStrokeWeight) continue;

      const e = sobelAt(px, Math.min(w-2, Math.max(1, x)), Math.min(h-2, Math.max(1, y)), w, h);
      let dirAng = e.mag > 5 ? e.ang + Math.PI / 2 : rnd() * Math.PI * 2;
      dirAng = dirAng * p.flowStrength + (rnd() * Math.PI * 2) * (1 - p.flowStrength);
      if (angleJitter > 0) dirAng += (rnd() - 0.5) * angleJitter * Math.PI;

      let ox = 0, oy = 0;
      const dx0 = x - cx0, dy0 = y - cy0;
      const rN = Math.sqrt(dx0*dx0 + dy0*dy0) / maxR;
      const phi = Math.atan2(dy0, dx0);
      if (p.illusion === 'riley') dirAng += Math.sin(y * 0.05) * p.illusionStrength * 1.2;
      else if (p.illusion === 'radial') dirAng = phi * (1 - p.illusionStrength) + dirAng * (1 - p.illusionStrength) * 0.5 + phi * p.illusionStrength;
      else if (p.illusion === 'chromabber') { const ofs = rN * p.illusionStrength * 6; ox = Math.cos(phi)*ofs; oy = Math.sin(phi)*ofs; }
      else if (p.illusion === 'spiral') dirAng += (phi + rN * Math.PI * 2 * p.illusionStrength);

      const lenMul = 1 + (1 - srcVal/255) * p.lumModulation * 0.4;
      let len = p.dabLen * lenMul;
      if (lengthJitter > 0) len *= (1 + (rnd() - 0.5) * lengthJitter * 1.5);
      let width = p.dabWidth;
      if (sizeJitter > 0) width *= (1 + (rnd() - 0.5) * sizeJitter * 1.5);
      width = Math.max(0.5, width);
      len   = Math.max(1, len);

      const inkJit = impurities > 0 ? clamp(ink + (rnd() - 0.5) * 128 * impurities) : ink;
      const opacMul = 1 + (1 - lumN) * opacityByLum;
      const curveAmp = strokeCurve * len * 0.15;

      const cosA = Math.cos(dirAng), sinA = Math.sin(dirAng);
      const halfLen = len / 2, halfW = width / 2;
      const bboxR = Math.ceil(Math.max(halfLen, halfW)) + 1;

      if (bMask && bSize > 0) {
        for (let ty = -bboxR; ty <= bboxR; ty++) for (let tx = -bboxR; tx <= bboxR; tx++) {
          const lx = tx * cosA + ty * sinA;
          const ly = -tx * sinA + ty * cosA;
          const dn = lx / halfLen, dw = ly / halfW;
          if (dn*dn + dw*dw > 1) continue;
          const mx = Math.round((dn + 1) * 0.5 * (bSize - 1));
          const my = Math.round((dw + 1) * 0.5 * (bSize - 1));
          if (mx < 0 || mx >= bSize || my < 0 || my >= bSize) continue;
          const maskV = bMask[my * bSize + mx];
          if (maskV < 0.01) continue;
          let px_x = x + tx + ox;
          let px_y = y + ty + oy;
          if (curveAmp > 0) {
            const sn = dn;
            px_x += Math.sin(sn * Math.PI) * curveAmp * (-sinA);
            px_y += Math.sin(sn * Math.PI) * curveAmp * cosA;
          }
          px_x = Math.round(px_x); px_y = Math.round(px_y);
          if (px_x < 0 || px_x >= w || px_y < 0 || px_y >= h) continue;
          if (edgeBreak > 0) {
            const e2 = sobelAt(px, Math.min(w-2, Math.max(1, px_x)), Math.min(h-2, Math.max(1, px_y)), w, h);
            if (rnd() < Math.min(1, e2.mag / 120) * edgeBreak) continue;
          }
          const idx = px_y * w + px_x;
          const blend = Math.min(1, maskV * (0.4 + Math.min(1, inkJit/128) * 0.6) * opacMul);
          o[idx] = Math.round(o[idx] * (1 - blend) + (255 - inkJit) * blend);
        }
      } else {
        for (let ty = -bboxR; ty <= bboxR; ty++) for (let tx = -bboxR; tx <= bboxR; tx++) {
          const lx = tx * cosA + ty * sinA;
          const ly = -tx * sinA + ty * cosA;
          const dn = Math.abs(lx) / halfLen, dw = Math.abs(ly) / halfW;
          const r2 = dn*dn + dw*dw;
          if (r2 > 1) continue;
          const soft = p.softness > 0 ? (1 - Math.pow(r2, 0.5 + p.softness * 2)) : 1;
          let px_x = x + tx + ox;
          let px_y = y + ty + oy;
          if (curveAmp > 0) {
            const sn = lx / halfLen;
            px_x += Math.sin(sn * Math.PI) * curveAmp * (-sinA);
            px_y += Math.sin(sn * Math.PI) * curveAmp * cosA;
          }
          px_x = Math.round(px_x); px_y = Math.round(px_y);
          if (px_x < 0 || px_x >= w || px_y < 0 || px_y >= h) continue;
          if (edgeBreak > 0) {
            const e2 = sobelAt(px, Math.min(w-2, Math.max(1, px_x)), Math.min(h-2, Math.max(1, px_y)), w, h);
            if (rnd() < Math.min(1, e2.mag / 120) * edgeBreak) continue;
          }
          const idx = px_y * w + px_x;
          const blend = Math.min(1, soft * (0.4 + Math.min(1, inkJit/128) * 0.6) * opacMul);
          o[idx] = Math.round(o[idx] * (1 - blend) + (255 - inkJit) * blend);
        }
      }
    }
    return o;
  }

  return A;
})();
