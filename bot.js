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
  // Disable chat signing to simplify whispers on newer servers
  disableChatSigning: true,
  // Skip validation to allow quick reconnects/offline debug; safe on most servers
  skipValidation: true
});

bot.loadPlugin(pathfinder);

let running = false;
let depositChest = null;
let refillChest = null;
let whitelist = Array.isArray(config.whitelist) ? [...config.whitelist] : [];
let bound1 = config.bounds?.corner1 ? new Vec3(config.bounds.corner1.x, config.bounds.corner1.y, config.bounds.corner1.z) : null;
let bound2 = config.bounds?.corner2 ? new Vec3(config.bounds.corner2.x, config.bounds.corner2.y, config.bounds.corner2.z) : null;
let mcData;

// Config-driven behavior
const TRADE_ITEM_MATCHERS = (config.tradeItems || []).map(s => String(s).toLowerCase());
const ANTI_AFK_MS = Number.isFinite(config.antiAFKWaitTime) ? config.antiAFKWaitTime : 600000; // default 10 min

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
      depositChest = await findNearestContainerNear(player.position);
      if (depositChest) {
        reply(playerName, `Deposit container set to ${depositChest}`);
      } else {
        reply(playerName, 'No container found nearby. Stand near a chest/barrel.');
      }
      break;
    case 'setrefill':
      refillChest = await findNearestContainerNear(player.position);
      if (refillChest) {
        reply(playerName, `Refill container set to ${refillChest}`);
      } else {
        reply(playerName, 'No container found nearby. Stand near a chest/barrel.');
      }
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
      const villagers = getNearbyVillagers();
      if (villagers.length === 0) log('No villagers in render distance.');

      for (const villager of villagers) {
        if (!withinBounds(villager.position)) continue;

        // Path to villager safely
        await goToEntity(villager);

        // Trade
        await tradeWithVillager(villager);
      }

      // Wait configured anti-AFK period before next scan
      const ticks = Math.max(1, Math.floor(ANTI_AFK_MS / 50));
      log(`Finished checking villagers. Sleeping for ${ANTI_AFK_MS / 1000}s.`);
      await bot.waitForTicks(ticks);

    } catch (err) {
      log(`Error in main loop: ${err.message}`);
    }
  }
}

