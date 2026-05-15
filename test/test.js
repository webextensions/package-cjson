import { describe, it, vi } from 'vitest';

describe('package', function() {
    describe('package-json', function() {
        // If there would be an error in import, the code would not reach this point
        it('should load fine using import', async function() {
            const exitError = new Error('process.exit');
            exitError.code = 0;
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
                throw exitError;
            });
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

            try {
                await import('../index.js');
            } catch (e) {
                if (e !== exitError) {
                    throw e;
                }
            } finally {
                exitSpy.mockRestore();
                consoleLogSpy.mockRestore();
            }
        });
    });
});
