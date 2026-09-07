import { expect, test } from '@playwright/test';
import { BOOT_MS, bootIntoConsole, collectPageErrors } from '../helpers/console';

/**
 * Boot screen regression: scramble, split-text entrance, progress bar and the handover.
 *
 * These are the console's only decorative animations, deliberately confined to a screen the
 * engineer sees once. The assertions therefore have to catch them **mid-flight** — a boot screen
 * that jumps straight to its final state looks identical once settled, which is exactly the
 * failure these tests exist to detect.
 */

test.describe('boot sequence', () => {
    test('the codename scrambles before settling on its final text', async ({ page }) => {
        const errors = collectPageErrors(page);

        // Sample continuously from the moment of navigation: scrambling is brief, and a single
        // read after a fixed sleep can easily land after it has settled.
        await page.goto('/');
        const samples: string[] = [];
        const deadline = Date.now() + 4_000;
        while (Date.now() < deadline) {
            const t = await page
                .evaluate(() => document.querySelector('#boot-codename')?.textContent ?? '')
                .catch(() => '');
            if (t) samples.push(t);
            if (samples.includes('SENTINEL OPS')) break;
            await page.waitForTimeout(60);
        }

        const scrambled = samples.filter((s) => s !== 'SENTINEL OPS' && s.trim() !== '');
        expect(
            scrambled.length,
            'no intermediate text was ever observed — the codename jumped straight to its final value',
        ).toBeGreaterThan(0);

        await expect
            .poll(
                () => page.evaluate(() => document.querySelector('#boot-codename')?.textContent ?? ''),
                { timeout: BOOT_MS, message: 'the codename never settled on its final text' },
            )
            .toBe('SENTINEL OPS');

        expect(errors).toEqual([]);
    });

    test('the headline is split into segments and stays readable to screen readers', async ({ page }) => {
        await page.goto('/');
        await page.locator('#boot-headline').waitFor({ state: 'attached' });
        await page.waitForTimeout(1200);

        // splitText inserts a visually hidden copy of the full text for screen readers and marks
        // the visible segments aria-hidden, so innerText reports the text twice. That is correct
        // behaviour rather than duplication — assert on each part separately.
        const a11y = await page.evaluate(() => {
            const h = document.querySelector('#boot-headline');
            if (!h) return { segments: 0, srText: '', hidden: 0 };
            const sr = h.querySelector<HTMLElement>('[style*="clip"]');
            return {
                segments: h.querySelectorAll('*').length,
                srText: (sr?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                hidden: h.querySelectorAll('[aria-hidden]').length,
            };
        });

        expect(a11y.segments, 'the headline should be split into child segments').toBeGreaterThan(1);
        expect(a11y.srText, 'the full text must remain readable by screen readers').not.toBe('');
        expect(
            a11y.hidden,
            'visible segments should be aria-hidden so the text is not announced twice',
        ).toBeGreaterThan(0);
    });

    test('the progress bar fills rather than sitting at full width', async ({ page }) => {
        // PROGRESS scales along X. An entrance preset would also alter the transform while the
        // bar stayed full width, which is the defect this locks down, so measure the rendered
        // width fraction — what the user actually sees — not merely "the transform changed".
        //
        // Sampling from the test process is too slow to catch this: page.goto() only resolves
        // once Vaadin has bootstrapped, by which point the boot animation can already be over.
        // Install the recorder via an init script so it runs before any application code and
        // observes every frame from inside the page.
        await page.addInitScript(() => {
            const w = window as unknown as { __barSamples: number[] };
            w.__barSamples = [];
            const tick = (): void => {
                const bar = document.querySelector<HTMLElement>('#boot-bar');
                const track = bar?.parentElement;
                if (bar && track) {
                    const tw = track.getBoundingClientRect().width;
                    if (tw > 0) w.__barSamples.push(bar.getBoundingClientRect().width / tw);
                }
                // Keep sampling after the bar is gone; the boot screen is removed on completion
                // and stopping early would discard the final frames.
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });

        await page.goto('/');
        // Wait for the handover, which happens only once the bar has run its course.
        await page.locator('#console-root').waitFor({ state: 'visible', timeout: BOOT_MS });

        const samples: number[] = await page.evaluate(
            () => (window as unknown as { __barSamples: number[] }).__barSamples,
        );

        expect(samples.length, 'the progress bar was never measurable').toBeGreaterThan(2);
        const min = Math.min(...samples);
        const max = Math.max(...samples);
        expect(min, 'the bar should start close to empty').toBeLessThan(0.3);
        expect(max, 'the bar should end close to full').toBeGreaterThan(0.9);
        expect(max - min, 'the bar should visibly grow rather than sit at a fixed width').toBeGreaterThan(0.5);
    });

    test('the sequence is centred on the page at any window size', async ({ page }) => {
        // Regression: the boot screen was a plain Div, so it spanned only its own content and
        // "align-items: center" centred the text inside a narrow column pinned to the top-left.
        // It also used min-height:70vh, which centres within 70% of the viewport rather than
        // the page. Checked at several sizes because a single size can pass by coincidence.
        for (const size of [
            { width: 1500, height: 950 },
            { width: 1200, height: 700 },
            { width: 900, height: 1000 },
        ]) {
            await page.setViewportSize(size);
            await page.goto('/');
            await page.locator('#boot-codename').waitFor({ state: 'attached' });
            await page.waitForTimeout(900);

            const pos = await page.evaluate(() => {
                const screen = document.querySelector('#boot-screen');
                const codename = document.querySelector('#boot-codename');
                if (!screen || !codename) return null;
                const s = screen.getBoundingClientRect();
                const c = codename.getBoundingClientRect();
                return {
                    codenameCentreX: c.left + c.width / 2,
                    blockCentreY: s.top + s.height / 2,
                    pageCentreX: window.innerWidth / 2,
                    pageCentreY: window.innerHeight / 2,
                };
            });

            expect(pos, 'the boot screen should still be on screen').not.toBeNull();
            // A few pixels of tolerance: the block is centred, not each glyph.
            expect(
                Math.abs(pos!.codenameCentreX - pos!.pageCentreX),
                `not horizontally centred at ${size.width}x${size.height}`,
            ).toBeLessThan(4);
            expect(
                Math.abs(pos!.blockCentreY - pos!.pageCentreY),
                `not vertically centred at ${size.width}x${size.height}`,
            ).toBeLessThan(20);
        }
    });

    test('the boot screen is removed and hands over to the console exactly once', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);

        const state = await page.evaluate(() => ({
            bootScreens: document.querySelectorAll('#boot-screen').length,
            consoles: document.querySelectorAll('#console-root').length,
            tabs: document.querySelectorAll('#console-tabs vaadin-tab').length,
        }));

        expect(state.bootScreens, 'the boot screen should be gone after handover').toBe(0);
        expect(state.consoles, 'exactly one console should exist').toBe(1);
        expect(state.tabs, 'the console should expose four tabs').toBe(4);
        expect(errors).toEqual([]);
    });
});
