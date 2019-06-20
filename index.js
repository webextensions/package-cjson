#!/usr/bin/env node
/*eslint-env node*/

var path = require('path');

var chalk = require('chalk'),
    cjson = require('cjson'),
    stringify = require('json-stable-stringify'),
    jsonfile = require('jsonfile'),
    deepEqual = require('deep-equal'),
    difflet = require('difflet');

var pwd = process.env.PWD;

var help = function () {
    console.log([
        'Format:   package-cjson <compare/compare-silent/generate-package.json>',
        'Examples: package-cjson compare',
        '          package-cjson compare-silent',
        '          package-cjson generate-package.json',
        ''
    ].join('\n'));
};

var exitWithError = function (options) {
    var summary = options.summary,
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

var mode = null;
if (!module.parent) {   // This package is supposed to be used as a global package
    mode = process.argv[2];
    if (!mode) {
        exitWithError({
            summary: '\nError: Not enough arguments. Exiting with code 1.\n',
            showHelp: true
        });
    }
} else {
    // Show a warning and exit with code 0 if this project is included with Node JS "require"
    // (useful for basic test-case that this package would execute)
    exitWithError({
        summary: chalk.blue('Please run this module (copy-files-from-to) from its binary file.') + chalk.yellow(' Warning: Exiting without error (code 0).'),
        exitCode: 0
    });
}

var packageJson,
    packageCjson;

if (mode === 'compare' || mode === 'compare-silent') {
    packageJson = jsonfile.readFileSync(path.join(pwd, './package.json'));
    packageCjson = cjson.load(path.join(pwd, './package.cjson'));
    if (deepEqual(packageJson, packageCjson)) {
        if (mode === 'compare') {
            console.log(chalk.green(' ✔ ' + chalk.bold('package.json') + ' is equivalent to ' + chalk.bold('package.cjson')));
        }
    } else {
        console.log(chalk.red(' ✘ ' + chalk.bold('package.json') + ' is not equivalent to ' + chalk.bold('package.cjson')));
        console.log(chalk.underline.bold('\nDiff:'));
        console.log('    ' + difflet({ indent: 2 }).compare(packageCjson, packageJson).replace(/\n/g, '\n    '));
        process.exit(1);
    }
} else if (mode === 'generate-package.json') {
    packageCjson = cjson.load(path.join(pwd, './package.cjson')),
    packageJson = JSON.parse(stringify(packageCjson));
    jsonfile.writeFileSync(path.join(pwd, './package.json'), packageJson, {spaces: 2});
} else {
    exitWithError({
        summary: '\nError: Incorrect argument. Exiting with code 1.\n',
        showHelp: true
    });
}
