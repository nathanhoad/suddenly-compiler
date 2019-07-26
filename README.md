# @suddenly/compiler

A compiler/runner for [`@suddenly/server`](https://www.npmjs.com/package/@suddenly/server) apps.

The compiler assumes you're using TypeScript and have set `"main"` in your `package.json` to point to your compiled server file.

## Usage

An example `build` script:

```js
#!/usr/bin/env node
require('@suddenly/compiler').compileAndRun();
```

You can also hook in to the `parcel-bundler` instance before the client compilation happens:

```js
#!/usr/bin/env node
require('@suddenly/compiler').compileAndRun({
  onBeforeBundle(bundler) {
    bundler.addPackager('foo', require.resolve('./MyPackager'));
  }
});
```

## Contributors

- Nathan Hoad - [nathan@nathanhoad.net](mailto:nathan@nathanhoad.net)
