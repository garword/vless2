-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, -- Telegram User ID
  username TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'member', -- 'admin' or 'member'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cloudflare Accounts Table
CREATE TABLE IF NOT EXISTS cf_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  api_key TEXT NOT NULL, -- Global API Key or Token
  account_id TEXT NOT NULL,
  type TEXT DEFAULT 'vpn', -- 'vpn' or 'feeder'
  owner_id INTEGER, -- Telegram ID of the owner
  status TEXT DEFAULT 'active', -- 'active' or 'limit'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Deployed Workers/Proxies Table
CREATE TABLE IF NOT EXISTS workers (
  subdomain TEXT PRIMARY KEY, -- e.g. sg1.mysite.com
  account_id INTEGER,
  zone_id TEXT, -- CF Zone ID
  worker_name TEXT, -- CF Worker Name
  proxy_ip TEXT, -- The clean IP used (if any)
  country_code TEXT, -- ID, SG, etc.
  flag TEXT, -- Emoji flag
  type TEXT DEFAULT 'vless', -- 'vless' or 'monitor'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES cf_accounts(id)
);

-- API Endpoints (Optional, for load balancing API workers)
CREATE TABLE IF NOT EXISTS api_endpoints (
  url TEXT PRIMARY KEY,
  status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    key TEXT PRIMARY KEY,
    value TEXT
);
