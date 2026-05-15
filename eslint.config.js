// https://eslint.org/docs/latest/use/configure/configuration-files

import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        },
        linterOptions: {
            reportUnusedDisableDirectives: true
        },
        rules: {
            indent: [
                'error',
                4,
                {
                    SwitchCase: 1,        // https://eslint.org/docs/rules/indent#switchcase
                    ignoreComments: true  // https://eslint.org/docs/rules/indent#ignorecomments
                }
            ],
            'linebreak-style': ['error', 'unix'],
            'no-console': 'off',
            'no-debugger': 'off',
            'no-shadow': 'off',

            'no-var': ['error'],
            'prefer-const': ['error'],

            quotes: 'off',                 // https://eslint.org/docs/rules/quotes
            semi: ['error', 'always']
        }
    }
];
