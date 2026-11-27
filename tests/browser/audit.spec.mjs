import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function checkAccessibility(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.flatMap((rule) => rule.nodes.map((node) => [rule.id, node.target, node.failureSummary]))).toEqual([]);
}

async function checkPageWidth(page) {
  const result = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const width = document.documentElement.scrollWidth;
    const overflowing = width <= viewport ? [] : Array.from(document.querySelectorAll('main *'))
      .filter((element) => element.getBoundingClientRect().right > viewport)
      .filter((element) => !element.closest('.overflow-x-auto, .no-scrollbar'))
      .slice(0, 8).map((element) => [element.tagName, element.className]);
    return { viewport, width, overflowing };
  });
  expect(result.width, JSON.stringify(result.overflowing)).toBeLessThanOrEqual(result.viewport);
}

for (const width of [390, 1440]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page }) => {
      await page.route('https://**/*', (route) => route.abort());
    });

    function navigation(page) {
      return width === 390 ? page.getByRole('navigation', { name: 'Navegação inferior' })
        : page.getByRole('complementary', { name: 'Navegação principal' });
    }

    async function openFinance(page) {
      await page.goto('/tests/browser/index.html');
      await navigation(page).getByRole('button', { name: 'Financeiro' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Lançamentos recentes' })).toBeVisible();
    }

    test('login e Dashboard vazio com navegação responsiva', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
      await checkPageWidth(page);
      await checkAccessibility(page);

      await page.goto('/tests/browser/index.html');
      await expect(navigation(page)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      await checkPageWidth(page);
      await checkAccessibility(page);
    });

    test('Financeiro alterna tabela e lista e habilita as abas por teclado', async ({ page }) => {
      await openFinance(page);
      if (width === 390) {
        await expect(page.getByRole('table')).toHaveCount(0);
        await expect(page.getByText('Comprovante de despesa', { exact: true }).filter({ visible: true })).toBeVisible();
      } else {
        await expect(page.getByRole('table').getByText('Comprovante de despesa', { exact: true })).toBeVisible();
      }
      await checkPageWidth(page);
      await checkAccessibility(page);

      const overview = page.getByRole('tab', { name: 'Visão geral' });
      await overview.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'A receber' })).toBeFocused();
      await expect(page.getByRole('tab', { name: 'A receber' })).toHaveAttribute('aria-selected', 'true');
    });

    test('modal financeiro mantém foco visível e devolve foco ao fechar', async ({ page }) => {
      await openFinance(page);
      const trigger = page.getByRole('button', { name: 'Novo lançamento', exact: true });
      await trigger.focus();
      await expect(trigger).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Novo lançamento' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Novo lançamento' })).toBeFocused();
      await expect(dialog.getByLabel('Registrado por')).toBeVisible();
      await checkAccessibility(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test('prévia de CSV sinaliza empréstimo marcado como faturamento', async ({ page }) => {
      await page.goto('/tests/browser/index.html?route=settings');
      await page.getByLabel('Colar linhas CSV manualmente').fill([
        'Data;Descrição;Categoria;Valor;Obra;Tipo',
        '10/11/2026;Crédito contratado;Faturamento;50000,00;Empresa;Empréstimo',
        '11/11/2026;Crédito declarado;Empréstimo;125,00;Empresa;Empréstimo',
      ].join('\n'));
      await page.getByRole('button', { name: 'Avançar para relacionar colunas' }).click();
      await page.getByRole('button', { name: 'Revisar movimentos' }).click();

      await expect(page.getByText('Empréstimo lançado como faturamento sinalizado para reclassificação')).toBeVisible();
      const warning = width === 390 ? 'Empréstimo sinalizado · não entra como receita' : 'Sinalizado · empréstimo não é faturamento';
      await expect(page.getByText(warning, { exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Tipo de Crédito contratado' })).toHaveValue('loan');
      await expect(page.getByRole('combobox', { name: 'Tipo de Crédito declarado' })).toHaveValue('loan');
    });

    test('planejamento indica a falta de custo cadastrado', async ({ page }) => {
      await page.goto('/tests/browser/index.html');
      await navigation(page).getByRole('button', { name: width === 390 ? 'Obras' : 'Planejamento de Obras' }).click();
      await expect(page.getByRole('heading', { name: /Planejamento de Obras/i }).first()).toBeVisible();
      await expect(page.getByText('Custo orçado · Sem dados.', { exact: false })).toBeVisible();
      await checkPageWidth(page);
      await checkAccessibility(page);
    });
  });
}
