#!/usr/bin/env node
/*eslint-env node*/

const path = require('path');

const
    chalk = require('chalk'),
    cjson = require('cjson'),
    stringify = require('json-stable-stringify'),
    jsonfile = require('jsonfile'),
    deepEqual = require('deep-equal'),
    difflet = require('difflet');

const helpmate = require('helpmate');

const logger = require('note-down');
logger.removeOption('showLogLine');


const { argv } = require('yargs');

const { updatePackageCjson } = require('./update-package-cjson/update-package-cjson.js');

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
        console.log(chalk.red(summary));
    }
    if (error) {
        console.log(chalk.red(error));
    }
    if (showHelp) {
        help();
    }
    process.exit(exitCode);
};

const mode = argv['mode'];
if (!module.parent) {   // This package is supposed to be used as a global package
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
    // Show a warning and exit with code 0 if this project is included with Node JS "require"
    // (useful for basic test-case that this package would execute)
    exitWithError({
        summary: chalk.blue('Please run this module (package-cjson) from its binary file.') + chalk.yellow(' Warning: Exiting without error (code 0).'),
        exitCode: 0
    });
}

const doGeneratePackageJson = function (pwd) {
    const packageCjson = cjson.load(path.join(pwd, './package.cjson'));
    const packageJson = JSON.parse(stringify(packageCjson));

    const packageJsonFilePath = path.join(pwd, './package.json');
    helpmate.fs.updateFileIfRequired({
        file: packageJsonFilePath,
        data: JSON.stringify(packageJson, null, '  ') + '\n',
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
    updatePackageCjson(path.join(pwd, './package.cjson'));
};

switch (mode) {
    case 'compare': {
        const packageCjson = cjson.load(path.join(pwd, './package.cjson'));
        const packageJson = jsonfile.readFileSync(path.join(pwd, './package.json'));

        if (deepEqual(packageJson, packageCjson)) {
            if (argv['silent-on-compare-success']) {
                // do nothing
            } else {
                console.log(chalk.green(' ✔ ' + chalk.bold('package.json') + ' is equivalent to ' + chalk.bold('package.cjson')));
            }
        } else {
            console.log(chalk.red(' ✘ ' + chalk.bold('package.json') + ' is not equivalent to ' + chalk.bold('package.cjson')));
            console.log(chalk.underline.bold('\nDiff:'));
            console.log('    ' + difflet({ indent: 2 }).compare(packageCjson, packageJson).replace(/\n/g, '\n    '));
            process.exit(1);
        }
        break;
    }
    case 'compare-package-version': {
        const packageCjson = cjson.load(path.join(pwd, './package.cjson'));
        const packageVersionJson = jsonfile.readFileSync(path.join(pwd, './package-version.json'));

        if (deepEqual(packageCjson.version, packageVersionJson.version)) {
            if (argv['silent-on-compare-success']) {
                // do nothing
            } else {
                console.log(chalk.green(' ✔ ' + chalk.bold('package-version.json') + ' is equivalent to ' + chalk.bold('package.cjson')));
            }
        } else {
            console.log(chalk.red(' ✘ ' + chalk.bold('package-version.json') + ' is not equivalent to ' + chalk.bold('package.cjson')));
            console.log(chalk.underline.bold('\nDiff:'));
            console.log('    ' + difflet({ indent: 2 }).compare(packageCjson.version, packageVersionJson.version).replace(/\n/g, '\n    '));
            process.exit(1);
        }
        break;
    }
    case 'generate-package-json': {
        doGeneratePackageJson(pwd);
        break;
    }
    case 'generate-package-version-json': {
        const packageCjson = cjson.load(path.join(pwd, './package.cjson'));
        const packageVersionJson = {
            version: packageCjson.version
        };
        const packageVersionJsonFilePath = path.join(pwd, './package-version.json');
        helpmate.fs.updateFileIfRequired({
            file: packageVersionJsonFilePath,
            data: JSON.stringify(packageVersionJson, null, '  ') + '\n',
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
        doGeneratePackageJson(pwd);
        break;
    default: {
        exitWithError({
            summary: '\nError: Incorrect argument. Exiting with code 1.\n',
            showHelp: true
        });
        break;
    }
}
