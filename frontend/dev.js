import os from 'node:os';
import { createServer } from 'vite';

function getWifiAddress() {
  if (process.env.LAN_HOST) return process.env.LAN_HOST;

  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!/wi-?fi|wireless/i.test(name)) continue;
    const address = addresses?.find((item) => (
      item.family === 'IPv4' &&
      !item.internal &&
      !item.address.startsWith('169.254.')
    ));
    if (address) return address.address;
  }
  return null;
}

const hosts = ['localhost'];
const wifiAddress = getWifiAddress();
if (wifiAddress) hosts.push(wifiAddress);
else console.warn('No Wi-Fi IPv4 address found; starting the localhost URL only.');

const servers = [];
try {
  for (const host of hosts) {
    const server = await createServer({
      server: { host, port: 5173, strictPort: true },
    });
    await server.listen();
    servers.push(server);
    server.printUrls();
  }
} catch (error) {
  await Promise.all(servers.map((server) => server.close()));
  console.error('Unable to start the frontend development server:', error);
  process.exitCode = 1;
}

async function shutdown() {
  await Promise.all(servers.map((server) => server.close()));
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
