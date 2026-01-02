
export default {
    async scheduled(event, env, ctx) {
        console.log("Cron Triggered");
        const botUrl = env.BOT_API_URL;
        const secret = env.BOT_SECRET;

        if (!botUrl) {
            console.error("BOT_API_URL not set");
            return;
        }

        const url = `${botUrl}?action=check_proxies&secret=${secret}`;
        console.log(`Fetching ${url}...`);

        try {
            const resp = await fetch(url);
            console.log(`Response: ${resp.status}`);
        } catch (e) {
            console.error("Fetch Error:", e);
        }
    },

    async fetch(request) {
        return new Response("Monitor Worker Active. Use Cron Trigger.");
    }
};
