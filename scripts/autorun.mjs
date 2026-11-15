#!/usr/bin/env node
// Keeps Yún Traffic running in the background on your own computer.
//
//   node scripts/autorun.mjs install    start now + start automatically at login
//   node scripts/autorun.mjs uninstall  stop + remove the auto-start
//   node scripts/autorun.mjs stop       stop the background copy
//   node scripts/autorun.mjs status     is it running?
//   node scripts/autorun.mjs run        (what auto-start calls) run in the foreground
//
// While running it checks GitHub every minute and pulls new changes. The dev
// server hot-reloads them; if dependencies changed it reinstalls and restarts.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIR = join(ROOT, 'logs')
const LOG_FILE = join(LOG_DIR, 'autorun.log')
const PID_FILE = join(LOG_DIR, 'autorun.pid')
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const CHECK_EVERY_MS = 60_000
const URL = 'http://localhost:5173'

const WIN_STARTUP = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'YunTraffic.vbs')
const MAC_LABEL = 'com.yuntraffic.autorun'
const MAC_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`)

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
  if (runningPid()) {
    console.log(`Already running. Open ${URL}`)
    return
  }
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

// ---------------------------------------------------------------- stop / status

function stop() {
  const pid = runningPid()
  if (!pid) return console.log('Not running.')
  killTree(pid)
  rmSync(PID_FILE, { force: true })
  console.log('Stopped.')
}

// ---------------------------------------------------------------- install

function startInBackground() {
  if (runningPid()) return
  const child = IS_WIN
    ? spawn('wscript', [WIN_STARTUP], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(process.execPath, [fileURLToPath(import.meta.url), 'run'], { cwd: ROOT, detached: true, stdio: 'ignore' })
  child.unref()
}

function install() {
  if (IS_WIN) {
    const q = (s) => s.replaceAll('"', '""')
    writeFileSync(
      WIN_STARTUP,
      [
        'Set sh = CreateObject("WScript.Shell")',
        `sh.CurrentDirectory = "${q(ROOT)}"`,
        `sh.Run """${q(process.execPath)}"" ""${q(join(ROOT, 'scripts', 'autorun.mjs'))}"" run", 0, False`,
        '',
      ].join('\r\n'),
    )
    startInBackground()
  } else if (IS_MAC) {
    // launchd starts with a bare PATH, so pass along where node/npm/git live.
    const path = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
    mkdirSync(dirname(MAC_PLIST), { recursive: true })
    writeFileSync(
      MAC_PLIST,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${join(ROOT, 'scripts', 'autorun.mjs')}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(LOG_DIR, 'launchd.log')}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, 'launchd.log')}</string>
</dict>
</plist>
`,
    )
    const uid = process.getuid()
    sh('launchctl', ['bootout', `gui/${uid}`, MAC_PLIST])
    const r = sh('launchctl', ['bootstrap', `gui/${uid}`, MAC_PLIST])
    if (r.status !== 0) {
      console.log('launchctl said:', r.stderr.trim())
      startInBackground()
    }
  } else {
    console.log('Auto-start is set up for Windows and Mac only. Starting in the background now.')
    startInBackground()
  }

  console.log('\nInstalled. Yun Traffic now starts by itself when you log in.')
  console.log('First start installs packages and can take a minute or two.')
  console.log(`Then open ${URL} (bookmark it).`)
  console.log(`If you move this folder, run the installer again.`)
}

function uninstall() {
  stop()
  if (IS_WIN) rmSync(WIN_STARTUP, { force: true })
  if (IS_MAC) {
    sh('launchctl', ['bootout', `gui/${process.getuid()}`, MAC_PLIST])
    rmSync(MAC_PLIST, { force: true })
  }
  console.log('Auto-start removed.')
}

// ---------------------------------------------------------------- main

const cmd = process.argv[2] ?? 'run'
if (cmd === 'run') run()
else if (cmd === 'install') install()
else if (cmd === 'uninstall') uninstall()
else if (cmd === 'stop') stop()
else if (cmd === 'status') console.log(runningPid() ? `Running. Open ${URL}` : 'Not running.')
else console.log('Usage: node scripts/autorun.mjs [install|uninstall|stop|status|run]')
