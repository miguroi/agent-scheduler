# WhatsApp Calendar Agent

A small agent for managing your Google Calendar from WhatsApp. It can read your schedule, move or cancel events, and answer questions about your calendar.

- `Schedule gym tomorrow at 7pm for 1 hour`
- `What do I have today?`
- `Move my meeting tomorrow to 3pm`
- `Cancel my gym session Friday`

It uses Node.js, OpenWA, OpenRouter, PostgreSQL, and Docker.

## Run locally

Prepare:

- Docker
- OpenRouter key
- Google OAuth web client
- WhatsApp bot number

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`. Use the same password in `POSTGRES_PASSWORD` and `DATABASE_URL`.

In Google Cloud, enable the Calendar API and create an OAuth **Web application**. Add your Google account as a test user, then add this redirect URI:

```text
http://localhost:3000/oauth/google/callback
```

Start the bot:

```bash
ENV_FILE=.env.local docker compose --env-file .env.local \
  -f compose.yaml -f compose.local.yaml up -d --build app postgres
```

Scan the QR from **WhatsApp → Linked devices** on the bot phone. Send `CONNECT`, open the Google link, and approve access. You can now send `What do I have today?` to test it.

Check the app with `curl http://localhost:3000/health`. Your computer and Docker must stay running while you use the bot.

## Customize it

```bash
cp config/personalization.example.json config/personalization.json
```

Edit that file to change the bot's name, language, and reply style. Restart the app when you're done. The file is ignored by Git.

## Run on a VPS

Point a domain to an Ubuntu VPS, copy `.env.example` to `.env`, and set `APP_URL` to your domain. Add `https://YOUR_DOMAIN/oauth/google/callback` as a Google redirect URI.

```bash
sudo bash deploy/provision-ubuntu.sh
docker compose up -d --build
docker compose logs -f app
```

Caddy handles HTTPS. PostgreSQL and OpenWA stay private inside Docker.

## Good to know

- Only IDs in `ALLOWED_WHATSAPP_IDS` can use the bot.
- Send `HELP` for commands or `TIMEZONE Asia/Jakarta` to change timezone.
- Deleting events and inviting guests requires `YES`.
- Keep `TOKEN_ENCRYPTION_SECRET` unchanged after connecting a calendar.
- OpenWA is unofficial, so use a separate WhatsApp number.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
```
