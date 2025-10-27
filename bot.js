// -------------------- Required Modules --------------------
const fs = require('fs');
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

// -------------------- Logging Helpers --------------------
function log(msg) { console.log(`[BOT] ${msg}`); }
function reply(player, msg) { bot.chat(`/msg ${player} ${msg}`); }

// -------------------- Grim v3 Compatible Movements --------------------
bot.once('spawn', () => {
  mcData = mcDataLoader(bot.version);

  class GrimV3Movements extends Movements {
    constructor(bot, mcData) {
      super(bot, mcData);
      this.allowDigging = false;
      this.allowPlace = false;
      this.allow1by1towers = false;
      this.allowFreeMotion = false;
      this.allowParkour = false;
      this.allowSprinting = false;
      
      // Grim v3 evasion settings
      this.maxDropDown = 0; // Prevent dropping down
      this.maxDropUp = 0;   // Prevent jumping up
      this.allowSprinting = false; // Disable sprinting to avoid detection
      this.allowJumping = true;    // Allow normal jumping
      this.allowSwimming = true;   // Allow swimming
      this.allowClimbing = true;   // Allow climbing
      
      // Human-like movement patterns
      this.placeCost = 1000; // Make placing very expensive
      this.breakCost = 1000; // Make breaking very expensive
      this.digCost = 1000;   // Make digging very expensive
    }
    
    canDig() { return false; }
    canPlace() { return false; }
    canBreak() { return false; }
    canMine() { return false; }
    canDestroy() { return false; }
    
    // Override getMoveTo to add human-like behavior
    getMoveTo(pos) {
      const result = super.getMoveTo(pos);
      if (result) {
        // Add slight randomization to movement
        result.x += (Math.random() - 0.5) * 0.1;
        result.z += (Math.random() - 0.5) * 0.1;
      }
      return result;
    }
  }

  const grimMove = new GrimV3Movements(bot, mcData);
  bot.pathfinder.setMovements(grimMove);
  log('Grim v3 compatible pathfinding initialized.');
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
    case 'help':
      reply(playerName, 'Commands: start, stop, setDeposit, setRefill, setBound1, setBound2, addWhitelist <name>, removeWhitelist <name>, whitelist, status');
      reply(playerName, 'Discord webhooks: Configure webhook URL in config.json to receive notifications for trades, status, and errors');
      break;
    default:
      reply(playerName, 'Unknown command. Use /msg <botname> help');
  }
});

