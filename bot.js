// -------------------- Required Modules --------------------
const fs = require('fs');
const readline = require('readline');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const mcDataLoader = require('minecraft-data');
const DiscordWebhook = require('./discord-webhook');

// -------------------- Load Config --------------------
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// -------------------- Initialize Discord Webhook --------------------
const discord = new DiscordWebhook(
  config.discord?.webhookUrl || '',
  config.discord?.enabled || false
);

// -------------------- Create Bot --------------------
const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version,
  auth: 'microsoft',
  disableChatSigning: true,
  skipValidation: true
});

bot.loadPlugin(pathfinder);

let running = false;
let depositChest = null;
let refillChest = null;
let whitelist = config.whitelist || [];
let bound1 = null;
let bound2 = null;
let mcData;
let autoeat = config.autoeat || true;
let consoleInterface = null;

// -------------------- Logging Helpers --------------------
function log(msg) { console.log(`[BOT] ${msg}`); }
function reply(player, msg) { bot.chat(`/msg ${player} ${msg}`); }

// -------------------- Safe Movements --------------------
bot.once('spawn', () => {
  mcData = mcDataLoader(bot.version);

  class SafeMovements extends Movements {
    constructor(bot, mcData) {
      super(bot, mcData);
      this.allowDigging = false;
      this.allowPlace = false;
      this.allow1by1towers = false;
      this.allowFreeMotion = false;
      this.allowParkour = false;
      this.allowSprinting = false;
    }
    canDig() { return false; }
    canPlace() { return false; }
    canBreak() { return false; }
    canMine() { return false; }
    canDestroy() { return false; }
  }

  const safeMove = new SafeMovements(bot, mcData);
  bot.pathfinder.setMovements(safeMove);
  log('Safe pathfinding initialized: block breaking and placing disabled.');
  
  // Initialize console interface
  setupConsoleInterface();
});

// -------------------- Commands --------------------
bot.on('whisper', async (playerName, message) => {
  if (playerName === bot.username) return;

  if (!whitelist.includes(playerName)) {
    reply(playerName, 'You are not whitelisted.');
    return;
  }

  const args = message.trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const player = bot.players[playerName]?.entity;

  if (!player && ['setdeposit','setrefill','setbound1','setbound2'].includes(cmd)) {
    reply(playerName, 'Cannot detect your position.');
    return;
  }

  switch (cmd) {
    case 'start':
      running = true;
      reply(playerName, 'Trading bot started.');
      if (config.discord?.notifyStatus) {
        discord.sendStatusNotification('started', `Started by ${playerName}`);
      }
      mainLoop();
      break;
    case 'stop':
      running = false;
      reply(playerName, 'Trading bot stopped.');
      if (config.discord?.notifyStatus) {
        discord.sendStatusNotification('stopped', `Stopped by ${playerName}`);
      }
      break;
    case 'setdeposit':
      depositChest = player.position.floored();
      reply(playerName, `Deposit chest set to ${depositChest}`);
      break;
    case 'setrefill':
      refillChest = player.position.floored();
      reply(playerName, `Refill chest set to ${refillChest}`);
      break;
    case 'setbound1':
      bound1 = player.position.floored();
      reply(playerName, `Bound 1 set to ${bound1}`);
      break;
    case 'setbound2':
      bound2 = player.position.floored();
      reply(playerName, `Bound 2 set to ${bound2}`);
      break;
    case 'addwhitelist':
      if (args[0]) {
        whitelist.push(args[0]);
        reply(playerName, `${args[0]} added to whitelist.`);
      }
      break;
    case 'removewhitelist':
      if (args[0]) {
        whitelist = whitelist.filter(p => p !== args[0]);
        reply(playerName, `${args[0]} removed from whitelist.`);
      }
      break;
    case 'whitelist':
      reply(playerName, `Whitelist: ${whitelist.join(', ') || 'None'}`);
      break;
    case 'status':
      reply(playerName, running ? 'Bot is trading.' : 'Bot is idle.');
      break;
    case 'autoeat':
      if (args[0] === 'on' || args[0] === 'enable') {
        autoeat = true;
        reply(playerName, 'Autoeat enabled.');
      } else if (args[0] === 'off' || args[0] === 'disable') {
        autoeat = false;
        reply(playerName, 'Autoeat disabled.');
      } else {
        reply(playerName, `Autoeat is currently ${autoeat ? 'enabled' : 'disabled'}. Use 'autoeat on/off' to toggle.`);
      }
      break;
    case 'eat':
      const ate = await eatFood();
      reply(playerName, ate ? 'Ate food successfully.' : 'No food available or failed to eat.');
      break;
    case 'health':
      reply(playerName, `Health: ${bot.health}/20, Food: ${bot.food}/20, Saturation: ${bot.foodSaturation}/20`);
      break;
    case 'help':
      reply(playerName, 'Commands: start, stop, setDeposit, setRefill, setBound1, setBound2, addWhitelist <name>, removeWhitelist <name>, whitelist, status, autoeat on/off, eat, health');
      reply(playerName, 'Discord webhooks: Configure webhook URL in config.json to receive notifications for trades, status, and errors');
      break;
    default:
      reply(playerName, 'Unknown command. Use /msg <botname> help');
  }
});

