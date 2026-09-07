import { expect, test } from '@playwright/test';
import { bootIntoConsole, collectPageErrors, drag, openTab } from '../helpers/console';

/**
 * War-room regression: free dragging with grid snapping, unbinding, and the reactive marker.
 *
 * The board lives behind its own tab, so each test opens it first; the bindings are established
 * on attach, which makes this also a check that they survive being mounted on demand.
 *
 * Dragging registers persistent pointer listeners, so besides "it moves" the tests must cover
 * "it stops moving once unbound" — otherwise repeat bindings stack listeners silently and the
 * lock control does nothing.
 */

test.describe('draggable notes', () => {
    test('a note can be dragged freely on both axes', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'warroom');
        await page.locator('#note-hypothesis').waitFor();
        await page.waitForTimeout(1200);

        const moved = await drag(page, '#note-hypothesis', 180, 90);
        expect(Math.abs(moved.dx), 'the note should move horizontally').toBeGreaterThan(50);
        expect(Math.abs(moved.dy), 'the note should move vertically').toBeGreaterThan(20);
        expect(errors).toEqual([]);
    });

    test('the board is wide enough for its notes to be reachable', async ({ page }) => {
        // Regression: the board holds only absolutely-positioned children, so it had no
        // intrinsic width and collapsed to 2px inside the flex column, rendering its notes
        // outside the visible area where no pointer could ever reach them.
        await bootIntoConsole(page);
        await openTab(page, 'warroom');
        const box = await page.locator('#war-room-board').boundingBox();
        expect(box, 'the board should be laid out').not.toBeNull();
        expect(box!.width, 'the board collapsed — its notes are unreachable').toBeGreaterThan(200);
        expect(box!.height, 'the board should have its declared height').toBeGreaterThan(200);
    });

    test('displacement snaps to the grid step', async ({ page }) => {
        await bootIntoConsole(page);
        await openTab(page, 'warroom');
        await page.locator('#note-evidence').waitFor();
        await page.waitForTimeout(1200);

        // Drag 47px, which is not a multiple of 20; the landing point must snap to one.
        const moved = await drag(page, '#note-evidence', 47, 0);
        expect(moved.dx % 20, `displacement ${moved.dx} should be a multiple of the 20px grid`).toBe(0);
    });

    test('locking the board stops the notes moving', async ({ page }) => {
        // If unbinding did not take effect the pointer listeners linger and the notes still move,
        // so the lock would silently do nothing.
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'warroom');
        await page.locator('#btn-lock-board').waitFor();
        await page.waitForTimeout(1200);

        await page.locator('#btn-lock-board').click();
        await page.waitForTimeout(800);

        const moved = await drag(page, '#note-hypothesis', 160, 60);
        expect(moved.dx, 'no horizontal movement once locked').toBe(0);
        expect(moved.dy, 'no vertical movement once locked').toBe(0);
        expect(errors).toEqual([]);
    });

    test('unlocking restores dragging', async ({ page }) => {
        // Guards the release path: a lock that cannot be undone would strand the board.
        await bootIntoConsole(page);
        await openTab(page, 'warroom');
        await page.locator('#btn-lock-board').waitFor();
        await page.waitForTimeout(1200);

        await page.locator('#btn-lock-board').click();
        await page.waitForTimeout(600);
        await page.locator('#btn-lock-board').click();
        await page.waitForTimeout(600);

        const moved = await drag(page, '#note-action', 120, 40);
        expect(Math.abs(moved.dx), 'dragging should work again after unlocking').toBeGreaterThan(50);
    });
});

test.describe('focus marker', () => {
    test('the marker follows the pointer across the board', async ({ page }) => {
        const errors = collectPageErrors(page);
        await bootIntoConsole(page);
        await openTab(page, 'warroom');
        const board = page.locator('#war-room-board');
        await board.waitFor();
        // Scroll into view first: with the board below the fold the mouse never enters it and
        // mousemove never fires, which reads as the feature being broken.
        await board.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);

        const box = await board.boundingBox();
        if (!box) throw new Error('the war-room board is not visible');

        const markerX = (): Promise<number> =>
            page.evaluate(() => {
                const tr = document.querySelector<HTMLElement>('#focus-marker')?.style.transform ?? '';
                return Number((tr.match(/-?\d+(\.\d+)?/g) ?? ['0'])[0]);
            });

        // Move to the left of the board, well clear of the notes so no drag is initiated.
        await page.mouse.move(box.x + 40, box.y + box.height - 30);
        await page.waitForTimeout(700);
        const near = await markerX();

        await page.mouse.move(box.x + box.width - 40, box.y + box.height - 30);
        await page.waitForTimeout(700);
        const far = await markerX();

        expect(far, 'the marker should follow the pointer to the right').toBeGreaterThan(near + 100);
        expect(errors).toEqual([]);
    });
});
