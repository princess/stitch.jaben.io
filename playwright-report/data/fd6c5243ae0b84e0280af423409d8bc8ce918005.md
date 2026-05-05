# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: repro_unknown_error.spec.ts >> reproduce Unknown Error via encodeQueueSize overflow
- Location: tests/repro_unknown_error.spec.ts:4:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Fatal Error: Unknown Error')
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('text=Fatal Error: Unknown Error')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - heading "Stitch" [level=1] [ref=e5]
    - paragraph [ref=e6]: Combine videos in your browser. Fast, private, and free.
  - button "Show Debug Logs" [ref=e9] [cursor=pointer]
  - generic [ref=e10]:
    - img [ref=e11]
    - heading "Successfully Stitched!" [level=2] [ref=e14]
    - paragraph [ref=e15]: Your download should have started automatically.
    - button "Start New Project" [ref=e16] [cursor=pointer]
  - generic [ref=e17]:
    - generic [ref=e18]:
      - button [ref=e19]:
        - img [ref=e20]
      - generic [ref=e27]: test.mp4
      - button [ref=e28] [cursor=pointer]:
        - img [ref=e29]
    - generic [ref=e32]:
      - button [ref=e33]:
        - img [ref=e34]
      - generic [ref=e41]: test.mp4
      - button [ref=e42] [cursor=pointer]:
        - img [ref=e43]
  - status [ref=e46]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import path from 'path';
  3   | 
  4   | test('reproduce Unknown Error via encodeQueueSize overflow', async ({ page }) => {
  5   |   page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  6   |   page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  7   |   await page.goto('/');
  8   | 
  9   |   await page.addInitScript(() => {
  10  |     window.WebDemuxer = class {
  11  |       constructor() {}
  12  |       async load() {}
  13  |       async getDecoderConfig() { return { codec: 'avc1.4D4034', codedWidth: 640, codedHeight: 360 }; }
  14  |       async getMediaInfo() { return { duration: 10 }; }
  15  |       read(type) {
  16  |         let count = 0;
  17  |         return {
  18  |           getReader: () => ({
  19  |             read: async () => {
  20  |               if (count > 20) return { done: true };
  21  |               count++;
  22  |               return { done: false, value: { timestamp: count * 33333, duration: 33333, close: () => {} } };
  23  |             },
  24  |             releaseLock: () => {}
  25  |           })
  26  |         };
  27  |       }
  28  |       async destroy() {}
  29  |     };
  30  | 
  31  |     window.VideoDecoder = class {
  32  |       constructor({ output }) { this._output = output; }
  33  |       configure() {}
  34  |       decode(chunk) { 
  35  |         const c = new OffscreenCanvas(1, 1);
  36  |         const f = new VideoFrame(c, { timestamp: chunk.timestamp, duration: chunk.duration });
  37  |         this._output(f);
  38  |       }
  39  |       async flush() {}
  40  |       close() {}
  41  |     };
  42  | 
  43  |     delete window.VideoEncoder;
  44  |     window.VideoEncoder = class {
  45  |       static isConfigSupported = async () => ({ supported: true });
  46  |       state = 'configured';
  47  |       encodeQueueSize = 0;
  48  |       constructor({ output, error }) { }
  49  |       configure(config) { this.state = 'configured'; }
  50  |       encode(frame) {
  51  |         this.encodeQueueSize++;
  52  |         if (this.encodeQueueSize > 5) {
  53  |           console.log('[Mock] Triggering Unknown Error due to queue size');
  54  |           throw new Error('Unknown Error');
  55  |         }
  56  |         frame.close();
  57  |       }
  58  |       async flush() { this.encodeQueueSize = 0; }
  59  |       close() { this.state = 'closed'; }
  60  |     };
  61  |   });
  62  | 
  63  |   const filePath = path.resolve('tests/fixtures/test.mp4');
  64  |   const fileChooserPromise = page.waitForEvent('filechooser');
  65  |   await page.click('text=Tap to add videos');
  66  |   const fileChooser = await fileChooserPromise;
  67  |   await fileChooser.setFiles([filePath, filePath]);
  68  | 
  69  |   const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
  70  |   await stitchButton.click();
  71  | 
> 72  |   await expect(page.locator('text=Fatal Error: Unknown Error')).toBeVisible({ timeout: 20000 });
      |                                                                 ^ Error: expect(locator).toBeVisible() failed
  73  | });
  74  | 
  75  | test('reproduce Unknown Error via audio sample rate mismatch', async ({ page }) => {
  76  |   page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  77  |   page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  78  |   await page.goto('/');
  79  | 
  80  |   await page.addInitScript(() => {
  81  |     window.WebDemuxer = class {
  82  |       constructor() {}
  83  |       async load() {}
  84  |       async getDecoderConfig(type) { 
  85  |         if (type === 'video') return { codec: 'avc1.4D4034', codedWidth: 640, codedHeight: 360 };
  86  |         return { codec: 'mp4a.40.2', sampleRate: 48000 }; 
  87  |       }
  88  |       async getMediaInfo() { return { duration: 10 }; }
  89  |       read(type) {
  90  |         let count = 0;
  91  |         return {
  92  |           getReader: () => ({
  93  |             read: async () => {
  94  |               if (count > 5) return { done: true };
  95  |               count++;
  96  |               return { done: false, value: { timestamp: count * 33333, duration: 33333, close: () => {} } };
  97  |             },
  98  |             releaseLock: () => {}
  99  |           })
  100 |         };
  101 |       }
  102 |       async destroy() {}
  103 |     };
  104 | 
  105 |     window.AudioDecoder = class {
  106 |       constructor({ output }) { this._output = output; }
  107 |       configure() {}
  108 |       decode(chunk) { 
  109 |         this._output({ 
  110 |           sampleRate: 48000, 
  111 |           timestamp: chunk.timestamp, 
  112 |           duration: chunk.duration,
  113 |           numberOfChannels: 2,
  114 |           numberOfFrames: 1024,
  115 |           close: () => {} 
  116 |         });
  117 |       }
  118 |       async flush() {}
  119 |       close() {}
  120 |     };
  121 | 
  122 |     delete window.AudioEncoder;
  123 |     window.AudioEncoder = class {
  124 |       state = 'configured';
  125 |       constructor({ output, error }) { }
  126 |       configure(config) { }
  127 |       encode(data) {
  128 |         if (data.sampleRate !== 44100) {
  129 |           console.log('[Mock] Triggering Audio Sample Rate Mismatch Unknown Error', data.sampleRate);
  130 |           throw new Error('Unknown Error');
  131 |         }
  132 |         data.close();
  133 |       }
  134 |       async flush() { }
  135 |       close() { }
  136 |     };
  137 |   });
  138 | 
  139 |   const filePath = path.resolve('tests/fixtures/test.mp4');
  140 |   const fileChooserPromise = page.waitForEvent('filechooser');
  141 |   await page.click('text=Tap to add videos');
  142 |   const fileChooser = await fileChooserPromise;
  143 |   await fileChooser.setFiles([filePath, filePath]);
  144 | 
  145 |   const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
  146 |   await stitchButton.click();
  147 | 
  148 |   await expect(page.locator('text=Fatal Error: Unknown Error')).toBeVisible({ timeout: 20000 });
  149 | });
  150 | 
```