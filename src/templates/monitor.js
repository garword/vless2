// Monitor Worker
// Deployed to Feeder Account
// Triggered by CRON (e.g. every 5 hours)

export default {
    async scheduled(event, env, ctx) {
        // 1. Get List of Nodes from Main Bot
        // env.BOT_API_URL should be set in Worker Variables
        // env.BOT_SECRET to authenticate
        const botApi = env.BOT_API_URL;
        const secret = env.BOT_SECRET;

        if (!botApi) return;

        try {
            const resp = await fetch(`${botApi}/api/nodes?secret=${secret}`);
            if (!resp.ok) return;

            const nodes = await resp.json(); // Expect [{ subdomain: '...', ... }]

            for (const node of nodes) {
                const target = `https://${node.subdomain}/check`; // Assuming worker has /check endpoint
                const start = Date.now();
                try {
                    const check = await fetch(target);
                    if (check.status !== 200) {
                        await alertBot(botApi, secret, node.subdomain, `Status ${check.status}`);
                    }
                } catch (err) {
                    await alertBot(botApi, secret, node.subdomain, "Connection Failed");
                }
            }

        } catch (e) {
            console.error(e);
        }
    },

    async fetch(request, env, ctx) {
        return new Response("Monitor Active", { status: 200 });
    }
};

async function alertBot(botApi, secret, subdomain, error) {
    await fetch(`${botApi}/api/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, subdomain, error })
    });
}