// -------------------- Console Interface --------------------
function setupConsoleInterface() {
  consoleInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Bot> '
  });

  consoleInterface.on('line', async (input) => {
    const args = input.trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    switch (cmd) {
      case 'start':
        if (running) {
          console.log('Bot is already running.');
        } else {
          running = true;
          console.log('Trading bot started.');
          if (config.discord?.notifyStatus) {
            discord.sendStatusNotification('started', 'Started via console');
          }
          mainLoop();
        }
        break;
      case 'stop':
        if (!running) {
          console.log('Bot is not running.');
        } else {
          running = false;
          console.log('Trading bot stopped.');
          if (config.discord?.notifyStatus) {
            discord.sendStatusNotification('stopped', 'Stopped via console');
          }
        }
        break;
      case 'status':
        console.log(`Bot status: ${running ? 'Running' : 'Stopped'}`);
        console.log(`Autoeat: ${autoeat ? 'Enabled' : 'Disabled'}`);
        console.log(`Deposit chest: ${depositChest ? depositChest : 'Not set'}`);
        console.log(`Refill chest: ${refillChest ? refillChest : 'Not set'}`);
        console.log(`Bounds: ${bound1 && bound2 ? `${bound1} to ${bound2}` : 'Not set'}`);
        console.log(`Whitelist: ${whitelist.join(', ') || 'None'}`);
        break;
      case 'autoeat':
        if (args[0] === 'on' || args[0] === 'enable') {
          autoeat = true;
          console.log('Autoeat enabled.');
        } else if (args[0] === 'off' || args[0] === 'disable') {
          autoeat = false;
          console.log('Autoeat disabled.');
        } else {
          console.log(`Autoeat is currently ${autoeat ? 'enabled' : 'disabled'}. Use 'autoeat on/off' to toggle.`);
        }
        break;
      case 'whitelist':
        if (args[0] === 'add' && args[1]) {
          whitelist.push(args[1]);
          console.log(`${args[1]} added to whitelist.`);
        } else if (args[0] === 'remove' && args[1]) {
          whitelist = whitelist.filter(p => p !== args[1]);
          console.log(`${args[1]} removed from whitelist.`);
        } else if (args[0] === 'list') {
          console.log(`Whitelist: ${whitelist.join(', ') || 'None'}`);
        } else {
          console.log('Usage: whitelist add/remove/list <name>');
        }
        break;
      case 'setdeposit':
        if (bot.entity && bot.entity.position) {
          depositChest = bot.entity.position.floored();
          console.log(`Deposit chest set to ${depositChest}`);
        } else {
          console.log('Cannot detect bot position.');
        }
        break;
      case 'setrefill':
        if (bot.entity && bot.entity.position) {
          refillChest = bot.entity.position.floored();
          console.log(`Refill chest set to ${refillChest}`);
        } else {
          console.log('Cannot detect bot position.');
        }
        break;
      case 'setbound1':
        if (bot.entity && bot.entity.position) {
          bound1 = bot.entity.position.floored();
          console.log(`Bound 1 set to ${bound1}`);
        } else {
          console.log('Cannot detect bot position.');
        }
        break;
      case 'setbound2':
        if (bot.entity && bot.entity.position) {
          bound2 = bot.entity.position.floored();
          console.log(`Bound 2 set to ${bound2}`);
        } else {
          console.log('Cannot detect bot position.');
        }
        break;
      case 'eat':
        await eatFood();
        break;
      case 'health':
        if (bot.entity) {
          console.log(`Health: ${bot.health}/20`);
          console.log(`Food: ${bot.food}/20`);
          console.log(`Saturation: ${bot.foodSaturation}/20`);
        } else {
          console.log('Bot not spawned.');
        }
        break;
      case 'help':
        console.log('Console Commands:');
        console.log('  start/stop - Start or stop the trading bot');
        console.log('  status - Show bot status and configuration');
        console.log('  autoeat on/off - Enable or disable autoeat');
        console.log('  whitelist add/remove/list <name> - Manage whitelist');
        console.log('  setdeposit/setrefill/setbound1/setbound2 - Set positions');
        console.log('  eat - Manually eat food');
        console.log('  health - Show health and food levels');
        console.log('  help - Show this help message');
        console.log('  exit/quit - Exit the bot');
        break;
      case 'exit':
      case 'quit':
        console.log('Shutting down bot...');
        running = false;
        if (consoleInterface) consoleInterface.close();
        process.exit(0);
        break;
      case '':
        // Empty line, just show prompt again
        break;
      default:
        console.log(`Unknown command: ${cmd}. Type 'help' for available commands.`);
    }
    consoleInterface.prompt();
  });

  consoleInterface.on('close', () => {
    console.log('\nConsole interface closed.');
    process.exit(0);
  });

  console.log('Console interface initialized. Type "help" for available commands.');
  consoleInterface.prompt();
}

