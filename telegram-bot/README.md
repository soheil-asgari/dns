# telegram-bot

Telegram bot for DNS management - built with Node.js (Telegraf).

## Structure

```
src/
├── bot/          - Bot handlers and middleware
├── services/     - API services
├── commands/     - Command implementations
└── utils/        - Helpers
```

## Development

```bash
npm install
npm run dev
```

## Environment Variables

- `BOT_TOKEN` - Telegram bot token
- `API_URL` - Backend API URL
- `ADMIN_IDS` - Comma-separated admin user IDs