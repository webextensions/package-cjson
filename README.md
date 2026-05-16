# package-cjson

Add comments in `package.cjson`/`package.json.js`/`package.json.ts` in Node JS project; Generate `package.json` from it; Compare with `package.json`.

## Sources

`package-cjson` looks for package source file in this order:

1. `package.json.ts`
2. `package.json.js`
3. `package.cjson`

When `package.json.ts` or `package.json.js` is present, the default export is used as the contents for the generated `package.json`.

```ts
const dependencyName: string = 'chalk';

export default {
    name: 'my-package',
    version: '1.0.0',
    dependencies: {
        [dependencyName]: '^5.6.2'
    }
};
```

```js
const dependencyName = 'chalk';

export default {
    name: 'my-package',
    version: '1.0.0',
    dependencies: {
        [dependencyName]: '^5.6.2'
    }
};
```

The exported value must be JSON-serializable. Output is written with stable key ordering, using the indentation and trailing newline style from the source file.

`package-cjson` requires Node.js `>=24.2.0` (for `import.meta.main`, used to detect direct CLI invocation). `package.json.ts` is loaded with Node's native TypeScript support (available since `22.12.0`); `package.json.js` is loaded with Node's native JavaScript module support.

## Usage

```sh
package-cjson --mode generate-package-json
package-cjson --mode compare
package-cjson --mode generate-package-version-json
package-cjson --mode compare-package-version
```

The `update` mode updates dependency versions in the selected source file (`package.json.ts`, `package.json.js`, or `package.cjson`, in that priority order). The `update-and-generate-package-json` mode performs that update first, then generates `package.json` from the same source.

> **Note:** Dependencies declared with computed keys in `package.json.js`/`package.json.ts` (e.g. `[dependencyName]: '^1.0.0'`) are skipped by `--mode update`, since the package name does not appear literally in the source file.
