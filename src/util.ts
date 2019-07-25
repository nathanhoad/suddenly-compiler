require('dotenv').config();

import * as Path from 'path';
import * as guessRootPath from 'guess-root-path';
import * as FS from 'fs-extra';
import { Application } from 'express';
import * as Webpack from 'webpack';
import * as HTMLPlugin from 'html-webpack-plugin';
import Chalk from 'chalk';

export interface UtilOptions {
  isLoggingEnabled?: Boolean;
  rootPath?: string;
}

const DEFAULT_UTIL_OPTIONS: UtilOptions = {
  isLoggingEnabled: true,
  rootPath: guessRootPath()
};

/**
 * Purge the cache kept for requiring modules
 * @param target The require string to purge the cache for
 */
export function clearRequireCache(target: string): void {
  Object.keys(require.cache).forEach(key => {
    if (key.includes(target)) {
      delete require.cache[key];
    }
  });
}

/**
 * Load a fresh copy of the Webpack config
 * @param options Some utility options
 */
export function getWebpackConfig(options: UtilOptions = {}): any {
  options = Object.assign({}, DEFAULT_UTIL_OPTIONS, options);

  const configPath = Path.join(options.rootPath, 'webpack.config');
  if (FS.existsSync(configPath)) {
    clearRequireCache(configPath);
    return require(configPath);
  }

  // Make our own
  const isProduction = process.env.NODE_ENV === 'production';
  const config = {
    entry: {
      client: Path.resolve(Path.join(options.rootPath, 'src', 'client', 'index.tsx'))
    },
    output: {
      path: Path.resolve(Path.join(options.rootPath, 'dist', 'public')),
      publicPath: '/assets/',
      filename: '[name]-[hash].js'
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: '/node_modules/'
        }
      ]
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js']
    },
    plugins: [new Webpack.EnvironmentPlugin(Object.keys(process.env))]
  };

  // Attempt to set up the HTML plugin
  let viewsPath = Path.join(options.rootPath, 'src', 'server', 'views');
  try {
    viewsPath = loadServer(options)
      .get('views')
      .find((v: string) => v.includes('src'));
  } catch (e) {
    // Do nothing
  }

  // Find all of the locals in the template
  // Replace them with further EJS to only render them if they get a value
  // This not only stops the HTMLPlugin from caring about them but also
  // mitigates the need to wrap everything in definition checks manually
  const template = Path.join(viewsPath, 'index.html.ejs');
  const templateParameters: any = {};
  if (FS.existsSync(template)) {
    const templateContent = FS.readFileSync(template, 'utf8');
    templateContent.match(/\<\%\= (.*) \%\>/g).forEach(match => {
      const word = match.match(/\<\%\= (.*) \%\>/)[1];
      templateParameters[word] = `<% if (typeof ${word} !== "undefined") { %>${match}<% } %>`;
    });
  }

  config.plugins.push(
    new HTMLPlugin({
      minify: {
        keepClosingSlash: true,
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true
      },
      template,
      templateParameters,
      filename: Path.join(guessCompiledPath(options), 'public', 'index.html.ejs')
    })
  );

  if (isProduction) {
    config.plugins.push(new Webpack.optimize.UglifyJsPlugin());
  } else {
    config.plugins.push(new Webpack.NamedModulesPlugin());
  }

  return config;
}

/**
 * Extract from the tsconfig where the output is going
 * @param options Some utility options
 */
export function guessCompiledPath(options: UtilOptions = {}): string {
  options = Object.assign({}, DEFAULT_UTIL_OPTIONS, options);

  const tsConfig = require(Path.join(options.rootPath, 'tsconfig.json'));
  if (tsConfig.compilerOptions && tsConfig.compilerOptions.outDir) {
    return Path.join(options.rootPath, tsConfig.compilerOptions.outDir);
  }

  return guessServerPath(options);
}

/**
 * Guess the server path based on package.json
 * @param options Some utility options
 */
export function guessServerPath(options: UtilOptions = {}): string {
  options = Object.assign({}, DEFAULT_UTIL_OPTIONS, options);

  // Find the server source path
  const pkg = require(Path.join(options.rootPath, 'package.json'));
  const path = Path.join(options.rootPath, pkg.main);

  if (!FS.existsSync(path)) return Path.join(options.rootPath, 'dist', 'server');

  return path.replace(Path.sep + 'index.js', '');
}

/**
 * Load a fresh copy of the server
 * @param options Some utility options
 */
export function loadServer(options: UtilOptions = {}): Application {
  options = Object.assign({}, DEFAULT_UTIL_OPTIONS, options);

  const serverPath = guessServerPath(options);
  clearRequireCache(serverPath);

  let server: any;
  try {
    server = require(serverPath);
  } catch (e) {
    if (options.isLoggingEnabled) {
      console.log(`  ${Chalk.red('• There is a problem with your server')}\n`);
    }
    throw e;
  }

  // If its a module then resolve its default
  if (typeof server.default !== 'undefined') {
    server = server.default;
  }

  if (typeof server.listen !== 'function') {
    if (options.isLoggingEnabled) {
      console.log(`  ${Chalk.red('• There is a problem with your server')}\n`);
    }
    throw new Error(`${serverPath} exists but does not respond to listen.`);
  }

  return server;
}
