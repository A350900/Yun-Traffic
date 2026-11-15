#!/usr/bin/env node
// The `yun` command. Run `setup-windows.bat` / `setup-mac.command` once to
// install it, then from any terminal:
//
//   yun start    start Yún Traffic in the background (gets the latest version first)
//   yun stop     stop it (frees all memory it was using)
//   yun status   is it running?
//   yun update   get the latest changes from GitHub right now
//   yun opensky  save your OpenSky API client (more frequent worldwide updates)
//
// While running it also checks GitHub every 30 seconds and pulls new
// changes, which show up in the browser by themselves.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { createInterface } from 'node:readline/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIR = join(ROOT, 'logs')
const LOG_FILE = join(LOG_DIR, 'autorun.log')
const PID_FILE = join(LOG_DIR, 'autorun.pid')
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const CHECK_EVERY_MS = 30_000
const URL = 'http://localhost:5173'

const SCRIPT = fileURLToPath(import.meta.url)
// Where the `yun` command goes. WindowsApps is on every Windows user's PATH.
const WIN_CMD_DIR = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps')
const WIN_CMD = join(WIN_CMD_DIR, 'yun.cmd')
const MAC_RC_FILES = ['.zshrc', '.bash_profile'].map((f) => join(homedir(), f))
const RC_START = '# >>> yun-traffic >>>'
const RC_END = '# <<< yun-traffic <<<'
// Left over from the earlier auto-start-at-login version; removed by setup.
const OLD_WIN_STARTUP = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'YunTraffic.vbs')
const OLD_MAC_PLIST = join(homedir(), 'Library', 'LaunchAgents', 'com.yuntraffic.autorun.plist')

mkdirSync(LOG_DIR, { recursive: true })

// ---------------------------------------------------------------- helpers

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: IS_WIN, windowsHide: true, ...opts })
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function runningPid() {
  if (!existsSync(PID_FILE)) return null
  const pid = Number(readFileSync(PID_FILE, 'utf8'))
  return pid && isAlive(pid) ? pid : null
}

function killTree(pid) {
  if (IS_WIN) sh('taskkill', ['/pid', String(pid), '/T', '/F'])
  else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  }
}

const lockHash = () => {
  const f = join(ROOT, 'package-lock.json')
  return existsSync(f) ? createHash('sha1').update(readFileSync(f)).digest('hex') : ''
}

// ---------------------------------------------------------------- run