// -------------------- Autoeat System --------------------
async function eatFood() {
  if (!bot.entity || !bot.inventory) {
    log('Cannot eat: bot not properly spawned');
    return false;
  }

  const foodItems = bot.inventory.items().filter(item => {
    const itemData = mcData.itemsByName[item.name];
    return itemData && itemData.food && itemData.food > 0;
  });

  if (foodItems.length === 0) {
    log('No food items found in inventory');
    return false;
  }

  // Sort by food value (higher is better)
  foodItems.sort((a, b) => {
    const aData = mcData.itemsByName[a.name];
    const bData = mcData.itemsByName[b.name];
    return (bData.food || 0) - (aData.food || 0);
  });

  const bestFood = foodItems[0];
  try {
    await bot.consume();
    log(`Ate ${bestFood.name} (${bestFood.count} remaining)`);
    return true;
  } catch (err) {
    log(`Failed to eat food: ${err.message}`);
    return false;
  }
}

// -------------------- Main Loop --------------------
async function mainLoop() {
  while (running) {
    try {
      // Check if bot is still connected
      if (!bot.entity || !bot.entity.position) {
        log('Bot not properly spawned, waiting...');
        await bot.waitForTicks(100);
        continue;
      }

      // Check autoeat
      if (autoeat && bot.food < 18) {
        log(`Food level low (${bot.food}/20), attempting to eat...`);
        await eatFood();
        await bot.waitForTicks(20); // Wait for eating animation
      }

      const villagers = getNearbyVillagers();
      if (villagers.length === 0) {
        log('No villagers in render distance.');
        await bot.waitForTicks(6000); // Wait 5 minutes before checking again
        continue;
      }

      log(`Found ${villagers.length} villagers nearby`);
      
      // Send Discord notification for villager detection
      if (config.discord?.notifyTrades && villagers.length > 0) {
        discord.sendVillagerFoundNotification(villagers.length, bound1 && bound2);
      }

      for (const villager of villagers) {
        if (!running) break; // Check if bot should stop
        
        if (!withinBounds(villager.position)) {
          log(`Villager at ${villager.position} is outside bounds, skipping`);
          continue;
        }

        // Path to villager safely (stops 4 blocks away to avoid breaking blocks)
        await goToEntity(villager);
        
        // Check final distance and log it
        const finalDistance = bot.entity.position.distanceTo(villager.position);
        log(`Stopped at safe distance: ${finalDistance.toFixed(2)} blocks from villager`);
        
        // Small delay before trading
        await bot.waitForTicks(20);

        // Trade
        await tradeWithVillager(villager);
        
        // Wait between villager interactions
        await bot.waitForTicks(100);
      }

      log('Finished checking all villagers. Waiting 10 minutes for anti-AFK.');
      await bot.waitForTicks(12000); // ~10 minutes

    } catch (err) {
      log(`Error in main loop: ${err.message}`);
      
      // Send Discord notification for main loop errors
      if (config.discord?.notifyErrors) {
        discord.sendErrorNotification(err, 'Main trading loop');
      }
      
      // Wait before retrying to avoid rapid error loops
      await bot.waitForTicks(1000);
    }
  }
}

