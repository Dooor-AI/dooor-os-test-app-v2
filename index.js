const http = require('http');
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from Dooor OS!',
    app: 'hello-world',
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV || 'production',
      PORT: port,
    }
  }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
