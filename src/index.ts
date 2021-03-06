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

  // Try and guess what we are actually building
  let thing = 'server';
  const packageContents = FS.readFileSync(Path.join(options.rootPath, 'package.json'), 'utf8');
  if (packageContents.toLowerCase().includes('electron')) {
    thing = 'application';
  }

  const startedCompilingAt = new Date();
  return execa('tsc')
    .then(() => {
      if (options.isLoggingEnabled) {
        const time = ((new Date().getTime() - startedCompilingAt.getTime()) / 1000).toFixed(2);
        console.log(`  ${Chalk.yellow('•')} Compiled ${thing} ${Chalk.gray(time + 's')}`);
      }

      // Set up a watch for server changes
      if (thing === 'server' && process.env.NODE_ENV !== 'production') {
        execa('tsc', ['-w']);
      }
    })
    .catch(err => {
      console.log(`  ${Chalk.red(`• There was a problem compiling the ${thing}`)}\n`);
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

  FS.ensureDirSync(Path.dirname(tempPath));

  let tempTemplateBits = [];

  const scriptsPath = Path.join(options.rootPath, options.clientIndex);
  if (FS.existsSync(scriptsPath)) {
    const relativeScriptPath = Path.relative(Path.dirname(tempPath), scriptsPath);
    tempTemplateBits.push(`<script src="${relativeScriptPath}"></script>`);
  }

  const stylesPath = Path.join(options.rootPath, options.stylesIndex);
  if (FS.existsSync(stylesPath)) {
    const relativeStylesPath = Path.relative(Path.dirname(tempPath), stylesPath);
    tempTemplateBits.push(`<link rel="stylesheet" type="text/css" href="${relativeStylesPath}">`);
  }

  // Make a temp HTML file to house our bundled script reference
  // Down further it will be injected into the actual HTML view
  const GENERATED_DELIMITER = '||||';
  FS.writeFileSync(tempPath, tempTemplateBits.join(GENERATED_DELIMITER));

  let lastProblemAt: Date = null;
  bundler = new Bundler(tempPath, {
    watch: process.env.NODE_ENV === 'development',
    logLevel: 0,
    outDir: Path.join(compiledPath, 'public'),
    outFile: 'client.html',
    publicUrl: options.publicPath
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
      let templateFile = '';
      if (options.templateFile) {
        templateFile = Path.join(options.rootPath, options.templateFile);
      } else {
        let viewsPath;
        try {
          viewsPath = loadServer({ isLoggingEnabled: false })
            .get('views')
            .find((v: any) => v.includes('src'));
        } catch (e) {
          viewsPath = Path.join(options.rootPath, 'src', 'server', 'views');
        }
        templateFile = Path.join(viewsPath, 'index.html.ejs');
      }

      // If we can't find a template then just use the built in one
      if (!FS.existsSync(templateFile)) {
        templateFile = Path.join(__dirname, '..', 'template.html.ejs');
      }

      // Inject the bundled script tag into the actual HTML view
      let htmlContent = FS.readFileSync(templateFile, 'utf8');
      const [scriptContent, stylesContent] = bundle.entryAsset.generated.html.split(GENERATED_DELIMITER);
      if (stylesContent) {
        htmlContent = htmlContent.replace('</head>', `${stylesContent}</head>`);
      }
      if (scriptContent) {
        htmlContent = htmlContent.replace('</body>', `${scriptContent}</body>`);
      }

      // Find all of the locals in the template and replace them with
      // definition checks
      (htmlContent.match(/\<\%\= (.*) \%\>/g) || []).forEach(match => {
        const word = match.match(/\<\%\= (.*) \%\>/)[1];
        htmlContent = htmlContent.replace(match, `<% if (typeof ${word} !== "undefined") { %>${match}<% } %>`);
      });

      FS.writeFileSync(Path.join(compiledPath, 'public', Path.basename(templateFile)), htmlContent);

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
 * Copy a file or directory. If given a directory it will copy all files but not the directory itself
 * @param from the source file/directory
 * @param to the destination
 * @param options compiler options
 */
export function copy(from: string, to: string, options: CompilerOptions = {}): Promise<any> {
  options = Object.assign({}, DEFAULT_COMPILER_OPTIONS, options);
  console.log(`  ${Chalk.yellow('•')} Copied ${Chalk.bold(from)} to ${Chalk.bold(to)}`);
  from = Path.join(options.rootPath, from);
  to = Path.join(options.rootPath, to);
  return FS.copy(from, to);
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
