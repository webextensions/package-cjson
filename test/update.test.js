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

const packageCjsonWithDependency = function (version, suffix = '') {
    return [
        '{',
        '    "dependencies": {',
        `        "chalk": "${version}"${suffix}`,
        '    }',
        '}',
        ''
    ].join('\n');
};

const packageCjsonWithDependencies = function (dependencies) {
    const lines = dependencies.map(([name, version], index) => {
        const comma = index === dependencies.length - 1 ? '' : ',';
        return `        "${name}": "${version}"${comma}`;
    });

    return [
        '{',
        '    "dependencies": {',
        ...lines,
        '    }',
        '}',
        ''
    ].join('\n');
};

describe('updatePackageCjson', function () {
    let tempDir;
    let cjsonPath;

    const writeCjson = function (contents) {
        cjsonPath = path.join(tempDir, 'package.cjson');
        fs.writeFileSync(cjsonPath, contents);
        return cjsonPath;
    };

    const readCjson = function () {
        return fs.readFileSync(cjsonPath, 'utf8');
    };

    const updateWith = function (updates, contents) {
        execSync.mockReturnValue(JSON.stringify(updates));
        updatePackageCjson(writeCjson(contents));
        return readCjson();
    };

    beforeEach(function () {
        tempDir = makeTempDir();
        execSync.mockReset();
    });

    afterEach(function () {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it.each([
        ['^ prefixed', '^5.6.2', '^5.7.0', ['"chalk": "^5.7.0"'], []],
        ['~ prefixed', '~5.6.2', '~5.7.0', ['"chalk": "~5.7.0"'], []],
        ['pinned', '5.6.2', '5.7.0', ['"chalk": "5.7.0"'], ['"chalk": "^5.7.0"', '"chalk": "~5.7.0"']],
        ['pre-release', '^5.6.2', '^5.7.0-rc.1', ['"chalk": "^5.7.0-rc.1"'], []],
        ['with comments and whitespace', '^5.6.2', '^5.7.0', ['"chalk": "^5.7.0"   // Colors'], []]
    ])('updates %s dependency versions', function (description, originalVersion, updatedVersion, expectedSnippets, absentSnippets) {
        const suffix = description === 'with comments and whitespace' ? '   // Colors' : '';
        const updated = updateWith(
            { chalk: updatedVersion },
            packageCjsonWithDependency(originalVersion, suffix)
        );

        for (const snippet of expectedSnippets) {
            expect(updated).toContain(snippet);
        }
        for (const snippet of absentSnippets) {
            expect(updated).not.toContain(snippet);
        }
    });

    it('skips packages marked with "="', function () {
        const original = packageCjsonWithDependency('^5.6.2');
        const updated = updateWith({ chalk: '=5.7.0' }, original);

        expect(updated).toBe(original);
    });

    it('updates multiple packages in a single run', function () {
        const updated = updateWith(
            {
                chalk: '^5.7.0',
                yargs: '^18.1.0'
            },
            packageCjsonWithDependencies([
                ['chalk', '^5.6.2'],
                ['yargs', '^18.0.0']
            ])
        );

        expect(updated).toContain('"chalk": "^5.7.0"');
        expect(updated).toContain('"yargs": "^18.1.0"');
    });

    it('makes no changes when no updates are available', function () {
        const original = packageCjsonWithDependency('^5.6.2');
        const updated = updateWith({}, original);

        expect(updated).toBe(original);
    });

    it('returns an array containing the error when execSync throws', function () {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        execSync.mockImplementation(() => { throw new Error('command failed'); });
        writeCjson('{}\n');

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
