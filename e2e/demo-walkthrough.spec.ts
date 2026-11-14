import { expect, test, type Page } from '@playwright/test';

const STEPS = [
  'the chart opens without onboarding',
  'search "123132" opens Alex Wu',
  '"open MRI scans" opens the scanner',
  'the scanner has real slices or the text placeholder, and no drawn brain',
  'typed "contact emergency" shows the toast',
  'prescription sends only after confirm',
  'the simulated panels update',
] as const;

async function command(page: Page, text: string): Promise<void> {
  await page.getByLabel('Command').fill(text);
  await page.getByRole('button', { name: 'Go' }).click();
}

test('demonstration walkthrough', async ({ page }) => {
  test.setTimeout(90_000);
  const results: { name: string; ok: boolean }[] = [];

  const step = async (name: (typeof STEPS)[number], run: () => Promise<void>) => {
    try {
      await run();
      console.log(`PASS  ${name}`);
      results.push({ name, ok: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.log(`FAIL  ${name} — ${detail}`);
      results.push({ name, ok: false });
    }
  };

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.route('**/api/demo/messaging**', (route) => route.abort());

  await step(STEPS[0], async () => {
    await page.goto('/demo');
    await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
    await expect(page.getByText('Theatre 5')).toBeVisible();
    await expect(page.getByText('Demonstration software, mock data')).toBeVisible();
  });

  await step(STEPS[1], async () => {
    await page.getByLabel('Search by name or MRN').fill('123132');
    await page.getByLabel('Search by name or MRN').press('Enter');
    await page.getByRole('row', { name: /Alex Wu/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Alex Wu/ })).toBeVisible();
    await expect(page.getByText('MRN 123132')).toBeVisible();
  });

  await step(STEPS[2], async () => {
    await command(page, 'open MRI scans');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('canvas[data-demo-brain]')).toHaveCount(0);
    await expect(dialog.locator('canvas[data-mri-slices], [data-mri-placeholder]')).toBeVisible();
  });

  await step(STEPS[3], async () => {
    const dialog = page.getByRole('dialog');
    await expect(page.locator('canvas[data-demo-brain]')).toHaveCount(0);
    const placeholder = dialog.locator('[data-mri-placeholder]');
    if ((await placeholder.count()) > 0) {
      await expect(placeholder).toHaveText('No MRI loaded for this patient. Real scans come from the NeuroView case.');
      await expect(dialog.locator('canvas, svg')).toHaveCount(0);
      return;
    }
    await expect(dialog.locator('canvas[data-mri-slices]')).toBeVisible();
    await expect(dialog).toContainText('NeuroView case');
  });

  await step(STEPS[4], async () => {
    await command(page, 'contact emergency');
    await expect(page.getByRole('alert')).toContainText('Simulated');
    await expect(page.getByRole('alert')).toContainText('Emergency team paged. Assistant on the way. ETA 2 minutes.');
  });

  const patientPhone = page.locator('.ehr-phone', { hasText: 'Patient: Alex Wu' });
  const hospitalPhone = page.locator('.ehr-phone', { hasText: 'Hospital software inbox' });

  await step(STEPS[5], async () => {
    await command(page, 'send prescription to patient');
    await expect(page.getByText('Draft — not sent')).toBeVisible();
    await expect(patientPhone).toContainText('No messages on this phone.');
    await command(page, 'confirm');
    await expect(patientPhone).toContainText('Levetiracetam');
    await expect(patientPhone).not.toContainText('No messages on this phone.');
  });

  await step(STEPS[6], async () => {
    await expect(patientPhone.locator('.ehr-badge')).toHaveText('SIMULATED');
    await expect(hospitalPhone.locator('.ehr-badge')).toHaveText('SIMULATED');
    await expect(patientPhone).toContainText('sent');
    await command(page, 'send update to hospital software');
    await expect(hospitalPhone).toContainText('No messages on this phone.');
    await command(page, 'confirm');
    await expect(hospitalPhone).toContainText('Theatre 5');
    await expect(patientPhone).toContainText('Levetiracetam');
  });

  const failed = results.filter((item) => !item.ok).map((item) => item.name);
  expect(failed, failed.join('; ')).toEqual([]);
});
