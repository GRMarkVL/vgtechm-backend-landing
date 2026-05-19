/* eslint-disable no-console */
import 'dotenv/config';
import * as http from 'node:http';
import { google } from 'googleapis';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });

  console.log('\nOpen this URL in browser logged in as the calendar owner:\n');
  console.log(url);
  console.log('\nWaiting for callback...\n');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '', `http://127.0.0.1:${PORT}`);
        if (u.pathname !== '/oauth2callback') {
          res.statusCode = 404;
          res.end();
          return;
        }
        const c = u.searchParams.get('code');
        if (!c) {
          res.statusCode = 400;
          res.end('Missing code');
          reject(new Error('Missing code'));
          return;
        }
        res.statusCode = 200;
        res.end('OK — you can close this tab and return to the terminal.');
        server.close();
        resolve(c);
      } catch (err) {
        reject(err as Error);
      }
    });
    server.listen(PORT);
  });

  const { tokens } = await oauth2.getToken(code);
  console.log('\n=== Tokens ===');
  console.log(JSON.stringify(tokens, null, 2));
  console.log('\nAdd to .env:');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
