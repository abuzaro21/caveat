// Browser tests: the three scenarios end to end against the real server, on desktop and mobile.
import { test, expect, type Page } from '@playwright/test';

const mobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
async function tab(page: Page, name: 'Assistant' | 'Evidence' | 'Memory') {
  if (mobile(page)) await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name }).click();
}
async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/409/.test(m.text())) errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Talking to Maya' })).toBeVisible();
  return errors;
}
const guide = (page: Page, name: string) => page.getByRole('navigation', { name: 'Guided demo' }).getByRole('button', { name });

test('A: a conflicting preference blocks the booking until the person answers', async ({ page }) => {
  const errors = await open(page);
  await guide(page, 'Book the sofa').click();
  const card = page.locator('.ask-card').first();
  await expect(card).toContainText('Ask first');
  await expect(card).toContainText('Nothing was booked');
  await expect(page.locator('.msg-caveat').last()).toContainText('I might be wrong about this.');
  await expect(page.locator('.booking')).toHaveCount(0);
  await tab(page, 'Evidence');
  await expect(page.getByRole('group', { name: 'Conflicting evidence' })).toContainText('ParcelCo delivery log');
  await tab(page, 'Assistant');
  await card.getByRole('button', { name: 'Afternoons' }).click();
  await expect(page.locator('.booking').first()).toContainText('afternoons');
  await expect(page.locator('.booking').first()).toContainText('Mon, 16 Nov 2026');
  expect(errors).toEqual([]);
});

test('B: a memory past its horizon is re-checked before acting, and reconfirming makes it fresh', async ({ page }) => {
  const errors = await open(page);
  await guide(page, 'Jump 30 days ahead').click();
  await expect(page.locator('.clock')).toContainText('12 Dec 2026');
  await guide(page, 'Send the repair to the office').click();
  const card = page.locator('.ask-card').first();
  await expect(card).toContainText('Is this still right');
  await expect(page.locator('.msg-caveat').last()).toContainText('113 days ago');
  await card.getByRole('button', { name: /Yes, still/ }).click();
  await expect(page.locator('.msg-system').filter({ hasText: 'Reconfirmed' })).toBeVisible();
  await expect(page.locator('.booking').first()).toContainText('office');
  expect(errors).toEqual([]);
});

test('C: forgetting is verified, survives a reload, and an old backup and a stale job cannot bring it back', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Where am I on Friday afternoon?' }).click();
  await expect(page.locator('.msg-caveat').last()).toContainText('Harbour Physio');
  await guide(page, 'Forget the private location').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Forget it' }).click();
  await expect(dialog).toContainText('Forgotten, and verified');
  await expect(dialog.locator('.checks .fail')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Run the proofs' }).click();
  await expect(dialog.locator('.proof-pass')).toHaveCount(6, { timeout: 20_000 });
  await expect(dialog.locator('.proof-fail')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('body')).not.toContainText(/Harbour|Physio|Flores/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Talking to Maya' })).toBeVisible();
  await tab(page, 'Memory');
  await expect(page.locator('.inspector')).not.toContainText(/Harbour|Physio|Flores/);
  await page.getByRole('tab', { name: /Forgotten/ }).click();
  await expect(page.locator('.mem-forgotten')).toContainText('Private recurring location');
  expect(errors).toEqual([]);
});

// Codex review 2, finding 1: a short, common-looking memory ("Gym") must not survive in the page after it is forgotten.
test('C2: a relearned short memory, once forgotten, is gone from the page too, and the page proof checks it', async ({ page }) => {
  const errors = await open(page);
  await guide(page, 'Forget the private location').click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /may relearn/ }).click();
  await dialog.getByRole('button', { name: 'Forget it' }).click();
  await expect(dialog).toContainText('Forgotten, and verified');
  await dialog.getByRole('button', { name: 'Close' }).click();
  const told = await page.request.post('/api/tell', { data: { predicate: 'location.private', value: { label: 'Gym', day: 'fri', from: 15, to: 17 }, excerpt: 'Gym' } });
  expect(told.ok()).toBe(true);
  await page.getByRole('button', { name: 'Where am I on Friday afternoon?' }).click();
  await expect(page.locator('.msg-caveat').last()).toContainText('Gym');
  await guide(page, 'Forget the private location').click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Forget it' }).click();
  await expect(dialog).toContainText('Forgotten, and verified');
  await dialog.getByRole('button', { name: 'Run the proofs' }).click();
  await expect(dialog.locator('.proof-pass')).toHaveCount(6, { timeout: 20_000 });
  await expect(dialog.locator('.proof-fail')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('body')).not.toContainText(/\bGym\b/);
  expect(errors).toEqual([]);
});

test('sessions are isolated: forgetting in one visitor session leaves another untouched', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const pa = await a.newPage(), pb = await b.newPage();
  await open(pa); await open(pb);
  await guide(pa, 'Forget the private location').click();
  await pa.getByRole('dialog').getByRole('button', { name: 'Forget it' }).click();
  await expect(pa.getByRole('dialog')).toContainText('Forgotten, and verified');
  const st = await pb.evaluate(async () => (await fetch('/api/state')).json());
  expect(JSON.stringify(st)).toContain('Harbour Physio');
  expect(st.tombstones).toEqual([]);
  await a.close(); await b.close();
});

test('the forget dialog is a real modal: Escape closes it and nothing was deleted', async ({ page }) => {
  await open(page);
  await guide(page, 'Forget the private location').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const st = await page.evaluate(async () => (await fetch('/api/state')).json());
  expect(st.tombstones).toEqual([]);
});

test('the naive baseline is shown as a negative control on the same inputs', async ({ page }) => {
  await open(page);
  await guide(page, 'Book the sofa').click();
  await tab(page, 'Evidence');
  await page.getByRole('button', { name: 'Show what a naive memory does' }).click();
  await expect(page.locator('.naive-body')).toContainText(/evening/i);
  await expect(page.locator('.naive-body')).toContainText('brings it straight back');
});
