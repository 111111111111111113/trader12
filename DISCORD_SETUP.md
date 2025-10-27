# Discord Webhook Setup

This bot now supports Discord webhook notifications for trades, status updates, and errors.

## Configuration

1. **Get a Discord Webhook URL:**
   - Go to your Discord server
   - Right-click on the channel where you want notifications
   - Select "Edit Channel" → "Integrations" → "Webhooks"
   - Click "Create Webhook" or "New Webhook"
   - Copy the webhook URL

2. **Update config.json:**
   ```json
   {
     "discord": {
       "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL_HERE",
       "enabled": true,
       "notifyTrades": true,
       "notifyStatus": true,
       "notifyErrors": true
     }
   }
   ```

## Notification Types

### Trade Notifications
- **Successful trades**: Shows item name, quantity, and villager location
- **Villager detection**: Notifies when villagers are found nearby
- **Inventory actions**: Notifies when items are deposited or emeralds are refilled

### Status Notifications
- **Bot start/stop**: When the bot is started or stopped by a player
- **Connection status**: When the bot connects to or disconnects from the server

### Error Notifications
- **Trading errors**: When trades fail
- **Inventory errors**: When depositing or refilling fails
- **Connection errors**: When the bot is kicked or encounters general errors
- **Main loop errors**: When the main trading loop encounters issues

## Features

- **Rich embeds**: All notifications use Discord's embed format with colors and structured information
- **Configurable**: Each notification type can be enabled/disabled individually
- **Error handling**: Webhook failures won't crash the bot
- **Context information**: Errors include context about where they occurred

## Usage

1. Set up your Discord webhook URL in `config.json`
2. Set `"enabled": true` to activate Discord notifications
3. Configure which notification types you want to receive
4. Start the bot as usual - Discord notifications will be sent automatically

## Troubleshooting

- If notifications aren't working, check that the webhook URL is correct
- Ensure the webhook is enabled in your Discord channel
- Check the bot console for any webhook-related error messages
- Make sure the bot has internet access to reach Discord's API