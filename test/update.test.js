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
import { logger } from 'note-down';
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

    // The version-range prefixes declared in package.json drive the update policy, so every scenario needs
    // a package.json alongside the source file (in real usage, package.json is generated from that source).
    const writeDeclaredPackageJson = function (dependencySections) {
        fs.writeFileSync(
            path.join(tempDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'package-cjson-update-test',
                    version: '1.0.0',
                    ...dependencySections
                },
                null,
                4
            )
        );
    };

    // `latest` is the payload of the default `npm-check-updates --jsonUpgraded` pass and `minor` is the
    // payload of its `--target minor` pass (which only runs when a "~" entry is declared).
    const mockNpmCheckUpdates = function (latest, minor) {
        execSync.mockImplementation(function (command) {
            return JSON.stringify(command.includes('--target minor') ? minor : latest);
        });
    };

    const updateWith = function ({ declared, latest = {}, minor = {}, fileName, contents }) {
        writeDeclaredPackageJson(Array.isArray(declared) ? Object.fromEntries(declared) : { dependencies: declared });
        mockNpmCheckUpdates(latest, minor);
        updatePackageCjson(writeSource(fileName, contents));
        return readSource();
    };

    const warnedWith = function (substring) {
        return logger.warn.mock.calls.some(([message]) => String(message).includes(substring));
    };

    beforeEach(function () {
        tempDir = makeTempDir();
        execSync.mockReset();
        logger.error.mockClear();
        logger.info.mockClear();
        logger.success.mockClear();
        logger.warn.mockClear();
    });

    afterEach(function () {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('package.cjson', function () {
        it.each([
            ['^ prefixed', '^5.6.2', { latest: { chalk: '^5.7.0' } }, ['"chalk": "^5.7.0"'], []],
            ['~ prefixed', '~5.6.2', { latest: { chalk: '~5.7.0' }, minor: { chalk: '~5.7.0' } }, ['"chalk": "~5.7.0"'], []],
            ['pinned', '5.6.2', { latest: { chalk: '5.7.0' } }, ['"chalk": "5.7.0"'], ['"chalk": "^5.7.0"', '"chalk": "~5.7.0"']],
            ['pre-release', '^5.6.2', { latest: { chalk: '^5.7.0-rc.1' } }, ['"chalk": "^5.7.0-rc.1"'], []],
            ['with comments and whitespace', '^5.6.2', { latest: { chalk: '^5.7.0' } }, ['"chalk": "^5.7.0"   // Colors'], []]
        ])('updates %s dependency versions', function (description, originalVersion, upgrades, expectedSnippets, absentSnippets) {
            const suffix = description === 'with comments and whitespace' ? '   // Colors' : '';
            const updated = updateWith({
                declared: { chalk: originalVersion },
                ...upgrades,
                fileName: sourceFileNames.cjson,
                contents: cjsonWithDependency(originalVersion, suffix)
            });

            for (const snippet of expectedSnippets) {
                expect(updated).toContain(snippet);
            }
            for (const snippet of absentSnippets) {
                expect(updated).not.toContain(snippet);
            }
        });

        it('skips packages marked with "="', function () {
            const original = cjsonWithDependency('=5.6.2');
            const updated = updateWith({
                declared: { chalk: '=5.6.2' },
                latest: { chalk: '=5.7.0' },
                fileName: sourceFileNames.cjson,
                contents: original
            });

            expect(updated).toBe(original);
            expect(warnedWith('Please update manually to: chalk@=5.7.0')).toBe(true);
        });

        it('updates multiple packages in a single run', function () {
            const updated = updateWith({
                declared: {
                    chalk: '^5.6.2',
                    yargs: '^18.0.0'
                },
                latest: {
                    chalk: '^5.7.0',
                    yargs: '^18.1.0'
                },
                fileName: sourceFileNames.cjson,
                contents: cjsonWithDependencies([
                    ['chalk', '^5.6.2'],
                    ['yargs', '^18.0.0']
                ])
            });

            expect(updated).toContain('"chalk": "^5.7.0"');
            expect(updated).toContain('"yargs": "^18.1.0"');
        });

        it('makes no changes when no updates are available', function () {
            const original = cjsonWithDependency('^5.6.2');
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                fileName: sourceFileNames.cjson,
                contents: original
            });

            expect(updated).toBe(original);
        });
    });

    describe('version-range policy', function () {
        const updateChalk = function ({ declared, latest, minor }) {
            return updateWith({
                declared: { chalk: declared },
                latest,
                minor,
                fileName: sourceFileNames.cjson,
                contents: cjsonWithDependency(declared)
            });
        };

        it('lets a "^" entry cross a major boundary', function () {
            const updated = updateChalk({
                declared: '^5.6.2',
                latest: { chalk: '^6.0.0' }
            });

            expect(updated).toContain('"chalk": "^6.0.0"');
        });

        it('lets a bare version cross a major boundary and keeps it bare', function () {
            const updated = updateChalk({
                declared: '5.6.2',
                latest: { chalk: '6.0.0' }
            });

            expect(updated).toContain('"chalk": "6.0.0"');
            expect(updated).not.toContain('"chalk": "^6.0.0"');
        });

        it('keeps a "~" entry within its major', function () {
            const updated = updateWith({
                declared: { '@types/node': '~24.0.0' },
                latest: { '@types/node': '~26.0.1' },
                minor: { '@types/node': '~24.13.3' },
                fileName: sourceFileNames.cjson,
                contents: cjsonWithDependencies([['@types/node', '~24.0.0']])
            });

            expect(updated).toContain('"@types/node": "~24.13.3"');
            expect(updated).not.toContain('~26.0.1');
        });

        it('reports the major a "~" entry was held back from', function () {
            updateChalk({
                declared: '~5.6.2',
                latest: { chalk: '~6.0.0' },
                minor: { chalk: '~5.9.0' }
            });

            expect(warnedWith('Held back by "~": chalk@6.0.0')).toBe(true);
        });

        it('leaves a "~" entry untouched when only a newer major is available', function () {
            const original = cjsonWithDependency('~5.6.2');
            const updated = updateChalk({
                declared: '~5.6.2',
                latest: { chalk: '~6.0.0' }
            });

            expect(updated).toBe(original);
        });

        it('skips the "--target minor" pass when no "~" entry is declared', function () {
            updateChalk({
                declared: '^5.6.2',
                latest: { chalk: '^5.7.0' }
            });

            expect(execSync).toHaveBeenCalledTimes(1);
            expect(execSync.mock.calls[0][0]).toBe('npm-check-updates --jsonUpgraded');
        });

        it('runs the "--target minor" pass when a "~" entry is declared', function () {
            updateChalk({
                declared: '~5.6.2',
                latest: { chalk: '~6.0.0' },
                minor: { chalk: '~5.9.0' }
            });

            expect(execSync).toHaveBeenCalledTimes(2);
            expect(execSync.mock.calls[1][0]).toBe('npm-check-updates --jsonUpgraded --target minor');
        });

        it.each([
            ['>=1.0.0'],
            ['1.x'],
            ['*'],
            ['latest'],
            ['github:webextensions/package-cjson'],
            ['workspace:*'],
            ['npm:other-package@^1.0.0']
        ])('leaves an entry declared as "%s" untouched', function (declaredRange) {
            const original = cjsonWithDependency(declaredRange);
            const updated = updateChalk({
                declared: declaredRange,
                latest: { chalk: '6.0.0' }
            });

            expect(updated).toBe(original);
            expect(warnedWith(`Unsupported version range for chalk: "${declaredRange}"`)).toBe(true);
        });

        it('leaves a source entry untouched when its value differs from package.json (stale package.json)', function () {
            // package.json declares "^" while the (newer, not yet regenerated) source declares "~":
            // rewriting here would overwrite the source's operator, so nothing must be touched.
            const original = cjsonWithDependency('~16.0.0');
            const updated = updateWith({
                declared: { chalk: '^16.0.0' },
                latest: { chalk: '^18.1.0' },
                fileName: sourceFileNames.cjson,
                contents: original
            });

            expect(updated).toBe(original);
        });

        it('does not overwrite a differing operator of the same package in another section', function () {
            const updated = updateWith({
                declared: [
                    ['dependencies', { chalk: '^5.6.2' }],
                    ['devDependencies', { chalk: '~5.6.2' }]
                ],
                latest: { chalk: '^5.7.0' },
                fileName: sourceFileNames.cjson,
                contents: [
                    '{',
                    '    "dependencies": {',
                    '        "chalk": "^5.6.2"',
                    '    },',
                    '    "devDependencies": {',
                    '        "chalk": "~5.6.2"',
                    '    }',
                    '}',
                    ''
                ].join('\n')
            });

            expect(updated).toContain('"chalk": "^5.7.0"');
            expect(updated).toContain('"chalk": "~5.6.2"');
        });

        it('updates every occurrence of a package declared more than once', function () {
            const updated = updateWith({
                declared: [
                    ['dependencies', { chalk: '^5.6.2' }],
                    ['devDependencies', { chalk: '^5.6.2' }]
                ],
                latest: { chalk: '^5.7.0' },
                fileName: sourceFileNames.cjson,
                contents: [
                    '{',
                    '    "dependencies": {',
                    '        "chalk": "^5.6.2"',
                    '    },',
                    '    "devDependencies": {',
                    '        "chalk": "^5.6.2"',
                    '    }',
                    '}',
                    ''
                ].join('\n')
            });

            expect(updated.match(/"chalk": "\^5\.7\.0"/g)).toHaveLength(2);
            expect(updated).not.toContain('^5.6.2');
        });
    });

    // Sanity-check that the same update logic still works for `package.json.js` and `package.json.ts`.
    // The regex needs to recognize single/double-quoted string literals as well as bare identifier keys.
    describe.each([
        ['package.json.js', sourceFileNames.js],
        ['package.json.ts', sourceFileNames.ts]
    ])('%s', function (_label, fileName) {
        it('updates single-quoted string-key entries', function () {
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                latest: { chalk: '^5.7.0' },
                fileName,
                contents: moduleWithDependency('^5.6.2', { quote: "'", quoteKey: true })
            });

            expect(updated).toContain("'chalk': '^5.7.0'");
            expect(updated).not.toContain("'chalk': '^5.6.2'");
        });

        it('updates double-quoted string-key entries', function () {
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                latest: { chalk: '^5.7.0' },
                fileName,
                contents: moduleWithDependency('^5.6.2', { quote: '"', quoteKey: true })
            });

            expect(updated).toContain('"chalk": "^5.7.0"');
            expect(updated).not.toContain('"chalk": "^5.6.2"');
        });

        it('updates bare-identifier keys', function () {
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                latest: { chalk: '^5.7.0' },
                fileName,
                contents: moduleWithDependency('^5.6.2', { quote: "'", quoteKey: false })
            });

            expect(updated).toContain("chalk: '^5.7.0'");
            expect(updated).not.toContain("chalk: '^5.6.2'");
        });

        it('preserves the quote style used by the value', function () {
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                latest: { chalk: '^5.7.0' },
                fileName,
                contents: moduleWithDependency('^5.6.2', { quote: "'", quoteKey: false })
            });

            // The output should still use single quotes (not get converted to double quotes).
            expect(updated).toContain("'^5.7.0'");
            expect(updated).not.toContain('"^5.7.0"');
        });

        it('updates pre-release versions', function () {
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                latest: { chalk: '^5.7.0-rc.1' },
                fileName,
                contents: moduleWithDependency('^5.6.2', { quote: "'", quoteKey: true })
            });

            expect(updated).toContain("'chalk': '^5.7.0-rc.1'");
        });

        it('skips packages marked with "="', function () {
            const original = moduleWithDependency('=5.6.2', { quote: "'", quoteKey: true });
            const updated = updateWith({
                declared: { chalk: '=5.6.2' },
                latest: { chalk: '=5.7.0' },
                fileName,
                contents: original
            });

            expect(updated).toBe(original);
        });

        it('keeps a "~" entry within its major', function () {
            const updated = updateWith({
                declared: { chalk: '~5.6.2' },
                latest: { chalk: '~6.0.0' },
                minor: { chalk: '~5.9.0' },
                fileName,
                contents: moduleWithDependency('~5.6.2', { quote: "'", quoteKey: true })
            });

            expect(updated).toContain("'chalk': '~5.9.0'");
            expect(updated).not.toContain('6.0.0');
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
            const updated = updateWith({
                declared: { chalk: '^5.6.2' },
                latest: { chalk: '^5.7.0' },
                fileName,
                contents: original
            });

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
            const updated = updateWith({
                declared: [['devDependencies', { '@eslint/js': '^10.0.1', eslint: '^10.3.0' }]],
                latest: { eslint: '^10.4.0' },
                fileName,
                contents: original
            });

            expect(updated).toContain('"@eslint/js": "^10.0.1"');
            expect(updated).toContain('"eslint": "^10.4.0"');
        });
    });

    it('returns an array containing the error when execSync throws', function () {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        execSync.mockImplementation(() => { throw new Error('command failed'); });
        writeDeclaredPackageJson({ dependencies: {} });
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

    it.each([
        ['is missing', null],
        ['is malformed', '{ not json']
    ])('returns an array containing the error when package.json %s', function (_description, packageJsonContents) {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        if (packageJsonContents !== null) {
            fs.writeFileSync(path.join(tempDir, 'package.json'), packageJsonContents);
        }
        writeSource(sourceFileNames.cjson, cjsonWithDependency('^5.6.2'));

        try {
            const result = updatePackageCjson(sourceFilePath);
            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toBeInstanceOf(Error);
            expect(execSync).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
            consoleLogSpy.mockRestore();
        }
    });
});
