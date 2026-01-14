// シンプルなオセロ実装（PNGのコマはCanvasで生成してdataURLとして利用します）
const SIZE = 8;
const EMPTY = 0, BLACK = 1, WHITE = -1;
let board = [];
let current = BLACK;
let blackImgSrc = null, whiteImgSrc = null;

const boardEl = document.getElementById('board');
const statusEl = document.querySelector('.status');
const scoreEl = document.querySelector('.score');
const resetBtn = document.getElementById('resetBtn');
const modeSelect = document.getElementById('modeSelect');
const cpuColorSelect = document.getElementById('cpuColorSelect');
const cpuLevelSelect = document.getElementById('cpuLevelSelect');
const cpuColorWrapper = document.getElementById('cpuColorWrapper');
const cpuLevelWrapper = document.getElementById('cpuLevelWrapper');
const cpuStatusEl = document.getElementById('cpuStatus');

let gameMode = 'hvh'; // 'hvh' or 'hvc'
let cpuPlayer = null; // BLACK (1) or WHITE (-1) or null
let cpuLevel = 'easy';
let cpuThinking = false;
let cpuTimeoutId = null;

// CanvasでPNG画像を作る（透明背景の丸）
function makeDiscPng(color, size=64){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(size/2, size*0.6, size*0.42, size*0.22, 0, 0, Math.PI*2);
  ctx.fill();
  // 円
  const grad = ctx.createRadialGradient(size*0.35,size*0.35, size*0.05, size*0.5,size*0.5, size*0.7);
  grad.addColorStop(0, color.light);
  grad.addColorStop(1, color.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size/2,size/2,size*0.36,0,Math.PI*2);
  ctx.fill();
  return c.toDataURL('image/png');
}

function initImages(){
  // assets に画像がある場合はそれを先に試し、読み込めなければ Canvas 生成にフォールバックする
  const bPath = 'assets/images/black.png';
  const wPath = 'assets/images/white.png';
  return new Promise((resolve)=>{
    let loaded = 0;
    let failed = false;
    const bImg = new Image();
    const wImg = new Image();

    function useAssets(){
      blackImgSrc = bPath;
      whiteImgSrc = wPath;
      resolve();
    }
    function fallback(){
      console.warn('Asset images not available, falling back to generated PNGs');
      blackImgSrc = makeDiscPng({light:'#333', dark:'#000'});
      whiteImgSrc = makeDiscPng({light:'#fff', dark:'#ddd'});
      resolve();
    }

    bImg.onload = ()=>{ if(failed) return; loaded++; if(loaded===2) useAssets(); };
    wImg.onload = ()=>{ if(failed) return; loaded++; if(loaded===2) useAssets(); };
    bImg.onerror = ()=>{ failed = true; fallback(); };
    wImg.onerror = ()=>{ failed = true; fallback(); };

    // まず assets のパスを試す
    bImg.src = bPath;
    wImg.src = wPath;

    // セーフガード：短時間で応答がない場合は生成にフォールバックする（2秒）
    setTimeout(()=>{ if(loaded<2 && !failed){ failed = true; fallback(); } }, 2000);
  });
} 

function initBoard(){
  board = Array.from({length:SIZE},()=>Array(SIZE).fill(EMPTY));
  // 初期配置
  board[3][3] = WHITE; board[4][4] = WHITE;
  board[3][4] = BLACK; board[4][3] = BLACK;
  current = BLACK;
}

function inside(r,c){return r>=0 && r<SIZE && c>=0 && c<SIZE}
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function validMovesFor(player){
  const moves = new Set();
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    if(board[r][c]!==EMPTY) continue;
    for(const [dr,dc] of DIRS){
      let rr=r+dr, cc=c+dc, n=0;
      while(inside(rr,cc) && board[rr][cc]===-player){ rr+=dr; cc+=dc; n++; }
      if(n>0 && inside(rr,cc) && board[rr][cc]===player){ moves.add(`${r},${c}`); break; }
    }
  }
  return Array.from(moves).map(s=>s.split(',').map(Number));
}

