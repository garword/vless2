
import 'dotenv/config';

async function setWebhook() {
    const token = process.env.BOT_TOKEN;
    if (!token) {
        console.error("❌ BOT_TOKEN is missing in .env");
        process.exit(1);
    }

    const webhookUrl = "https://vless2.vercel.app/api/webhook";
    const apiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${webhookUrl}`;

    console.log(`🔗 Setting webhook to: ${webhookUrl}`);

    try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("❌ Failed to set webhook:", e);
    }
}

setWebhook();
