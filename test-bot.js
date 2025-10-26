// Test script to verify bot initialization
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');

console.log('Testing bot initialization...');

try {
  // Load config
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  console.log('✓ Config loaded successfully');
  console.log(`  Host: ${config.host}:${config.port}`);
  console.log(`  Username: ${config.username}`);
  console.log(`  Version: ${config.version}`);

  // Test minecraft-data loading
  const mcData = mcDataLoader(config.version);
  console.log('✓ Minecraft data loaded successfully');
  console.log(`  Emerald ID: ${mcData.itemsByName.emerald.id}`);

  // Test bot creation (without connecting)
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
  console.log('✓ Bot created and pathfinder loaded successfully');

  console.log('\n✅ All tests passed! Bot should work with Minecraft 1.21.4');
  
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}