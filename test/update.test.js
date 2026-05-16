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

const cjsonWithDependency = function (version, suffix = '') {
    return [
        '{',
        '    "dependencies": {',
        `        "chalk": "${version}"${suffix}`,
        '    }',
        '}',
        ''
    ].join('\n');
};

const cjsonWithDependencies = function (dependencies) {
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

const moduleWithDependency = function (version, { quote = "'", quoteKey = true } = {}) {
    const keyText = quoteKey ? `${quote}chalk${quote}` : 'chalk';
    return [
        'export default {',
        '    dependencies: {',
        `        ${keyText}: ${quote}${version}${quote}`,
        '    }',
        '};',
        ''
    ].join('\n');
};

const sourceFileNames = {
    cjson: 'package.cjson',
    js: 'package.json.js',
    ts: 'package.json.ts'
};

describe('updatePackageCjson', function () {
    let tempDir;
    let sourceFilePath;

    const writeSource = function (fileName, contents) {
        sourceFilePath = path.join(tempDir, fileName);
        fs.writeFileSync(sourceFilePath, contents);
        return sourceFilePath;
    };

    const readSource = function () {
        return fs.readFileSync(sourceFilePath, 'utf8');
    };

    const updateWith = function (updates, fileName, contents) {
        execSync.mockReturnValue(JSON.stringify(updates));
        updatePackageCjson(writeSource(fileName, contents));
        return readSource();
    };

    beforeEach(function () {
        tempDir = makeTempDir();
        execSync.mockReset();
    });

    afterEach(function () {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('package.cjson', function () {
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
                sourceFileNames.cjson,
                cjsonWithDependency(originalVersion, suffix)
            );

            for (const snippet of expectedSnippets) {
                expect(updated).toContain(snippet);
            }
            for (const snippet of absentSnippets) {
                expect(updated).not.toContain(snippet);
            }
        });

        it('skips packages marked with "="', function () {
            const original = cjsonWithDependency('^5.6.2');
            const updated = updateWith({ chalk: '=5.7.0' }, sourceFileNames.cjson, original);

            expect(updated).toBe(original);
        });

        it('updates multiple packages in a single run', function () {
            const updated = updateWith(
                {
                    chalk: '^5.7.0',
                    yargs: '^18.1.0'
                },
                sourceFileNames.cjson,
                cjsonWithDependencies([
                    ['chalk', '^5.6.2'],
                    ['yargs', '^18.0.0']
                ])
            );

            expect(updated).toContain('"chalk": "^5.7.0"');
            expect(updated).toContain('"yargs": "^18.1.0"');
        });

        it('makes no changes when no updates are available', function () {
            const original = cjsonWithDependency('^5.6.2');
            const updated = updateWith({}, sourceFileNames.cjson, original);

            expect(updated).toBe(original);
        });
    });

    // Sanity-check that the same update logic still works for `package.json.js` and `package.json.ts`.
    // The regex needs to recognize single/double-quoted string literals as well as bare identifier keys.
    describe.each([
        ['package.json.js', sourceFileNames.js],
        ['package.json.ts', sourceFileNames.ts]
    ])('%s', function (_label, fileName) {
        it('updates single-quoted string-key entries', function () {
            const updated = updateWith(
                { chalk: '^5.7.0' },
                fileName,
                moduleWithDependency('^5.6.2', { quote: "'", quoteKey: true })
            );

            expect(updated).toContain("'chalk': '^5.7.0'");
            expect(updated).not.toContain("'chalk': '^5.6.2'");
        });

        it('updates double-quoted string-key entries', function () {
            const updated = updateWith(
                { chalk: '^5.7.0' },
                fileName,
                moduleWithDependency('^5.6.2', { quote: '"', quoteKey: true })
            );

            expect(updated).toContain('"chalk": "^5.7.0"');
            expect(updated).not.toContain('"chalk": "^5.6.2"');
        });

        it('updates bare-identifier keys', function () {
            const updated = updateWith(
                { chalk: '^5.7.0' },
                fileName,
                moduleWithDependency('^5.6.2', { quote: "'", quoteKey: false })
            );

            expect(updated).toContain("chalk: '^5.7.0'");
            expect(updated).not.toContain("chalk: '^5.6.2'");
        });

        it('preserves the quote style used by the value', function () {
            const original = moduleWithDependency('^5.6.2', { quote: "'", quoteKey: false });
            const updated = updateWith({ chalk: '^5.7.0' }, fileName, original);

            // The output should still use single quotes (not get converted to double quotes).
            expect(updated).toContain("'^5.7.0'");
            expect(updated).not.toContain('"^5.7.0"');
        });

        it('updates pre-release versions', function () {
            const updated = updateWith(
                { chalk: '^5.7.0-rc.1' },
                fileName,
                moduleWithDependency('^5.6.2', { quote: "'", quoteKey: true })
            );

            expect(updated).toContain("'chalk': '^5.7.0-rc.1'");
        });

        it('skips packages marked with "="', function () {
            const original = moduleWithDependency('^5.6.2', { quote: "'", quoteKey: true });
            const updated = updateWith({ chalk: '=5.7.0' }, fileName, original);

            expect(updated).toBe(original);
        });

        it('leaves computed-key entries untouched (known limitation)', function () {
            const original = [
                "const dependencyName = 'chalk';",
                '',
                'export default {',
                '    dependencies: {',
                "        [dependencyName]: '^5.6.2'",
                '    }',
                '};',
                ''
            ].join('\n');
            const updated = updateWith({ chalk: '^5.7.0' }, fileName, original);

            expect(updated).toBe(original);
        });

        it('does not partial-match similarly-named packages', function () {
            // `eslint` should not match inside `@eslint/js`. The regex requires `:` immediately after
            // the key (with optional whitespace), and `@eslint/js` is followed by `/js`, so the
            // bare-identifier alternative must not produce a false positive here.
            const original = [
                'export default {',
                '    devDependencies: {',
                '        "@eslint/js": "^10.0.1",',
                '        "eslint": "^10.3.0"',
                '    }',
                '};',
                ''
            ].join('\n');
            const updated = updateWith({ eslint: '^10.4.0' }, fileName, original);

            expect(updated).toContain('"@eslint/js": "^10.0.1"');
            expect(updated).toContain('"eslint": "^10.4.0"');
        });
    });

    it('returns an array containing the error when execSync throws', function () {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        execSync.mockImplementation(() => { throw new Error('command failed'); });
        writeSource(sourceFileNames.cjson, '{}\n');

        try {
            const result = updatePackageCjson(sourceFilePath);
            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toBeInstanceOf(Error);
        } finally {
            consoleErrorSpy.mockRestore();
            consoleLogSpy.mockRestore();
        }
    });
});
