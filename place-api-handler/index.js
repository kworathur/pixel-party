const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const ENDPOINT = process.env.WS_API_ENDPOINT;
const config = {endpoint: ENDPOINT}
const client = new ApiGatewayManagementApiClient(config);

// DynamoDB Connection
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, DeleteCommand} = require('@aws-sdk/lib-dynamodb');
const dynamoClient = new DynamoDBClient({})
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

// Redis Connection
const {createClient } = require('redis');
const redisHost = process.env.REDIS_ENDPOINT;
const redisPort = 6379;
const redisClient = createClient({socket: {host: redisHost, port: redisPort}});
redisClient.on('error', err => console.log('Redis Client: ', err));
redisClient.connect().catch(err => console.log('Error connecting to client', err));


const connections = new Set();

const sendToOne = async (id, body) => {
    try {

        const input = {
            ConnectionId: id, 
            Data: Buffer.from(JSON.stringify(body))
        }

        const command = new PostToConnectionCommand(input);
        const response = await client.send(command)
                                     .catch(err => console.log(err.message));

        console.log('Success', response);
    } catch (err) {
        console.log(err);
        connections.delete(id);
    }
}

const broadcast = async (ids, body) => {
    console.log(ids);
    const all = ids.map(i => sendToOne(i, body));
    return Promise.all(all);
}


exports.handler = async (event) => {

    var response = null;
    console.log('Event', event);

    var body = null;
    if (event.body) {
        body = JSON.parse(event.body);
    }


    if (event.requestContext) {

        const connectionId = event.requestContext.connectionId;
        console.log('Event', event)
        const routeKey = event.requestContext.routeKey;

        switch (routeKey) {
            case '$connect':

                console.log('Accepting client connection');
                connections.add(connectionId);
                var currTime = getTimestamp();

                await dynamo.send(
                    new PutCommand({
                        TableName: 'cooldowns',
                        Item: {
                            userid: connectionId,
                            last_action: currTime
                        }
                    })
                ).catch(err => console.log(err.message));

                
                break;
            
            case 'getBoard':
                // send initial board: this is slow!!!
                console.log('Retrieving the board');
                response = await retrieveBoard();
                console.log(response);
                await sendToOne(connectionId, response);
                break;
            
            case 'update':

                console.log('Updating the board');
                var message = body.message;

                console.log('Message from client', message);
                // TODO: Validate that the cooldown has expired using data stored in cassandra                  
                await dynamo.send(
                    new GetCommand({
                        TableName: 'cooldowns',
                        Key: {
                            userid: connectionId
                        }
                    }))
                    .then((body) => {

                        var currTime = getTimestamp();
                        if (body.Item != null && currTime - body.Item.last_action > 5) {
                            return Promise.resolve(validateRequest(message));
                        }
                        
                        return Promise.reject(new Error('Please Try Again Later.'));
                    })
                    .then(() => updateBoard(connectionId,message))
                    .then(() => broadcast(Array.from(connections), message))
                    .catch(err => sendToOne(connectionId, {"error": err.message}));
                console.log('Setting bitfield')
                break;

            case '$disconnect':

                console.log('Client disconnected');
                await dynamo.send(
                    new DeleteCommand({
                        TableName: 'cooldowns',
                        Key: {
                            userid: connectionId
                        }
                    })
                ).catch(err => console.log(err.messages));
                connections.delete(connectionId);
                break;
                
            default:
                response = {
                    statusCode: 400,
                    body: JSON.stringify('Unsupported method')
                };
                return response;
        }
        
    }

    response = {
        "statusCode": 200,
        "body": "Hello from Lambda!"
    };

    return response;

}


var dim = 1000; // TODO: Scale board to 1000 x 1000
const tile_colors = require('./tile_colors.json');

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
var rgbToId = new Map();

for (var i=0; i<16; i++){
	var id = i.toString();
	rgbToId.set(tile_colors[id], id);
}