// -------------------- Villager Detection --------------------
function getNearbyVillagers() {
  return Object.values(bot.entities).filter(e => {
    if (!e) return false;
    // In modern mineflayer, villager entity name is 'villager'
    return e.name === 'villager';
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
  if (!entity || !entity.position) return;

  const goal = new GoalNear(entity.position.x, entity.position.y, entity.position.z, 1);
  try {
    await bot.pathfinder.goto(goal);
  } catch (err) {
    log(`Pathing error: ${err.message} - villager might be unreachable.`);
  }
}

// -------------------- Trading --------------------
async function tradeWithVillager(villager) {
  try {
    const trading = await bot.openVillager(villager);
    if (!trading) return;

    const trades = trading.trades || [];
    for (const trade of trades) {
      if (!trade || trade.disabled) continue;
      const sellName = (trade.outputItem?.name || '').toLowerCase();
      const shouldTrade = TRADE_ITEM_MATCHERS.length === 0
        ? (sellName.includes('glass') || sellName.includes('experience_bottle'))
        : TRADE_ITEM_MATCHERS.some(key => sellName.includes(key));

      if (!shouldTrade) continue;

      try {
        // Prefer trading via trade object; fallback to index if needed
        if (typeof trading.trade === 'function') {
          // Try with trade object
          await trading.trade(trade);
        } else {
          const index = trades.indexOf(trade);
          if (index >= 0 && typeof trading.trade === 'function') {
            await trading.trade(index);
          }
        }
        log(`Traded for ${sellName}`);
      } catch (tradeErr) {
        log(`Trade attempt failed for ${sellName}: ${tradeErr.message}`);
      }
    }

    await trading.close();

    if (depositChest) await depositItems();
    if (refillChest) await refillEmeralds();

  } catch (err) {
    log(`Trade error: ${err.message}`);
  }
}

// -------------------- Inventory --------------------
async function depositItems() {
  if (!depositChest) return;
  try {
    // Move near the container first to ensure it's interactable
    await goToPosition(depositChest, 3);
    const block = bot.blockAt(depositChest);
    if (!block) return;
    const container = await bot.openContainer(block);

    for (const item of bot.inventory.items()) {
      const name = (item.name || '').toLowerCase();
      const matches = TRADE_ITEM_MATCHERS.length === 0
        ? (name.includes('glass') || name.includes('experience_bottle'))
        : TRADE_ITEM_MATCHERS.some(key => name.includes(key));
      if (!matches) continue;
      await container.deposit(item.type, null, item.count);
      log(`Deposited ${item.count}x ${item.name}`);
    }
    await container.close();
  } catch (err) {
    log(`Deposit failed: ${err.message}`);
  }
}

async function refillEmeralds() {
  if (!refillChest) return;
  try {
    await goToPosition(refillChest, 3);
    const block = bot.blockAt(refillChest);
    if (!block) return;
    const container = await bot.openContainer(block);

    const emeraldId = mcData.itemsByName?.emerald?.id;
    const emeraldCount = emeraldId != null ? bot.inventory.count(emeraldId) : 0;
    if (emeraldCount < 16) {
      const emeralds = container.containerItems().find(i => (i.name || '').toLowerCase() === 'emerald');
      if (emeralds) {
        const toWithdraw = Math.min(emeralds.count, 64 - emeraldCount);
        if (toWithdraw > 0) {
          await container.withdraw(emeralds.type, null, toWithdraw);
          log(`Refilled emeralds by ${toWithdraw}`);
        }
      }
    }

    await container.close();
  } catch (err) {
    log(`Emerald refill failed: ${err.message}`);
  }
}

// Move near a specific position using a small radius
async function goToPosition(pos, range = 2) {
  try {
    const goal = new GoalNear(pos.x, pos.y, pos.z, range);
    await bot.pathfinder.goto(goal);
  } catch (err) {
    log(`Pathing error to position ${pos}: ${err.message}`);
  }
}

// Find nearest container block near a reference position
async function findNearestContainerNear(refPos, maxDistance = 5) {
  const center = refPos.floored();
  let best = null;
  let bestDist = Infinity;

  const isContainerName = (name) => {
    if (!name) return false;
    const lower = name.toLowerCase();
    return lower.includes('chest') || lower.includes('barrel') || lower.includes('shulker_box');
  };

  for (let dx = -maxDistance; dx <= maxDistance; dx++) {
    for (let dy = -maxDistance; dy <= maxDistance; dy++) {
      for (let dz = -maxDistance; dz <= maxDistance; dz++) {
        const pos = center.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (!block) continue;
        if (!isContainerName(block.name)) continue;
        const d2 = (pos.x - center.x) ** 2 + (pos.y - center.y) ** 2 + (pos.z - center.z) ** 2;
        if (d2 < bestDist) {
          bestDist = d2;
          best = pos;
        }
      }
    }
  }
  return best;
}

// -------------------- Anti-AFK --------------------
// Gentle anti-AFK: occasional head movement and random small jump without chat spam
setInterval(() => {
  if (!bot.entity) return;
  const yaw = bot.entity.yaw + (Math.random() * 0.6 - 0.3);
  bot.look(yaw, 0, true);
  if (Math.random() < 0.25) {
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 200);
  }
}, Math.max(15000, Math.floor(ANTI_AFK_MS / 6)));

// -------------------- Logging --------------------
bot.on('spawn', () => log('Bot spawned successfully.'));
bot.on('kicked', (reason) => {
  try {
    log(`Kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  } catch {
    log('Kicked: <unserializable reason>');
  }
});
bot.on('error', (err) => log(`Error: ${err?.message || String(err)}`));
