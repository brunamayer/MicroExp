/* v3 simples — sem detecção de face
   Fases:
   1) Gate/consentimento
   2) Enquadramento: mostra quadrado guia, usuário ajusta e toca OK
   3) Swap: compara A(t) vs A(t-1); onde há movimento, revela B (sorteado)
   Máscara suave (blur + smoothstep) e “pixels” pequenos (CELL)
*/

// ========================
// 🔧 PARÂMETROS (ajuste livre)
// ========================
let SCALE = 0.20;            // resolução da análise (0.125–0.5)
let CELL  = 4;               // tamanho do bloco “pixel” (2–12) — menor = mais detalhe
let THRESHOLD = 28;          // sensibilidade de movimento (0–255)
let MASK_BLUR_RADIUS = 2;    // blur do mapa de diferença (0–3)
let ALPHA_SMOOTH = 0.5;      // suavização temporal do alfa (0–1)
let EDGE_SOFTNESS = 24;      // largura da transição (smoothstep) em “níveis de cinza”

const DEV_HUD = window.location.search.includes('dev=1');

// ========================
// 🎥 VÍDEOS
// ========================
// Liste aqui os arquivos existentes em ./movie/
const VIDEO_B_LIST = [
  "Rosto1.mov",
  "Rosto2.mov",
  // adicione mais aqui…
];

// Estado
let phase = "gate"; // "gate" → "frame" → "swap"

// Canvas & buffers
let w, h;
let gFull, gRed, gB;

// Vídeos
let camA = null;
let videoB = null;

// Buffers (baixa)
let prevFrame, diffBuff, alphaBuff, alphaPrev;

// ======= Setup p5 =======
function setup() {
  w = windowWidth; h = windowHeight;
  const cnv = createCanvas(w, h);
  cnv.parent(document.getElementById('app'));
  pixelDensity(1);

  // Buffers gráficos
  gFull = createGraphics(w, h);      gFull.pixelDensity(1);
  gB    = createGraphics(w, h);      gB.pixelDensity(1);
  gRed  = createGraphics(floor(w * SCALE), floor(h * SCALE)); gRed.pixelDensity(1);

  initLowResBuffers();

  // UI botões
  const startBtn = document.getElementById('startBtn');
  startBtn.addEventListener('click', onStartConsent);

  const okFrameBtn = document.getElementById('okFrameBtn');
  okFrameBtn.addEventListener('click', onOkFraming);

  frameRate(60);
}

function initLowResBuffers() {
  const redW = gRed.width, redH = gRed.height;
  prevFrame = new Uint8ClampedArray(redW * redH * 4);
  diffBuff  = new Float32Array(redW * redH);
  alphaBuff = new Float32Array(redW * redH);
  alphaPrev = new Float32Array(redW * redH);
}

function windowResized() {
  w = windowWidth; h = windowHeight;
  resizeCanvas(w, h);
  gFull = createGraphics(w, h); gFull.pixelDensity(1);
  gB    = createGraphics(w, h); gB.pixelDensity(1);

  gRed  = createGraphics(floor(w * SCALE), floor(h * SCALE)); gRed.pixelDensity(1);
  initLowResBuffers();

  if (camA) camA.size(w, h);
  if (videoB) videoB.size(w, h);
}

// ======= Fase 1: consentimento → cria câmera e vai para “frame” =======
function onStartConsent() {
  const consent = document.getElementById('consent');
  if (!consent.checked) return;

  // esconde gate
  document.getElementById('gate').style.display = 'none';

  // cria câmera frontal
  const constraints = {
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  };
  camA = createCapture(constraints, () => {});
  camA.size(w, h);
  camA.hide();
  camA.elt.playsInline = true;

  // mostra UI de enquadramento
  document.getElementById('frameUI').style.display = '';
  phase = "frame";
}

// ======= Fase 2: usuário toca OK → sorteia B e entra em “swap” =======
function onOkFraming() {
  document.getElementById('frameUI').style.display = 'none';

  // sorteia um vídeo B
  const valid = VIDEO_B_LIST.filter(Boolean);
  const chosen = valid[Math.floor(Math.random() * valid.length)];
  videoB = createVideo([chosen]);
  videoB.size(w, h);
  videoB.elt.muted = true;
  videoB.elt.playsInline = true;
  videoB.volume(0);
  videoB.hide();
  videoB.elt.addEventListener('error', (e) => {
    console.warn('[Vídeo B] erro de carregamento (404/CORS?):', e);
  });

  try { videoB.elt.currentTime = 0; } catch(e){}
  videoB.loop();

  phase = "swap";
}

// ======= Loop =======
function draw() {
  background(10);

  if (phase === "gate") {
    // tela coberta pelo overlay
    return;
  }

  if (!camA) {
    fill(220); noStroke(); textAlign(CENTER, CENTER);
    text("inicializando câmera…", width/2, height/2);
    return;
  }

  // render base: câmera cheia
  gFull.image(camA, 0, 0, w, h);

  if (phase === "frame") {
    // apenas mostra a câmera (overlay do quadrado é HTML/CSS)
    image(gFull, 0, 0);
    return;
  }

  if (phase === "swap") {
    // 1) prepara B (preenche tela; sem alinhamento)
    if (videoB) {
      gB.clear();
      gB.image(videoB, 0, 0, w, h);
    }

    // 2) detecção de movimento em baixa (camA) → alphaBuff [0..1] suave
    computeMotionAlpha();

    // 3) composição por blocos: mistura B sobre A com alfa local
    composeWithBlocks(gB);

    // 4) output
    image(gFull, 0, 0);

    if (DEV_HUD) drawHUD();
  }
}

