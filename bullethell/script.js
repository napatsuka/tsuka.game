/* Simple bullet-hell game
 - Title screen with Start
 - Player moves by mouse drag or touch (swipe/drag)
 - Bullets spawn in patterns; difficulty increases every 10s
 - Collision = game over
*/

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start-btn');
const titleScreen = document.getElementById('title-screen');
const gameOverScreen = document.getElementById('game-over');
const restartBtn = document.getElementById('restart-btn');
const backTitleBtn = document.getElementById('back-title-btn');
const timeEl = document.getElementById('time');
const levelEl = document.getElementById('level');
const finalTime = document.getElementById('final-time');
const bestTimeEl = document.getElementById('best-time');
const bestNote = document.getElementById('best-note');

// Debug helper (set DEBUG = true in console to enable verbose logs)
let DEBUG = false;
const debugPanel = document.createElement('div'); debugPanel.style.position = 'fixed'; debugPanel.style.right = '12px'; debugPanel.style.bottom = '12px'; debugPanel.style.background = 'rgba(0,0,0,0.6)'; debugPanel.style.color = '#ffd36b'; debugPanel.style.padding = '8px 10px'; debugPanel.style.borderRadius = '8px'; debugPanel.style.fontSize = '12px'; debugPanel.style.fontFamily = 'monospace'; debugPanel.style.zIndex = 9999; debugPanel.style.pointerEvents = 'none'; debugPanel.style.display = 'none'; debugPanel.textContent = 'debug'; document.body.appendChild(debugPanel);


// localStorage best time
const STORAGE_KEY = 'bh_best_time';
let bestTime = parseFloat(localStorage.getItem(STORAGE_KEY)) || 0;
function updateBestDisplay(){ if(bestTimeEl) bestTimeEl.textContent = bestTime>0 ? bestTime.toFixed(1)+'s' : '--'; }

// Simple SoundManager (WebAudio)
const SoundManager = {
  ctx: null,
  init(){ if(this.ctx) return; try{ this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ this.ctx = null; } },
  play(freq=440, type='sine', time=0.05, gain=0.08){ if(!this.ctx) return; const o = this.ctx.createOscillator(); const g = this.ctx.createGain(); o.type = type; o.frequency.value = freq; g.gain.value = gain; o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + time); },
  playExplosion(){ this.play(120, 'sawtooth', 0.18, 0.12); },
  playHit(){ this.play(800, 'square', 0.06, 0.12); },
  playBoss(){ this.play(220, 'sine', 0.2, 0.08); }
};

// Particles for simple effects
let particles = [];
function Particle(x,y,vx,vy, life, color){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.life=life; this.age=0; this.color=color; }
Particle.prototype.update = function(dt){ this.age += dt; this.x += this.vx*dt; this.y += this.vy*dt; this.vy += 200*dt; }

function spawnParticles(x,y,color,count=12){ for(let i=0;i<count;i++){ const ang = Math.random()*Math.PI*2; const sp = Math.random()*200 + 40; particles.push(new Particle(x,y,Math.cos(ang)*sp,Math.sin(ang)*sp, Math.random()*0.6+0.4, color)); } }

// Boss wave control
let boss = null;
let nextBossAt = 30; // seconds
let initialBossTimes = []; // queue for guaranteed boss times (e.g., [30,60])

function spawnBoss(){ boss = { x: width/2, y: -40, r: 40, timer:0, shootTimer:0, duration:12, vx:80, targetY: 140 };
  SoundManager.playBoss();
}

function updateBoss(dt){ if(!boss) return; boss.timer += dt; if(boss.timer < 1.2){ boss.y += 150*dt; if(boss.y > boss.targetY) boss.y = boss.targetY; } else {
    boss.x += Math.sin(boss.timer*0.7)*boss.vx*dt;
    boss.shootTimer += dt;
    if(boss.shootTimer > 0.6){ boss.shootTimer = 0; // shoot radial + homing
      spawnRadial(boss.x, boss.y, 10 + Math.floor(level/2)*2, 120 + level*20);
      if(Math.random()<0.7) bullets.push(new Bullet(boss.x, boss.y, 0, 0, {type:'homing', init:{speed:120+level*15, homingLife:0.9 + Math.random()*1.6}, color:'#ffffff'}));
    }
  }
  if(boss.timer >= boss.duration){ // leave
    boss = null; spawnParticles(width/2, 60, '#ffd36b', 32);
  }
}

