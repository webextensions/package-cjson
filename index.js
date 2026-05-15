#!/usr/bin/env node

/*
 * User-facing text uses console.log and note-down's logger (e.g. logger.verbose for help,
 * logger.success after generate). stdout can be buffered asynchronously; exitWithError uses
 * fs.writeSync(1, ...) for summary/error lines so they flush before process.exit(...). Elsewhere,
 * use synchronous fd 1 writes or flush stdout if you need the same guarantee.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import chalk from 'chalk';
import cjson from 'cjson';
import stringify from 'json-stable-stringify';
import detectIndent from 'detect-indent';
import jsonfile from 'jsonfile';
import deepEqual from 'deep-equal';
import difflet from 'difflet';

import { updateFileIfRequired } from 'helpmate/dist/fs/updateFileIfRequired.js';

import { logger } from 'note-down';
logger.removeOption('showLogLine');

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
const argv = yargs(hideBin(process.argv)).argv;

import { updatePackageCjson } from './update-package-cjson/update-package-cjson.js';

const pwd = process.env.PWD;

const help = function () {
    logger.verbose([
        'Format:   package-cjson --mode <selected-mode> [--silent-on-compare-success]',
        '',
        'Modes:    compare',
        '          compare-package-version',
        '          generate-package-json',
        '          generate-package-version-json',
        '          update',
        '          update-and-generate-package-json',
        '',
        'Examples: package-cjson --mode compare --silent-on-compare-success',
        '          package-cjson --mode generate-package-json',
        '          package-cjson --mode update',
        '          package-cjson --mode update-and-generate-package-json',
        ''
    ].join('\n'));
};

const exitWithError = function (options) {
    const
        summary = options.summary,
        error = options.error,
        showHelp = options.showHelp,
        exitCode = typeof options.exitCode === 'number' ? options.exitCode : 1;

    if (summary) {
        fs.writeSync(1, `${chalk.red(summary)}\n`);
    }
    if (error) {
        fs.writeSync(1, `${chalk.red(error)}\n`);
    }
    if (showHelp) {
        help();
    }
    process.exit(exitCode);
};

const writeOutputLine = function (message) {
    fs.writeSync(1, `${message}\n`);
};

const isEntry = process.argv[1] === fileURLToPath(import.meta.url);

const mode = argv['mode'];
if (isEntry) {   // This package is supposed to be used as a global package
    if (
        [
            'compare',
            'compare-package-version',
            'generate-package-json',
            'generate-package-version-json',
            'update',
            'update-and-generate-package-json'
        ].includes(mode)
    ) {
        // do nothing
    } else {
        exitWithError({
            summary: '\nError: Not enough arguments. Exiting with code 1.\n',
            showHelp: true,
            exitCode: 1
        });
    }
} else {
    // Show a warning and exit with code 0 if this project is included with an "import" statement
    // (useful for basic test-case that this package would execute)
    exitWithError({
        summary: chalk.blue('Please run this module (package-cjson) from its executable file.') + chalk.yellow(' Warning: Exiting without error (code 0).'),
        exitCode: 0
    });
}

const getPackageJsonSource = function (pwd) {
    const packageJsonSources = [
        {
            fileName: 'package.json.ts',
            type: 'module'
        },
        {
            fileName: 'package.json.js',
            type: 'module'
        },
        {
            fileName: 'package.cjson',
            type: 'cjson'
        }
    ];

    for (const packageJsonSource of packageJsonSources) {
        const packageJsonSourceFilePath = path.resolve(pwd, packageJsonSource.fileName);
        if (fs.existsSync(packageJsonSourceFilePath)) {
            return {
                ...packageJsonSource,
                filePath: packageJsonSourceFilePath
            };
        }
    }

    exitWithError({
        summary: `\n ✘ Error: Could not find package.json.ts, package.json.js, or package.cjson in ${pwd}. Exiting with code 1.\n`
    });
};

const normalizePackageJson = function (packageJsonSource, sourceFileName) {
    let packageJson;
    try {
        packageJson = stringify(packageJsonSource);
    } catch (error) {
        exitWithError({
            summary: `\n ✘ Error: Failed to convert ${sourceFileName} to package.json. Exiting with code 1.\n`,
            error: error.message
        });
    }

    if (typeof packageJson !== 'string') {
        exitWithError({
            summary: `\n ✘ Error: ${sourceFileName} must provide a JSON-serializable default export. Exiting with code 1.\n`
        });
    }

    return JSON.parse(packageJson);
};

const loadPackageJsonModule = async function (source) {
    let packageJsonModule;
    try {
        packageJsonModule = await import(pathToFileURL(source.filePath).href);
    } catch (error) {
        exitWithError({
            summary: `\n ✘ Error: Failed to load ${source.filePath}. Exiting with code 1.\n`,
            error: error.message
        });
    }

    if (!Object.hasOwn(packageJsonModule, 'default')) {
        exitWithError({
            summary: `\n ✘ Error: ${source.fileName} must have a default export. Exiting with code 1.\n`
        });
    }

    try {
        return await Promise.resolve(packageJsonModule.default);
    } catch (error) {
        exitWithError({
            summary: `\n ✘ Error: Failed to resolve the default export from ${source.filePath}. Exiting with code 1.\n`,
            error: error.message
        });
    }
};

const loadPackageSource = async function (pwd) {
    const source = getPackageJsonSource(pwd);
    const rawContents = fs.readFileSync(source.filePath, 'utf8');
    let packageJsonSource;

    if (source.type === 'module') {
        packageJsonSource = await loadPackageJsonModule(source);
    } else {
        try {
            packageJsonSource = cjson.load(source.filePath);
        } catch (error) {
            exitWithError({
                summary: `\n ✘ Error: Failed to load ${source.filePath}. Exiting with code 1.\n`,
                error: error.message
            });
        }
    }

    return {
        ...source,
        packageJson: normalizePackageJson(packageJsonSource, source.fileName),
        rawContents
    };
};

const doGeneratePackageJson = async function (pwd) {
    const packageSource = await loadPackageSource(pwd);

    const packageJsonFilePath = path.resolve(pwd, './package.json');
    const indentation = detectIndent(packageSource.rawContents).indent || '  ';
    const endsWithNewLine = (packageSource.rawContents.substr(-1) === '\n') ? true : false;
    updateFileIfRequired({
        file: packageJsonFilePath,
        data: JSON.stringify(packageSource.packageJson, null, indentation) + (endsWithNewLine ? '\n' : ''),
        callback: function (err) {
            if (err) {
                exitWithError({
                    summary: `\n ✘ Error: Failed to update ${packageJsonFilePath}. Exiting with code 1.\n`
                });
            } else {
                logger.success(` ✔ Generated ${packageJsonFilePath} successfully.`);
            }
        }
    });
};

const doUpdatePackageCjson = function (pwd) {
    updatePackageCjson(path.resolve(pwd, './package.cjson'));
};

switch (mode) {
    case 'compare': {
        const packageSource = await loadPackageSource(pwd);
        const packageJsonFilePath = path.resolve(pwd, './package.json');
        const packageJson = jsonfile.readFileSync(packageJsonFilePath);

        if (deepEqual(packageJson, packageSource.packageJson)) {
            if (argv['silent-on-compare-success']) {
                // do nothing
            } else {
                writeOutputLine(chalk.green(` ✔ ${chalk.bold('package.json')} is equivalent to ${chalk.bold(packageSource.fileName)}`) + ` (${pwd})`);
            }
        } else {
            writeOutputLine(chalk.red(` ✘ ${chalk.bold('package.json')} is not equivalent to ${chalk.bold(packageSource.fileName)}`) + ` (${pwd})`);
            writeOutputLine(chalk.underline.bold('\nDiff:'));
            writeOutputLine('    ' + difflet({ indent: 2 }).compare(packageSource.packageJson, packageJson).replace(/\n/g, '\n    '));
            process.exit(1);
        }
        break;
    }
    case 'compare-package-version': {
        const packageSource = await loadPackageSource(pwd);
        const packageVersionFilePath = path.resolve(pwd, './package-version.json');
        const packageVersionJson = jsonfile.readFileSync(packageVersionFilePath);

        if (deepEqual(packageSource.packageJson.version, packageVersionJson.version)) {
            if (argv['silent-on-compare-success']) {
                // do nothing
            } else {
                writeOutputLine(chalk.green(` ✔ ${chalk.bold('package-version.json')} is equivalent to ${chalk.bold(packageSource.fileName)}`) + ` (${pwd})`);
            }
        } else {
            writeOutputLine(chalk.red(` ✘ ${chalk.bold('package-version.json')} is not equivalent to ${chalk.bold(packageSource.fileName)}`) + ` (${pwd})`);
            writeOutputLine(chalk.underline.bold('\nDiff:'));
            writeOutputLine('    ' + difflet({ indent: 2 }).compare(packageSource.packageJson.version, packageVersionJson.version).replace(/\n/g, '\n    '));
            process.exit(1);
        }
        break;
    }
    case 'generate-package-json': {
        await doGeneratePackageJson(pwd);
        break;
    }
    case 'generate-package-version-json': {
        const packageSource = await loadPackageSource(pwd);
        const packageVersionJson = {
            version: packageSource.packageJson.version
        };
        const packageVersionJsonFilePath = path.resolve(pwd, './package-version.json');
        const indentation = detectIndent(packageSource.rawContents).indent || '  ';
        const endsWithNewLine = (packageSource.rawContents.substr(-1) === '\n') ? true : false;
        updateFileIfRequired({
            file: packageVersionJsonFilePath,
            data: JSON.stringify(packageVersionJson, null, indentation) + (endsWithNewLine ? '\n' : ''),
            callback: function (err) {
                if (err) {
                    exitWithError({
                        summary: `\nError: Failed to update ${packageVersionJsonFilePath}. Exiting with code 1.\n`
                    });
                }
            }
        });
        break;
    }
    case 'update': {
        doUpdatePackageCjson(pwd);
        break;
    }
    case 'update-and-generate-package-json':
        doUpdatePackageCjson(pwd);
        await doGeneratePackageJson(pwd);
        break;
    default: {
        exitWithError({
            summary: '\nError: Incorrect argument. Exiting with code 1.\n',
            showHelp: true
        });
        break;
    }
}