function makeMove(r,c,player){
  if(!inside(r,c) || board[r][c]!==EMPTY) return false;
  let flipped = [];
  for(const [dr,dc] of DIRS){
    let rr=r+dr, cc=c+dc, line = [];
    while(inside(rr,cc) && board[rr][cc]===-player){ line.push([rr,cc]); rr+=dr; cc+=dc; }
    if(line.length>0 && inside(rr,cc) && board[rr][cc]===player){ flipped = flipped.concat(line); }
  }
  if(flipped.length===0) return false;
  board[r][c]=player;
  for(const [rr,cc] of flipped) board[rr][cc]=player;
  return true;
}

// CPU 用ユーティリティ: その手でひっくり返る枚数をカウント
function countFlipsIf(r,c,player){
  let total=0;
  for(const [dr,dc] of DIRS){
    let rr=r+dr, cc=c+dc, n=0;
    while(inside(rr,cc) && board[rr][cc]===-player){ n++; rr+=dr; cc+=dc; }
    if(n>0 && inside(rr,cc) && board[rr][cc]===player) total+=n;
  }
  return total;
}

// --- 強力なAIサポート関数 (最強レベル) ---
const WEIGHTS = [
  [100,-25,10,5,5,10,-25,100],
  [-25,-25,1,1,1,1,-25,-25],
  [10,1,3,2,2,3,1,10],
  [5,1,2,1,1,2,1,5],
  [5,1,2,1,1,2,1,5],
  [10,1,3,2,2,3,1,10],
  [-25,-25,1,1,1,1,-25,-25],
  [100,-25,10,5,5,10,-25,100]
];

// in-placeで手を指してひっくり返した石の座標配列を返す（不正な手なら null）
function makeMoveWithFlips(r,c,player){
  if(!inside(r,c) || board[r][c]!==EMPTY) return null;
  let flipped = [];
  for(const [dr,dc] of DIRS){
    let rr=r+dr, cc=c+dc, line=[];
    while(inside(rr,cc) && board[rr][cc]===-player){ line.push([rr,cc]); rr+=dr; cc+=dc; }
    if(line.length>0 && inside(rr,cc) && board[rr][cc]===player){ flipped = flipped.concat(line); }
  }
  if(flipped.length===0) return null;
  board[r][c]=player;
  for(const [rr,cc] of flipped) board[rr][cc]=player;
  return flipped;
}
function undoMove(r,c,player,flipped){
  board[r][c]=EMPTY;
  for(const [rr,cc] of flipped) board[rr][cc]=-player;
}

function evaluateBoardFor(player){
  let s=0; let myCount=0, oppCount=0;
  for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++){
    if(board[r][c]===player){ s += WEIGHTS[r][c]; myCount++; }
    else if(board[r][c]===-player){ s -= WEIGHTS[r][c]; oppCount++; }
  }
  const myMoves = validMovesFor(player).length;
  const oppMoves = validMovesFor(-player).length;
  if(myMoves + oppMoves > 0) s += 10 * (myMoves - oppMoves);
  s += 2 * (myCount - oppCount);
  return s;
}

function findBestMove(rootPlayer, timeLimitMs){
  const start = Date.now();
  const empties = board.flat().filter(x=>x===0).length;
  let maxDepth = 6;
  if(empties <= 12) maxDepth = 14;
  else if(empties <= 20) maxDepth = 8;

  let bestMove = null;
  // 基本的なムーブオーダリング用：角を優先する
  const moves = validMovesFor(rootPlayer);
  if(moves.length===0) return null;

  // iterative deepening
  for(let depth=2; depth<=maxDepth; depth++){
    let timedOut = false;
    let bestScore = -Infinity;
    let bestLocal = null;

    // root loop with alpha-beta
    const ordered = moves.slice().sort((a,b)=>{
      // simple ordering: positional weight + flips
      const wa = WEIGHTS[a[0]][a[1]] + countFlipsIf(a[0],a[1],rootPlayer);
      const wb = WEIGHTS[b[0]][b[1]] + countFlipsIf(b[0],b[1],rootPlayer);
      return wb - wa;
    });

    for(const [r,c] of ordered){
      const flips = makeMoveWithFlips(r,c,rootPlayer);
      if(!flips) continue;
      const res = alphaBeta(-rootPlayer, depth-1, -Infinity, Infinity, start, timeLimitMs, rootPlayer);
      undoMove(r,c,rootPlayer,flips);
      if(res.timeout){ timedOut = true; break; }
      if(res.score > bestScore){ bestScore = res.score; bestLocal = [r,c]; }
    }

    if(!timedOut && bestLocal){ bestMove = bestLocal; }
    if(Date.now() - start > timeLimitMs) break;
  }
  return bestMove;
}

