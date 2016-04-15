// jshint esnext: true
// jshint strict: true
// jshint node: true
/* globals document, window, global */

'use strict';

import koa from 'koa'
import router from 'koa-router'
import config from './config'

const r = require('rethinkdb')

const app = new koa();
const rout = new router();

app.use(async (ctx, next) => {
  await next();
  await closeConnection(ctx);
});

app.use(async (ctx, next) => {
  const start = new Date;
  await next();
  const ms = new Date - start;
  console.log(`${ctx.method} ${ctx.url} - ${ms}`);
});

app.use(createConnection);

app.use(rout.routes());

rout.get('/', async (ctx, next) => {
  ctx.body = 'API ok';
});

rout.get('/todo/get', async (ctx, next) => {
  try {
      const cursor = await r.table('todos').orderBy({index: "createdAt"}).run(ctx._rdbConn);
      const result = await cursor.toArray();
      ctx.body = JSON.stringify(result);
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  await next();
});

rout.get('/todo/new', async (ctx, next) => {
  try{
      var todo = {
        name: 'todo_name_' + Math.round(Math.random()*1000000)
      };
      todo.createdAt = r.now(); // Set the field `createdAt` to the current time
      var result = await r.table('todos').insert(todo, {returnChanges: true}).run(ctx._rdbConn);

      todo = result.changes[0].new_val; // todo now contains the previous todo + a field `id` and `createdAt`
      ctx.body = JSON.stringify(todo);
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  return next;

});

rout.post('/todo/update', async (ctx, next) => {
  try{
      var todo = await parse(ctx);
      delete todo._saving;
      if ((todo == null) || (todo.id == null)) {
          throw new Error("The todo must have a field `id`.");
      }

      var result = await r.table('todos').get(todo.id).update(todo, {returnChanges: true}).run(ctx._rdbConn);
      ctx.body = JSON.stringify(result.changes[0].new_val);
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  await next;
});

rout.post('/todo/delete', async (ctx, next) => {
  try{
      var todo = await parse(ctx);
      if ((todo == null) || (todo.id == null)) {
          throw new Error("The todo must have a field `id`.");
      }
      var result = await r.table('todos').get(todo.id).delete().run(ctx._rdbConn);
      ctx.body = "";
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  return next;
});

async function createConnection(ctx, next) {
    try {
        ctx._rdbConn = await r.connect(config.rethinkdb);
    }
    catch(err) {
        this.status = 500;
        this.body = err.message || http.STATUS_CODES[this.status];
    }
    await next();
}

/*
 * Close the RethinkDB connection
 */
async function closeConnection(ctx, next) {
    await ctx._rdbConn.close();
}

async function init() {
    let conn = await r.connect(config.rethinkdb);


    try { await r.dbCreate(config.rethinkdb.db).run(conn); } catch(e) { console.log('db exists'); }
    try { await r.tableCreate('todos').run(conn); } catch(e) { console.log('table exists'); }
    try { await r.table('todos').indexCreate('createdAt').run(conn); } catch(e) { console.log('index exists'); }
    try { await r.table('todos').indexWait('createdAt').run(conn) } catch(e) { console.log('index ready error'); }

    startKoa();
    conn.close();
}

function startKoa() {
    app.listen(config.koa.port);
    console.log('Listening on port '+config.koa.port);
}

init().then(function(){
  console.log('whoa!');
}).catch(function(e){
  console.log('init error:', e);
});