// Functions for reading and writing to the redis bitfield 
function convert2dToOff(x, y) {return x * dim + y;}

function isValidSet(o){
	var isValid=false;
	try {
	   isValid = 
		Number.isInteger(o.x) && o.x!=null && 0<=o.x && o.x<dim &&
		Number.isInteger(o.y) && o.y!=null && 0<=o.y && o.y<dim;
	} catch (err){ 
		isValid=false; 
	} 
	return isValid;
}


function validateRequest(o) {
	var rgbData = {"r": o.r, "g": o.g, "b": o.b}

	if (!isValidSet(o)){
		return Promise.reject(new Error('x,y coordinates out of bounds'));
	}


    var isValidColor = false;

    for (const [key, val] of rgbToId){
        if (key.r == rgbData.r && key.g == rgbData.g && key.b == rgbData.b) {
            console.log('Key', key, 'rgbData', rgbData);
            isValidColor = true;
            break;
        }
    }


	if (!isValidColor){
		return Promise.reject(new Error('Invalid R, G, B combination'));
	}

	return Promise.resolve('Valid Request');
}

function getColorId(o) {
    for (const [key, val] of rgbToId) {

        if (key.r == o.r && key.g == o.g && key.b == o.b) {
            return val;
        }
    }
    return -1;
}

async function updateBoard(connectionId, o){


	// set new value in cassandra 
	var currTime = getTimestamp();
	var info = {"color": getColorId(o), 
				"user": connectionId}
	
    await dynamo.send(
        new PutCommand({
            TableName: 'board_cells',
            Item: {
                board_id: 0,
                cell: `(${o.x}, ${o.y})`,
                data: info,
                time_stamp: currTime
            }
        })
    ).catch(err => console.log(err.message));

	
	// set new timestamp in cassandra 
    await dynamo.send(
        new PutCommand({
            TableName: 'cooldowns',
            Item: {
                userid: connectionId, 
                last_action: currTime
            }
    })).catch(err => console.log(err.message));


	// set redis bitfield 
	var rgbData = {"r": o.r, "g": o.g, "b": o.b}
	await setBitField(o.x, o.y, rgbData);
	
}

async function setBitField(x, y, rgbVals) {

    console.log('Bitfield');
    
	var offset = convert2dToOff(x, y);
    let id = null;
    for (const [key, val] of rgbToId) {
        console.log('Key', key, 'rgbVal', rgbVals)
        if (key.r == rgbVals.r && key.g == rgbVals.g && key.b == rgbVals.b) {
            id = val;
            break;
        }
    }

    console.log('Color ID', id);

    const args = ['BITFIELD', 'board', 'SET', 'u4', '0', '15'];

    for (const arg of args){
        console.log(typeof arg);
    }
    // 
	// Set redis bitfield 
	await redisClient.sendCommand(['BITFIELD', 'board', 'SET', 'u4', `#${offset.toString()}`, id])
		  .catch((err) => console.log('Bitfield update failed', err));

}


// For communicating with the client 

async function retrieveBoard() {

    // look one minute in the past
    const lastTime = getTimestamp() - 60;


    const input = {
        "ExpressionAttributeNames" : {
            "#C": "cell",
            "#D": "data",
        },
        "ExpressionAttributeValues":{
            ":t" : lastTime
        },
        "FilterExpression": "time_stamp > :t",
        "ProjectionExpression": "#C, #D",
        "TableName": "board_cells"
    };

    const command = new ScanCommand(input);
    const response = await dynamo.send(command)
                                 .catch(err => console.log(err.message));

    
    
	// for (var x=0;x<dim;x++){
	// 	for (var y=0;y<dim;y++) {
	// 		var offset = convert2dToOff(x, y);
	// 		// Redis bitfield: get u4 at offset
	// 		var colorId = await redisClient.sendCommand(['BITFIELD', 'board', 'GET', 'u4', offset.toString()]);
	// 		response[`(${x}, ${y})`] = tile_colors[colorId];
	// 	}
	// }

    return response;
}



