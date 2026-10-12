# 외부 라이브러리 및 모델 출처

이 프로젝트는 아래 외부 구성요소를 수정하지 않은 배포 파일로 포함합니다. `vendor/`에 들어 있는 파일은 프로젝트 작성자가 직접 개발한 코드가 아닙니다. 재배포할 때 이 안내와 포함된 라이선스 파일을 함께 유지하세요.

| 구성요소 | 버전 | 출처 |
| --- | --- | --- |
| p5.js | 1.11.3 | https://p5js.org/ / https://github.com/processing/p5.js |
| MediaPipe Tasks Vision | 0.10.21 | https://ai.google.dev/edge/mediapipe / https://github.com/google-ai-edge/mediapipe |
| MediaPipe Hand Landmarker 모델 | hand_landmarker / float16 / 1 | https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task |

라이브러리 다운로드 출처:

- https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js
- https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs
- https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/

라이선스 원문은 `vendor/licenses/`에 포함했습니다. 모델의 관련 문서는 https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker 에서 확인할 수 있습니다.

이 ZIP의 주 실행 코드 `index.html`, `sketch.js`는 원본 사이트의 최근 배포 상태에서 복사했습니다. 라이브러리 버전과 모델 파일을 유지하면 다른 팀원도 같은 의존성으로 실행할 수 있습니다.
