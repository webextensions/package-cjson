import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../index.js');
const fixturesPath = path.join(__dirname, 'fixtures/cli');

const packageSources = {
    cjson: {
        fixture: 'package.cjson',
        target: 'package.cjson',
        expected: 'expected-from-cjson.json',
        version: '1.0.0'
    },
    js: {
        fixture: 'package-json-js.source',
        target: 'package.json.js',
        expected: 'expected-from-js.json',
        version: '3.0.0'
    },
    ts: {
        fixture: 'package-json-ts.source',
        target: 'package.json.ts',
        expected: 'expected-from-ts.json',
        version: '2.0.0'
    }
};

const sourceSelectionCases = [
    ['package.cjson only', ['cjson'], 'cjson'],
    ['package.json.ts only', ['ts'], 'ts'],
    ['package.json.js only', ['js'], 'js'],
    ['package.json.js over package.cjson', ['cjson', 'js'], 'js'],
    ['package.json.ts over package.json.js', ['cjson', 'js', 'ts'], 'ts']
];

const makeTempDir = function () {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'package-cjson-cli-test-'));
};

const cleanupDir = function (dir) {
    if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const fixturePath = function (name) {
    return path.join(fixturesPath, name);
};

const readFixture = function (name) {
    return fs.readFileSync(fixturePath(name), 'utf8');
};

describe('package-cjson CLI', function () {
    let tempDir;

    const outputPath = function (fileName) {
        return path.join(tempDir, fileName);
    };

    const copyFixture = function (fixtureName, targetName = fixtureName) {
        fs.copyFileSync(fixturePath(fixtureName), outputPath(targetName));
    };

    const writeFixture = function (fixtureName, targetName = fixtureName, transform = (content) => content) {
        fs.writeFileSync(outputPath(targetName), transform(readFixture(fixtureName)));
    };

    const writeSources = function (sourceNames) {
        for (const sourceName of sourceNames) {
            const source = packageSources[sourceName];
            copyFixture(source.fixture, source.target);
        }
    };

    const readOutput = function (fileName) {
        return fs.readFileSync(outputPath(fileName), 'utf8');
    };

    const copyExpectedPackageJson = function (sourceName) {
        copyFixture(packageSources[sourceName].expected, 'package.json');
    };

    const runCli = async function (args) {
        const result = await execa(process.execPath, [cliPath, ...args], {
            cwd: tempDir,
            env: { ...process.env, PWD: tempDir },
            reject: false,
            all: true,
            stripFinalNewline: false
        });

        return {
            ...result,
            output: result.all ?? `${result.stdout}${result.stderr}`
        };
    };

    beforeEach(function () {
        cleanupDir(tempDir);
        tempDir = makeTempDir();
    });

    afterEach(function () {
        cleanupDir(tempDir);
    });

    describe('argument validation', function () {
        it.each([
            ['no mode is provided', []],
            ['an invalid mode is provided', ['--mode', 'nonsense']]
        ])('exits with code 1 when %s', async function (_description, args) {
            const result = await runCli(args);

            expect(result.exitCode).toBe(1);
            expect(result.output).toContain('Not enough arguments');
        });
    });

    describe('--mode generate-package-json', function () {
        it.each(sourceSelectionCases)('creates package.json from %s', async function (_description, sourceNames, expectedSourceName) {
            writeSources(sourceNames);

            const result = await runCli(['--mode', 'generate-package-json']);

            expect(result.exitCode).toBe(0);
            expect(readOutput('package.json')).toBe(readFixture(packageSources[expectedSourceName].expected));
        });

        it('does not rewrite an already up-to-date package.json', async function () {
            writeSources(['cjson']);
            copyExpectedPackageJson('cjson');

            const beforeMtime = fs.statSync(outputPath('package.json')).mtimeMs;
            const result = await runCli(['--mode', 'generate-package-json']);

            expect(result.exitCode).toBe(0);
            expect(fs.statSync(outputPath('package.json')).mtimeMs).toBe(beforeMtime);
        });

        it('preserves a trailing newline if the source file has one', async function () {
            writeSources(['cjson']);

            const result = await runCli(['--mode', 'generate-package-json']);

            expect(result.exitCode).toBe(0);
            expect(readOutput('package.json').endsWith('\n')).toBe(true);
        });

        it('omits a trailing newline if the source file has none', async function () {
            writeFixture('package.cjson', 'package.cjson', (content) => content.replace(/\n$/, ''));

            const result = await runCli(['--mode', 'generate-package-json']);

            expect(result.exitCode).toBe(0);
            expect(readOutput('package.json').endsWith('\n')).toBe(false);
        });

        it.each([
            ['package.json.ts', 'package-json-ts-without-default.source'],
            ['package.json.js', 'package-json-js-without-default.source']
        ])('exits with code 1 when %s has no default export', async function (sourceFileName, fixtureName) {
            writeSources(['cjson']);
            copyFixture(fixtureName, sourceFileName);

            const result = await runCli(['--mode', 'generate-package-json']);

            expect(result.exitCode).toBe(1);
            expect(result.output).toContain(`${sourceFileName} must have a default export`);
        });
    });

    describe('--mode generate-package-version-json', function () {
        it.each(sourceSelectionCases)('creates package-version.json from %s', async function (_description, sourceNames, expectedSourceName) {
            writeSources(sourceNames);

            const result = await runCli(['--mode', 'generate-package-version-json']);

            expect(result.exitCode).toBe(0);
            expect(JSON.parse(readOutput('package-version.json'))).toEqual({
                version: packageSources[expectedSourceName].version
            });
        });
    });

    describe('--mode compare', function () {
        it.each([
            ['package.cjson', ['cjson'], 'cjson'],
            ['package.json.ts', ['cjson', 'ts'], 'ts'],
            ['package.json.js', ['cjson', 'js'], 'js']
        ])('exits with code 0 when package.json matches %s', async function (sourceLabel, sourceNames, expectedSourceName) {
            writeSources(sourceNames);
            copyExpectedPackageJson(expectedSourceName);

            const result = await runCli(['--mode', 'compare']);

            expect(result.exitCode).toBe(0);
            expect(result.output).toContain('is equivalent to');
            expect(result.output).toContain(sourceLabel);
        });

        it('prints nothing on success when --silent-on-compare-success is used', async function () {
            writeSources(['cjson']);
            copyExpectedPackageJson('cjson');

            const result = await runCli(['--mode', 'compare', '--silent-on-compare-success']);

            expect(result.exitCode).toBe(0);
            expect(result.output).toBe('');
        });

        it('exits with code 1 and prints a diff when files differ', async function () {
            writeSources(['cjson']);
            copyFixture('different-package.json', 'package.json');

            const result = await runCli(['--mode', 'compare']);

            expect(result.exitCode).toBe(1);
            expect(result.output).toContain('is not equivalent to');
            expect(result.output).toContain('Diff');
        });
    });

    describe('--mode compare-package-version', function () {
        const writePackageVersion = function (version) {
            fs.writeFileSync(outputPath('package-version.json'), `${JSON.stringify({ version })}\n`);
        };

        beforeEach(function () {
            writeSources(['cjson']);
        });

        it('exits with code 0 when versions match', async function () {
            writePackageVersion('1.0.0');

            const result = await runCli(['--mode', 'compare-package-version']);

            expect(result.exitCode).toBe(0);
            expect(result.output).toContain('is equivalent to');
        });

        it('exits with code 1 when versions differ', async function () {
            writePackageVersion('9.9.9');

            const result = await runCli(['--mode', 'compare-package-version']);

            expect(result.exitCode).toBe(1);
            expect(result.output).toContain('is not equivalent to');
        });

        it('prints nothing on success when --silent-on-compare-success is used', async function () {
            writePackageVersion('1.0.0');

            const result = await runCli([
                '--mode',
                'compare-package-version',
                '--silent-on-compare-success'
            ]);

            expect(result.exitCode).toBe(0);
            expect(result.output).toBe('');
        });
    });
});
