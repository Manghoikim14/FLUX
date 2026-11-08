import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL
  || `${window.location.protocol}//${window.location.hostname}:4000`;

export function connectSocket(token) {
  return io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
}
