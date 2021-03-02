#!/usr/bin/env node

const
    path = require('path'),
    fs = require('fs'),
    { execSync } = require('child_process');

const
    logger = require('note-down');

const updatePackageCjson = function (packageCjson) {
    const folderPath = path.dirname(packageCjson);

    const packageCjsonFilePath = path.join(folderPath, 'package.cjson');
    const packageCjsonFilePathRelativeToCwd = path.relative(process.cwd(), packageCjsonFilePath);
    logger.info(`\n > Checking ${packageCjsonFilePathRelativeToCwd} for updates`);

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

    const originalPackageCjsonContents = fs.readFileSync(packageCjsonFilePath, 'utf8');

    let updatedPackageCjsonContents = originalPackageCjsonContents;

    for (const nameOfPackageToUpdate of packagesToUpdate) {
        let latestSemverValue = commandOutput[nameOfPackageToUpdate];
        // LAZY: Handling only the common syntaxes. There can be other syntaxes which aren't handled.
        latestSemverValue = commandOutput[nameOfPackageToUpdate]
            .replace('^', '')
            .replace('~', '')
            .replace('=', '');
        updatedPackageCjsonContents = updatedPackageCjsonContents.replace(
            // LAZY: Handling only the common syntaxes. There can be other syntaxes which aren't handled.
            new RegExp(`"${nameOfPackageToUpdate}"[\\s]*:[\\s]*"[0-9.^~=]+"`),
            // LAZY: Replacing with "^" sign assuming that is the only case we need to cover for now
            `"${nameOfPackageToUpdate}": "^${latestSemverValue}"`
        );
    }

    if (originalPackageCjsonContents === updatedPackageCjsonContents) {
        logger.success(` ✔ ${packageCjsonFilePathRelativeToCwd} seems up-to-date.`);
    } else {
        fs.writeFileSync(packageCjsonFilePath, updatedPackageCjsonContents);
        logger.warn(` ✔ Updated: ${packageCjsonFilePathRelativeToCwd}`);
        logger.info(`   You may want to run:`);
        logger.info(`       $ npm install`);
    }
};

module.exports = { updatePackageCjson };
