module.exports = {
  apps: [
    {
      name: "norte-sul-forca-vendas",
      cwd: "/opt/norte-sul-forca-vendas",
      script: "scripts/start-local.mjs",
      interpreter: "/opt/norte-sul-node/bin/node",
      node_args: "--env-file=.env.treinamento",
      env: {
        NODE_ENV: "production",
        PATH: "/opt/norte-sul-node/bin:/usr/local/bin:/usr/bin:/bin",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      time: true,
    },
  ],
};
