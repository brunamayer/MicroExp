/* Transplante de Microexpressões — p5.js
   Autor: (você)
   Estrutura: modos "calibration", "swap", "record"
   Vídeo A por cima; onde A se mexe, mostramos B por baixo.
   Detecção em baixa resolução + aplicação por blocos em alta.
*/

let MODE = "calibration"; // "calibration" | "swap" | "record"

let THRESHOLD = 30;     // diferença mínima para considerar movimento (0–765 se RGB soma)
let SCALE = 0.25;       // razão da detecção (0.5, 0.25, 0.125…)
let CELL = 16;          // tamanho do bloco (px) na tela final
let BLUR_RADIUS = 1;    // 0 desliga; 1–2 recomendado para suavizar diferença
let DILATE_ITERS = 0;   // 0–2
let ERODE_ITERS = 0;    // 0–2
let ALPHA_SMOOTH = 0.6; // 0–1 (suavização temporal da máscara)

const SCALE_STEPS = [0.125, 0.25, 0.5];
let scaleIndex = SCALE_STEPS.indexOf(SCALE);
if (scaleIndex < 0) scaleIndex = 1;

let videoA, videoB;
let w = 1280, h = 720; // canvas alvo; ajuste conforme seus vídeos

// buffers
let gFull;      // buffer full-res para compor (opcional; podemos desenhar direto no canvas)
let gRed;       // baixa resolução para detecção
let prevFrame;  // pixels do frame anterior (em baixa)
let diffBuff;   // diferença (em baixa), escala 0–255 (acumulada ou média)
let maskRed;    // máscara binária/float (em baixa)
let maskPrev;   // para suavização temporal (em baixa)

let started = false;

function preload() {
  // Nada a carregar via preload; os vídeos serão criados em setup.
}

function setup() {
  const cnv = createCanvas(w, h);
  cnv.parent(document.getElementById("app"));
  pixelDensity(1);

  // buffers
  gFull = createGraphics(w, h);
  gRed = createGraphics(floor(w * SCALE), floor(h * SCALE));
  gRed.pixelDensity(1);

  // arrays auxiliares (em baixa)
  const redW = gRed.width, redH = gRed.height;
  prevFrame = new Uint8ClampedArray(redW * redH * 4);
  diffBuff  = new Float32Array(redW * redH); // diferença em escala cinza (0–255)
  maskRed   = new Float32Array(redW * redH); // 0..1
  maskPrev  = new Float32Array(redW * redH); // para suavização temporal

  // criar vídeos
  videoA = createVideo(["videoA.mp4"], () => { /* loaded */ });
  videoB = createVideo(["videoB.mp4"], () => { /* loaded */ });

  // ajustes para permitir autoplay quando iniciado por gesto:
  [videoA, videoB].forEach(v => {
    v.size(w, h);
    v.elt.muted = true; // necessário para autoplay sem interação adicional
    v.volume(0);
    v.hide(); // vamos desenhar manualmente com image()
    v.loop();
    v.stop(); // aguardamos o clique para iniciar
  });

  // gate (gesto do usuário)
  const startBtn = document.getElementById("startBtn");
  startBtn.addEventListener("click", () => {
    started = true;
    document.getElementById("gate").style.display = "none";
    [videoA, videoB].forEach(v => v.play());
  });

  frameRate(60);
}

function draw() {
  background(8);

  if (!started) {
    // tela de espera (o overlay já cobre, mas mostramos algo de fundo)
    noStroke();
    fill(200);
    textAlign(CENTER, CENTER);
    text("Clique em Iniciar para começar", width/2, height/2);
    return;
  }

  // 1) desenhar A em full
  gFull.image(videoA, 0, 0, w, h);

  // 2) DETECÇÃO em baixa: comparar frame atual de A (reduzido) com frame anterior
  computeMotionMask();

  // 3) COMPOSIÇÃO por blocos: onde mask indica movimento, desenhar B
  composeWithBlocks();

  // 4) Render final
  image(gFull, 0, 0);

  // 5) HUD / visualização de calibração
  drawHUD();
  if (MODE === "calibration") {
    visualizeMaskOverlay();
  }
}

