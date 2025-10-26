// -------------------- Required Modules --------------------
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const mcDataLoader = require('minecraft-data');

// -------------------- Load Config --------------------
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

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

// -------------------- Safe Movements --------------------
bot.once('spawn', () => {
  mcData = mcDataLoader(bot.version);

  class SafeMovements extends Movements {
    constructor(bot, mcData) {
      super(bot, mcData);
      this.allowDigging = false;
      this.allowPlace = false;
    }
    canDig() { return false; }
    canPlace() { return false; }
  }

  const safeMove = new SafeMovements(bot, mcData);
  bot.pathfinder.setMovements(safeMove);
  log('Safe pathfinding initialized: block breaking and placing disabled.');
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
      mainLoop();
      break;
    case 'stop':
      running = false;
      reply(playerName, 'Trading bot stopped.');
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
      break;
    default:
      reply(playerName, 'Unknown command. Use /msg <botname> help');
  }
});

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

      const villagers = getNearbyVillagers();
      if (villagers.length === 0) {
        log('No villagers in render distance.');
        await bot.waitForTicks(6000); // Wait 5 minutes before checking again
        continue;
      }

      log(`Found ${villagers.length} villagers nearby`);

      for (const villager of villagers) {
        if (!running) break; // Check if bot should stop
        
        if (!withinBounds(villager.position)) {
          log(`Villager at ${villager.position} is outside bounds, skipping`);
          continue;
        }

        // Path to villager safely
        await goToEntity(villager);
        
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

  const goal = new GoalNear(entity.position.x, entity.position.y, entity.position.z, 2);
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
      } else {
        log('No emeralds found in refill chest');
      }
    } else {
      log('Already have enough emeralds');
    }

    await chest.close();
  } catch (err) {
    log(`Emerald refill failed: ${err.message}`);
  }
}

// -------------------- Anti-AFK --------------------
setInterval(() => {
  if (!bot.entity) return;
  bot.look(bot.entity.yaw + Math.random() * 0.3 - 0.15, 0);
  bot.chat('/ping');
}, 4000);

// -------------------- Logging --------------------
bot.on('spawn', () => log('Bot spawned successfully.'));
bot.on('kicked', (reason) => log(`Kicked: ${reason}`));
bot.on('error', (err) => log(`Error: ${err.message}`));