function drawBoss(){ if(!boss) return; 
  // Display boss at quadruple the nominal size (visual only)
  if(bossImgReady){ const size = boss.r*8; ctx.drawImage(bossImage, boss.x - size/2, boss.y - size/2, size, size); return; }
  ctx.save(); ctx.translate(boss.x, boss.y);
  const br = boss.r * 4; // visual half-size for the quadrupled rect
  ctx.beginPath(); ctx.fillStyle = 'rgba(255,110,150,0.95)'; ctx.roundRect ? ctx.roundRect(-br,-br,br*2,br*2,48) : ctx.fillRect(-br,-br,br*2,br*2);
  ctx.fill(); ctx.restore(); }

// helper for rounded rect fallback
CanvasRenderingContext2D.prototype.roundRect = CanvasRenderingContext2D.prototype.roundRect || function(x,y,w,h,r){ this.beginPath(); this.moveTo(x+r,y); this.lineTo(x+w-r,y); this.quadraticCurveTo(x+w,y,x+w,y+r); this.lineTo(x+w,y+h-r); this.quadraticCurveTo(x+w,y+h,x+w-r,y+h); this.lineTo(x+r,y+h); this.quadraticCurveTo(x,y+h,x,y+h-r); this.lineTo(x,y+r); this.quadraticCurveTo(x,y,x+r,y); this.closePath(); };

// player's hitbox (hitR) and visual radius are set on the player object

let width = 800; let height = 600; 
function resize(){
  const dpr = window.devicePixelRatio || 1;
  width = canvas.clientWidth || window.innerWidth;
  height = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', resize);
resize();

// Game state
let running = false; // indicates if RAF loop has been started
let gameActive = false; // true while player is alive and game logic runs
let pts = [];
let bullets = [];
let lastTime = 0;
let elapsed = 0;
let level = 1;
let levelTimer = 0;
let spawnTimer = 0;
let spawnBaseInterval = 1.0; // base spawn interval (seconds)
const MIN_SPAWN_INTERVAL = 0.45; // don't go below this
const SPAWN_DECAY = 0.00045; // how quickly spawn interval decreases with time (smaller = slower ramp). Reduced to slow ramp
let spawnInterval = spawnBaseInterval; // spawn wave every 1s (will be adjusted gradually)
let activePatterns = []; // patterns chosen per game (functions)
let lastPattern = null; // name of last spawned pattern (for debug)

// Player
const player = { x: width/2, y: height*0.85, r: 14, hitR: 8, color:'#6be6ff', imgReady: false, imgScale: 1.35 };
// load player sprite (place your PNG at assets/images/player.png)
player.image = new Image();
player.image.src = 'assets/images/player.png';
player.image.onload = ()=>{ player.imgReady = true; };
player.image.onerror = ()=>{ player.imgReady = false; };

// Optional boss image sprite (place at assets/images/boss.png). Falls back to drawn rect if missing.
let bossImage = new Image();
let bossImgReady = false;
bossImage.src = 'assets/images/boss.png';
bossImage.onload = ()=>{ bossImgReady = true; updateDebug(); };
bossImage.onerror = ()=>{ bossImgReady = false; };

function resetGame(){
  bullets = [];
  elapsed = 0;
  level = 1;
  levelTimer = 0;
  spawnInterval = 1.0;
  player.x = width/2; player.y = height*0.85;
}

// Input (support mouse drag + touch swipe)
let dragging = false;
let touchId = null;
let dragTarget = null; // position the user is touching/dragging towards (do not set player directly) 
let lastDragPos = null; // previous pointer position for direction
let activePointerId = null;

// Compute the visual/display position for the player's sprite and hitbox.
// While dragging/touching: the visible player is always displayed *above* the finger
// (fixed upward offset). The logical player still chases the dragTarget smoothly
// so there is no teleportation.
function computeDisplayPos(){
  if(dragTarget){
    // Make the displayed player sit higher above the finger for better visibility on touch devices.
    // Increase the minimum offset from 56 to 96 and add a small extra margin.
    const base = player.r*2 * (player.imgScale||1.35);
    const offset = Math.max(96, base + 40);
    let x = dragTarget.x;
    let y = dragTarget.y - offset;
    // clamp within canvas
    x = Math.max(player.r, Math.min(width - player.r, x));
    y = Math.max(player.r, Math.min(height - player.r, y));
    return { x, y };
  }
  return { x: player.x, y: player.y };
}

function toLocal(e){
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (canvas.width/canvas.clientWidth) / (window.devicePixelRatio||1), y: (e.clientY - rect.top) * (canvas.height/canvas.clientHeight) / (window.devicePixelRatio||1) };
}

