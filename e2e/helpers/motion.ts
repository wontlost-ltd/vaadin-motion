import type { Page } from '@playwright/test';

/**
 * Read helpers for the /stress fixture.
 *
 * The fixture projects server state onto a handful of `<span>` probes, which the tests assert
 * against without touching Motion internals.
 */

/** Exit animation duration in the fixture, kept in sync with MotionStressView.SLOW_MS. */
export const SLOW_MS = 1500;

/** Generous allowance for the animation plus the server round trip to settle. */
export const SETTLE_MS = SLOW_MS + 2500;

export interface StressProbes {
    clicks: number;
    detaches: number;
    /** Whether the rapid-click target is still in the DOM. */
    targetInDom: boolean;
    rapidHostChildren: number;
    victimHostChildren: number;
    status: string;
}

/** Reads every probe in one go. */
export async function readProbes(page: Page): Promise<StressProbes> {
    return page.evaluate(() => {
        const text = (id: string): string =>
            document.querySelector(`#${id}`)?.textContent?.trim() ?? '';
        const children = (id: string): number =>
            document.querySelector(`#${id}`)?.children.length ?? -1;
        return {
            clicks: Number(text('remove-clicks')),
            detaches: Number(text('detach-count')),
            targetInDom: !!document.querySelector('#rapid-target'),
            rapidHostChildren: children('rapid-host'),
            victimHostChildren: children('victim-host'),
            status: text('status'),
        };
    });
}

/**
 * Main-thread responsiveness probe: if the animation logic spins, the event loop is saturated
 * and this never returns.
 *
 * Callers using expect.poll own the timing; this only fires one probe and converts noise such
 * as a destroyed execution context into a retryable value rather than throwing.
 */
export async function mainThreadAlive(page: Page): Promise<string> {
    return page
        .evaluate(() => new Promise<string>((resolve) => setTimeout(() => resolve('alive'), 0)))
        .catch(() => 'unavailable');
}

/**
 * Clicks a button repeatedly inside the exit animation window.
 *
 * Uses `force: true` to bypass the actionability check: the fixture sets
 * `pointer-events: none` during the animation, and the whole point here is to simulate the
 * programmatic burst that a real user cannot produce but an API caller might.
 */
export async function rapidClick(page: Page, selector: string, times: number, gapMs = 30): Promise<void> {
    for (let i = 0; i < times; i++) {
        await page.locator(selector).click({ force: true, timeout: 5_000 });
        if (gapMs > 0) await page.waitForTimeout(gapMs);
    }
}
