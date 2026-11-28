import { strFromU8, unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
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

    test('WhatsApp abre a conversa com o texto preenchido e pede confirmação do envio', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
      await page.context().route('https://wa.me/**', (route) => route.fulfill({ body: 'WhatsApp', contentType: 'text/plain' }));
      await page.goto('/tests/browser/index.html?route=financial&financial.aba=A+receber&finance=whatsapp');
      const trigger = page.getByRole('button', { name: 'Lembrete pelo WhatsApp' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Parcela vencida pelo WhatsApp' });
      const link = dialog.getByRole('link', { name: 'Abrir WhatsApp' });
      const button = dialog.getByRole('button', { name: 'Confirmar mensagem enviada' });
      await expect(button).toBeDisabled();
      const href = new URL(await link.getAttribute('href'));
      expect(href.host + href.pathname).toBe('wa.me/5524999991212');
      expect(href.searchParams.get('text')).toMatch(/Olá, Lívia!.*Obra contratada.*27\/11\/2026/);
      await checkAccessibility(page);
      const opening = page.waitForEvent('popup');
      await link.click();
      const popup = await opening;
      await expect(popup).toHaveURL(href.toString());
      await popup.close();
      await expect(button).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await checkPageWidth(page);
    });

    test('Financeiro gera ZIP com planilha e CSVs mesmo em período sem dados', async ({ page }) => {
      await page.route((url) => url.pathname === '/src/services/pilotisService.ts', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const exportFunction = 'async function recordAccountingPackageExport(uid, actor, start, end) {';
        if (!source.includes(exportFunction)) throw Error('Função de auditoria não encontrada no módulo da exportação.');
        await route.fulfill({ response, body: source.replace(exportFunction,
          exportFunction + ' window.pilotisAccountingAudit = { uid, actor, start, end }; return;') });
      });
      await page.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
      await page.goto('/tests/browser/index.html?route=financial&financial.aba=Pacote+para+o+contador&finance=empty');
      await expect(page.getByRole('heading', { name: 'Pacote para o contador' })).toBeVisible();
      const start = page.getByLabel('Início do período');
      const end = page.getByLabel('Fim do período');
      await expect(start).toHaveValue('2026-11-01');
      await expect(end).toHaveValue('2026-11-30');
      await start.fill('2026-10-01');
      await end.fill('2026-10-31');
      const button = page.getByRole('button', { name: 'Gerar pacote (.zip)' });
      await expect(button).toBeEnabled();
      await checkPageWidth(page);
      await checkAccessibility(page);
      const event = page.waitForEvent('download');
      await button.click();
      const download = await event;
      expect(download.suggestedFilename()).toBe('pacote-para-o-contador-2026-10-01-a-2026-10-31.zip');
      const files = unzipSync(new Uint8Array(await readFile(await download.path())));
      expect(files['pacote-para-o-contador.xlsx']).toBeDefined();
      const xml = unzipSync(files['pacote-para-o-contador.xlsx']);
      expect(strFromU8(xml['xl/workbook.xml'])).toContain('Parcelas recebidas');
      const csvs = Object.keys(files).filter((file) => file.endsWith('.csv'));
      expect(csvs).toHaveLength(7);
      expect(csvs.every((file) => strFromU8(files[file]).includes('Sem dados'))).toBe(true);
      expect(await page.evaluate(() => window.pilotisAccountingAudit)).toEqual({
        uid: 'browser-test', actor: 'Sócio', start: '2026-10-01', end: '2026-10-31',
      });
    });

    test('Anexos mostram PDF, versão anterior e remoção lógica', async ({ page }) => {
      await page.route((url) => url.pathname === '/src/lib/firebase.ts', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: "export const auth = { currentUser: { getIdToken: async () => 'browser-test' } }; export const db = {}; export const OperationType = {}; export function handleFirestoreError(error) { throw error; }",
      }));
      let removed = false;
      await page.route('**/api/compliance-attachments/test-contract**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/remove')) {
          removed = true;
          return route.fulfill({ status: 204 });
        }
        if (path.endsWith('/version-current')) {
          return route.fulfill({ status: 200, contentType: 'application/pdf',
            headers: { 'Content-Disposition': 'attachment; filename="contrato.pdf"' }, body: '%PDF-1.4\n%%EOF' });
        }
        return route.fulfill({ json: { activeId: removed ? '' : 'version-current', next: null, versions: [
          { id: 'version-current', name: 'contrato.pdf', mimeType: 'application/pdf', createdAt: null,
            removedAt: removed ? '2026-11-28T12:00:00Z' : null },
          { id: 'version-old', name: 'contrato-anterior.pdf', mimeType: 'application/pdf', createdAt: null, removedAt: null },
        ] } });
      });
      await page.goto('/tests/browser/index.html?route=compliance&compliance.aba=Documentos+por+obra&compliance=attachments');
      const open = page.getByRole('button', { name: 'Anexos de Contrato assinado' });
      await open.click();
      const modal = page.getByRole('dialog', { name: 'Anexos · Contrato assinado' });
      await expect(modal.getByText('Versão anterior')).toBeVisible();
      await modal.getByRole('listitem').filter({ hasText: 'contrato.pdf' })
        .getByRole('button', { name: 'Pré-visualizar' }).click();
      await expect(modal.locator('iframe[title="Prévia de contrato.pdf"]')).toHaveAttribute('src', /^blob:/);
      await expect(modal.getByRole('link', { name: 'Baixar arquivo' })).toBeVisible();
      await modal.getByRole('button', { name: 'Remover anexo' }).click();
      await modal.getByRole('button', { name: 'Confirmar remoção' }).click();
      await expect(modal.getByText('Removido', { exact: true })).toBeVisible();
      await checkAccessibility(page);
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      await expect(open).toBeFocused();
      await checkPageWidth(page);
    });

    test('Relatório da obra permite escolher o mês e volta o foco ao fechar', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
      await page.goto('/tests/browser/index.html?route=planning&planning.aba=Relat%C3%B3rios&materials=delayed');
      const trigger = page.getByRole('button', { name: 'Novo relatório' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Gerar relatório de andamento' });
      const month = dialog.getByLabel('Mês do relatório');
      await expect(month).toHaveValue('2026-11');
      await month.fill('2026-10');
      await expect(dialog.getByText('Nenhuma foto sincronizada para este mês.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled();
      await checkAccessibility(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await checkPageWidth(page);
    });

    test('Material em atraso bloqueia a etapa, atualiza o prazo e exporta o anexo', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-27T12:00:00Z'));
      await page.goto('/tests/browser/index.html?materials=delayed');
      await page.getByRole('button', { name: /Material do cliente em atraso.*Tubos hidráulicos/ }).click();
      const item = page.getByRole('dialog', { name: 'Tubos hidráulicos' });
      await expect(item.getByText('Atrasado', { exact: true })).toBeVisible();
      await expect(item.getByText('25/11/2026', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(item).toHaveCount(0);
      await checkPageWidth(page);
      await checkAccessibility(page);
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: /Cronograma de compras em PDF/ }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe('cronograma-compras-construction.pdf');
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
      await page.getByRole('tab', { name: 'Kanban' }).click();
      await expect(page.getByRole('region', { name: 'Aguardando', exact: true })
        .getByRole('button', { name: '1.1 · Alvenaria', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Cronograma' }).click();
      await expect(page.getByText('11/12/2026', { exact: true }).first()).toBeVisible();
    });

    test('Agenda filtra vencimentos, abre o registro e baixa somente os eventos selecionados', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-27T12:00:00Z'));
      await page.goto('/tests/browser/index.html?agenda=events');
      if (width === 390) {
        await navigation(page).getByRole('button', { name: 'Mais' }).click();
        await page.getByRole('button', { name: /Agenda Vencimentos/ }).click();
        await expect(navigation(page).getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
      } else {
        await navigation(page).getByRole('button', { name: 'Agenda', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible();
      const calendar = page.getByRole('table', { name: 'Calendário mensal de eventos' });
      await expect(calendar.getByRole('button', { name: '27/11/2026 · 3 eventos' })).toBeVisible();
      await checkPageWidth(page);
      await checkAccessibility(page);

      await page.getByRole('button', { name: 'Semana', exact: true }).click();
      await expect(page.getByRole('heading', { name: '23/11/2026 a 29/11/2026' })).toBeVisible();
      await page.getByRole('combobox', { name: /^Obra/ }).selectOption('construction');
      await expect(page.getByRole('button', { name: /Guia de novembro/ })).toHaveCount(0);
      await page.getByLabel('Tipo de evento').selectOption('installment');
      await page.getByRole('button', { name: /Parcela · 01\/04/ }).click();
      await expect(page.getByRole('dialog', { name: 'Parcela · 01/04' })).toBeVisible();
      await expect(page).toHaveURL(/registro=agenda-parcel/);
      await page.goBack();
      await expect(page.getByLabel('Tipo de evento')).toHaveValue('installment');
      await page.getByLabel('Tipo de evento').selectOption('');

      const exportButton = page.getByRole('button', { name: 'Exportar para o Google Agenda' });
      await exportButton.click();
      const dialog = page.getByRole('dialog', { name: 'Exportar para o Google Agenda' });
      await dialog.getByRole('button', { name: 'Limpar seleção' }).click();
      await expect(dialog.getByRole('button', { name: 'Baixar arquivo .ics' })).toBeDisabled();
      await dialog.getByRole('checkbox', { name: /Aluguel de equipamento/ }).check();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Baixar arquivo .ics' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('pilotis-agenda-2026-11-23.ics');
      const body = await readFile(await download.path(), 'utf8');
      expect(body).toMatch(/BEGIN:VCALENDAR\r\nVERSION:2\.0/);
      expect(body).toContain('SUMMARY:Vencimento de conta');
      expect(body).toContain('DTSTART;VALUE=DATE:20261127');
      expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      expect(body).not.toMatch(/R\$|135,00|Aluguel/);

      await page.getByRole('combobox', { name: /^Obra/ }).selectOption('Empresa');
      await page.getByRole('button', { name: /Guia de novembro/ }).click();
      await expect(page.getByRole('dialog', { name: 'Guia de novembro' })).toBeVisible();

      await page.goBack();
      await page.getByRole('combobox', { name: /^Obra/ }).selectOption('');
      await page.getByLabel('Tipo de evento').selectOption('material');
      await page.getByRole('button', { name: /Material · 1\.1 · Alvenaria/ }).click();
      await expect(page.getByRole('dialog', { name: 'Etapa · Alvenaria' })).toBeVisible();
      await page.goBack();
      await page.getByLabel('Tipo de evento').selectOption('warrantyCall');
      await page.getByRole('button', { name: /^Ajuste de vedação/ }).click();
      await expect(page.getByRole('dialog', { name: 'Chamado de garantia' }).getByText('Ajuste de vedação')).toBeVisible();
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

    test('gráficos financeiros correspondem às tabelas e mantêm os rótulos na área rolável', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
      await page.goto('/tests/browser/index.html?route=financial&finance=charts');

      async function openChartTable(title, caption) {
        const figure = page.getByRole('figure', { name: title, exact: true });
        await expect(figure).toBeVisible();
        await figure.locator('summary').press('Enter');
        const table = figure.getByRole('table', { name: caption, exact: true });
        await expect(table).toBeVisible();
        return { figure, table };
      }

      async function checkChartScroll(figure) {
        if (width !== 390) return;
        const area = figure.getByRole('region', { name: /área rolável/ });
        const dimensions = await area.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
          const svg = element.querySelector('svg');
          const size = svg.viewBox.baseVal;
          const clipped = [...svg.querySelectorAll('text')].some((label) => {
            const bounds = label.getBBox();
            return bounds.x < 0 || bounds.x + bounds.width > size.width ||
              bounds.y < 0 || bounds.y + bounds.height > size.height;
          });
          return { scrollLeft: element.scrollLeft, clipped };
        });
        expect(dimensions.scrollLeft).toBeGreaterThan(0);
        expect(dimensions.clipped).toBe(false);
      }

      const expenses = await openChartTable('Composição das despesas pagas', 'Dados do gráfico de composição das despesas pagas');
      await expect(expenses.figure).toContainText(/R\$\s*1\.500,00/);
      await expect(expenses.table.getByRole('row', { name: /^Folha/ })).toContainText(/R\$\s*1\.000,00/);
      await expect(expenses.table.getByRole('row', { name: /^Tributos/ })).toContainText(/R\$\s*250,00/);
      await expect(expenses.table.getByRole('row', { name: /^Juros/ })).toContainText(/R\$\s*100,00/);
      await checkChartScroll(expenses.figure);

      await page.getByRole('tab', { name: 'Fluxo de caixa' }).click();
      const cash = await openChartTable('Entradas x saídas e saldo projetado', 'Dados do gráfico de fluxo de caixa');
      const november = cash.table.getByRole('row', { name: /^Nov\/2026/ });
      await expect(november.getByRole('cell').nth(0)).toHaveText(/R\$\s*500,00/);
      await expect(november.getByRole('cell').nth(1)).toHaveText(/R\$\s*300,00/);
      await expect(november.getByRole('cell').nth(3)).toHaveText(/R\$\s*100,00/);
      await expect(november.getByRole('cell').nth(4)).toHaveText(/R\$\s*1\.500,00/);
      await expect(november.getByRole('cell').nth(5)).toHaveText(/R\$\s*200,00/);
      await expect(november.getByRole('cell').nth(7)).toHaveText(/− R\$\s*800,00/);
      await expect(november.getByRole('cell', { name: 'Negativo' })).toBeVisible();
      await expect(cash.table.getByRole('row', { name: /^Dez\/2026/ }).getByRole('cell').nth(2)).toHaveText(/R\$\s*200,00/);
      await expect(cash.figure.locator('svg text').filter({ hasText: 'Saldo negativo' }).first()).toBeVisible();
      await expect(cash.figure.locator('svg title').filter({ hasText: /Saldo projetado · − R\$\s*800,00/ }).first()).toHaveCount(1);

      await checkChartScroll(cash.figure);
      if (width === 1440) {
        const monthlyTable = page.getByRole('table', { name: 'Projeção mensal do caixa' });
        const sameMonth = monthlyTable.getByRole('row', { name: /^Nov\/2026/ });
        await expect(sameMonth).toContainText('− R$ 800,00');
      }
      await checkPageWidth(page);
      await checkAccessibility(page);

      await page.getByRole('tab', { name: 'DRE por obra' }).click();
      const dre = await openChartTable('Orçado x realizado por categoria', 'Dados do gráfico de DRE por obra');
      const labor = dre.table.getByRole('row', { name: /Mão de obra/ });
      await expect(labor.getByRole('cell').nth(0)).toHaveText(/R\$\s*4\.000,00/);
      await expect(labor.getByRole('cell').nth(1)).toHaveText(/R\$\s*1\.000,00/);
      await expect(dre.figure.locator('svg title').filter({ hasText: /Mão de obra · Realizado · R\$\s*1\.000,00/ })).toHaveCount(1);
      await checkChartScroll(dre.figure);
      if (width === 1440) {
        const tableLabor = page.getByRole('table', { name: 'DRE por obra', exact: true }).getByRole('row', { name: /Mão de obra/ });
        await expect(tableLabor).toContainText('R$ 4.000,00');
        await expect(tableLabor).toContainText('R$ 1.000,00');
      }
      await checkPageWidth(page);
      await checkAccessibility(page);
    });

    test('gráficos financeiros mostram Sem dados no estado inicial', async ({ page }) => {
      await page.goto('/tests/browser/index.html?route=financial&finance=empty');
      const cash = page.getByRole('figure', { name: 'Entradas x saídas e saldo projetado' });
      const expenses = page.getByRole('figure', { name: 'Composição das despesas pagas' });
      for (const figure of [cash, expenses]) {
        await expect(figure.getByText('Sem dados', { exact: true })).toBeVisible();
        await expect(figure.locator('svg')).toHaveCount(0);
      }
      await page.getByRole('tab', { name: 'Fluxo de caixa' }).click();
      await expect(cash.getByText('Sem dados', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'DRE por obra' }).click();
      await expect(page.getByRole('figure', { name: 'Orçado x realizado por categoria' }).getByText('Sem dados', { exact: true })).toBeVisible();
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

    test('aviso da edição oferece Desfazer por oito segundos', async ({ page }) => {
      await openFinance(page);
      const now = new Date();
      await page.clock.install({ time: now });
      await page.clock.pauseAt(new Date(now.getTime() + 1000));
      const show = () => page.evaluate(async () => {
        const { publishEditUndo } = await import('/src/services/editUndo.ts');
        publishEditUndo(async () => { document.body.dataset.editRestored = 'sim'; });
      });
      await show();
      const undo = page.getByRole('button', { name: 'Desfazer', exact: true });
      await expect(undo).toBeVisible();
      await page.clock.fastForward(7999);
      await expect(undo).toBeVisible();
      await undo.evaluate((button) => button.click());
      await expect(page.locator('body')).toHaveAttribute('data-edit-restored', 'sim');
      await show();
      await page.clock.fastForward(8001);
      await expect(undo).toHaveCount(0);
    });

    test('busca global abre o lançamento pela descrição e preserva o foco', async ({ page }) => {
      await page.goto('/tests/browser/index.html');
      const trigger = page.getByRole('button', { name: 'Buscar no sistema' });
      await trigger.click();
      const search = page.getByRole('dialog', { name: 'Busca global' });
      const query = search.getByRole('searchbox', { name: 'Buscar por nome ou número' });
      await expect(query).toBeFocused();
      await query.fill('provante');
      await expect(search.getByRole('heading', { name: 'Financeiro' })).toBeVisible();
      await search.getByRole('button', { name: 'Comprovante de despesa Lançamento' }).click();
      const record = page.getByRole('dialog', { name: 'Comprovante de despesa' });
      await expect(record).toBeVisible();
      await expect(page).toHaveURL(/registro=expense/);
      await page.keyboard.press('Escape');
      await expect(record).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Control+k');
      await expect(query).toBeFocused();
      await checkAccessibility(page);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });

    test('filtros do Financeiro persistem na URL e a folha mantém o foco', async ({ page }) => {
      await openFinance(page);
      const filters = page.getByRole('group', { name: 'Filtros de lançamentos' });
      const query = filters.getByRole('searchbox', { name: 'Buscar lançamentos' });
      await query.fill('DÉSPESA');
      await expect(page).toHaveURL(/lancamentos\.q=/);
      if (width === 390) {
        const trigger = filters.getByRole('button', { name: 'Filtros' });
        await trigger.click();
        const sheet = page.getByRole('dialog', { name: 'Filtros · lançamentos' });
        await sheet.getByRole('combobox', { name: /^Situação/ }).selectOption('Pago');
        const first = sheet.getByRole('button', { name: 'Fechar' });
        const last = sheet.getByRole('button', { name: 'Ver resultados' });
        await first.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(last).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(first).toBeFocused();
        await checkAccessibility(page);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(trigger).toBeFocused();
      } else {
        await filters.getByRole('combobox', { name: /^Situação/ }).selectOption('Pago');
        await page.getByRole('columnheader', { name: 'Valor' }).getByRole('button').click();
        await expect(page.getByRole('columnheader', { name: 'Valor' })).toHaveAttribute('aria-sort', 'ascending');
      }
      await expect(page).toHaveURL(/lancamentos\.status=Pago/);
      await page.reload();
      await expect(query).toHaveValue('DÉSPESA');
      const entry = page.getByRole('button', { name: 'Comprovante de despesa', exact: true });
      await expect(entry).toBeVisible();
      await entry.click();
      await expect(page.getByRole('dialog', { name: 'Comprovante de despesa' })).toBeVisible();
      await page.goBack();
      await expect(query).toHaveValue('DÉSPESA');
      await entry.focus();
      await expect(entry).toBeFocused();
      await query.fill('sem correspondência');
      await expect(page.getByRole('button', { name: 'Comprovante de despesa', exact: true })).toHaveCount(0);
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