canvas.addEventListener('pointerdown', (ev)=>{
  if(!gameActive) return; // ignore input when game over
  ev.preventDefault();
  dragging = true;
  const p = toLocal(ev);
  dragTarget = { x: p.x, y: p.y };
  lastDragPos = { x: p.x, y: p.y };
  activePointerId = ev.pointerId;
  try{ canvas.setPointerCapture(ev.pointerId); }catch(e){}
});
canvas.addEventListener('pointermove', (ev)=>{
  if(!dragging || !gameActive) return;
  ev.preventDefault();
  const p = toLocal(ev);
  if(!dragTarget) dragTarget = { x: p.x, y: p.y };
  else { lastDragPos = { x: dragTarget.x, y: dragTarget.y }; dragTarget.x = p.x; dragTarget.y = p.y; }
});
canvas.addEventListener('pointerup', (ev)=>{
  // When touch ends, stop dragging but DO NOT move the player (prevent snap/teleport)
  dragging=false; dragTarget = null; lastDragPos = null;
  if(activePointerId){ try{ canvas.releasePointerCapture(activePointerId);}catch(e){} activePointerId=null; }
});
canvas.addEventListener('pointercancel', (ev)=>{
  // Cancelled pointer: stop dragging but DO NOT move the player
  dragging=false; dragTarget = null; lastDragPos = null;
  if(activePointerId){ try{ canvas.releasePointerCapture(activePointerId);}catch(e){} activePointerId=null; }
});

// Utility
function rand(min,max){ return Math.random()*(max-min)+min }

// Bullet constructor
function Bullet(x,y,vx,vy, opts={}){
  this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.r = opts.r||6; this.color = opts.color||'#ffdd57'; this.type = opts.type||'straight'; this.init = opts.init||{}; this.offset = opts.offset||0; this.time = 0; this.dead = false; this.splitDone = false;
}

Bullet.prototype.update = function(dt){
  this.time += dt;
  if(this.type === 'sine'){
    const amp = this.init.amp || 80;
    const freq = this.init.freq || 1.2;
    this.x += this.vx*dt + Math.sin(this.time * freq + this.offset) * amp * dt;
    this.y += this.vy*dt;
  } else if(this.type === 'spiral'){
    // spiral from center
    const sp = this.init.speed || 120;
    const angle = this.init.angle + this.time* this.init.spin;
    this.x = this.init.cx + Math.cos(angle) * this.init.radius;
    this.y = this.init.cy + Math.sin(angle) * this.init.radius;
    this.init.radius += this.init.expand * dt;
  } else if(this.type === 'homing'){
    // homing towards player for a limited time (if init.homingLife provided)
    const sp = this.init.speed||120;
    const homingLife = (typeof this.init.homingLife === 'number') ? this.init.homingLife : Infinity;
    if(this.time <= homingLife){
      const dx = player.x - this.x, dy = player.y - this.y;
      const dist = Math.hypot(dx,dy) || 1;
      this.vx = (dx/dist)*sp; this.vy = (dy/dist)*sp;
    }
    this.x += this.vx*dt; this.y += this.vy*dt;
  } else if(this.type === 'split'){
    // moves for a bit, then splits into multiple bullets
    this.x += this.vx*dt; this.y += this.vy*dt;
    const splitAt = this.init.splitAt || 0.9;
    if(!this.splitDone && this.time >= splitAt){
      this.splitDone = true;
      const n = this.init.count || 6;
      const speed = this.init.childSpeed || 140;
      for(let i=0;i<n;i++){
        const ang = (i/n)*Math.PI*2 + (Math.random()*0.3-0.15);
        const vx = Math.cos(ang)*speed; const vy = Math.sin(ang)*speed;
        bullets.push(new Bullet(this.x, this.y, vx, vy, {r:4, color: this.init.color || '#ffd36b'}));
      }
      this.dead = true;
      SoundManager.play(360,'sawtooth',0.06,0.08);
    }
  } else if(this.type === 'delayed'){
    // waits 'wait' seconds then applies velocity
    const wait = this.init.wait || 0.8;
    if(this.time < wait){ /* stay put */ }
    else {
      if(!this.init._started){ this.init._started = true; this.vx = this.init.vx || 0; this.vy = this.init.vy || (this.init.speed || 220); }
      this.x += this.vx*dt; this.y += this.vy*dt;
    }
  } else if(this.type === 'sweep'){
    // horizontal sweep with small vertical motion
    this.x += this.vx*dt;
    this.y += (this.vy + Math.sin(this.time*1.2)*20) * dt;
  } else if(this.type === 'zigzag'){
    // zigzag: sinusoidal lateral movement added to forward velocity
    const amp = this.init.amp || 60;
    const freq = this.init.freq || 6.0;
    this.x += this.vx*dt + Math.sin(this.time * freq + this.offset) * amp * dt;
    this.y += this.vy*dt;
  } else if(this.type === 'corkscrew'){
    // corkscrew: forward motion with rotating offset
    const spin = this.init.spin || 8;
    const rad = this.init.radius || 30;
    const ang = this.offset + this.time * spin;
    this.x += Math.cos(ang) * rad * dt + this.vx*dt;
    this.y += this.vy*dt + Math.sin(ang) * rad * dt;
  } else if(this.type === 'firework'){
    // goes up or moves, then explodes at time 'explodeAt'
    const explodeAt = this.init.explodeAt || 0.9;
    if(this.time >= explodeAt && !this.splitDone){
      this.splitDone = true;
      const n = this.init.count || 10;
      const sp = this.init.burstSpeed || 120;
      for(let i=0;i<n;i++){ const ang = (i/n)*Math.PI*2 + (Math.random()*0.2-0.1); bullets.push(new Bullet(this.x, this.y, Math.cos(ang)*sp, Math.sin(ang)*sp, {r:4, color:this.init.color||'#ffd36b'})); }
      this.dead = true; SoundManager.play(520,'sine',0.08,0.08);
    } else {
      this.x += this.vx*dt; this.y += this.vy*dt;
    }
  } else if(this.type === 'accel'){
    // accelerates in y over time
    const acc = this.init.acc || 200;
    this.vy += acc * dt;
    this.x += this.vx*dt; this.y += this.vy*dt;
  } else if(this.type === 'bounce'){
    this.x += this.vx*dt; this.y += this.vy*dt;
    // simple bounce off left/right
    if((this.x < 10 && this.vx < 0) || (this.x > width-10 && this.vx > 0)){ this.vx *= -1; this.init.bounces = (this.init.bounces||0)+1; if(this.init.bounces>3) this.dead = true; }
  } else {
    this.x += this.vx*dt; this.y += this.vy*dt;
  }
}

