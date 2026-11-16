// Stops only what the setup started. Set E2E_KEEP_STACK=1 to leave it running for the next run.
const { stopStack } = require('./stack');
module.exports = async () => { if (process.env.E2E_KEEP_STACK !== '1') stopStack(); };