// -------------------- Villager Detection --------------------
function getNearbyVillagers() {
  return Object.values(bot.entities).filter(e => {
    if (!e) return false;
    // Check for villager entity type (updated for 1.21.4)
    if (e.type !== 'passive' && e.type !== 'villager') return false;
    if (!e.displayName) return false;
    let name = typeof e.displayName === 'string' ? e.displayName : e.displayName.toString();
    // Check for villager variants
    return name === 'Villager' || name.includes('Villager') || e.name === 'villager';
  });
}

function withinBounds(pos) {
  if (!bound1 || !bound2) return true;
  const minX = Math.min(bound1.x, bound2.x);
  const maxX = Math.max(bound1.x, bound2.x);
  const minY = Math.min(bound1.y, bound2.y);
  const maxY = Math.max(bound1.y, bound2.y);
  const minZ = Math.min(bound1.z, bound2.z);
  const maxZ = Math.max(bound1.z, bound2.z);
  return pos.x >= minX && pos.x <= maxX &&
         pos.y >= minY && pos.y <= maxY &&
         pos.z >= minZ && pos.z <= maxZ;
}

// -------------------- Pathfinding --------------------
async function goToEntity(entity) {
  if (!entity || !entity.position) {
    log('Invalid entity or position for pathfinding');
    return;
  }

  const goal = new GoalNear(entity.position.x, entity.position.y, entity.position.z, 4);
  try {
    // Add timeout for pathfinding
    const pathPromise = bot.pathfinder.goto(goal);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Pathfinding timeout')), 10000)
    );
    
    await Promise.race([pathPromise, timeoutPromise]);
    log(`Successfully reached villager at ${entity.position}`);
  } catch (err) {
    log(`Pathing error: ${err.message} - villager might be unreachable.`);
  }
}

// -------------------- Trading --------------------
async function tradeWithVillager(villager) {
  try {
    // Check if villager is still within interaction range (max 4 blocks)
    const distance = bot.entity.position.distanceTo(villager.position);
    if (distance > 4) {
      log(`Villager too far away (${distance.toFixed(2)} blocks), skipping trade`);
      return;
    }

    // Use the correct method for opening villager trading interface
    const window = await bot.openVillager(villager);
    if (!window) {
      log('Failed to open villager trading interface');
      return;
    }

    // Wait a bit for the window to fully load
    await bot.waitForTicks(10);

    const trades = window.villager?.trades || [];
    if (trades.length === 0) {
      log('No trades available with this villager');
      await window.close();
      return;
    }

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      if (trade.disabled) continue;
      
      // Check if we have enough emeralds for this trade
      const emeraldCount = bot.inventory.count(mcData.itemsByName.emerald.id);
      if (emeraldCount < (trade.inputItem1?.count || 0)) {
        log('Not enough emeralds for trading');
        break;
      }

      const sell = trade.outputItem?.name || '';
      if (sell.includes('glass') || sell.includes('experience_bottle')) {
        try {
          await bot.trade(villager, i);
          log(`Traded emeralds for ${sell}`);
          
          // Send Discord notification for successful trade
          if (config.discord?.notifyTrades) {
            discord.sendTradeNotification(sell, trade.outputItem?.count || 1, villager.position);
          }
          
          // Wait between trades
          await bot.waitForTicks(5);
        } catch (tradeErr) {
          log(`Failed to execute trade ${i}: ${tradeErr.message}`);
        }
      }
    }

    await window.close();
    if (depositChest) await depositItems();

  } catch (err) {
    log(`Trade error: ${err.message}`);
    
    // Send Discord notification for trade errors
    if (config.discord?.notifyErrors) {
      discord.sendErrorNotification(err, 'Trading with villager');
    }
  }
}