function alphaBeta(sideToMove, depth, alpha, beta, startTime, timeLimit, rootPlayer){
  if(Date.now() - startTime > timeLimit) return {score: evaluateBoardFor(rootPlayer), timeout:true};
  const moves = validMovesFor(sideToMove);
  if(depth===0 || (moves.length===0 && validMovesFor(-sideToMove).length===0)){
    return {score: evaluateBoardFor(rootPlayer), timeout:false};
  }
  if(moves.length===0){
    // pass
    return alphaBeta(-sideToMove, depth-1, alpha, beta, startTime, timeLimit, rootPlayer);
  }
  if(sideToMove === rootPlayer){
    let best = -Infinity;
    // move ordering
    const ordered = moves.slice().sort((a,b)=> (countFlipsIf(b[0],b[1],sideToMove)+WEIGHTS[b[0]][b[1]]) - (countFlipsIf(a[0],a[1],sideToMove)+WEIGHTS[a[0]][a[1]]));
    for(const [r,c] of ordered){
      const flips = makeMoveWithFlips(r,c,sideToMove);
      if(!flips) continue;
      const res = alphaBeta(-sideToMove, depth-1, alpha, beta, startTime, timeLimit, rootPlayer);
      undoMove(r,c,sideToMove,flips);
      if(res.timeout) return {score: res.score, timeout:true};
      best = Math.max(best, res.score);
      alpha = Math.max(alpha, best);
      if(beta <= alpha) break;
    }
    return {score: best, timeout:false};
  } else {
    let best = Infinity;
    const ordered = moves.slice().sort((a,b)=> (countFlipsIf(a[0],a[1],sideToMove)+WEIGHTS[a[0]][a[1]]) - (countFlipsIf(b[0],b[1],sideToMove)+WEIGHTS[b[0]][b[1]]));
    for(const [r,c] of ordered){
      const flips = makeMoveWithFlips(r,c,sideToMove);
      if(!flips) continue;
      const res = alphaBeta(-sideToMove, depth-1, alpha, beta, startTime, timeLimit, rootPlayer);
      undoMove(r,c,sideToMove,flips);
      if(res.timeout) return {score: res.score, timeout:true};
      best = Math.min(best, res.score);
      beta = Math.min(beta, best);
      if(beta <= alpha) break;
    }
    return {score: best, timeout:false};
  }
}

// --- /強力なAIサポート関数 ---

function scheduleCpuMove(){
  if(cpuThinking) return;
  cpuThinking = true;
  // render を呼んでステータスの横にインライン表示させる
  render();
  cpuTimeoutId = setTimeout(()=>{ cpuMove(); cpuTimeoutId = null; }, 600);
}

