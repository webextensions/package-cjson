import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../index.js');

const runCli = function (args, cwd) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd,
        // The CLI reads `process.env.PWD`, which Node does not refresh
        // when the child process's `cwd` differs from the parent's.
        env: { ...process.env, PWD: cwd },
        encoding: 'utf8'
    });
    return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.status
    };
};

const makeTempDir = function () {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'package-cjson-test-'));
};

const cleanupDir = function (dir) {
    if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const sampleCjsonContents = [
    '{',
    '    "name": "sample",                // The name',
    '    "version": "1.0.0",              // The version',
    '    "dependencies": {',
    '        "chalk": "^5.6.2"            // Colorful console',
    '    }',
    '}',
    ''
].join('\n');

const expectedJsonContents = JSON.stringify({
    dependencies: { chalk: '^5.6.2' },
    name: 'sample',
    version: '1.0.0'
}, null, 4) + '\n';

describe('package-cjson CLI', function () {
    let tempDir;
    beforeEach(function () { tempDir = makeTempDir(); });
    afterEach(function () { cleanupDir(tempDir); });

    describe('argument validation', function () {
        it('exits with code 1 when no mode is provided', function () {
            const result = runCli([], tempDir);
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toContain('Not enough arguments');
        });

        it('exits with code 1 when an invalid mode is provided', function () {
            const result = runCli(['--mode', 'nonsense'], tempDir);
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toContain('Not enough arguments');
        });
    });

    describe('--mode generate-package-json', function () {
        beforeEach(function () {
            fs.writeFileSync(path.join(tempDir, 'package.cjson'), sampleCjsonContents);
        });

        it('creates package.json from package.cjson', function () {
            const result = runCli(['--mode', 'generate-package-json'], tempDir);
            expect(result.exitCode).toBe(0);
            const generatedJsonPath = path.join(tempDir, 'package.json');
            expect(fs.existsSync(generatedJsonPath)).toBe(true);
            expect(fs.readFileSync(generatedJsonPath, 'utf8')).toBe(expectedJsonContents);
        });

        it('does not rewrite an already up-to-date package.json', function () {
            const packageJsonPath = path.join(tempDir, 'package.json');
            fs.writeFileSync(packageJsonPath, expectedJsonContents);
            const beforeMtime = fs.statSync(packageJsonPath).mtimeMs;
            const result = runCli(['--mode', 'generate-package-json'], tempDir);
            expect(result.exitCode).toBe(0);
            const afterMtime = fs.statSync(packageJsonPath).mtimeMs;
            expect(afterMtime).toBe(beforeMtime);
        });

        it('preserves a trailing newline if package.cjson has one', function () {
            const result = runCli(['--mode', 'generate-package-json'], tempDir);
            expect(result.exitCode).toBe(0);
            const generated = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8');
            expect(generated.endsWith('\n')).toBe(true);
        });

        it('omits a trailing newline if package.cjson has none', function () {
            fs.writeFileSync(
                path.join(tempDir, 'package.cjson'),
                sampleCjsonContents.replace(/\n$/, '')
            );
            const result = runCli(['--mode', 'generate-package-json'], tempDir);
            expect(result.exitCode).toBe(0);
            const generated = fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8');
            expect(generated.endsWith('\n')).toBe(false);
        });
    });

    describe('--mode generate-package-version-json', function () {
        beforeEach(function () {
            fs.writeFileSync(path.join(tempDir, 'package.cjson'), sampleCjsonContents);
        });

        it('creates package-version.json with only the version', function () {
            const result = runCli(['--mode', 'generate-package-version-json'], tempDir);
            expect(result.exitCode).toBe(0);
            const generated = fs.readFileSync(
                path.join(tempDir, 'package-version.json'),
                'utf8'
            );
            expect(JSON.parse(generated)).toEqual({ version: '1.0.0' });
        });
    });

    describe('--mode compare', function () {
        beforeEach(function () {
            fs.writeFileSync(path.join(tempDir, 'package.cjson'), sampleCjsonContents);
        });

        it('exits with code 0 and reports equivalence when files match', function () {
            fs.writeFileSync(path.join(tempDir, 'package.json'), expectedJsonContents);
            const result = runCli(['--mode', 'compare'], tempDir);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('is equivalent to');
        });

        it('prints nothing on success when --silent-on-compare-success is used', function () {
            fs.writeFileSync(path.join(tempDir, 'package.json'), expectedJsonContents);
            const result = runCli(['--mode', 'compare', '--silent-on-compare-success'], tempDir);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('');
        });

        it('exits with code 1 and prints a diff when files differ', function () {
            const differentJson = JSON.stringify({
                dependencies: { chalk: '^5.6.2' },
                name: 'sample',
                version: '2.0.0'
            }, null, 4) + '\n';
            fs.writeFileSync(path.join(tempDir, 'package.json'), differentJson);
            const result = runCli(['--mode', 'compare'], tempDir);
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toContain('is not equivalent to');
            expect(result.stdout).toContain('Diff');
        });
    });

    describe('--mode compare-package-version', function () {
        beforeEach(function () {
            fs.writeFileSync(path.join(tempDir, 'package.cjson'), sampleCjsonContents);
        });

        it('exits with code 0 when versions match', function () {
            fs.writeFileSync(
                path.join(tempDir, 'package-version.json'),
                JSON.stringify({ version: '1.0.0' }) + '\n'
            );
            const result = runCli(['--mode', 'compare-package-version'], tempDir);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('is equivalent to');
        });

        it('exits with code 1 when versions differ', function () {
            fs.writeFileSync(
                path.join(tempDir, 'package-version.json'),
                JSON.stringify({ version: '9.9.9' }) + '\n'
            );
            const result = runCli(['--mode', 'compare-package-version'], tempDir);
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toContain('is not equivalent to');
        });

        it('prints nothing on success when --silent-on-compare-success is used', function () {
            fs.writeFileSync(
                path.join(tempDir, 'package-version.json'),
                JSON.stringify({ version: '1.0.0' }) + '\n'
            );
            const result = runCli(
                ['--mode', 'compare-package-version', '--silent-on-compare-success'],
                tempDir
            );
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('');
        });
    });
});
