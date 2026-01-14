// Handy Tetris - シンプルで見やすいテトリス
const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');

const COLS = 10; const ROWS = 20; const BLOCK = 30;
canvas.width = COLS * BLOCK; canvas.height = ROWS * BLOCK;
ctx.scale(BLOCK, BLOCK);
nextCtx.scale(20, 20);

const colors = [null, '#00aaff', '#ff9800', '#00e676', '#9c27b0', '#ffd740', '#ff5252', '#00bcd4', '#d84315']; // index 8 added for Z piece (was invisible)

function createMatrix(w,h){ const m=[]; while(h--) m.push(new Array(w).fill(0)); return m; }
let arena = createMatrix(COLS, ROWS);

function drawMatrix(matrix, offset, context=ctx, alpha=1){
  context.save(); context.globalAlpha = alpha;
  matrix.forEach((row,y)=> row.forEach((value,x)=>{
    // only draw positive values (cleared cells are negative and hidden)
    if(value > 0){
      context.fillStyle = colors[value];
      context.fillRect(x+offset.x, y+offset.y, 1, 1);
      context.strokeStyle = 'rgba(0,0,0,0.25)'; context.lineWidth = 0.04;
      context.strokeRect(x+offset.x+0.02, y+offset.y+0.02, 0.96, 0.96);
    }
  }));
  context.restore();
}

function merge(arena, player){ player.matrix.forEach((row,y)=> row.forEach((v,x)=>{ if(v) arena[y+player.pos.y][x+player.pos.x]=v; })); }
function collide(arena, player){ const m = player.matrix; for(let y=0;y<m.length;y++) for(let x=0;x<m[y].length;x++) if(m[y][x]!==0 && (arena[y+player.pos.y] && arena[y+player.pos.y][x+player.pos.x])!==0) return true; return false; }
function rotate(matrix, dir){ for(let y=0;y<matrix.length;y++) for(let x=0;x<y;x++) [matrix[x][y],matrix[y][x]]=[matrix[y][x],matrix[x][y]]; if(dir>0) matrix.forEach(row=>row.reverse()); else matrix.reverse(); }

function createPiece(type){
  switch(type){
    case 'T': return [[0,7,0],[7,7,7],[0,0,0]];
    case 'O': return [[6,6],[6,6]];
    case 'L': return [[0,3,0],[0,3,0],[0,3,3]];
    case 'J': return [[0,4,0],[0,4,0],[4,4,0]];
    case 'I': return [[0,5,0,0],[0,5,0,0],[0,5,0,0],[0,5,0,0]];
    case 'S': return [[0,2,2],[2,2,0],[0,0,0]];
    case 'Z': return [[8,8,0],[0,8,8],[0,0,0]];
  }
}
function randomPiece(){ const pieces = 'TJLOSZI'; return pieces[Math.floor(Math.random()*pieces.length)]; }

const player = { pos:{x:0,y:0}, matrix:null };
let nextQueue = []; 
let dropInterval = 1000, dropCounter=0, lastTime=0;
let score=0, lines=0, level=1, paused=false;

// Row-clear animation state
let clearAnimations = []; // { rows: [y,...], particles: [...], elapsed, duration }
let animating = false;
const ANIM_DURATION = 600; // ms
const GRAVITY = 0.0025; // grid units per ms^2
let playerResetAfterClear = false;

function computeScore(rows){ const scores=[0,40,100,300,1200]; return scores[rows] ? scores[rows]*level : 0; }

function playerReset(){ player.matrix = nextQueue.shift(); nextQueue.push(createPiece(randomPiece())); player.pos.y = 0; player.pos.x = Math.floor(COLS/2) - Math.floor(player.matrix[0].length/2); if(collide(arena, player)) gameOver(); drawNext(); }

function playerDrop(){
  player.pos.y++;
  if(collide(arena, player)){
    player.pos.y--;
    merge(arena, player);
    const started = sweep();
    if(!started){
      playerReset();
      updateScore();
    } else {
      // rows removed immediately inside sweep; reset now so the next piece spawns and blocks fall
      playerReset();
      // keep inputs frozen until animation completes
      paused = true;
      playerResetAfterClear = false;
    }
  }
  dropCounter = 0;
}
function playerMove(dir){ player.pos.x+=dir; if(collide(arena, player)) player.pos.x -= dir; }
function playerRotate(dir){ const pos = player.pos.x; let offset = 1; rotate(player.matrix, dir); while(collide(arena, player)){ player.pos.x += offset; offset = -(offset + (offset>0?1:-1)); if(offset > player.matrix[0].length){ rotate(player.matrix, -dir); player.pos.x = pos; return; } } }
function hardDrop(){
  while(!collide(arena, player)) player.pos.y++;
  player.pos.y--;
  merge(arena, player);
  const started = sweep();
  if(!started){
    playerReset();
    updateScore(2);
  } else {
    // rows removed immediately; spawn next piece now
    playerReset();
    paused = true; // freeze inputs until animation ends
    playerResetAfterClear = false;
  }
  dropCounter = 0;
}

