require('dotenv').config();

import * as Path from 'path';
import * as guessRootPath from 'guess-root-path';
import * as FS from 'fs-extra';
import { Application } from 'express';
import Chalk from 'chalk';

export interface CompilerOptions {
  isLoggingEnabled?: boolean;
  rootPath?: string;
  publicPath?: string;
  clientIndex?: string;
  templateFile?: string;
  stylesIndex?: string;
  onBeforeBundle?: (bundler: any) => void;
}

export const DEFAULT_COMPILER_OPTIONS: CompilerOptions = {
  isLoggingEnabled: true,
  rootPath: guessRootPath(),
  publicPath: '/assets/',
  clientIndex: 'src/client/index.tsx',
  stylesIndex: 'src/client/styles.scss',
  onBeforeBundle: b => {}
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
 * Extract from the tsconfig where the output is going
 * @param options Some utility options
 */
export function guessCompiledPath(options: CompilerOptions = {}): string {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

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
export function guessServerPath(options: CompilerOptions = {}): string {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  // Find the server source path
  const pkg = require(Path.join(options.rootPath, 'package.json'));
  const path = Path.join(options.rootPath, pkg.main);

  if (!FS.existsSync(path)) return Path.join(options.rootPath, 'dist');

  return path.replace(Path.sep + 'index.js', '');
}

/**
 * Load a fresh copy of the server
 * @param options Some utility options
 */
export function loadServer(options: CompilerOptions = {}): Application {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

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
