const debug = require('debug')
const http = require('http')
const app = require('./app')
const ws = require('./ws')

const log = debug('stadium')

const httpServer = http.createServer(app.callback())
const wsServer = ws(httpServer)
httpServer.listen(9000, (err) => {
  log('Listening on port 9000')
})

process.on('uncaughtException', (err, origin) => {
  log(err, origin)
})

setInterval(() => {
  const mem = process.memoryUsage()
  log(mem.rss, mem.heapTotal, mem.heapUsed, mem.external)
}, 1000)