// Pattern implementations (used per-game)
function patternStraight(strength){ for(let i=0;i<strength;i++) bullets.push(new Bullet(rand(30, width-30), -10, 0, rand(80,150)+(level*20), {r:6, color:'#ff6b6b'})); }
function patternSine(strength){ for(let i=0;i<strength+2;i++) bullets.push(new Bullet(rand(40, width-40), -10, 0, rand(80,150)+(level*20), {type:'sine', init:{amp:40+level*6, freq:1 + level*0.2}, color:'#ffd36b'})); }
function patternRadial(strength){ spawnRadial(width/2, -20, Math.max(8, strength*2), 80 + level*20); }
function patternSpiral(strength){ spawnSpiral(rand(80,width-80), -40, Math.max(4, Math.floor(strength/1.2))); }
function patternMixed(strength){ spawnRadial(width/2, -20, 8 + Math.floor(level/2), 100 + level*30); spawnSpiral(rand(60,width-60), -40, 4 + level); for(let i=0;i<strength;i++) bullets.push(new Bullet(rand(20,width-20), -10, 0, rand(120,220)+(level*50), {type:'sine', init:{amp:80, freq:1.5}, color:'#bdb2ff'})); if(Math.random() < 0.5) bullets.push(new Bullet(rand(20,width-20), -10, 0, 0, {type:'homing', init:{speed:130+level*20, homingLife:1.0 + Math.random()*1.2}, color:'#ffffff'})); }

