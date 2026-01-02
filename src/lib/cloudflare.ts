export type CFAuth = {
    email: string;
    apiKey: string; // Global API Key or Token
    accountId: string;
};

const CF_API_URL = "https://api.cloudflare.com/client/v4";

async function cfRequest(endpoint: string, method: string, auth: CFAuth, body?: any) {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    // Support both Token (Bearer) and Global Key (X-Auth)
    if (auth.apiKey.startsWith("Bearer ")) {
        headers["Authorization"] = auth.apiKey;
    } else {
        headers["X-Auth-Email"] = auth.email;
        headers["X-Auth-Key"] = auth.apiKey;
    }

    const response = await fetch(`${CF_API_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    if (!data.success) {
        throw new Error(`CF API Error: ${data.errors[0]?.message || JSON.stringify(data.errors)}`);
    }
    return data.result;
}

export async function uploadWorker(auth: CFAuth, workerName: string, scriptContent: string, envVars?: Record<string, string>) {
    // Upload config and script. For simple Module workers, we upload metadata + part.
    // Ease of use: use the standard script upload endpoint (PUT /accounts/:id/workers/scripts/:name)
    // Note: This requires the script to be valid JS/Module.

    // We need to send it as a FormData or raw JS depending on type.
    // For simplicity, we assume standard ES Module worker.

    const metadata: any = { main_module: "index.js", compatibility_date: "2023-01-01" };
    if (envVars) {
        metadata.bindings = Object.entries(envVars).map(([key, value]) => ({
            type: "plain_text",
            name: key,
            text: value
        }));
    }

    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append("index.js", new Blob([scriptContent], { type: "application/javascript+module" }), "index.js");

    // Need to use raw fetch for FormData to let browser/node handle boundary
    const headers: Record<string, string> = {};
    if (auth.apiKey.startsWith("Bearer ")) {
        headers["Authorization"] = auth.apiKey;
    } else {
        headers["X-Auth-Email"] = auth.email;
        headers["X-Auth-Key"] = auth.apiKey;
    }

    const res = await fetch(`${CF_API_URL}/accounts/${auth.accountId}/workers/scripts/${workerName}`, {
        method: "PUT",
        headers,
        body: formData,
    });

    const data = await res.json();
    if (!data.success) {
        throw new Error(`CF Upload Error: ${data.errors[0]?.message || JSON.stringify(data.errors)}`);
    }
    return data.result;
}

// Support for Custom Domains (better for deep subdomains/SSL)
export async function addWorkerDomain(auth: CFAuth, accountId: string, workerName: string, hostname: string, zoneId: string) {
    return cfRequest(`/accounts/${accountId}/workers/domains`, "PUT", auth, {
        hostname,
        service: workerName,
        zone_id: zoneId
    });
}

export async function addWorkerRoute(auth: CFAuth, zoneId: string, pattern: string, workerName: string) {
    return cfRequest(`/zones/${zoneId}/workers/routes`, "POST", auth, {
        pattern,
        script: workerName,
    });
}

export async function createDNSRecord(auth: CFAuth, zoneId: string, name: string, content: string = "192.0.2.1", type: string = "A", proxied: boolean = true) {
    return cfRequest(`/zones/${zoneId}/dns_records`, "POST", auth, {
        type,
        name,
        content,
        proxied,
        ttl: 1 // automatic
    });
}

export async function getZones(auth: CFAuth) {
    return cfRequest(`/zones`, "GET", auth);
}

export async function updateWorkerCron(auth: CFAuth, workerName: string, crons: string[]) {
    return cfRequest(`/accounts/${auth.accountId}/workers/scripts/${workerName}/schedules`, "PUT", auth, [
        { cron: crons[0] } // Getting simple here, usually array of objects
    ]);
}

export async function updateWorkerEnv(auth: CFAuth, workerName: string, envVars: Record<string, string>) {
    // Fetch existing bindings/settings first? Simpler to just PUT settings if possible.
    // Cloudflare API for bindings is complex. We might need to use the `metadata` part of the uploadWorker, 
    // BUT specific environment variable update endpoint is easier if available.
    // Actually, creating a valid metadata blob during upload is better, but let's try a dedicated endpoint or metadata update.
    // NOTE: The standard API to update settings is PATCH /scripts/{name}/settings

    const bindings = Object.entries(envVars).map(([key, value]) => ({
        type: "plain_text",
        name: key,
        text: value
    }));

    return cfRequest(`/accounts/${auth.accountId}/workers/scripts/${workerName}/settings`, "PATCH", auth, {
        bindings
    });
}
