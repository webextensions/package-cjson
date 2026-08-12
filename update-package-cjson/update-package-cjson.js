#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

import { logger } from 'note-down';

const DEPENDENCY_SECTIONS = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
];

// The version-range syntaxes which the update policy can classify (and therefore rewrite).
const DECLARED_RANGE_PATTERN = /^([\^~=]?)(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)$/;

const escapeRegex = function (value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Returns { operator, version } for the handled syntaxes ("operator" being '' for a prefix-less "1.2.3"),
// or null for every other version range syntax (">=1.0.0", "1.x", "*", "a || b", "latest", git URLs,
// "workspace:", "file:", npm aliases etc).
const parseDeclaredRange = function (declaredRange) {
    const match = DECLARED_RANGE_PATTERN.exec(declaredRange);
    if (!match) {
        return null;
    }
    return {
        operator: match[1],
        version: match[2]
    };
};

// npm-check-updates echoes back the declared version-range prefix. The prefix is always taken from the
// declaration itself, so this strips whatever npm-check-updates returned.
const versionWithoutRangePrefix = function (value) {
    return value.replace(/^[\^~=]/, '');
};

const majorOf = function (version) {
    return version.split('.')[0];
};

// The declared version ranges are read from "package.json" (the very file which npm-check-updates surveys),
// so that both views of the project agree.
const readDeclaredRanges = function (folderPath) {
    const packageJsonFilePath = path.resolve(folderPath, 'package.json');

    let packageJson;
    try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonFilePath, 'utf8'));
    } catch (e) {
        console.error(e);
        logger.error(`\nFailed to read the declared dependency versions from: ${packageJsonFilePath}`);
        console.log('');
        return [e];
    }

    const declaredRanges = new Map();
    for (const dependencySection of DEPENDENCY_SECTIONS) {
        const dependencies = packageJson[dependencySection];
        if (dependencies && typeof dependencies === 'object') {
            for (const [name, declaredRange] of Object.entries(dependencies)) {
                if (typeof declaredRange === 'string' && !declaredRanges.has(name)) {
                    declaredRanges.set(name, declaredRange);
                }
            }
        }
    }

    return [null, declaredRanges];
};

const runNpmCheckUpdates = function (folderPath, target) {
    // Alternatively, use 'npm outdated --json', but that may not lead to an output for the cases where the installed
    // dependency is already at newer version, due to "^" and "~" characters in the semver syntax
    const command = (
        target ?
            `npm-check-updates --jsonUpgraded --target ${target}` :
            'npm-check-updates --jsonUpgraded'
    );

    let commandOutput;
    try {
        commandOutput = execSync(
            command,
            {
                cwd: folderPath,
                encoding: 'utf8'
            }
        );
    } catch (e) {
        console.error(e);
        logger.error('\nFailed to execute the following command:');
        logger.error(`    $ ${command}`);
        logger.info('\nYou may need to run the following command:');
        logger.info('    $ npm install -g npm-check-updates');
        console.log('');
        return [e];
    }

    return [null, JSON.parse(commandOutput)];
};

