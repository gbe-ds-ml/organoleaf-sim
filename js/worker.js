// 계산 전용 Web Worker: 화면(app.js)과 같은 계산 코드(core.js)를 씁니다.
importScripts("core.js");
self.onmessage = e => runTask(e.data, m => self.postMessage(m));
