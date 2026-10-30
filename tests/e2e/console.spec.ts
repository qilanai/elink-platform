import { expect, test } from '@playwright/test';

test('real catalog drives launch links and Sites stays unavailable', async ({ page, request }) => {
  const response = await request.get('/api/platform/v1/applications');
  expect(response.ok()).toBeTruthy();
  const catalog = await response.json();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('从想法，到作品。');
  for (const application of catalog.applications) {
    const card = page.locator(`article.${application.id}`);
    if (application.state === 'available') {
      await expect(card.getByRole('link')).toHaveAttribute('href', application.url);
    } else {
      await expect(card.getByRole('button')).toBeDisabled();
    }
  }
  await expect(page.locator('article.sites').getByRole('link')).toHaveCount(0);
  await expect(page.getByText('目前各应用使用独立账号登录，统一账号正在接入中。')).toBeVisible();
  await page.screenshot({ path: '.local/console-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/console-mobile.png', fullPage: true });
});

test('catalog failure is visible and refresh recovers', async ({ page }) => {
  await page.route('**/api/platform/v1/applications', route => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('暂时无法加载应用');
  await expect(page.locator('article')).toHaveCount(0);
  await page.unroute('**/api/platform/v1/applications');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('article.studio')).toBeVisible();
});
