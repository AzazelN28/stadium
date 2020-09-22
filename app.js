const path = require('path')
const Koa = require('koa')
const helmet = require('koa-helmet')
const compress = require('koa-compress')
const files = require('koa-static')
const body = require('koa-body')
const route = require('koa-route')
const app = new Koa()

app.use(helmet())
app.use(body())
app.use(files(path.join(__dirname, 'public')))
/*
app.use(route.get('/', async (ctx) => {
  ctx.body = '¡Hello!' 
}))
*/

module.exports = app
