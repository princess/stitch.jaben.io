import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Apply mocks from stitch.spec.ts
  await page.addInitScript(() => {
    // @ts-ignore
    window.WebDemuxer = class {
      constructor() {}
      async load() { return Promise.resolve(); }
      async getMediaInfo() { return { duration: 5000000, streams: [{ codec_type_string: 'video', codec_string: 'h264' }, { codec_type_string: 'audio', codec_string: 'aac' }] }; }
      async getDecoderConfig(type) { return { codec: 'avc1', codedWidth: 1280, codedHeight: 720 }; }
      read() { return { getReader: () => ({ read: async () => ({ done: true }), releaseLock: () => {} }) }; }
      async destroy() { return Promise.resolve(); }
    };
    // @ts-ignore
    window.Worker = function() {
      const workerObj = {
        postMessage: (msg) => {
          if (msg.type === 'START') {
            setTimeout(() => { if (workerObj.onmessage) workerObj.onmessage({ data: { type: 'COMPLETE', payload: new Uint8Array([0,0,0,32,102]) } }); }, 500);
          }
        },
        terminate: () => {}
      };
      return workerObj;
    };
  });

  await page.goto('http://localhost:4173/'); // Using the preview port
  
  // Add a file
  const filePath = path.resolve('tests/fixtures/test.mp4');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=Tap to add videos')
  ]);
  await fileChooser.setFiles([filePath, filePath]);
  
  // Click stitch
  await page.click('button:has-text("Stitch 2 Videos")');
  
  // Wait
  await new Promise(r => setTimeout(r, 2000));
  
  // Take snapshot
  const content = await page.content();
  console.log("PAGE CONTENT SNIPPET:", content.substring(content.indexOf('<body'), content.indexOf('</body>')));
  
  await browser.close();
})();
