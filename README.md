# Norte Sul Força de Vendas

Aplicativo PWA de força de vendas integrado ao Sankhya, com pedidos, carteira do vendedor, funcionamento offline e comunicação entre usuários.

## Desenvolvimento local

Requer Node.js 22.13 ou superior e o arquivo `.env.treinamento` na raiz.

```bash
npm ci
npm start
```

O início local recompila automaticamente quando houver alterações no código.

## Produção

Os arquivos de produção mantêm o aplicativo isolado dos demais serviços da VPS:

- processo dedicado no PM2;
- porta interna `3107`, acessível somente em `127.0.0.1`;
- virtual host exclusivo `teste.nortesulsementes.com` no Nginx;
- segredos mantidos fora do Git em `.env.treinamento`.

Antes da instalação, confirme que a porta está livre:

```bash
sudo ss -ltnp | grep ':3107 ' || true
```

O DNS de `teste.nortesulsementes.com` deve apontar para a VPS. Depois de clonar o repositório em `/opt/norte-sul-forca-vendas`, instale e compile:

```bash
sudo -u forcavendas /opt/norte-sul-node/bin/npm ci --include=dev
sudo -u forcavendas /opt/norte-sul-node/bin/npm run build
```

Inicie no PM2 e valide antes de configurar o domínio:

```bash
pm2 start ecosystem.config.cjs --only norte-sul-forca-vendas
pm2 save
pm2 status norte-sul-forca-vendas
curl -I http://127.0.0.1:3107
```

Ative o Nginx somente depois de `sudo nginx -t` retornar sucesso:

```bash
sudo cp deploy/nginx-teste.nortesulsementes.com.conf /etc/nginx/sites-available/teste.nortesulsementes.com
sudo ln -s /etc/nginx/sites-available/teste.nortesulsementes.com /etc/nginx/sites-enabled/teste.nortesulsementes.com
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d teste.nortesulsementes.com
```

## Atualização na VPS

```bash
cd /opt/norte-sul-forca-vendas
sudo -u forcavendas git pull --ff-only
sudo -u forcavendas /opt/norte-sul-node/bin/npm ci --include=dev
sudo -u forcavendas /opt/norte-sul-node/bin/npm run build
pm2 restart norte-sul-forca-vendas --update-env
pm2 save
pm2 status norte-sul-forca-vendas
```
