const https = require('https');

const data = JSON.stringify({
    update_id: 123456789,
    message: {
        message_id: 111,
        from: {
            id: 12345,
            is_bot: false,
            first_name: "Test",
            username: "testuser"
        },
        chat: {
            id: 12345,
            first_name: "Test",
            username: "testuser",
            type: "private"
        },
        date: Date.now() / 1000,
        text: "/start"
    }
});

const options = {
    hostname: 'vless2.vercel.app',
    port: 443,
    path: '/api/webhook',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log(`StatusCode: ${res.statusCode}`);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
