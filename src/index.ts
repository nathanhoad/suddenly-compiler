import * as Path from 'path';
import * as webpack from 'webpack';
import * as WebpackDevServer from 'webpack-dev-server';
import * as enableDestroy from 'server-destroy';
import * as guessRootPath from 'guess-root-path';
import * as FS from 'fs-extra';
import { Application } from 'express';
import Chalk from 'chalk';
import * as execa from 'execa';
import { getWebpackConfig, loadServer, guessServerPath, guessCompiledPath } from './util';

export interface CompilerOptions {
  isLoggingEnabled?: boolean;
}

const DEFAULT_COMPILER_OPTIONS = {
  isLoggingEnabled: true
};

let OPTIONS: CompilerOptions;

/**
 * Configure the compiler
 * @param options the compiler options
 */
export function initialize(options: CompilerOptions): void {
  OPTIONS = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);
}

/**
 * Clean the output folder
 */
export async function clean(): Promise<any> {
  const startedCleaningAt = new Date();

  const rootPath = guessRootPath();
  const config = getWebpackConfig({ isLoggingEnabled: false });

  // Remove client files
  await FS.remove(Path.join(rootPath, config.output.path.replace(rootPath, '')));

  // Remove server files
  const compiledPath = guessCompiledPath({ isLoggingEnabled: false });

  if (!compiledPath.includes('/src')) {
    await FS.remove(compiledPath);
  }

  if (OPTIONS.isLoggingEnabled) {
    const time = ((new Date().getTime() - startedCleaningAt.getTime()) / 1000).toFixed(2);
    console.log(`  ${Chalk.yellow('•')} Cleaned output directory ${Chalk.gray(time + 's')}`);
  }
}

/**
 * Compile the server and set up a watch
 */
export function compileServer(): Promise<any> {
  const startedCompilingAt = new Date();
  return execa('tsc')
    .then(() => {
      if (OPTIONS.isLoggingEnabled) {
        const time = ((new Date().getTime() - startedCompilingAt.getTime()) / 1000).toFixed(2);
        console.log(`  ${Chalk.yellow('•')} Compiled server ${Chalk.gray(time + 's')}`);
      }

      // Set up a watch for server changes
      if (process.env.NODE_ENV !== 'production') {
        execa('tsc', ['-w']);
      }
    })
    .catch(err => {
      console.log(`  ${Chalk.red('• There was a problem compiling the server')}\n`);
      console.error(err);
      process.exit();
    });
}

/**
 * Compile the client
 */
export function compileClient(): Promise<any> {
  return new Promise((resolve, reject) => {
    const config = getWebpackConfig({ isLoggingEnabled: OPTIONS.isLoggingEnabled });
    const compiler = webpack(config);
    compiler.run((err, stats) => {
      if (err) return reject(err);

      const output: any = stats.toJson();
      if (output.errors.length === 0) {
        if (OPTIONS.isLoggingEnabled) {
          console.log(`  ${Chalk.yellow('•')} Compiled client ${Chalk.gray((output.time / 1000).toFixed(2) + 's')}`);
        }
        resolve(output);
      } else {
        if (OPTIONS.isLoggingEnabled) {
          console.log(`  ${Chalk.red('• There was a problem compiling the client')}`);
          console.error(output.errors.join('\n'));
          process.exit();
        } else {
          return reject(new Error(output.errors.join('\n')));
        }
      }
    });
  });
}

/**
 * Run the server and an asset server for Webpack output
 */
export function run(): Promise<any> {
  return new Promise((resolve, reject) => {
    process.on('uncaughtException', err => {
      console.error(err);
    });

    // Handle Ctrl+C gracefully
    process.stdin.setRawMode(true);
    process.stdin.on('data', d => {
      if (d[0] == 3 || d.toString() === 'q') {
        console.log(`\n 🛰  Server stoppped.\n`);
        process.exit();
      }
    });

    const serverPath = guessServerPath();
    let server: Application = loadServer();
    let listener: any;

    const config = getWebpackConfig({ isLoggingEnabled: OPTIONS.isLoggingEnabled });
    let compiler = webpack(config);

    let lastProblemAt: Date = null;
    if (process.env.NODE_ENV !== 'production') {
      FS.watch(serverPath, { recursive: true }, async e => {
        // Purge all connections on the current server
        listener.destroy();

        // Load in file changes
        try {
          server = loadServer({ isLoggingEnabled: OPTIONS.isLoggingEnabled });
          listener = server.listen(process.env.PORT || 5000, () => {
            if (lastProblemAt !== null && OPTIONS.isLoggingEnabled) {
              console.log(Chalk.greenBright('\n  • Looks like the problem is fixed now'));
              console.log(
                `\n 🚀  Running again at ${Chalk.bold(
                  `http://localhost:${process.env.PORT || 5000}`
                )}\n    ${Chalk.gray('Press Ctrl+c or q to quit')}\n`
              );
            }
            lastProblemAt = null;
          });
          enableDestroy(listener);
        } catch (e) {
          lastProblemAt = new Date();
          console.error(e);
        }
      });

      // Run the asset server
      const assetServer = new WebpackDevServer(compiler, {
        contentBase: config.output.path,
        publicPath: config.output.publicPath,
        noInfo: true,
        quiet: true,
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      });
      assetServer.listen(5050, 'localhost', err => {
        if (err) return reject(err);

        listener = server.listen(process.env.PORT || 5000, () => {
          if (OPTIONS.isLoggingEnabled) {
            console.log(
              `\n 🚀  Running at ${Chalk.bold(`http://localhost:${process.env.PORT || 5000}`)}\n    ${Chalk.gray(
                'Press Ctrl+c or q to quit'
              )}\n`
            );
          }
        });
        enableDestroy(listener);
      });
    }
  });
}

/**
 * Compile both the server and the client
 * @param options any compiler options to initialize
 */
export async function compile(options: CompilerOptions = {}): Promise<any> {
  initialize(options);
  await compileServer();
  await compileClient(); // Webpack config depends on server views config
}

/**
 * Clean and compile the app, then run it
 * @param options any compiler options to initialize
 */
export async function compileAndRun(options: CompilerOptions = {}) {
  initialize(options);
  try {
    // Blank line above output
    if (OPTIONS.isLoggingEnabled) console.log('');

    // Don't clean production; some caches might point to
    // slightly older files
    if (process.env.NODE_ENV !== 'production') {
      await clean();
    }

    await compile();
    await run();
  } catch (e) {
    if (OPTIONS.isLoggingEnabled) console.error(e);
    process.exit();
  }
}

export default compileAndRun;
