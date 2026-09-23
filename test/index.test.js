// -----------------------------------------------------------------------------
// Entry point: how the process itself reacts to what no handler catches.
//
// `index.js` is started for real, against a minimal stand-in for the Gladys
// WebSocket — the reactions under test are the process staying up or exiting,
// which no in-process fake can observe.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../index.js', import.meta.url));

/**
 * A server that completes the WebSocket handshake, then closes with 4000 —
 * what Gladys does when it refuses the integration token.
 */
async function startRefusingGladys() {
  const server = createServer();
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.end(Buffer.from([0x88, 0x02, 0x0f, 0xa0])); // close frame, code 4000
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

/** Start `index.js` and collect what it writes and how it ends. */
function startIntegration({ port, nodeArgs = [] }) {
  const child = spawn(process.execPath, [...nodeArgs, INDEX], {
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: `http://127.0.0.1:${port}`,
      GLADYS_INTEGRATION_TOKEN: 'test-token',
      GLADYS_INTEGRATION_SELECTOR: 'overkiz',
      LOG_LEVEL: 'info',
    },
  });
  const run = { child, output: '', exitCode: undefined };
  child.stdout.on('data', (chunk) => (run.output += chunk));
  child.stderr.on('data', (chunk) => (run.output += chunk));
  run.exited = new Promise((resolve) =>
    child.on('exit', (code) => {
      run.exitCode = code;
      resolve(code);
    }),
  );
  return run;
}

async function waitForOutput(run, pattern, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!pattern.test(run.output)) {
    if (Date.now() > deadline || run.exitCode !== undefined) {
      assert.fail(`never logged ${pattern}, got:\n${run.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('a token refused at startup is logged and the process stays up', async (t) => {
  // Gladys refuses the token while it boots too, and the SDK keeps
  // reconnecting on its own. Exiting spent the supervisor's restart budget —
  // five of them and the integration was left in ERROR for good.
  const gladys = await startRefusingGladys();
  const run = startIntegration({ port: gladys.address().port });
  t.after(() => {
    run.child.kill('SIGKILL');
    gladys.close();
  });

  await waitForOutput(run, /authentication refused by Gladys/);
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.equal(run.exitCode, undefined, `the process exited:\n${run.output}`);
  assert.match(run.output, /\[ERROR\] Initial connection to Gladys failed.*close code 4000/);
});