function cpuMove(){
  const moves = validMovesFor(current);
  if(moves.length===0){ cpuThinking=false; render(); return; }

  // 非同期で最強AIを実行する場合は別経路を取る（UI更新を許可するため）
  if(cpuLevel === 'best'){
    // 最強モードではゲーム画面上に「解析中」等の表示を出さず静かに思考させる
    // 少し遅延させてブラウザに描画させる
    setTimeout(()=>{
      const found = findBestMove(current, 1200); // 1200ms 制限
      const finalMove = found || moves[Math.floor(Math.random()*moves.length)];
      if(!finalMove || !Array.isArray(finalMove) || finalMove.length < 2){
        console.error('CPU failed to select a valid move (best)', {finalMove, moves, cpuLevel, current});
        cpuThinking = false; render(); return;
      }
      try{ makeMove(finalMove[0], finalMove[1], current); }
      catch(err){ console.error('Error applying CPU move (best)', err, {finalMove, moves, current}); cpuThinking=false; render(); return; }
      cpuThinking=false; current = -current; render();
    }, 50);
    return;
  }

  let move;
  if(cpuLevel === 'easy'){
    move = moves[Math.floor(Math.random()*moves.length)];
  } else if(cpuLevel === 'hard'){
    // greedy: 最大でひっくり返る手を選ぶ
    let best=[], bestCount=-1;
    for(const [r,c] of moves){ const cnt = countFlipsIf(r,c,current); if(cnt>bestCount){ bestCount=cnt; best=[[r,c]]; } else if(cnt===bestCount){ best.push([r,c]); } }
    move = best[Math.floor(Math.random()*best.length)];
  } else {
    // fallback
    let best=[], bestCount=-1;
    for(const [r,c] of moves){ const cnt = countFlipsIf(r,c,current); if(cnt>bestCount){ bestCount=cnt; best=[[r,c]]; } else if(cnt===bestCount){ best.push([r,c]); } }
    move = best[Math.floor(Math.random()*best.length)];
  }

  // 防御コード: move が存在しない可能性をチェック
  if(!move || !Array.isArray(move) || move.length < 2){
    console.error('CPU failed to select a valid move', {move, moves, cpuLevel, current});
    cpuThinking = false;
    render();
    return;
  }
  try{
    makeMove(move[0],move[1],current);
  }catch(err){
    console.error('Error applying CPU move', err, {move, moves, current});
    cpuThinking = false;
    render();
    return;
  }
  cpuThinking=false;
  current = -current;
  render();
}

function countScore(){
  let b=0,w=0;
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){ if(board[r][c]===BLACK) b++; else if(board[r][c]===WHITE) w++; }
  return {b,w};
}

function render(){
  boardEl.innerHTML = '';
  const valid = new Set(validMovesFor(current).map(([r,c])=>`${r},${c}`));
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    const sq = document.createElement('div'); sq.className='square';
    if(board[r][c]===EMPTY){
      if(valid.has(`${r},${c}`)) sq.classList.add('valid');
    } else sq.classList.add('disabled');
    const cell = document.createElement('div'); cell.className='cell';
    if(board[r][c]===BLACK){ cell.style.backgroundImage = `url(${blackImgSrc})`; cell.classList.add('disc-black'); }
    if(board[r][c]===WHITE){ cell.style.backgroundImage = `url(${whiteImgSrc})`; cell.classList.add('disc-white'); }
    sq.appendChild(cell);
    sq.addEventListener('click',()=>onSquareClick(r,c));
    boardEl.appendChild(sq);
  }
  const {b,w} = countScore();
  scoreEl.textContent = `黒: ${b}  白: ${w}`;
  // モバイル用の score-turn 表示を更新
  const scoreTurnEl = document.querySelector('.score .score-turn');
  if(scoreTurnEl){
    // show basic turn next to score on mobile; render will place CPU indicator if needed
    const base = (current===BLACK? '黒の番' : '白の番');
    // 最強モードでは目立つCPU表示をしない
    if(gameMode === 'hvc' && cpuPlayer === current && cpuThinking && cpuLevel !== 'best'){
      scoreTurnEl.innerHTML = `<span class="dot" aria-hidden="true"></span> ${base} (CPU)`;
    } else {
      scoreTurnEl.textContent = base;
    }
  }
  const movesForCurrent = validMovesFor(current);
  const movesForOpponent = validMovesFor(-current);
  if(movesForCurrent.length>0){
    const base = (current===BLACK? '黒の番' : '白の番');
    // 更新用要素を取得
    const statusTextEl = document.querySelector('.status .status-text');
    const statusCpuInline = document.querySelector('.status .status-cpu');
    if(statusTextEl) statusTextEl.textContent = base;
    if(statusCpuInline){
      // 最強モードでは目立つ表示をしない
      if(gameMode === 'hvc' && cpuPlayer === current && cpuThinking && cpuLevel !== 'best'){
        statusCpuInline.innerHTML = '<span class="dot" aria-hidden="true"></span> CPUが思考中…';
        statusCpuInline.style.visibility = 'visible';
      } else {
        statusCpuInline.innerHTML = '';
        statusCpuInline.style.visibility = 'hidden';
      }
    }
  }
  else if(movesForOpponent.length>0){
    // 隣に出す CPU 表示があれば隠す
    const statusCpuInline = document.querySelector('.status .status-cpu'); if(statusCpuInline){ statusCpuInline.innerHTML=''; statusCpuInline.style.visibility='hidden'; }
    statusEl.textContent = `${current===BLACK? '黒' : '白'} はパスです。`; current = -current; render(); return; }
  else{ // 両者パス -> ゲーム終了
    const statusCpuInline = document.querySelector('.status .status-cpu'); if(statusCpuInline){ statusCpuInline.innerHTML=''; statusCpuInline.style.visibility='hidden'; }
    const winnerText = b===w? '引き分け' : (b>w? '黒の勝ち' : '白の勝ち');
    const winnerColor = b===w ? 0 : (b>w ? BLACK : WHITE);
    statusEl.textContent = `ゲーム終了 — ${winnerText}`;
    if(typeof gameOver === 'undefined') window.gameOver = false;
    if(!window.gameOver){ window.gameOver = true; showResult(winnerText, winnerColor); }
    return;
  }

  // CPU の番なら思考をスケジュール
  if(gameMode === 'hvc' && cpuPlayer === current && movesForCurrent.length>0){
    scheduleCpuMove();
    return;
  }
}

