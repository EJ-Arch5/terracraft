/* --- Config --- */
const TILE = 32;               // tile size in pixels
const CHUNK_W = 32;            // tiles per chunk (width)
const CHUNK_H = 64;            // tiles per chunk (height)
const RENDER_RADIUS = 3;       // chunks around player to render
const GRAVITY = 20;            // pixels/s^2
const MOVE_SPEED = 220;        // pixels/s
const JUMP_VELOCITY = -360;    // pixels/s
const MAX_WORLD_HEIGHT = CHUNK_H * TILE;

/* --- State --- */
let canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');
let w, h;
let timePrev = performance.now();
let keys = new Set();
let mouse = {x:0, y:0, left:false, right:false};
let selectedBlock = 1; // 1: dirt, 2: stone, 3: wood
let seed = (Math.random()*1e9|0);
document.getElementById('seed').textContent = 'Seed: ' + seed;

const player = { x: 0, y: -TILE*8, vx: 0, vy: 0, onGround: false, w: 22, h: 30 };

const noise = makeNoise(seed);
const chunks = new Map(); // key "cx,cy" -> 2D tile array

/* --- Blocks --- */
const AIR=0, DIRT=1, STONE=2, WOOD=3, GRASS=4;
const COLORS = {
  [AIR]: null,
  [DIRT]: '#8b5a2b',
  [STONE]: '#6c7a89',
  [WOOD]: '#7b4b2a',
  [GRASS]: '#4caf50'
};

