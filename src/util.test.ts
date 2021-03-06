import { guessCompiledPath, guessServerPath, loadServer } from './util';
import * as Path from 'path';

describe('Util', () => {
  it('can guess the compiled path', () => {
    let path = guessCompiledPath({ isLoggingEnabled: false });

    expect(path).toContain('/dist');
  });

  it('can guess the server path', () => {
    let path = guessServerPath({ isLoggingEnabled: false });

    expect(path).toContain('/dist');
  });

  describe('Server loading', () => {
    it('fails with a missing server', () => {
      expect(() => {
        loadServer({ isLoggingEnabled: false, rootPath: Path.join(__dirname, 'not-a-real-directory') });
      }).toThrow();
    });

    it('fails if the server will not listen', () => {
      expect(() => {
        loadServer({ isLoggingEnabled: false, rootPath: Path.join(__dirname, 'test', 'bogus-server') });
      }).toThrowError(/listen/);
    });
  });
});
