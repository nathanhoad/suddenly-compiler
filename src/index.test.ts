import { getWebpackConfig } from '.';

describe('Compiler', () => {
  it('can generate a default webpack config', () => {
    let config = getWebpackConfig({ isLoggingEnabled: false });

    expect(config).toHaveProperty('entry');
    expect(config).toHaveProperty('output');
    expect(config).toHaveProperty('module');
    expect(config).toHaveProperty('plugins');
  });
});
