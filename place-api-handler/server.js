const fs = require('fs');

var dim = 250; // TODO: Scale board to 1000 x 1000
const tile_colors = require('./tile_colors.json');

const {createClient } = require('redis');
const cassandra = require('cassandra-driver');
const Uuid = cassandra.types.Uuid; // For generating session IDs in cassandra

const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8081 });

// Establish connection with Redis asynchronously

// Note: Encryption in transit is diabled, when enabled SSL must be enabled on the server side.
const client = createClient();
client.on('error', err => console.log('Redis Client: ', err));
client.connect().catch(err => console.log('Error connecting to client', err));

const cassClient = new cassandra.Client({
	contactPoints: ['127.0.0.1'],
	localDataCenter: 'datacenter1',
	keyspace: 'place'
})


const startTime = new Date('January 1, 23, 0:00:00');

function getTimestamp(){
	// Return a timestamp which reresents seconds elapsed since startTime
	var endTime = new Date();
	var timeDiff = endTime - startTime;
	timeDiff /= 1000;
	var seconds = Math.round(timeDiff);
	return seconds;
}


// Read the mapping of color IDs to RGB values from tile_colors.json
// Initialize set of accepted RGB values and map these values onto 1D color IDs.
// Each four bits in the redis bitfield represents a color ID
var colorSet = new Set();
var rgbToId = new Map();


for (var i=0; i<16; i++){
	var id = i.toString();
	rgbToId.set(JSON.stringify(tile_colors[id]), id);
	colorSet.add(JSON.stringify(tile_colors[id]));
}

// Functions for reading and writing to the redis bitfield 
function convert2dToOff(x, y) {return x + dim * y;}


function validateRequest(ws, o) {
	var rgbData = {"r": o.r, "g": o.g, "b": o.b}

	if (!isValidSet(o)){
		return Promise.reject(new Error('x,y coordinates out of bounds'));
	}


	if (!colorSet.has(JSON.stringify(rgbData))){
		return Promise.reject(new Error('Invalid R, G, B combination'));
	}

	
	return Promise.resolve('Valid Request');
}


async function updateBoard(ws, o){

	
	// Following order in the r/place architecture diagram

	// set new value in cassandra 
	var currTime = getTimestamp();
	var info = {"color": convert2dToOff(o.x, o.y), 
				"user": ws.id,
				"timestamp": currTime}
	
	var query = `UPDATE board SET "(${o.x}, ${o.y})"='${JSON.stringify(info)}' WHERE id=0`;
	cassClient.execute(query, [])
				.catch(err => console.log(err.message));
	
	// set new timestamp in cassandra 
	query = 'UPDATE cooldowns SET last_action=? WHERE userid=?';
	cassClient.execute(query, [currTime, ws.id], {prepare : true})
				.catch(err => console.log(err));

	

	// set redis bitfield 
	var rgbData = {"r": o.r, "g": o.g, "b": o.b}
	setBitField(o.x, o.y, rgbData);

	// respond to client 
	wss.broadcast(JSON.stringify(o));		

	
}

async function setBitField(x, y, rgbVals) {

	var offset = convert2dToOff(x, y);
	var id = rgbToId.get(JSON.stringify(rgbVals));
	var i = parseInt(id);
	
	// Set redis bitfield 
	client.sendCommand(['BITFIELD', 'board', 'SET', 'u4', offset.toString(), id])
		  .catch((err) => console.log('Bitfield update failed', err));

}

wss.on('close', function() {
    console.log('disconnected');

});


// For communicating with the client 

async function sendInitialBoard(sock) {
	for (var x=0;x<dim;x++){
		for (var y=0;y<dim;y++) {
			var offset = convert2dToOff(x, y);
			// Redis bitfield: get u4 at offset
			var colorId = await client.sendCommand(['BITFIELD', 'board', 'GET', 'u4', offset.toString()]);
			console.log(colorId);
			// Get rgb values from tile_colors
			var o = tile_colors[colorId];
			sock.send(JSON.stringify(o));
		}
	}
}

wss.sendToOne =  function sendToOne(data, id){
	wss.clients.forEach(function each(client) {
		if (client.readyState === WebSocket.OPEN && client.id == id) {
			client.send(data);
		} 
	})
}

wss.broadcast = function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};

// Support client session IDs in message
// See lambda request ID
wss.getUniqueID = function () {
    return Uuid.random();
};


// for heartbeat to make sure connection is alive 
function noop() {}
function heartbeat() {
  this.isAlive = true;
}

function isValidSet(o){
	var isValid=false;
	try {
	   isValid = 
		Number.isInteger(o.x) && o.x!=null && 0<=o.x && o.x<dim &&
		Number.isInteger(o.y) && o.y!=null && 0<=o.y && o.y<dim && 
		Number.isInteger(o.r) && o.r!=null && 0<=o.r && o.r<=255 && 
		Number.isInteger(o.g) && o.g!=null && 0<=o.g && o.g<=255 && 
		Number.isInteger(o.b) && o.b!=null && 0<=o.b && o.b<=255;
	} catch (err){ 
		isValid=false; 
	} 
	return isValid;
}

exports.handler = async function (event, context) {

	wss.on('connection', function(ws) {
		ws.id = wss.getUniqueID();
	
		var currTime = getTimestamp();
		const query = 'INSERT INTO cooldowns(userid, last_action) VALUES (?, ?)';
		cassClient.execute(query, [ws.id, currTime ], {prepare: true})
			  .catch(err => console.log(err));
		
	
		// heartbeat
		  ws.isAlive = true;
		  ws.on('pong', heartbeat);
	
		// send initial board: this is slow!!!
		sendInitialBoard(ws);
	
		// when we get a message from the client
		ws.on('message', function(message) {
			console.log(message);
			var o = JSON.parse(message);
			
	
			// TODO: Validate that the cooldown has expired using data stored in cassandra
			const query = 'SELECT last_action FROM cooldowns WHERE userid = ?';
			cassClient.execute(query, [ws.id], {prepare: true})
				.then((res) => 
				  {
					
					const {rows} = res;
					const timestamp = rows[0].last_action
					var currTime = getTimestamp();
					if (res != null && currTime - timestamp > 5) {
						return validateRequest(ws, o);
					}
	
					return Promise.reject(new Error('Please Try Again Later.'));
				})
				.then((res) => {
					updateBoard(ws, o);
				})
				.catch(err => wss.sendToOne(JSON.stringify({"error": err.message}), ws.id));
		});
	
	
		ws.on('close', function() {
			const query = 'DELETE FROM cooldowns WHERE userid = ? IF EXISTS';
			cassClient.execute(query, [ws.id], {prepare: true})
					  .catch(err => console.log(err.message));
		}
		
		
		)
	});	

}


// heartbeat (ping) sent to all clients
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
 
    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);


// Static content
// var express = require('express');
// var app = express();

// static_files has all of statically returned content
// https://expressjs.com/en/starter/static-files.html
// app.use('/',express.static('static_files')); // this directory has files to be returned

// app.listen(8080, function () {
//   console.log('Example app listening on port 8080!');
// });

