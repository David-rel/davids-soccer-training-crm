#!/usr/bin/env tsx
import { config } from 'dotenv';
import { createServer } from 'http';
import { OAuth2Client } from 'google-auth-library';

config({ path: '.env.local' });
config({ path: '.env' });

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar'];

function requireEnv(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.local first.`);
  }
  return value;
}

function getFlagValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return null;
  return next;
}

async function waitForCodeFromRedirect(redirectUri: string, timeoutMs = 10 * 60 * 1000): Promise<string> {
  const parsed = new URL(redirectUri);
  const expectedPath = parsed.pathname || '/';
  const expectedHost = parsed.hostname;
  const expectedPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));

  if (!['localhost', '127.0.0.1'].includes(expectedHost)) {
    throw new Error(
      `GOOGLE_OAUTH_REDIRECT_URI host must be localhost or 127.0.0.1 for auto-capture. Current: ${expectedHost}`
    );
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for OAuth callback.'));
    }, timeoutMs);

    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', redirectUri);
        if (requestUrl.pathname !== expectedPath) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        if (error) {
          clearTimeout(timer);
          server.close();
          res.statusCode = 400;
          res.end(`OAuth error: ${error}`);
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.end('Missing code query parameter');
          return;
        }

        clearTimeout(timer);
        server.close();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end('<h2>OAuth complete.</h2><p>You can close this tab and return to terminal.</p>');
        resolve(code);
      } catch (error) {
        clearTimeout(timer);
        server.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    server.listen(expectedPort, expectedHost, () => {
      console.log(`Listening for OAuth callback at ${redirectUri}`);
    });
  });
}

async function main() {
  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');
  const redirectUri =
    (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim() || 'http://localhost:5055/oauth2callback';

  const oauth = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  });

  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
  });

  console.log('\nOpen this URL in your browser and approve access:\n');
  console.log(authUrl);
  console.log('');

  let code = getFlagValue('--code');
  if (!code) {
    console.log('Waiting for callback...');
    code = await waitForCodeFromRedirect(redirectUri);
  }

  const { tokens } = await oauth.getToken(code);

  if (!tokens.refresh_token) {
    console.log('\nNo refresh_token returned.');
    console.log('Try again with prompt=consent and ensure this is the first grant for this client/user combo.');
    process.exit(1);
  }

  console.log('\nAdd this to your .env.local (or .env):\n');
  console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_OAUTH_REDIRECT_URI=${redirectUri}`);
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nThen run: npm run test-calendars');
}

main().catch((error) => {
  console.error('setup-google-oauth failed:', error);
  process.exit(1);
});