function onSquareClick(r,c){
  // CPU の番や思考中はクリック無視
  if(gameMode === 'hvc' && cpuPlayer === current) return;
  if(cpuThinking) return;

  if(makeMove(r,c,current)){
    current = -current;
    render();
  }
}

function resetGame(){
  // キャンセル中の CPU 処理があればクリア
  if(cpuTimeoutId) { clearTimeout(cpuTimeoutId); cpuTimeoutId = null; }
  cpuThinking = false;
  // ゲーム終了状態・オーバーレイ・花火をリセット
  window.gameOver = false;
  const overlay = document.getElementById('resultOverlay'); if(overlay) overlay.hidden = true;
  stopFireworks();

  initBoard();
  // CPU 設定を反映
  if(gameMode === 'hvc') cpuPlayer = Number(cpuColorSelect.value); else cpuPlayer = null;
  render();
  // 先手が CPU なら思考を開始
  if(gameMode === 'hvc' && cpuPlayer === current){ scheduleCpuMove(); }
}

if (resetBtn) { resetBtn.addEventListener('click', resetGame); }

modeSelect.addEventListener('change', (e)=>{
  gameMode = e.target.value;
  const show = gameMode === 'hvc';
  if(cpuColorWrapper) cpuColorWrapper.style.display = show ? 'block' : 'none';
  if(cpuLevelWrapper) cpuLevelWrapper.style.display = show ? 'block' : 'none';
  resetGame();
});
cpuColorSelect.addEventListener('change', ()=>{ cpuPlayer = Number(cpuColorSelect.value); resetGame(); });
cpuLevelSelect.addEventListener('change', ()=>{ cpuLevel = cpuLevelSelect.value; });

// 初期化
initImages().then(()=>{
  // 最初にタイトル画面を表示
  // タイトル画面は HTML によって初期表示されますが、念のためここでも表示制御
  showTitle();
  // タイトル画像を全体表示できるようにする（クリック/Enterで拡大）
  const titleImg = document.getElementById('titleImage');
  if(titleImg){
    titleImg.addEventListener('click', toggleImageFullscreen);
    titleImg.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') toggleImageFullscreen(); });
  }
});

function toggleImageFullscreen(){
  const titleImg = document.getElementById('titleImage');
  if(!titleImg) return;
  // 既に拡大表示があるか
  const existing = document.querySelector('.title-card .img-fullscreen');
  if(existing){ existing.remove(); document.body.style.overflow=''; return; }
  const wrap = document.createElement('div'); wrap.className = 'img-fullscreen';
  const img = document.createElement('img'); img.src = titleImg.src; img.alt = titleImg.alt || '';
  wrap.appendChild(img);
  // どこをタップしても閉じる（モバイルで画像をタップして閉じられない問題を防止）
  const close = ()=>{ if(wrap.parentNode){ wrap.remove(); document.body.style.overflow=''; document.removeEventListener('keydown', escHandler); } };
  wrap.addEventListener('click', close);
  img.addEventListener('click', close);
  document.body.appendChild(wrap);
  document.body.style.overflow='hidden';
  // ESC で閉じる
  const escHandler = (ev)=>{ if(ev.key === 'Escape'){ close(); } };
  document.addEventListener('keydown', escHandler);
}