/* --- Setup --- */
resize();
window.addEventListener('resize', resize);
window.addEventListener('keydown', e => {
  keys.add(e.key.toLowerCase());
  if (e.key === '1') selectSlot(1);
  if (e.key === '2') selectSlot(2);
  if (e.key === '3') selectSlot(3);
  if (e.key.toLowerCase() === 'r') regenerate();
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
});
canvas.addEventListener('mouseup', e => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('regen').addEventListener('click', regenerate);
document.querySelectorAll('#inv .slot').forEach(el=>{
  el.addEventListener('click', ()=> selectSlot(parseInt(el.dataset.id)));
});
selectSlot(1);

/* --- Game loop --- */
requestAnimationFrame(loop);
function loop(t){
  const dt = Math.min(0.033, (t - timePrev) / 1000);
  timePrev = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

/* --- World generation --- */
function getChunk(cx, cy){
  const key = cx + ',' + cy;
  if (chunks.has(key)) return chunks.get(key);
  const tiles = Array.from({length: CHUNK_H}, ()=> new Array(CHUNK_W).fill(AIR));
  const baseX = cx * CHUNK_W;
  // Terrain via 1D height map using noise
  for (let x=0; x<CHUNK_W; x++){
    const wx = baseX + x;
    const height = Math.floor(20 + 8*fbm(wx*0.03));
    for (let y=0; y<CHUNK_H; y++){
      if (y < height) tiles[y][x] = AIR;
      else if (y === height) tiles[y][x] = GRASS;
      else {
        const depth = y - height;
        tiles[y][x] = depth < 3 ? DIRT : STONE;
      }
    }
    // Sprinkle trees
    if (Math.random() < 0.04){
      const top = Math.floor(20 + 8*fbm(wx*0.03));
      if (top+1 < CHUNK_H-5){
        for (let t=1; t<=4; t++) tiles[top+t][x] = WOOD;
      }
    }
  }
  chunks.set(key, tiles);
  return tiles;
}

/* --- Utilities --- */
function worldToChunkTile(wx, wy){
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  const cx = Math.floor(tx / CHUNK_W);
  const cy = Math.floor(ty / CHUNK_H);
  const lx = ((tx % CHUNK_W)+CHUNK_W)%CHUNK_W;
  const ly = ((ty % CHUNK_H)+CHUNK_H)%CHUNK_H;
  return {cx, cy, lx, ly};
}
function getTile(wx, wy){
  const {cx, cy, lx, ly} = worldToChunkTile(wx, wy);
  const chunk = getChunk(cx, cy);
  if (!chunk) return AIR;
  return chunk[ly]?.[lx] ?? AIR;
}
function setTile(wx, wy, v){
  const {cx, cy, lx, ly} = worldToChunkTile(wx, wy);
  const chunk = getChunk(cx, cy);
  if (!chunk) return;
  if (ly>=0 && ly<CHUNK_H && lx>=0 && lx<CHUNK_W) chunk[ly][lx] = v;
}

/* --- Player update --- */
function update(dt){
  // Input
  player.vx = 0;
  if (keys.has('a')) player.vx -= MOVE_SPEED;
  if (keys.has('d')) player.vx += MOVE_SPEED;
  if (keys.has('w') && player.onGround) { player.vy = JUMP_VELOCITY; player.onGround=false; }

  // Gravity
  player.vy += GRAVITY;

  // Horizontal move + collision
  let nx = player.x + player.vx * dt;
  if (collides(nx, player.y)) {
    nx = stepAxis(player.x, player.y, player.vx*dt, true);
  }
  player.x = nx;

  // Vertical move + collision
  let ny = player.y + player.vy * dt;
  if (collides(player.x, ny)) {
    const oldVy = player.vy;
    ny = stepAxis(player.x, player.y, player.vy*dt, false);
    player.vy = 0;
    player.onGround = oldVy > 0;
  } else {
    player.onGround = false;
  }
  player.y = Math.min(player.y, MAX_WORLD_HEIGHT - TILE*2);

  // Mining / Placing
  const camera = getCamera();
  const mxWorld = camera.x + mouse.x;
  const myWorld = camera.y + mouse.y;
  const tx = Math.floor(mxWorld / TILE)*TILE;
  const ty = Math.floor(myWorld / TILE)*TILE;

  if (mouse.left) {
    const v = getTile(tx+1, ty+1);
    if (v !== AIR) setTile(tx+1, ty+1, AIR);
  }
  if (mouse.right) {
    const v = getTile(tx+1, ty+1);
    if (v === AIR) setTile(tx+1, ty+1, selectedBlock);
  }
}

function collides(wx, wy){
  const halfW = player.w/2, halfH = player.h/2;
  const pts = [
    [wx-halfW, wy-halfH],
    [wx+halfW, wy-halfH],
    [wx-halfW, wy+halfH],
    [wx+halfW, wy+halfH],
  ];
  for (const [px, py] of pts){
    if (solid(getTile(px, py))) return true;
  }
  return false;
}
function solid(v){ return v !== AIR; }
function stepAxis(x, y, delta, horizontal){
  const steps = Math.abs(Math.floor(delta));
  const sign = Math.sign(delta);
  let nx = x, ny = y;
  for (let i=0; i<steps; i++){
    if (horizontal) nx += sign; else ny += sign;
    if (collides(nx, ny)) return horizontal ? nx - sign : ny - sign;
  }
  return horizontal ? x + delta : y + delta;
}

/* --- Render --- */
function render(){
  const camera = getCamera();
  ctx.clearRect(0,0,w,h);

  // Sky gradient
  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0, '#0f1220'); g.addColorStop(1, '#1b2140');
  ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

  // Render chunks around player
  const pcx = Math.floor((player.x)/TILE/CHUNK_W);
  const pcy = Math.floor((player.y)/TILE/CHUNK_H);
  for (let cy=pcy-RENDER_RADIUS; cy<=pcy+RENDER_RADIUS; cy++){
    for (let cx=pcx-RENDER_RADIUS; cx<=pcx+RENDER_RADIUS; cx++){
      const chunk = getChunk(cx, cy);
      const baseX = cx*CHUNK_W*TILE - camera.x;
      const baseY = cy*CHUNK_H*TILE - camera.y;
      for (let y=0; y<CHUNK_H; y++){
        for (let x=0; x<CHUNK_W; x++){
          const v = chunk[y][x];
          if (v === AIR) continue;
          ctx.fillStyle = COLORS[v];
          ctx.fillRect(baseX + x*TILE, baseY + y*TILE, TILE, TILE);
          if (v === GRASS){
            ctx.fillStyle = '#3c9e44';
            ctx.fillRect(baseX + x*TILE, baseY + y*TILE, TILE, 6);
          }
        }
      }
    }
  }

  // Player
  const px = player.x - camera.x, py = player.y - camera.y;
  ctx.fillStyle = '#4fd1c5';
  ctx.fillRect(px - player.w/2, py - player.h/2, player.w, player.h);

  // Cursor tile highlight
  const mxWorld = camera.x + mouse.x;
  const myWorld = camera.y + mouse.y;
  const tx = Math.floor(mxWorld / TILE) * TILE - camera.x;
  const ty = Math.floor(myWorld / TILE) * TILE - camera.y;
  ctx.strokeStyle = '#7aa2f7';
  ctx.lineWidth = 2;
  ctx.strokeRect(tx, ty, TILE, TILE);
}

function getCamera(){
  const marginX = w*0.5, marginY = h*0.45;
  let cx = player.x - marginX;
  let cy = Math.max(0, player.y - marginY);
  return {x: cx, y: cy};
}

/* --- Noise / FBM --- */
function makeNoise(seed){
  const s = seed >>> 0;
  function rand(n){
    n = (n ^ (n << 13)) >>> 0;
    n = (n ^ (n >> 17)) >>> 0;
    n = (n ^ (n << 5)) >>> 0;
    return (n >>> 0) / 0xffffffff;
  }
  function value1D(x){
    const x0 = Math.floor(x), x1 = x0 + 1;
    const t = x - x0;
    const u = t*t*(3 - 2*t);
    const a = rand(x0 ^ s), b = rand(x1 ^ s);
    return a*(1-u) + b*u;
  }
  return { value1D };
}
function fbm(x){
  let amp = 1, freq = 1, sum = 0;
  for (let o=0; o<4; o++){
    sum += noise.value1D(x * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return sum*2 - 1;
}

/* --- UI helpers --- */
function selectSlot(id){
  selectedBlock = id;
  document.querySelectorAll('#inv .slot').forEach(el=>{
    el.classList.toggle('active', parseInt(el.dataset.id) === id);
  });
}
function regenerate(){
  seed = (Math.random()*1e9|0);
  document.getElementById('seed').textContent = 'Seed: ' + seed;
  chunks.clear();
  const n = makeNoise(seed);
  noise.value1D = n.value1D;
}

/* --- Resize --- */
function resize(){
  w = window.innerWidth; h = window.innerHeight - 48;
  canvas.width = w; canvas.height = h;
}
}