// ======= Diferença + máscara suave =======
function computeMotionAlpha() {
  const redW = gRed.width, redH = gRed.height;

  // desenha câmera reduzida e lê pixels
  gRed.clear();
  gRed.image(camA, 0, 0, redW, redH);
  gRed.loadPixels();
  const curr = gRed.pixels;

  // 1) diferença RGB acumulada → 0..255
  for (let i = 0, j = 0; i < curr.length; i += 4, j++) {
    const r = curr[i], g = curr[i+1], b = curr[i+2];
    const pr = prevFrame[i], pg = prevFrame[i+1], pb = prevFrame[i+2];

    let diff = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb); // 0..765
    diff = (diff / 765) * 255.0;
    diffBuff[j] = diff;

    prevFrame[i]   = r;
    prevFrame[i+1] = g;
    prevFrame[i+2] = b;
    prevFrame[i+3] = 255;
  }

  // 2) blur opcional no mapa de diferença (suaviza ruído)
  if (MASK_BLUR_RADIUS > 0) boxBlurGray(diffBuff, redW, redH, MASK_BLUR_RADIUS);

  // 3) converte diferença em alfa suave usando “smoothstep” em torno do THRESHOLD
  const t0 = Math.max(0, THRESHOLD - EDGE_SOFTNESS/2);
  const t1 = Math.min(255, THRESHOLD + EDGE_SOFTNESS/2);

  for (let j = 0; j < diffBuff.length; j++) {
    const d = diffBuff[j];
    const a = smoothstep(t0, t1, d); // 0..1
    alphaBuff[j] = a;
  }

  // 4) suavização temporal (amortece flicker)
  if (ALPHA_SMOOTH > 0) {
    const k = ALPHA_SMOOTH;
    for (let j = 0; j < alphaBuff.length; j++) {
      const s = k * alphaBuff[j] + (1 - k) * alphaPrev[j];
      alphaPrev[j] = s;
      alphaBuff[j] = s;
    }
  } else {
    for (let j = 0; j < alphaBuff.length; j++) alphaPrev[j] = alphaBuff[j];
  }
}

function smoothstep(edge0, edge1, x) {
  const t = constrain((x - edge0) / Math.max(1e-6, (edge1 - edge0)), 0, 1);
  return t * t * (3 - 2 * t);
}

// ======= Composição por blocos (pequenos) =======
function composeWithBlocks(srcB) {
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const redW = gRed.width, redH = gRed.height;

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const dx = bx * CELL;
      const dy = by * CELL;
      const dw = (dx + CELL <= width) ? CELL : (width - dx);
      const dh = (dy + CELL <= height) ? CELL : (height - dy);

      // amostra alfa da célula (coordenadas em baixa)
      const mx = Math.floor(map(bx + 0.5, 0, cols, 0, redW));
      const my = Math.floor(map(by + 0.5, 0, rows, 0, redH));
      const mi = my * redW + mx;
      const a = alphaBuff[mi]; // 0..1

      if (a <= 0.001) continue;

      // desenha bloco B por cima com “tint” proporcional ao alfa
      push();
      // p5.tint é global à próxima image — aplica bem em blocos pequenos
      tint(255, Math.floor(a * 255));
      gFull.image(srcB, dx, dy, dw, dh, dx, dy, dw, dh);
      pop();
    }
  }
}

// ======= Blur caixa (cinza) =======
function boxBlurGray(src, w, h, radius) {
  const tmp = new Float32Array(src.length);
  const size = radius * 2 + 1;

  // horizontal
  for (let y = 0; y < h; y++) {
    let acc = 0, idx = y * w;
    for (let x = 0; x < w; x++) {
      const xr = min(w - 1, x + radius);
      const xl = max(0, x - radius - 1);
      if (x === 0) {
        acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xi = constrain(x + k, 0, w - 1);
          acc += src[idx + xi];
        }
      } else {
        acc += src[idx + xr] - src[idx + xl];
      }
      tmp[idx + x] = acc / size;
    }
  }

  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y < h; y++) {
      const yr = min(h - 1, y + radius);
      const yl = max(0, y - radius - 1);
      if (y === 0) {
        acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const yi = constrain(y + k, 0, h - 1);
          acc += tmp[yi * w + x];
        }
      } else {
        acc += tmp[yr * w + x] - tmp[yl * w + x];
      }
      src[y * w + x] = acc / size;
    }
  }
}

// ======= HUD DEV opcional =======
function drawHUD() {
  const lines = [
    `SCALE: ${SCALE} (detecção: ${gRed.width}×${gRed.height})`,
    `CELL: ${CELL}px`,
    `THRESHOLD: ${THRESHOLD}  BLUR:${MASK_BLUR_RADIUS}  EDGE:${EDGE_SOFTNESS}`,
    `ALPHA_SMOOTH: ${ALPHA_SMOOTH.toFixed(2)}`,
    `B carregado: ${!!videoB}`,
    `FPS: ${nf(frameRate(),2,1)}`
  ];
  noStroke();
  fill(0, 160);
  rect(8, 8, 360, lines.length * 16 + 12, 8);
  fill(255);
  textSize(12);
  textAlign(LEFT, TOP);
  for (let i = 0; i < lines.length; i++) text(lines[i], 12, 12 + i * 16);
}
