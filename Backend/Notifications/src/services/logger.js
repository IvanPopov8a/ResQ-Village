// A simple logger to stop the error and show what's happening

const logger = {
    info: (msg) => console.log(`[INFO] ${new Date().toISOString()}: ${msg}`),
    error: (msg) => console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()}: ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()}: ${msg}`) // Add this line
};

module.exports = logger;