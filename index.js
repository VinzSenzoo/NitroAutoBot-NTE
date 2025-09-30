import axios from 'axios';
import cfonts from 'cfonts';
import gradient from 'gradient-string';
import chalk from 'chalk';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import ProgressBar from 'progress';
import ora from 'ora';
import { ethers } from 'ethers';

const logger = {
  info: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || 'ℹ️  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.green('INFO');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  warn: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '⚠️  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.yellow('WARN');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  error: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '❌  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.red('ERROR');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  }
};

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function countdownDelay() {
  const minSeconds = 240;
  const maxSeconds = 450;
  const waitTime = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  let remaining = waitTime;

  const updateCountdown = () => {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    process.stdout.write(`\rCooldown before next cycle: ${min}:${sec.toString().padStart(2, '0')}`);
  };

  updateCountdown();

  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      updateCountdown();
    } else {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
      console.log();
    }
  }, 1000);

  await delay(waitTime);
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function centerText(text, width) {
  const cleanText = stripAnsi(text);
  const textLength = cleanText.length;
  const totalPadding = Math.max(0, width - textLength);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function printHeader(title) {
  const width = 80;
  console.log(gradient.morning(`┬${'─'.repeat(width - 2)}┬`));
  console.log(gradient.morning(`│ ${title.padEnd(width - 4)} │`));
  console.log(gradient.morning(`┴${'─'.repeat(width - 2)}┴`));
}

function printInfo(label, value, context) {
  logger.info(`${label.padEnd(15)}: ${chalk.cyan(value)}`, { emoji: '📍 ', context });
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getGlobalHeaders(token = null) {
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'content-type': 'application/json',
    'origin': 'https://community.nitrograph.com',
    'priority': 'u=1, i',
    'referer': 'https://community.nitrograph.com/',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': getRandomUserAgent()
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getAxiosConfig(proxy, token = null, extraHeaders = {}) {
  const config = {
    headers: { ...getGlobalHeaders(token), ...extraHeaders },
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    logger.warn(`Unsupported proxy: ${proxy}`);
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 5, backoff = 5000, context) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported`);
      }
      return { success: true, data: response.data, fullResponse: response };
    } catch (error) {
      let status = error.response?.status;
      if (status === 429) {
        backoff = 30000;
      }
      if (status === 400 || status === 404) {
        const errMsg = error.response?.data?.error || error.response?.data?.message || 'Bad request';
        return { success: false, message: errMsg, status };
      }
      if (i < retries - 1) {
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      logger.error(`Request failed after ${retries} attempts: ${error.message} - Status: ${status}`, { context });
      return { success: false, message: error.message, status };
    }
  }
}

const AUTH_API = 'https://api-web.nitrograph.com/api';
const BASE_API = 'https://community.nitrograph.com/api';
const NONCE_URL = `${AUTH_API}/auth/nonce`;
const VERIFY_URL = `${AUTH_API}/auth/verify`;
const CLAIM_URL = `${AUTH_API}/credits/claim`;
const USER_URL = `${AUTH_API}/users/me`;
const LOYALTIES_RULES_URL = `${BASE_API}/loyalties/rules`;

async function readPrivateKeys() {
  try {
    const data = await fs.readFile('pk.txt', 'utf-8');
    const pks = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    logger.info(`Loaded ${pks.length} private key${pks.length === 1 ? '' : 's'}`, { emoji: '📄 ' });
    return pks;
  } catch (error) {
    logger.error(`Failed to read pk.txt: ${error.message}`, { emoji: '❌ ' });
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (proxies.length === 0) {
      logger.warn('No proxies found. Proceeding without proxy.', { emoji: '⚠️  ' });
    } else {
      logger.info(`Loaded ${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'}`, { emoji: '🌐  ' });
    }
    return proxies;
  } catch (error) {
    logger.warn('proxy.txt not found.', { emoji: '⚠️ ' });
    return [];
  }
}

async function getPublicIP(proxy, context) {
  try {
    const config = getAxiosConfig(proxy);
    delete config.headers.authorization;
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, config, 5, 5000, context);
    return response.data.ip || 'Unknown';
  } catch (error) {
    logger.error(`Failed to get IP: ${error.message}`, { emoji: '❌  ', context });
    return 'Error retrieving IP';
  }
}

async function getNonce(proxy, context) {
  try {
    const res = await requestWithRetry('get', NONCE_URL, null, getAxiosConfig(proxy), 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.data.nonce;
  } catch (error) {
    logger.error(`Failed to fetch nonce: ${error.message}`, { context });
    return null;
  }
}

async function performLogin(pk, proxy, context) {
  try {
    const wallet = new ethers.Wallet(pk);
    const address = wallet.address;

    const nonce = await getNonce(proxy, context);
    if (!nonce) {
      throw new Error('Failed to get nonce');
    }

    const issuedAt = new Date().toISOString();
    const message = `community.nitrograph.com wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Nitrograph using your wallet\n\nURI: https://community.nitrograph.com\nVersion: 1\nChain ID: 200024\nNonce: ${nonce}\nIssued At: ${issuedAt}`;

    const signature = await wallet.signMessage(message);

    const payload = {
      message,
      signature
    };

    const res = await requestWithRetry('post', VERIFY_URL, payload, getAxiosConfig(proxy), 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }

    const data = res.data;
    const fullResponse = res.fullResponse;
    const token = data.token;

    const setCookies = fullResponse.headers['set-cookie'] || [];
    let session_v1 = '';
    if (setCookies.length > 0) {
      session_v1 = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
    }

    const tokenData = data.tokenData || {};
    const expiresAt = data.expiresAt;
    const refreshToken = data.refreshToken;

    const session_v4_obj = {
      token: token,
      userId: tokenData.userId,
      snagUserId: tokenData.snagUserId,
      address: address,
      chainId: tokenData.chainId,
      expiresAt: expiresAt,
      newAccount: tokenData.newAccount,
      refreshToken: refreshToken
    };

    const session_v4_json = JSON.stringify(session_v4_obj);
    const session_v4 = '@nitrograph/session-v4=' + encodeURIComponent(session_v4_json);

    let cookie = `${session_v1}; ${session_v4}`.trim();
    if (cookie.startsWith(';')) cookie = cookie.slice(1).trim();

    return { token, cookie };
  } catch (error) {
    logger.error(`Failed to perform login: ${error.message}`, { context });
    return null;
  }
}

async function performClaim(token, proxy, context) {
  try {
    const res = await requestWithRetry('post', CLAIM_URL, {}, getAxiosConfig(proxy, token), 5, 5000, context);
    if (!res.success) {
      const errorMsg = res.message || 'Unknown error';
      const status = res.status || 'N/A';
      if (errorMsg.includes('once every 24 hours')) {
        logger.warn(`Already claimed: ${errorMsg} (Status: ${status})`, { emoji: '⚠️  ', context });
        return { alreadyClaimed: true };
      } else {
        logger.error(`Claim failed: ${errorMsg} (Status: ${status})`, { emoji: '❌  ', context });
        return null;
      }
    }
    return res.data;
  } catch (error) {
    logger.error(`Unexpected error during claim: ${error.message}`, { context });
    return null;
  }
}

async function getLoyaltiesRules(type, proxy, cookie, context) {
  try {
    const url = `${LOYALTIES_RULES_URL}?type=${type}`;
    const config = getAxiosConfig(proxy, null, { 'cookie': cookie });
    const res = await requestWithRetry('get', url, null, config, 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.data;
  } catch (error) {
    logger.error(`Failed to fetch loyalties rules: ${error.message}`, { context });
    return null;
  }
}

async function claimLoyalties(ruleIds, proxy, cookie, context) {
  try {
    const payload = { ruleIds };
    const config = getAxiosConfig(proxy, null, { 'cookie': cookie });
    const res = await requestWithRetry('post', LOYALTIES_RULES_URL, payload, config, 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.data;
  } catch (error) {
    logger.error(`Failed to claim loyalties: ${error.message}`, { context });
    return null;
  }
}

async function fetchUserInfo(token, proxy, context) {
  try {
    const res = await requestWithRetry('get', USER_URL, null, getAxiosConfig(proxy, token), 5, 5000, context);
    if (!res.success) {
      throw new Error(res.message);
    }
    return {
      address: res.data.data.walletAddress || 'Unknown',
      credits: res.data.data.credits || 'N/A'
    };
  } catch (error) {
    logger.error(`Failed to fetch user info: ${error.message}`, { context });
    return { address: 'Unknown', credits: 'N/A' };
  }
}

async function processPrivateKey(pk, index, total, proxy = null) {
  const wallet = new ethers.Wallet(pk);
  const address = wallet.address;
  const context = `Account ${index + 1}/${total}`;
  logger.info(chalk.bold.magentaBright(`Starting account processing`), { emoji: '🚀 ', context });

  printHeader(`Account Info ${context}`);
  const ip = await getPublicIP(proxy, context);
  printInfo('IP', ip, context);
  printInfo('Address', address, context);
  console.log('\n');

  console.log('\n');
  logger.info('Starting login process...', { context });
  console.log('\n');

  const loginRes = await performLogin(pk, proxy, context);
  if (!loginRes) {
    logger.error('Login failed', { emoji: '❌  ', context });
    return;
  }
  const { token, cookie } = loginRes;
  logger.info(chalk.bold.greenBright('Login successful'), { emoji: '✅  ', context });

  console.log('\n');
  logger.info('Starting daily $NITRO claim process...', { context });
  console.log('\n');

  const claimRes = await performClaim(token, proxy, context);
  if (claimRes && !claimRes.alreadyClaimed) {
    logger.info(chalk.bold.greenBright(`Claim successful: +${claimRes.claimedAmount} $NITRO, New Balance: ${claimRes.newBalance}, Streak: ${claimRes.streakDays}`), { emoji: '✅  ', context });
  }

  console.log('\n');
  logger.info('Starting daily check-in process...', { context });
  console.log('\n');

  const rules = await getLoyaltiesRules('DAILY_CLAIM', proxy, cookie, context);
  if (rules) {
    const ruleIds = rules.map(r => r.id).filter(id => id);
    if (ruleIds.length > 0) {
      const checkInRes = await claimLoyalties(ruleIds, proxy, cookie, context);
      if (checkInRes) {
        logger.info(chalk.bold.greenBright(`Check-in Successful: ${checkInRes.message || 'Completed'}`), { emoji: '✅  ', context });
      }
    } else {
      logger.warn('No daily check-in rules available.', { emoji: '⚠️  ', context });
    }
  } else {
    logger.error('Failed to fetch daily check-in rules.', { emoji: '❌  ', context });
  }

  printHeader(`Account Stats ${context}`);
  const userInfo = await fetchUserInfo(token, proxy, context);
  printInfo('Address', userInfo.address, context);
  printInfo('Total $NITRO', userInfo.credits, context);

  logger.info(chalk.bold.greenBright(`Completed account processing`), { emoji: '🎉 ', context });
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

let globalUseProxy = false;
let globalProxies = [];

async function initializeConfig() {
  const useProxyAns = await askQuestion(chalk.cyanBright('🔌 Do You Want Use Proxy? (y/n): '));
  if (useProxyAns.trim().toLowerCase() === 'y') {
    globalUseProxy = true;
    globalProxies = await readProxies();
    if (globalProxies.length === 0) {
      globalUseProxy = false;
      logger.warn('No proxies available, proceeding without proxy.', { emoji: '⚠️ ' });
    }
  } else {
    logger.info('Proceeding without proxy.', { emoji: 'ℹ️ ' });
  }
}

async function runCycle() {
  const pks = await readPrivateKeys();
  if (pks.length === 0) {
    logger.error('No private keys found in pk.txt. Exiting cycle.', { emoji: '❌ ' });
    return;
  }

  for (let i = 0; i < pks.length; i++) {
    const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
    try {
      await processPrivateKey(pks[i], i, pks.length, proxy);
    } catch (error) {
      logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context: `Account ${i + 1}/${pks.length}` });
    }
    if (i < pks.length - 1) {
      console.log('\n\n');
    }
    await delay(5);
  }
}

async function run() {
  const terminalWidth = process.stdout.columns || 80;
  cfonts.say('NT EXHAUST', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true
  });
  console.log(gradient.retro(centerText('=== Telegram Channel 🚀 : NT EXHAUST @NTExhaust ===', terminalWidth)));
  console.log(gradient.retro(centerText('✪ BOT NITRO AUTO CLAIM DAILY $NITRO & CHECKIN ✪', terminalWidth)));
  console.log('\n');
  await initializeConfig();

  while (true) {
    await runCycle();
    logger.info(chalk.bold.yellowBright('Cycle completed. Waiting 24 Hours...'), { emoji: '🔄 ' });
    await delay(86400);
  }
}

run().catch(error => logger.error(`Fatal error: ${error.message}`, { emoji: '❌' }));