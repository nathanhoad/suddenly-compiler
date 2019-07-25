# @suddenly/compiler

A compiler/runner for [`@suddenly/server`](https://www.npmjs.com/package/@suddenly/server) apps.

The compiler assumes you're using TypeScript and have set `"main"` in your `package.json` to point to your compiled server file.

## Usage

By default the compiler will use it's own Webpack config.

You can extend it by creating a `webpack.config.js`:

```js
const { getWebpackConfig } = require('@suddenly/compiler');

const config = getWebpackConfig();

config.module.rules.push({
  test: /\.blah$/,
  use: 'blah-loader',
  exclude: '/node_modules/'
});

module.exports = config;
```

An example `build` script:

```js
#!/usr/bin/env node
require('@suddenly/compiler').compileAndRun();
```

## Contributors

- Nathan Hoad - [nathan@nathanhoad.net](mailto:nathan@nathanhoad.net)
