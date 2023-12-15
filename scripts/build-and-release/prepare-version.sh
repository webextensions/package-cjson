#!/bin/bash

cd "$(dirname "$0")" # Change directory to the folder containing this file
cd ../../            # Change directory to project's root folder

# https://stackoverflow.com/questions/2870992/automatic-exit-from-bash-shell-script-on-error
# https://stackoverflow.com/questions/821396/aborting-a-shell-script-if-any-command-returns-a-non-zero-value
set -e

if which jq > /dev/null; then
    : # do nothing because "jq" already exists
else
    printf "${RED}To use this script ($0), we need to install jq using:${NORMAL}"
    printf "\n${RED}    $ sudo apt install jq${NORMAL}"
    printf "\n"
    exit 1
fi

packageVersionWithQuotes=$(jq ".version" ./package.json)
packageVersionWithoutQuotes=$(jq --raw-output ".version" ./package.json)

sed -i --regexp-extended 's/"version": "[0-9.]+"/"version": '$packageVersionWithQuotes'/' ./package.cjson

set -x

git add ./package.cjson
