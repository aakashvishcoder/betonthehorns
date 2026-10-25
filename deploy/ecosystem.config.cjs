// PM2 on the Vultr VM: one process serves the site and the API (the game's timers must run once).
// Start: pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "betonthehorns",
      script: "npm",
      args: "start",
      cwd: __dirname + "/..",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", PORT: "4000" },
      max_memory_restart: "800M",
      time: true,
    },
  ],
};
