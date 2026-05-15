import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

describe('package', function () {
    describe('package-json', function () {
        it('should load fine using import', async function () {
            const result = await execa(
                process.execPath,
                ['--input-type=module', '--eval', "await import('./index.js');"],
                {
                    cwd: packageRoot,
                    reject: false,
                    all: true,
                    stripFinalNewline: false
                }
            );

            expect(result.exitCode).toBe(0);
            expect(result.all).toContain('Please run this module');
        });
    });
});
