# package-cjson

Add comments in `package.cjson`/`package.json.ts` in Node JS project; Generate `package.json` from it; Compare with `package.json`.

## Sources

`package-cjson` looks for package source file in this order:

1. `package.json.ts`
2. `package.cjson`

When `package.json.ts` is present, the default export is used as the contents for the generated `package.json`.

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

The exported value must be JSON-serializable. Output is written with stable key ordering, using the indentation and trailing newline style from the source file.

`package.json.ts` is loaded with Node's native TypeScript support, so it requires Node.js `>=22.12.0`.

## Usage

```sh
package-cjson --mode generate-package-json
package-cjson --mode compare
package-cjson --mode generate-package-version-json
package-cjson --mode compare-package-version
```

The `update` mode updates `package.cjson` dependencies. The `update-and-generate-package-json` mode still performs that `package.cjson` update first, then generates `package.json` from the selected source.