// The version-range prefix declared for a dependency states the update intent, and it is honored as follows:
//     "^1.2.3"  =>  update to the latest available version (major bumps included)
//     "1.2.3"   =>  update to the latest available version (major bumps included), staying prefix-less
//     "~1.2.3"  =>  update to the latest version within the SAME major (a newer major is reported, not applied)
//     "=1.2.3"  =>  never updated (reported, so that it can be handled manually)
//     anything else  =>  never updated (reported as an unsupported version range)
const updatePackageCjson = function (packageSourceFilePath) {
    const folderPath = path.dirname(packageSourceFilePath);

    const packageSourceFilePathRelativeToCwd = path.relative(process.cwd(), packageSourceFilePath);
    logger.info(`\n > Checking ${packageSourceFilePathRelativeToCwd} for updates`);

    const [errorInDeclaredRanges, declaredRanges] = readDeclaredRanges(folderPath);
    if (errorInDeclaredRanges) {
        return [errorInDeclaredRanges];
    }

    // The default "--target latest" pass: the latest available version for every dependency, major bumps included.
    const [errorInLatestPass, latestUpgrades] = runNpmCheckUpdates(folderPath);
    if (errorInLatestPass) {
        return [errorInLatestPass];
    }

    // npm-check-updates can apply only one "--target" per run (its per-dependency "target" predicate is available
    // in ".ncurc.js" / its Node.js API only), so "~" entries need a second pass. It is skipped altogether when the
    // project has no "~" entry. The check is made against the declarations rather than against the first pass's
    // output, so that a "~" entry which the first pass did not report is still surveyed.
    const hasTildeEntry = [...declaredRanges.values()].some((declaredRange) => {
        return parseDeclaredRange(declaredRange)?.operator === '~';
    });

    let minorUpgrades = {};
    if (hasTildeEntry) {
        const [errorInMinorPass, upgrades] = runNpmCheckUpdates(folderPath, 'minor');
        if (errorInMinorPass) {
            return [errorInMinorPass];
        }
        minorUpgrades = upgrades;
    }

    const namesOfPackagesWithUpdates = new Set([
        ...Object.keys(latestUpgrades),
        ...Object.keys(minorUpgrades)
    ]);

    const packagesToUpdate = [];

    for (const nameOfPackage of namesOfPackagesWithUpdates) {
        const declaredRange = declaredRanges.get(nameOfPackage);
        const parsedDeclaredRange = declaredRange ? parseDeclaredRange(declaredRange) : null;

        if (!parsedDeclaredRange) {
            const suggestedValue = latestUpgrades[nameOfPackage] || minorUpgrades[nameOfPackage];
            logger.warn(` ! Unsupported version range for ${nameOfPackage}: "${declaredRange ?? '(not declared)'}" (npm-check-updates suggests "${suggestedValue}"). Please review it manually.`);
            continue;
        }

        const { operator } = parsedDeclaredRange;

        if (operator === '=') {
            logger.warn(` ! Please update manually to: ${nameOfPackage}@${latestUpgrades[nameOfPackage] || minorUpgrades[nameOfPackage]}`);
            continue;
        }

        if (operator === '~') {
            const latestValue = latestUpgrades[nameOfPackage];
            if (latestValue) {
                const latestVersion = versionWithoutRangePrefix(latestValue);
                if (majorOf(latestVersion) !== majorOf(parsedDeclaredRange.version)) {
                    logger.warn(` ! Held back by "~": ${nameOfPackage}@${latestVersion} (newer major available)`);
                }
            }
        }

        const applicableValue = (operator === '~') ? minorUpgrades[nameOfPackage] : latestUpgrades[nameOfPackage];
        if (!applicableValue) {
            continue;
        }

        const updatedRange = `${operator}${versionWithoutRangePrefix(applicableValue)}`;
        if (updatedRange === declaredRange) {
            continue;
        }

        packagesToUpdate.push({
            name: nameOfPackage,
            declaredRange,
            updatedRange
        });
    }

    for (const packageToUpdate of packagesToUpdate) {
        logger.info(` + Update is available: ${packageToUpdate.name}@${packageToUpdate.updatedRange}`);
    }

    const originalPackageSourceContents = fs.readFileSync(packageSourceFilePath, 'utf8');

    let updatedPackageSourceContents = originalPackageSourceContents;

    for (const packageToUpdate of packagesToUpdate) {
        // LAZY: Handling only the common syntaxes. There can be other syntaxes which aren't handled
        // (e.g. computed keys like `[dependencyName]: '...'` in package.json.js / package.json.ts).
        // For package.json.js / package.json.ts, both single-quote and double-quote string literals
        // are recognized, and bare identifier keys are recognized for simple package names.
        const escapedName = escapeRegex(packageToUpdate.name);
        const keyPattern = `(?:"${escapedName}"|'${escapedName}'|(?<!\\w)${escapedName}(?!\\w))`;
        // The value must equal the range declared in package.json: since package.json is generated from this
        // source file, an in-sync occurrence is byte-identical to it. An occurrence whose value differs (a
        // stale package.json, or another dependency section declaring a different range for the same package)
        // is deliberately left untouched, so that its own version-range prefix never gets overwritten.
        const valuePattern = `(["'])${escapeRegex(packageToUpdate.declaredRange)}\\2`;
        // The "g" flag is needed because the same package may be declared more than once (e.g. in both
        // "dependencies" and "devDependencies", or across multiple dependency-category objects), and leaving
        // any occurrence behind at the old version would make the generated package.json inconsistent.
        const regex = new RegExp(`(${keyPattern}[\\s]*:[\\s]*)${valuePattern}`, 'g');

        updatedPackageSourceContents = updatedPackageSourceContents.replace(
            regex,
            // LAZY: Replacing logic is a bit plain and there might be more cases to cover if we wish to go for a thorough solution
            (_match, prefix, quoteChar) => `${prefix}${quoteChar}${packageToUpdate.updatedRange}${quoteChar}`
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
