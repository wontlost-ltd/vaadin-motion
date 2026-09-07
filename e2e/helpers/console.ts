import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the Sentinel Ops console (route `/`).
 *
 * The console opens on a boot screen and only then builds the working surface, so every test
 * has the same precondition: wait for the handover. Repeating that inline would make each test
 * responsible for a timing detail that belongs to the application, not to the assertion.
 */

/** Upper bound for the boot sequence: scramble, split headline and progress bar combined. */
export const BOOT_MS = 12_000;

/** Allowance for one animation plus its server round trip. */
export const SETTLE_MS = 8_000;

/**
 * Waits until the boot screen has handed over to the console.
 *
 * Waits on the console appearing rather than sleeping a fixed interval: the boot duration varies
 * with machine speed, and a sleep would either flake or waste time on every test.
 */
export async function bootIntoConsole(page: Page): Promise<void> {
    await page.goto('/');
    // Deliberately not waiting for #boot-screen first: under prefers-reduced-motion every
    // duration collapses to zero, so the boot screen can be gone before the first check runs.
    // The console appearing is the actual precondition, and it implies the handover happened.
    await page.locator('#console-root').waitFor({ state: 'visible', timeout: BOOT_MS });
    // The console fades in as a unit; wait for that to finish so measurements are not taken
    // against a partially transparent, still-moving surface.
    await expect
        .poll(
            () =>
                page.evaluate(
                    () => Number(getComputedStyle(document.querySelector('#console-root')!).opacity),
                ),
            { timeout: BOOT_MS, message: 'the console never finished fading in' },
        )
        .toBeGreaterThan(0.95);
}

/** Switches to a console tab and waits for its panel to be mounted. */
export async function openTab(
    page: Page,
    tab: 'queue' | 'topology' | 'postmortem' | 'warroom',
): Promise<void> {
    await page.locator(`#tab-${tab}`).click();
    const anchor = {
        queue: '#incident-queue',
        topology: '#topology-body',
        postmortem: '#postmortem-content',
        warroom: '#war-room-board',
    }[tab];
    await page.locator(anchor).waitFor({ state: 'attached', timeout: SETTLE_MS });
}

/** Collects uncaught page errors for a test to assert on. */
export function collectPageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return errors;
}

/** Incident ids currently in the queue, in display order. */
export async function queueIds(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll('#incident-queue > div')]
            .map((row) => (row.textContent ?? '').match(/INC-\d+/)?.[0] ?? '')
            .filter(Boolean),
    );
}

/** Reads the four metric figures as numbers, stripping thousands separators. */
export async function metrics(
    page: Page,
): Promise<{ open: number; sev1: number; users: number; closed: number }> {
    return page.evaluate(() => {
        const n = (id: string): number =>
            Number((document.querySelector(`#${id}`)?.textContent ?? '').replace(/[^\d.]/g, ''));
        return {
            open: n('metric-open'),
            sev1: n('metric-sev1'),
            users: n('metric-users'),
            closed: n('metric-closed'),
        };
    });
}

/**
 * Drags an element by a displacement using real pointer events, returning how far it moved.
 *
 * Real pointer events rather than a scripted transform: the whole point is to exercise the
 * connector's own pointer handling.
 */
export async function drag(
    page: Page,
    selector: string,
    dx: number,
    dy: number,
): Promise<{ dx: number; dy: number }> {
    const el = page.locator(selector);
    const before = await el.boundingBox();
    if (!before) throw new Error(`element not found: ${selector}`);
    // Grab near the top-left so wide elements are still picked up inside their own bounds.
    const grabX = before.x + Math.min(60, before.width / 2);
    const grabY = before.y + Math.min(20, before.height / 2);
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + dx, grabY + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const after = await el.boundingBox();
    if (!after) throw new Error(`element vanished after dragging: ${selector}`);
    return { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) };
}

/** Drags queue row `from` onto row `to`, returning the resulting incident order. */
export async function dragRow(page: Page, from: number, to: number): Promise<string[]> {
    const rows = page.locator('#incident-queue > div');
    const a = await rows.nth(from).boundingBox();
    const t = await rows.nth(to).boundingBox();
    if (!a || !t) throw new Error('queue rows are not visible');
    const startY = a.y + a.height / 2;
    const dy = t.y + t.height / 2 - startY;
    // Grab the drag handle at the far left, clear of the Acknowledge / Resolve buttons.
    const x = a.x + 24;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
        await page.mouse.move(x, startY + (dy * i) / 14);
        await page.waitForTimeout(35);
    }
    await page.mouse.up();
    await page.waitForTimeout(900);
    return queueIds(page);
}
