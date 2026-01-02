/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    typescript: {
        ignoreBuildErrors: true,
    },
    serverExternalPackages: ["grammy", "@libsql/client"],
};

module.exports = nextConfig;
