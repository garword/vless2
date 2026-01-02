const fs = require('fs');
const path = require('path');
const target = path.resolve(__dirname, '../../.env');
const content = `TURSO_DATABASE_URL="libsql://vmess2-vlesskuyu.aws-ap-northeast-1.turso.io"
TURSO_AUTH_TOKEN="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjczMzkwNjAsImlkIjoiOGZlOTg4NGItYzJlYy00ZTk4LTk0ZDUtNDBmNmM4ZTA1ZjIyIiwicmlkIjoiZjkzM2ZkYzMtOGIxMy00NWE5LTgwM2YtMmE0OTI0NjBjYjUxIn0.7I7Vv4qYJMPIU8NDky-YfIqL3wmzwyuI1GYGswsyB9wjQowmyttcgxe8Z9fgeSuwJY0hLaxzMoKVxzY_aXIfAA"
BOT_TOKEN="8553404196:AAHhti8hEzjJx_OsE0rk3Z0RVtX7M_BsnZU"
ADMIN_IDS="6242090623"
CHANNEL_ID="-1001767672802"`;
fs.writeFileSync(target, content);
console.log('✅ .env updated successfully');