// -------------------- Grim v3 Compatible Main Loop --------------------
async function mainLoop() {
  while (running) {
    try {
      // Check if bot is still connected
      if (!bot.entity || !bot.entity.position) {
        log('Bot not properly spawned, waiting...');
        await bot.waitForTicks(100);
        continue;
      }

      // Add random human-like behavior
      if (Math.random() < 0.1) {
        await performRandomAction();
      }

      const villagers = getNearbyVillagers();
      if (villagers.length === 0) {
        log('No villagers in render distance.');
        // Randomize wait time to avoid predictable patterns
        const waitTime = 3000 + Math.random() * 6000; // 2.5-7.5 minutes
        await bot.waitForTicks(waitTime);
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

        // Add random delay before approaching villager
        await bot.waitForTicks(Math.floor(Math.random() * 40) + 20);

        // Path to villager safely (stops 4 blocks away to avoid breaking blocks)
        await goToEntity(villager);
        
        // Check final distance and log it
        const finalDistance = bot.entity.position.distanceTo(villager.position);
        log(`Stopped at safe distance: ${finalDistance.toFixed(2)} blocks from villager`);
        
        // Random delay before trading
        await bot.waitForTicks(Math.floor(Math.random() * 40) + 20);

        // Trade
        await tradeWithVillager(villager);
        
        // Random wait between villager interactions
        await bot.waitForTicks(Math.floor(Math.random() * 200) + 100);
      }

      log('Finished checking all villagers. Waiting for anti-AFK.');
      // Randomize wait time to avoid detection
      const waitTime = 6000 + Math.random() * 12000; // 5-15 minutes
      await bot.waitForTicks(waitTime);

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

// -------------------- Grim v3 Compatible Pathfinding --------------------
async function goToEntity(entity) {
  if (!entity || !entity.position) {
    log('Invalid entity or position for pathfinding');
    return;
  }

  // Add randomization to target position to avoid perfect pathfinding detection
  const targetX = entity.position.x + (Math.random() - 0.5) * 2;
  const targetY = entity.position.y;
  const targetZ = entity.position.z + (Math.random() - 0.5) * 2;
  
  const goal = new GoalNear(targetX, targetY, targetZ, 4);
  
  try {
    // Add human-like delays before pathfinding
    await bot.waitForTicks(Math.floor(Math.random() * 20) + 10);
    
    // Add random head movement during pathfinding
    const lookInterval = setInterval(() => {
      if (bot.entity) {
        const randomYaw = bot.entity.yaw + (Math.random() - 0.5) * 0.5;
        const randomPitch = (Math.random() - 0.5) * 0.3;
        bot.look(randomYaw, randomPitch);
      }
    }, 1000 + Math.random() * 2000);
    
    // Add timeout for pathfinding
    const pathPromise = bot.pathfinder.goto(goal);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Pathfinding timeout')), 15000)
    );
    
    await Promise.race([pathPromise, timeoutPromise]);
    clearInterval(lookInterval);
    
    // Add final randomization to position
    const finalX = bot.entity.position.x + (Math.random() - 0.5) * 0.5;
    const finalZ = bot.entity.position.z + (Math.random() - 0.5) * 0.5;
    
    log(`Successfully reached villager at ${entity.position}`);
  } catch (err) {
    log(`Pathing error: ${err.message} - villager might be unreachable.`);
  }
}

// -------------------- Grim v3 Compatible Trading --------------------
async function tradeWithVillager(villager) {
  try {
    // Check if villager is still within interaction range (max 4 blocks)
    const distance = bot.entity.position.distanceTo(villager.position);
    if (distance > 4) {
      log(`Villager too far away (${distance.toFixed(2)} blocks), skipping trade`);
      return;
    }

    // Look at villager before trading (human-like behavior)
    bot.lookAt(villager.position);
    await bot.waitForTicks(Math.floor(Math.random() * 10) + 5);

    // Use the correct method for opening villager trading interface
    const window = await bot.openVillager(villager);
    if (!window) {
      log('Failed to open villager trading interface');
      return;
    }

    // Wait a bit for the window to fully load with randomization
    await bot.waitForTicks(Math.floor(Math.random() * 20) + 10);

    const trades = window.villager?.trades || [];
    if (trades.length === 0) {
      log('No trades available with this villager');
      await window.close();
      return;
    }

    // Randomize trade order to avoid predictable patterns
    const tradeIndices = Array.from({length: trades.length}, (_, i) => i);
    for (let i = tradeIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tradeIndices[i], tradeIndices[j]] = [tradeIndices[j], tradeIndices[i]];
    }

    for (let i = 0; i < tradeIndices.length; i++) {
      const tradeIndex = tradeIndices[i];
      const trade = trades[tradeIndex];
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
          // Add random delay before trading
          await bot.waitForTicks(Math.floor(Math.random() * 10) + 5);
          
          await bot.trade(villager, tradeIndex);
          log(`Traded emeralds for ${sell}`);
          
          // Send Discord notification for successful trade
          if (config.discord?.notifyTrades) {
            discord.sendTradeNotification(sell, trade.outputItem?.count || 1, villager.position);
          }
          
          // Random wait between trades
          await bot.waitForTicks(Math.floor(Math.random() * 20) + 5);
        } catch (tradeErr) {
          log(`Failed to execute trade ${tradeIndex}: ${tradeErr.message}`);
        }
      }
    }

    // Random delay before closing window
    await bot.waitForTicks(Math.floor(Math.random() * 20) + 10);
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

// -------------------- Random Human-like Actions --------------------
async function performRandomAction() {
  if (!bot.entity) return;
  
  const actions = [
    // Random head movement
    () => {
      const randomYaw = bot.entity.yaw + (Math.random() - 0.5) * 1.0;
      const randomPitch = (Math.random() - 0.5) * 0.6;
      bot.look(randomYaw, randomPitch);
    },
    // Random small movement
    () => {
      const randomX = bot.entity.position.x + (Math.random() - 0.5) * 0.5;
      const randomZ = bot.entity.position.z + (Math.random() - 0.5) * 0.5;
      bot.lookAt(new Vec3(randomX, bot.entity.position.y, randomZ));
    },
    // Random jump
    () => {
      if (bot.entity.onGround) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 100);
      }
    },
    // Random crouch
    () => {
      bot.setControlState('sneak', true);
      setTimeout(() => bot.setControlState('sneak', false), 500 + Math.random() * 1000);
    }
  ];
  
  const randomAction = actions[Math.floor(Math.random() * actions.length)];
  randomAction();
  
  // Wait a bit after the action
  await bot.waitForTicks(Math.floor(Math.random() * 20) + 10);
}

// -------------------- Grim v3 Compatible Anti-AFK --------------------
setInterval(() => {
  if (!bot.entity) return;
  
  // More varied anti-AFK patterns
  const patterns = [
    () => {
      bot.look(bot.entity.yaw + Math.random() * 0.4 - 0.2, Math.random() * 0.2 - 0.1);
      bot.chat('/ping');
    },
    () => {
      bot.look(bot.entity.yaw + Math.random() * 0.6 - 0.3, Math.random() * 0.3 - 0.15);
      bot.chat('/tps');
    },
    () => {
      bot.look(bot.entity.yaw + Math.random() * 0.8 - 0.4, Math.random() * 0.4 - 0.2);
      bot.chat('/list');
    }
  ];
  
  const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];
  randomPattern();
}, 3000 + Math.random() * 4000); // 3-7 seconds interval

// -------------------- Grim v3 Evasion Features --------------------
let lastMovementTime = 0;
let movementPattern = 0;

// Add velocity randomization to avoid perfect movement detection
bot.on('move', () => {
  if (bot.entity && bot.entity.velocity) {
    // Add slight velocity randomization
    const randomFactor = 0.95 + Math.random() * 0.1;
    bot.entity.velocity.x *= randomFactor;
    bot.entity.velocity.z *= randomFactor;
  }
});

// Add packet timing randomization
const originalSendPacket = bot._client.write;
bot._client.write = function(packetName, packet) {
  // Add random delay to packet sending
  const delay = Math.random() * 50; // 0-50ms delay
  setTimeout(() => {
    originalSendPacket.call(this, packetName, packet);
  }, delay);
};

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