// -------------------- Inventory --------------------
async function depositItems() {
  try {
    const block = bot.blockAt(depositChest);
    if (!block) {
      log('Deposit chest block not found');
      return;
    }
    
    const chest = await bot.openChest(block);
    if (!chest) {
      log('Failed to open deposit chest');
      return;
    }

    let deposited = false;
    for (const item of bot.inventory.items()) {
      if (item.name.includes('glass') || item.name.includes('experience_bottle')) {
        try {
          await chest.deposit(item.type, null, item.count);
          log(`Deposited ${item.count}x ${item.name}`);
          
          // Send Discord notification for deposit
          if (config.discord?.notifyTrades) {
            discord.sendInventoryNotification('deposit', item.name, item.count);
          }
          
          deposited = true;
        } catch (depositErr) {
          log(`Failed to deposit ${item.name}: ${depositErr.message}`);
        }
      }
    }
    
    if (!deposited) {
      log('No items to deposit');
    }
    
    await chest.close();
  } catch (err) {
    log(`Deposit failed: ${err.message}`);
    
    // Send Discord notification for deposit errors
    if (config.discord?.notifyErrors) {
      discord.sendErrorNotification(err, 'Depositing items to chest');
    }
  }
}

async function refillEmeralds() {
  try {
    if (!refillChest) {
      log('No refill chest set');
      return;
    }
    
    const block = bot.blockAt(refillChest);
    if (!block) {
      log('Refill chest block not found');
      return;
    }
    
    const chest = await bot.openChest(block);
    if (!chest) {
      log('Failed to open refill chest');
      return;
    }

    const emeraldCount = bot.inventory.count(mcData.itemsByName.emerald.id);
    if (emeraldCount < 16) {
      const emeralds = chest.containerItems().find(i => i.name === 'emerald');
      if (emeralds) {
        const withdrawAmount = Math.min(emeralds.count, 64 - emeraldCount);
        await chest.withdraw(emeralds.type, null, withdrawAmount);
        log(`Refilled ${withdrawAmount} emeralds`);
        
        // Send Discord notification for emerald refill
        if (config.discord?.notifyTrades) {
          discord.sendInventoryNotification('refill', 'emerald', withdrawAmount);
        }
      } else {
        log('No emeralds found in refill chest');
      }
    } else {
      log('Already have enough emeralds');
    }

    await chest.close();
  } catch (err) {
    log(`Emerald refill failed: ${err.message}`);
    
    // Send Discord notification for refill errors
    if (config.discord?.notifyErrors) {
      discord.sendErrorNotification(err, 'Refilling emeralds from chest');
    }
  }
}

// -------------------- Anti-AFK --------------------
setInterval(() => {
  if (!bot.entity) return;
  bot.look(bot.entity.yaw + Math.random() * 0.3 - 0.15, 0);
  bot.chat('/ping');
}, 4000);

// -------------------- Safety Overrides --------------------
// Override any potential block breaking methods to ensure they never execute
bot.dig = () => { log('SAFETY: Block breaking attempt blocked!'); return Promise.resolve(); };
bot.placeBlock = () => { log('SAFETY: Block placing attempt blocked!'); return Promise.resolve(); };
bot.activateBlock = () => { log('SAFETY: Block activation attempt blocked!'); return Promise.resolve(); };

// -------------------- Logging --------------------
bot.on('spawn', () => {
  log('Bot spawned successfully.');
  if (config.discord?.notifyStatus) {
    discord.sendStatusNotification('connected', 'Bot connected to server');
  }
});

bot.on('kicked', (reason) => {
  log(`Kicked: ${reason}`);
  if (config.discord?.notifyErrors) {
    discord.sendErrorNotification(new Error(`Kicked: ${reason}`), 'Server connection');
  }
});

bot.on('error', (err) => {
  log(`Error: ${err.message}`);
  if (config.discord?.notifyErrors) {
    discord.sendErrorNotification(err, 'Bot general error');
  }
});