const net = require('net');
const fs = require('fs');

// Define the server host and port
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 3000;

// Create a TCP client
const client = new net.Socket();
let isSocketOpen = false;
let reconnecting = false;
let allpacketsrequested = false ;
// Store received packets
const receivedPackets = {};

// Function to create the request payload
function createRequestPayload(callType, resendSeq = 0) {
  const payload = Buffer.alloc(2);
  
  // Set callType (1 byte)
  payload.writeUInt8(callType, 0);

  // Set resendSeq (1 byte), only if callType is 2
  if (callType === 2) {
    payload.writeUInt8(resendSeq, 1);
  }

  return payload;
}

// Function to send a request to the server
function sendRequest(callType, resendSeq = 0) {
  if (isSocketOpen) {
    const payload = createRequestPayload(callType, resendSeq);
    client.write(payload);
    console.log(`Sent request: callType=${callType}, resendSeq=${resendSeq}`);
  } else {
    console.log('Socket is closed. Cannot send request.');
  }
}

// Handle incoming data from the server
client.on('data', (data) => {
  console.log('Received data from server:', data);
  parseReceivedData(data);
  if(!allpacketsrequested)requestMissingPackets();
});

// Parse received data and store it
function parseReceivedData(data) {
  let offset = 0;

  while (offset < data.length) {
    try {
      // Extract Symbol (4 bytes)
      const symbol = data.toString('ascii', offset, offset + 4).trim();
      offset += 4;

      // Extract Buy/Sell Indicator (1 byte)
      const buysellindicator = data.toString('ascii', offset, offset + 1);
      offset += 1;

      // Extract Quantity (4 bytes, int32, big-endian)
      const quantity = data.readInt32BE(offset);
      offset += 4;

      // Extract Price (4 bytes, int32, big-endian)
      const price = data.readInt32BE(offset);
      offset += 4;

      // Extract Packet Sequence (4 bytes, int32, big-endian)
      const packetSequence = data.readInt32BE(offset);
      offset += 4;

      // Validate extracted data
      if (!symbol || !['B', 'S'].includes(buysellindicator) || isNaN(quantity) || isNaN(price) || isNaN(packetSequence)) {
        throw new Error('Invalid data received');
      }

      // Store packet data
      receivedPackets[packetSequence] = { symbol, buysellindicator, quantity, price };
    } catch (error) {
      console.error('Data parsing error:', error.message);
    }
  }

  // Save the data to a JSON file
  fs.writeFileSync('packets.json', JSON.stringify(receivedPackets, null, 2));
  console.log('Data saved to packets.json');
}

// Request missing packets based on the sequences
function requestMissingPackets() {
  allpacketsrequested = true ;
  const sequences = Object.keys(receivedPackets).map(Number);
  const maxSequence = Math.max(...sequences);
  const missingSequences = [];

  // Check for missing sequences
  for (let i = 1; i <= maxSequence; i++) {
    if (!receivedPackets[i]) {
      missingSequences.push(i);
    }
  }

  // Request missing sequences
  missingSequences.forEach(seq => {
    sendRequest(2, seq); // Resend Packet request
  });
}

// Handle errors
client.on('error', (err) => {
  console.error('Error:', err.message);
  isSocketOpen = false; // Update socket state
  if (!reconnecting && !allpacketsrequested) {
    reconnect();
  }
});

// Handle connection close
client.on('close', () => {
  console.log('Connection closed');
  isSocketOpen = false; // Update socket state
  if (!reconnecting && !allpacketsrequested) {
    reconnect();
  }
});

// Function to handle reconnection
function reconnect() {
  reconnecting = true;
  console.log('Attempting to reconnect...');
  
  setTimeout(() => {
    client.connect(SERVER_PORT, SERVER_HOST, () => {
      console.log('Reconnected to TCP server');
      isSocketOpen = true;
      reconnecting = false;
      sendRequest(1); // Resend initial request after reconnecting
    });
  }, 5000); // Reconnect after 5 seconds
}

// Connect to the TCP server
client.connect(SERVER_PORT, SERVER_HOST, () => {
  console.log('Connected to TCP server');
  isSocketOpen = true;
  sendRequest(1); // Send initial request after confirming connection
});
