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

let iterat = 0;
const CONNECTION_POOL_SIZE = 500
const connection_pool = Array.apply(null, Array(CONNECTION_POOL_SIZE)).map(function () {});

const PORT = process.argv[2] || 3000;

app.use(async (ctx, next) => {
  await next();
  await closeConnection(ctx);
});

app.use(async (ctx, next) => {
  const start = new Date;
  await next();
  const ms = new Date - start;
  //console.log(`${ctx.method} ${ctx.url} - ${ms}`);
});

app.use(async (ctx, next) => {
  let i = getConnection();
  if(i) {
    ctx.i = i;
  }
  await next();
});

app.use(rout.routes());

rout.get('/', async (ctx, next) => {
  ctx.body = `API ok`;
});

rout.get('/todo/get', async (ctx, next) => {
  try {
      const cursor = await r.table('todos').filter({name: `todo_name_${Math.round(Math.random()*10000)}`}).run(connection_pool[ctx.i]['conn']);
      const result = await cursor.toArray();
      ctx.body = JSON.stringify(result);
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  return next;
});

rout.get('/todo/new', async (ctx, next) => {
  try {
      var todo = {
        name: `todo_name_${Math.round(Math.random()*10000)}`
      };
      todo.createdAt = r.now(); // Set the field `createdAt` to the current time
      var result = await r.table('todos').insert(todo, { returnChanges: true }).run(connection_pool[ctx.i]['conn']);

      todo = result.changes[0].new_val; // todo now contains the previous todo + a field `id` and `createdAt`
      ctx.body = JSON.stringify(todo);
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  return next;
});

rout.get('/todo/update', async (ctx, next) => {
  try{
      // var todo = await parse(ctx);
      // delete todo._saving;
      // if ((todo == null) || (todo.id == null)) {
      //     throw new Error(`The todo must have a field 'id'.`);
      // }

      var result = await r.table('todos').filter({name: `todo_name_${Math.round(Math.random()*10000)}`}).update({update: Math.round(Math.random()*10000)}, { returnChanges: true }).run(connection_pool[ctx.i]['conn']);
      ctx.body = result.changes ? JSON.stringify(result.changes[0].new_val) : `not found`;
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  return next;
});

rout.post('/todo/delete', async (ctx, next) => {
  try{
      var todo = await parse(ctx);
      if ((todo == null) || (todo.id == null)) {
          throw new Error(`The todo must have a field 'id'.`);
      }
      var result = await r.table('todos').get(todo.id).delete().run(connection_pool[ctx.i]['conn']);
      ctx.body = `deleted`;
  }
  catch(e) {
      ctx.status = 500;
      ctx.body = e.message || http.STATUS_CODES[ctx.status];
  }
  return next;
});

async function createConnection() {
    try {
        let con = await r.connect(config.rethinkdb);
        return con;
    }
    catch(err) {
        console.log('ERROR CREATING CONNECTION');
    }
}

function getConnection() {
  let i = nextFreeConnection();
  //console.log(`allocating connection #${ i }`);
  return i;
}

function nextFreeConnection() {
  for(let i = 0; i < CONNECTION_POOL_SIZE; i++) {
    if(connection_pool[i]['available']) {
      //console.log(`found available connection #${ i }`);
      connection_pool[i]['available'] = false;
      return i;
    }
  }
  return false;
}

/*
 * Close the RethinkDB connection
 */
async function closeConnection(ctx, next) {
    //console.log(`releasing connection #${ ctx.i }`);
    //await connection_pool[ctx.i]['conn'].close();
    connection_pool[ctx.i]['available'] = true;
}

async function init() {

    const conn = await r.connect(config.rethinkdb);
    try { await r.dbCreate(config.rethinkdb.db).run(conn); } catch(e) { console.log(`db exists`); }
    try { await r.tableCreate('todos').run(conn); } catch(e) { console.log(`table exists`); }
    try { await r.table('todos').indexCreate('createdAt').run(conn); } catch(e) { console.log(`index exists`); }
    try { await r.table('todos').indexCreate('name').run(conn); } catch(e) { console.log(`index exists`); }
    try { await r.table('todos').indexWait('createdAt').run(conn); } catch(e) { console.log(`index ready error`); }
    try { await r.table('todos').indexWait('name').run(conn); } catch(e) { console.log(`index ready error`); }
    try { await initPool(); } catch(e) { console.log(`error creating connection pool ${e}`); }
    //try { listenChanges(conn); } catch(e) { console.log(`error streaming changes ${e}`); }

    r.table('todos').changes().run(conn, function(err, cursor) {
      if(err) {
        console.log(`ERROR STREAMING ${err}`);
      } else {
        console.log(`changes length is ${cursor.length || 0}`);
      }
    });

    startKoa();

    setInterval(function(){
      printPoolStatus();
    }, 60000);


}

function printPoolStatus() {
  let allocated = 0;
  for(let i = 0; i < CONNECTION_POOL_SIZE; i++) {
    if(!connection_pool[i]['available']) {
      allocated++;
    }
  }
  console.log(`Connection Status - Total:${CONNECTION_POOL_SIZE} Free:${CONNECTION_POOL_SIZE - allocated} Allocated:${allocated} - ${new Date()}`);
}

function listenChanges(conn) {
  r.table('todos').changes().run(conn, function(err, cursor) {
    if(err) {
      console.log(`ERROR STREAMING ${err}`);
    } else {
      console.log(`changes length is ${cursor.length || 0}`);
    }
  });
}

async function initPool() {
  for(let i = 0; i < CONNECTION_POOL_SIZE; i++) {
    let c = await createConnection();
    connection_pool[i] = {
      conn: c,
      available: true
    };
  }
}

function startKoa() {
    app.listen(PORT);
    console.log(`Listening on port ${ PORT }`);
}

init().then(function(){
  console.log(`whoa!`);
}).catch(function(e){
  console.log(`init error: ${ e }`);
});