function sweep(){
  const cleared = [];
  outer: for(let y=arena.length-1;y>=0;y--){
    for(let x=0;x<arena[y].length;x++) if(arena[y][x]===0) continue outer;
    cleared.push(y);
  }
  if(cleared.length === 0) return false;

  // Debug: log detected cleared rows
  console.log('[TETRIS] sweep detected cleared rows:', cleared.slice());

  // create particles from the cleared cells
  const particles = [];
  cleared.forEach(y=>{
    for(let x=0;x<COLS;x++){
      const v = arena[y][x];
      if(!v) continue;
      particles.push({ x: x + 0.5, y: y + 0.5, vx: (Math.random()-0.5)*0.8, vy: - (Math.random()*0.9 + 0.6), color: colors[v], life: 0 });
    }
  });

  // Iteratively find and remove full rows from bottom up so cascades are handled immediately
  const clearedRows = [];
  // Remove rows as we find them, capturing particle info was already done
  for(let yy=ROWS-1; yy>=0; yy--){
    if(arena[yy].every(cell => cell > 0)){
      clearedRows.push(yy);
      arena.splice(yy,1);
      arena.unshift(new Array(COLS).fill(0));
      yy++; // re-check the row that fell into this index
    }
  }

  if(clearedRows.length === 0) return false;
  console.log('[TETRIS] sweep cleared rows (iterative):', clearedRows.slice());

  // store animation info (rows are original y positions at time of clear)
  clearAnimations.push({ rows: clearedRows.slice(), rowsCount: clearedRows.length, particles, elapsed: 0, duration: ANIM_DURATION });
  animating = true;
  if(typeof playSound === 'function') playSound({type: 'line' + Math.min(clearedRows.length,4)});
  return true;
}
function updateScore(){ document.getElementById('score').innerText = score; document.getElementById('level').innerText = level; document.getElementById('lines').innerText = lines; document.getElementById('highscore').innerText = localStorage.getItem('tetris-highscore') || 0; }

function drawGrid(){ ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.01; for(let x=0;x<=COLS;x++){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ROWS); ctx.stroke(); } for(let y=0;y<=ROWS;y++){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(COLS,y); ctx.stroke(); } }
function drawGhost(){ if(!player.matrix) return; const ghost = { pos:{x:player.pos.x,y:player.pos.y}, matrix:player.matrix }; while(!collide(arena, ghost)) ghost.pos.y++; ghost.pos.y--; drawMatrix(ghost.matrix, ghost.pos, ctx, 0.28); }

function draw(){
  ctx.fillStyle = '#071022'; ctx.fillRect(0,0,COLS,ROWS);
  drawGrid(); // crisp playfield border
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.06; ctx.strokeRect(0.02, 0.02, COLS-0.04, ROWS-0.04);

  drawMatrix(arena,{x:0,y:0});

  // draw row highlight + particles for active clear animations
  if(clearAnimations.length>0){
    clearAnimations.forEach(anim=>{
      const t = Math.min(1, anim.elapsed / anim.duration);
      // highlight rows
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      (anim.rows || []).forEach(r=>{
        ctx.fillStyle = 'rgba(255,255,255,' + (0.18 * (1 - Math.pow(1 - t, 2))) + ')';
        ctx.fillRect(0, r, COLS, 1);
      });
      ctx.restore();
      // particles
      anim.particles.forEach(p=>{
        const alpha = Math.max(0, 1 - (p.life / anim.duration));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color || '#fff';
        const s = 0.9;
        ctx.fillRect(p.x - s/2, p.y - s/2, s, s);
      });
      ctx.globalAlpha = 1;
    });
  }

  drawGhost(); if(player.matrix) drawMatrix(player.matrix, player.pos);
}

function drawPreview(matrix, context){ context.clearRect(0,0, context.canvas.width, context.canvas.height); if(!matrix) return; const w = matrix[0].length, h = matrix.length; const offset = { x: Math.floor((6-w)/2), y: Math.floor((6-h)/2) }; drawMatrix(matrix, offset, context); }
function drawNext(){ drawPreview(nextQueue[0], nextCtx); }


