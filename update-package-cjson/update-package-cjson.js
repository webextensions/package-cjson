#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

import { logger } from 'note-down';

const escapeRegex = function (value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const updatePackageCjson = function (packageSourceFilePath) {
    const folderPath = path.dirname(packageSourceFilePath);

    const packageSourceFilePathRelativeToCwd = path.relative(process.cwd(), packageSourceFilePath);
    logger.info(`\n > Checking ${packageSourceFilePathRelativeToCwd} for updates`);

    let commandOutput;

    try {
        commandOutput = execSync(
            // Alternatively, use 'npm outdated --json', but that may not lead to an output for the cases where the installed
            // dependency is already at newer version, due to "^" and "~" characters in the semver syntax
            'npm-check-updates --jsonUpgraded',
            {
                cwd: folderPath,
                encoding: 'utf8'
            }
        );
    } catch (e) {
        console.error(e);
        logger.error('\nFailed to execute the following command:');
        logger.error('    $ npm-check-updates --jsonUpgraded');
        logger.info('\nYou may need to run the following command:');
        logger.info('    $ npm install -g npm-check-updates');
        console.log('');
        return [e];
    }

    commandOutput = JSON.parse(commandOutput);

    let packagesToUpdate = Object.keys(commandOutput);

    // Excluding packages specified with "=" from being updated.
    packagesToUpdate = packagesToUpdate.filter((nameOfPackageToUpdate) => {
        if (commandOutput[nameOfPackageToUpdate].indexOf('=') !== -1) {
            logger.warn(` ! Please update manually to: ${nameOfPackageToUpdate}@${commandOutput[nameOfPackageToUpdate]}`);
            return false;
        }
        return true;
    });

    for (const nameOfPackageToUpdate of packagesToUpdate) {
        logger.info(` + Update is available: ${nameOfPackageToUpdate}@${commandOutput[nameOfPackageToUpdate]}`);
    }

    const originalPackageSourceContents = fs.readFileSync(packageSourceFilePath, 'utf8');

    let updatedPackageSourceContents = originalPackageSourceContents;

    for (const nameOfPackageToUpdate of packagesToUpdate) {
        // LAZY: Handling only the common syntaxes. There can be other syntaxes which aren't handled.
        let charIndicatingVersionRange = commandOutput[nameOfPackageToUpdate].charAt(0);
        if (
            charIndicatingVersionRange === '^' ||
            charIndicatingVersionRange === '~' ||
            charIndicatingVersionRange === '='
            // NOTE: Currently, we are filtering out the packages specified with "=" beforehand. So, while this case would never be reached, it's still kept for future reference.
        ) {
            // do nothing
        } else {
            charIndicatingVersionRange = '';
        }
        const latestSemverValue = commandOutput[nameOfPackageToUpdate]
            .replace('^', '')
            .replace('~', '')
            .replace('=', '');

        // LAZY: Handling only the common syntaxes. There can be other syntaxes which aren't handled
        // (e.g. computed keys like `[dependencyName]: '...'` in package.json.js / package.json.ts).
        // For package.json.js / package.json.ts, both single-quote and double-quote string literals
        // are recognized, and bare identifier keys are recognized for simple package names.
        const escapedName = escapeRegex(nameOfPackageToUpdate);
        const keyPattern = `(?:"${escapedName}"|'${escapedName}'|(?<!\\w)${escapedName}(?!\\w))`;
        const valuePattern = `(["'])[0-9.^~=]+(?:-[a-zA-Z0-9.]+)?\\2`;
        const regex = new RegExp(`(${keyPattern}[\\s]*:[\\s]*)${valuePattern}`);

        updatedPackageSourceContents = updatedPackageSourceContents.replace(
            regex,
            // LAZY: Replacing logic is a bit plain and there might be more cases to cover if we wish to go for a thorough solution
            (_match, prefix, quoteChar) => `${prefix}${quoteChar}${charIndicatingVersionRange}${latestSemverValue}${quoteChar}`
        );
    }

    if (originalPackageSourceContents === updatedPackageSourceContents) {
        logger.success(` ✔ ${packageSourceFilePathRelativeToCwd} seems up-to-date.`);
    } else {
        fs.writeFileSync(packageSourceFilePath, updatedPackageSourceContents);
        logger.warn(` ✔ Updated: ${packageSourceFilePathRelativeToCwd}`);
        logger.info(`   You may want to run:`);
        logger.info(`       $ npm install`);
    }
};

export { updatePackageCjson };
