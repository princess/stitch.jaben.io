import { chromium } from 'playwright';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

(async () => {
  console.log("Starting server...");
  const serverProc = exec('npm run preview -- --port 4173');
  
  // Wait for server to start
  await new Promise(r => setTimeout(r, 5000));

  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER:', msg.text()));

  await page.goto('http://localhost:4173/');
  
  const filePath = path.resolve('tests/fixtures/test.mp4');
  console.log("Uploading file...");
  
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=Tap to add videos')
  ]);
  await fileChooser.setFiles([filePath, filePath]);
  
  console.log("Starting stitch...");
  
  try {
    const stitchBtn = page.locator('button:has-text("Stitch 2 Videos")');
    await stitchBtn.click();
    
    // Wait for the download event
    const download = await page.waitForEvent('download', { timeout: 60000 });
    
    const downloadPath = await download.path();
    console.log("Downloaded to:", downloadPath);
    
    const stats = fs.statSync(downloadPath);
    console.log("File size:", stats.size);
    
    // Check if it has an audio track by looking for mp4a or using mp4box or something simple
    const content = fs.readFileSync(downloadPath);
    const contentStr = content.toString('ascii');
    const hasMp4a = contentStr.includes('mp4a');
    const hasAvc1 = contentStr.includes('avc1');
    const hasMoov = contentStr.includes('moov');
    const hasTrak = contentStr.includes('trak');
    const hasMdat = contentStr.includes('mdat');
    
    console.log("Has moov atom:", hasMoov);
    console.log("Has mdat atom:", hasMdat);
    console.log("Has trak atom:", hasTrak);
    console.log("Has mp4a atom:", hasMp4a);
    console.log("Has avc1 atom:", hasAvc1);
    
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
    serverProc.kill('SIGKILL');
    console.log("Done.");
    process.exit(0);
  }
})();