function startGame(){ document.getElementById('title-screen').style.display='none'; document.getElementById('gameover-screen').style.display='none'; paused=false; arena = createMatrix(COLS, ROWS); score=0; lines=0; level=1; dropInterval=1000; nextQueue=[]; for(let i=0;i<5;i++) nextQueue.push(createPiece(randomPiece())); playerReset(); updateScore(); lastTime=0; requestAnimationFrame(update); }

function gameOver(){ paused=true; document.getElementById('gameover-score').innerText = score; const prev = Number(localStorage.getItem('tetris-highscore')||0); if(score>prev) localStorage.setItem('tetris-highscore', score); document.getElementById('gameover-high').innerText = localStorage.getItem('tetris-highscore'); document.getElementById('gameover-screen').style.display='flex'; updateScore(); }
function restartGame(){ startGame(); }

// Input
window.addEventListener('keydown', e=>{ if(animating) return; if(e.code==='ArrowLeft') playerMove(-1); else if(e.code==='ArrowRight') playerMove(1); else if(e.code==='ArrowDown') playerDrop(); else if(e.code==='ArrowUp') playerRotate(1); else if(e.code==='Space'){ e.preventDefault(); hardDrop(); } else if(e.key.toLowerCase()==='p'){ paused=!paused; } });

// Touch buttons
['btn-left','btn-right','btn-rotate','btn-drop','btn-hard'].forEach(id=>{ const el = document.getElementById(id); if(!el) return; el.addEventListener('touchstart', e=>{ e.preventDefault(); if(animating) return; if(id==='btn-left') playerMove(-1); if(id==='btn-right') playerMove(1); if(id==='btn-rotate') playerRotate(1); if(id==='btn-drop') playerDrop(); if(id==='btn-hard') hardDrop(); }, {passive:false}); el.addEventListener('mousedown', e=>{ e.preventDefault(); if(animating) return; if(id==='btn-left') playerMove(-1); if(id==='btn-right') playerMove(1); if(id==='btn-rotate') playerRotate(1); if(id==='btn-drop') playerDrop(); if(id==='btn-hard') hardDrop(); }); });

// Hooks
document.getElementById('startButton').addEventListener('click', ()=>startGame());
document.getElementById('restartButton').addEventListener('click', ()=>restartGame());

// Debug helpers (use from browser console)
window.tetris_dumpArena = function(){ console.table(arena); };
window.tetris_fillRows = function(rows, value=7){ rows.forEach(y=>{ if(y>=0 && y<ROWS) arena[y].fill(value); }); console.log('[TETRIS] filled rows:', rows); };
window.tetris_runSweep = function(){ const before = arena.map(r=>r.slice()); console.log('[TETRIS] arena before sweep'); console.table(before); const started = sweep(); console.log('[TETRIS] sweep started:', started); console.log('[TETRIS] arena after sweep'); console.table(arena); };
window.tetris_clearAll = function(){ for(let y=0;y<ROWS;y++) arena[y].fill(0); updateScore(); console.log('[TETRIS] cleared arena'); };

// Main loop
function update(time=0){
  const delta = time - lastTime;
  lastTime = time;

  if(clearAnimations.length>0){
    for(let i=0;i<clearAnimations.length;i++){
      const anim = clearAnimations[i];
      anim.elapsed += delta;
      anim.particles.forEach(p=>{
        p.vy += GRAVITY * delta;
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.life = anim.elapsed;
      });
      if(anim.elapsed >= anim.duration){
        // Rows were removed immediately in sweep(); finalize scoring now
        const count = anim.rowsCount || (anim.rows ? anim.rows.length : 0);
        console.log('[TETRIS] clear animation finished, count=', count);
        lines += count;
        score += computeScore(count);
        // level rises 5× faster: every 2 lines instead of 10
        level = Math.floor(lines/2)+1;
        // keep same per-level speed change but with faster leveling
        dropInterval = Math.max(100, 1000 - (level-1)*80);

        // cleanup
        clearAnimations.splice(i,1); i--;
        animating = clearAnimations.length>0;
        paused = false;
        if(playerResetAfterClear){ playerResetAfterClear = false; playerReset(); }
        updateScore();
      }
    }
  } else {
    if(!paused) dropCounter += delta;
    if(!paused && dropCounter > dropInterval) playerDrop();
  }

  draw();
  requestAnimationFrame(update);
}

// Init
(function init(){ for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) arena[y][x]=0; nextQueue = [createPiece(randomPiece()), createPiece(randomPiece()), createPiece(randomPiece())]; drawNext(); updateScore(); })();
