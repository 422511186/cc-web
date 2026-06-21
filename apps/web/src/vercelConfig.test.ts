import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Vercel static deployment config', () => {
  it('rewrites SPA deep links such as /pair/:code to index.html', () => {
    const configPath = resolve(__dirname, '../public/vercel.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    expect(config.rewrites).toContainEqual({
      source: '/(.*)',
      destination: '/index.html',
    });
  });
});
