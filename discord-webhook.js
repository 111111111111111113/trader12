const axios = require('axios');

class DiscordWebhook {
  constructor(webhookUrl, enabled = false) {
    this.webhookUrl = webhookUrl;
    this.enabled = enabled && webhookUrl;
  }

  async sendMessage(embed) {
    if (!this.enabled) return;

    try {
      await axios.post(this.webhookUrl, {
        embeds: [embed]
      });
    } catch (error) {
      console.error('[DISCORD] Failed to send webhook:', error.message);
    }
  }

  async sendTradeNotification(itemName, quantity, villagerPosition) {
    if (!this.enabled) return;

    const embed = {
      title: "🔄 Trade Completed",
      color: 0x00ff00, // Green
      fields: [
        {
          name: "Item",
          value: itemName,
          inline: true
        },
        {
          name: "Quantity",
          value: quantity.toString(),
          inline: true
        },
        {
          name: "Villager Location",
          value: `X: ${Math.round(villagerPosition.x)}, Y: ${Math.round(villagerPosition.y)}, Z: ${Math.round(villagerPosition.z)}`,
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Minecraft Trading Bot"
      }
    };

    await this.sendMessage(embed);
  }

  async sendStatusNotification(status, details = "") {
    if (!this.enabled) return;

    const isRunning = status === 'started';
    const embed = {
      title: isRunning ? "🟢 Bot Started" : "🔴 Bot Stopped",
      color: isRunning ? 0x00ff00 : 0xff0000,
      fields: [
        {
          name: "Status",
          value: status,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Minecraft Trading Bot"
      }
    };

    if (details) {
      embed.fields.push({
        name: "Details",
        value: details,
        inline: false
      });
    }

    await this.sendMessage(embed);
  }

  async sendErrorNotification(error, context = "") {
    if (!this.enabled) return;

    const embed = {
      title: "⚠️ Bot Error",
      color: 0xff6600, // Orange
      fields: [
        {
          name: "Error",
          value: error.message || error.toString(),
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Minecraft Trading Bot"
      }
    };

    if (context) {
      embed.fields.push({
        name: "Context",
        value: context,
        inline: false
      });
    }

    await this.sendMessage(embed);
  }

  async sendVillagerFoundNotification(count, bounds) {
    if (!this.enabled) return;

    const embed = {
      title: "👥 Villagers Found",
      color: 0x0099ff, // Blue
      fields: [
        {
          name: "Count",
          value: count.toString(),
          inline: true
        },
        {
          name: "Bounds",
          value: bounds ? "Active" : "None",
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Minecraft Trading Bot"
      }
    };

    await this.sendMessage(embed);
  }

  async sendInventoryNotification(action, itemName, quantity) {
    if (!this.enabled) return;

    const embed = {
      title: action === 'deposit' ? "📦 Items Deposited" : "💎 Emeralds Refilled",
      color: action === 'deposit' ? 0x9966ff : 0x00ff99,
      fields: [
        {
          name: "Action",
          value: action,
          inline: true
        },
        {
          name: "Item",
          value: itemName,
          inline: true
        },
        {
          name: "Quantity",
          value: quantity.toString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Minecraft Trading Bot"
      }
    };

    await this.sendMessage(embed);
  }
}

module.exports = DiscordWebhook;