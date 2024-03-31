const {createClient } = require('redis');
const redisHost = 'app-redis-001.esgctz.0001.use1.cache.amazonaws.com';
const redisPort = 6379;
const redisClient = createClient({socket: {host: redisHost, port: redisPort, connectTimeout: 100000}});
redisClient.on('error', err => console.log('Redis Client: ', err));
redisClient.connect().catch(err => console.log('Error connecting to client', err));


const {PutObjectCommand, S3Client} = require('@aws-sdk/client-s3');
const client = new S3Client({});

const tile_colors = require('./tile_colors.json');

const bucketName = 'project-bucket-abc';
const dim = 1000;
async function takeBoardSnapshot(board) {

    var params = {
        Bucket: bucketName,
        Key: "board.json",
        Body: JSON.stringify(board)
    }
    const command = new PutObjectCommand(params);
    const response = await client.send(command)
                                 .catch(err => console.log(err.message));
    return response;

}

function convert2dToOff(x, y) {return x + dim * y;}


async function retrieveBoard() {


    // var args = ["BITFIELD", "board"]
    // for (var x=0; x<dim; x++) {
    //     for (var y=0; y<dim; y++) {
    //         var offset = convert2dToOff(x, y)
    //         args.push("GET")
    //         args.push("u4")
    //         args.push(`#${offset.toString()}`)
    //     }
    // }


    var board = await redisClient.sendCommand(['GET', 'board']);
    return board;
}

exports.handler = async(event) => {
    const board = await retrieveBoard();
    const response = await takeBoardSnapshot(board);
    return response;
}