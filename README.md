# krypt-cli

Official CLI for Krypt.

## Install

```bash
npm install -g github:GarzvR/krypt-cli
```

## Use

```bash
krypt init --token=krp_your_environment_token
krypt info
krypt pull
```

## Commands

- `krypt init` saves your environment token into `krypt.json`
- `krypt info` shows the project and environment bound to that token
- `krypt pull` writes a local `.env.<environment>` file

## Custom API URL

You can point the CLI at another API with `--api-url` or `KRYPT_API_URL`.

```bash
krypt info --api-url=http://localhost:3000/api/v1
```
