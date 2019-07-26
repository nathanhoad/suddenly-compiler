import * as Path from 'path';
import * as enableDestroy from 'server-destroy';
import * as guessRootPath from 'guess-root-path';
import * as FS from 'fs-extra';
import { Application } from 'express';
import Chalk from 'chalk';
import * as execa from 'execa';
import * as Bundler from 'parcel-bundler';
import { CompilerOptions, DEFAULT_COMPILER_OPTIONS, loadServer, guessServerPath, guessCompiledPath } from './util';

// Need to keep a reference to the bundler to gracefully stop it
let bundler: any;

async function gracefullyExit() {
  if (bundler) {
    await bundler.stop();
  }
  process.exit();
}

/**
 * Clean the output folder
 * @param options compiler options
 */
export async function clean(options: CompilerOptions = {}): Promise<any> {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  const startedCleaningAt = new Date();

  // Remove output
  const compiledPath = guessCompiledPath({ isLoggingEnabled: false });
  const outputDirectory = compiledPath.replace(guessRootPath(), '');
  if (!compiledPath.includes('/src')) {
    await FS.remove(compiledPath);

    if (options.isLoggingEnabled) {
      const time = ((new Date().getTime() - startedCleaningAt.getTime()) / 1000).toFixed(2);
      console.log(`  ${Chalk.yellow('•')} Deleted ${Chalk.bold(outputDirectory)} directory ${Chalk.gray(time + 's')}`);
    }
  }
}

/**
 * Compile the server and set up a watch
 * @param options compiler options
 */
export function compileServer(options: CompilerOptions = {}): Promise<any> {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  const startedCompilingAt = new Date();
  return execa('tsc')
    .then(() => {
      if (options.isLoggingEnabled) {
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
      gracefullyExit();
    });
}

/**
 * Compile the client
 * @param options compiler options
 */
export function compileClient(options: CompilerOptions = {}): Promise<any> {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  let isFirstBuild = true;
  let startedCompilingAt = new Date();

  const compiledPath = guessCompiledPath({ isLoggingEnabled: false });
  const tempPath = Path.join(options.rootPath, '.cache', 'client.html');
  const relativeScriptPath = Path.relative(Path.dirname(tempPath), Path.join(options.rootPath, options.clientIndex));

  // Make a temp HTML file to house our bundled script reference
  // Down further it will be injected into the actual HTML view
  FS.writeFileSync(tempPath, `<script src="${relativeScriptPath}"></script>`);

  let lastProblemAt: Date = null;
  bundler = new Bundler(tempPath, {
    watch: true,
    logLevel: 0,
    outDir: Path.join(compiledPath, 'public'),
    outFile: 'client.html',
    publicUrl: '/assets/'
  });

  // Apply any plugins or whatever
  options.onBeforeBundle(bundler);

  bundler.on('buildStart', (entryPoints: any[]) => {
    startedCompilingAt = new Date();
  });
  bundler.on('bundled', (bundle: any) => {
    if (lastProblemAt !== null) {
      console.log(Chalk.greenBright('\n  • Looks like the problem is fixed now'));
      lastProblemAt = null;
    }

    if (bundle.entryAsset) {
      // Work out where to compile our full HTML template
      let viewsPath = Path.join(options.rootPath, 'src', 'server', 'views');
      try {
        viewsPath = loadServer({ isLoggingEnabled: false })
          .get('views')
          .find((v: any) => v.includes('src'));
      } catch (e) {
        // Do nothing
      }

      // Inject the bundled script tag into the actual HTML view
      let htmlContent = FS.readFileSync(Path.join(viewsPath, 'index.html.ejs'), 'utf8');
      htmlContent = htmlContent.replace('</body>', `${bundle.entryAsset.generated.html}</body>`);

      // Find all of the locals in the template and replace them with
      // definition checks
      htmlContent.match(/\<\%\= (.*) \%\>/g).forEach(match => {
        const word = match.match(/\<\%\= (.*) \%\>/)[1];
        htmlContent = htmlContent.replace(match, `<% if (typeof ${word} !== "undefined") { %>${match}<% } %>`);
      });

      FS.writeFileSync(Path.join(compiledPath, 'public', 'index.html.ejs'), htmlContent);

      if (isFirstBuild) {
        isFirstBuild = false;
        const time = ((new Date().getTime() - startedCompilingAt.getTime()) / 1000).toFixed(2);
        console.log(`  ${Chalk.yellow('•')} Compiled client ${Chalk.gray(time + 's')}`);
      }
    }
  });
  bundler.on('buildError', (error: any) => {
    lastProblemAt = new Date();
    console.log(`  ${Chalk.red('• There was a problem compiling the client')}\n`);
    if (error.highlightedCodeFrame) {
      console.error(error.fileName);
      console.error(error.highlightedCodeFrame);
    } else {
      console.error(error);
    }

    if (isFirstBuild) {
      console.log(`\n 💥  ${Chalk.bold.yellow('Try again once the problem is resolved.')}\n`);
      gracefullyExit();
    }
  });

  return bundler.bundle();
}

/**
 * Run the server and an asset server for Webpack output
 * @param options compiler options
 */
export function run(options: CompilerOptions = {}): Promise<any> {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  return new Promise((resolve, reject) => {
    process.on('uncaughtException', err => {
      console.error(err);
      gracefullyExit();
    });

    // Handle Ctrl+C gracefully
    process.stdin.setRawMode(true);
    process.stdin.on('data', async d => {
      if (d[0] == 3 || d.toString() === 'q') {
        console.log(`\n 🛰  Server stoppped.\n`);
        gracefullyExit();
      }
    });

    const serverPath = guessServerPath();
    let server: Application = loadServer();
    let listener: any;
    let lastProblemAt: Date = null;
    if (process.env.NODE_ENV !== 'production') {
      FS.watch(serverPath, { recursive: true }, async (e, filename) => {
        if (filename.match(/^public\//)) return;

        // Purge all connections on the current server
        listener.destroy();

        // Load in file changes
        try {
          server = loadServer(options);
          listener = server.listen(process.env.PORT || 5000, () => {
            if (lastProblemAt !== null && options.isLoggingEnabled) {
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

      // Run the server
      listener = server.listen(process.env.PORT || 5000, () => {
        if (options.isLoggingEnabled) {
          console.log(
            `\n 🚀  Running at ${Chalk.bold(`http://localhost:${process.env.PORT || 5000}`)}\n    ${Chalk.gray(
              'Press Ctrl+c or q to quit'
            )}\n`
          );
        }
      });
      enableDestroy(listener);
    }
  });
}

/**
 * Compile both the server and the client
 * @param options any compiler options to initialize
 */
export async function compile(options: CompilerOptions = {}): Promise<any> {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  compileClient(options);
  await compileServer(options);
}

/**
 * Clean and compile the app, then run it
 * @param options any compiler options to initialize
 */
export async function compileAndRun(options: CompilerOptions = {}) {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);

  try {
    // Blank line above output
    if (options.isLoggingEnabled) console.log('');

    // Don't clean production; some caches might point to
    // slightly older files
    if (process.env.NODE_ENV !== 'production') {
      await clean();
    }

    await compile(options);
    await run(options);
  } catch (e) {
    if (options.isLoggingEnabled) console.error(e);
    gracefullyExit();
  }
}

export default compileAndRun;
