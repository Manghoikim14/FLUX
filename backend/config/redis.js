function redisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null,
  };

  if (url.password) connection.password = decodeURIComponent(url.password);
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.protocol === 'rediss:') connection.tls = {};
  if (url.pathname.length > 1) connection.db = Number(url.pathname.slice(1));

  return connection;
}

module.exports = redisConnection;
