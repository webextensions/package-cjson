import { describe, it, vi } from 'vitest';

describe('package', function() {
    describe('package-json', function() {
        // If there would be an error in import, the code would not reach this point
        it('should load fine using import', async function() {
            vi.spyOn(process, 'exit').mockImplementation(() => undefined);
            await import('../index.js');
        });
    });
});