// タイトル画面要素
const titleScreen = document.getElementById('titleScreen');
const titleStart = document.getElementById('titleStart');
const titleCpuOptions = document.getElementById('titleCpuOptions');
const titleCpuColor = document.getElementById('titleCpuColor');
const titleCpuLevel = document.getElementById('titleCpuLevel');
const gameScreen = document.getElementById('gameScreen');
const backTitleBtn = document.getElementById('backTitleBtn');

function setControlsEnabled(enabled){
  // ゲーム中はモードやCPU設定を変更できないようにする
  modeSelect.disabled = !enabled;
  cpuColorSelect.disabled = !enabled;
  cpuLevelSelect.disabled = !enabled;
  const left = document.querySelector('.controls .left');
  if(left){ left.style.opacity = enabled ? '' : '0.6'; left.style.pointerEvents = enabled ? '' : 'none'; }
}

function showTitle(){
  titleScreen.removeAttribute('hidden');
  // ゲーム画面は隠す
  gameScreen.setAttribute('hidden','');
  // 進行中の CPU 思考を止める
  if(cpuTimeoutId){ clearTimeout(cpuTimeoutId); cpuTimeoutId = null; }
  cpuThinking = false;
  // タイトル表示時はコントロールを有効化
  setControlsEnabled(true);
  // 終了オーバーレイと花火を消す
  window.gameOver = false;
  const overlay = document.getElementById('resultOverlay'); if(overlay) overlay.hidden = true;
  stopFireworks();
  render();
}
function hideTitle(){
  titleScreen.setAttribute('hidden','');
  gameScreen.removeAttribute('hidden');
  // ゲーム表示時はコントロールを無効化（誤操作防止）
  setControlsEnabled(false);
}

// ラジオ切替で CPU オプションを表示
const titleRadios = document.querySelectorAll('input[name="titleMode"]');
titleRadios.forEach(r=> r.addEventListener('change', ()=>{
  titleCpuOptions.style.display = (document.querySelector('input[name="titleMode"]:checked').value === 'hvc') ? 'block' : 'none';
}));
// 初期はラジオの選択に合わせて表示
titleCpuOptions.style.display = (document.querySelector('input[name="titleMode"]:checked').value === 'hvc') ? 'block' : 'none';

// 開始ボタン
titleStart.addEventListener('click', ()=>{
  const mode = document.querySelector('input[name="titleMode"]:checked').value;
  gameMode = mode;
  if(gameMode === 'hvc'){
    cpuPlayer = Number(titleCpuColor.value);
    cpuLevel = titleCpuLevel.value;
    // Sync controls
    modeSelect.value = 'hvc';
    if(cpuColorWrapper) cpuColorWrapper.style.display = 'block';
    if(cpuLevelWrapper) cpuLevelWrapper.style.display = 'block';
    cpuColorSelect.value = titleCpuColor.value;
    cpuLevelSelect.value = titleCpuLevel.value;
  } else {
    cpuPlayer = null;
    modeSelect.value = 'hvh';
    if(cpuColorWrapper) cpuColorWrapper.style.display = 'none';
    if(cpuLevelWrapper) cpuLevelWrapper.style.display = 'none';
  }
  hideTitle();
  resetGame();
});

// グローバル未処理Promiseエラーのログ
window.addEventListener('unhandledrejection',(ev)=>{ console.error('Unhandled promise rejection:', ev.reason); });

// タイトルへ戻るボタン
backTitleBtn.addEventListener('click', ()=>{ showTitle(); });

