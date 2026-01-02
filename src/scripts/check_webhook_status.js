const https = require('https');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error("BOT_TOKEN missing");
    process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log("Webhook Info:");
        console.log(data);
    });
}).on('error', (e) => {
    console.error(e);
});
