import { test, expect } from '@playwright/test';
import path from 'path';

test('should stitch four videos together without stalling', async ({ page }) => {
  test.setTimeout(120000); // Extended timeout for multi-clip processing
  await page.goto('/');
  
  const filePath = path.resolve('tests/fixtures/test.mp4');
  
  // The input is hidden, so we need to use setInputFiles on the hidden input
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('text=Tap to add videos');
  const fileChooser = await fileChooserPromise;
  
  // Upload 4 times to force multiple demuxer re-loads
  await fileChooser.setFiles([filePath, filePath, filePath, filePath]);
  
  // Wait for the videos to appear in the list
  await expect(page.locator('text=test.mp4')).toHaveCount(4);

  // Click the stitch button
  await page.click('button:has-text("Stitch 4 Videos")');
  await expect(page.locator('text=Processing...')).toBeVisible();

  // Race condition assertion: Success vs Error Banner vs Timeout Stall
  await Promise.race([
    expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 110000 }),
    page.waitForSelector('div[class*="errorBanner"]', { state: 'visible', timeout: 110000 }).then(async () => {
      const text = await page.locator('div[class*="errorBanner"]').textContent();
      throw new Error(`Stitching failed with error banner: ${text}`);
    })
  ]);
});