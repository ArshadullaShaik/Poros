import { bundle } from './build.mjs';
import { createDemoServer } from '../../../src/features/builder/demo/server.mjs';

await bundle();
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be from 0 to 65535.');
const server = createDemoServer();
server.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('Poros: http://127.0.0.1:' + server.address().port));