// Additional patterns
function patternFan(strength){ const cx = width/2; const y = -10; const base = Math.PI*1.0; const spread = Math.PI*0.7; for(let i=0;i<strength+2;i++){ const ang = base - spread/2 + (spread*(i/(strength+1))); const sp = 120 + level*25; bullets.push(new Bullet(cx, y, Math.cos(ang)*sp, Math.sin(ang)*sp, {r:6, color:'#ff8f66'})); } }
function patternSplit(strength){ for(let i=0;i<Math.max(2,strength/2);i++){ const x = rand(40, width-40); bullets.push(new Bullet(x, -10, 0, rand(60,120)+(level*20), {type:'split', init:{splitAt:1.0 + Math.random()*0.6, count:5 + Math.floor(level/2), childSpeed:120 + level*18, color:'#ffe082'}})); } }
function patternEdgeSweep(strength){ const side = Math.random() < 0.5 ? -20 : width+20; const dir = side < 0 ? 1 : -1; for(let i=0;i<2 + Math.floor(strength/3);i++){ const y = rand(40, height/2); const vx = dir*(80 + level*30); bullets.push(new Bullet(side, y, vx, 20 + Math.random()*40, {type:'sweep', color:'#b29cff'})); } }
function patternDelayed(strength){ for(let i=0;i<Math.max(3,strength);i++){ const x = rand(30, width-30); bullets.push(new Bullet(x, -10, 0, 0, {type:'delayed', init:{wait:0.6+Math.random()*0.9, speed:180 + level*40}, color:'#ffb3d9'})); } }
function patternCluster(strength){
  for(let i=0;i<Math.max(4,strength);i++){
    const cx = rand(40,width-40);
    const cy = -10 - Math.random()*40;
    for(let j=0;j<3;j++){
      bullets.push(new Bullet(cx + rand(-20,20), cy + rand(-10,10), rand(-20,20), rand(40,120)+(level*10), {r:5, color:'#9fffb2'}));
    }
  }
}

// More patterns
function patternShotgun(strength){ const cx = rand(40,width-40); const base = Math.PI/2; const spread = Math.PI*0.5; const n = 6 + Math.floor(strength/2); for(let i=0;i<n;i++){ const ang = base - spread/2 + (spread*(i/(n-1))); const sp = 180 + level*20; bullets.push(new Bullet(cx, -10, Math.cos(ang)*sp, Math.sin(ang)*sp, {r:6, color:'#ffcf66'})); } }
function patternZigzag(strength){ for(let i=0;i<Math.max(4,strength);i++){ const x = rand(30,width-30); bullets.push(new Bullet(x, -10, 0, rand(80,140)+(level*20), {type:'zigzag', init:{amp:40+level*8, freq:5+level*0.6}, color:'#66d9ff'})); } }
function patternCorkscrew(strength){ for(let i=0;i<Math.max(3,strength/2);i++){ bullets.push(new Bullet(rand(60,width-60), -20, rand(-10,10), rand(80,140)+(level*18), {type:'corkscrew', init:{spin:6+level*1.4, radius:16+level*3}, offset: Math.random()*Math.PI*2, color:'#f6a6ff'})); } }
function patternFireworks(strength){ for(let i=0;i<Math.max(3,strength/2);i++){ const x = rand(60,width-60); // spawn from top and travel downward before exploding
    bullets.push(new Bullet(x, -20, 0, 160 + level*30, {type:'firework', init:{explodeAt:0.9 + Math.random()*0.6, count:8 + Math.floor(level/2), burstSpeed:120 + level*20, color:'#ffd36b'}})); } }
function patternAccel(strength){ for(let i=0;i<Math.max(4,strength);i++){ const x = rand(30,width-30); bullets.push(new Bullet(x, -10, 0, rand(60,120), {type:'accel', init:{acc: 120 + level*40}, color:'#b3ffd6'})); } }
function patternBounce(strength){ for(let i=0;i<Math.max(2,Math.floor(strength/3));i++){ const y = rand(60, height/2); const side = Math.random()<0.5 ? -20 : width+20; const vx = side<0 ? (120+level*20) : -(120+level*20); bullets.push(new Bullet(side, y, vx, Math.random()*20+20, {type:'bounce', init:{bounces:0}, color:'#ffd3e2'})); } }

function spawnWavePattern(t){
  // Play a faint sound to clue player to a new wave
  SoundManager.play(420, 'sine', 0.04, 0.02);
  // strength increases more slowly now: slower by elapsed/40 base and smaller per-level
  const strength = Math.max(3, Math.floor(3 + level*0.6 + elapsed/40));
  // choose completely at random from the full set of patterns each wave
  const pool = [patternStraight, patternSine, patternRadial, patternSpiral, patternMixed, patternFan, patternSplit, patternEdgeSweep, patternDelayed, patternCluster, patternShotgun, patternZigzag, patternCorkscrew, patternFireworks, patternAccel, patternBounce];
  const idx = Math.floor(Math.random() * pool.length);
  const p = pool[idx];
  lastPattern = p.name || p._patternName || 'anonymous';
  if(DEBUG) { console.log('[DEBUG] spawnWavePattern selected:', lastPattern); }
  p(strength);
}

