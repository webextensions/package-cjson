import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        execSync: vi.fn()
    };
});

vi.mock('note-down', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn()
    }
}));

import { execSync } from 'node:child_process';
import { updatePackageCjson } from '../update-package-cjson/update-package-cjson.js';

const makeTempDir = function () {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'package-cjson-update-test-'));
};

const writeCjson = function (dir, contents) {
    const cjsonPath = path.join(dir, 'package.cjson');
    fs.writeFileSync(cjsonPath, contents);
    return cjsonPath;
};

describe('updatePackageCjson', function () {
    let tempDir;
    beforeEach(function () {
        tempDir = makeTempDir();
        execSync.mockReset();
    });
    afterEach(function () {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('updates ^ prefixed dependency versions', function () {
        execSync.mockReturnValue(JSON.stringify({ chalk: '^5.7.0' }));
        const cjsonPath = writeCjson(tempDir, [
            '{',
            '    "dependencies": {',
            '        "chalk": "^5.6.2"',
            '    }',
            '}',
            ''
        ].join('\n'));
        updatePackageCjson(cjsonPath);
        expect(fs.readFileSync(cjsonPath, 'utf8')).toContain('"chalk": "^5.7.0"');
    });

    it('preserves ~ prefix when updating versions', function () {
        execSync.mockReturnValue(JSON.stringify({ chalk: '~5.7.0' }));
        const cjsonPath = writeCjson(tempDir, [
            '{',
            '    "dependencies": {',
            '        "chalk": "~5.6.2"',
            '    }',
            '}',
            ''
        ].join('\n'));
        updatePackageCjson(cjsonPath);
        expect(fs.readFileSync(cjsonPath, 'utf8')).toContain('"chalk": "~5.7.0"');
    });

    it('updates pinned (exact) versions without adding a prefix', function () {
        execSync.mockReturnValue(JSON.stringify({ chalk: '5.7.0' }));
        const cjsonPath = writeCjson(tempDir, [
            '{',
            '    "dependencies": {',
            '        "chalk": "5.6.2"',
            '    }',
            '}',
            ''
        ].join('\n'));
        updatePackageCjson(cjsonPath);
        const after = fs.readFileSync(cjsonPath, 'utf8');
        expect(after).toContain('"chalk": "5.7.0"');
        expect(after).not.toContain('"chalk": "^5.7.0"');
        expect(after).not.toContain('"chalk": "~5.7.0"');
    });

    it('skips packages marked with "="', function () {
        execSync.mockReturnValue(JSON.stringify({ chalk: '=5.7.0' }));
        const original = [
            '{',
            '    "dependencies": {',
            '        "chalk": "^5.6.2"',
            '    }',
            '}',
            ''
        ].join('\n');
        const cjsonPath = writeCjson(tempDir, original);
        updatePackageCjson(cjsonPath);
        expect(fs.readFileSync(cjsonPath, 'utf8')).toBe(original);
    });

    it('preserves comments and surrounding whitespace around updated versions', function () {
        execSync.mockReturnValue(JSON.stringify({ chalk: '^5.7.0' }));
        const cjsonPath = writeCjson(tempDir, [
            '{',
            '    "dependencies": {',
            '        "chalk": "^5.6.2"   // Colors',
            '    }',
            '}',
            ''
        ].join('\n'));
        updatePackageCjson(cjsonPath);
        const updated = fs.readFileSync(cjsonPath, 'utf8');
        expect(updated).toContain('"chalk": "^5.7.0"   // Colors');
    });

    it('updates multiple packages in a single run', function () {
        execSync.mockReturnValue(JSON.stringify({
            chalk: '^5.7.0',
            yargs: '^18.1.0'
        }));
        const cjsonPath = writeCjson(tempDir, [
            '{',
            '    "dependencies": {',
            '        "chalk": "^5.6.2",',
            '        "yargs": "^18.0.0"',
            '    }',
            '}',
            ''
        ].join('\n'));
        updatePackageCjson(cjsonPath);
        const updated = fs.readFileSync(cjsonPath, 'utf8');
        expect(updated).toContain('"chalk": "^5.7.0"');
        expect(updated).toContain('"yargs": "^18.1.0"');
    });

    it('handles pre-release version strings', function () {
        execSync.mockReturnValue(JSON.stringify({ chalk: '^5.7.0-rc.1' }));
        const cjsonPath = writeCjson(tempDir, [
            '{',
            '    "dependencies": {',
            '        "chalk": "^5.6.2"',
            '    }',
            '}',
            ''
        ].join('\n'));
        updatePackageCjson(cjsonPath);
        expect(fs.readFileSync(cjsonPath, 'utf8')).toContain('"chalk": "^5.7.0-rc.1"');
    });

    it('makes no changes when no updates are available', function () {
        execSync.mockReturnValue(JSON.stringify({}));
        const original = [
            '{',
            '    "dependencies": {',
            '        "chalk": "^5.6.2"',
            '    }',
            '}',
            ''
        ].join('\n');
        const cjsonPath = writeCjson(tempDir, original);
        updatePackageCjson(cjsonPath);
        expect(fs.readFileSync(cjsonPath, 'utf8')).toBe(original);
    });

    it('returns an array containing the error when execSync throws', function () {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        execSync.mockImplementation(() => { throw new Error('command failed'); });
        const cjsonPath = writeCjson(tempDir, '{}\n');
        try {
            const result = updatePackageCjson(cjsonPath);
            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toBeInstanceOf(Error);
        } finally {
            consoleErrorSpy.mockRestore();
            consoleLogSpy.mockRestore();
        }
    });
});
