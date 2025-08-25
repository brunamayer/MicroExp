// Microexpressões — v3 simples (P&B) com gating + enquadramento + persistência de movimento
// Sem blur, sem alpha, sem UI de ajuste.
// Onde houver movimento em A (comparando atual vs anterior em cinza), mostramos B por alguns frames.

// ==== AJUSTES RÁPIDOS ====
const THRESHOLD   = 10;  // 0..255: sensibilidade do movimento (↑ = menos sensível)
const HOLD_FRAMES = 10;  // quantos frames cada pixel permanece “abrindo” B após disparo

// Tamanho fixo (mantém simples e performático)
const W = 640, H = 480;

// Vídeos locais (para fallback de A e para B)
const VIDEO_POOL = [
  "Rosto1.mov",
  "Rosto2.mov",
];

let phase = "gate"; // "gate" → "frame" → "swap"

let A = null;       // p5.MediaElement (câmera ou vídeo fallback)
let B = null;       // p5.MediaElement (vídeo sorteado)
let usingFallbackA = false;

let gA, gB;         // buffers W×H
let prevGrayA;      // luminância anterior de A
let holdMap;        // frames restantes de “abertura” de B por pixel

function setup(){
  const cnv = createCanvas(W, H);
  cnv.parent(document.getElementById('app'));
  pixelDensity(1);
  frameRate(60);

  gA = createGraphics(W, H); gA.pixelDensity(1);
  gB = createGraphics(W, H); gB.pixelDensity(1);

  prevGrayA = new Uint8ClampedArray(W * H);
  holdMap   = new Uint16Array(W * H);

  // Gate listeners
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', onStart);
  const okFrameBtn = document.getElementById('okFrameBtn');
  if (okFrameBtn) okFrameBtn.addEventListener('click', onOkFrame);
}

function onStart(){
  const consent = document.getElementById('consent');
  if (!consent || !consent.checked) return;

  // Fecha gate, abre enquadramento
  const gate = document.getElementById('gate');
  if (gate) gate.style.display = 'none';
  const frameUI = document.getElementById('frameUI');
  if (frameUI) frameUI.style.display = '';

  phase = "frame";

  // Inicia A (câmera com fallback) e prepara B (vídeo sorteado)
  tryStartCameraThenFallback();

  B = createVideo([ pickRandom(VIDEO_POOL) ]);
  prepVideo(B);
  B.loop();
}

function onOkFrame(){
  const frameUI = document.getElementById('frameUI');
  if (frameUI) frameUI.style.display = 'none';
  phase = "swap";
}

function tryStartCameraThenFallback(){
  let resolved = false;
  usingFallbackA = false;

  A = createCapture(
    { video:{ facingMode:"user", width:{ideal:1280}, height:{ideal:720} }, audio:false },
    () => {}
  );
  A.size(W,H);
  A.hide();
  A.elt.playsInline = true;

  const onReady = () => { if(resolved) return; resolved = true; usingFallbackA = false; };
  const onError = () => { /* timeout decide */ };
  A.elt.addEventListener('loadeddata', onReady, { once:true });
  A.elt.addEventListener('error', onError, { once:true });

  // Se não ficar pronto logo, usa fallback local
  setTimeout(() => {
    if (resolved) return;
    usingFallbackA = true;
    safeRemove(A);
    A = createVideo([ pickRandom(VIDEO_POOL) ]);
    prepVideo(A);
    A.loop();
  }, 2200);
}

function prepVideo(v){
  v.size(W,H);
  v.elt.muted = true;
  v.volume(0);
  v.elt.playsInline = true;
  v.hide();
}

function draw(){
  background(0);

  if (phase === "gate") {
    // Tela do gate está por cima; nada a fazer no canvas
    return;
  }

  if (!A) {
    drawLoading("inicializando vídeo A…");
    return;
  }

  // desenha A no buffer
  gA.image(A, 0, 0, W, H);

  if (phase === "frame") {
    // só mostra A em P&B para o enquadramento
    gA.loadPixels();
    imageGrayscale(gA.pixels);
    return;
  }

  if (phase === "swap") {
    if (!B) {
      drawLoading("carregando vídeo B…");
      return;
    }
    // desenha B no buffer
    gB.image(B, 0, 0, W, H);

    // carrega pixels
    gA.loadPixels();
    gB.loadPixels();
    loadPixels();

    const ap = gA.pixels;
    const bp = gB.pixels;
    const out = pixels;

    // loop em todos os pixels
    for (let y=0, i=0, idx=0; y<H; y++){
      for (let x=0; x<W; x++, i++, idx+=4){
        const rA = ap[idx], gApx = ap[idx+1], bA = ap[idx+2];
        const rB = bp[idx], gBpx = bp[idx+1], bB = bp[idx+2];

        // luminâncias
        const grayA = (0.2126*rA + 0.7152*gApx + 0.0722*bA) | 0;
        const grayB = (0.2126*rB + 0.7152*gBpx + 0.0722*bB) | 0;

        // detecção simples
        const diff = Math.abs(grayA - prevGrayA[i]);
        if (diff > THRESHOLD) {
          holdMap[i] = HOLD_FRAMES;     // dispara/renova a persistência
        } else if (holdMap[i] > 0) {
          holdMap[i]--;                  // decai ao longo dos frames
        }

        // escolhe origem: B quando persistindo; caso contrário, A
        const g = (holdMap[i] > 0) ? grayB : grayA;

        out[idx] = out[idx+1] = out[idx+2] = g;
        out[idx+3] = 255;

        prevGrayA[i] = grayA;           // atualiza histórico
      }
    }

    updatePixels();
  }
}

// Utilitários
function imageGrayscale(srcPixels){
  loadPixels();
  const dst = pixels;
  for (let idx=0; idx<srcPixels.length; idx+=4){
    const r=srcPixels[idx], g=srcPixels[idx+1], b=srcPixels[idx+2];
    const gray = (0.2126*r + 0.7152*g + 0.0722*b) | 0;
    dst[idx]=dst[idx+1]=dst[idx+2]=gray; dst[idx+3]=255;
  }
  updatePixels();
}

function drawLoading(msg){
  push();
  noStroke(); fill(255); textAlign(CENTER, CENTER); textSize(14);
  text((msg||"carregando…")+"\n(HTTPS/localhost p/ câmera; use movie/Rosto*.mp4 p/ fallback)", W/2, H/2);
  pop();
}

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function safeRemove(m){ try{ m.remove(); }catch(e){} }