// --- 結果表示と花火 ---
function showResult(winnerText, winnerColor){
  const overlay = document.getElementById('resultOverlay');
  const textEl = document.getElementById('resultText');
  if(!overlay || !textEl) return;

  let message = '';
  if(winnerColor === 0){
    message = '引き分け';
  } else if(gameMode === 'hvc'){
    // CPU対戦: CPUかプレイヤーかを表示
    if(typeof cpuPlayer === 'number' && winnerColor === cpuPlayer) message = 'CPUの勝ち';
    else message = 'あなたの勝ち';
  } else {
    // 対人戦: 色ベースで表示
    message = (winnerColor === BLACK) ? '黒の勝ち' : '白の勝ち';
  }

  textEl.textContent = `ゲーム終了 — ${message}`;
  overlay.hidden = false;
  // 花火は無効化（念のため停止）
  if(typeof stopFireworks === 'function') stopFireworks();
}
function hideResult(){ const overlay = document.getElementById('resultOverlay'); if(overlay) overlay.hidden = true; stopFireworks(); }

// fireworks implementation
let _fw = {running:false, raf:0, particles:[], ctx:null};
function startFireworks(){
  if(_fw.running) return; _fw.running = true; _fw.particles = [];
  const canvas = document.getElementById('fireworksCanvas'); if(!canvas) return; canvas.hidden = false;
  function resize(){ const d = window.devicePixelRatio || 1; canvas.width = Math.floor(canvas.clientWidth * d); canvas.height = Math.floor(canvas.clientHeight * d); canvas.style.width = '100%'; canvas.style.height = '100%'; _fw.ctx = canvas.getContext('2d'); if(_fw.ctx) _fw.ctx.scale(d,d); }
  resize(); window.addEventListener('resize', resize);
  // immediate burst so user sees fireworks right away
  spawnFirework();
  // particle generator (シンプルで軽量な花火)
  function spawnFirework(){
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    const cx = w/2, cy = h/2; // 中央
    const colors = ['#ff6b6b','#ffd166','#6bcB77','#6ec1ff','#c77cf0','#ff9f43'];
    const count = 25 + Math.floor(Math.random()*20);
    const color = colors[Math.floor(Math.random()*colors.length)];
    for(let i=0;i<count;i++){
      const angle = Math.random()*Math.PI*2;
      const speed = 1 + Math.random()*3;
      const vx = Math.cos(angle)*speed;
      const vy = Math.sin(angle)*speed - (0.5 + Math.random()*1.0);
      const size = 1 + Math.random()*2.5;
      const life = 30 + Math.floor(Math.random()*40);
      _fw.particles.push({x:cx,y:cy,vx:vx,vy:vy,life:life,age:0,color:color,size:size});
    }
  }
  let ticks=0;
  function step(){
    _fw.raf = requestAnimationFrame(step);
    const ctx = _fw.ctx; if(!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // 軽いフェード（残像は控えめ）
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0,0,w,h);

    // 低頻度で爆発
    if(Math.random() < 0.06) spawnFirework();

    for(let i=_fw.particles.length-1;i>=0;i--){
      const p = _fw.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.04; p.vx *= 0.995; p.vy *= 0.999; p.age++;
      const t = p.age / p.life; if(t>1){ _fw.particles.splice(i,1); continue; }
      const alpha = (1 - t) * 0.95;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y, Math.max(0.6, p.size*(1 - t*0.7)), 0, Math.PI*2); ctx.fill();
    }

    ctx.globalAlpha = 1;
    ticks++; if(!_fw.running && _fw.particles.length===0){ cancelAnimationFrame(_fw.raf); canvas.hidden = true; }
  }
  step();
  // safety: stop after 4s (軽量化のため短めに設定)
  setTimeout(()=>{ stopFireworks(); }, 4000);
}
function stopFireworks(){ if(!_fw.running) return; _fw.running=false; if(_fw.raf) cancelAnimationFrame(_fw.raf); _fw.particles=[]; const canvas=document.getElementById('fireworksCanvas'); if(canvas){ canvas.hidden = true; const ctx = canvas.getContext('2d'); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); }}

// overlay buttons
const repeatBtn = document.getElementById('repeatBtn'); if(repeatBtn){ repeatBtn.addEventListener('click', ()=>{ hideResult(); resetGame(); }); }
const toTitleBtn = document.getElementById('toTitleBtn'); if(toTitleBtn){ toTitleBtn.addEventListener('click', ()=>{ hideResult(); showTitle(); }); }

// --- /結果表示と花火 ---
