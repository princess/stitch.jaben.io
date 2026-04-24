import { test, expect } from '@playwright/test';
import path from 'path';

test('should stitch two videos together', async ({ page }) => {
  await page.goto('/');

  // Verify header is present
  await expect(page.locator('h1')).toHaveText('Stitch');

  // Check if browser is supported
  const notSupported = page.locator('text=Browser Not Supported');
  if (await notSupported.isVisible()) {
    throw new Error('WebCodecs not supported in this test environment');
  }

  // Upload the same video twice
  const filePath = path.resolve('tests/fixtures/test.mp4');
  
  // The input is hidden, so we need to use setInputFiles on the hidden input
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('text=Tap to add videos');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([filePath, filePath]);

  // Wait for the videos to appear in the list
  await expect(page.locator('text=test.mp4')).toHaveCount(2);

  // Click the stitch button
  const stitchButton = page.locator('button:has-text("Stitch 2 Videos")');
  await stitchButton.click();

  // Wait for processing to start
  await expect(page.locator('text=Processing...')).toBeVisible();

  // Wait for success message (increased timeout because encoding can take a few seconds)
  await expect(page.locator('text=Successfully Stitched!')).toBeVisible({ timeout: 60000 });

  // Verify that the "Start New Project" button is visible
  await expect(page.locator('text=Start New Project')).toBeVisible();
});