function run() {
  if (runningPid()) return
  writeFileSync(PID_FILE, String(process.pid))
  const log = createWriteStream(LOG_FILE, { flags: 'w' })
  const say = (msg) => log.write(`[${new Date().toLocaleString()}] ${msg}\n`)

  let dev = null
  let stopping = false
  let restartDelay = 2000

  const pull = () => {
    const r = sh('git', ['pull', '--ff-only'])
    say(`git pull: ${(r.stdout || r.stderr || '').trim().split('\n').pop()}`)
  }
  const install = () => {
    say('npm install…')
    const r = sh('npm', ['install', '--no-audit', '--no-fund'])
    say(r.status === 0 ? 'npm install done' : `npm install failed: ${r.stderr}`)
  }
  const startDev = () => {
    say('starting dev server')
    dev = spawn('npm', ['run', 'dev'], {
      cwd: ROOT,
      shell: IS_WIN,
      windowsHide: true,
      detached: !IS_WIN, // own process group so we can stop the whole tree
      env: { ...process.env, FORCE_COLOR: '0' },
    })
    dev.stdout.pipe(log, { end: false })
    dev.stderr.pipe(log, { end: false })
    dev.on('exit', (code) => {
      dev = null
      if (stopping) return
      say(`dev server exited (${code}); restarting in ${restartDelay / 1000}s`)
      setTimeout(startDev, restartDelay)
      restartDelay = Math.min(restartDelay * 2, 60_000)
    })
    setTimeout(() => (restartDelay = 2000), 60_000)
  }
  const stopDev = () => new Promise((resolve) => {
    if (!dev) return resolve()
    dev.once('exit', () => resolve())
    killTree(dev.pid)
  })

  // Initial update + start
  pull()
  if (!existsSync(join(ROOT, 'node_modules'))) install()
  let lastLock = lockHash()
  startDev()

  // Watch GitHub for new commits
  setInterval(async () => {
    const fetch = sh('git', ['fetch', '--quiet'])
    if (fetch.status !== 0) return // offline; try again later
    const local = sh('git', ['rev-parse', 'HEAD']).stdout.trim()
    const remote = sh('git', ['rev-parse', '@{u}']).stdout.trim()
    if (!remote || local === remote) return
    pull()
    const lock = lockHash()
    if (lock !== lastLock) {
      lastLock = lock
      await stopDev()
      install()
      startDev()
    } // otherwise the dev server hot-reloads the changed files itself
  }, CHECK_EVERY_MS)

  const shutdown = async () => {
    stopping = true
    await stopDev()
    rmSync(PID_FILE, { force: true })
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// ---------------------------------------------------------------- start / stop

async function start() {
  if (runningPid()) return console.log(`Yun Traffic is already running: ${URL}`)
  const child = spawn(process.execPath, [SCRIPT, 'run'], {
    cwd: ROOT,
    detached: true, // keeps running after this terminal window is closed
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()

  process.stdout.write('Starting Yun Traffic')
  for (let i = 0; i < 240; i++) {
    await sleep(1000)
    try {
      const res = await fetch(URL)
      if (res.ok) {
        console.log(`\nReady: ${URL}`)
        console.log('Type "yun stop" when you are done.')
        return
      }
    } catch { /* not up yet */ }
    process.stdout.write('.')
    if (i === 15 && !existsSync(join(ROOT, 'node_modules', '.bin'))) {
      process.stdout.write(' (first start: installing, this takes a minute or two) ')
    }
  }
  console.log(`\nStill starting. Check ${LOG_FILE} if ${URL} does not load soon.`)
}

function stop() {
  const pid = runningPid()
  if (!pid) return console.log('Yun Traffic is not running.')
  killTree(pid)
  rmSync(PID_FILE, { force: true })
  console.log('Stopped.')
}

/** Pull right now instead of waiting for the next automatic check. */
async function update() {
  const before = lockHash()
  const r = sh('git', ['pull', '--ff-only'])
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  if (r.status !== 0) {
    console.log('Could not update:\n' + out)
    if (/local changes|overwritten/i.test(out)) {
      console.log('\nYou have unsaved edits in this folder that clash with the new version.')
    }
    return
  }
  if (/Already up to date/i.test(out)) return console.log('Already up to date.')
  console.log('Updated to the latest version.')
  if (lockHash() !== before) {
    console.log('Dependencies changed, reinstalling...')
    sh('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit' })
    if (runningPid()) {
      stop()
      await start()
      return
    }
  }
  if (runningPid()) console.log('The page will refresh by itself in a moment.')
  else console.log('Type "yun start" to run it.')
}

/**
 * Save OpenSky credentials to .env (stays on this computer, never committed).
 * Accepts the credentials.json file OpenSky gives you, or the ID and secret.
 */
async function openskySetup() {
  console.log('OpenSky account setup')
  console.log('In your OpenSky account page, create an API client and download credentials.json.\n')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let id = ''
  let secret = ''
  try {
    const first = (await rl.question('Drag credentials.json here and press Enter (or type your Client ID): ')).trim().replace(/^["']|["']$/g, '')
    if (first.toLowerCase().endsWith('.json') && existsSync(first)) {
      const json = JSON.parse(readFileSync(first, 'utf8'))
      id = json.clientId ?? json.client_id ?? ''
      secret = json.clientSecret ?? json.client_secret ?? ''
    } else {
      id = first
      secret = (await rl.question('Client secret: ')).trim()
    }
  } finally {
    rl.close()
  }
  if (!id || !secret) return console.log('\nNothing saved: the client ID or secret was empty.')

  const envFile = join(ROOT, '.env')
  const kept = existsSync(envFile)
    ? readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !/^OPENSKY_CLIENT_(ID|SECRET)=/.test(l))
    : []
  writeFileSync(envFile, [...kept, `OPENSKY_CLIENT_ID=${id}`, `OPENSKY_CLIENT_SECRET=${secret}`, ''].join('\n'))
  console.log('\nSaved to .env in the Yun-Traffic folder (only on this computer).')

  if (runningPid()) {
    console.log('Restarting so it takes effect...')
    stop()
    await sleep(1500)
    await start()
  } else {
    console.log('Type "yun start" to use it.')
  }
}

// ---------------------------------------------------------------- setup

function removeOldAutostart() {
  if (IS_WIN) rmSync(OLD_WIN_STARTUP, { force: true })
  if (IS_MAC && existsSync(OLD_MAC_PLIST)) {
    sh('launchctl', ['bootout', `gui/${process.getuid()}`, OLD_MAC_PLIST])
    rmSync(OLD_MAC_PLIST, { force: true })
  }
}

function stripBlock(text) {
  const a = text.indexOf(RC_START)
  const b = text.indexOf(RC_END)
  return a === -1 || b === -1 ? text : text.slice(0, a).trimEnd() + '\n' + text.slice(b + RC_END.length).replace(/^\n/, '')
}

function setup() {
  removeOldAutostart()
  if (IS_WIN) {
    mkdirSync(WIN_CMD_DIR, { recursive: true })
    writeFileSync(WIN_CMD, `@echo off\r\n"${process.execPath}" "${SCRIPT}" %*\r\n`)
  } else {
    const block = `${RC_START}\nyun() { "${process.execPath}" "${SCRIPT}" "$@"; }\n${RC_END}\n`
    for (const rc of MAC_RC_FILES) {
      // Always set up zsh (the macOS default); bash only if it is in use.
      if (!rc.endsWith('.zshrc') && !existsSync(rc)) continue
      const old = existsSync(rc) ? readFileSync(rc, 'utf8') : ''
      writeFileSync(rc, stripBlock(old).trimEnd() + (old.trim() ? '\n\n' : '') + block)
    }
  }
  console.log('Done! The "yun" command is installed.\n')
  console.log(`Open a NEW ${IS_WIN ? 'Command Prompt' : 'Terminal'} window, then:`)
  console.log('  yun start   -> then open http://localhost:5173')
  console.log('  yun stop    -> when you are done')
  console.log('  yun update  -> get the latest changes right now')
  console.log('\nIf you move this folder, run setup again from its new location.')
}

function removeSetup() {
  stop()
  removeOldAutostart()
  if (IS_WIN) rmSync(WIN_CMD, { force: true })
  else {
    for (const rc of MAC_RC_FILES) {
      if (existsSync(rc)) writeFileSync(rc, stripBlock(readFileSync(rc, 'utf8')))
    }
  }
  console.log('The "yun" command was removed.')
}

// ---------------------------------------------------------------- main

const cmd = process.argv[2]
if (cmd === 'run') run()
else if (cmd === 'start') await start()
else if (cmd === 'stop') stop()
else if (cmd === 'update') await update()
else if (cmd === 'opensky') await openskySetup()
else if (cmd === 'status') console.log(runningPid() ? `Running: ${URL}` : 'Not running. Type "yun start".')
else if (cmd === 'setup') setup()
else if (cmd === 'remove') removeSetup()
else console.log('Usage: yun start | yun stop | yun status | yun update | yun opensky')
