# Transplante de Microexpressões com p5.js

## Objetivo

Compor dois vídeos (**A** por cima, **B** por baixo) de modo que, sempre que houver **movimento detectado** no vídeo A, a área correspondente seja **substituída** pelo vídeo B. A intenção é expor microexpressões de um rosto (B) nas regiões onde o outro rosto (A) apresenta variações sutis.

## Arquivos

* `index.html`: carrega p5.js e o sketch.
* `sketch.js`: implementação dos modos, detecção e composição.
* Vídeos na mesma pasta:

  * `videoA.mp4` (camada superior)
  * `videoB.mp4` (camada inferior)

## Como executar

1. Coloque `index.html`, `sketch.js`, `videoA.mp4` e `videoB.mp4` na mesma pasta.
2. Abra a pasta no VS Code e rode um servidor simples (ex.: **Live Server**).
3. Acesse o endereço local e clique em **Iniciar** na página (gesto necessário para autoplay).
4. Ajuste parâmetros com os atalhos do teclado (ver **Controles**).

## Fluxo lógico (resumo)

1. **Leitura (baixa resolução):** desenhar o frame atual de **A** em um buffer reduzido (`SCALE`), mantendo o frame anterior.
2. **Diferença:** calcular a diferença por pixel entre frame atual e anterior (A atual vs. A anterior), produzindo um mapa de diferenças (0–255).
3. **Pós-processamento (opcional):**

   * **Blur** (desfoque) para suavizar ruído.
   * **Dilate/Erode** para fechar/abrir regiões na máscara binária.
   * **Suavização temporal** (média exponencial) para reduzir cintilação.
4. **Threshold:** gerar uma **máscara binária** (0/1) indicando onde a diferença excede `THRESHOLD`.
5. **Composição (alta resolução):** renderizar **A** em tela cheia e, **por blocos** (`CELL`), onde a máscara indica movimento, desenhar **B** por cima (substituição total do bloco).
6. **Modos:**

   * `calibration`: exibe A + sobreposição da máscara para ajuste fino.
   * `swap`: aplica a substituição (B onde há movimento em A).
   * `record`: igual ao `swap`; inicialmente recomenda-se gravar a tela.

## Parâmetros principais

* `MODE`: `"calibration" | "swap" | "record"`
* `THRESHOLD`: `0–255` — sensibilidade do movimento (maior = exige mudanças maiores).
* `SCALE`: `0.125 | 0.25 | 0.5` — razão da detecção (menor = mais leve, menos preciso).
* `CELL`: tamanho do bloco de substituição (px) — maior = mais leve, menos detalhado.
* `BLUR_RADIUS`: `0 | 1 | 2` — suaviza o mapa de diferenças antes do threshold.
* `DILATE_ITERS`, `ERODE_ITERS`: `0–2` — operações morfológicas na máscara binária.
* `ALPHA_SMOOTH`: `0–1` — suavização temporal da máscara (reduz flicker).

## Controles de teclado

| Tecla     | Ação                                                     |
| --------- | -------------------------------------------------------- |
| `C`       | Alterna `MODE` (`calibration` → `swap` → `record`)       |
| `1` / `2` | Diminui / aumenta `THRESHOLD`                            |
| `3` / `4` | Diminui / aumenta `CELL`                                 |
| `5` / `6` | Diminui / aumenta `SCALE` (troca entre 0.125, 0.25, 0.5) |
| `B`       | Alterna `BLUR_RADIUS` entre 0, 1 e 2                     |
| `D` / `E` | Ajusta `DILATE_ITERS` / `ERODE_ITERS` (0–2)              |
| `7` / `8` | Diminui / aumenta `ALPHA_SMOOTH`                         |

## Desempenho (racional)

* **Detecção em baixa** (`SCALE`) torna o cálculo de diferenças muito mais leve.
* **Composição por blocos** (`CELL`) evita manipulação pixel a pixel em full-HD, usando poucas chamadas `image()` regionais.
* **BLUR/DILATE/ERODE** mitigam ruído e bordas serrilhadas.
* **ALPHA\_SMOOTH** reduz cintilação entre frames.

## Saída

* **Renderização em tela** por padrão.
* **Gravação** (fase inicial): use gravador de tela (OBS/QuickTime).
* **Evolução:** integrar `MediaRecorder`/`CCapture.js` no `MODE="record"` para exportar WebM/MP4 direto do navegador.

## Alinhamento e enquadramento

* Pressupõe **mesma resolução** e **enquadramento similar** entre A e B.
* **Futuro:** restringir a máscara à região do rosto (detector de face/landmarks) e aplicar **warping por malha** para alinhar microzonas (olhos/boca).

## Sobre `lerpColor` (mistura futura)

* `lerpColor(c1, c2, t)` mistura duas cores com `t ∈ [0,1]` (`t=0` → `c1`; `t=1` → `c2`).
* Para microexpressões, pode-se usar a **força de movimento** (valor contínuo em vez de máscara binária) como `t`, obtendo **blend proporcional** entre A e B.
* **Integração futura:** substituir a composição por blocos por uma passagem por pixel (ou shader) onde `t = clamp((diff - THRESHOLD) / faixa, 0, 1)` e a cor final é `lerpColor(cA, cB, t)`.

  * **Observação:** CPU puro em 1080p é pesado; com **WebGL/shaders** fica leve.

## Boas práticas de calibração

1. Comece em `MODE="calibration"`.
2. Ajuste `THRESHOLD` até que só microáreas de expressão ativem a máscara.
3. Use `BLUR_RADIUS` pequeno (1 ou 2) e, se necessário, 1 iteração de `DILATE` para fechar buraquinhos.
4. Ajuste `CELL` conforme o detalhe desejado (8–16 costuma funcionar bem).
5. Se houver cintilação, aumente `ALPHA_SMOOTH`.

## Limitações conhecidas

* Variações de iluminação podem gerar falsos positivos — ajuste `THRESHOLD` e use `BLUR`.
* Sem alinhamento por landmarks, pequenas diferenças de posição podem “vazar” para o fundo.
* Composição por blocos prioriza performance; para bordas 100% suaves, usar modo por pixel com shader.

## Roteiro para evolução

* Exportação embutida de vídeo (`MediaRecorder`/`CCapture.js`).
* Modo **blend** com `lerpColor` baseado na força de movimento.
* Detecção de rosto (MediaPipe/FaceMesh) para limitar e refinar a máscara.
* Alinhamento fino por malha (warping) usando **WebGL/shaders**.
