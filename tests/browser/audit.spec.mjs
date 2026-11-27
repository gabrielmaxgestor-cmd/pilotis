import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function checkAccessibility(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.flatMap((rule) => rule.nodes.map((node) => [rule.id, node.target, node.failureSummary]))).toEqual([]);
}

async function checkPageWidth(page) {
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]);
}

for (const width of [390, 1440]) {
  test(`layout, contraste, teclado e formulários em ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://**/*', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await checkPageWidth(page);
    await checkAccessibility(page);
    await page.goto('/tests/browser/index.html');

    const nav = width === 390 ? page.getByRole('navigation', { name: 'Navegação inferior' })
      : page.getByRole('complementary', { name: 'Navegação principal' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await checkPageWidth(page);
    await checkAccessibility(page);

    await nav.getByRole('button', { name: 'Financeiro' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Lançamentos recentes' })).toBeVisible();
    if (width === 390) {
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText('Comprovante de despesa', { exact: true }).filter({ visible: true })).toBeVisible();
    } else {
      await expect(page.getByRole('table').getByText('Comprovante de despesa', { exact: true })).toBeVisible();
    }
    await checkPageWidth(page);
    await checkAccessibility(page);

    const trigger = page.getByRole('button', { name: 'Novo lançamento', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Novo lançamento' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Novo lançamento' })).toBeFocused();
    await expect(dialog.getByLabel('Registrado por')).toBeVisible();
    await checkAccessibility(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const overview = page.getByRole('tab', { name: 'Visão geral' });
    await overview.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'A receber' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'A receber' })).toHaveAttribute('aria-selected', 'true');

    await nav.getByRole('button', { name: width === 390 ? 'Obras' : 'Planejamento de Obras' }).click();
    await expect(page.getByRole('heading', { name: /Planejamento de Obras/i }).first()).toBeVisible();
    await expect(page.getByText('Custo orçado · Sem dados.', { exact: false })).toBeVisible();
    await checkPageWidth(page);
    await checkAccessibility(page);
  });
}