/* ------------------------------------------
   Detecção de movimento (baixa resolução)
-------------------------------------------*/
function computeMotionMask() {
  const redW = gRed.width, redH = gRed.height;

  // desenhar vídeo A no buffer reduzido
  gRed.push();
  gRed.clear();
  gRed.image(videoA, 0, 0, redW, redH);
  gRed.pop();

  gRed.loadPixels();
  const curr = gRed.pixels;

  // calcular diferença por pixel (magnitude RGB simples ou luminância)
  // aqui: soma das diferenças absolutas dos canais (0..765), depois normalizada para 0..255
  for (let i = 0, j = 0; i < curr.length; i += 4, j++) {
    const r = curr[i], g = curr[i+1], b = curr[i+2];
    const pr = prevFrame[i], pg = prevFrame[i+1], pb = prevFrame[i+2];

    let dr = Math.abs(r - pr);
    let dg = Math.abs(g - pg);
    let db = Math.abs(b - pb);
    let diff = dr + dg + db;      // 0..765
    diff = (diff / 765) * 255.0;  // 0..255
    diffBuff[j] = diff;

    // preparar prev para próxima rodada
    prevFrame[i] = r;
    prevFrame[i+1] = g;
    prevFrame[i+2] = b;
    prevFrame[i+3] = 255;
  }

  // opcional: BLUR
  if (BLUR_RADIUS > 0) {
    boxBlurGray(diffBuff, redW, redH, BLUR_RADIUS);
  }

  // THRESHOLD para máscara binária provisória
  const thr255 = mapThresholdTo255(THRESHOLD); // THRESHOLD pensado em 0..255 já; mantemos função por clareza
  for (let j = 0; j < diffBuff.length; j++) {
    maskRed[j] = diffBuff[j] >= thr255 ? 1 : 0;
  }

  // MORFOLÓGICO (dilate/erode) em máscara binária
  if (DILATE_ITERS > 0) {
    morph(maskRed, redW, redH, DILATE_ITERS, true);
  }
  if (ERODE_ITERS > 0) {
    morph(maskRed, redW, redH, ERODE_ITERS, false);
  }

  // SUAVIZAÇÃO TEMPORAL (exponencial) + re-threshold
  if (ALPHA_SMOOTH > 0) {
    const a = ALPHA_SMOOTH;
    for (let j = 0; j < maskRed.length; j++) {
      const sm = a * maskRed[j] + (1 - a) * maskPrev[j];
      maskPrev[j] = sm;
      maskRed[j]  = sm >= 0.5 ? 1 : 0; // re-threshold
    }
  } else {
    // se sem suavização, sync maskPrev pra futura rodada
    for (let j = 0; j < maskRed.length; j++) maskPrev[j] = maskRed[j];
  }
}

function mapThresholdTo255(t) {
  // aqui já usamos t em 0..255 (coerente com diffBuff pós-normalização)
  return constrain(t, 0, 255);
}

/* Box blur simples em array escala cinza (float 0..255) */
function boxBlurGray(src, w, h, radius) {
  // horizontal
  const tmp = new Float32Array(src.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    let idx = y * w;
    for (let x = 0; x < w; x++) {
      // janela [x - radius, x + radius]
      // entrada à direita
      const xr = min(w - 1, x + radius);
      const xl = max(0, x - radius - 1);
      if (x === 0) {
        // inicializa somatório
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

/* Dilatação/Erosão binária (4-vizinhos) em iterações */
function morph(mask, w, h, iters, isDilate) {
  const out = new Float32Array(mask.length);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (isDilate) {
          let v = mask[i];
          if (v === 1) { out[i] = 1; continue; }
          // 4-neighbours
          if (x > 0 && mask[i - 1] === 1) { out[i] = 1; continue; }
          if (x < w - 1 && mask[i + 1] === 1) { out[i] = 1; continue; }
          if (y > 0 && mask[i - w] === 1) { out[i] = 1; continue; }
          if (y < h - 1 && mask[i + w] === 1) { out[i] = 1; continue; }
          out[i] = 0;
        } else {
          // erode
          let v = mask[i];
          if (v === 0) { out[i] = 0; continue; }
          // se qualquer vizinho for 0, vira 0
          if (x > 0 && mask[i - 1] === 0) { out[i] = 0; continue; }
          if (x < w - 1 && mask[i + 1] === 0) { out[i] = 0; continue; }
          if (y > 0 && mask[i - w] === 0) { out[i] = 0; continue; }
          if (y < h - 1 && mask[i + w] === 0) { out[i] = 0; continue; }
          out[i] = 1;
        }
      }
    }
    // copia out -> mask
    mask.set(out);
  }
}

/* ------------------------------------------
   Composição por blocos (full-res)
-------------------------------------------*/
function composeWithBlocks() {
  // desenhar B por cima de A onde houver movimento em A
  const redW = gRed.width, redH = gRed.height;

  // mapeamento: cada bloco CELLxCELL da tela corresponde a um pixel da maskRed ampliado
  // melhor ainda: calcular quantos blocos temos:
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);

  // índices na máscara: escalonamos cols/rows para redW/redH
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const dx = bx * CELL;
      const dy = by * CELL;
      const dw = (dx + CELL <= width) ? CELL : (width - dx);
      const dh = (dy + CELL <= height) ? CELL : (height - dy);

      // posição correspondente na máscara reduzida
      const mx = Math.floor(map(bx + 0.5, 0, cols, 0, redW));
      const my = Math.floor(map(by + 0.5, 0, rows, 0, redH));
      const mi = my * redW + mx;
      const active = maskRed[mi] >= 0.5;

      if (MODE === "calibration") {
        // composição só se quisermos testar já, mas a visualização vem separada
        if (active) {
          gFull.image(videoB, dx, dy, dw, dh, dx, dy, dw, dh);
        }
      } else {
        // swap/record — substituição real
        if (active) {
          gFull.image(videoB, dx, dy, dw, dh, dx, dy, dw, dh);
        }
      }
    }
  }
}