function spawnSpiral(cx,cy, count){
  const baseR = 20;
  for(let i=0;i<count;i++){
    const angle = (i/count)*Math.PI*2;
    bullets.push(new Bullet( cx, cy, 0, 0, { type:'spiral', init:{ cx, cy, angle, radius:baseR, expand:20 + level*6, spin: 2 + level*0.8, speed: 100 }, color:'#7efff5'}));
  }
}

function spawnRadial(cx,cy, n, speed){
  for(let i=0;i<n;i++){
    const ang = (i/n) * Math.PI*2;
    const vx = Math.cos(ang)*speed; const vy = Math.sin(ang)*speed;
    bullets.push(new Bullet(cx,cy,vx,vy, {r:6, color:'#ffd36b'}));
  }
}

function update(dt){
  // gradually adjust spawnInterval based on elapsed time (slower ramp now)
  spawnInterval = Math.max(MIN_SPAWN_INTERVAL, spawnBaseInterval - elapsed * SPAWN_DECAY);

  // spawn only when game is active
  if(gameActive){
    spawnTimer += dt;
    if(spawnTimer >= spawnInterval){
      spawnTimer -= spawnInterval;
      spawnWavePattern();
    }
  }

  // level-up every 10s
  levelTimer += dt;
  if(levelTimer >= 10){ levelTimer -= 10; level++; }
  levelEl.textContent = `Lv ${level}`;

  // update bullets
  for(let b of bullets){ b.update(dt); }
  // remove dead or offscreen
  bullets = bullets.filter(b => !b.dead && b.x > -50 && b.x < width+50 && b.y > -80 && b.y < height+80);

  // update particles
  for(let p of particles) p.update(dt);
  particles = particles.filter(p => p.age < p.life);

  // boss spawn only when game active
  if(gameActive && !boss && elapsed >= nextBossAt){
    spawnBoss();
    // if there are initial guaranteed times, pop the next one; otherwise switch to randomized intervals
    if(initialBossTimes && initialBossTimes.length > 0){ nextBossAt = initialBossTimes.shift(); }
    else { nextBossAt = elapsed + 45 + Math.random()*20; }
  }
  updateBoss(dt);

  // smooth movement toward the display position above the touch if present
  if(dragTarget){
    const maxSpeed = 700; // px/s, controls how fast the player follows the display pos
    const dp = computeDisplayPos();
    const dx = dp.x - player.x;
    const dy = dp.y - player.y;
    const dist = Math.hypot(dx,dy);
    if(dist > 0.1){
      const maxMove = maxSpeed * dt;
      const t = Math.min(1, maxMove / dist);
      player.x += dx * t;
      player.y += dy * t;
    }
  }
  // clamp player to bounds (ensure not outside canvas)
  player.x = Math.max(player.r, Math.min(width - player.r, player.x));
  player.y = Math.max(player.r, Math.min(height - player.r, player.y));

  // collision check (use smaller hitR for player) - only trigger when game active
  if(gameActive){
    const dp = { x: player.x, y: player.y };
    for(let b of bullets){
      const dx = b.x - dp.x; const dy = b.y - dp.y; const d2 = dx*dx + dy*dy;
      const rsum = b.r + player.hitR;
      if(d2 <= rsum*rsum){ // collision
        spawnParticles(dp.x, dp.y, '#ff6b6b', 20);
        SoundManager.playHit();
        endGame(); return;
      }
    }
    // collision with boss
    if(boss){ const dx = boss.x - dp.x; const dy = boss.y - dp.y; if(dx*dx + dy*dy <= (boss.r + player.hitR)*(boss.r + player.hitR)){ spawnParticles(dp.x, dp.y, '#ff6b6b', 26); SoundManager.playHit(); endGame(); return; } }
  }
}

