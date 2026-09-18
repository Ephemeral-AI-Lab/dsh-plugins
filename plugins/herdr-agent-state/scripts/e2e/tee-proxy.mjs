#!/usr/bin/env node
/**
 * E2E helper (not published): a tee proxy for Herdr's pane socket.
 *
 *   node scripts/e2e/tee-proxy.mjs <realSocket> <proxySocketPath> <logFile>
 *
 * Listens on <proxySocketPath>; every complete request line a client sends is
 * appended to <logFile> (timestamped) and forwarded to the real socket.
 * Responses flow back unmodified. Lets an E2E run observe the exact
 * pane.report_* wire traffic that Herdr's INFO log omits.
 */
import { appendFileSync, rmSync } from 'node:fs'
import net from 'node:net'

const [realSocket, proxySocket, logFile] = process.argv.slice(2)
if (!realSocket || !proxySocket || !logFile) {
  console.error('usage: tee-proxy.mjs <realSocket> <proxySocketPath> <logFile>')
  process.exit(1)
}

let carry = ''
rmSync(proxySocket, { force: true })
net
  .createServer((client) => {
    const upstream = net.createConnection(realSocket)
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    upstream.pipe(client)
    client.on('data', (chunk) => {
      carry += chunk.toString()
      let index
      while ((index = carry.indexOf('\n')) !== -1) {
        const line = carry.slice(0, index)
        carry = carry.slice(index + 1)
        if (line.trim()) {
          appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
        }
      }
      upstream.write(chunk)
    })
  })
  .listen(proxySocket, () => console.log(`tee proxy: ${proxySocket} -> ${realSocket} (log: ${logFile})`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    rmSync(proxySocket, { force: true })
    process.exit(0)
  })
}