/* ------------------------------------------
   HUD e visualização
-------------------------------------------*/
function drawHUD() {
  const pad = 10;
  const lines = [
    `MODE: ${MODE}`,
    `THRESHOLD: ${THRESHOLD}`,
    `SCALE: ${SCALE} (detecção ${gRed.width}×${gRed.height})`,
    `CELL: ${CELL}px`,
    `BLUR_RADIUS: ${BLUR_RADIUS}`,
    `DILATE: ${DILATE_ITERS} • ERODE: ${ERODE_ITERS}`,
    `ALPHA_SMOOTH: ${ALPHA_SMOOTH.toFixed(2)}`,
    `FPS: ${nf(frameRate(),2,1)}`
  ];
  noStroke();
  fill(0, 140);
  rect(pad-4, pad-4, 320, lines.length * 18 + 10, 8);
  fill(255);
  textSize(12);
  textAlign(LEFT, TOP);
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], pad, pad + i * 18);
  }
}

function visualizeMaskOverlay() {
  // desenha uma camada por cima indicando onde a máscara está ativa
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);

  noStroke();
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const dx = bx * CELL;
      const dy = by * CELL;
      const dw = (dx + CELL <= width) ? CELL : (width - dx);
      const dh = (dy + CELL <= height) ? CELL : (height - dy);

      // posição correspondente na máscara reduzida
      const mx = Math.floor(map(bx + 0.5, 0, cols, 0, gRed.width));
      const my = Math.floor(map(by + 0.5, 0, rows, 0, gRed.height));
      const mi = my * gRed.width + mx;
      const active = maskRed[mi] >= 0.5;

      if (active) {
        fill(255, 60, 0, 110); // laranja translúcido
        rect(dx, dy, dw, dh);
      }
    }
  }
}

/* ------------------------------------------
   Controles
-------------------------------------------*/
function keyPressed() {
  if (key === 'C' || key === 'c') {
    if (MODE === "calibration") MODE = "swap";
    else if (MODE === "swap") MODE = "record";
    else MODE = "calibration";
  }
  if (key === '1') THRESHOLD = max(0, THRESHOLD - 5);
  if (key === '2') THRESHOLD = min(255, THRESHOLD + 5);
  if (key === '3') CELL = max(4, CELL - 2);
  if (key === '4') CELL = min(128, CELL + 2);

  if (key === '5') {
    scaleIndex = max(0, scaleIndex - 1);
    SCALE = SCALE_STEPS[scaleIndex];
    resizeDetectionBuffers();
  }
  if (key === '6') {
    scaleIndex = min(SCALE_STEPS.length - 1, scaleIndex + 1);
    SCALE = SCALE_STEPS[scaleIndex];
    resizeDetectionBuffers();
  }

  if (key === 'B' || key === 'b') {
    BLUR_RADIUS = (BLUR_RADIUS + 1) % 3; // 0 -> 1 -> 2 -> 0
  }
  if (key === 'D' || key === 'd') {
    DILATE_ITERS = (DILATE_ITERS + 1) % 3; // 0..2
  }
  if (key === 'E' || key === 'e') {
    ERODE_ITERS = (ERODE_ITERS + 1) % 3;
  }
  if (key === '7') {
    ALPHA_SMOOTH = max(0, ALPHA_SMOOTH - 0.1);
  }
  if (key === '8') {
    ALPHA_SMOOTH = min(1, ALPHA_SMOOTH + 0.1);
  }
}

function resizeDetectionBuffers() {
  gRed = createGraphics(floor(w * SCALE), floor(h * SCALE));
  gRed.pixelDensity(1);
  const redW = gRed.width, redH = gRed.height;
  prevFrame = new Uint8ClampedArray(redW * redH * 4);
  diffBuff  = new Float32Array(redW * redH);
  maskRed   = new Float32Array(redW * redH);
  maskPrev  = new Float32Array(redW * redH);
}

/* ------------------------------------------
   Observações:
   - Para gravar o resultado por enquanto, use gravador de tela.
   - Depois é simples plugar CCapture.js/MediaRecorder no MODE "record".
-------------------------------------------*/
