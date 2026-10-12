// INTEGRAL — two-hand distance shaping, hand masks and interactive matte pottery
    // p5.js 1.11.3 / MediaPipe Tasks Vision Hand Landmarker
    const CFG = {
      videoWidth: 640, videoHeight: 480,
      baseRadius: 48, maxRadius: 150,
      layerHeight: 3, maxHeight: 430,
      handSmoothing: 0.18, buildInterval: 100,
      autoRotationSpeed: 0.35, // radians per second while stacking
      cellSize: 7, segments: 36,
    };

    const DEMO = new URLSearchParams(location.search).has('demo');
    let webcam = null, webcamReady = false;
    let handLandmarker = null, mediaPipeReady = false, modelLoading = false;
    let lastVideoTime = -1, lastDetectionAt = 0;
    let handVisible = false, screenHands = [], smoothTips = [];
    let smoothHandX = 0, smoothHandY = 0;
    let currentRadius = CFG.baseRadius, lastBuildTime = 0;
    let potteryLayers = [], paused = false;
    let potteryGL = null, handMask = null;
    let stage = { x: 0, y: 0, w: 640, h: 640 };
    let rotationX = -0.27, rotationY = -0.44, zoom = 1;
    let isDraggingPottery = false, statusMessage = 'INITIALIZING CAMERA';
    let cameraStarting = false, cameraStream = null;
    let moduleLoading = false, modelFailed = false;
    const VISION_VERSION = '0.10.21';

    // Also works with the minimal index.html supplied by the p5.js editor.
    function ensureInterface() {
      const styles = document.createElement('style');
      styles.textContent = `#cameraPanel {position:fixed;right:18px;bottom:66px;width:180px;padding:10px;background:rgba(17,19,21,.92);border:1px solid #444b4e;z-index:15;display:flex;flex-direction:column;gap:8px}
        #cameraViewport {position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;background:#080a0b;border:1px solid #30383b;display:grid;place-items:center}
        #cameraPlaceholder {color:#697376;font:10px monospace}
        #cameraPreview {display:block;position:absolute;inset:0;width:100%!important;height:100%!important;object-fit:cover;transform:scaleX(-1);pointer-events:none}
        #cameraRetry {position:static;width:100%;min-width:0;padding:9px 4px;font-size:10px;letter-spacing:0;cursor:pointer}
        #status {position:static;color:#a6b1b2;font:9px/1.5 monospace;text-align:center;max-width:100%;overflow-wrap:anywhere}
        #status.active {color:#bbd3c3}
        #error {position:fixed;left:18px;right:18px;bottom:295px;transform:none;max-width:none;z-index:16;padding:12px;background:#241918;color:#f3c8c2;white-space:pre-wrap;font:12px monospace}
        .integralFallback {position:fixed;z-index:12;color:#eee;font:12px monospace}
        @media(max-width:420px){#cameraPanel{width:160px;right:18px}}`;
      document.head.appendChild(styles);
      const defaults = {status:'INITIALIZING CAMERA', heightInfo:'HEIGHT 0 px',radiusInfo:'RADIUS 48 px',layerInfo:'LAYERS 0',error:''};
      Object.entries(defaults).forEach(([id, text], i) => {
        if (document.getElementById(id)) return;
        const el = document.createElement('div'); el.id=id; el.textContent=text;
        el.className='integralFallback'; el.style.cssText=`left:18px;top:${18+i*20}px`;
        if(id==='error') { el.style.cssText=''; el.style.display='none'; }
        document.body.appendChild(el);
      });
      let panel=document.getElementById('cameraPanel');
      if(!panel) {
        panel=document.createElement('section');panel.id='cameraPanel';
        const viewport=document.createElement('div');viewport.id='cameraViewport';panel.appendChild(viewport);
        document.body.appendChild(panel);
      }
      const status=document.getElementById('status');status.className='';status.style.cssText='';panel.appendChild(status);
      const retry=document.createElement('button');retry.id='cameraRetry';retry.textContent='카메라 켜기 / 다시 연결';
      retry.addEventListener('click', () => {
        if(DEMO) { location.search=''; return; }
        modelFailed=false; window.mediaPipeLoadError=false; startCamera();
      });
      panel.appendChild(retry);
    }

    async function startCamera() {
      if (cameraStarting) return;
      cameraStarting=true; webcamReady=false; clearHandTracking();
      document.getElementById('error').style.display='none';
      statusMessage='CAMERA / WAITING FOR PERMISSION';
      let nextStream=null;
      try {
        if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          const err=new Error('HTTPS 또는 localhost로 실행하세요.');err.name='SecurityError';throw err;
        }
        const policy = document.permissionsPolicy || document.featurePolicy;
        if (policy?.allowsFeature && !policy.allowsFeature('camera')) {
          const err = new Error('미리보기에서 카메라 권한이 허용되지 않습니다. 이 페이지 주소를 Safari 또는 Chrome에서 직접 열어주세요.');
          err.name = 'CameraPolicyError'; throw err;
        }
        cameraStream?.getTracks().forEach(track => track.stop());cameraStream=null;
        nextStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{
          width:{ideal:CFG.videoWidth},height:{ideal:CFG.videoHeight},facingMode:'user'
        }});
        if(!webcam) {
          webcam=createVideo([]); webcam.size(CFG.videoWidth,CFG.videoHeight);
          webcam.elt.id='cameraPreview'; webcam.elt.muted=true;
          webcam.elt.title='카메라 미리보기 — 손 인식 전에도 영상이 표시됩니다';
          webcam.elt.setAttribute('playsinline','');
          document.getElementById('cameraViewport').appendChild(webcam.elt);
        }
        webcam.elt.srcObject=nextStream;
        await webcam.elt.play();
        webcam.size(webcam.elt.videoWidth || CFG.videoWidth, webcam.elt.videoHeight || CFG.videoHeight);
        cameraStream=nextStream; lastVideoTime=-1;
        webcamReady=webcam.elt.readyState>=2;
        statusMessage=mediaPipeReady?'CAMERA ON / SHOW BOTH HANDS':'CAMERA ON / LOADING HAND MODEL';
        nextStream.getVideoTracks()[0].addEventListener('ended', () => {
          webcamReady=false;clearHandTracking();statusMessage='CAMERA DISCONNECTED';
          showError('카메라 연결이 끊겼습니다. 다시 연결 버튼을 누르세요.');
        });
      } catch(error) {
        nextStream?.getTracks().forEach(track => track.stop());
        statusMessage=`CAMERA ERROR / ${error.name}`;
        const reasons={CameraPolicyError:'이 미리보기의 권한 정책에서 카메라를 차단하고 있습니다. 이 페이지 주소를 Safari 또는 Chrome에서 직접 열어주세요.',NotAllowedError:'카메라 권한이 차단되었습니다. 주소창의 사이트 권한 및 운영체제의 브라우저 카메라 권한을 허용하세요. 임베디드 미리보기라면 새 탭에서 실행하세요.',
          NotFoundError:'사용 가능한 카메라가 없습니다. 카메라 연결을 확인하세요.',
          NotReadableError:'카메라를 열 수 없습니다. 다른 카메라 사용 앱을 닫고 다시 연결하세요.',
          SecurityError:'HTTPS 또는 http://localhost 주소에서 실행하세요.',
          AbortError:'카메라 시작이 중단되었습니다. 다시 연결하세요.'};
        showError(`${reasons[error.name] || error.message}\n오류: ${error.name}`);
        console.error('Camera start failed:',error);
      } finally {cameraStarting=false;}
    }

    async function loadVisionModule() {
      if(moduleLoading || window.MediaPipeVision || window.mediaPipeLoadError) return;
      moduleLoading=true;
      try {
        window.MediaPipeVision=await import('./vendor/vision_bundle.mjs');
        window.mediaPipeModuleLoaded=true;
      } catch(error) {
        window.mediaPipeLoadError=true; statusMessage='CAMERA ON / MEDIAPIPE MODULE ERROR';
        showError(`카메라 영상과 별도로 손 인식 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.\n${error.message}`);
      } finally {moduleLoading=false;}
    }

    function setup() {
      const cnv = createCanvas(windowWidth, windowHeight);
      cnv.elt.setAttribute('aria-label', '손 모양 마스킹 및 회전 가능한 도자기 3D 캔버스');
      pixelDensity(1);
      frameRate(45);
      buildRenderBuffers();
      ensureInterface();
      document.getElementById('pauseBtn')?.addEventListener('click', togglePause);
      document.getElementById('resetBtn')?.addEventListener('click', resetPottery);

      if (DEMO) {
        makeDemoPottery();
        statusMessage = 'DEMO MODE — DRAG TO ROTATE';
        return;
      }

      statusMessage = '카메라 켜기 버튼을 눌러 시작하세요';
    }

    function buildRenderBuffers() {
      const w = Math.max(260, Math.round(Math.min(width * 0.83, 880)));
      const h = Math.max(310, Math.round(Math.min(height * 0.79, 730)));
      stage = { w, h, x: (width - w) / 2, y: (height - h) / 2 - 4 };
      if (potteryGL) potteryGL.remove();
      if (handMask) handMask.remove();
      potteryGL = createGraphics(w, h, WEBGL);
      potteryGL.pixelDensity(1);
      potteryGL.ortho(-w / 2, w / 2, -h / 2, h / 2, -2000, 2000);
      handMask = createGraphics(Math.ceil(width / CFG.cellSize), Math.ceil(height / CFG.cellSize));
      handMask.pixelDensity(1);
    }

    function draw() {
      background(5, 6, 7);
      if (!DEMO) {
        checkMediaPipeInitialization();
        detectHand();
        drawMaskedHandBackground();
      } else {
        // Hidden demo URL previews the distance guide without changing clay geometry.
        handVisible = true;
        smoothHandX = constrain(mouseX, 0, width);
        smoothHandY = constrain(mouseY, 0, height);
        smoothTips = [{x:smoothHandX,y:smoothHandY},{x:width-smoothHandX,y:smoothHandY}];
      }
      drawStageDecoration();
      drawMovementGuides(); // Composite the guide behind the opaque pottery mesh.
      updateAutomaticRotation();
      drawPottery3D();
      drawHandIndicator();
      updateDOM();
    }

    function checkMediaPipeInitialization() {
      if(webcam?.elt.readyState>=2 && cameraStream?.active) webcamReady=true;
      if (mediaPipeReady || modelLoading || modelFailed || !webcamReady) return;
      if (window.mediaPipeLoadError) {
        statusMessage = 'MEDIAPIPE MODULE ERROR';
        showError('손 인식 라이브러리 다운로드에 실패했습니다. 인터넷 연결을 확인하세요.');
        return;
      }
      if(!window.MediaPipeVision) { loadVisionModule(); return; }
      if (window.mediaPipeModuleLoaded && window.MediaPipeVision) initializeMediaPipe();
    }

    async function initializeMediaPipe() {
      if (modelLoading || mediaPipeReady) return;
      modelLoading = true;
      statusMessage = 'LOADING HAND MODEL';
      const vision = window.MediaPipeVision;
      try {
        const fileset = await vision.FilesetResolver.forVisionTasks(
          window.mediaPipeWasmBase ||
          './vendor/wasm'
        );
        const opts = (delegate) => ({
          baseOptions: {
            modelAssetPath: './vendor/hand_landmarker.task',
            delegate
          },
          runningMode: 'VIDEO', numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        try {
          handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU'));
        } catch (gpuError) {
          console.warn('GPU HandLandmarker failed, using CPU:', gpuError);
          handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU'));
        }
        mediaPipeReady = true;
        modelFailed=false;
        statusMessage = 'CAMERA ON / SHOW BOTH HANDS';
      } catch (error) {
        console.error('Failed to load hand model:', error);
        statusMessage = 'HAND MODEL ERROR';
        modelFailed=true;
        showError('손 인식 모델 로딩에 실패했습니다. 인터넷 연결을 확인한 뒤 새로고침하세요.');
      } finally {
        modelLoading = false;
      }
    }

    function videoCover() {
      const sourceW=webcam?.elt.videoWidth || webcam?.width || CFG.videoWidth;
      const sourceH=webcam?.elt.videoHeight || webcam?.height || CFG.videoHeight;
      const scale = Math.max(width / sourceW, height / sourceH);
      return {
        scale, sourceW, sourceH,
        left: (width - sourceW * scale) / 2,
        top: (height - sourceH * scale) / 2
      };
    }

    function landmarkToScreen(p, cover) {
      return {
        // Mirror the webcam image AND landmarks consistently.
        x: width - (cover.left + p.x * cover.sourceW * cover.scale),
        y: cover.top + p.y * cover.sourceH * cover.scale
      };
    }

    function clearHandTracking() {
      handVisible = false;
      screenHands = [];
      smoothTips = [];
    }

    function detectHand() {
      if (!mediaPipeReady || !webcamReady || webcam.elt.readyState < 2) return;
      if (webcam.elt.currentTime === lastVideoTime) {
        if (millis() - lastDetectionAt > 650) clearHandTracking();
        return;
      }
      lastVideoTime = webcam.elt.currentTime;
      try {
        const result = handLandmarker.detectForVideo(webcam.elt, performance.now());
        const cover = videoCover();
        screenHands = (result.landmarks || []).slice(0, 2)
          .map(points => points.map(p => landmarkToScreen(p, cover)));
        lastDetectionAt = millis();
        if (screenHands.length !== 2) {
          handVisible = false;
          smoothTips = [];
          statusMessage = screenHands.length === 1 ? '양손을 모두 보여주세요' : 'CAMERA ON / SHOW BOTH HANDS';
          return;
        }
        let tips = screenHands.map(points => points[8]);
        if (!handVisible || smoothTips.length !== 2) {
          smoothTips = tips.map(p => ({x:p.x, y:p.y}));
          // Reacquiring both hands starts a fresh interval; never catch up lost layers.
          lastBuildTime = millis();
        } else {
          // MediaPipe may reorder its results: match the nearest pair before smoothing.
          const squared = (a,b) => (a.x-b.x)**2 + (a.y-b.y)**2;
          const direct = squared(smoothTips[0],tips[0]) + squared(smoothTips[1],tips[1]);
          const swapped = squared(smoothTips[0],tips[1]) + squared(smoothTips[1],tips[0]);
          if (swapped < direct) tips = [tips[1], tips[0]];
          smoothTips = tips.map((p,i) => ({
            x:lerp(smoothTips[i].x,p.x,CFG.handSmoothing),
            y:lerp(smoothTips[i].y,p.y,CFG.handSmoothing)
          }));
        }
        smoothHandX = (smoothTips[0].x + smoothTips[1].x) * .5;
        smoothHandY = (smoothTips[0].y + smoothTips[1].y) * .5;
        handVisible = true;
        if (!paused) updatePotteryFromHand();
      } catch (error) {
        console.error('Hand detection failed:', error);
        clearHandTracking();
        statusMessage = 'HAND TRACKING ERROR';
      }
    }

    function updatePotteryFromHand() {
      if (!handVisible || smoothTips.length !== 2) return;
      const motion = getMotionData();
      currentRadius = lerp(currentRadius, motion.radius, 0.12);
      const now = millis();
      const currentHeight = potteryLayers.length * CFG.layerHeight;
      if (now - lastBuildTime < CFG.buildInterval || currentHeight + CFG.layerHeight > CFG.maxHeight) return;
      potteryLayers.push({
        radius: currentRadius,
        y: -currentHeight,
        wobble: random(0.5, 2.5),
        seed: random(1000),
        thickness: CFG.layerHeight * motion.relief
      });
      lastBuildTime = now;
    }

    // APPROXIMATE HAND SEGMENTATION FROM 21 LANDMARKS:
    // a palm polygon + tapered, rounded finger segments. This masks out the
    // room/person background but is not pixel-accurate AI segmentation.
    function generateHandMask() {
      handMask.clear();
      for (const points of screenHands) drawOneHandMask(points);
    }

    function drawOneHandMask(points) {
      if (points.length !== 21) return;
      const f = 1 / CFG.cellSize;
      const pt = (n) => ({ x: points[n].x * f, y: points[n].y * f });
      const palmWidth = Math.max(8, dist(pt(5).x, pt(5).y, pt(17).x, pt(17).y));

      // The palm joins the wrist, thumb base, and four knuckle bases.
      handMask.noStroke();
      handMask.fill(255);
      handMask.beginShape();
      [0, 1, 2, 5, 9, 13, 17].forEach((n) => {
        const p = pt(n);
        handMask.vertex(p.x, p.y);
      });
      handMask.endShape(CLOSE);
      // Fill central palm for unusually rotated/foreshortened hands.
      const center = pt(9), wrist = pt(0);
      handMask.ellipse((center.x + wrist.x) * .5, (center.y + wrist.y) * .5, palmWidth * .92, palmWidth * 1.03);

      const fingers = [
        [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12],
        [13, 14, 15, 16], [17, 18, 19, 20]
      ];
      handMask.stroke(255);
      handMask.strokeCap(ROUND);
      for (let finger = 0; finger < fingers.length; finger++) {
        const ids = fingers[finger];
        const baseWidths = finger === 0 ? [.31, .26, .19] : [.30, .245, .185];
        for (let j = 0; j < 3; j++) {
          const a = pt(ids[j]), b = pt(ids[j + 1]);
          handMask.strokeWeight(Math.max(2.8, palmWidth * baseWidths[j]));
          handMask.line(a.x, a.y, b.x, b.y);
        }
      }
      handMask.noStroke();
    }

    function drawMaskedHandBackground() {
      if (!webcamReady || screenHands.length === 0) return;
      generateHandMask();
      handMask.loadPixels();
      webcam.loadPixels();
      if (!webcam.pixels || !webcam.pixels.length || !handMask.pixels.length) return;
      const cell = CFG.cellSize, cover = videoCover();
      const vW = webcam.width, vH = webcam.height;
      noStroke();
      fill(238, 235, 229, 206);
      for (let gy = 0; gy < handMask.height; gy++) {
        const y = (gy + 0.5) * cell;
        const sv = Math.floor((y - cover.top) / cover.scale);
        if (sv < 0 || sv >= vH) continue;
        for (let gx = 0; gx < handMask.width; gx++) {
          const maskIndex = 4 * (gy * handMask.width + gx) + 3;
          if (handMask.pixels[maskIndex] < 64) continue;
          const x = (gx + 0.5) * cell;
          const su = Math.floor((width - x - cover.left) / cover.scale);
          if (su < 0 || su >= vW) continue;
          const index = 4 * (sv * vW + su);
          const luminance = (0.299 * webcam.pixels[index] +
            0.587 * webcam.pixels[index + 1] + 0.114 * webcam.pixels[index + 2]) / 255;
          const dotSize = cell * (0.27 + 0.72 * luminance);
          circle(x, y, dotSize);
        }
      }
    }

    function drawStageDecoration() {
      const cx = width / 2, cy = stage.y + stage.h * .53;
      noFill();
      stroke(110, 115, 118, 35);
      strokeWeight(1);
      ellipse(cx, cy + Math.min(195, stage.h * .28), 340, 42);
      line(cx - 12, cy + Math.min(195, stage.h * .28), cx + 12, cy + Math.min(195, stage.h * .28));
      stroke(165, 170, 174, 40);
      line(cx, stage.y + 35, cx, stage.y + stage.h - 33);
      noStroke();
    }

    function ringRadius(layer, angle) {
      const wobble = Math.sin(angle * 3 + layer.seed) * layer.wobble +
        Math.sin(angle * 7 - layer.seed) * layer.wobble * .35;
      return Math.max(8, layer.radius + wobble);
    }

    function surfacePoint(layerBelow, layerAbove, t, angle, ridgeAmount = 1) {
      const r0 = ringRadius(layerBelow, angle);
      const r1 = ringRadius(layerAbove, angle);
      const ridge = Math.sin(Math.PI * t) * layerAbove.thickness * .28 * ridgeAmount;
      const radius = lerp(r0, r1, t) + ridge;
      return {
        x: Math.cos(angle) * radius,
        y: -t * CFG.layerHeight,
        z: Math.sin(angle) * radius
      };
    }

    function addOuterVertex(g, p, a, yOffset) {
      g.normal(Math.cos(a), 0, Math.sin(a));
      g.vertex(p.x, p.y + yOffset, p.z);
    }

    function drawPottery3D() {
      const g = potteryGL;
      g.clear();
      const count = potteryLayers.length;
      if (count === 0) {
        drawStartingGuide();
        return;
      }
      const totalH = count * CFG.layerHeight;
      const overallScale = Math.min(1, (stage.h - 125) / (totalH + 110), (stage.w - 65) / (CFG.maxRadius * 2 + 65));
      g.push();
      g.scale(overallScale * zoom);
      g.translate(0, 20, 0);
      g.rotateX(rotationX);
      g.rotateY(rotationY);
      g.translate(0, totalH * .5, 0); // pivot at object's center
      g.ambientLight(82, 83, 90);
      g.directionalLight(245, 239, 226, -0.6, -0.7, -1);
      g.directionalLight(78, 87, 113, 0.7, 0.2, 0.8);
      g.pointLight(190, 190, 195, 85, -310, 230);
      g.noStroke();
      // Diffuse, matte clay shading without specular highlights.
      g.ambientMaterial(210, 204, 193);

      const N = CFG.segments;
      // Continuous outer wall connecting successive circular layers.
      g.beginShape(TRIANGLES);
      for (let i = 0; i < count; i++) {
        const low = i === 0 ? potteryLayers[0] : potteryLayers[i - 1];
        const high = potteryLayers[i];
        for (let half = 0; half < 2; half++) {
          const t0 = half * .5, t1 = (half + 1) * .5;
          for (let j = 0; j < N; j++) {
            const a0 = TWO_PI * j / N, a1 = TWO_PI * (j + 1) / N;
            const p00 = surfacePoint(low, high, t0, a0);
            const p01 = surfacePoint(low, high, t0, a1);
            const p10 = surfacePoint(low, high, t1, a0);
            const p11 = surfacePoint(low, high, t1, a1);
            addOuterVertex(g, p00, a0, -i * CFG.layerHeight);
            addOuterVertex(g, p01, a1, -i * CFG.layerHeight);
            addOuterVertex(g, p11, a1, -i * CFG.layerHeight);
            addOuterVertex(g, p00, a0, -i * CFG.layerHeight);
            addOuterVertex(g, p11, a1, -i * CFG.layerHeight);
            addOuterVertex(g, p10, a0, -i * CFG.layerHeight);
          }
        }
      }
      g.endShape();

      // Inner wall gives the top of the vase a real hollow opening.
      const wall = 8;
      g.ambientMaterial(126, 125, 123);
      g.beginShape(TRIANGLES);
      for (let i = 0; i < count; i++) {
        const low = i === 0 ? potteryLayers[0] : potteryLayers[i - 1];
        const high = potteryLayers[i];
        for (let j = 0; j < N; j++) {
          const a0 = TWO_PI * j / N, a1 = TWO_PI * (j + 1) / N;
          const lo0 = Math.max(5, ringRadius(low, a0) - wall);
          const lo1 = Math.max(5, ringRadius(low, a1) - wall);
          const hi0 = Math.max(5, ringRadius(high, a0) - wall);
          const hi1 = Math.max(5, ringRadius(high, a1) - wall);
          const y0 = -i * CFG.layerHeight, y1 = -(i + 1) * CFG.layerHeight;
          g.normal(-Math.cos(a0), 0, -Math.sin(a0));
          g.vertex(Math.cos(a0)*lo0, y0, Math.sin(a0)*lo0);
          g.vertex(Math.cos(a0)*hi0, y1, Math.sin(a0)*hi0);
          g.vertex(Math.cos(a1)*hi1, y1, Math.sin(a1)*hi1);
          g.normal(-Math.cos(a1), 0, -Math.sin(a1));
          g.vertex(Math.cos(a0)*lo0, y0, Math.sin(a0)*lo0);
          g.vertex(Math.cos(a1)*hi1, y1, Math.sin(a1)*hi1);
          g.vertex(Math.cos(a1)*lo1, y0, Math.sin(a1)*lo1);
        }
      }
      g.endShape();

      // Bright annular rim at top, dark central hole.
      const top = potteryLayers[count - 1], yTop = -totalH;
      g.ambientMaterial(218, 211, 200);
      g.beginShape(TRIANGLES);
      for (let j = 0; j < N; j++) {
        const a0 = TWO_PI*j/N, a1 = TWO_PI*(j+1)/N;
        const ro0 = ringRadius(top,a0), ro1=ringRadius(top,a1);
        const ri0 = Math.max(5,ro0-wall), ri1=Math.max(5,ro1-wall);
        g.normal(0,-1,0);
        g.vertex(Math.cos(a0)*ro0,yTop,Math.sin(a0)*ro0);
        g.vertex(Math.cos(a1)*ri1,yTop,Math.sin(a1)*ri1);
        g.vertex(Math.cos(a0)*ri0,yTop,Math.sin(a0)*ri0);
        g.vertex(Math.cos(a0)*ro0,yTop,Math.sin(a0)*ro0);
        g.vertex(Math.cos(a1)*ro1,yTop,Math.sin(a1)*ro1);
        g.vertex(Math.cos(a1)*ri1,yTop,Math.sin(a1)*ri1);
      }
      g.endShape();

      // A faint contour accent emphasizes the clay's top opening.
      g.noFill(); g.stroke(221, 214, 202, 100); g.strokeWeight(1.1);
      g.beginShape();
      for (let j=0; j<=N; j++) {
        const a = TWO_PI*j/N, r=ringRadius(top,a);
        g.vertex(Math.cos(a)*r, yTop-.3, Math.sin(a)*r);
      }
      g.endShape();
      g.pop();
      image(g, stage.x, stage.y, stage.w, stage.h);
    }

    function drawStartingGuide() {
      const cx = width / 2, cy = height * .53;
      noFill(); stroke(149, 149, 145, 180); strokeWeight(1);
      ellipse(cx, cy + 25, CFG.baseRadius*2, CFG.baseRadius*.35);
      noStroke(); fill(174); textFont('monospace'); textAlign(CENTER, CENTER);
      textSize(11); text(DEMO ? 'DEMO' : 'SHOW BOTH HANDS TO SHAPE', cx, cy - 20);
    }

    // The line joins both index fingertips; its full length controls clay radius.
    function getMotionData() {
      const distance = smoothTips.length === 2
        ? Math.hypot(smoothTips[1].x-smoothTips[0].x, smoothTips[1].y-smoothTips[0].y) : 0;
      const radius = map(distance, 0, width * .65, 30, CFG.maxRadius, true);
      const relief = map(smoothHandY, height * .15, height * .8, 1.4, .55, true);
      return {distance, radius, relief};
    }

    function drawMovementGuides() {
      if (!handVisible || smoothTips.length !== 2) return;
      const [a,b] = smoothTips;
      push();
      stroke(245,245,240,55);strokeWeight(1);
      line(a.x,a.y,b.x,b.y);
      pop();
    }

    function updateAutomaticRotation() {
      const canStack = !DEMO && handVisible && !paused && potteryLayers.length > 0 &&
        (potteryLayers.length + 1) * CFG.layerHeight <= CFG.maxHeight;
      if (!canStack || isDraggingPottery) return;
      // Frame-rate independent movement, capped to avoid jumps after returning to the tab.
      rotationY += CFG.autoRotationSpeed * Math.min(Math.max(deltaTime, 0), 100) / 1000;
    }

    function drawHandIndicator() {
      // Show a marker on each hand, even when one hand is still being acquired.
      const tips = handVisible ? smoothTips : screenHands.map(points=>points[8]);
      push();noFill();stroke(246,235,222,180);strokeWeight(1);
      for (const p of tips) {
        circle(p.x,p.y,17);
        line(p.x-13,p.y,p.x+13,p.y);
        line(p.x,p.y-13,p.x,p.y+13);
      }
      pop();
    }

    function updateDOM() {
      const st = document.getElementById('status');
      st.textContent = DEMO ? statusMessage :
        (handVisible ? (paused ? 'TWO HANDS / PAUSED' : 'TWO HANDS / BUILDING') : statusMessage);
      st.classList.toggle('active', handVisible && !paused);
      document.getElementById('heightInfo').textContent = `HEIGHT  ${potteryLayers.length*CFG.layerHeight} px`;
      document.getElementById('radiusInfo').textContent = `RADIUS  ${Math.round(currentRadius)} px`;
      document.getElementById('layerInfo').textContent = `LAYERS  ${potteryLayers.length} / ${Math.floor(CFG.maxHeight/CFG.layerHeight)}`;
    }

    function showError(message) {
      const el=document.getElementById('error');
      el.textContent=message; el.style.display='block';
    }
    function togglePause() {
      paused=!paused;
      const pauseBtn=document.getElementById('pauseBtn');
      if(pauseBtn) pauseBtn.textContent = paused ? 'RESUME [SPACE]' : 'PAUSE [SPACE]';
      lastBuildTime=millis();
    }
    function resetPottery() {
      potteryLayers=[]; currentRadius=CFG.baseRadius; lastBuildTime=millis();
      rotationX=-.27; rotationY=-.44; zoom=1;
      if (DEMO) makeDemoPottery();
    }
    function withinStage(x, y) {
      return x>=stage.x && x<=stage.x+stage.w && y>=stage.y && y<=stage.y+stage.h;
    }
    function mousePressed() {
      if (withinStage(mouseX,mouseY)) isDraggingPottery=true;
    }
    function mouseDragged() {
      if (!isDraggingPottery) return;
      rotationY += movedX*.012;
      rotationX = constrain(rotationX+movedY*.010,-1.30,1.30);
      return false;
    }
    function mouseReleased() { isDraggingPottery=false; }
    function mouseWheel(event) {
      if (withinStage(mouseX,mouseY)) {
        zoom=constrain(zoom*Math.exp(-event.delta*.001),.52,1.85);
        return false;
      }
    }
    function touchStarted() {
      if (touches.length===1 && withinStage(touches[0].x,touches[0].y)) {
        isDraggingPottery=true;
        return false;
      }
    }
    let prevTouchX=null, prevTouchY=null;
    function touchMoved() {
      if (isDraggingPottery && touches.length===1) {
        const t=touches[0];
        if (prevTouchX!==null) {
          rotationY+=(t.x-prevTouchX)*.012;
          rotationX=constrain(rotationX+(t.y-prevTouchY)*.010,-1.30,1.30);
        }
        prevTouchX=t.x; prevTouchY=t.y;
        return false;
      }
    }
    function touchEnded() { isDraggingPottery=false; prevTouchX=null; prevTouchY=null; }
    function keyPressed() {
      if (key === 'r' || key === 'R') resetPottery();
      if (key === ' ') { togglePause(); return false; }
    }
    function windowResized() { resizeCanvas(windowWidth,windowHeight); buildRenderBuffers(); }
    function makeDemoPottery() {
      potteryLayers=[];
      for(let i=0;i<118;i++) {
        const t=i/117;
        const shape=60+59*Math.sin(t*Math.PI*.91)+10*Math.sin(t*Math.PI*3.2);
        potteryLayers.push({radius: shape, y:-i*CFG.layerHeight,
          wobble: 1.1, seed:i*.073, thickness:2.8});
      }
      currentRadius=potteryLayers[potteryLayers.length-1].radius;
    }