function draw(){
  ctx.clearRect(0,0, width, height);
  // background
  const g = ctx.createLinearGradient(0,0,0,height);
  g.addColorStop(0,'#071028'); g.addColorStop(1,'#0b0b1a');
  ctx.fillStyle = g; ctx.fillRect(0,0,width,height);

  // bullets
  for(let b of bullets){ ctx.beginPath(); ctx.fillStyle = b.color; ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill(); }

  // boss
  drawBoss();

  // particles
  for(let p of particles){ ctx.beginPath(); ctx.fillStyle = p.color; ctx.globalAlpha = 1 - (p.age/p.life); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill(); }
  ctx.globalAlpha = 1;

  // player (visual) - drawn last so it's always on top
  // Use the smoothed logical position (`player.x`,`player.y`) so the sprite slowly follows the touch
  const dpos = { x: player.x, y: player.y };
  if(player.imgReady){
    const size = player.r*2 * (player.imgScale || 1.35);
    ctx.drawImage(player.image, dpos.x - size/2, dpos.y - size/2, size, size);
  } else {
    ctx.beginPath(); ctx.fillStyle = player.color; ctx.arc(dpos.x, dpos.y, player.r, 0, Math.PI*2); ctx.fill();
  }
  // small hitbox indicator (subtle)
  ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.arc(dpos.x, dpos.y, player.hitR, 0, Math.PI*2); ctx.stroke();


}

function loop(ts){
  if(!running) return;
  if(!lastTime) lastTime = ts;
  const dt = Math.min(0.05, (ts - lastTime)/1000);
  lastTime = ts;
  elapsed += dt;
  levelTimer += dt;

  update(dt);
  draw();

  timeEl.textContent = `${elapsed.toFixed(1)}s`;
  // debug panel update
  if(DEBUG){ const dp = computeDisplayPos(); debugPanel.textContent = `run:${running} active:${gameActive} elapsed:${elapsed.toFixed(1)}s bullets:${bullets.length} particles:${particles.length} boss:${boss?1:0} spawnI:${spawnInterval.toFixed(2)}\ndrag:${dragTarget?Math.round(dragTarget.x)+','+Math.round(dragTarget.y):'null'} dp:${Math.round(dp.x)+','+Math.round(dp.y)} player:${Math.round(player.x)+','+Math.round(player.y)} pattern:${lastPattern||'none'} bossImg:${bossImgReady? 'yes':'no'}`; }
  requestAnimationFrame(loop);
}

function startGame(){
  // resume audio context on user gesture
  SoundManager.init(); if(SoundManager.ctx && SoundManager.ctx.state === 'suspended') SoundManager.ctx.resume();
  // initialize/reset
  resetGame();
  titleScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  lastTime = 0; spawnTimer = 0; levelTimer = 0; 
  // set up guaranteed boss schedule: 30s and 60s first, then revert to randomized intervals
  initialBossTimes = [30, 60, 90];
  nextBossAt = initialBossTimes.shift();
  gameActive = true;
  // choose random patterns for this run (safe lookup to avoid ReferenceError)
  const possibleNames = ['patternStraight','patternSine','patternRadial','patternSpiral','patternMixed','patternFan','patternSplit','patternEdgeSweep','patternDelayed','patternCluster','patternShotgun','patternZigzag','patternCorkscrew','patternFireworks','patternAccel','patternBounce'];
  const posible = [];
  for(const n of possibleNames){ const fn = window[n]; if(typeof fn === 'function') posible.push(fn); else if(DEBUG) console.warn('[DEBUG] pattern missing:', n); }
  activePatterns = [];
  const pickCount = 2 + Math.floor(Math.random()*3); // 2-4 patterns
  const pool = posible.slice();
  for(let i=0;i<pickCount && pool.length>0;i++){ const idx = Math.floor(Math.random()*pool.length); activePatterns.push(pool.splice(idx,1)[0]); }
  // occasionally add extra homing-heavy behavior
  if(Math.random() < 0.25){
    const homingHeavy = function homingHeavy(){ for(let i=0;i<3+level;i++) bullets.push(new Bullet(rand(20,width-20), -10, 0, 0, {type:'homing', init:{speed:120+level*18, homingLife:0.9 + Math.random()*1.4}, color:'#ffffff'})); };
    activePatterns.push(homingHeavy);
  }

  // refresh displayed best
  updateBestDisplay();
  // start RAF loop once
  if(!running){ running = true; requestAnimationFrame(loop); }
  if(DEBUG) { console.log('[DEBUG] startGame called - running:', running, 'gameActive:', gameActive, 'activePatterns:', activePatterns.length); debugPanel.style.display = 'block'; debugPanel.textContent = `[start] running:${running} active:${gameActive} patterns:${activePatterns.length}`; }
}

function endGame(){
  // Do not stop the RAF loop; only stop game logic (spawning/input)
  gameActive = false;
  finalTime.textContent = `生存時間: ${elapsed.toFixed(1)}s`;
  // save best
  if(elapsed > bestTime){ bestTime = elapsed; localStorage.setItem(STORAGE_KEY, bestTime.toString()); bestNote.textContent = 'New Best!  ' + bestTime.toFixed(1) + 's'; spawnParticles(player.x, player.y, '#ffd36b', 28); }
  else { bestNote.textContent = ''; }
  gameOverScreen.classList.remove('hidden');
  // visual+sound
  spawnParticles(player.x, player.y, '#ff6b6b', 36);
  SoundManager.playExplosion();
  updateBestDisplay();
  if(DEBUG){ debugPanel.textContent = `[end] running:${running} active:${gameActive} elapsed:${elapsed.toFixed(1)}s bullets:${bullets.length}`; }
}


startBtn.addEventListener('click', ()=>{ startGame(); });
restartBtn.addEventListener('click', ()=>{ startGame(); });
if(backTitleBtn) backTitleBtn.addEventListener('click', ()=>{ // show title screen and reset
  gameActive = false;
  titleScreen.classList.remove('hidden');
  gameOverScreen.classList.add('hidden');
  resetGame();
  updateBestDisplay();
});

// initialize positions on resize
window.addEventListener('resize', ()=>{ resize(); player.x = width/2; player.y = height*0.85; });

// initial draw
(function init(){
  resize(); draw();

  // Title image load/error handling with fallback
  (function(){
    const t = document.getElementById('title-img');
    if(!t) return;
    function showPlaceholder(){
      // if placeholder already exists, do nothing
      if(t.__placeholder) return;
      const ph = document.createElement('div'); ph.className = 'title-placeholder'; ph.textContent = 'タイトル画像';
      t.parentNode.insertBefore(ph, t);
      t.__placeholder = ph;
      t.style.display = 'none';
    }
    function removePlaceholder(){ if(t.__placeholder){ t.__placeholder.remove(); t.__placeholder = null; } }
    // create a small debug indicator under the image
    let dbg = document.createElement('div'); dbg.className = 'title-debug'; dbg.textContent = '画像ロード中...'; t.parentNode.insertBefore(dbg, t.nextSibling);
    function updateDebug(){ const cs = window.getComputedStyle(t); dbg.textContent = ``; }

    function makeVisible(){ try{ t.style.display = 'block'; t.style.opacity = 1; t.style.visibility = 'visible'; t.style.zIndex = 12; t.style.border = '2px solid rgba(255,255,255,0.08)'; }catch(e){}
    }

    // small parallax interaction for title screen (ship moves slightly with mouse/touch)
    const titleScreen = document.getElementById('title-screen');
    if(titleScreen){
      titleScreen.addEventListener('mousemove', (ev)=>{
        const rect = titleScreen.getBoundingClientRect();
        const nx = (ev.clientX - rect.left)/rect.width; const ny = (ev.clientY - rect.top)/rect.height;
        const img = document.getElementById('title-img');
        if(img) img.style.transform = `translate(${(nx-0.5)*6}%, ${(ny-0.5)*4}%) rotate(${(nx-0.5)*2}deg)`;
      });
      titleScreen.addEventListener('mouseleave', ()=>{ const img = document.getElementById('title-img'); if(img) img.style.transform = ''; });
    }

    function handleLoad(){ removePlaceholder(); makeVisible(); updateDebug(); }
    function handleError(){ console.warn('title image failed to load:', t.src); showPlaceholder(); updateDebug(); // try one reload with cache-buster
      setTimeout(()=>{ try{ t.src = t.src.split('?')[0] + '?_r=' + Date.now(); t.style.display = 'block'; }catch(e){ /* ignore */ } }, 600);
    }
    t.addEventListener('load', ()=>{ handleLoad(); });
    t.addEventListener('error', ()=>{ handleError(); });
    if(t.complete){ updateDebug(); if(t.naturalWidth && t.naturalWidth>0) handleLoad(); else handleError(); }
  })();
})();

// For development: allow keyboard arrows and debug toggle
window.addEventListener('keydown', (e)=>{
  if(!running) return;
  const s = 8;
  if(e.key==='ArrowLeft') player.x -= s;
  if(e.key==='ArrowRight') player.x += s;
  if(e.key==='ArrowUp') player.y -= s;
  if(e.key==='ArrowDown') player.y += s;
  // toggle debug with 'd' or 'D'
  if(e.key==='d' || e.key==='D'){
    DEBUG = !DEBUG;
    debugPanel.style.display = DEBUG ? 'block' : 'none';
  }
});
